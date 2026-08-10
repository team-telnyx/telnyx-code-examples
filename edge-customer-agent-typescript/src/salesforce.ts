/**
 * Salesforce REST client — mockable with a clean extension seam.
 *
 * In production, replace USE_MOCK_SALESFORCE=false and provide real
 * Salesforce credentials. The interface is production-shaped so the
 * actor code doesn't change when you swap mock for real.
 */

import type { ShipmentRecord } from "./state";

export interface SalesforceCustomer {
  id: string;
  name: string;
  phone: string;
  email: string;
  account_type: string;
}

export interface SalesforceShipmentUpdate {
  salesforce_id: string;
  status: string;
  tracking_number?: string;
  estimated_delivery?: string;
}

export class SalesforceClient {
  private readonly mock: boolean;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly token?: string;
  private instanceUrl: string | null = null;
  private accessToken: string | null = null;

  constructor(opts: {
    useMock: boolean;
    clientId?: string;
    clientSecret?: string;
    username?: string;
    password?: string;
    token?: string;
  }) {
    this.mock = opts.useMock;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.username = opts.username;
    this.password = opts.password;
    this.token = opts.token;
  }

  async getCustomer(salesforceId: string): Promise<SalesforceCustomer | null> {
    if (this.mock) return mockGetCustomer(salesforceId);
    await this.ensureAuth();
    const res = await fetch(`${this.instanceUrl}/services/data/v58.0/sobjects/Account/${salesforceId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return {
      id: String(data["Id"] ?? ""),
      name: String(data["Name"] ?? ""),
      phone: String(data["Phone"] ?? ""),
      email: String(data["PersonEmail"] ?? ""),
      account_type: String(data["Type"] ?? "Customer"),
    };
  }

  async getShipments(salesforceId: string): Promise<ShipmentRecord[]> {
    if (this.mock) return mockGetShipments(salesforceId);
    await this.ensureAuth();
    const query = encodeURIComponent(
      `SELECT Id, Status__c, Tracking_Number__c, Estimated_Delivery__c, LastModifiedDate FROM Shipment__c WHERE Customer__c = '${salesforceId}'`,
    );
    const res = await fetch(`${this.instanceUrl}/services/data/v58.0/query?q=${query}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { records?: Array<Record<string, unknown>> };
    return (data.records ?? []).map((r) => ({
      salesforce_id: String(r["Id"] ?? ""),
      status: String(r["Status__c"] ?? "unknown"),
      last_updated: String(r["LastModifiedDate"] ?? new Date().toISOString()),
      tracking_number: r["Tracking_Number__c"] ? String(r["Tracking_Number__c"]) : undefined,
      estimated_delivery: r["Estimated_Delivery__c"] ? String(r["Estimated_Delivery__c"]) : undefined,
    }));
  }

  async updateShipmentStatus(update: SalesforceShipmentUpdate): Promise<void> {
    if (this.mock) {
      mockUpdateShipment(update);
      return;
    }
    await this.ensureAuth();
    await fetch(`${this.instanceUrl}/services/data/v58.0/sobjects/Shipment__c/${update.salesforce_id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Status__c: update.status,
        Tracking_Number__c: update.tracking_number,
        Estimated_Delivery__c: update.estimated_delivery,
      }),
    });
  }

  private async ensureAuth(): Promise<void> {
    if (this.accessToken && this.instanceUrl) return;
    if (!this.clientId || !this.clientSecret || !this.username || !this.password || !this.token) {
      throw new Error("Salesforce credentials not configured");
    }
    const res = await fetch("https://login.salesforce.com/services/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        username: this.username,
        password: this.password,
        security_token: this.token,
      }),
    });
    if (!res.ok) throw new Error(`Salesforce auth failed: ${res.status}`);
    const data = (await res.json()) as { access_token?: string; instance_url?: string };
    this.accessToken = data.access_token ?? null;
    this.instanceUrl = data.instance_url ?? null;
  }
}

// ── Mock implementation (deterministic, in-memory) ──────────────────────

const mockCustomers: Map<string, SalesforceCustomer> = new Map([
  ["001", { id: "001", name: "Ian Reither", phone: "+13125550100", email: "ian@example.com", account_type: "Enterprise" }],
]);

const mockShipments: Map<string, ShipmentRecord[]> = new Map([
  ["001", [{ salesforce_id: "SHP-001", status: "in_transit", last_updated: new Date().toISOString(), tracking_number: "1Z999AA10123456784", estimated_delivery: "2026-08-13" }]],
]);

function mockGetCustomer(id: string): SalesforceCustomer | null {
  return mockCustomers.get(id) ?? null;
}

function mockGetShipments(salesforceId: string): ShipmentRecord[] {
  return mockShipments.get(salesforceId) ?? [];
}

function mockUpdateShipment(update: SalesforceShipmentUpdate): void {
  for (const [customerId, shipments] of mockShipments) {
    const idx = shipments.findIndex((s) => s.salesforce_id === update.salesforce_id);
    if (idx >= 0) {
      shipments[idx] = {
        ...shipments[idx]!,
        status: update.status,
        tracking_number: update.tracking_number ?? shipments[idx]!.tracking_number,
        estimated_delivery: update.estimated_delivery ?? shipments[idx]!.estimated_delivery,
        last_updated: new Date().toISOString(),
      };
      mockShipments.set(customerId, shipments);
      return;
    }
  }
}
