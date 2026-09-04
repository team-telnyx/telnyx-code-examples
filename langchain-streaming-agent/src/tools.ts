import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Two deterministic demo tools for the LangChain agent. Both are pure reads —
 * no network, no side effects — so the sample runs identically locally and on
 * the edge, and tests stay hermetic.
 */

const ORDERS: Record<string, { status: string; eta: string; carrier: string; items: string[] }> = {
  "ORD-1042": {
    status: "in transit",
    eta: "2026-09-03 by 8pm",
    carrier: "Telnyx Logistics / Ground",
    items: ["wireless headset x1", "usb-c dock x1"],
  },
  "ORD-1043": {
    status: "delivered",
    eta: "delivered 2026-08-29, 2:14pm — signed by R. ALVAREZ",
    carrier: "Telnyx Logistics / Express",
    items: ["laptop stand x2"],
  },
  "ORD-1051": {
    status: "label created",
    eta: "expected to ship 2026-09-02",
    carrier: "unassigned",
    items: ["webcam x1"],
  },
};

export const lookupOrder = tool(
  ({ order_id }: { order_id: string }) => {
    const order = ORDERS[order_id.toUpperCase()];
    if (!order) {
      return `No order found for ${order_id}. Ask the customer to double-check the ID (format: ORD-####).`;
    }
    return (
      `Order ${order_id.toUpperCase()}: status=${order.status}; ETA=${order.eta}; ` +
      `carrier=${order.carrier}; items=${order.items.join(", ")}.`
    );
  },
  {
    name: "lookup_order",
    description:
      "Look up the current shipping status, ETA, carrier, and items of a customer order by its ID (format ORD-####). Use this whenever the customer asks where their order is.",
    schema: z.object({
      order_id: z.string().describe("Customer order id, e.g. ORD-1042"),
    }),
  },
);

const POLICY: Record<string, string> = {
  returns:
    "Returns are free within 30 days of delivery. Refunds land 3-5 business days after the item scans at any Telnyx Logistics depot.",
  warranty:
    "Hardware carries a 12-month limited warranty. Faulty units are replaced, not repaired, within 7 business days.",
  shipping:
    "Ground ships in 2-4 business days, Express next-day. Orders placed after 3pm ET ship the following business day.",
  damaged:
    "For items damaged in transit: reply with a photo, keep the packaging, and a prepaid return label is issued within 24h.",
};

export const getReturnPolicy = tool(
  ({ topic }: { topic: "returns" | "warranty" | "shipping" | "damaged" }) => {
    return POLICY[topic] ?? "No policy section found for that topic.";
  },
  {
    name: "get_return_policy",
    description:
      "Retrieve the official policy text for a topic: returns, warranty, shipping, or damaged-in-transit. Use this instead of improvising policy answers.",
    schema: z.object({
      topic: z
        .enum(["returns", "warranty", "shipping", "damaged"])
        .describe("Which policy section to retrieve"),
    }),
  },
);

export const supportTools = [lookupOrder, getReturnPolicy];
