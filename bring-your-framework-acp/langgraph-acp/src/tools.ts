import { tool } from "@langchain/core/tools";
import { z } from "zod";

export interface OrderResult {
  orderId: string;
  status: "shipped" | "processing" | "delivered" | "not_found";
  eta: string;
  carrier: string;
}

export interface CustomerProfile {
  phone: string;
  name: string;
  orders: string[];
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

export function customerForPhone(
  phone: string | undefined,
  configuredPhone: string | undefined,
  configuredName = "Demo customer",
): CustomerProfile | null {
  if (!phone || !configuredPhone) return null;
  if (normalizePhone(phone) !== normalizePhone(configuredPhone)) return null;
  return {
    phone: normalizePhone(configuredPhone),
    name: configuredName,
    orders: ["ORD-10042", "ORD-10043"],
  };
}

const ORDERS: Record<string, OrderResult> = {
  "ORD-10042": {
    orderId: "ORD-10042",
    status: "shipped",
    eta: "Friday",
    carrier: "Telnyx Logistics",
  },
  "ORD-10043": {
    orderId: "ORD-10043",
    status: "processing",
    eta: "Monday",
    carrier: "Telnyx Logistics",
  },
};

export function lookupOrder(orderId: string): OrderResult {
  const normalized = orderId.trim().toUpperCase();
  console.log(JSON.stringify({ framework_event: "tool_call", tool: "lookup_order", orderId: normalized }));
  return ORDERS[normalized] ?? {
    orderId: normalized,
    status: "not_found",
    eta: "unknown",
    carrier: "unknown",
  };
}

export function extractOrderId(text: string): string | null {
  const match = text.match(/ORD[-\s]?\d{3,}/i);
  return match ? match[0].replace(/\s/g, "-").toUpperCase() : null;
}

export const lookupOrderTool = tool(
  async ({ orderId }) => {
    const result = lookupOrder(orderId);
    console.log(JSON.stringify({ framework_event: "tool_result", tool: "lookup_order", result }));
    return JSON.stringify(result);
  },
  {
    name: "lookup_order",
    description: "Look up a demo order by its order ID.",
    schema: z.object({ orderId: z.string().describe("The order ID, for example ORD-10042") }),
  },
);
