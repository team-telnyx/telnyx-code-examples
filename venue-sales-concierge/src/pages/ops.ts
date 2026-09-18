import type { Inquiry, SiteVisit } from "../types";
import type { AvailabilityDay, FunnelStats } from "../db";
import { esc } from "../types";

/**
 * The venue sales dashboard — inquiries, qualified leads, and site-visit
 * conversions straight from the venue's SQLDB, plus live availability.
 * Auto-refreshes every 15 seconds.
 */
export function renderOpsPage(data: {
  venueName: string;
  stats: FunnelStats;
  inquiries: Inquiry[];
  visits: SiteVisit[];
  availability: AvailabilityDay[];
}): string {
  const { stats } = data;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bookings — ${esc(data.venueName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; margin: 0; background: #fefdf5; color: #222227; }
  header { background: #101048; color: #fff; padding: 2rem 1rem; border-bottom: 3px solid #00e3aa; }
  header h1 { margin: 0 0 .3rem; font-size: 1.7rem; }
  header p { margin: 0; opacity: .9; font-size: .95rem; }
  .container { max-width: 1100px; margin: 0 auto; padding: 1rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 1rem 0; }
  .card { background: #fff; border-radius: 10px; padding: 1.1rem; border: 1px solid #e9e9e9; box-shadow: 0 1px 4px rgba(16,16,72,.06); }
  .card .k { color: #757575; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
  .card .v { font-size: 1.9rem; font-weight: 700; color: #3434ef; margin-top: .2rem; }
  .card .v.warm { color: #00b688; }
  .section { background: #fff; margin: 1rem 0; padding: 1.5rem; border-radius: 10px; border: 1px solid #e9e9e9; box-shadow: 0 1px 4px rgba(16,16,72,.06); overflow-x: auto; }
  h2 { color: #101048; margin-top: 0; border-bottom: 2px solid #ccf9ee; padding-bottom: .4rem; font-size: 1.05rem; }
  table { width: 100%; border-collapse: collapse; font-size: .92rem; }
  th, td { padding: .5rem .55rem; border-bottom: 1px solid #e9e9e9; text-align: left; white-space: nowrap; }
  th { color: #58585d; font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; }
  .badge { display: inline-block; border-radius: 12px; padding: .1rem .6rem; font-size: .75rem; font-weight: 600; }
  .badge.q { background: #d6effc; color: #2424a7; }
  .badge.n { background: #e9e9e9; color: #757575; }
  .badge.b { background: #ccf9ee; color: #008563; }
  .open { color: #008563; font-weight: 600; }
  .closed { color: #eb0000; }
  .muted { color: #757575; }
  .updated { font-size: .8rem; color: #757575; }
  footer { text-align: center; padding: 1.5rem 1rem 2.5rem; color: #757575; font-size: .85rem; }
  footer a { color: #3434ef; }
</style>
</head>
<body>
<header>
  <h1>${esc(data.venueName)} — Bookings</h1>
  <p>Inquiries, RFPs, and site-visit conversions — live from the venue booking database</p>
</header>
<div class="container">

  <div class="cards">
    <div class="card"><div class="k">Inquiries</div><div class="v" id="statInquiries">${stats.inquiries}</div></div>
    <div class="card"><div class="k">RFPs</div><div class="v" id="statQualified">${stats.qualified}</div></div>
    <div class="card"><div class="k">Site visits booked</div><div class="v warm" id="statBooked">${stats.booked}</div></div>
    <div class="card"><div class="k">Conversion</div><div class="v" id="statConversion">${stats.conversion_pct}%</div></div>
  </div>

  <div class="section">
    <h2>Live Availability (next 14 days)</h2>
    <table id="availTable"><tbody>
      ${data.availability
        .map(
          (d) => `
        <tr><td><strong>${esc(d.date)}</strong></td><td class="${d.available ? "open" : "closed"}">${d.available ? "Available" : "Reserved"}</td></tr>`,
        )
        .join("")}
    </tbody></table>
  </div>

  <div class="section">
    <h2>Inquiries</h2>
    <table id="inqTable">
      <thead><tr><th>When</th><th>Channel</th><th>Planner</th><th>Contact</th><th>Event</th><th>Guests</th><th>Budget</th><th>Messages</th><th>Status</th></tr></thead>
      <tbody>
        ${data.inquiries
          .map(
            (i) => `
        <tr>
          <td>${esc(new Date(i.created_at).toISOString().slice(0, 16).replace("T", " "))}</td>
          <td>${esc(i.channel)}</td>
          <td>${esc(i.name || "—")}</td>
          <td>${esc(i.email || i.phone)}</td>
          <td>${esc(i.event_type || "—")}</td>
          <td>${i.guests ?? "—"}</td>
          <td>${esc(i.budget || "—")}</td>
          <td class="muted">${esc((i.message || "").slice(0, 60))}</td>
          <td><span class="badge ${i.qualified ? "q" : "n"}">${i.qualified ? "RFP" : "New"}</span></td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Site Visits</h2>
    <table id="visitTable">
      <thead><tr><th>Booked</th><th>Visit date</th><th>Planner</th><th>Contact</th><th>Source</th><th>Status</th></tr></thead>
      <tbody>
        ${data.visits
          .map(
            (v) => `
        <tr>
          <td>${esc(new Date(v.created_at).toISOString().slice(0, 16).replace("T", " "))}</td>
          <td><strong>${esc(v.visit_date || "TBD")}</strong></td>
          <td>${esc(v.name || "—")}</td>
          <td>${esc(v.email || v.phone)}</td>
          <td class="muted">${esc(v.source)}</td>
          <td><span class="badge b">${esc(v.status)}</span></td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>

</div>
<footer>
  <a href="/">← Back to the venue site</a> · <span class="updated">auto-refreshes every 15s</span><br><br>
  Powered by <a href="https://telnyx.com" target="_blank" rel="noopener">Telnyx</a> AI Communications Infrastructure
</footer>
<script>
async function refresh() {
  try {
    const r = await fetch('/api/leads');
    const d = await r.json();
    document.getElementById('statInquiries').textContent = d.stats.inquiries;
    document.getElementById('statQualified').textContent = d.stats.qualified;
    document.getElementById('statBooked').textContent = d.stats.booked;
    document.getElementById('statConversion').textContent = d.stats.conversion_pct + '%';
  } catch {}
}
setInterval(refresh, 15000);
</script>
</body>
</html>`;
}
