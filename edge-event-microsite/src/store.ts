import type { EventData } from "./types";

/**
 * Telnyx KV is the single source of truth ("never drift" guarantee):
 *
 *   event/data          → the event JSON the site renders and every agent reads
 *   attendee/<phone>    → opted-in attendees for broadcasts
 *   lead/<id>           → qualified exhibitor leads
 *   feedback/<id>       → transcribed + summarized post-event feedback
 *   assistant/id        → the AI assistant provisioned for browser voice
 */

export const EVENT_KEY = "event/data";
export const ASSISTANT_KEY = "assistant/id";

export const SAMPLE_EVENT: EventData = {
  event: {
    name: "TechForward Summit 2026",
    date: "2026-10-15",
    location: "San Francisco Convention Center",
    description:
      "Two days of talks, workshops, and networking with the people building what's next.",
  },
  schedule: [
    {
      id: "s1",
      time: "09:00",
      title: "Opening Keynote: The Real-Time Decade",
      speaker: "Jane Doe",
      room: "Main Hall",
    },
    {
      id: "s2",
      time: "10:30",
      title: "AI Agents in Production",
      speaker: "John Smith",
      room: "Room A",
    },
    {
      id: "s3",
      time: "14:00",
      title: "Networking Break",
      speaker: "",
      room: "Lobby",
    },
    {
      id: "s4",
      time: "15:30",
      title: "Closing Panel: What Ships in 2027",
      speaker: "Panelists",
      room: "Main Hall",
    },
  ],
  speakers: [
    {
      id: "sp1",
      name: "Jane Doe",
      title: "CEO, TechCorp",
      bio: "Visionary leader in real-time communications.",
      photo: "https://via.placeholder.com/150",
    },
    {
      id: "sp2",
      name: "John Smith",
      title: "CTO, InnovateX",
      bio: "Architect of large-scale agent platforms.",
      photo: "https://via.placeholder.com/150",
    },
  ],
  venue: {
    address: "747 Howard St, San Francisco, CA 94103",
    map_url: "https://maps.google.com/?q=San+Francisco+Convention+Center",
    wifi: "SSID: TechForward-Guest | Password: summit2026",
    parking: "Valet at the main entrance. $25/day.",
  },
  sponsors: [
    { id: "spon1", name: "Telnyx", tier: "Platinum", logo: "https://via.placeholder.com/100" },
    { id: "spon2", name: "InnovateX", tier: "Gold", logo: "https://via.placeholder.com/100" },
    { id: "spon3", name: "Stripe", tier: "Silver", logo: "https://via.placeholder.com/100" },
  ],
};

type Kv = {
  get(key: string): Promise<string | null>;
  get<T>(key: string, options: { type: "json" }): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
};

/** Fetch the event data, seeding the namespace with sample data on first run. */
export async function getEvent(kv: Kv): Promise<EventData> {
  const existing = await kv.get<EventData>(EVENT_KEY, { type: "json" });
  if (existing && existing.event) return existing;
  await kv.put(EVENT_KEY, JSON.stringify(SAMPLE_EVENT));
  return SAMPLE_EVENT;
}

export async function putEvent(kv: Kv, data: EventData): Promise<void> {
  await kv.put(EVENT_KEY, JSON.stringify(data));
}

// KV keys allow only a-z A-Z 0-9 - _ / = . — encode "+" in phone numbers as "=".
function phoneKey(phone: string): string {
  return `attendee/${phone.replace(/\+/g, "=")}`;
}

function phoneFromKey(key: string): string {
  return key.slice("attendee/".length).replace(/=/g, "+");
}

export async function listAttendees(kv: Kv): Promise<string[]> {
  const page = await kv.list({ prefix: "attendee/" });
  const phones: string[] = [];
  for (const k of page.keys) {
    const rec = await kv.get<{ opted_in: boolean }>(k.name, { type: "json" });
    if (rec?.opted_in) phones.push(phoneFromKey(k.name));
  }
  return phones;
}

export async function upsertAttendee(
  kv: Kv,
  phone: string,
  source: string,
): Promise<void> {
  const key = phoneKey(phone);
  const existing = await kv.get<{ source: string; created_at: string }>(key, {
    type: "json",
  });
  await kv.put(
    key,
    JSON.stringify({
      phone_number: phone,
      opted_in: true,
      source: existing?.source ?? source,
      created_at: existing?.created_at ?? new Date().toISOString(),
    }),
  );
}

export async function listRecords<T>(
  kv: Kv,
  prefix: string,
): Promise<T[]> {
  const page = await kv.list({ prefix });
  const out: T[] = [];
  for (const k of page.keys) {
    const rec = await kv.get<T>(k.name, { type: "json" });
    if (rec) out.push(rec);
  }
  return out;
}
