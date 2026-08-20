import { describe, it, expect, vi, afterEach } from "vitest";
import {
  lookupLatestLead,
  lookupShipment,
  resetSalesforceAuthCache,
  updateLeadDemoField,
  updateShipmentStatus,
  createOrUpdateLead,
  assignSdr,
  checkSdrAvailability,
  updateLeadMeeting,
  getLeadCurrentMeeting,
} from "../src/salesforce.js";
import type { Env } from "../src/types.js";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    USE_MOCK_SALESFORCE: "true",
    ...overrides,
  } as Env;
}

describe("Salesforce tool", () => {
  afterEach(() => {
    resetSalesforceAuthCache();
    vi.unstubAllGlobals();
  });

  it("looks up mock shipment data by order ID", async () => {
    const shipment = await lookupShipment(makeEnv(), "ord-10042");

    expect(shipment).toMatchObject({
      id: "ORD-10042",
      status: "shipped",
      eta: "Friday",
      carrier: "Telnyx Logistics",
      salesforce_id: "SHP-001",
    });
  });

  it("updates mock shipment status locally", async () => {
    await updateShipmentStatus(makeEnv(), {
      salesforce_id: "SHP-002",
      status: "delayed",
      estimated_delivery: "Wednesday",
    });

    const shipment = await lookupShipment(makeEnv(), "ORD-10043");
    expect(shipment.status).toBe("delayed");
    expect(shipment.eta).toBe("Wednesday");
  });

  it("updates the mock latest Lead demo field locally", async () => {
    const result = await updateLeadDemoField(makeEnv(), {
      value: "CustomerAgent demo update",
    });
    const lead = await lookupLatestLead(makeEnv());

    expect(result.lead.id).toBe("00Q-demo-latest");
    expect(result.field).toBe("reMQL_Source_Detail__c");
    expect(result.value).toBe("CustomerAgent demo update");
    expect(lead?.demo_note).toBe("CustomerAgent demo update");
  });

  it("uses Salesforce client-credentials OAuth when mock mode is disabled", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const asString = String(url);
      if (asString.includes("/services/oauth2/token")) {
        return new Response(JSON.stringify({
          access_token: "token-123",
          instance_url: "https://example.my.salesforce.com",
        }), { status: 200 });
      }
      expect(init?.headers).toMatchObject({ Authorization: "Bearer token-123" });
      return new Response(JSON.stringify({
        records: [{
          Id: "a01",
          Name: "ORD-55555",
          Status__c: "processing",
          Carrier__c: "Telnyx Logistics",
          Estimated_Delivery__c: "Tuesday",
        }],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const shipment = await lookupShipment(makeEnv({
      USE_MOCK_SALESFORCE: "false",
      SF_CLIENT_ID: "client-id",
      SF_CLIENT_SECRET: "client-secret",
      SF_DOMAIN: "test",
    }), "ORD-55555");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://test.salesforce.com/services/oauth2/token");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/services/data/v58.0/query?q=");
    expect(shipment).toMatchObject({
      id: "ORD-55555",
      status: "processing",
      eta: "Tuesday",
      salesforce_id: "a01",
    });
  });

  it("forces reauthentication and retries once when Salesforce rejects the cached session", async () => {
    let queryCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const asString = String(url);
      if (asString.includes("/services/oauth2/token")) {
        return new Response(JSON.stringify({
          access_token: `token-${fetchMock.mock.calls.length}`,
          instance_url: "https://example.my.salesforce.com",
        }), { status: 200 });
      }

      queryCalls++;
      if (queryCalls === 1) return new Response("Session expired", { status: 401 });
      expect(init?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Bearer token-/) });
      return new Response(JSON.stringify({
        records: [{
          Id: "a02",
          Name: "ORD-77777",
          Status__c: "shipped",
          Carrier__c: "Telnyx Logistics",
          Estimated_Delivery__c: "Friday",
        }],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const shipment = await lookupShipment(makeEnv({
      USE_MOCK_SALESFORCE: "false",
      SF_CLIENT_ID: "client-id",
      SF_CLIENT_SECRET: "client-secret",
      SF_DOMAIN: "login",
    }), "ORD-77777");

    const authCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/services/oauth2/token"));
    expect(authCalls).toHaveLength(2);
    expect(queryCalls).toBe(2);
    expect(shipment.status).toBe("shipped");
  });

  it("keeps Lead writes mocked unless SF_WRITE_MODE=demo_record", async () => {
    const result = await updateLeadDemoField(makeEnv({
      USE_MOCK_SALESFORCE: "false",
      SF_CLIENT_ID: "client-id",
      SF_CLIENT_SECRET: "client-secret",
      SF_DOMAIN: "login",
    }), {
      lead_id: "00Q123",
      value: "Updated from CustomerAgent",
    });

    expect(result.lead.id).toBe("00Q-demo-latest");
    expect(result.value).toBe("Updated from CustomerAgent");
  });

  it("patches only the dedicated Salesforce demo Lead when SF_WRITE_MODE=demo_record", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const asString = String(url);
      if (asString.includes("/services/oauth2/token")) {
        return new Response(JSON.stringify({
          access_token: "token-123",
          instance_url: "https://example.my.salesforce.com",
        }), { status: 200 });
      }
      if (asString.includes("/query?q=")) {
        return new Response(JSON.stringify({
          records: [{
            Id: "00QDEMO",
            Name: "CustomerAgent Demo",
            Company: "Telnyx CustomerAgent Demo",
            Email: "customeragent-demo@example.com",
            Status: "Known",
          }],
        }), { status: 200 });
      }
      if (asString.includes("/sobjects/Lead/00QDEMO?fields=")) {
        return new Response(JSON.stringify({
          Id: "00QDEMO",
          Name: "CustomerAgent Demo",
          Company: "Telnyx CustomerAgent Demo",
          Email: "customeragent-demo@example.com",
          Status: "Known",
          LeadSource: "Demo",
        }), { status: 200 });
      }

      expect(asString).toBe("https://example.my.salesforce.com/services/data/v58.0/sobjects/Lead/00QDEMO");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({
        reMQL_Source_Detail__c: "Updated from CustomerAgent",
      });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateLeadDemoField(makeEnv({
      USE_MOCK_SALESFORCE: "false",
      SF_WRITE_MODE: "demo_record",
      SF_CLIENT_ID: "client-id",
      SF_CLIENT_SECRET: "client-secret",
      SF_DOMAIN: "login",
    }), {
      lead_id: "00Q123",
      value: "Updated from CustomerAgent",
    });

    expect(result.lead.id).toBe("00QDEMO");
    expect(result.field).toBe("reMQL_Source_Detail__c");
    expect(result.value).toBe("Updated from CustomerAgent");
  });
});

describe("createOrUpdateLead (mock)", () => {
  afterEach(() => {
    resetSalesforceAuthCache();
    vi.unstubAllGlobals();
  });

  it("creates a new Lead when email does not match an existing mock Lead", async () => {
    const env = makeEnv();
    const result = await createOrUpdateLead(env, {
      email: "new-customer@example.com",
      name: "New Customer",
      company: "Acme",
      shipment: "Telnyx",
      requested_meeting_time: "Tuesday at 2 PM",
      customer_context: "Onboarding",
      meeting_status: "Requested",
    });

    expect(result.created).toBe(true);
    expect(result.lead.email).toBe("new-customer@example.com");
    expect(result.lead.shipment).toBe("Telnyx");
    expect(result.lead.requested_meeting_time).toBe("Tuesday at 2 PM");
    expect(result.lead.meeting_status).toBe("Requested");
    expect(result.lead.customer_context).toBe("Onboarding");
    expect(result.lead.id).toMatch(/^00Q-mock-/);
  });

  it("updates an existing Lead when email matches", async () => {
    const env = makeEnv();
    const result = await createOrUpdateLead(env, {
      email: "anusha@example.com",
      shipment: "Telnyx Updated",
      customer_context: "Updated context",
    });

    expect(result.created).toBe(false);
    expect(result.lead.email).toBe("anusha@example.com");
    expect(result.lead.shipment).toBe("Telnyx Updated");
    expect(result.lead.customer_context).toBe("Updated context");
  });
});

describe("assignSdr (mock)", () => {
  afterEach(() => {
    resetSalesforceAuthCache();
    vi.unstubAllGlobals();
  });

  it("returns Steve as the assigned SDR", async () => {
    const result = await assignSdr(makeEnv(), "00Q-demo-latest");
    expect(result.assigned_sdr).toBe("Steve");
  });
});

describe("checkSdrAvailability (mock)", () => {
  afterEach(() => {
    resetSalesforceAuthCache();
    vi.unstubAllGlobals();
  });

  it("returns available:true for the requested time", async () => {
    const result = await checkSdrAvailability(makeEnv(), "Steve", "Tuesday at 2 PM");
    expect(result.available).toBe(true);
    expect(result.sdr).toBe("Steve");
    expect(result.requested_time).toBe("Tuesday at 2 PM");
  });
});

describe("updateLeadMeeting (mock)", () => {
  afterEach(() => {
    resetSalesforceAuthCache();
    vi.unstubAllGlobals();
  });

  it("updates meeting fields and tracks previous_meeting_time", async () => {
    const env = makeEnv();

    // First set a meeting time on the mock lead
    await updateLeadMeeting(env, {
      lead_id: "00Q-demo-latest",
      meeting_time: "Tuesday at 2 PM",
      meeting_status: "Confirmed",
      assigned_sdr: "Steve",
      sdr_confirmation: "Yes",
    });

    // Now reschedule — previous_meeting_time should be tracked
    const result = await updateLeadMeeting(env, {
      lead_id: "00Q-demo-latest",
      meeting_time: "Thursday at 11 AM",
      meeting_status: "Rescheduled",
    });

    expect(result.lead.meeting_time).toBe("Thursday at 11 AM");
    expect(result.lead.meeting_status).toBe("Rescheduled");
    expect(result.lead.previous_meeting_time).toBe("Tuesday at 2 PM");
    expect(result.fields_updated).toContain("Meeting_Time__c");
    expect(result.fields_updated).toContain("Meeting_Status__c");
  });

  it("updates sdr_confirmation and customer_confirmation fields", async () => {
    const result = await updateLeadMeeting(makeEnv(), {
      lead_id: "00Q-demo-latest",
      sdr_confirmation: "Yes",
      customer_confirmation: "Confirmed",
    });

    expect(result.lead.sdr_confirmation).toBe("Yes");
    expect(result.lead.customer_confirmation).toBe("Confirmed");
    expect(result.fields_updated).toContain("SDR_Confirmation__c");
    expect(result.fields_updated).toContain("Customer_Confirmation__c");
  });

  it("returns empty fields_updated when no fields are passed", async () => {
    const result = await updateLeadMeeting(makeEnv(), {
      lead_id: "00Q-demo-latest",
    });

    expect(result.fields_updated).toEqual([]);
  });
});

describe("getLeadCurrentMeeting (mock)", () => {
  afterEach(() => {
    resetSalesforceAuthCache();
    vi.unstubAllGlobals();
  });

  it("returns the current meeting state from the mock Lead", async () => {
    const env = makeEnv();

    // Set a known meeting state
    await updateLeadMeeting(env, {
      lead_id: "00Q-demo-latest",
      meeting_time: "Tuesday at 2 PM",
      meeting_status: "Confirmed",
      assigned_sdr: "Steve",
    });

    const result = await getLeadCurrentMeeting(env, "00Q-demo-latest");

    expect(result.lead_id).toBe("00Q-demo-latest");
    expect(result.meeting_time).toBe("Tuesday at 2 PM");
    expect(result.meeting_status).toBe("Confirmed");
    expect(result.assigned_sdr).toBe("Steve");
  });

  it("falls back to the first mock Lead when the ID is not found", async () => {
    const result = await getLeadCurrentMeeting(makeEnv(), "00Q-nonexistent");
    // mockGetLeadCurrentMeeting falls back to mockLeads[0] when the ID is not found
    expect(result).toBeDefined();
    expect(typeof result.lead_id).toBe("string");
  });
});
