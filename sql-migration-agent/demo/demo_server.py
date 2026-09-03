"""Single-file demo launcher for the sql-migration-agent sample.

Serves a polished dashboard at http://localhost:5555/ that drives the real
migration pipeline (queue -> fetch from CloudFS -> execute steps -> track schema
version -> SMS notify) with the Telnyx API stubbed. No Telnyx credentials or
ngrok required.

Run from the sql-migration-agent/ directory:
    python demo/demo_server.py
"""

import base64
import json
import os
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

# Gotcha: `python demo/demo_server.py` puts demo/ (not the project root) on sys.path.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# Configure a hermetic demo environment BEFORE importing the agent so its
# module-level load_dotenv() and Telnyx() construction succeed offline.
os.environ.setdefault("TELNYX_API_KEY", "demo_dummy_key_no_real_calls")
os.environ.setdefault("TELNYX_PUBLIC_KEY", "demo_dummy_key_no_real_calls")
os.environ.setdefault("TELNYX_FROM_NUMBER", "+15555550199")

from flask import Response, jsonify, request

# Import the agent's Flask app and the shared telnyx client. This wires
# /migrations, /health, /schema, /webhooks/telnyx onto the same app we extend.
from app import (
    app,
    telnyx_client,
    MIGRATION_STATE,
    SCHEMA_VERSIONS,
    run_migration,
    fetch_migration_script,
)


# --- Stub the Telnyx messages API so no real SMS leave the demo ------------
# run_migration calls telnyx_client.messages.create(...); we capture each
# call so the dashboard can show what would have been sent.
SMS_LOG: list[dict] = []
SMS_LOCK = threading.Lock()


class _StubMessages:
    def send(self, **kwargs):
        entry = {
            "id": "msg_" + uuid.uuid4().hex[:10],
            "from": kwargs.get("from_"),
            "to": kwargs.get("to"),
            "text": kwargs.get("text"),
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }
        with SMS_LOCK:
            SMS_LOG.append(entry)
        app.logger.info(
            "[demo] messages.send -> %s -> %s : %s",
            entry["from"],
            entry["to"],
            entry["text"][:60],
        )
        return type("_Msg", (), {"id": entry["id"]})()


telnyx_client.messages = _StubMessages()


# --- Ed25519 keypair: generated ONCE at module load -----------------------
# The public key is injected into telnyx_client so the webhook signature
# verification accepts our locally-signed webhook deliveries.
try:
    from nacl.signing import SigningKey

    _signing_key = SigningKey.generate()
    _public_key_b64 = base64.b64encode(bytes(_signing_key.verify_key)).decode("ascii")
    telnyx_client.public_key = _public_key_b64
    _WEBHOOK_DEMO_READY = True
except ImportError:
    _WEBHOOK_DEMO_READY = False


# --- Demo state reset -----------------------------------------------------
# Fresh migration + schema state for each demo run so the dashboard starts clean.
MIGRATION_STATE.clear()
SCHEMA_VERSIONS.clear()


# --- /demo/run: queue a migration through the real pipeline ---------------
@app.route("/demo/run", methods=["POST"])
def demo_run():
    body = request.get_json(silent=True) or {}
    migration_id = body.get("migration_id", "migration_001")
    db_name = body.get("db_name", "users_db")
    notify_phone = body.get("notify_phone", "+15555550100")

    if migration_id == "auto":
        migration_id = f"migration_{uuid.uuid4().hex[:8]}"

    if migration_id in MIGRATION_STATE:
        return jsonify({"error": f"Migration {migration_id} already exists"}), 409

    if not fetch_migration_script(migration_id):
        return (
            jsonify(
                {
                    "error": f"Unknown migration_id '{migration_id}'. "
                    "Available: migration_001, migration_002, migration_003"
                }
            ),
            400,
        )

    MIGRATION_STATE[migration_id] = {
        "id": migration_id,
        "db_name": db_name,
        "status": "queued",
        "current_step": 0,
        "total_steps": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "notify_phone": notify_phone,
    }

    # Drain the queue inline (same pattern as the real endpoint).
    run_migration(migration_id, db_name, notify_phone)

    return jsonify(
        {
            "migration_id": migration_id,
            "status": MIGRATION_STATE[migration_id]["status"],
            "schema_version": SCHEMA_VERSIONS.get(db_name, 0),
        }
    )


# --- /demo/fail: queue a migration that will fail + rollback --------------
# Injects a poisoned migration script so step execution raises, triggering
# rollback + failure SMS. Demonstrates the failure path on the dashboard.
@app.route("/demo/fail", methods=["POST"])
def demo_fail():
    body = request.get_json(silent=True) or {}
    migration_id = body.get("migration_id", f"migration_bad_{uuid.uuid4().hex[:6]}")
    db_name = body.get("db_name", "orders_db")
    notify_phone = body.get("notify_phone", "+15555550100")

    if migration_id in MIGRATION_STATE:
        return jsonify({"error": f"Migration {migration_id} already exists"}), 409

    import app as _app_module

    _original_fetch = _app_module.fetch_migration_script

    def _poisoned_fetch(mid):
        if mid == migration_id:
            # Two steps: first succeeds, second fails -> rollback runs.
            return "CREATE TABLE orders (id INT); INVALID SQL THAT WILL FAIL"
        return _original_fetch(mid)

    _app_module.fetch_migration_script = _poisoned_fetch

    MIGRATION_STATE[migration_id] = {
        "id": migration_id,
        "db_name": db_name,
        "status": "queued",
        "current_step": 0,
        "total_steps": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "notify_phone": notify_phone,
    }

    # Make step execution actually raise for the second statement.
    _original_execute = _app_module.execute_migration_step

    def _raising_execute(script, step_index):
        if "INVALID" in script:
            raise RuntimeError("Syntax error near 'INVALID': simulation")
        _original_execute(script, step_index)

    _app_module.execute_migration_step = _raising_execute

    try:
        run_migration(migration_id, db_name, notify_phone)
    finally:
        _app_module.fetch_migration_script = _original_fetch
        _app_module.execute_migration_step = _original_execute

    return jsonify(
        {
            "migration_id": migration_id,
            "status": MIGRATION_STATE[migration_id]["status"],
            "error": MIGRATION_STATE[migration_id].get("error"),
        }
    )


# --- /demo/sms: list SMS that would have been sent ------------------------
@app.route("/demo/sms", methods=["GET"])
def demo_sms():
    with SMS_LOCK:
        return jsonify({"messages": list(SMS_LOG)})


# --- /demo/webhook: build, sign, dispatch a Telnyx-shaped webhook ---------
# Demonstrates Ed25519 signature verification end-to-end. Sends a fake
# message.sent delivery-status webhook through /webhooks/telnyx.
@app.route("/demo/webhook", methods=["POST"])
def demo_webhook():
    if not _WEBHOOK_DEMO_READY:
        return (
            jsonify(
                {
                    "error": "pynacl not installed; cannot sign demo webhooks. "
                    "Run: pip install pynacl"
                }
            ),
            400,
        )

    body = request.get_json(silent=True) or {}
    message_id = body.get("message_id", "msg_" + uuid.uuid4().hex[:10])
    status = body.get("status", "delivered")

    envelope = {
        "data": {
            "id": str(uuid.uuid4()),
            "event_type": "message.sent",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "payload": {
                "id": message_id,
                "status": status,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
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

    with app.test_client() as client:
        resp = client.post("/webhooks/telnyx", data=raw_body, headers=headers)

    try:
        handler_response = resp.get_json()
    except Exception:
        handler_response = {"raw": resp.data.decode("utf-8", errors="replace")}

    return jsonify(
        {
            "message_id": message_id,
            "status_code": resp.status_code,
            "handler_response": handler_response,
        }
    )


# --- Dashboard --------------------------------------------------------------
HTML_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SQL Migration Agent · Telnyx</title>
<style>
:root{--ink:#101014;--paper:#f5f3eb;--card:#fff;--line:#dcd8ca;--green:#00e3aa;--blue:#3434ef;--orange:#ff7043;--red:#d73535;--muted:#6b6a63;--soft:#e9fbf6;--shadow:0 18px 48px rgba(16,16,20,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh}button{font:inherit}
.topbar{height:68px;padding:0 4vw;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:11px;font-size:21px;font-weight:850;letter-spacing:-.04em}.brandmark{width:25px;height:25px;background:var(--green);clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)}.runtime{font:12px ui-monospace,monospace;color:#bbb}.runtime i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 11px var(--green);margin-right:8px}
main{max-width:1450px;margin:auto;padding:30px 4vw 50px}.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;margin-bottom:24px}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.14em;font-weight:850;color:var(--blue);margin-bottom:8px}.hero h1{font-size:clamp(34px,4.5vw,62px);line-height:.98;letter-spacing:-.06em;margin:0;max-width:840px}.hero h1 em{font-style:normal;color:var(--blue)}.subtitle{max-width:720px;color:var(--muted);line-height:1.5;margin:14px 0 0}
.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.btn{border:0;border-radius:12px;background:var(--green);color:var(--ink);font-weight:850;padding:14px 20px;cursor:pointer;box-shadow:0 8px 24px rgba(0,227,170,.22);white-space:nowrap;transition:transform .12s}.btn:hover{transform:translateY(-2px)}.btn:disabled{opacity:.55;transform:none;cursor:wait}.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line);box-shadow:none}.btn.danger{background:var(--orange);color:#fff;box-shadow:0 8px 24px rgba(255,112,67,.22)}
.shell{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(350px,.65fr);gap:19px}.panel{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}.panelhead{display:flex;align-items:center;justify-content:space-between;padding:16px 19px;border-bottom:1px solid var(--line)}.panelhead h2{font-size:14px;margin:0}.badge{font:800 10px ui-monospace,monospace;padding:5px 9px;border-radius:20px;background:#eee;color:var(--muted)}
.events{padding:0 18px 18px}.events table{width:100%;border-collapse:collapse;font-size:12px}.events th{text-align:left;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-size:9px;font-weight:850;padding:8px 10px;border-bottom:1px solid var(--line)}.events td{padding:10px;border-bottom:1px solid #ece9df;font:12px ui-monospace,monospace;vertical-align:top}.empty{padding:30px 10px;text-align:center;color:#999;font-size:12px}
.status-pill{display:inline-block;padding:2px 8px;border-radius:10px;font:800 10px ui-monospace,monospace;text-transform:uppercase}.status-pill.completed{background:#ccf9ee;color:#008d6b}.status-pill.failed{background:#fff0ed;color:#9d2817}.status-pill.running{background:#dcdcff;color:#3434ef}.status-pill.queued{background:#eee;color:#6b6a63}
.side{display:flex;flex-direction:column;gap:19px}.sidecard{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}.row{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #ece9df}.row:last-child{border-bottom:0}.row label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:850}.row strong{font-size:24px;letter-spacing:-.05em}.row .qsize{font:800 18px ui-monospace,monospace;color:var(--blue)}.health-ok{color:#008d6b}.meta{font:10px ui-monospace,monospace;color:var(--muted);padding:12px 18px;background:#fafaf5}
.notice{margin:0 18px 18px;padding:12px;border-radius:10px;background:var(--soft);color:#07664f;font-size:11px;line-height:1.45}.notice.warn{background:#fff0ed;color:#9d2817}
@media(max-width:1050px){.hero{align-items:flex-start;flex-direction:column}.shell{grid-template-columns:1fr}}@media(max-width:750px){.controls{width:100%}.btn{flex:1}}
</style></head><body>
<header class="topbar"><div class="brand"><span class="brandmark"></span>telnyx</div><div class="runtime"><i></i>SQL MIGRATION AGENT · LOCAL DEMO</div></header>
<main>
<section class="hero"><div><div class="eyebrow">Schema migrations with SMS + rollback</div><h1>Migrate the schema. <em>Notify the human.</em></h1><p class="subtitle">Queue a migration, fetch the script from CloudFS, execute step-by-step, track the schema version, and SMS the result. Rollback runs on failure. No credentials, no real SMS, fully local.</p></div>
<div class="controls">
<button class="btn" id="run001">Run migration_001</button>
<button class="btn secondary" id="run002">Run migration_002</button>
<button class="btn secondary" id="run003">Run migration_003</button>
<button class="btn danger" id="runFail">Trigger failure</button>
<button class="btn secondary" id="sendWebhook">Send webhook</button>
</div></section>

<div class="shell">
<section class="panel">
<div class="panelhead"><h2>Migrations &middot; queue &rarr; fetch &rarr; execute &rarr; version &rarr; notify</h2><span class="badge" id="statusBadge">IDLE</span></div>
<div class="panelhead" style="border-top:1px solid var(--line)"><h2>Recent migrations</h2><span class="badge" id="migCount">0 RUN</span></div>
<div class="events"><table><thead><tr><th>Migration ID</th><th>DB</th><th>Status</th><th>Step</th><th>Schema v</th></tr></thead><tbody id="migRows"><tr><td colspan="5" class="empty">No migrations yet &mdash; run one to begin.</td></tr></tbody></table></div>
<div class="panelhead" style="border-top:1px solid var(--line)"><h2>SMS notifications (stubbed)</h2><span class="badge" id="smsCount">0 SENT</span></div>
<div class="events"><table><thead><tr><th>To</th><th>Message</th><th>At</th></tr></thead><tbody id="smsRows"><tr><td colspan="3" class="empty">No SMS yet.</td></tr></tbody></table></div>
</section>

<aside class="side">
<div class="sidecard"><div class="panelhead"><h2>Schema versions</h2><span class="badge">IN-MEMORY</span></div>
<div id="schemaRows"><div class="row"><label>No databases migrated yet</label><strong>&mdash;</strong></div></div>
</div>
<div class="sidecard"><div class="panelhead"><h2>Service health</h2><span class="badge" id="healthBadge">CHECKING</span></div>
<div class="row"><label>Status</label><strong class="health-ok" id="healthStatus">&mdash;</strong></div>
<div class="meta" id="healthMeta">&mdash;</div>
</div>
<div class="sidecard"><div class="panelhead"><h2>Demo note</h2></div>
<div class="notice" id="notice">Telnyx messages.create is stubbed. Ed25519 webhook signing uses a generated keypair. No real calls or SMS sent.</div>
</div>
</aside>
</div>
</main>
<script>
const el=id=>document.getElementById(id);
function escapeHtml(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function shortId(id){return id?escapeHtml(id.slice(0,20)):'\u2014';}
function fmtTime(ts){try{return new Date(ts).toLocaleTimeString();}catch{return ts;}}
function setBadge(text,bg,color){el('statusBadge').textContent=text;el('statusBadge').style.background=bg;el('statusBadge').style.color=color;}
function statusPill(s){return '<span class="status-pill '+escapeHtml(s)+'">'+escapeHtml(s)+'</span>';}

async function refresh(){
  try{
    const [m,sms,h]=await Promise.all([
      fetch('/migrations').then(r=>r.json()),
      fetch('/demo/sms').then(r=>r.json()),
      fetch('/health').then(r=>r.json()),
    ]);
    const migs=m.migrations||[];
    el('migCount').textContent=migs.length+' RUN';
    el('migRows').innerHTML=migs.length
      ? migs.map(x=>'<tr><td title="'+escapeHtml(x.id)+'">'+shortId(x.id)+'</td><td>'+escapeHtml(x.db_name)+'</td><td>'+statusPill(x.status)+'</td><td>'+(x.current_step||0)+'/'+(x.total_steps||0)+'</td><td>'+(x.schema_version||'\u2014')+'</td></tr>').join('')
      : '<tr><td colspan="5" class="empty">No migrations yet &mdash; run one to begin.</td></tr>';
    const messages=sms.messages||[];
    el('smsCount').textContent=messages.length+' SENT';
    el('smsRows').innerHTML=messages.length
      ? messages.map(x=>'<tr><td>'+escapeHtml(x.to)+'</td><td>'+escapeHtml(x.text)+'</td><td>'+fmtTime(x.sent_at)+'</td></tr>').join('')
      : '<tr><td colspan="3" class="empty">No SMS yet.</td></tr>';
    const schemas={};
    migs.forEach(x=>{if(x.schema_version!=null&&x.status==='completed')schemas[x.db_name]=Math.max(schemas[x.db_name]||0,x.schema_version);});
    const sKeys=Object.keys(schemas);
    el('schemaRows').innerHTML=sKeys.length
      ? sKeys.map(k=>'<div class="row"><label>'+escapeHtml(k)+'</label><strong class="qsize">v'+schemas[k]+'</strong></div>').join('')
      : '<div class="row"><label>No databases migrated yet</label><strong>&mdash;</strong></div>';
    el('healthStatus').textContent=(h.status||'\u2014').toUpperCase();
    el('healthBadge').textContent=(h.status||'checking').toUpperCase();
    el('healthMeta').textContent=h.timestamp?('checked at '+fmtTime(h.timestamp)):'\u2014';
  }catch(e){}
}

async function run(endpoint,label){
  setBadge('RUNNING','#dcdcff','var(--ink)');
  el('notice').className='notice';
  el('notice').textContent='Running '+label+'...';
  try{
    const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||'run failed');
    el('notice').textContent=label+' -> '+data.status+(data.error?(' ('+data.error+')'):'');
    if(data.status==='failed'){setBadge('FAILED','#fff0ed','#9d2817');el('notice').className='notice warn';}
    else if(data.status==='completed'){setBadge('COMPLETE','#ccf9ee','#008d6b');}
    else{setBadge(data.status.toUpperCase(),'#eee','var(--muted)');}
  }catch(e){
    el('notice').className='notice warn';
    el('notice').textContent=e.message;
    setBadge('ERROR','#fff0ed','#9d2817');
  }
  setTimeout(()=>{setBadge('IDLE','#eee','var(--muted)');},1800);
  refresh();
}

async function sendWebhook(){
  setBadge('SIGNING','#dcdcff','var(--ink)');
  el('notice').className='notice';
  el('notice').textContent='Signing + sending webhook...';
  try{
    const r=await fetch('/demo/webhook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:'delivered'})});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||'webhook failed');
    el('notice').textContent='Webhook verified, handler returned '+data.status_code;
    setBadge('VERIFIED','#ccf9ee','#008d6b');
  }catch(e){
    el('notice').className='notice warn';
    el('notice').textContent=e.message;
    setBadge('ERROR','#fff0ed','#9d2817');
  }
  setTimeout(()=>{setBadge('IDLE','#eee','var(--muted)');},1800);
  refresh();
}

el('run001').addEventListener('click',()=>run('/demo/run','migration_001'));
el('run002').addEventListener('click',()=>run('/demo/run','migration_002'));
el('run003').addEventListener('click',()=>run('/demo/run','migration_003'));
el('runFail').addEventListener('click',()=>run('/demo/fail','failure migration'));
el('sendWebhook').addEventListener('click',sendWebhook);

setInterval(refresh,800);
refresh();
</script>
</body></html>"""


@app.route("/")
def dashboard():
    return Response(HTML_PAGE, mimetype="text/html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5555, debug=False, threaded=True)
