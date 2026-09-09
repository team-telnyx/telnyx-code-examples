import { Agent, type KvNamespace } from "@telnyx/edge-runtime";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type IncidentStatus = "detected" | "investigating" | "restoring" | "resolved" | "closed";
export type Severity = "SEV-1" | "SEV-2" | "SEV-3";

export interface TimelineEvent {
  id: number;
  type: string;
  message: string;
  createdAt: number;
}

export interface IncidentState extends Record<string, unknown> {
  incidentId: string;
  title: string;
  description: string;
  status: IncidentStatus;
  severity: Severity;
  affectedServices: string[];
  affectedCustomerCount: number;
  notificationsSent: number;
  notificationFailures: number;
  liveMode: boolean;
  startedAt: number;
  updatedAt: number;
  resolvedAt: number;
  rootCause: string;
  rcaPath: string;
  recurrenceStatus: "not-scheduled" | "scheduled" | "clean" | "recurring";
  error: string;
}

interface IncidentEnv {
  TELNYX: {
    messages: {
      send(message: { from: string; to: string; text: string }): Promise<unknown>;
    };
    ai: {
      openai: {
        chat: {
          createCompletion(request: {
            model: string;
            messages: Array<{ role: string; content: string }>;
            max_tokens?: number;
            temperature?: number;
          }): Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
        };
      };
    };
  };
  INCIDENT_KV?: KvNamespace;
  TELNYX_SMS_FROM_NUMBER: string;
  CLOUDFS_MOUNT_PATH: string;
  CLOUDFS_RCA_DIR: string;
  RECURRENCE_CHECK_SECONDS: string;
}

const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  detected: ["investigating"],
  investigating: ["restoring", "resolved"],
  restoring: ["resolved", "investigating"],
  resolved: ["closed", "investigating"],
  closed: ["investigating"],
};

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : "••••";
}

function cleanCustomers(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export class NetworkIncidentAgent extends Agent<IncidentEnv, IncidentState> {
  protected override initialState(): IncidentState {
    return {
      incidentId: "",
      title: "",
      description: "",
      status: "detected",
      severity: "SEV-2",
      affectedServices: [],
      affectedCustomerCount: 0,
      notificationsSent: 0,
      notificationFailures: 0,
      liveMode: false,
      startedAt: 0,
      updatedAt: 0,
      resolvedAt: 0,
      rootCause: "",
      rcaPath: "",
      recurrenceStatus: "not-scheduled",
      error: "",
    };
  }

  async initialize(params: {
    incidentId: string;
    title: string;
    description: string;
    affectedServices: string[];
    affectedCustomers: string[];
    liveMode: boolean;
  }): Promise<IncidentState> {
    const customers = cleanCustomers(params.affectedCustomers);
    if (!params.incidentId) throw new Error("incidentId is required");
    if (params.liveMode && customers.length === 0) throw new Error("live mode requires at least one affected customer");
    await this.storeCustomers(params.incidentId, customers);
    const severity = await this.assessSeverity(params.description, customers.length, params.liveMode);
    const now = Date.now();
    const state: IncidentState = {
      incidentId: params.incidentId,
      title: params.title || "Network service degradation",
      description: params.description,
      status: "detected",
      severity,
      affectedServices: params.affectedServices,
      affectedCustomerCount: customers.length,
      notificationsSent: 0,
      notificationFailures: 0,
      liveMode: params.liveMode,
      startedAt: now,
      updatedAt: now,
      resolvedAt: 0,
      rootCause: "",
      rcaPath: "",
      recurrenceStatus: "not-scheduled",
      error: "",
    };
    await this.replaceState(state);
    this.ensureSchema();
    this.ctx.storage.sql.exec("DELETE FROM incident_timeline");
    await this.record("incident.detected", `${severity} incident created for ${params.affectedServices.join(", ") || "network services"}`);
    return this.getState();
  }

  async transition(params: { status: IncidentStatus; description?: string; notify?: boolean }): Promise<IncidentState> {
    const state = await this.getState();
    if (!state.incidentId) throw new Error("incident is not initialized");
    if (!ALLOWED_TRANSITIONS[state.status].includes(params.status)) {
      throw new Error(`invalid transition: ${state.status} → ${params.status}`);
    }
    const next = await this.setState({
      status: params.status,
      description: params.description || state.description,
      updatedAt: Date.now(),
      resolvedAt: params.status === "resolved" ? Date.now() : state.resolvedAt,
      error: "",
    });
    await this.record(`incident.${params.status}`, params.description || `Status changed to ${params.status}`);
    if (params.notify !== false) {
      await this.notify({ message: this.statusMessage(next) });
    }
    return this.getState();
  }

  async notify(params: { message: string }): Promise<{ sent: number; failed: number; recipients: string[] }> {
    const state = await this.getState();
    const customers = await this.customers(state.incidentId);
    if (!params.message.trim()) throw new Error("message is required");
    let sent = 0;
    let failed = 0;
    if (state.liveMode) {
      const from = this.env.TELNYX_SMS_FROM_NUMBER;
      if (!/^\+[1-9]\d{7,14}$/.test(from || "")) throw new Error("TELNYX_SMS_FROM_NUMBER must be a valid E.164 number");
      for (const to of customers) {
        try {
          await this.env.TELNYX.messages.send({ from, to, text: params.message });
          sent += 1;
        } catch (error: unknown) {
          failed += 1;
          await this.record("notification.failed", `SMS delivery failed for ${maskPhone(to)}: ${this.errorMessage(error)}`);
        }
      }
    } else {
      sent = customers.length;
    }
    await this.setState({
      notificationsSent: state.notificationsSent + sent,
      notificationFailures: state.notificationFailures + failed,
      updatedAt: Date.now(),
    });
    await this.record("customers.notified", `${state.liveMode ? "Sent" : "Simulated"} ${sent} SMS notification${sent === 1 ? "" : "s"}${failed ? `; ${failed} failed` : ""}`);
    if (failed > 0) throw new Error(`${failed} of ${customers.length} SMS notifications failed`);
    return { sent, failed, recipients: customers.map(maskPhone) };
  }

  async generateRca(params: { rootCause: string }): Promise<{ path: string; content: string }> {
    const state = await this.getState();
    if (!params.rootCause.trim()) throw new Error("rootCause is required");
    const timeline = await this.timeline();
    const content = JSON.stringify({
      incidentId: state.incidentId,
      title: state.title,
      severity: state.severity,
      status: state.status,
      affectedServices: state.affectedServices,
      affectedCustomerCount: state.affectedCustomerCount,
      startedAt: new Date(state.startedAt).toISOString(),
      resolvedAt: state.resolvedAt ? new Date(state.resolvedAt).toISOString() : null,
      rootCause: params.rootCause,
      timeline: timeline.map((event) => ({ ...event, createdAt: new Date(event.createdAt).toISOString() })),
    }, null, 2);
    const root = resolve(this.env.CLOUDFS_MOUNT_PATH || "/mnt/incidentfs");
    const directory = (this.env.CLOUDFS_RCA_DIR || "/rca").replace(/^[/\\]+/, "");
    const relativePath = join(directory, `${state.incidentId}.json`);
    const target = join(root, relativePath);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
    await this.setState({ rootCause: params.rootCause, rcaPath: relativePath, updatedAt: Date.now() });
    await this.record("rca.written", `RCA saved to CloudFS at ${relativePath}`);
    return { path: relativePath, content };
  }

  async scheduleRecurrenceCheck(delaySeconds?: number): Promise<string> {
    const state = await this.getState();
    const configured = Number(this.env.RECURRENCE_CHECK_SECONDS || 259200);
    const delay = delaySeconds ?? configured;
    if (!Number.isFinite(delay) || delay < 1) throw new Error("recurrence delay must be at least one second");
    const id = await this.schedule(delay, "checkRecurrence", { incidentId: state.incidentId }, { id: `recurrence-${state.incidentId}` });
    await this.setState({ recurrenceStatus: "scheduled", updatedAt: Date.now() });
    await this.record("recurrence.scheduled", `Recurrence check scheduled in ${Math.round(delay)} seconds`);
    return id;
  }

  async checkRecurrence(): Promise<void> {
    const state = await this.getState();
    if (state.status !== "resolved") {
      await this.setState({ recurrenceStatus: "recurring", updatedAt: Date.now() });
      await this.record("recurrence.detected", "Incident was no longer resolved when recurrence check ran");
      return;
    }
    await this.setState({ status: "closed", recurrenceStatus: "clean", updatedAt: Date.now() });
    await this.record("incident.closed", "Recurrence check passed; incident closed");
  }

  async callContext(): Promise<{ message: string; state: IncidentState }> {
    const state = await this.getState();
    return {
      message: this.voiceMessage(state),
      state,
    };
  }

  async handleInboundCall(): Promise<{ message: string; state: IncidentState }> {
    const state = await this.getState();
    await this.record("customer.call", "Answered an inbound customer call with current incident context");
    return { message: this.voiceMessage(state), state };
  }

  async snapshot(): Promise<{ state: IncidentState; timeline: TimelineEvent[]; customers: string[] }> {
    const state = await this.getState();
    return { state, timeline: await this.timeline(), customers: (await this.customers(state.incidentId)).map(maskPhone) };
  }

  private customerKey(incidentId: string): string {
    return `incident:${incidentId}:affected_customers`;
  }

  private async customers(incidentId: string): Promise<string[]> {
    if (!incidentId) return [];
    const stored = this.env.INCIDENT_KV
      ? await this.env.INCIDENT_KV.get(this.customerKey(incidentId))
      : await this.ctx.storage.get<string[]>(this.customerKey(incidentId));
    if (!stored) return [];
    const parsed: unknown = typeof stored === "string" ? JSON.parse(stored) : stored;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  }

  private async storeCustomers(incidentId: string, customers: string[]): Promise<void> {
    if (this.env.INCIDENT_KV) {
      await this.env.INCIDENT_KV.put(this.customerKey(incidentId), JSON.stringify(customers));
      return;
    }
    // Current local Edge stacks expose the actor's durable key-value storage
    // even when an external KV binding is not injected into actor processes.
    await this.ctx.storage.put(this.customerKey(incidentId), customers);
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS incident_timeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  private async record(type: string, message: string): Promise<void> {
    this.ensureSchema();
    const createdAt = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO incident_timeline (event_type, message, created_at) VALUES (?, ?, ?)",
      type,
      message,
      createdAt,
    );
    await this.events.emit(type, { message, createdAt });
  }

  private async timeline(): Promise<TimelineEvent[]> {
    this.ensureSchema();
    return this.ctx.storage.sql.exec(
      "SELECT id, event_type, message, created_at FROM incident_timeline ORDER BY id DESC LIMIT 100",
    ).toArray().map((row) => ({
      id: Number(row.id),
      type: String(row.event_type),
      message: String(row.message),
      createdAt: Number(row.created_at),
    }));
  }

  private async assessSeverity(description: string, customers: number, liveMode: boolean): Promise<Severity> {
    const fallback: Severity = /outage|offline|unavailable|total/i.test(description) || customers >= 100 ? "SEV-1" : customers >= 10 ? "SEV-2" : "SEV-3";
    if (!liveMode) return fallback;
    try {
      const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: "meta-llama/Meta-Llama-3.1-8B-Instruct",
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: "system", content: "Classify the incident as exactly SEV-1, SEV-2, or SEV-3. Return only that token." },
          { role: "user", content: `${description}\nAffected customers: ${customers}` },
        ],
      });
      const result = response.choices?.[0]?.message?.content?.match(/SEV-[123]/)?.[0];
      return result === "SEV-1" || result === "SEV-2" || result === "SEV-3" ? result : fallback;
    } catch {
      return fallback;
    }
  }

  private statusMessage(state: IncidentState): string {
    const detail = state.description ? ` ${state.description}` : "";
    return `[${state.severity}] ${state.incidentId} is now ${state.status}.${detail}`;
  }

  private voiceMessage(state: IncidentState): string {
    if (state.status === "resolved" || state.status === "closed") {
      return `Incident ${state.incidentId} is ${state.status}. Service has been restored. ${state.description}`;
    }
    return `Incident ${state.incidentId} is ${state.status}. ${state.description} Our team is actively managing this ${state.severity} incident.`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
