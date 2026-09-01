"""Single-file demo launcher for the webhook-aggregator-fanout sample.

Serves a polished dashboard at http://localhost:5555/ that drives the real
aggregator pipeline (receive -> verify -> dedup -> log -> fanout -> process)
with locally-signed Ed25519 test webhooks. No Telnyx credentials or ngrok.

Run from the webhook-aggregator-fanout/ directory:
    python demo/demo_server.py
"""

import base64
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone

# Gotcha: `python demo/demo_server.py` puts demo/ (not the project root) on sys.path.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# Configure a hermetic demo environment BEFORE importing the aggregator so
# its module-level load_dotenv() and Telnyx() construction succeed offline.
os.environ.setdefault("TELNYX_API_KEY", "demo_dummy_key_no_real_calls")
os.environ.setdefault("DB_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo_events.db"))

from nacl.signing import SigningKey
from flask import Response, jsonify, request

# Import the aggregator's Flask app and the shared telnyx client. This wires
# /webhooks, /health, /events, /queues onto the same app we extend below.
from app import app, telnyx_client, init_db, DB_PATH


# --- Ed25519 keypair: generated ONCE at module load -------------------------
# The public key is injected into telnyx_client so the aggregator's signature
# verification accepts our locally-signed webhooks.
_signing_key = SigningKey.generate()
_public_key_b64 = base64.b64encode(bytes(_signing_key.verify_key)).decode("ascii")
telnyx_client.public_key = _public_key_b64


# --- Stub the Telnyx API surface so no real network calls leave the demo ----
# process_call_action / process_sms_action call these methods; we replace them
# with no-op stubs so the queue worker drains instantly without HTTP.
class _StubCalls:
    def answer(self, **kwargs):
        app.logger.info("[demo] calls.answer -> %s", kwargs.get("call_control_id"))

    def playback_start(self, **kwargs):
        app.logger.info("[demo] calls.playback_start -> %s", kwargs.get("call_control_id"))


class _StubMessages:
    def create(self, **kwargs):
        app.logger.info("[demo] messages.create -> %s -> %s", kwargs.get("from_"), kwargs.get("to"))


telnyx_client.calls = _StubCalls()
telnyx_client.messages = _StubMessages()


# --- Fresh SQLite database for each demo run --------------------------------
if os.path.exists(DB_PATH):
    try:
        os.remove(DB_PATH)
    except OSError:
        pass
init_db()


# --- Default payloads (used when the dashboard omits one) -------------------
def _default_payload(event_type):
    if "message" in event_type or "sms" in event_type:
        return {
            "from": "+15555550100",
            "to": "+15555550199",
            "text": "Demo inbound SMS",
        }
    return {"call_control_id": "call_demo_" + uuid.uuid4().hex[:8]}


# --- /demo/send: build, sign, and dispatch a Telnyx-shaped webhook ----------
@app.route("/demo/send", methods=["POST"])
def demo_send():
    body = request.get_json(silent=True) or {}
    event_type = body.get("event_type", "call.answered")
    payload = body.get("payload") or _default_payload(event_type)
    event_id = body.get("event_id") or str(uuid.uuid4())

    envelope = {
        "data": {
            "id": event_id,
            "event_type": event_type,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }
    }
    raw_body = json.dumps(envelope)
    timestamp = str(int(time.time()))
    signed = f"{timestamp}|{raw_body}".encode("utf-8")
    signature = base64.b64encode(_signing_key.sign(signed).signature).decode("ascii")

    headers = {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
        "content-type": "application/json",
    }

    # Dispatch in-process via the test client: no network, no extra socket.
    with app.test_client() as client:
        resp = client.post("/webhooks", data=raw_body, headers=headers)

    try:
        handler_response = resp.get_json()
    except Exception:
        handler_response = {"raw": resp.data.decode("utf-8", errors="replace")}

    return jsonify({
        "event_id": event_id,
        "event_type": event_type,
        "status_code": resp.status_code,
        "handler_response": handler_response,
    })


# --- Dashboard --------------------------------------------------------------
HTML_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Webhook Aggregator · Telnyx</title>
<style>
:root{--ink:#101014;--paper:#f5f3eb;--card:#fff;--line:#dcd8ca;--green:#00e3aa;--blue:#3434ef;--orange:#ff7043;--red:#d73535;--muted:#6b6a63;--soft:#e9fbf6;--shadow:0 18px 48px rgba(16,16,20,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh}button{font:inherit}
.topbar{height:68px;padding:0 4vw;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:11px;font-size:21px;font-weight:850;letter-spacing:-.04em}.brandmark{width:25px;height:25px;background:var(--green);clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)}.runtime{font:12px ui-monospace,monospace;color:#bbb}.runtime i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 11px var(--green);margin-right:8px}
main{max-width:1450px;margin:auto;padding:30px 4vw 50px}.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;margin-bottom:24px}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.14em;font-weight:850;color:var(--blue);margin-bottom:8px}.hero h1{font-size:clamp(34px,4.5vw,62px);line-height:.98;letter-spacing:-.06em;margin:0;max-width:840px}.hero h1 em{font-style:normal;color:var(--blue)}.subtitle{max-width:720px;color:var(--muted);line-height:1.5;margin:14px 0 0}
.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.btn{border:0;border-radius:12px;background:var(--green);color:var(--ink);font-weight:850;padding:14px 20px;cursor:pointer;box-shadow:0 8px 24px rgba(0,227,170,.22);white-space:nowrap;transition:transform .12s}.btn:hover{transform:translateY(-2px)}.btn:disabled{opacity:.55;transform:none;cursor:wait}.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line);box-shadow:none}.btn.dupe{background:var(--orange);color:#fff;box-shadow:0 8px 24px rgba(255,112,67,.22)}
.shell{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(350px,.65fr);gap:19px}.panel{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}.panelhead{display:flex;align-items:center;justify-content:space-between;padding:16px 19px;border-bottom:1px solid var(--line)}.panelhead h2{font-size:14px;margin:0}.badge{font:800 10px ui-monospace,monospace;padding:5px 9px;border-radius:20px;background:#eee;color:var(--muted)}
.journey{padding:24px 4px 10px}.steps{display:grid;grid-template-columns:repeat(6,1fr);position:relative;gap:9px}.steps:before{content:"";height:2px;background:var(--line);position:absolute;left:5%;right:5%;top:19px}.step{position:relative;text-align:center}.dot{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;margin:auto;background:#eee;border:4px solid #fff;box-shadow:0 0 0 1px var(--line);font-size:12px;font-weight:900;position:relative;z-index:1}.step.done .dot{background:var(--green);box-shadow:0 0 0 1px var(--green)}.step.active .dot{background:var(--blue);color:#fff;box-shadow:0 0 0 7px rgba(52,52,239,.1);animation:pulse 1.2s infinite}@keyframes pulse{50%{box-shadow:0 0 0 11px rgba(52,52,239,.05)}}.step b{display:block;text-transform:capitalize;font-size:11px;margin-top:9px}.step small{color:var(--muted);font-size:9px}
.events{padding:0 18px 18px}.events table{width:100%;border-collapse:collapse;font-size:12px}.events th{text-align:left;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-size:9px;font-weight:850;padding:8px 10px;border-bottom:1px solid var(--line)}.events td{padding:10px;border-bottom:1px solid #ece9df;font:12px ui-monospace,monospace;vertical-align:top}.empty{padding:30px 10px;text-align:center;color:#999;font-size:12px}
.side{display:flex;flex-direction:column;gap:19px}.sidecard{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}.row{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #ece9df}.row:last-child{border-bottom:0}.row label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:850}.row strong{font-size:24px;letter-spacing:-.05em}.row .qsize{font:800 18px ui-monospace,monospace;color:var(--blue)}.health-ok{color:#008d6b}.meta{font:10px ui-monospace,monospace;color:var(--muted);padding:12px 18px;background:#fafaf5}
.notice{margin:0 18px 18px;padding:12px;border-radius:10px;background:var(--soft);color:#07664f;font-size:11px;line-height:1.45}.notice.warn{background:#fff0ed;color:#9d2817}
@media(max-width:1050px){.hero{align-items:flex-start;flex-direction:column}.shell{grid-template-columns:1fr}}@media(max-width:750px){.steps{grid-template-columns:repeat(3,1fr);gap:16px}.controls{width:100%}.btn{flex:1}}
</style></head><body>
<header class="topbar"><div class="brand"><span class="brandmark"></span>telnyx</div><div class="runtime"><i></i>WEBHOOK AGGREGATOR · LOCAL DEMO</div></header>
<main>
<section class="hero"><div><div class="eyebrow">Webhook pipeline orchestration</div><h1>The webhook is the <em>unit of work.</em></h1><p class="subtitle">One signed Telnyx webhook flows through six production-grade stages in milliseconds: verify, dedup, log, fanout, process. No credentials, no ngrok, fully local.</p></div>
<div class="controls">
<button class="btn" id="sendCall">Send call webhook</button>
<button class="btn secondary" id="sendSms">Send SMS webhook</button>
<button class="btn dupe" id="sendDupe">Send duplicate</button>
</div></section>

<div class="shell">
<section class="panel">
<div class="panelhead"><h2>Pipeline · receive &rarr; verify &rarr; dedup &rarr; log &rarr; fanout &rarr; process</h2><span class="badge" id="statusBadge">IDLE</span></div>
<div class="journey"><div class="steps" id="steps"></div></div>
<div class="panelhead" style="border-top:1px solid var(--line)"><h2>Recent events</h2><span class="badge" id="eventCount">0 LOGGED</span></div>
<div class="events"><table><thead><tr><th>Event ID</th><th>Type</th><th>Received</th></tr></thead><tbody id="eventRows"><tr><td colspan="3" class="empty">No events yet &mdash; send a webhook to begin.</td></tr></tbody></table></div>
</section>

<aside class="side">
<div class="sidecard"><div class="panelhead"><h2>Live queue status</h2><span class="badge">IN-MEMORY</span></div>
<div class="row"><label>Call queue</label><strong class="qsize" id="callQ">0</strong></div>
<div class="row"><label>SMS queue</label><strong class="qsize" id="smsQ">0</strong></div>
<div class="row"><label>Total logged</label><strong id="totalProc">0</strong></div>
</div>
<div class="sidecard"><div class="panelhead"><h2>Service health</h2><span class="badge" id="healthBadge">CHECKING</span></div>
<div class="row"><label>Status</label><strong class="health-ok" id="healthStatus">—</strong></div>
<div class="meta" id="healthMeta">—</div>
</div>
<div class="sidecard"><div class="panelhead"><h2>Demo note</h2></div>
<div class="notice" id="notice">Demo signs webhooks locally with a generated Ed25519 key. Telnyx API calls are stubbed (no real calls or SMS sent).</div>
</div>
</aside>
</div>
</main>
<script>
const stages=['receive','verify','dedup','log','fanout','process'];
const sublabels=['POST /webhooks','ed25519 sig','TTL KV store','SQLite insert','action queue','worker pop'];
const el=id=>document.getElementById(id);
let lastEvent=null;
let animating=false;

function renderSteps(activeIdx, doneIdx){
  el('steps').innerHTML=stages.map((s,i)=>{
    let cls=i<doneIdx?'done':(i===activeIdx?'active':'');
    let dot=i<doneIdx?'\u2713':(i+1);
    return '<div class="step '+cls+'"><div class="dot">'+dot+'</div><b>'+s+'</b><small>'+sublabels[i]+'</small></div>';
  }).join('');
}
renderSteps(-1,0);

function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function shortId(id){return id?escapeHtml(id.slice(0,12)):'\u2014';}
function fmtTime(ts){try{return new Date(ts).toLocaleTimeString();}catch{return ts;}}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function setBadge(text,bg,color){el('statusBadge').textContent=text;el('statusBadge').style.background=bg;el('statusBadge').style.color=color;}

async function refresh(){
  try{
    const [ev,q,h]=await Promise.all([
      fetch('/events').then(r=>r.json()),
      fetch('/queues').then(r=>r.json()),
      fetch('/health').then(r=>r.json()),
    ]);
    const events=ev.events||[];
    el('eventCount').textContent=events.length+' LOGGED';
    el('eventRows').innerHTML=events.length
      ? events.map(e=>'<tr><td title="'+escapeHtml(e.event_id)+'">'+shortId(e.event_id)+'</td><td>'+escapeHtml(e.event_type)+'</td><td>'+fmtTime(e.received_at)+'</td></tr>').join('')
      : '<tr><td colspan="3" class="empty">No events yet &mdash; send a webhook to begin.</td></tr>';
    el('totalProc').textContent=events.length;
    el('callQ').textContent=(q.queues&&q.queues.call)?q.queues.call.size:0;
    el('smsQ').textContent=(q.queues&&q.queues.sms)?q.queues.sms.size:0;
    el('healthStatus').textContent=(h.status||'\u2014').toUpperCase();
    el('healthBadge').textContent=(h.status||'checking').toUpperCase();
    el('healthMeta').textContent=h.timestamp?('checked at '+fmtTime(h.timestamp)):'\u2014';
  }catch(e){}
}

async function animateStages(isDupe){
  animating=true;
  setBadge('PROCESSING','#dcdcff','var(--ink)');
  const last=isDupe?3:6;
  for(let i=0;i<last;i++){
    renderSteps(i,i);
    await sleep(isDupe?170:130);
  }
  if(isDupe){
    renderSteps(-1,3);
    setBadge('DUPLICATE','#fff0ed','#9d2817');
  }else{
    renderSteps(-1,6);
    setBadge('COMPLETE','#ccf9ee','#008d6b');
  }
  await sleep(650);
  renderSteps(-1,0);
  setBadge('IDLE','#eee','var(--muted)');
  animating=false;
}

async function send(eventType,payload,asDuplicate){
  if(animating)return;
  const body={event_type:eventType};
  if(asDuplicate&&lastEvent){body.event_id=lastEvent.id;body.payload=lastEvent.payload;}
  else if(payload){body.payload=payload;}
  el('notice').className='notice';
  el('notice').textContent='Sending '+eventType+'...';
  let isDupe=false;
  try{
    const r=await fetch('/demo/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const data=await r.json();
    if(!r.ok)throw new Error((data.handler_response&&data.handler_response.error)||'send failed');
    if(data.handler_response&&data.handler_response.status==='duplicate'){isDupe=true;}
    if(!asDuplicate&&data.event_id){lastEvent={id:data.event_id,type:eventType,payload:payload};}
    if(isDupe){
      el('notice').textContent='Duplicate detected \u2014 event '+shortId(data.event_id)+' was rejected by the dedup layer (TTL KV store).';
      el('notice').className='notice warn';
    }else{
      el('notice').textContent='Event '+shortId(data.event_id)+' ('+eventType+') flowed through all 6 stages.';
    }
  }catch(e){
    el('notice').className='notice warn';
    el('notice').textContent=e.message;
    setBadge('ERROR','#fff0ed','#9d2817');
    return;
  }
  await animateStages(isDupe);
  refresh();
}

el('sendCall').addEventListener('click',()=>send('call.answered',{call_control_id:'call_demo_'+Date.now()}));
el('sendSms').addEventListener('click',()=>send('message.received',{from:'+15555550100',to:'+15555550199',text:'Hi from the demo'}));
el('sendDupe').addEventListener('click',()=>{
  if(!lastEvent){
    el('notice').className='notice warn';
    el('notice').textContent='Send a webhook first, then Send duplicate will replay the same event_id.';
    return;
  }
  send(lastEvent.type,lastEvent.payload,true);
});

setInterval(refresh,600);
refresh();
</script>
</body></html>"""


@app.route("/")
def dashboard():
    return Response(HTML_PAGE, mimetype="text/html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5555, debug=False, threaded=True)
