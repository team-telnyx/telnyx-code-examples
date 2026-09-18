import type { VenueData } from "../types";
import { envVarsSnapshot, esc } from "../types";

/**
 * The venue's branded microsite — server-rendered entirely from the KV
 * namespace (`venue/data`). Every price, capacity, and FAQ on this page is
 * the same data the SMS concierge, the voice agent, and the ops dashboard
 * read — the site and the agents can never drift apart.
 */
export function renderMicrosite(venue: VenueData): string {
  const galleryGrid = venue.gallery
    .map(
      (g) => `
      <figure class="photo">
        <img src="${esc(g.url)}" alt="${esc(g.caption)}" loading="lazy">
        <figcaption>${esc(g.caption)}</figcaption>
      </figure>`,
    )
    .join("");

  const spaceRows = venue.spaces
    .map(
      (s) => `
      <tr>
        <td><strong>${esc(s.name)}</strong><br><span class="muted">${esc(s.features.join(" · "))}</span></td>
        <td class="num">${s.seated}</td>
        <td class="num">${s.cocktail}</td>
        <td class="num">${s.sqft.toLocaleString()}</td>
      </tr>`,
    )
    .join("");

  const menuCards = venue.menus
    .map(
      (m) => `
      <div class="card">
        <div class="card-head">
          <strong>${esc(m.name)}</strong>
          <span class="badge">$${m.price_per_person}/person</span>
        </div>
        <p class="muted">${esc(m.description)}</p>
        <ul>${m.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
      </div>`,
    )
    .join("");

  const avItems = venue.av.map((a) => `<li>${esc(a)}</li>`).join("");

  const rentalRows = Object.entries(venue.pricing.rental)
    .map(([space, price]) => `<tr><td>${esc(space)}</td><td class="num"><strong>${esc(price)}</strong></td></tr>`)
    .join("");

  const faqItems = venue.faqs
    .map(
      (f) => `
      <details>
        <summary>${esc(f.question)}</summary>
        <p>${esc(f.answer)}</p>
      </details>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(venue.venue.name)} — ${esc(venue.venue.tagline)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; margin: 0; background: #fefdf5; color: #222227; }
  header { background: #101048; color: #fff; padding: 3rem 1rem; text-align: center; border-bottom: 3px solid #00e3aa; }
  header h1 { margin: 0 0 .4rem; font-size: 2.2rem; }
  header p { margin: .2rem 0; opacity: .92; }
  .header-cta { margin-top: 1.2rem; }
  .header-cta a, .btn { display: inline-block; background: #00e3aa; color: #101048; text-decoration: none; font-weight: 600; padding: .65rem 1.3rem; border-radius: 8px; margin: .25rem; }
  .btn.blue { background: #3434ef; color: #fff; }
  .container { max-width: 960px; margin: 0 auto; padding: 1rem; }
  .section { background: #fff; margin: 1rem 0; padding: 1.5rem; border-radius: 10px; border: 1px solid #e9e9e9; box-shadow: 0 1px 4px rgba(16,16,72,.06); }
  h2 { color: #101048; margin-top: 0; border-bottom: 2px solid #ccf9ee; padding-bottom: .4rem; }
  .muted { color: #757575; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: .55rem .6rem; border-bottom: 1px solid #e9e9e9; text-align: left; vertical-align: top; }
  th { color: #58585d; font-size: .85rem; text-transform: uppercase; letter-spacing: .04em; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
  .photo { margin: 0; background: #fefdf5; border-radius: 8px; overflow: hidden; border: 1px solid #e9e9e9; }
  .photo img { width: 100%; height: 170px; object-fit: cover; display: block; }
  .photo figcaption { font-size: .82rem; padding: .5rem .7rem; color: #58585d; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
  .card { border: 1px solid #e9e9e9; border-radius: 8px; padding: 1rem; background: #fefdf5; }
  .card-head { display: flex; justify-content: space-between; align-items: center; gap: .6rem; }
  .badge { display: inline-block; background: #00e3aa; color: #101048; border-radius: 12px; padding: .15rem .7rem; font-size: .8rem; white-space: nowrap; }
  .card ul { padding-left: 1.1rem; margin: .5rem 0 0; }
  details { border-bottom: 1px solid #e9e9e9; padding: .55rem 0; }
  summary { font-weight: 600; cursor: pointer; color: #222227; }
  details p { margin: .5rem 0 .2rem; }
  .contact { background: #d6effc; border-radius: 8px; padding: 1.2rem; text-align: center; }
  .contact code { background: #fff; padding: .2rem .5rem; border-radius: 4px; font-size: 1.05rem; }
  form { display: grid; gap: .6rem; max-width: 460px; }
  input, button { padding: .6rem; border-radius: 6px; border: 1px solid #d3d3d4; font-size: 1rem; }
  button { background: #3434ef; color: #fff; border: none; cursor: pointer; font-weight: 600; }
  button:hover { background: #2f2fd7; }
  .result { margin-top: .6rem; font-weight: 600; min-height: 1.3rem; }
  footer { text-align: center; padding: 2rem 1rem 3rem; color: #757575; font-size: .9rem; }
  footer a { color: #3434ef; }
  @media (max-width: 640px) { th.hide-sm, td.hide-sm { display: none; } }
</style>
</head>
<body>
<header>
  <h1>${esc(venue.venue.name)}</h1>
  <p>${esc(venue.venue.tagline)}</p>
  <p>📍 ${esc(venue.venue.location)}</p>
  <div class="header-cta">
    <a href="#date">Check your date</a>
    <a href="/voice">🎙️ Talk to the concierge</a>
  </div>
</header>
<div class="container">

  <div class="section">
    <h2>About the Venue</h2>
    <p>${esc(venue.venue.description)}</p>
  </div>

  <div class="section">
    <h2>Gallery</h2>
    <div class="gallery">${galleryGrid}</div>
  </div>

  <div class="section">
    <h2>Spaces &amp; Capacity</h2>
    <table>
      <thead>
        <tr><th>Space</th><th class="num">Seated</th><th class="num">Cocktail</th><th class="num">Sq ft</th></tr>
      </thead>
      <tbody>${spaceRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Catering Menus</h2>
    <div class="cards">${menuCards}</div>
  </div>

  <div class="section">
    <h2>AV &amp; Production</h2>
    <ul>${avItems}</ul>
  </div>

  <div class="section">
    <h2>Pricing</h2>
    <table>
      <thead><tr><th>Space</th><th class="num">Rental</th></tr></thead>
      <tbody>${rentalRows}</tbody>
    </table>
    <p class="muted">${esc(venue.pricing.note)}</p>
  </div>

  <div class="section">
    <h2>Frequently Asked</h2>
    ${faqItems}
  </div>

  <div class="section" id="date">
    <h2>Check Your Date</h2>
    <p class="muted">Live availability from the venue's booking database — the same data our concierge quotes over text and phone.</p>
    <form id="availForm">
      <input type="date" name="start" required aria-label="Start date">
      <input type="date" name="end" required aria-label="End date">
      <button type="submit">Check availability</button>
    </form>
    <div id="availResult" class="result"></div>
  </div>

  <div class="section">
    <h2>Book a Site Visit</h2>
    <p class="muted">Walk the ballroom, taste the menus, meet the team. The concierge confirms instantly.</p>
    <form id="visitForm">
      <input name="name" placeholder="Your name" required>
      <input name="phone_number" placeholder="Phone (+E.164)" required>
      <input name="email" type="email" placeholder="Email" required>
      <input type="date" name="visit_date" aria-label="Preferred visit date">
      <button type="submit">Request site visit</button>
    </form>
    <div id="visitResult" class="result"></div>
  </div>

  <div class="section">
    <h2>Talk to the Concierge</h2>
    <div class="contact">
      <p>Text <strong>${esc(envVarsSnapshot().TELNYX_SMS_FROM || "our venue number")}</strong> for availability, pricing, and proposals — answered by AI from the same data this page is built from.</p>
      <a class="btn" href="/voice">🎙️ Talk to the concierge in your browser</a>
    </div>
  </div>

</div>
<footer>
  ${esc(venue.venue.name)} · ${esc(venue.venue.location)}<br>
  <a href="/ops">Venue team → bookings dashboard</a><br><br>
  Powered by <a href="https://telnyx.com" target="_blank" rel="noopener">Telnyx</a> AI Communications Infrastructure
</footer>
<script>
const origin = location.origin;
const dateForm = document.getElementById('availForm');
dateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(dateForm);
  const out = document.getElementById('availResult');
  out.textContent = 'Checking the booking calendar…';
  try {
    const r = await fetch(origin + '/api/availability?start=' + fd.get('start') + '&end=' + fd.get('end'));
    const d = await r.json();
    out.textContent = d.summary || (d.error || 'No data.');
  } catch { out.textContent = 'Network error — try again.'; }
});
const visitForm = document.getElementById('visitForm');
visitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(visitForm).entries());
  const out = document.getElementById('visitResult');
  out.textContent = 'Booking…';
  try {
    const r = await fetch(origin + '/api/site-visit', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await r.json();
    out.textContent = d.ok ? '✅ Site visit booked for ' + d.visit.visit_date + ' — confirmation sent to ' + d.visit.email + '.' : ('Error: ' + (d.error || 'unknown'));
    out.style.color = d.ok ? '#008563' : '#eb0000';
  } catch { out.textContent = 'Network error — try again.'; out.style.color = '#eb0000'; }
});
</script>
</body>
</html>`;
}
