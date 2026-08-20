import type {
  Env,
  LeadRef,
  ShipmentRef,
  LeadCreateInput,
  LeadCreateResult,
  SdrAssignmentResult,
  SdrAvailabilityResult,
  LeadMeetingUpdateInput,
  LeadMeetingUpdateResult,
  LeadCurrentMeeting,
} from "./types.js";

export interface SalesforceConfig {
  useMock: boolean;
  writeMode: "mock" | "demo_record";
  clientId?: string;
  clientSecret?: string;
  domain?: string;
  apiVersion?: string;
  demoLeadEmail?: string;
}

export interface SalesforceShipmentUpdate {
  salesforce_id: string;
  status: string;
  tracking_number?: string;
  estimated_delivery?: string;
}

export interface SalesforceLeadFieldUpdate {
  lead_id?: string;
  field?: string;
  value: string;
}

export interface SalesforceLeadFieldUpdateResult {
  lead: LeadRef;
  field: string;
  value: string;
}

const DEFAULT_LEAD_DEMO_FIELD = "reMQL_Source_Detail__c";
const DEFAULT_DEMO_LEAD_EMAIL = "customeragent-demo@example.com";
const DEMO_LEAD_LAST_NAME = "CustomerAgent Demo";
const DEMO_LEAD_COMPANY = "Telnyx CustomerAgent Demo";

interface TokenResponse {
  access_token?: string;
  instance_url?: string;
}

let cachedAccessToken: string | null = null;
let cachedInstanceUrl: string | null = null;
let cachedUntil = 0;

export function resetSalesforceAuthCache(): void {
  forceReauthenticate();
}

export async function salesforceConfig(env: Env): Promise<SalesforceConfig> {
  const mockMode = await getConfig(env, "USE_MOCK_SALESFORCE");
  const writeMode = await getConfig(env, "SF_WRITE_MODE");
  return {
    useMock: mockMode !== "false",
    writeMode: writeMode === "demo_record" ? "demo_record" : "mock",
    clientId: await getConfig(env, "SF_CLIENT_ID"),
    clientSecret: await getConfig(env, "SF_CLIENT_SECRET"),
    domain: (await getConfig(env, "SF_DOMAIN")) || "login",
    apiVersion: (await getConfig(env, "SF_API_VERSION")) || "v58.0",
    demoLeadEmail: (await getConfig(env, "SF_DEMO_LEAD_EMAIL")) || DEFAULT_DEMO_LEAD_EMAIL,
  };
}

export async function lookupShipment(env: Env, orderId: string): Promise<ShipmentRef> {
  const config = await salesforceConfig(env);
  const normalized = normalizeOrderId(orderId);
  if (config.useMock) return mockLookupShipment(normalized);

  const soql = encodeURIComponent(
    `SELECT Id, Name, Status__c, Carrier__c, Tracking_Number__c, Estimated_Delivery__c FROM Shipment__c WHERE Name = '${escapeSoql(normalized)}' LIMIT 1`,
  );
  const res = await salesforceFetch(config, `/services/data/${config.apiVersion}/query?q=${soql}`);
  if (!res.ok) throw new Error(`Salesforce shipment lookup failed: ${res.status} - ${await safeResponseText(res)}`);

  const data = (await res.json()) as { records?: Array<Record<string, unknown>> };
  const row = data.records?.[0];
  if (!row) return notFoundShipment(normalized);

  return {
    id: String(row["Name"] ?? row["Id"] ?? normalized),
    carrier: String(row["Carrier__c"] ?? "unknown"),
    status: String(row["Status__c"] ?? "unknown"),
    eta: String(row["Estimated_Delivery__c"] ?? "unknown"),
    tracking_number: row["Tracking_Number__c"] ? String(row["Tracking_Number__c"]) : undefined,
    salesforce_id: String(row["Id"] ?? ""),
  };
}

export async function lookupLatestLead(env: Env): Promise<LeadRef | null> {
  const config = await salesforceConfig(env);
  if (config.useMock) return mockLeads[0] ?? null;

  const soql = encodeURIComponent(
    "SELECT Id, Name, Company, Email, Phone, MobilePhone, Status, LeadSource, LastModifiedDate FROM Lead WHERE IsConverted = false ORDER BY LastModifiedDate DESC LIMIT 1",
  );
  const res = await salesforceFetch(config, `/services/data/${config.apiVersion}/query?q=${soql}`);
  if (!res.ok) throw new Error(`Salesforce lead lookup failed: ${res.status} - ${await safeResponseText(res)}`);

  const data = (await res.json()) as { records?: Array<Record<string, unknown>> };
  const row = data.records?.[0];
  if (!row) return null;
  return leadFromRow(row);
}

export async function updateLeadDemoField(
  env: Env,
  update: SalesforceLeadFieldUpdate,
): Promise<SalesforceLeadFieldUpdateResult> {
  const config = await salesforceConfig(env);
  const field = update.field?.trim() || DEFAULT_LEAD_DEMO_FIELD;
  const value = update.value.trim();
  if (!value) throw new Error("Salesforce Lead update value is required");

  if (config.useMock || config.writeMode === "mock") {
    return mockUpdateLeadDemoField({ ...update, field, value });
  }

  const lead = await getOrCreateDemoLead(config);
  if (!lead?.id) throw new Error("No Salesforce Lead found to update");

  const res = await salesforceFetch(config, `/services/data/${config.apiVersion}/sobjects/Lead/${encodeURIComponent(lead.id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ [field]: value }),
  });
  if (!res.ok) throw new Error(`Salesforce lead update failed: ${res.status} - ${await safeResponseText(res)}`);

  return {
    lead: {
      ...lead,
      demo_field: field,
      demo_note: value,
      last_modified: new Date().toISOString(),
    },
    field,
    value,
  };
}

export async function updateShipmentStatus(env: Env, update: SalesforceShipmentUpdate): Promise<void> {
  const config = await salesforceConfig(env);
  if (config.useMock) {
    mockUpdateShipment(update);
    return;
  }

  const res = await salesforceFetch(config, `/services/data/${config.apiVersion}/sobjects/Shipment__c/${update.salesforce_id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Status__c: update.status,
      Tracking_Number__c: update.tracking_number,
      Estimated_Delivery__c: update.estimated_delivery,
    }),
  });
  if (!res.ok) throw new Error(`Salesforce shipment update failed: ${res.status} - ${await safeResponseText(res)}`);
}

async function salesforceFetch(config: SalesforceConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const first = await fetchWithAuth(config, path, init);
  if (!isExpiredSession(first)) return first;

  forceReauthenticate();
  return fetchWithAuth(config, path, init);
}

async function lookupLeadById(env: Env, leadId: string): Promise<LeadRef | null> {
  const config = await salesforceConfig(env);
  if (config.useMock) return mockLeads.find((lead) => lead.id === leadId) ?? null;

  const res = await salesforceFetch(config, `/services/data/${config.apiVersion}/sobjects/Lead/${encodeURIComponent(leadId)}?fields=Id,Name,Company,Email,Phone,MobilePhone,Status,LeadSource,LastModifiedDate`);
  if (!res.ok) throw new Error(`Salesforce lead lookup failed: ${res.status} - ${await safeResponseText(res)}`);
  return leadFromRow((await res.json()) as Record<string, unknown>);
}

async function getOrCreateDemoLead(config: SalesforceConfig): Promise<LeadRef> {
  const existing = await lookupDemoLead(config);
  if (existing) return existing;

  const res = await salesforceFetch(config, `/services/data/${config.apiVersion}/sobjects/Lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      LastName: DEMO_LEAD_LAST_NAME,
      Company: DEMO_LEAD_COMPANY,
      Email: config.demoLeadEmail,
    }),
  });
  if (!res.ok) throw new Error(`Salesforce demo Lead create failed: ${res.status} - ${await safeResponseText(res)}`);

  const created = (await res.json()) as { id?: string };
  if (!created.id) throw new Error("Salesforce demo Lead create response missing id");
  const lead = await lookupLeadByIdWithConfig(config, created.id);
  if (!lead) throw new Error("Salesforce demo Lead was created but could not be reloaded");
  return lead;
}

async function lookupDemoLead(config: SalesforceConfig): Promise<LeadRef | null> {
  const soql = encodeURIComponent(
    `SELECT Id, Name, Company, Email, Phone, MobilePhone, Status, LeadSource, LastModifiedDate FROM Lead WHERE IsConverted = false AND Email = '${escapeSoql(config.demoLeadEmail ?? DEFAULT_DEMO_LEAD_EMAIL)}' ORDER BY LastModifiedDate DESC LIMIT 1`,
  );
  const res = await salesforceFetch(config, `/services/data/${config.apiVersion}/query?q=${soql}`);
  if (!res.ok) throw new Error(`Salesforce demo Lead lookup failed: ${res.status} - ${await safeResponseText(res)}`);

  const data = (await res.json()) as { records?: Array<Record<string, unknown>> };
  const row = data.records?.[0];
  return row ? leadFromRow(row) : null;
}

async function lookupLeadByIdWithConfig(config: SalesforceConfig, leadId: string): Promise<LeadRef | null> {
  const res = await salesforceFetch(config, `/services/data/${config.apiVersion}/sobjects/Lead/${encodeURIComponent(leadId)}?fields=Id,Name,Company,Email,Phone,MobilePhone,Status,LeadSource,LastModifiedDate`);
  if (!res.ok) throw new Error(`Salesforce lead lookup failed: ${res.status} - ${await safeResponseText(res)}`);
  return leadFromRow((await res.json()) as Record<string, unknown>);
}

async function fetchWithAuth(config: SalesforceConfig, path: string, init: RequestInit): Promise<Response> {
  const auth = await authenticate(config);
  return fetch(`${auth.instanceUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${auth.accessToken}`,
    },
  });
}

function forceReauthenticate(): void {
  cachedAccessToken = null;
  cachedInstanceUrl = null;
  cachedUntil = 0;
}

function isExpiredSession(res: Response): boolean {
  return res.status === 401 || res.status === 403;
}

async function safeResponseText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 1000);
  } catch {
    return "unable to read response body";
  }
}

async function authenticate(config: SalesforceConfig): Promise<{ accessToken: string; instanceUrl: string }> {
  if (cachedAccessToken && cachedInstanceUrl && Date.now() < cachedUntil) {
    return { accessToken: cachedAccessToken, instanceUrl: cachedInstanceUrl };
  }
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Salesforce OAuth2 credentials required: SF_CLIENT_ID and SF_CLIENT_SECRET");
  }

  const res = await fetch(tokenUrl(config.domain), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Salesforce OAuth2 failed: ${res.status}`);

  const data = (await res.json()) as TokenResponse;
  if (!data.access_token || !data.instance_url) {
    throw new Error("Salesforce OAuth2 response missing access_token or instance_url");
  }

  cachedAccessToken = data.access_token;
  cachedInstanceUrl = data.instance_url;
  cachedUntil = Date.now() + 90 * 60 * 1000;
  return { accessToken: cachedAccessToken, instanceUrl: cachedInstanceUrl };
}

function tokenUrl(domain = "login"): string {
  if (domain.startsWith("https://")) return `${domain.replace(/\/$/, "")}/services/oauth2/token`;
  if (domain === "test") return "https://test.salesforce.com/services/oauth2/token";
  if (domain === "login") return "https://login.salesforce.com/services/oauth2/token";
  return `https://${domain}.my.salesforce.com/services/oauth2/token`;
}

async function getConfig(env: Env, key: string): Promise<string | undefined> {
  if (key === "USE_MOCK_SALESFORCE") {
    try {
      const secret = await env.SECRETS?.get(key);
      if (secret?.trim() === "true") return "true";
    } catch {
      // Fall through to direct env lookup.
    }
  }
  const direct = env[key];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  try {
    const secret = await env.SECRETS?.get(key);
    return secret?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function normalizeOrderId(orderId: string): string {
  return orderId.trim().replace(/\s+/g, "-").toUpperCase();
}

function escapeSoql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function notFoundShipment(orderId: string): ShipmentRef {
  return {
    id: orderId,
    carrier: "unknown",
    status: "not_found",
    eta: "unknown",
  };
}

const mockShipments = new Map<string, ShipmentRef>([
  ["ORD-10042", { id: "ORD-10042", status: "shipped", eta: "Friday", carrier: "Telnyx Logistics", salesforce_id: "SHP-001", tracking_number: "1Z999AA10123456784" }],
  ["ORD-10043", { id: "ORD-10043", status: "processing", eta: "Monday", carrier: "Telnyx Logistics", salesforce_id: "SHP-002" }],
  ["ORD-10044", { id: "ORD-10044", status: "delivered", eta: "Yesterday", carrier: "Telnyx Logistics", salesforce_id: "SHP-003" }],
]);

const mockLeads: LeadRef[] = [
  {
    id: "00Q-demo-latest",
    name: "Anusha Demo Lead",
    company: "Telnyx",
    email: "anusha@example.com",
    status: "MQL",
    lead_source: "Demo",
    last_modified: new Date().toISOString(),
    shipment: "Telnyx",
    requested_meeting_time: "Tuesday at 2 PM",
    meeting_time: null,
    meeting_status: "Requested",
    customer_context: "Interested in Telnyx onboarding",
    assigned_sdr: undefined,
    sdr_confirmation: undefined,
    customer_confirmation: undefined,
    previous_meeting_time: null,
  },
];

function leadFromRow(row: Record<string, unknown>): LeadRef {
  return {
    id: String(row["Id"] ?? ""),
    name: String(row["Name"] ?? "[[unknown]]"),
    company: String(row["Company"] ?? "[[unknown]]"),
    email: String(row["Email"] ?? ""),
    phone: String(row["MobilePhone"] ?? row["Phone"] ?? "") || undefined,
    status: String(row["Status"] ?? "unknown"),
    lead_source: row["LeadSource"] ? String(row["LeadSource"]) : undefined,
    last_modified: row["LastModifiedDate"] ? String(row["LastModifiedDate"]) : undefined,
    shipment: row["Shipment__c"] ? String(row["Shipment__c"]) : undefined,
    requested_meeting_time: row["Requested_Meeting_Time__c"] ? String(row["Requested_Meeting_Time__c"]) : undefined,
    meeting_time: row["Meeting_Time__c"] ? String(row["Meeting_Time__c"]) : null,
    meeting_status: row["Meeting_Status__c"] ? String(row["Meeting_Status__c"]) : undefined,
    customer_context: row["Customer_Context__c"] ? String(row["Customer_Context__c"]) : undefined,
    assigned_sdr: row["SDR_Assigned__c"] ? String(row["SDR_Assigned__c"]) : undefined,
    sdr_confirmation: row["SDR_Approval__c"] ? String(row["SDR_Approval__c"]) : undefined,
    customer_confirmation: row["Customer_Approval__c"] ? String(row["Customer_Approval__c"]) : undefined,
    previous_meeting_time: null,
  };
}

function mockLookupShipment(orderId: string): ShipmentRef {
  return mockShipments.get(orderId) ?? notFoundShipment(orderId);
}

function mockUpdateShipment(update: SalesforceShipmentUpdate): void {
  const existing = [...mockShipments.values()].find((shipment) => shipment.salesforce_id === update.salesforce_id);
  if (!existing) return;
  mockShipments.set(existing.id, {
    ...existing,
    status: update.status,
    eta: update.estimated_delivery ?? existing.eta,
    tracking_number: update.tracking_number ?? existing.tracking_number,
  });
}

function mockUpdateLeadDemoField(update: SalesforceLeadFieldUpdate): SalesforceLeadFieldUpdateResult {
  const lead = mockLeads.find((candidate) => candidate.id === update.lead_id) ?? mockLeads[0];
  if (!lead) throw new Error("No mock Salesforce Lead found to update");

  const nextLead = {
    ...lead,
    demo_field: update.field,
    demo_note: update.value,
    last_modified: new Date().toISOString(),
  };
  const index = mockLeads.findIndex((candidate) => candidate.id === lead.id);
  mockLeads[index] = nextLead;
  return {
    lead: nextLead,
    field: update.field ?? DEFAULT_LEAD_DEMO_FIELD,
    value: update.value,
  };
}

const DEMO_SDR_NAME = "Steve";
const DEMO_MEETING_FIELDS = [
  "Id",
  "Name",
  "Company",
  "Email",
  "Phone",
  "MobilePhone",
  "Status",
  "LeadSource",
  "LastModifiedDate",
  "Shipment__c",
  "Requested_Meeting_Time__c",
  "Meeting_Time__c",
  "Meeting_Status__c",
  "Customer_Context__c",
  "SDR_Assigned__c",
  "SDR_Approval__c",
  "Customer_Approval__c",
];

/**
 * Create or update a Lead in Salesforce with the demo's custom meeting fields.
 * Spec steps 3-5: LangGraph sends lead data to Salesforce, Salesforce creates
 * the Lead ID and stores the lead fields.
 *
 * Looks up by email; if found, patches meeting fields. If not found, creates.
 */
export async function createOrUpdateLead(
  env: Env,
  input: LeadCreateInput,
): Promise<LeadCreateResult> {
  console.log("[salesforce] createOrUpdateLead START", { email: input.email, name: input.name, company: input.company });

  const config = await salesforceConfig(env);
  console.log("[salesforce] config resolved", { useMock: config.useMock, writeMode: config.writeMode, domain: config.domain });

  if (config.useMock) {
    console.log("[salesforce] using mock path");
    return mockCreateOrUpdateLead(input);
  }

  console.log("[salesforce] looking up existing Lead by email:", input.email);
  const existing = await lookupLeadByEmail(config, input.email);
  console.log("[salesforce] existing Lead lookup result", { found: !!existing, leadId: existing?.id });

  if (existing) {
    const patchBody: Record<string, string> = {};
    if (input.shipment) patchBody["Shipment__c"] = input.shipment;
    if (input.requested_meeting_time) patchBody["Requested_Meeting_Time__c"] = input.requested_meeting_time;
    if (input.customer_context) patchBody["Customer_Context__c"] = input.customer_context;
    if (input.meeting_status) patchBody["Meeting_Status__c"] = input.meeting_status;

    if (Object.keys(patchBody).length > 0) {
      console.log("[salesforce] PATCH existing Lead", { leadId: existing.id, fields: Object.keys(patchBody) });
      const res = await salesforceFetch(
        config,
        `/services/data/${config.apiVersion}/sobjects/Lead/${encodeURIComponent(existing.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        },
      );
      console.log("[salesforce] PATCH response", { status: res.status, ok: res.ok });
      if (!res.ok) {
        const errText = await safeResponseText(res);
        console.error("[salesforce] PATCH FAILED", { status: res.status, body: errText });
        throw new Error(`Salesforce lead update failed: ${res.status} - ${errText}`);
      }
    }

    console.log("[salesforce] re-fetching updated Lead", { leadId: existing.id });
    const refreshed = await lookupLeadByIdWithConfig(config, existing.id);
    console.log("[salesforce] createOrUpdateLead OK (updated)", { leadId: refreshed?.id, created: false });
    return { lead: refreshed ?? existing, created: false };
  }

  const createBody: Record<string, string> = {
    LastName: input.name || "CustomerAgent Demo",
    Company: input.company || "Telnyx",
    Email: input.email,
  };
  if (input.phone) createBody["Phone"] = input.phone;
  if (input.shipment) createBody["Shipment__c"] = input.shipment;
  if (input.requested_meeting_time) createBody["Requested_Meeting_Time__c"] = input.requested_meeting_time;
  if (input.customer_context) createBody["Customer_Context__c"] = input.customer_context;
  if (input.meeting_status) createBody["Meeting_Status__c"] = input.meeting_status;

  console.log("[salesforce] POST new Lead", { email: input.email, fields: Object.keys(createBody) });
  const res = await salesforceFetch(config, `/services/data/${config.apiVersion}/sobjects/Lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });
  console.log("[salesforce] POST response", { status: res.status, ok: res.ok });

  if (!res.ok) {
    const errText = await safeResponseText(res);
    console.error("[salesforce] POST FAILED", { status: res.status, body: errText });
    throw new Error(`Salesforce lead create failed: ${res.status} - ${errText}`);
  }

  const created = (await res.json()) as { id?: string };
  console.log("[salesforce] POST created Lead", { leadId: created.id });
  if (!created.id) throw new Error("Salesforce lead create response missing id");
  const lead = await lookupLeadByIdWithConfig(config, created.id);
  if (!lead) throw new Error("Salesforce Lead was created but could not be reloaded");
  console.log("[salesforce] createOrUpdateLead OK (created)", { leadId: lead.id, created: true });
  return { lead, created: true };
}

/**
 * Assign an SDR to a Lead. Spec step 6: Salesforce assigns the SDR.
 *
 * First pass: mock returns "Steve". Real path will use Salesforce assignment
 * rules, round-robin, or a custom Flow — but for the demo, we hardcode Steve
 * and write the assignment to the Lead's SDR_Assigned__c field.
 */
export async function assignSdr(
  env: Env,
  leadId: string,
): Promise<SdrAssignmentResult> {
  console.log("[salesforce] assignSdr START", { leadId });

  const config = await salesforceConfig(env);
  const assignedSdr = config.useMock ? DEMO_SDR_NAME : DEMO_SDR_NAME;
  console.log("[salesforce] assignSdr resolved SDR", { assignedSdr, useMock: config.useMock });

  if (!config.useMock) {
    console.log("[salesforce] PATCH Lead SDR_Assigned__c", { leadId, assignedSdr });
    const res = await salesforceFetch(
      config,
      `/services/data/${config.apiVersion}/sobjects/Lead/${encodeURIComponent(leadId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ SDR_Assigned__c: assignedSdr }),
      },
    );
    console.log("[salesforce] PATCH response", { status: res.status, ok: res.ok });
    if (!res.ok) {
      const errText = await safeResponseText(res);
      console.error("[salesforce] assignSdr PATCH FAILED", { status: res.status, body: errText });
      throw new Error(`Salesforce SDR assignment failed: ${res.status} - ${errText}`);
    }
  } else {
    const lead = mockLeads.find((l) => l.id === leadId) ?? mockLeads[0];
    if (lead) lead.assigned_sdr = assignedSdr;
    console.log("[salesforce] mock assignSdr updated in-memory lead", { leadId: lead?.id, assignedSdr });
  }

  console.log("[salesforce] assignSdr OK", { assignedSdr });
  return { assigned_sdr: assignedSdr };
}

/**
 * Check whether the assigned SDR is available at the requested meeting time.
 * Spec step 7: Salesforce checks Steve's calendar / availability.
 *
 * First pass: mock returns available:true. Real path will query Salesforce
 * Events, a calendar system, or an external scheduling API.
 */
export async function checkSdrAvailability(
  env: Env,
  sdrName: string,
  requestedTime: string,
): Promise<SdrAvailabilityResult> {
  console.log("[salesforce] checkSdrAvailability START", { sdrName, requestedTime });

  const config = await salesforceConfig(env);
  console.log("[salesforce] checkSdrAvailability config", { useMock: config.useMock });

  if (!config.useMock) {
    // Real path: query Salesforce Event object for the SDR at the requested time.
    // For the first pass, we return available:true — the real query would be:
    //   SELECT Id FROM Event WHERE Owner.Name = '{sdrName}' AND ActivityDateTime = {requestedTime}
    // For now, treat as always available to unblock the demo flow.
    console.log("[salesforce] real path: stubbed available=true (Event query not yet implemented)");
  } else {
    console.log("[salesforce] mock path: returning available=true");
  }

  const result = { available: true, sdr: sdrName, requested_time: requestedTime };
  console.log("[salesforce] checkSdrAvailability OK", result);
  return result;
}

/**
 * Update a Lead's meeting fields in Salesforce. Spec steps 11 and 25:
 * LangGraph sends Steve's confirmation (or Anusha's reschedule acceptance)
 * back to Salesforce, which updates the Lead record.
 */
export async function updateLeadMeeting(
  env: Env,
  input: LeadMeetingUpdateInput,
): Promise<LeadMeetingUpdateResult> {
  console.log("[salesforce] updateLeadMeeting START", { lead_id: input.lead_id, meeting_status: input.meeting_status, meeting_time: input.meeting_time });

  const config = await salesforceConfig(env);
  console.log("[salesforce] updateLeadMeeting config", { useMock: config.useMock });

  if (config.useMock) {
    console.log("[salesforce] using mock path");
    return mockUpdateLeadMeeting(input);
  }

  const patchBody: Record<string, string> = {};
  if (input.meeting_status) patchBody["Meeting_Status__c"] = input.meeting_status;
  if (input.meeting_time) patchBody["Meeting_Time__c"] = input.meeting_time;
  if (input.requested_meeting_time) patchBody["Requested_Meeting_Time__c"] = input.requested_meeting_time;
  if (input.assigned_sdr) patchBody["SDR_Assigned__c"] = input.assigned_sdr;
  if (input.sdr_confirmation) patchBody["SDR_Approval__c"] = input.sdr_confirmation;
  if (input.customer_confirmation) patchBody["Customer_Approval__c"] = input.customer_confirmation;
  if (input.customer_context) patchBody["Customer_Context__c"] = input.customer_context;
  if (input.shipment) patchBody["Shipment__c"] = input.shipment;

  const fieldsUpdated = Object.keys(patchBody);
  console.log("[salesforce] fields to update", { fields: fieldsUpdated });

  if (fieldsUpdated.length === 0) {
    console.log("[salesforce] no fields to update, fetching current Lead");
    const lead = await lookupLeadByIdWithConfig(config, input.lead_id);
    return { lead: lead ?? ({} as LeadRef), fields_updated: [] };
  }

  console.log("[salesforce] PATCH Lead meeting fields", { leadId: input.lead_id, fields: fieldsUpdated });
  const res = await salesforceFetch(
    config,
    `/services/data/${config.apiVersion}/sobjects/Lead/${encodeURIComponent(input.lead_id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    },
  );
  console.log("[salesforce] PATCH response", { status: res.status, ok: res.ok });

  if (!res.ok) {
    const errText = await safeResponseText(res);
    console.error("[salesforce] updateLeadMeeting PATCH FAILED", { status: res.status, body: errText });
    throw new Error(`Salesforce meeting update failed: ${res.status} - ${errText}`);
  }

  console.log("[salesforce] re-fetching updated Lead", { leadId: input.lead_id });
  const lead = await lookupLeadByIdWithConfig(config, input.lead_id);
  console.log("[salesforce] updateLeadMeeting OK", { leadId: lead?.id, fields_updated: fieldsUpdated });
  return { lead: lead ?? ({} as LeadRef), fields_updated: fieldsUpdated };
}

/**
 * Get a Lead's current meeting state from Salesforce. Spec step 18:
 * LangGraph compares previous vs current meeting time to detect a reschedule.
 *
 * Returns the current meeting fields plus previous_meeting_time, which the
 * caller (the actor) tracks in durable state and passes to this function's
 * caller for comparison.
 */
export async function getLeadCurrentMeeting(
  env: Env,
  leadId: string,
): Promise<LeadCurrentMeeting> {
  console.log("[salesforce] getLeadCurrentMeeting START", { leadId });

  const config = await salesforceConfig(env);
  console.log("[salesforce] getLeadCurrentMeeting config", { useMock: config.useMock });

  if (config.useMock) {
    console.log("[salesforce] using mock path");
    return mockGetLeadCurrentMeeting(leadId);
  }

  const fields = DEMO_MEETING_FIELDS.join(",");
  console.log("[salesforce] GET Lead meeting fields", { leadId, fieldCount: DEMO_MEETING_FIELDS.length });
  const res = await salesforceFetch(
    config,
    `/services/data/${config.apiVersion}/sobjects/Lead/${encodeURIComponent(leadId)}?fields=${fields}`,
  );
  console.log("[salesforce] GET response", { status: res.status, ok: res.ok });

  if (!res.ok) {
    const errText = await safeResponseText(res);
    console.error("[salesforce] getLeadCurrentMeeting GET FAILED", { status: res.status, body: errText });
    throw new Error(`Salesforce lead meeting lookup failed: ${res.status} - ${errText}`);
  }

  const row = (await res.json()) as Record<string, unknown>;
  const result = {
    lead_id: String(row["Id"] ?? leadId),
    meeting_time: row["Meeting_Time__c"] ? String(row["Meeting_Time__c"]) : null,
    meeting_status: row["Meeting_Status__c"] ? String(row["Meeting_Status__c"]) : null,
    assigned_sdr: row["SDR_Assigned__c"] ? String(row["SDR_Assigned__c"]) : null,
    requested_meeting_time: row["Requested_Meeting_Time__c"] ? String(row["Requested_Meeting_Time__c"]) : null,
    previous_meeting_time: null,
  };
  console.log("[salesforce] getLeadCurrentMeeting OK", {
    lead_id: result.lead_id,
    meeting_time: result.meeting_time,
    meeting_status: result.meeting_status,
    assigned_sdr: result.assigned_sdr,
  });
  return result;
}

async function lookupLeadByEmail(config: SalesforceConfig, email: string): Promise<LeadRef | null> {
  const soql = encodeURIComponent(
    `SELECT ${DEMO_MEETING_FIELDS.join(",")} FROM Lead WHERE Email = '${escapeSoql(email)}' AND IsConverted = false ORDER BY LastModifiedDate DESC LIMIT 1`,
  );
  const res = await salesforceFetch(config, `/services/data/${config.apiVersion}/query?q=${soql}`);
  if (!res.ok) throw new Error(`Salesforce lead email lookup failed: ${res.status} - ${await safeResponseText(res)}`);
  const data = (await res.json()) as { records?: Array<Record<string, unknown>> };
  const row = data.records?.[0];
  return row ? leadFromRow(row) : null;
}

function mockCreateOrUpdateLead(input: LeadCreateInput): LeadCreateResult {
  const existing = mockLeads.find((l) => l.email === input.email);
  if (existing) {
    const updated: LeadRef = {
      ...existing,
      shipment: input.shipment ?? existing.shipment,
      requested_meeting_time: input.requested_meeting_time ?? existing.requested_meeting_time,
      customer_context: input.customer_context ?? existing.customer_context,
      meeting_status: input.meeting_status ?? existing.meeting_status,
      last_modified: new Date().toISOString(),
    };
    const index = mockLeads.findIndex((l) => l.id === existing.id);
    mockLeads[index] = updated;
    return { lead: updated, created: false };
  }

  const newLead: LeadRef = {
    id: `00Q-mock-${Date.now()}`,
    name: input.name || "CustomerAgent Demo",
    company: input.company || "Telnyx",
    email: input.email,
    phone: input.phone,
    status: "New",
    lead_source: "Demo",
    last_modified: new Date().toISOString(),
    shipment: input.shipment,
    requested_meeting_time: input.requested_meeting_time,
    meeting_time: null,
    meeting_status: input.meeting_status || "Requested",
    customer_context: input.customer_context,
    assigned_sdr: undefined,
    sdr_confirmation: undefined,
    customer_confirmation: undefined,
    previous_meeting_time: null,
  };
  mockLeads.push(newLead);
  return { lead: newLead, created: true };
}

function mockUpdateLeadMeeting(input: LeadMeetingUpdateInput): LeadMeetingUpdateResult {
  const lead = mockLeads.find((l) => l.id === input.lead_id) ?? mockLeads[0];
  if (!lead) throw new Error("No mock Salesforce Lead found to update meeting");

  const fieldsUpdated: string[] = [];
  const previousMeetingTime = lead.meeting_time;

  const updated: LeadRef = { ...lead };
  if (input.meeting_status) { updated.meeting_status = input.meeting_status; fieldsUpdated.push("Meeting_Status__c"); }
  if (input.meeting_time) { updated.meeting_time = input.meeting_time; fieldsUpdated.push("Meeting_Time__c"); }
  if (input.requested_meeting_time) { updated.requested_meeting_time = input.requested_meeting_time; fieldsUpdated.push("Requested_Meeting_Time__c"); }
  if (input.assigned_sdr) { updated.assigned_sdr = input.assigned_sdr; fieldsUpdated.push("SDR_Assigned__c"); }
  if (input.sdr_confirmation) { updated.sdr_confirmation = input.sdr_confirmation; fieldsUpdated.push("SDR_Approval__c"); }
  if (input.customer_confirmation) { updated.customer_confirmation = input.customer_confirmation; fieldsUpdated.push("Customer_Approval__c"); }
  if (input.customer_context) { updated.customer_context = input.customer_context; fieldsUpdated.push("Customer_Context__c"); }
  if (input.shipment) { updated.shipment = input.shipment; fieldsUpdated.push("Shipment__c"); }
  updated.previous_meeting_time = previousMeetingTime;
  updated.last_modified = new Date().toISOString();

  const index = mockLeads.findIndex((l) => l.id === lead.id);
  mockLeads[index] = updated;
  return { lead: updated, fields_updated: fieldsUpdated };
}

function mockGetLeadCurrentMeeting(leadId: string): LeadCurrentMeeting {
  const lead = mockLeads.find((l) => l.id === leadId) ?? mockLeads[0];
  if (!lead) {
    return {
      lead_id: leadId,
      meeting_time: null,
      meeting_status: null,
      assigned_sdr: null,
      requested_meeting_time: null,
      previous_meeting_time: null,
    };
  }
  return {
    lead_id: lead.id,
    meeting_time: lead.meeting_time ?? null,
    meeting_status: lead.meeting_status ?? null,
    assigned_sdr: lead.assigned_sdr ?? null,
    requested_meeting_time: lead.requested_meeting_time ?? null,
    previous_meeting_time: lead.previous_meeting_time ?? null,
  };
}
