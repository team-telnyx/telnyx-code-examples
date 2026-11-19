import { z } from "zod";
import { isMockAi } from "@/lib/config";
import { SEVERITIES, type Severity } from "@/lib/severity";

/**
 * Structured incident classification extracted by an LLM.
 *
 * The model is instructed to preserve uncertainty: ambiguous reports must
 * claim a lower severity and name what is missing instead of inventing
 * outage facts. `confidence` reflects how much of the report was grounded.
 */
export const incidentClassificationSchema = z.object({
  title: z
    .string()
    .min(3)
    .max(120)
    .describe("Short headline for the incident, 3-120 characters"),
  summary: z
    .string()
    .min(10)
    .max(600)
    .describe(
      "One or two sentence neutral summary of what the reporter observed. Never invent facts.",
    ),
  severity: z
    .enum(SEVERITIES)
    .describe(
      "SEV1: total outage/safety issue. SEV2: major degraded. SEV3: limited. SEV4: cosmetic. When ambiguous choose the LOWER severity.",
    ),
  affectedService: z
    .string()
    .min(1)
    .max(120)
    .describe("Service or system the report is about (e.g. 'checkout API')"),
  affectedRegion: z
    .string()
    .max(80)
    .nullable()
    .describe("Region/datacenter if mentioned, otherwise null"),
  symptoms: z
    .string()
    .min(3)
    .max(600)
    .describe("Observed symptoms only — what the reporter actually saw"),
  suggestedNextAction: z
    .string()
    .min(3)
    .max(300)
    .describe("Most useful next diagnostic or mitigation step"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("0-1 confidence that the extraction is accurate and complete"),
  missingInformation: z
    .string()
    .max(300)
    .nullable()
    .describe("Short list of unknowns an operator should confirm, or null"),
});

export type IncidentClassification = z.infer<
  typeof incidentClassificationSchema
>;

export class ClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassificationError";
  }
}

const SYSTEM_PROMPT = `You triage incident reports received over SMS from field reporters.
Extract only what the report states. Never invent, assume, or embellish facts about
outages, causes, or scope. If the report is ambiguous or incomplete:
- choose the LOWER severity that is still defensible,
- put what is unknown into "missingInformation",
- keep the summary close to the reporter's wording,
- lower your confidence.

Severity guide:
SEV1 total outage or safety issue, SEV2 major degradation with broad impact,
SEV3 limited or regional impact, SEV4 cosmetic or minor inconvenience.`;

export interface ClassificationUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ClassifyResult {
  classification: IncidentClassification;
  usage: ClassificationUsage | null;
}

/**
 * Live mode routes through Vercel AI Gateway with the model
 * `zai/glm-5.3-flash` (default; override with AI_MODEL when a team is on
 * the gateway's free tier), forced to Telnyx-hosted inference via
 * `providerOptions.gateway.only = ["telnyx"]`. On Vercel deployments the
 * AI Gateway authenticates with the platform OIDC token automatically;
 * locally, set AI_GATEWAY_API_KEY.
 */
export const DEFAULT_MODEL = "zai/glm-5.3-flash";

export function getClassificationModel(): string {
  return process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

export async function classifyIncident(
  message: string,
  reporterPhone: string,
): Promise<ClassifyResult> {
  if (isMockAi()) {
    return { classification: mockClassify(message), usage: null };
  }

  const { generateObject } = await import("ai");
  const { gateway } = await import("ai");

  try {
    const { object, usage } = await generateObject({
      model: gateway(getClassificationModel()),
      schema: incidentClassificationSchema,
      schemaName: "IncidentClassification",
      schemaDescription:
        "Structured extraction of an SMS incident report; uncertainty must lower severity and confidence.",
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(message, reporterPhone),
      temperature: 0.1,
      providerOptions: {
        gateway: {
          only: ["telnyx"],
        },
      },
    });

    return {
      classification: object,
      usage: usage
        ? {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
          }
        : null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new ClassificationError(
      `Incident classification failed: ${detail.slice(0, 300)}`,
    );
  }
}

export function buildUserPrompt(message: string, reporterPhone: string): string {
  return [
    "Inbound SMS incident report:",
    JSON.stringify({ reporterPhoneMasked: maskForPrompt(reporterPhone) }),
    "Report:",
    JSON.stringify({ body: message.slice(0, 2000) }),
  ].join("\n");
}

function maskForPrompt(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `+${digits.slice(0, 2)}***${digits.slice(-4)}`;
}

/**
 * Deterministic offline classifier for local demos (SIGNALDESK_MOCK_AI=true).
 * Maps keywords to severity and service; never fabricates more than it reads.
 */
export function mockClassify(message: string): IncidentClassification {
  const lower = message.toLowerCase();

  const serviceHint = [
    "checkout",
    "api",
    "login",
    "database",
    "network",
    "billing",
    "payment",
    "search",
    "email",
    "sms",
    "voice",
    "call",
    "app",
    "website",
    "dashboard",
  ].find((keyword) => lower.includes(keyword));

  const affectedService = serviceHint ? `reported ${serviceHint} issue` : "unknown service";

  let severity: Severity = "SEV4";
  if (/(down|outage|can'?t (reach|use|log ?in)|dead|no dial ?tone)/.test(lower)) {
    severity = "SEV2";
  }
  if (/(all|every|whole|entire|total|everyone).*(down|outage|failing)/.test(lower)) {
    severity = "SEV1";
  }
  if (/slow|laggy|intermittent|some|degraded/.test(lower)) {
    severity = severity === "SEV2" ? "SEV2" : "SEV3";
  }

  return {
    title: `Reported ${serviceHint ?? "service"} issue`,
    summary: message.slice(0, 200),
    severity,
    affectedService,
    affectedRegion: null,
    symptoms: message.slice(0, 400) || "No symptoms provided",
    suggestedNextAction: "Acknowledge reporter and investigate the reported component",
    confidence: 0.55,
    missingInformation: "Real model unavailable in mock mode; treat extraction as unverified",
  };
}
