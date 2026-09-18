import type { Env, Inquiry, SiteVisit } from "./types";
import { id, todayISO, addDaysISO } from "./types";

/**
 * SQLDB layer — the shared venue database ([storage.sqldb.AVAILABILITY_DB]):
 *
 *   availability  → live date availability the concierge quotes from
 *   inquiries     → every planner interaction, with qualification flag
 *   site_visits   → booked tours (the conversion the sales team cares about)
 *
 * All statements are parameterized — no string interpolation into SQL.
 */

type Db = Env["AVAILABILITY_DB"];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS availability (
  date TEXT PRIMARY KEY,
  available INTEGER NOT NULL DEFAULT 1,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  event_type TEXT DEFAULT '',
  guests INTEGER,
  budget TEXT DEFAULT '',
  dates TEXT DEFAULT '',
  message TEXT DEFAULT '',
  channel TEXT DEFAULT 'sms',
  qualified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inquiries_phone ON inquiries(phone);
CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at);
CREATE TABLE IF NOT EXISTS site_visits (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  visit_date TEXT,
  status TEXT DEFAULT 'booked',
  source TEXT DEFAULT 'concierge',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visits_phone ON site_visits(phone);
`;

/** Deterministic per-date seed: ~85% of the next 90 days are available. */
export function seededAvailable(dateISO: string): boolean {
  let h = 0;
  for (let i = 0; i < dateISO.length; i++) {
    h = (h * 31 + dateISO.charCodeAt(i)) >>> 0;
  }
  return h % 100 < 85;
}

export async function ensureSchema(db: Db): Promise<void> {
  await db.exec(SCHEMA_SQL);
}

/** Seed the next 90 days of availability if the table is empty. */
export async function seedAvailability(db: Db): Promise<void> {
  const existing = await db
    .prepare("SELECT COUNT(*) AS n FROM availability")
    .first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return;

  const stmt = db.prepare(
    "INSERT OR IGNORE INTO availability(date, available, note) VALUES (?, ?, ?)",
  );
  const rows: Array<{ date: string; available: number; note: string }> = [];
  for (let i = 1; i <= 90; i++) {
    const date = addDaysISO(i);
    const avail = seededAvailable(date) ? 1 : 0;
    const note = avail ? "" : "reserved (seasonal hold)";
    rows.push({ date, available: avail, note });
    await stmt.bind(date, avail, note).run();
  }
  void rows;
}

export interface AvailabilityDay {
  date: string;
  available: boolean;
  note: string;
}

export async function getAvailability(
  db: Db,
  start: string,
  end: string,
): Promise<AvailabilityDay[]> {
  const res = await db
    .prepare(
      "SELECT date, available, note FROM availability WHERE date >= ? AND date <= ? ORDER BY date",
    )
    .bind(start, end)
    .all<{ date: string; available: number; note: string }>();
  return res.results.map((r) => ({
    date: r.date,
    available: r.available === 1,
    note: r.note ?? "",
  }));
}

/** Human summary the concierge speaks/quotes: "42 of 60 dates available…". */
export async function availabilitySummary(
  db: Db,
  start: string,
  end: string,
): Promise<string> {
  const days = await getAvailability(db, start, end);
  if (days.length === 0) return "No availability data for that window yet.";
  const open = days.filter((d) => d.available);
  if (open.length === 0) {
    return `All ${days.length} dates between ${start} and ${end} are currently reserved.`;
  }
  const first = open
    .slice(0, 5)
    .map((d) => d.date)
    .join(", ");
  return `${open.length} of ${days.length} dates between ${start} and ${end} are available. Earliest openings: ${first}.`;
}

export async function recordInquiry(
  db: Db,
  inquiry: Pick<
    Inquiry,
    "phone" | "name" | "email" | "event_type" | "guests" | "budget" | "dates" | "message" | "channel"
  > & { qualified: boolean },
): Promise<string> {
  const rowId = id("inq");
  await db
    .prepare(
      `INSERT INTO inquiries
         (id, phone, name, email, event_type, guests, budget, dates, message, channel, qualified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      rowId,
      inquiry.phone,
      inquiry.name ?? "",
      inquiry.email ?? "",
      inquiry.event_type ?? "",
      inquiry.guests ?? null,
      inquiry.budget ?? "",
      inquiry.dates ?? "",
      inquiry.message ?? "",
      inquiry.channel,
      inquiry.qualified ? 1 : 0,
      Date.now(),
    )
    .run();
  return rowId;
}

export async function setQualified(db: Db, phone: string, qualified: boolean): Promise<void> {
  await db
    .prepare("UPDATE inquiries SET qualified = ? WHERE phone = ?")
    .bind(qualified ? 1 : 0, phone)
    .run();
}

/** The planner's most recent inquiry row (the ingest path enriches it). */
export async function latestInquiryForPhone(db: Db, phone: string): Promise<Inquiry | null> {
  return (
    (await db
      .prepare("SELECT * FROM inquiries WHERE phone = ? ORDER BY created_at DESC LIMIT 1")
      .bind(phone)
      .first<Inquiry>()) ?? null
  );
}

/** Enrich the planner's latest inquiry row with captured details. */
export async function updateInquiryDetails(
  db: Db,
  phone: string,
  patch: Partial<Pick<Inquiry, "name" | "email" | "event_type" | "guests" | "budget" | "dates" | "qualified">>,
): Promise<void> {
  const sets: string[] = [];
  const values: Array<string | number> = [];
  if (patch.name) { sets.push("name = ?"); values.push(patch.name); }
  if (patch.email) { sets.push("email = ?"); values.push(patch.email); }
  if (patch.event_type) { sets.push("event_type = ?"); values.push(patch.event_type); }
  if (patch.guests != null) { sets.push("guests = ?"); values.push(patch.guests); }
  if (patch.budget) { sets.push("budget = ?"); values.push(patch.budget); }
  if (patch.dates) { sets.push("dates = ?"); values.push(patch.dates); }
  if (patch.qualified != null) { sets.push("qualified = ?"); values.push(patch.qualified ? 1 : 0); }
  if (sets.length === 0) return;
  values.push(phone);
  await db
    .prepare(`UPDATE inquiries SET ${sets.join(", ")} WHERE phone = ?`)
    .bind(...values)
    .run();
}

export async function bookSiteVisit(
  db: Db,
  visit: Omit<SiteVisit, "id" | "created_at">,
): Promise<string> {
  const rowId = id("visit");
  await db
    .prepare(
      `INSERT INTO site_visits (id, phone, name, email, visit_date, status, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      rowId,
      visit.phone,
      visit.name ?? "",
      visit.email ?? "",
      visit.visit_date ?? null,
      visit.status ?? "booked",
      visit.source ?? "concierge",
      Date.now(),
    )
    .run();
  return rowId;
}

export async function listInquiries(db: Db, limit = 50): Promise<Inquiry[]> {
  const res = await db
    .prepare("SELECT * FROM inquiries ORDER BY created_at DESC LIMIT ?")
    .bind(Math.max(1, Math.min(200, limit)))
    .all<Inquiry>();
  return res.results;
}

export async function listSiteVisits(db: Db, limit = 50): Promise<SiteVisit[]> {
  const res = await db
    .prepare("SELECT * FROM site_visits ORDER BY created_at DESC LIMIT ?")
    .bind(Math.max(1, Math.min(200, limit)))
    .all<SiteVisit>();
  return res.results;
}

export interface FunnelStats {
  inquiries: number;
  qualified: number;
  booked: number;
  conversion_pct: number;
}

export async function funnelStats(db: Db): Promise<FunnelStats> {
  const inquiries = await db.prepare("SELECT COUNT(*) AS n FROM inquiries").first<{ n: number }>();
  const qualified = await db
    .prepare("SELECT COUNT(*) AS n FROM inquiries WHERE qualified = 1")
    .first<{ n: number }>();
  const booked = await db
    .prepare("SELECT COUNT(*) AS n FROM site_visits WHERE status = 'booked'")
    .first<{ n: number }>();
  const inq = inquiries?.n ?? 0;
  const q = qualified?.n ?? 0;
  const b = booked?.n ?? 0;
  return {
    inquiries: inq,
    qualified: q,
    booked: b,
    conversion_pct: inq > 0 ? Math.round((b / inq) * 100) : 0,
  };
}
