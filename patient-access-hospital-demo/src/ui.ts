// Single-file UI served by the Edge function: one HTML document with inline
// CSS and JS, no build step, no external requests. Mirrors the design of the
// former React implementation exactly. Rebrand by changing BRAND_NAME /
// BRAND_ACCENT in telnyx.toml and swapping the LOGO SVG BLOCK below.
// renderPage() is the authed dashboard; renderLoginPage() is the gate.

type MinimalProcess = { env?: Record<string, string | undefined> };

const processEnv: Record<string, string | undefined> =
  (globalThis as { process?: MinimalProcess }).process?.env ?? {};

function safeColor(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  const cleaned = input.replace(/[^#%(),.\w\s-]/g, "").trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

const BRAND_NAME = (processEnv.BRAND_NAME ?? "Winderval Medical").trim() || "Winderval Medical";
const BRAND_ACCENT = safeColor(processEnv.BRAND_ACCENT, "#0d9488");

// Statically derive the brand tints/shades from the accent hex so the CSS
// never depends on color-mix() (which renders white/transparent on browsers
// that don't support it — the "invisible until hover" button bug).
const TEAL_FALLBACK = "#0d9488";

function mixChannels(a: [number, number, number], b: [number, number, number], ratioA: number): [number, number, number] {
  return [
    Math.round(a[0] * ratioA + b[0] * (1 - ratioA)),
    Math.round(a[1] * ratioA + b[1] * (1 - ratioA)),
    Math.round(a[2] * ratioA + b[2] * (1 - ratioA)),
  ];
}

function toHex([r, g, b]: [number, number, number]): string {
  const p = (n: number) => n.toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const v = m[1];
  return [Number.parseInt(v.slice(0, 2), 16), Number.parseInt(v.slice(2, 4), 16), Number.parseInt(v.slice(4, 6), 16)];
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

function brandScale(accent: string | undefined, fallback: string): Record<"50" | "100" | "200" | "300" | "500" | "600" | "700" | "800", string> {
  const base = parseHex(accent ?? "") ?? parseHex(fallback) ?? [13, 148, 136];
  return {
    "50": toHex(mixChannels(base, WHITE, 0.06)),
    "100": toHex(mixChannels(base, WHITE, 0.14)),
    "200": toHex(mixChannels(base, WHITE, 0.32)),
    "300": toHex(mixChannels(base, WHITE, 0.52)),
    "500": toHex(mixChannels(base, WHITE, 0.12)),
    "600": toHex(base),
    "700": toHex(mixChannels(base, BLACK, 0.12)),
    "800": toHex(mixChannels(base, BLACK, 0.28)),
  };
}

const B = brandScale(BRAND_ACCENT, TEAL_FALLBACK);

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;")
    .replace(/'/g, "&" + "#39;");
}

const brandJson = JSON.stringify({ name: BRAND_NAME }).replace(/</g, "\\u003c");

const CSS = String.raw`
:root {
  --brand: ${B["600"]};
  --brand-600: ${B["600"]};
  --brand-50: ${B["50"]};
  --brand-100: ${B["100"]};
  --brand-200: ${B["200"]};
  --brand-300: ${B["300"]};
  --brand-500: ${B["500"]};
  --brand-700: ${B["700"]};
  --brand-800: ${B["800"]};
  --slate-50: #f8fafc; --slate-100: #f1f5f9; --slate-200: #e2e8f0; --slate-300: #cbd5e1;
  --slate-400: #94a3b8; --slate-500: #64748b; --slate-600: #475569; --slate-700: #334155;
  --slate-800: #1e293b; --slate-900: #0f172a;
  --emerald-50: #ecfdf5; --emerald-100: #d1fae5; --emerald-200: #a7f3d0; --emerald-500: #10b981;
  --emerald-700: #047857; --emerald-800: #065f46; --emerald-900: #064e3b;
  --amber-50: #fffbeb; --amber-100: #fef3c7; --amber-200: #fde68a; --amber-300: #fcd34d;
  --amber-500: #f59e0b; --amber-700: #b45309; --amber-800: #92400e; --amber-900: #78350f;
  --red-50: #fef2f2; --red-100: #fee2e2; --red-200: #fecaca; --red-300: #fca5a5;
  --red-500: #ef4444; --red-700: #b91c1c; --red-800: #991b1b; --red-900: #7f1d1d;
  --sky-50: #f0f9ff; --sky-200: #bae6fd; --sky-700: #0369a1; --sky-800: #075985;
}
* { box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
body {
  margin: 0; background: var(--slate-50); color: var(--slate-900);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 16px; line-height: 1.5;
}
p, h1, h2 { margin: 0; }
button { font: inherit; cursor: pointer; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.ic-3 { width: 12px; height: 12px; }
.ic-3-5 { width: 14px; height: 14px; }
.ic-4 { width: 16px; height: 16px; }
.ic-5 { width: 20px; height: 20px; }
.min-w0 { min-width: 0; }
.spin { animation: rotate360 1s linear infinite; }
@keyframes rotate360 { to { transform: rotate(360deg); } }
@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
@keyframes pulseSoft { 50% { opacity: .55; } }

.tone-brand-700 { color: var(--brand-700); } .tone-brand-800 { color: var(--brand-800); }
.tone-red-700 { color: var(--red-700); } .tone-red-800 { color: var(--red-800); }
.tone-emerald-700 { color: var(--emerald-700); } .tone-amber-700 { color: var(--amber-700); }

.mode-banner { position: sticky; top: 0; z-index: 40; padding: 10px 16px; backdrop-filter: blur(4px); }
.banner-mock { background: ${B["50"]}F5; border-bottom: 1px solid var(--brand-200); }
.banner-live { background: #fee2e2F5; border-bottom: 1px solid var(--red-300); }
.banner-inner { max-width: 80rem; margin: 0 auto; display: flex; align-items: center; gap: 10px; padding: 0 8px; }
.banner-text { font-size: 14px; font-weight: 600; }
.banner-hint { margin-left: 8px; font-weight: 400; }
@media (max-width: 639px) { .banner-hint { display: none; } }

.site-header { background: white; border-bottom: 1px solid var(--slate-200); }
.header-inner { max-width: 80rem; margin: 0 auto; padding: 16px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
@media (min-width: 640px) { .header-inner { padding-left: 24px; padding-right: 24px; } }
@media (min-width: 1024px) { .header-inner { padding-left: 32px; padding-right: 32px; } }
.brand-row { display: flex; align-items: center; gap: 12px; }
.brand-mark { width: 40px; height: 40px; border-radius: 12px; box-shadow: 0 1px 2px rgba(15,23,42,.06); flex: none; }
.brand-name { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.brand-sub { font-size: 12px; color: var(--slate-500); }
.header-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.controls { display: flex; align-items: center; gap: 8px; }

.phase-chip { display: inline-flex; align-items: center; gap: 8px; border-radius: 9999px; border: 1px solid; padding: 4px 12px; font-size: 12px; font-weight: 500; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
.chip-brand { border-color: var(--brand-200); background: var(--brand-50); color: var(--brand-800); }
.chip-emerald { border-color: var(--emerald-200); background: var(--emerald-50); color: var(--emerald-800); }
.chip-red { border-color: var(--red-200); background: var(--red-50); color: var(--red-800); }
.chip-neutral { border-color: var(--slate-200); background: white; color: var(--slate-700); }

.dotwrap { position: relative; display: inline-flex; width: 8px; height: 8px; flex: none; }
.dot { display: inline-flex; width: 8px; height: 8px; border-radius: 9999px; }
.dot-ghost { position: absolute; inset: 0; opacity: .6; animation: ping 1s cubic-bezier(0,0,.2,1) infinite; }
.dot-brand { background: var(--brand-500); } .dot-emerald { background: var(--emerald-500); }
.dot-amber { background: var(--amber-500); } .dot-red { background: var(--red-500); }
.dot-slate { background: var(--slate-400); }

.btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 8px; padding: 6px 12px; font-size: 14px; font-weight: 500; transition: background-color .15s ease, border-color .15s ease; border: 1px solid transparent; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn-primary { background: var(--brand-600); color: white; }
.btn-primary:hover:not(:disabled) { background: var(--brand-700); }
.btn-ghost { background: white; color: var(--slate-700); border-color: var(--slate-300); }
.btn-ghost:hover:not(:disabled) { background: var(--slate-50); }
.btn-save { padding: 8px 16px; }

.tabs { background: white; border-bottom: 1px solid var(--slate-200); }
.tabs-inner { max-width: 80rem; margin: 0 auto; display: flex; gap: 4px; padding: 0 16px; }
@media (min-width: 640px) { .tabs-inner { padding-left: 24px; padding-right: 24px; } }
@media (min-width: 1024px) { .tabs-inner { padding-left: 32px; padding-right: 32px; } }
.tab { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; font-size: 14px; font-weight: 500; color: var(--slate-500); background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .15s ease, border-color .15s ease; }
.tab:hover { color: var(--slate-700); border-bottom-color: var(--slate-300); }
.tab.active { color: var(--brand-800); border-bottom-color: var(--brand-600); }

.main { max-width: 80rem; margin: 0 auto; padding: 24px 16px; }
@media (min-width: 640px) { .main { padding-left: 24px; padding-right: 24px; } }
@media (min-width: 1024px) {
  .main { display: grid; grid-template-columns: 1fr 380px; gap: 24px; padding-left: 32px; padding-right: 32px; }
}
.col { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.aside { margin-top: 24px; }
@media (min-width: 1024px) { .aside { margin-top: 0; } }

.card { border-radius: 12px; border: 1px solid var(--slate-200); background: white; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--slate-100); padding: 14px 20px; }
.card-title { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 14px; font-weight: 600; }
.t-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-body { padding: 20px; }
.card-body-tight { padding: 16px; }

.badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 9999px; border: 1px solid; padding: 2px 8px; font-size: 12px; font-weight: 500; }
.badge-neutral { background: var(--slate-100); color: var(--slate-700); border-color: var(--slate-200); }
.badge-brand { background: var(--brand-50); color: var(--brand-800); border-color: var(--brand-200); }
.badge-sky { background: var(--sky-50); color: var(--sky-800); border-color: var(--sky-200); }
.badge-emerald { background: var(--emerald-50); color: var(--emerald-800); border-color: var(--emerald-200); }
.badge-amber { background: var(--amber-50); color: var(--amber-800); border-color: var(--amber-200); }
.badge-red { background: var(--red-50); color: var(--red-800); border-color: var(--red-200); }

.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; border-radius: 8px; border: 1px dashed var(--slate-200); background: var(--slate-50); padding: 40px 24px; }
.empty-ic { display: flex; width: 40px; height: 40px; align-items: center; justify-content: center; border-radius: 9999px; background: var(--slate-100); color: var(--slate-400); margin-bottom: 12px; }
.empty-title { font-size: 14px; font-weight: 500; color: var(--slate-700); }
.empty-hint { margin-top: 4px; max-width: 24rem; font-size: 12px; color: var(--slate-500); }

.patient-row { display: flex; align-items: center; gap: 16px; }
.avatar { display: flex; width: 48px; height: 48px; flex: none; align-items: center; justify-content: center; border-radius: 9999px; background: var(--brand-100); color: var(--brand-800); font-size: 14px; font-weight: 600; }
.patient-name { font-size: 16px; font-weight: 600; }
.patient-meta { margin-top: 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 12px; color: var(--slate-600); }
.mrn-chip { border-radius: 4px; border: 1px solid var(--slate-200); background: var(--slate-50); padding: 2px 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.alert { border-radius: 12px; border: 1px solid; padding: 16px; display: flex; align-items: flex-start; gap: 12px; }
.alert-red { border-color: var(--red-200); background: var(--red-50); }
.alert-emerald { border-color: var(--emerald-200); background: var(--emerald-50); }
.alert-ic { display: flex; width: 36px; height: 36px; flex: none; align-items: center; justify-content: center; border-radius: 8px; }
.alert-ic-red { background: var(--red-100); color: var(--red-700); }
.alert-ic-emerald { background: var(--emerald-100); color: var(--emerald-700); }
.alert-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.alert-title-red { font-size: 14px; font-weight: 600; color: var(--red-900); }
.alert-title-emerald { font-size: 14px; font-weight: 600; color: var(--emerald-900); }
.alert-line-red { margin-top: 2px; font-size: 14px; color: var(--red-800); }
.alert-line-emerald { margin-top: 2px; font-size: 14px; color: var(--emerald-900); }
.alert-reason { margin-top: 2px; font-size: 12px; color: var(--red-700); }
.alert-foot { margin-top: 6px; font-size: 12px; color: var(--slate-600); }
.alert-foot-emerald { margin-top: 2px; font-size: 12px; color: var(--emerald-700); }

.slot-grid { display: grid; gap: 12px; }
@media (min-width: 640px) { .slot-grid { grid-template-columns: repeat(3, 1fr); } }
.slot-card { display: block; width: 100%; border-radius: 12px; border: 1px solid var(--slate-200); padding: 16px; background: white; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease; }
.slot-card:hover { border-color: var(--brand-300); background: var(--brand-50); }
.slot-card:focus-visible { outline: 3px solid var(--brand-300); outline-offset: 2px; }
.slot-card.selected { border-color: var(--brand-300); background: var(--brand-50); box-shadow: 0 0 0 2px var(--brand-600); }
.slot-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.slot-clinician { font-size: 14px; font-weight: 600; }
.slot-time { margin-top: 8px; font-size: 18px; font-weight: 600; color: var(--brand-800); }
.slot-sub { margin-top: 2px; font-size: 12px; color: var(--slate-500); }

.sms-wrap { display: flex; flex-direction: column; align-items: flex-end; }
.sms-bubble { width: 100%; max-width: 24rem; border-radius: 16px; border-bottom-right-radius: 4px; border: 1px solid var(--brand-200); background: var(--brand-700); color: white; padding: 14px; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
.sms-head { margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; }
.sms-sender { font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--brand-100); }
.sms-to { color: var(--brand-200); }
.sms-body { font-size: 14px; line-height: 1.625; }
.sms-foot { margin-top: 8px; display: flex; align-items: center; justify-content: flex-end; gap: 8px; font-size: 11px; color: var(--brand-100); }
.sms-status { margin-top: 6px; display: inline-flex; align-items: center; border-radius: 9999px; border: 1px solid; padding: 2px 8px; font-size: 11px; font-weight: 500; }
.st-queued { background: var(--slate-100); color: var(--slate-600); border-color: var(--slate-200); }
.st-sent { background: var(--sky-50); color: var(--sky-700); border-color: var(--sky-200); }
.st-delivered { background: var(--emerald-50); color: var(--emerald-700); border-color: var(--emerald-200); }
.st-failed { background: var(--red-50); color: var(--red-700); border-color: var(--red-200); }

.tl { border-left: 2px solid var(--slate-200); padding-left: 16px; }
.tl-node { position: relative; display: flex; gap: 12px; padding-bottom: 20px; }
.tl-ic { display: flex; width: 32px; height: 32px; flex: none; align-items: center; justify-content: center; border-radius: 9999px; border: 1px solid; }
.tl-ic-slate { border-color: var(--slate-200); background: var(--slate-100); color: var(--slate-600); }
.tl-ic-brand { border-color: var(--brand-200); background: var(--brand-50); color: var(--brand-700); }
.tl-ic-emerald { border-color: var(--emerald-200); background: var(--emerald-50); color: var(--emerald-700); }
.tl-body { min-width: 0; flex: 1; padding-top: 2px; }
.tl-time { margin-top: 4px; font-size: 11px; color: var(--slate-400); }
.tl-speaker { font-size: 12px; font-weight: 600; }
.speaker-agent { color: var(--brand-800); }
.speaker-patient { color: var(--slate-700); }
.tl-text { margin-top: 2px; font-size: 14px; line-height: 1.625; color: var(--slate-800); }
.tl-label { font-size: 14px; font-weight: 500; }
.label-emerald { font-weight: 600; color: var(--emerald-900); }
.label-brand { font-weight: 600; color: var(--brand-800); }

.esc-card { border-radius: 12px; border: 1px solid var(--amber-300); background: var(--amber-50); box-shadow: 0 1px 2px rgba(15,23,42,.05); }
.esc-head { display: flex; align-items: flex-start; gap: 12px; border-bottom: 1px solid var(--amber-200); padding: 12px 16px; }
.esc-ic { display: flex; width: 36px; height: 36px; flex: none; align-items: center; justify-content: center; border-radius: 8px; background: var(--amber-100); color: var(--amber-700); }
.esc-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.esc-title { font-size: 14px; font-weight: 600; color: var(--amber-900); }
.esc-sub { margin-top: 2px; font-size: 12px; color: var(--amber-800); }
.esc-body { padding: 12px 16px; }
.esc-quote { font-size: 14px; font-style: italic; line-height: 1.625; color: var(--slate-800); }
.esc-panel { margin-top: 12px; border-radius: 8px; border: 1px solid var(--amber-200); background: white; padding: 12px; }
.esc-panel-title { margin-bottom: 8px; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--amber-800); }
.esc-grid { display: grid; gap: 8px 24px; }
@media (min-width: 640px) { .esc-grid { grid-template-columns: repeat(2, 1fr); } .esc-span2 { grid-column: span 2; } }
.esc-dt { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--slate-400); }
.esc-dd { font-size: 14px; color: var(--slate-800); }

.rail { margin-bottom: 12px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 12px; border-radius: 8px; background: var(--slate-50); padding: 12px; }
.rail-item { display: flex; align-items: center; gap: 6px; min-width: 0; }
.rail-dot { width: 6px; height: 6px; border-radius: 9999px; flex: none; }
.rd-brand { background: var(--brand-500); } .rd-brand-300 { background: var(--brand-300); }
.rd-slate-300 { background: var(--slate-300); } .rd-red { background: var(--red-500); }
.rail-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--slate-400); }
.rail-current { font-weight: 600; color: var(--slate-900); }
.rail-done { color: var(--slate-600); }
.panel-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--slate-600); }

.transcript { max-height: 18rem; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 10px; }
.transcript::-webkit-scrollbar { width: 8px; }
.transcript::-webkit-scrollbar-thumb { background: var(--slate-200); border-radius: 8px; }
.transcript::-webkit-scrollbar-track { background: transparent; }
.transcript-empty { display: flex; height: 10rem; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.bubble-row { display: flex; width: 100%; }
.row-right { justify-content: flex-end; }
.row-left { justify-content: flex-start; }
.bubble { max-width: 85%; border-radius: 16px; border: 1px solid; padding: 10px 14px; }
.bl-left { border-bottom-left-radius: 4px; }
.bl-right { border-bottom-right-radius: 4px; }
.bb-slate { border-color: var(--slate-200); background: white; }
.bb-brand { border-color: var(--brand-200); background: var(--brand-50); }
.bb-emerald { border-color: var(--emerald-200); background: var(--emerald-50); }
.bubble-label { font-size: 11px; font-weight: 600; }
.lbl-brand { color: var(--brand-800); } .lbl-slate { color: var(--slate-500); } .lbl-emerald { color: var(--emerald-800); }
.bubble-text { margin-top: 2px; font-size: 14px; line-height: 1.625; color: var(--slate-800); }
.syschip { display: flex; align-items: center; justify-content: center; padding: 4px 0; }
.syschip-inner { display: inline-flex; align-items: center; gap: 6px; border-radius: 9999px; border: 1px solid var(--slate-200); background: var(--slate-50); padding: 2px 10px; font-size: 11px; font-weight: 500; }
.sc-brand { color: var(--brand-700); } .sc-brand-800 { color: var(--brand-800); }
.sc-slate { color: var(--slate-600); } .sc-slate-500 { color: var(--slate-500); }
.sc-amber { color: var(--amber-700); } .sc-emerald { color: var(--emerald-700); } .sc-red { color: var(--red-700); }

.settings-note { font-size: 14px; color: var(--slate-600); }
.form-grid { margin-top: 16px; display: grid; gap: 16px; }
@media (min-width: 640px) { .form-grid { grid-template-columns: repeat(2, 1fr); } .span2 { grid-column: span 2; } }
.lbl { display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--slate-500); }
.input { margin-top: 4px; width: 100%; border-radius: 8px; border: 1px solid var(--slate-300); background: white; padding: 8px 12px; font-size: 14px; color: var(--slate-900); }
.input::placeholder { color: var(--slate-400); }
.input:focus { outline: none; border-color: var(--brand-500); box-shadow: 0 0 0 3px var(--brand-100); }
.field-err { margin-top: 4px; font-size: 12px; font-weight: 500; color: var(--red-700); }
.err-box { display: flex; align-items: center; gap: 6px; border-radius: 8px; border: 1px solid var(--red-200); background: var(--red-50); padding: 8px 12px; font-size: 14px; color: var(--red-700); }
.form-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--slate-100); padding-top: 16px; }
.status-note { font-size: 12px; color: var(--slate-500); }
.status-saved { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 500; color: var(--emerald-700); }

.boot { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 0 16px; text-align: center; }
.boot-ic { width: 32px; height: 32px; color: var(--brand-600); animation: pulseSoft 2s cubic-bezier(.4,0,.6,1) infinite; }
.boot-text { font-size: 14px; color: var(--slate-600); }
.boot-err-title { font-size: 14px; font-weight: 500; color: var(--red-700); }
.boot-err-detail { font-size: 12px; color: var(--slate-500); }
.boot-retry { border: none; border-radius: 8px; background: var(--brand-600); color: white; padding: 8px 16px; font-size: 14px; font-weight: 500; }
.boot-retry:hover { background: var(--brand-700); }

/* login */
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.login-card { width: 100%; max-width: 380px; background: white; border: 1px solid var(--slate-200); border-radius: 16px; box-shadow: 0 1px 3px rgba(15,23,42,.08); padding: 28px; text-align: center; }
.login-mark { width: 48px; height: 48px; border-radius: 14px; margin: 0 auto 12px; display: block; box-shadow: 0 1px 2px rgba(15,23,42,.08); }
.login-brand { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--brand-700); }
.login-title { margin-top: 4px; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
.login-sub { margin-top: 2px; font-size: 13px; color: var(--slate-500); }
.auth-tabs { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; background: var(--slate-100); border-radius: 10px; padding: 4px; }
.auth-tab { border: none; background: transparent; border-radius: 8px; padding: 8px 10px; font-size: 13px; font-weight: 500; color: var(--slate-600); }
.auth-tab.active { background: white; color: var(--brand-800); font-weight: 600; box-shadow: 0 1px 2px rgba(15,23,42,.06); }
.login-form { margin-top: 20px; text-align: left; }
.login-form .lbl { margin-bottom: 4px; display: block; }
.login-form .lbl:not(:first-child) { margin-top: 14px; }
.btn-login { width: 100%; margin-top: 18px; padding: 10px; justify-content: center; }
.login-err { margin-top: 12px; font-size: 13px; font-weight: 500; color: var(--red-700); text-align: center; }
.call-row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
.call-row > div { flex: 1 1 220px; min-width: 0; }
.call-hint { margin-top: 8px; font-size: 12px; color: var(--slate-500); }
.login-hint { margin-top: 18px; border-radius: 8px; border: 1px dashed var(--slate-200); background: var(--slate-50); padding: 10px 12px; }
.hint-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--slate-500); }
.hint-line { margin-top: 4px; font-size: 13px; color: var(--slate-700); }
.hint-line code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: white; border: 1px solid var(--slate-200); border-radius: 4px; padding: 1px 6px; }
.login-foot { margin-top: 16px; font-size: 11px; color: var(--slate-400); line-height: 1.6; }
`;

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230d9488'/%3E%3Cpath d='M5 17h4l2-5 4 9 3-6 2 2h7' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

const LOGIN_JS = String.raw`
(function () {
  "use strict";
  function el(id) { return document.getElementById(id); }
  el("login-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var err = el("login-err");
    err.hidden = true;
    var button = el("login-submit");
    button.disabled = true;
    button.textContent = "Signing in\u2026";
    fetch("/api/auth/login", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: el("login-email").value.trim(),
        password: el("login-password").value,
        confirm: ""
      })
    }).then(function (res) {
      if (res.ok) { window.location.href = "/"; return null; }
      return res.json().then(function (body) {
        button.disabled = false;
        button.textContent = "Sign in";
        err.hidden = false;
        err.textContent = body && typeof body.error === "string" ? body.error : "Invalid email or password.";
        return null;
      });
    }).catch(function () {
      button.disabled = false;
      button.textContent = "Sign in";
      err.hidden = false;
      err.textContent = "Could not reach the demo server \u2014 try again.";
    });
  });
})();
`;

const CLIENT_JS = String.raw`
(function () {
  "use strict";
  var BRAND = window.__BRAND__.name;
  var POLL_MS = 1000;
  var RUNNING = ["preparing","calling","identifying","explaining_missed","offering_slots","awaiting_choice","booking","confirming_sms","handling_question","escalating","transferring","in_handoff"];
  var RAIL = ["idle","preparing","calling","identifying","explaining_missed","offering_slots","awaiting_choice","booking","confirming_sms","handling_question","escalating","transferring","in_handoff","done","stopped"];
  var PHASE_LABEL = { idle: "Idle", preparing: "Preparing", calling: "Calling", identifying: "Identifying", explaining_missed: "Explaining missed visit", offering_slots: "Offering slots", awaiting_choice: "Awaiting choice", booking: "Booking", confirming_sms: "Confirming by SMS", handling_question: "Handling question", escalating: "Escalating", transferring: "Transferring", in_handoff: "In handoff", done: "Done", stopped: "Stopped" };

  var ICONS = {
    "heart-pulse": '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h2.28"/>',
    "calendar-clock": '<path d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3"/><path d="M10 2v4"/><path d="M16 2v4"/><circle cx="17" cy="17" r="5"/><path d="M17 15v2h2"/>',
    "calendar-x": '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="m15 13-6 6"/><path d="m9 13 6 6"/>',
    "calendar-check": '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    "user-round": '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="5"/>',
    "settings-2": '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    "phone-call": '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/><path d="M14.05 2a9 9 0 0 1 8 7.94"/><path d="M14.05 6A5 5 0 0 1 18 10"/>',
    "phone-off": '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="22" y1="2" x2="2" y2="22"/>',
    "circle-x": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    "arrow-right-left": '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
    "shield-alert": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    "message-square-text": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/>',
    stethoscope: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    "loader-circle": '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    "triangle-alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    "circle-check": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'
  };

  var CALL_STATUS = {
    dialing: { tone: "amber", pulse: true, label: "Dialing" },
    in_progress: { tone: "brand", pulse: true, label: "In progress" },
    connected_to_staff: { tone: "emerald", pulse: true, label: "Connected to staff" },
    ended: { tone: "slate", pulse: false, label: "Ended" },
    failed: { tone: "red", pulse: false, label: "Failed" },
    cancelled: { tone: "slate", pulse: false, label: "Cancelled" }
  };

  var CHIPS = {
    "call.initiated": { ic: "phone-call", text: "Calling patient\u2026", tone: "sc-brand" },
    "call.answered": { ic: "phone-call", text: "Call answered", tone: "sc-brand" },
    "slots.offered": { ic: "calendar-clock", text: "Availability offered", tone: "sc-slate" },
    "slot.selected": { ic: "calendar-check", text: "Slot selected", tone: "sc-brand-800" },
    "escalation.raised": { ic: "shield-alert", text: "Escalation raised", tone: "sc-amber" },
    "transfer.started": { ic: "arrow-right-left", text: "Warm transfer started", tone: "sc-amber" },
    "transfer.connected": { ic: "arrow-right-left", text: "Connected to staff", tone: "sc-emerald" },
    "call.ended": { ic: "phone-off", text: "Call ended", tone: "sc-slate-500" },
    "call.failed": { ic: "circle-x", text: "Call failed", tone: "sc-red" }
  };

  var META = {
    "call.initiated": { ic: "phone-call", label: "Call initiated", tone: "tone-brand-700", ics: "tl-ic-slate" },
    "call.answered": { ic: "phone-call", label: "Call answered", tone: "tone-brand-700", ics: "tl-ic-slate" },
    "slots.offered": { ic: "calendar-clock", label: "Slots offered", tone: "", ics: "tl-ic-slate" },
    "slot.selected": { ic: "calendar-check", label: "Slot selected", tone: "tone-brand-800", ics: "tl-ic-slate" },
    "transfer.started": { ic: "arrow-right-left", label: "Warm transfer started", tone: "tone-amber-700", ics: "tl-ic-slate" },
    "transfer.connected": { ic: "arrow-right-left", label: "Connected to staff", tone: "tone-emerald-700", ics: "tl-ic-slate" },
    "call.ended": { ic: "phone-off", label: "Call ended", tone: "", ics: "tl-ic-slate" },
    "call.failed": { ic: "circle-x", label: "Call failed", tone: "tone-red-700", ics: "tl-ic-slate" }
  };

  var state = null;
  var tab = "scheduling";
  var busy = null;
  var inFlight = false;
  var reqId = 0;
  var pollTimer = null;
  var lastEventCount = -1;
  var intakeSlotId = "";
  var intakeBuilt = false;
  var intakeSt = null;
  var intakeRenderedKey = "";

  var S = { synced: null, savedEcho: null, errors: {}, saved: false, submitting: false, server: null, built: false };
  var actionError = null;

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&" + "amp;").replace(/</g, "&" + "lt;").replace(/>/g, "&" + "gt;").replace(/"/g, "&" + "quot;").replace(/'/g, "&" + "#39;");
  }
  function el(id) { return document.getElementById(id); }
  function icon(name, cls) { return '<svg class="' + (cls || "ic-4") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + "</svg>"; }
  function badge(variant, text) { return '<span class="badge badge-' + variant + '">' + esc(text) + "</span>"; }
  function dot(tone, pulse) {
    return '<span class="dotwrap"><span class="dot dot-' + tone + '"></span>' + (pulse ? '<span class="dot dot-' + tone + ' dot-ghost"></span>' : "") + "</span>";
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function parseLocalDate(iso) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { var p = iso.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
    return new Date(iso);
  }
  function fmtTime12(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var hhmm = d.toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true });
    return hhmm.replace("\u202f", " ");
  }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function fmtDayLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var pac = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    var pp = {};
    for (var i = 0; i < pac.length; i++) if (pac[i].type === "year" || pac[i].type === "month" || pac[i].type === "day") pp[pac[i].type] = Number(pac[i].value);
    var diff = Math.round((Date.UTC(pp.year, pp.month - 1, pp.day) - Date.UTC.call(Date.UTC, new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).reduce(function (o, x) { if (x.type === "year" || x.type === "month" || x.type === "day") o[x.type] = Number(x.value); return o; }, {}).year, new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).reduce(function (o, x) { if (x.type === "year" || x.type === "month" || x.type === "day") o[x.type] = Number(x.value); return o; }, {}).month - 1, new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).reduce(function (o, x) { if (x.type === "year" || x.type === "month" || x.type === "day") o[x.type] = Number(x.value); return o; }, {}).day)) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    return d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "short", day: "numeric" });
  }
  function fmtFullDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", year: "numeric" }) + " \u00b7 " + fmtTime12(iso);
  }
  function fmtClock(iso) { return fmtTime12(iso); }
  function fmtE164(e) {
    var digits = e.replace(/^\+1/, "");
    if (/^\d{10}$/.test(digits)) { return "+1 (" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6); }
    return e;
  }
  function fmtPhoneMasked(e) {
    var digits = String(e || "").replace(/\D/g, "");
    if (digits.length < 4) return "+\u2022\u2022\u2022\u2022";
    return "+\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 " + digits.slice(-4);
  }

  function allEvents(st) {
    var out = []; var i, j;
    for (i = 0; i < st.calls.length; i++) { for (j = 0; j < st.calls[i].events.length; j++) out.push(st.calls[i].events[j]); }
    return out;
  }
  function lastSlotSelectedId(st) {
    var evs = allEvents(st); var id = null; var i;
    for (i = 0; i < evs.length; i++) { if (evs[i].kind === "slot.selected" && evs[i].data && typeof evs[i].data.slotId === "string") id = evs[i].data.slotId; }
    return id;
  }
  function slotFromEvents(st, slotId) {
    var evs = allEvents(st); var i, k;
    for (i = 0; i < evs.length; i++) {
      if (evs[i].kind !== "slots.offered") continue;
      var offered = evs[i].data && evs[i].data.slots ? evs[i].data.slots : [];
      for (k = 0; k < offered.length; k++) { if (offered[k].id === slotId) return offered[k]; }
    }
    return undefined;
  }
  function findSlotById(st, slotId) {
    var i;
    for (i = 0; i < st.availableSlots.length; i++) { if (st.availableSlots[i].id === slotId) return st.availableSlots[i]; }
    return slotFromEvents(st, slotId);
  }
  function clinicianForAppointment(st, appointment) {
    var slot = appointment.slotId ? findSlotById(st, appointment.slotId) : undefined;
    if (slot) return slot.clinicianName;
    var reason = typeof appointment.reason === "string" ? appointment.reason : "";
    var match = /\bwith (.+)$/.exec(reason);
    return match ? match[1] : "";
  }

  function renderBanner(st) {
    el("mode-banner").innerHTML = st.mode === "live"
      ? '<div class="mode-banner banner-live"><div class="banner-inner">' + icon("shield-alert", "ic-5 tone-red-700") + '<p class="banner-text tone-red-800">LIVE MODE \u2014 real calls and SMS active<span class="banner-hint tone-red-700">Every action here touches the Telnyx network.</span></p></div></div>'
      : '<div class="mode-banner banner-mock"><div class="banner-inner">' + icon("shield-check", "ic-5 tone-brand-700") + '<p class="banner-text tone-brand-800">MOCK MODE \u2014 synthetic data<span class="banner-hint tone-brand-700">no calls or texts will be placed</span></p></div></div>';
  }

  function renderHeader(st) {
    el("patient-line").textContent = st.appointments.length === 0
      ? "Patient access console"
      : st.patient.fullName + " \u00b7 " + st.patient.mrn + " \u00b7 Patient access";
    var running = RUNNING.indexOf(st.phase) >= 0;
    var tone = st.phase === "done" ? "emerald" : st.phase === "stopped" ? "red" : running ? "brand" : "neutral";
    var dotTone = st.phase === "done" ? "emerald" : st.phase === "stopped" ? "red" : running ? "brand" : "slate";
    el("phase-chip").innerHTML = '<span class="phase-chip chip-' + tone + '">' + dot(dotTone, running) + PHASE_LABEL[st.phase] + "</span>";
    renderControls(st);
  }

  function renderControls(st) {
    var running = RUNNING.indexOf(st.phase) >= 0;
    el("controls").innerHTML =
      '<button type="button" class="btn btn-ghost" id="btn-stop"' + (!running || busy ? " disabled" : "") + ">" + (busy === "stop" ? icon("loader-circle", "ic-4 spin") : icon("square", "ic-4")) + "Stop</button>" +
      '<button type="button" class="btn btn-ghost" id="btn-reset"' + (busy ? " disabled" : "") + ' title="Stop if running, then reset to a fresh intake state (settings and the saved number carry over)">' + (busy === "reset" ? icon("loader-circle", "ic-4 spin") : icon("rotate-ccw", "ic-4")) + "Reset</button>" +
      (actionError ? '<span class="panel-status tone-red-700" role="alert">' + esc(actionError) + "</span>" : "");
    el("btn-stop").addEventListener("click", function () { act("stop"); });
    el("btn-reset").addEventListener("click", function () { act("reset"); });
  }

  function renderSms(sms) {
    var stClass = sms.status === "delivered" ? "st-delivered" : sms.status === "failed" ? "st-failed" : sms.status === "sent" ? "st-sent" : "st-queued";
    var stLabel = sms.status.charAt(0).toUpperCase() + sms.status.slice(1);
    return '<div class="sms-wrap"><div class="sms-bubble"><div class="sms-head"><span class="sms-sender">' + esc(BRAND) + '</span><span class="sms-to">' + esc(fmtPhoneMasked(sms.toE164)) + '</span></div><p class="sms-body">' + esc(sms.body) + '</p><div class="sms-foot">' + icon("message-square-text", "ic-3") + "<span>" + esc(fmtClock(sms.createdAtIso)) + "</span></div></div>" + '<span class="sms-status ' + stClass + '">' + esc(stLabel) + "</span></div>";
  }

  function renderEscalationCard(escalation) {
    var slot = escalation.handoff.selectedSlot;
    var rows = [
      ["Patient", escalation.handoff.patientName],
      ["MRN", escalation.handoff.mrn],
      ["Appointment", escalation.handoff.appointmentSummary],
      ["Selected time", slot ? fmtDayLabel(slot.startsAtIso) + " at " + fmtTime12(slot.startsAtIso) + " \u00b7 " + slot.clinicianName : "Not selected"],
      ["Patient question", escalation.handoff.patientQuestion]
    ];
    var grid = "";
    for (var i = 0; i < rows.length; i++) {
      grid += '<div' + (rows[i][0] === "Patient question" ? ' class="esc-span2"' : "") + '><dt class="esc-dt">' + esc(rows[i][0]) + '</dt><dd class="esc-dd">' + esc(rows[i][1]) + "</dd></div>";
    }
    var html = '<div class="esc-card"><div class="esc-head"><span class="esc-ic">' + icon("shield-alert", "ic-5") + '</span><div class="min-w0"><div class="esc-title-row"><p class="esc-title">Escalation to staff</p>' + badge("amber", escalation.category) + '<span class="badge ' + (escalation.status === "connected" ? "badge-emerald" : "badge-amber") + '">' + (escalation.status === "connected" ? "Connected" : "Pending") + "</span></div>";
    html += '<p class="esc-sub">Outside the assistant\u2019s medical scope \u2014 routed to the nurse line.</p></div></div>';
    html += '<div class="esc-body"><p class="esc-quote">"' + esc(escalation.patientQuestion) + '"</p>';
    html += '<div class="esc-panel"><p class="esc-panel-title">' + icon("stethoscope", "ic-3-5") + "Handoff context shared with staff</p><dl class=\"esc-grid\">" + grid + "</dl></div></div></div>";
    return html;
  }

  function patientCard(st) {
    var meta = '<span class="mrn-chip">' + esc(st.patient.mrn) + '</span><span>' +
      (st.patient.dobIso ? "DOB " + esc(parseLocalDate(st.patient.dobIso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })) : "Date of birth not on file") +
      '</span><span>' + esc(fmtPhoneMasked(st.patient.phoneE164)) + "</span>";
    return '<section class="card"><div class="card-head"><h2 class="card-title">' + icon("user-round", "ic-4 tone-brand-700") + '<span class="t-label">Patient on file</span></h2></div><div class="card-body">' +
      '<div class="patient-row"><div class="avatar">' + esc(st.patient.fullName.split(" ").map(function (p) { return p.charAt(0); }).join("")) + "</div>" +
      '<div class="min-w0"><p class="patient-name">' + esc(st.patient.fullName) + '</p><div class="patient-meta">' + meta + "</div></div></div></section>";
  }

  function intakeHintStatus() {
    var nameInput = el("intake-name");
    var phoneInput = el("intake-phone");
    var dobInput = el("intake-dob");
    if (!nameInput || !phoneInput || !dobInput) return;
    var nameOk = nameInput.value.trim().length >= 2;
    var phoneOk = /^\+[1-9]\d{7,14}$/.test(phoneInput.value.trim());
    var dobOk = /^\d{4}-\d{2}-\d{2}$/.test(dobInput.value);
    var hint = el("intake-hint");
    if (phoneInput.value.trim().length === 0) {
      hint.textContent = "Type the patient's phone (E.164) \u2014 it will be saved on file with the booking.";
      hint.style.color = "var(--slate-500)";
    } else if (!phoneOk) {
      hint.textContent = "Use full E.164 format, e.g. +15555550123";
      hint.style.color = "var(--slate-500)";
    } else if (!dobOk) {
      hint.textContent = "Add the patient's date of birth for caller verification.";
      hint.style.color = "var(--slate-500)";
    } else if (!intakeSlotId) {
      hint.textContent = "\u2713 phone ready \u2014 now tap one of today's slots to select the visit time.";
      hint.style.color = "var(--emerald-700)";
    } else {
      hint.textContent = "\u2713 ready to book \u2014 this visit goes on file with this phone number.";
      hint.style.color = "var(--emerald-700)";
    }
  }

  function renderIntakeSlots(st) {
    var grid = el("intake-slots");
    if (!grid) return;
    var slots = st.availableSlots;
    var key = slots.map(function (s) { return s.id; }).join("|");
    if (grid.children.length > 0 && key === intakeRenderedKey) return;
    intakeRenderedKey = key;
    if (slots.length === 0) {
      grid.innerHTML = '<div class="empty"><div class="empty-ic">' + icon("calendar-clock", "ic-5") + '</div><p class="empty-title">Clinic is booked up for today</p><p class="empty-hint">Every remaining slot today is taken. Calling hours are adjustable in Settings.</p></div>';
      return;
    }
    var html = "";
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      html += '<button type="button" class="slot-card' + (s.id === intakeSlotId ? " selected" : "") + '" data-slot-id="' + esc(s.id) + '"><div class="slot-head"><p class="slot-clinician">' + esc(s.clinicianName) + "</p>" + badge(s.kind === "new-patient" ? "sky" : "brand", s.kind === "new-patient" ? "New patient" : "Follow-up") + "</div>";
      html += '<p class="slot-time">' + esc(fmtDayLabel(s.startsAtIso)) + " \u00b7 " + esc(fmtTime12(s.startsAtIso)) + "</p>";
      html += '<p class="slot-sub">' + (s.id === intakeSlotId ? "Selected \u2014 books this visit" : "Select this slot") + "</p></button>";
    }
    grid.innerHTML = html;
    if (el("btn-book")) {
      var nameLengthNow = el("intake-name").value.trim().length;
      var nameOkNow = nameLengthNow >= 2 && nameLengthNow <= 80;
      var phoneOkNow = /^\+[1-9]\d{7,14}$/.test(el("intake-phone").value.trim());
      var dobOkNow = /^\d{4}-\d{2}-\d{2}$/.test(el("intake-dob").value);
      el("btn-book").disabled = !(nameOkNow && phoneOkNow && dobOkNow && intakeSlotId);
    }
  }

  function renderIntake(st) {
    intakeSt = st;
    if (!el("intake-name") || !el("intake-slots") || !el("btn-book")) {
      var phone = st.settings.targetPhoneE164 || "";
      var dob = "";
      var form = '<section class="card"><div class="card-head"><h2 class="card-title">' + icon("user-round", "ic-4 tone-brand-700") + '<span class="t-label">New patient intake</span></h2></div><div class="card-body">';
      form += '<p class="settings-note">Book the appointment first \u2014 the patient\u2019s phone is saved on file with the booking. When the visit is missed, the AI agent auto-calls the patient to check in and rebook.</p>';
      form += '<div class="call-row"><div><label class="lbl" for="intake-name">Patient full name</label><input id="intake-name" type="text" class="input" placeholder="e.g. Priya Nair"></div>';
      form += '<div><label class="lbl" for="intake-phone">Phone (E.164 \u2014 call + text here)</label><input id="intake-phone" type="text" inputmode="tel" class="input" placeholder="+15555550123" value="' + esc(phone) + '"></div>';
      form += '<div><label class="lbl" for="intake-dob">Date of birth</label><input id="intake-dob" type="date" class="input" value="' + esc(dob) + '"></div></div>';
      form += '<div id="intake-slots" class="slot-grid" style="margin-top:16px"></div>';
      form += '<p class="call-hint" id="intake-hint"></p>';
      form += '<div class="call-row"><button type="button" id="btn-book" class="btn btn-primary" disabled>' + icon("calendar-check", "ic-4") + 'Book appointment</button><p class="call-hint" id="intake-err" style="display:none;max-width:280px"></p></div>';
      form += "</div></section>";
      el("view-scheduling").innerHTML = form;
      var nameInput = el("intake-name");
      var phoneInput = el("intake-phone");
      var dobInput = el("intake-dob");
      var validate = function () {
        var nameLength = nameInput.value.trim().length;
        var nameOk = nameLength >= 2 && nameLength <= 80;
        var phoneOk = /^\+[1-9]\d{7,14}$/.test(phoneInput.value.trim());
        var dobOk = /^\d{4}-\d{2}-\d{2}$/.test(dobInput.value);
        el("btn-book").disabled = !(nameOk && phoneOk && dobOk && intakeSlotId);
        intakeHintStatus();
      };
      nameInput.addEventListener("input", validate);
      phoneInput.addEventListener("input", validate);
      dobInput.addEventListener("input", validate);
      // Some browsers/autofill flows update the value without emitting an
      // input event. Revalidate on commit/focus changes too so the button
      // cannot remain falsely disabled after a valid paste or autofill.
      nameInput.addEventListener("change", validate);
      phoneInput.addEventListener("change", validate);
      dobInput.addEventListener("change", validate);
      nameInput.addEventListener("blur", validate);
      phoneInput.addEventListener("blur", validate);
      dobInput.addEventListener("blur", validate);
      el("intake-slots").addEventListener("click", function (event) {
        var card = event.target.closest ? event.target.closest('[data-slot-id]') : null;
        if (!card) return;
        intakeSlotId = card.getAttribute("data-slot-id") || "";
        intakeRenderedKey = "";
        renderIntakeSlots(intakeSt);
        validate();
      });
      el("btn-book").addEventListener("click", function () {
        var err = el("intake-err");
        var bookBtn = el("btn-book");
        err.style.display = "none";
        bookBtn.disabled = true;
        bookBtn.innerHTML = icon("loader-circle", "ic-4 spin") + "Booking\u2026";
        post("/api/intake", { fullName: nameInput.value.trim(), phoneE164: phoneInput.value.trim(), dobIso: dobInput.value, slotId: intakeSlotId }).then(function (res) {
          if (res && res.ok) {
            fetchOnce();
            return null;
          }
          bookBtn.disabled = false;
          bookBtn.innerHTML = icon("calendar-check", "ic-4") + "Book appointment";
          validate();
          err.textContent = (res && res.body && typeof res.body.error === "string") ? res.body.error : "Could not book \u2014 try again.";
          err.style.display = "block";
          return null;
        });
      });
      validate();
    }
    renderIntakeSlots(st);
  }

  function markerAutoCallCard(st) {
    var running = RUNNING.indexOf(st.phase) >= 0;
    var hintTone = st.mode === "live" ? "tone-red-700" : "";
    var hint = st.mode === "live"
      ? "LIVE MODE \u2014 this places a real AI call to " + esc(fmtPhoneMasked(st.patient.phoneE164)) + "."
      : "MOCK MODE \u2014 the call is simulated end to end; nothing dials.";
    return '<section class="card"><div class="card-head"><h2 class="card-title">' + icon("phone-call", "ic-4 tone-brand-700") + '<span class="t-label">Missed-visit follow-up</span></h2></div><div class="card-body">' +
      '<p class="settings-note">No-shows happen. When the patient misses this visit, the AI agent calls them automatically \u2014 no staff lift a finger. Simulate the no-show now to watch it live.</p>' +
      '<div class="call-row"><button type="button" id="btn-missed" class="btn btn-primary"' + (running || busy ? " disabled" : "") + ">" + icon("phone-call", "ic-4") + "Mark missed & auto-call now</button></div>" +
      '<p class="call-hint ' + hintTone + '">' + hint + '</p></div></section>';
  }

  function renderScheduling(st) {
    var missed = null; var booked = null; var i;
    for (i = 0; i < st.appointments.length; i++) {
      if (st.appointments[i].status === "missed") missed = st.appointments[i];
      if (st.appointments[i].status === "booked") booked = st.appointments[i];
    }
    if (st.appointments.length === 0) {
      renderIntake(st);
      return;
    }
    var selectedId = lastSlotSelectedId(st);
    var slots = st.availableSlots;
    var html = "";

    html += patientCard(st);

    if (missed) {
      html += '<div class="alert alert-red"><span class="alert-ic alert-ic-red">' + icon("calendar-x", "ic-5") + '</span><div class="min-w0"><div class="alert-title-row"><p class="alert-title-red">Missed appointment</p>' + badge("red", "Missed") + "</div>";
      html += '<p class="alert-line-red">' + esc(fmtFullDateTime(missed.scheduledForIso)) + "</p>";
      if (missed.reason) html += '<p class="alert-reason">' + esc(missed.reason) + "</p>";
      html += '<p class="alert-foot">The AI voice agent is checking in with the patient to rebook.</p></div></div>';
    } else if (booked) {
      html += markerAutoCallCard(st);
    }

    html += '<section class="card"><div class="card-head"><h2 class="card-title">' + icon("calendar-clock", "ic-4 tone-brand-700") + '<span class="t-label">Available times' + (slots.length > 0 ? " (" + slots.length + ")" : "") + '</span></h2></div><div class="card-body">';    if (slots.length === 0) {
      html += '<div class="empty"><div class="empty-ic">' + icon("calendar-clock", "ic-5") + '</div><p class="empty-title">No available slots</p><p class="empty-hint">Adjust calling hours in Settings to regenerate the clinic\u2019s availability.</p></div>';
    } else {
      html += '<div class="slot-grid">';
      for (i = 0; i < slots.length; i++) {
        var s = slots[i];
        html += '<div class="slot-card' + (s.id === selectedId ? " selected" : "") + '"><div class="slot-head"><p class="slot-clinician">' + esc(s.clinicianName) + "</p>" + badge(s.kind === "new-patient" ? "sky" : "brand", s.kind === "new-patient" ? "New patient" : "Follow-up") + "</div>";
        html += '<p class="slot-time">' + esc(fmtDayLabel(s.startsAtIso)) + " \u00b7 " + esc(fmtTime12(s.startsAtIso)) + "</p>";
        html += '<p class="slot-sub">' + (s.id === selectedId ? "Selected by patient" : "30-minute visit") + "</p></div>";
      }
      html += "</div>";
    }
    html += "</div></section>";

    if (booked) {
      var bClinician = clinicianForAppointment(st, booked);
      var preCall = missed === null;
      var title = preCall ? "Appointment on the books" : "New appointment booked";
      var footer = preCall ? "Saved on file with the patient\u2019s phone number \u2014 the AI agent checks in if it\u2019s missed." : "Written back to the scheduling system by the voice agent.";
      html += '<div class="alert alert-emerald"><span class="alert-ic alert-ic-emerald">' + icon("calendar-check", "ic-5") + '</span><div class="min-w0"><div class="alert-title-row"><p class="alert-title-emerald">' + title + "</p>" + badge("emerald", preCall ? "On the books" : "Booked") + "</div>";
      html += '<p class="alert-line-emerald">' + esc(fmtDayLabel(booked.scheduledForIso)) + " at " + esc(fmtTime12(booked.scheduledForIso)) + (bClinician ? " \u00b7 " + esc(bClinician) : "") + "</p>";
      html += '<p class="alert-foot-emerald">' + footer + "</p></div></div>";
    }

    html += '<section class="card"><div class="card-head"><h2 class="card-title">' + icon("message-square-text", "ic-4 tone-brand-700") + '<span class="t-label">SMS confirmation</span></h2></div><div class="card-body">';
    if (st.sms.length === 0) {
      html += '<div class="empty"><div class="empty-ic">' + icon("message-square-text", "ic-5") + '</div><p class="empty-title">No messages yet</p><p class="empty-hint">The agent sends a confirmation text as soon as the new appointment is booked.</p></div>';
    } else {
      for (i = 0; i < st.sms.length; i++) html += renderSms(st.sms[i]);
    }
    html += "</div></section>";

    el("view-scheduling").innerHTML = html;
    if (booked && !missed && el("btn-missed")) {
      el("btn-missed").addEventListener("click", function () {
        var btn = el("btn-missed");
        btn.disabled = true;
        btn.innerHTML = icon("loader-circle", "ic-4 spin") + "Auto-calling\u2026";
        post("/api/demo/missed-call", {}).then(function (res) {
          if (res && res.ok) { actionError = null; fetchOnce(); return null; }
          actionError = res && res.body && typeof res.body.error === "string" ? res.body.error : "Could not start the missed-visit call — try again.";
          btn.disabled = false;
          btn.innerHTML = icon("phone-call", "ic-4") + "Mark missed & auto-call now";
          return null;
        });
      });
    }
  }

  function renderRecord(st) {
    var hasAnything = false; var i;
    for (i = 0; i < st.calls.length; i++) { if (st.calls[i].events.length > 0) { hasAnything = true; break; } }
    var head = '<section class="card"><div class="card-head"><h2 class="card-title">' + icon("user-round", "ic-4 tone-brand-700") + '<span class="t-label">Patient record \u2014 ' + esc(st.patient.fullName) + "</span></h2></div><div class=\"card-body\">";
    if (st.appointments.length === 0) {
      el("view-record").innerHTML = head + '<div class="empty"><div class="empty-ic">' + icon("user-round", "ic-5") + '</div><p class="empty-title">No visit on file yet</p><p class="empty-hint">Book an appointment on the Scheduling tab \u2014 then the intake booking, the missed-visit call, the SMS, and the escalation all appear here.</p></div></div></section>';
      return;
    }
    if (!hasAnything && st.sms.length === 0 && st.escalations.length === 0) {
      el("view-record").innerHTML = head + '<div class="empty"><div class="empty-ic">' + icon("phone-call", "ic-5") + '</div><p class="empty-title">No calls yet</p><p class="empty-hint">Start the demo to see the visit history: the call, the rebooking, the SMS, and the escalation.</p></div></div></section>';
      return;
    }
    var entries = [];
    var nurseConnectedAt = null;
    var evs = allEvents(st);
    for (i = 0; i < evs.length; i++) {
      var ev = evs[i];
      if (ev.kind === "transfer.connected") nurseConnectedAt = ev.atIso;
      if (ev.kind === "transcript.agent" || ev.kind === "transcript.patient") {
        var isAgent = ev.kind === "transcript.agent";
        var nurseSpeaking = isAgent && nurseConnectedAt && ev.atIso >= nurseConnectedAt;
        var speaker = isAgent ? (nurseSpeaking ? "Nurse Priya \u00b7 " + BRAND + " staff" : "Ava \u00b7 AI voice agent") : st.patient.fullName + " \u00b7 Patient";
        entries.push({
          at: ev.atIso,
          html: '<div class="tl-node"><span class="tl-ic ' + (isAgent ? "tl-ic-slate" : "tl-ic-brand") + '">' + icon(isAgent ? "message-square-text" : "user", "ic-4") + '</span><div class="tl-body"><p class="tl-speaker ' + (isAgent ? "speaker-agent" : "speaker-patient") + '">' + esc(speaker) + '</p><p class="tl-text">' + esc(ev.text || "") + '</p><p class="tl-time">' + esc(fmtClock(ev.atIso)) + "</p></div></div>"
        });
        continue;
      }
      if (ev.kind === "escalation.raised") {
        var escObj = null; var k;
        for (k = 0; k < st.escalations.length; k++) { if (st.escalations[k].id === (ev.data ? ev.data.escalationId : undefined)) { escObj = st.escalations[k]; break; } }
        if (escObj) entries.push({ at: ev.atIso, html: renderEscalationCard(escObj) });
        continue;
      }
      var m = META[ev.kind];
      if (!m) continue;
      entries.push({
        at: ev.atIso,
        html: '<div class="tl-node"><span class="tl-ic ' + m.ics + '">' + icon(m.ic, "ic-4") + '</span><div class="tl-body"><p class="tl-label ' + m.tone + '">' + esc(m.label) + '</p><p class="tl-time">' + esc(fmtClock(ev.atIso)) + "</p></div></div>"
      });
    }
    for (i = 0; i < st.appointments.length; i++) {
      var appt = st.appointments[i];
      if (appt.status !== "booked") continue;
      var slot = appt.slotId ? findSlotById(st, appt.slotId) : undefined;
      var selection = null;
      for (var k2 = 0; k2 < evs.length; k2++) {
        if (evs[k2].kind === "slot.selected" && evs[k2].data && evs[k2].data.slotId === appt.slotId) selection = evs[k2];
      }
      var at = selection ? selection.atIso : (entries.length > 0 ? entries[entries.length - 1].at : appt.scheduledForIso);
      entries.push({
        at: at,
        html: '<div class="tl-node"><span class="tl-ic tl-ic-emerald">' + icon("calendar-check", "ic-4") + '</span><div class="tl-body"><div class="alert-title-row"><p class="tl-label label-emerald">Appointment booked</p>' + badge("emerald", "Booked") + '</div><p class="tl-text">' + esc(fmtDayLabel(appt.scheduledForIso)) + " at " + esc(fmtTime12(appt.scheduledForIso)) + (slot ? " with " + esc(slot.clinicianName) : "") + '</p><p class="tl-time">' + esc(fmtClock(at)) + "</p></div></div>"
      });
    }
    for (i = 0; i < st.sms.length; i++) {
      var sms = st.sms[i];
      entries.push({
        at: sms.createdAtIso,
        html: '<div class="tl-node"><span class="tl-ic tl-ic-brand">' + icon("message-square-text", "ic-4") + '</span><div class="tl-body"><div class="alert-title-row"><p class="tl-label label-brand">Confirmation text sent to ' + esc(fmtPhoneMasked(sms.toE164)) + '</p><span class="badge ' + (sms.status === "delivered" ? "badge-emerald" : sms.status === "failed" ? "badge-red" : "badge-sky") + '">' + esc(sms.status) + '</span></div><p class="tl-time">' + esc(fmtClock(sms.createdAtIso)) + "</p></div></div>"
      });
    }
    entries.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    var html = head + '<div class="tl">';
    for (i = 0; i < entries.length; i++) html += entries[i].html;
    html += "</div></div></section>";
    el("view-record").innerHTML = html;
  }

  function renderCallPanel(st) {
    var events = allEvents(st);
    var latest = st.calls.length > 0 ? st.calls[st.calls.length - 1] : null;
    var statusHtml = "";
    if (latest && CALL_STATUS[latest.status]) {
      var cs = CALL_STATUS[latest.status];
      statusHtml = dot(cs.tone, cs.pulse) + '<span class="panel-label">' + cs.label + "</span>";
    }
    el("panel-status").innerHTML = statusHtml;

    var rail = "";
    for (var i = 0; i < RAIL.length; i++) {
      var p = RAIL[i];
      var isCurrent = p === st.phase;
      var isStopped = p === "stopped" && st.phase === "stopped";
      var isDone = st.phase !== "stopped" && p !== "stopped" && RAIL.indexOf(p) < RAIL.indexOf(st.phase);
      var dotCls = isStopped ? "rd-red" : isCurrent ? "rd-brand" : isDone ? "rd-brand-300" : "rd-slate-300";
      var labelCls = isCurrent ? "rail-label rail-current" : (isDone || isStopped) ? "rail-label rail-done" : "rail-label";
      rail += '<div class="rail-item"><span class="rail-dot ' + dotCls + '"></span><span class="' + labelCls + '">' + PHASE_LABEL[p] + "</span></div>";
    }
    el("rail").innerHTML = rail;

    var transcript = el("transcript");
    var prevScroll = transcript.scrollTop;
    var count = events.length;
    var inner = "";
    if (count === 0) {
      inner = '<div class="transcript-empty"><div class="empty-ic">' + icon("phone-call", "ic-5") + '</div><p class="empty-title">No calls yet</p><p class="empty-hint">Once the visit is marked missed, the AI agent auto-calls \u2014 the transcript streams here.</p></div>';
    } else {
      var nurseConnectedAt = null;
      for (var j = 0; j < events.length; j++) {
        var ev = events[j];
        if (ev.kind === "transfer.connected") nurseConnectedAt = ev.atIso;
        if (ev.kind === "transcript.agent" || ev.kind === "transcript.patient") {
          var isAgent = ev.kind === "transcript.agent";
          var nurseSpeaking = isAgent && nurseConnectedAt && ev.atIso >= nurseConnectedAt;
          var label = isAgent ? (nurseSpeaking ? "Nurse Priya \u00b7 " + BRAND + " staff" : "Ava \u00b7 AI voice agent") : st.patient.fullName + " \u00b7 Patient";
          var accent = isAgent ? (nurseSpeaking ? "bb-emerald lbl-emerald" : "bb-slate lbl-slate") : "bb-brand lbl-brand";
          inner += '<div class="bubble-row ' + (isAgent ? "row-left" : "row-right") + '"><div class="bubble ' + accent.split(" ")[0] + (isAgent ? " bl-left" : " bl-right") + '"><p class="bubble-label ' + accent.split(" ")[1] + '">' + esc(label) + '</p><p class="bubble-text">' + esc(ev.text || "") + "</p></div></div>";
          continue;
        }
        var chip = CHIPS[ev.kind];
        if (!chip) continue;
        var chipText = chip.text;
        if (ev.kind === "call.initiated" && ev.data && typeof ev.data.to === "string") chipText = "Calling " + fmtPhoneMasked(ev.data.to);
        if (ev.kind === "slot.selected" && ev.data && typeof ev.data.slotId === "string") {
          var chosenSlot = findSlotById(st, ev.data.slotId);
          if (chosenSlot) chipText = "Selected: " + fmtDayLabel(chosenSlot.startsAtIso) + " " + fmtTime12(chosenSlot.startsAtIso);
        }
        inner += '<div class="syschip"><span class="syschip-inner ' + chip.tone + '">' + icon(chip.ic, "ic-3") + esc(chipText) + "</span></div>";
      }
    }
    transcript.innerHTML = inner;
    if (count !== lastEventCount) {
      lastEventCount = count;
      transcript.scrollTop = transcript.scrollHeight;
    } else {
      transcript.scrollTop = prevScroll;
    }
  }

  function toForm(settings) {
    return {
      hs: settings.callingHours.start,
      he: settings.callingHours.end,
      sp: settings.staffPhoneE164,
      fp: settings.fromNumberE164 || "",
      tp: settings.targetPhoneE164 || ""
    };
  }
  function currentForm() {
    return { hs: el("hours-start").value, he: el("hours-end").value, sp: el("staff-phone").value, fp: el("from-phone").value, tp: el("target-phone").value };
  }
  function isDirty() {
    if (!S.server) return false;
    var f = toForm(S.server); var c = currentForm();
    return c.hs !== f.hs || c.he !== f.he || c.sp !== f.sp || c.fp !== f.fp || c.tp !== f.tp;
  }
  function applyForm(settings) {
    var f = toForm(settings);
    el("hours-start").value = f.hs;
    el("hours-end").value = f.he;
    el("staff-phone").value = f.sp;
    el("from-phone").value = f.fp;
    el("target-phone").value = f.tp;
  }
  function mapErrors(errors) {
    var known = ["callingHours.start", "callingHours.end", "staffPhoneE164", "fromNumberE164", "targetPhoneE164"];
    var mapped = {};
    for (var i = 0; i < errors.length; i++) {
      var key = errors[i].split(":")[0].trim();
      if (known.indexOf(key) >= 0) mapped[key] = errors[i];
      else mapped.general = mapped.general ? mapped.general + "; " + errors[i] : errors[i];
    }
    return mapped;
  }

  function buildSettings(st) {
    var f = toForm(st.settings);
    var html = '<section class="card"><div class="card-head"><h2 class="card-title">' + icon("settings-2", "ic-4 tone-brand-700") + '<span class="t-label">Clinic settings</span></h2></div><div class="card-body">';
    html += '<p class="settings-note">Changes take effect immediately \u2014 available slot times and the warm-transfer target are regenerated.</p>';
    html += '<form id="settings-form" class="form-grid" novalidate>';
    html += '<div><label class="lbl" for="hours-start">Calling hours \u2014 start</label><input id="hours-start" type="time" class="input" value="' + esc(f.hs) + '"><p class="field-err" id="err-callingHours.start" hidden></p></div>';
    html += '<div><label class="lbl" for="hours-end">Calling hours \u2014 end</label><input id="hours-end" type="time" class="input" value="' + esc(f.he) + '"><p class="field-err" id="err-callingHours.end" hidden></p></div>';
    html += '<div class="span2"><label class="lbl" for="staff-phone">Staff / nurse number (warm transfer)</label><input id="staff-phone" type="text" inputmode="tel" placeholder="+15555550188" class="input" value="' + esc(f.sp) + '"><p class="field-err" id="err-staffPhoneE164" hidden></p></div>';
    html += '<div><label class="lbl" for="from-phone">Clinic from number (live mode)</label><input id="from-phone" type="text" inputmode="tel" placeholder="Optional in mock mode" class="input" value="' + esc(f.fp) + '"><p class="field-err" id="err-fromNumberE164" hidden></p></div>';
    html += '<div><label class="lbl" for="target-phone">Patient phone (live mode)</label><input id="target-phone" type="text" inputmode="tel" placeholder="Optional in mock mode" class="input" value="' + esc(f.tp) + '"><p class="field-err" id="err-targetPhoneE164" hidden></p></div>';
    html += '<p class="err-box span2" id="settings-general" hidden>' + icon("triangle-alert", "ic-4") + '<span id="settings-general-text"></span></p>';
    html += '<div class="form-foot span2"><span id="settings-status" class="status-note"></span><button type="submit" class="btn btn-primary btn-save" id="settings-save">Save settings</button></div>';
    html += "</form></div></section>";
    el("view-settings").innerHTML = html;
    S.built = true;
    ["hours-start", "hours-end", "staff-phone", "from-phone", "target-phone"].forEach(function (id) {
      el(id).addEventListener("input", renderSettingsUI);
    });
    el("settings-form").addEventListener("submit", onSaveSettings);
    renderSettingsUI();
  }

  function renderSettingsUI() {
    if (!S.built) return;
    ["callingHours.start", "callingHours.end", "staffPhoneE164", "fromNumberE164", "targetPhoneE164"].forEach(function (key) {
      var p = el("err-" + key);
      var msg = S.errors[key];
      if (msg) { p.textContent = msg; p.hidden = false; } else { p.textContent = ""; p.hidden = true; }
    });
    var general = el("settings-general");
    if (S.errors.general) { el("settings-general-text").textContent = S.errors.general; general.hidden = false; }
    else { general.hidden = true; }
    var dirty = isDirty();
    var status = el("settings-status");
    if (S.saved) status.innerHTML = '<span class="status-saved">' + icon("circle-check", "ic-4") + "Saved \u2014 slots regenerated</span>";
    else status.textContent = dirty ? "Unsaved changes" : "All changes saved";
    var save = el("settings-save");
    save.disabled = S.submitting || !dirty;
    save.innerHTML = (S.submitting ? icon("loader-circle", "ic-4 spin") : "") + "Save settings";
  }

  function syncSettings(st) {
    var json = JSON.stringify(st.settings);
    S.server = st.settings;
    if (S.savedEcho && json === S.savedEcho) { S.saved = false; S.savedEcho = null; }
    if (json !== S.synced) {
      S.synced = json;
      S.errors = {};
      if (!isDirty()) applyForm(st.settings);
    }
    renderSettingsUI();
  }

  function onSaveSettings(event) {
    event.preventDefault();
    if (S.submitting || !isDirty()) return;
    S.submitting = true;
    S.errors = {};
    S.saved = false;
    renderSettingsUI();
    var partial = {
      callingHours: { start: el("hours-start").value, end: el("hours-end").value },
      staffPhoneE164: el("staff-phone").value
    };
    // Send empty strings deliberately so an operator can clear optional live
    // numbers instead of leaving the previous value persisted on the server.
    partial.fromNumberE164 = el("from-phone").value.trim();
    partial.targetPhoneE164 = el("target-phone").value.trim();
    post("/api/settings", partial).then(function (res) {
      S.submitting = false;
      if (res === null) {
        S.errors = { general: "Could not reach the demo server \u2014 try again." };
      } else if (!res.ok) {
        if (res.status === 422 && res.body && Array.isArray(res.body.errors)) S.errors = mapErrors(res.body.errors);
        else S.errors = { general: "Could not reach the demo server \u2014 try again." };
      } else {
        S.saved = true;
        S.errors = {};
        S.synced = JSON.stringify(res.body.settings);
        S.savedEcho = S.synced;
        fetchOnce();
      }
      renderSettingsUI();
    });
  }

  function post(url, body) {
    return fetch(url, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (res) {
        if (res.status === 401) { window.location.href = "/"; return { ok: false, status: 401, body: null }; }
        return res.json().then(function (b) { return { ok: res.ok, status: res.status, body: b }; });
      })
      .catch(function () { return null; });
  }

  function act(name) {
    if (busy) return;
    busy = name;
    if (state) renderControls(state);
    var chain;
    if (name === "stop") chain = post("/api/demo/stop", {});
    else if (name === "start") chain = post("/api/demo/start", { reset: true });
    else chain = post("/api/demo/reset", {});
    chain.then(function (res) {
      if (!res || !res.ok) actionError = res && res.body && typeof res.body.error === "string" ? res.body.error : "That action could not be completed — try again.";
      else actionError = null;
      return fetchOnce();
    }).then(function () { busy = null; if (state) renderControls(state); });
  }

  function fetchOnce() {
    if (inFlight) return Promise.resolve();
    inFlight = true;
    var id = ++reqId;
    return fetch("/api/state", { cache: "no-store" })
      .then(function (res) {
        if (res.status === 401) { reqId++; window.location.href = "/"; return null; }
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (body) {
        if (id !== reqId) return;
        state = body.state;
        el("boot").hidden = true;
        el("error").hidden = true;
        el("app").hidden = false;
        renderBanner(state);
        renderHeader(state);
        renderScheduling(state);
        renderRecord(state);
        renderCallPanel(state);
        if (!S.built) buildSettings(state);
        syncSettings(state);
      })
      .catch(function (err) {
        if (id !== reqId) return;
        if (state !== null && el("panel-status")) el("panel-status").innerHTML = '<span class="tone-red-700">Connection lost — retrying…</span>';
        if (state === null) {
          el("boot").hidden = true;
          el("app").hidden = true;
          el("error").hidden = false;
          el("error-detail").textContent = err && err.message ? String(err.message) : "Failed to reach the demo server";
          stopPolling();
        }
      })
      .then(function () { inFlight = false; });
  }

  function startPolling() {
    if (pollTimer) return;
    fetchOnce();
    pollTimer = setInterval(fetchOnce, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function init() {
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (event) {
        tab = event.currentTarget.getAttribute("data-tab");
        for (var j = 0; j < tabs.length; j++) {
          var active = tabs[j].getAttribute("data-tab") === tab;
          tabs[j].classList.toggle("active", active);
          tabs[j].setAttribute("aria-selected", active ? "true" : "false");
        }
        el("view-scheduling").hidden = tab !== "scheduling";
        el("view-record").hidden = tab !== "record";
        el("view-settings").hidden = tab !== "settings";
      });
    }
    el("error-retry").addEventListener("click", function () {
      el("error").hidden = true;
      el("boot").hidden = false;
      startPolling();
    });
    el("btn-signout").addEventListener("click", function () {
      post("/api/auth/logout", {}).then(function () { window.location.href = "/"; });
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") startPolling();
      else stopPolling();
    });
    startPolling();
  }

  init();
})();
`;

export function renderLoginPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — ${escHtml(BRAND_NAME)} Patient Access</title>
<link rel="icon" href="${FAVICON}">
<style>${CSS}</style>
</head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <!-- LOGO SVG BLOCK: the same mark as the dashboard's header -->
    <svg class="login-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--brand)"></rect><path d="M5 17h4l2-5 4 9 3-6 2 2h7" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>
    <!-- END LOGO SVG BLOCK -->
    <p class="login-brand">${escHtml(BRAND_NAME)}</p>
    <h1 class="login-title" id="login-title">Sign in</h1>
    <p class="login-sub">Welcome to the clinic scheduling console</p>
    <form id="login-form" class="login-form" novalidate>
      <label class="lbl" for="login-email">Work email</label>
      <input id="login-email" type="email" class="input" autocomplete="username" placeholder="you@hospital.org">
      <label class="lbl" for="login-password">Password</label>
      <input id="login-password" type="password" class="input" autocomplete="current-password" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;">
      <p class="login-err" id="login-err" hidden></p>
      <button type="submit" id="login-submit" class="btn btn-primary btn-login">Sign in</button>
    </form>
    <p class="login-foot">Synthetic demo data only — no real PHI. Patient numbers entered here are never called in mock mode.</p>
  </div>
</div>
<script>${LOGIN_JS}</script>
</body>
</html>`;
}

export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(BRAND_NAME)} — Patient Access</title>
<link rel="icon" href="${FAVICON}">
<style>${CSS}</style>
</head>
<body>
<div id="screen">
  <div id="boot" class="boot">
    <svg class="boot-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h2.28"/></svg>
    <p class="boot-text">Connecting to ${escHtml(BRAND_NAME)}&#8230;</p>
  </div>
  <div id="error" class="boot" hidden>
    <p class="boot-err-title">Could not reach the demo server.</p>
    <p class="boot-err-detail" id="error-detail"></p>
    <button type="button" class="boot-retry" id="error-retry">Retry</button>
  </div>
  <div id="app" hidden>
    <div id="mode-banner"></div>
    <header class="site-header">
      <div class="header-inner">
        <div class="brand-row">
          <!-- LOGO SVG BLOCK: swap this SVG to rebrand the demo -->
          <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--brand)"></rect><path d="M5 17h4l2-5 4 9 3-6 2 2h7" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>
          <!-- END LOGO SVG BLOCK -->
          <div class="min-w0">
            <p class="brand-name">${escHtml(BRAND_NAME)}</p>
            <p class="brand-sub" id="patient-line"></p>
          </div>
        </div>
        <div class="header-right">
          <span id="phase-chip"></span>
          <div id="controls" class="controls"></div>
          <button type="button" class="btn btn-ghost" id="btn-signout" title="End this session">Sign out</button>
        </div>
      </div>
    </header>
    <nav class="tabs" aria-label="Sections">
      <div class="tabs-inner" role="tablist">
        <button type="button" class="tab active" role="tab" aria-selected="true" aria-controls="view-scheduling" data-tab="scheduling"><svg class="ic-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3"/><path d="M10 2v4"/><path d="M16 2v4"/><circle cx="17" cy="17" r="5"/><path d="M17 15v2h2"/></svg>Scheduling</button>
        <button type="button" class="tab" role="tab" aria-selected="false" aria-controls="view-record" data-tab="record"><svg class="ic-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="5"/></svg>Patient Record</button>
        <button type="button" class="tab" role="tab" aria-selected="false" aria-controls="view-settings" data-tab="settings"><svg class="ic-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>Settings</button>
      </div>
    </nav>
    <main class="main">
      <section id="view-scheduling" class="col" role="tabpanel" aria-label="Scheduling" tabindex="0"></section>
      <section id="view-record" class="col" role="tabpanel" aria-label="Patient Record" tabindex="0" hidden></section>
      <section id="view-settings" class="col" role="tabpanel" aria-label="Settings" tabindex="0" hidden></section>
      <aside class="aside" id="call-panel">
        <section class="card">
          <div class="card-head">
            <h2 class="card-title"><svg class="ic-4 tone-brand-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span class="t-label">Call activity</span></h2>
            <span id="panel-status" class="panel-status" role="status" aria-live="polite"></span>
          </div>
          <div class="card-body-tight">
            <div class="rail" id="rail"></div>
            <div class="transcript" id="transcript" aria-live="polite" aria-atomic="false"></div>
          </div>
        </section>
      </aside>
    </main>
  </div>
</div>
<script>window.__BRAND__=${brandJson};</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}
