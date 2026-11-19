"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { applyStatusChange } from "@/lib/incidents";
import { notifyStatusChange } from "@/lib/messaging";
import { STATUSES, type Status } from "@/lib/status";
import { isTransitionValid } from "@/lib/status";
import type { Incident } from "@/db/schema";

const statusChangeSchema = z.object({
  incidentId: z.string().uuid(),
  newStatus: z.enum(STATUSES),
  operatorNote: z.string().max(500).optional().nullable(),
});

export interface StatusChangeResult {
  ok: boolean;
  error?: string;
  sent?: number;
  skipped?: number;
}

/**
 * Operator-only status change: verifies the session, applies the validated
 * transition in a transaction, then notifies active subscribers by SMS.
 */
export async function updateIncidentStatus(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const parsed = statusChangeSchema.safeParse({
    incidentId: formData.get("incidentId"),
    newStatus: formData.get("newStatus"),
    operatorNote: formData.get("operatorNote") || null,
  });
  if (!parsed.success) {
    redirect(`/incidents/${formData.get("incidentId") ?? ""}?error=invalid_input`);
  }

  const incident = await requireIncident(parsed.data.incidentId);
  if (!incident) {
    redirect("/?error=incident_not_found");
  }

  if (!isTransitionValid(incident.status, parsed.data.newStatus as Status)) {
    redirect(`/incidents/${incident.id}?error=invalid_transition`);
  }

  const updated = await applyStatusChange(
    incident.id,
    parsed.data.newStatus as Status,
    parsed.data.operatorNote ?? null,
  );

  if (updated) {
    await notifyStatusChange({
      incidentNumber: incident.number,
      incidentId: incident.id,
      previousStatus: incident.status,
      newStatus: updated.status,
      operatorNote: parsed.data.operatorNote ?? null,
    });
  }

  revalidatePath(`/incidents/${incident.id}`);
  revalidatePath("/");
  redirect(`/incidents/${incident.id}?updated=1`);
}

async function requireIncident(incidentId: string): Promise<Incident | null> {
  const { getIncidentById } = await import("@/lib/incidents");
  const incident = await getIncidentById(incidentId);
  return incident ?? null;
}
