#!/usr/bin/env python3
"""AI Negotiation Practice Phone — practice salary negotiations, sales deals, or vendor
contracts with an AI that plays the opposing side and scores your technique.

A live dashboard at / shows the conversation in real time and the scored breakdown
after the call ends. An outbound "Call Me" button lets you start a demo from the browser.
"""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify, Response, stream_with_context
from collections import deque
import threading, time as _ttl_time

load_dotenv()
os.environ.pop("TELNYX_BASE_URL", None)
app = Flask(__name__)
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct")
PRACTICE_NUMBER = os.getenv("PRACTICE_NUMBER")
CONNECTION_ID = os.getenv("CONNECTION_ID", "")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
API_BASE = "https://api.telnyx.com/v2"
API_HEADERS = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}

def _post_action(ccid, action, body=None):
    r = requests.post(f"{API_BASE}/calls/{ccid}/actions/{action}", headers=API_HEADERS, json=body or {}, timeout=10)
    r.raise_for_status()
    return r.json() if r.content else {}

# --- Per-call state -----------------------------------------------------------
active_calls = {}
sessions = []

SCENARIOS = {
    "1": {"role": "hiring manager", "context": "The candidate wants $180K. Your budget is $155K with flexibility to $165K. Push back on experience level. You can offer equity or signing bonus as alternatives."},
    "2": {"role": "enterprise buyer", "context": "You're evaluating their SaaS product at $50K/year. You have a competing offer at $35K. Your budget is $45K. Ask for volume discounts and longer payment terms."},
    "3": {"role": "vendor account manager", "context": "The client wants to reduce their contract by 40%. They're a top-10 account. You can offer 15% discount max, or restructure the deal with different terms."},
}

# --- TTL cleanup -------------------------------------------------------------
def _start_ttl_cleanup(*stores, ttl_seconds=3600, interval=300):
    def _cleanup():
        while True:
            _ttl_time.sleep(interval)
            cutoff = _ttl_time.time() - ttl_seconds
            for store in stores:
                expired = [k for k, v in store.items()
                           if isinstance(v, dict) and v.get("_ts", _ttl_time.time()) < cutoff]
                for k in expired:
                    store.pop(k, None)
    threading.Thread(target=_cleanup, daemon=True).start()

_start_ttl_cleanup(active_calls)

# --- Live event bus (dashboard SSE) ------------------------------------------
_events: deque[dict] = deque(maxlen=200)
_subscribers: list = []
_bus_lock = threading.Lock()

def emit(kind, direction, title, text="", extra=None):
    evt = {"ts": time.time(), "kind": kind, "dir": direction, "title": title, "text": text, "extra": extra or {}}
    with _bus_lock:
        _events.append(evt)
        dead = []
        for q in _subscribers:
            try:
                q.append(evt)
            except Exception:
                dead.append(q)
        for q in dead:
            try:
                _subscribers.remove(q)
            except ValueError:
                pass

# --- AI inference ------------------------------------------------------------
def call_inference(messages, max_tokens=200):
    resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7}, timeout=15)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

# --- Webhook handler ---------------------------------------------------------
@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    p = data.get("payload", {})
    event_type = data.get("event_type")
    ccid = p.get("call_control_id")
    call = active_calls.get(ccid)
    print(f"[WEBHOOK] event={event_type} ccid={ccid} call_exists={call is not None} active_calls={list(active_calls.keys())}", flush=True)

    if event_type == "call.initiated":
        direction = p.get("direction")
        emit("webhook", "web", f"call.initiated ({direction})", text=f"ccid={ccid}")
        if direction == "incoming":
            active_calls[ccid] = {"state": "select", "conversation": [], "start": time.time(), "_ts": time.time(), "direction": "inbound"}
            _post_action(ccid, "answer")
            emit("info", "out", "Answering inbound call", text=f"ccid={ccid}")
        return jsonify({"status": "answering"}), 200

    elif event_type == "call.answered":
        if call:
            if call.get("direction") == "outbound":
                emit("webhook", "web", "call.answered (outbound)", text="Remote party picked up")
            else:
                emit("webhook", "web", "call.answered (inbound)", text="Caller connected")
            _post_action(ccid, "speak", {"payload": "Negotiation Practice! Press 1 for salary negotiation, 2 for sales deal, 3 for vendor contract.", "voice": "Telnyx.Natural.abbie", "language_code": "en-US"})
            emit("speak", "out", "Speaking greeting", text="Press 1 for salary, 2 for sales, 3 for vendor")
        return jsonify({"status": "greeting"}), 200

    elif event_type == "call.speak.ended" and call:
        if call["state"] == "select":
            _post_action(ccid, "gather", {"minimum_digits": 1, "maximum_digits": 1, "timeout_millis": 15000, "valid_digits": "123"})
            emit("gather", "out", "Gathering DTMF (scenario selection)", text="Waiting for keypress")
        else:
            _post_action(ccid, "transcription_start", {"transcription_engine": "Telnyx"})
            call["transcribing"] = True
            emit("gather", "out", "Listening for caller speech", text="Transcription started")
        return jsonify({"status": "listening"}), 200

    elif event_type == "call.dtmf.received" and call and call["state"] == "select":
        digits = p.get("digit", "")
        print(f"[DTMF] digit={repr(digits)} state={call['state']}", flush=True)
        try: _post_action(ccid, "stop_gather")
        except: pass
        scenario = SCENARIOS.get(digits, SCENARIOS["1"])
        call["state"] = "negotiating"
        call["scenario"] = scenario
        call["conversation"] = [{"role": "system", "content": f"You are a {scenario['role']} in a negotiation. {scenario['context']} Stay in character. Be firm but fair. Push back on their first offer. Keep responses under 2 sentences. After 6 exchanges, start wrapping up."}]
        emit("dtmf", "in", f"Scenario selected: {digits}", text=f"Role: {scenario['role']}")
        opening = call_inference(call["conversation"] + [{"role": "user", "content": "The negotiation begins. Make your opening position."}])
        call["conversation"].append({"role": "assistant", "content": opening})
        _post_action(ccid, "speak", {"payload": opening, "voice": "Telnyx.Natural.abbie", "language_code": "en-US"})
        emit("reply", "out", "AI opening statement", text=opening)
        return jsonify({"status": "negotiating"}), 200

    elif event_type == "call.transcription" and call and call.get("transcribing"):
        td = p.get("transcription_data", {})
        transcript = td.get("transcript", "")
        is_final = td.get("is_final", False)
        print(f"[TRANSCRIPTION] transcript={repr(transcript)} is_final={is_final}", flush=True)
        if is_final and transcript.strip():
            _post_action(ccid, "transcription_stop")
            call["transcribing"] = False
            call["conversation"].append({"role": "user", "content": transcript})
            emit("prompt", "in", "Caller spoke", text=transcript)
            response = call_inference(call["conversation"])
            call["conversation"].append({"role": "assistant", "content": response})
            _post_action(ccid, "speak", {"payload": response, "voice": "Telnyx.Natural.abbie", "language_code": "en-US"})
            emit("reply", "out", "AI reply", text=response)
        return jsonify({"status": "ok"}), 200

    elif event_type == "call.gather.ended" and call:
        return jsonify({"status": "ok"}), 200

    elif event_type == "call.hangup":
        call = active_calls.pop(ccid, None)
        if call:
            turns = len([m for m in call.get("conversation", []) if m["role"] != "system"])
            emit("info", "web", "Call ended", text=f"Duration: {int(time.time() - call['start'])}s, {turns} turns")
            session = {"scenario": call.get("scenario", {}).get("role"), "duration": int(time.time() - call["start"]), "conversation": call["conversation"]}
            sessions.append(session)
        return jsonify({"status": "ended"}), 200
    return jsonify({"status": "ok"}), 200

# --- Dashboard API -----------------------------------------------------------
@app.route("/api/call", methods=["POST"])
def place_call():
    """Place an outbound call to the phone number in the request body."""
    if not CONNECTION_ID:
        return jsonify({"error": "CONNECTION_ID not configured. Set it in .env to enable outbound calling."}), 400
    data = request.get_json(silent=True) or {}
    to_number = data.get("to", "").strip()
    if not to_number:
        return jsonify({"error": "Phone number required"}), 400
    if not to_number.startswith("+"):
        to_number = "+" + to_number
    try:
        resp = requests.post(f"{API_BASE}/calls", headers=API_HEADERS,
            json={"connection_id": CONNECTION_ID, "to": to_number, "from": PRACTICE_NUMBER, "timeout_secs": 30}, timeout=10)
        resp.raise_for_status()
        ccid = resp.json()["data"]["call_control_id"]
        active_calls[ccid] = {"state": "select", "conversation": [], "start": time.time(), "_ts": time.time(), "direction": "outbound"}
        emit("info", "out", f"Placing outbound call to {to_number}", text=f"from={PRACTICE_NUMBER}")
        return jsonify({"status": "dialing", "call_control_id": ccid, "to": to_number})
    except Exception as e:
        emit("error", "web", "Dial failed", text=str(e))
        return jsonify({"error": str(e)}), 500

@app.route("/api/active", methods=["GET"])
def get_active():
    """Return the current active call's conversation + state for the dashboard."""
    for ccid, call in active_calls.items():
        return jsonify({
            "call_control_id": ccid,
            "state": call["state"],
            "direction": call.get("direction", "inbound"),
            "scenario": call.get("scenario"),
            "conversation": [m for m in call.get("conversation", []) if m["role"] != "system"],
            "duration": int(time.time() - call["start"]),
        })
    return jsonify({"active": False})

@app.route("/sessions", methods=["GET"])
def list_sessions():
    return jsonify({"sessions": sessions[-20:]}), 200

@app.route("/api/reset", methods=["POST"])
def reset_state():
    """Clear all state — for clean re-recording of the demo."""
    with _bus_lock:
        _events.clear()
        _subscribers.clear()
    active_calls.clear()
    sessions.clear()
    return jsonify({"status": "reset"})

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "sessions": len(sessions), "active_calls": len(active_calls)}), 200

@app.route("/events")
def events():
    """Server-Sent Events stream — pushes each frame to the dashboard live."""
    q = deque(maxlen=100)
    with _bus_lock:
        _subscribers.append(q)
    def stream():
        try:
            yield "retry: 3000\n\n"
            while True:
                try:
                    evt = q.popleft()
                except IndexError:
                    yield ": keep-alive\n\n"
                    time.sleep(0.4)
                    continue
                yield f"data: {json.dumps(evt)}\n\n"
        finally:
            with _bus_lock:
                try:
                    _subscribers.remove(q)
                except ValueError:
                    pass
    return Response(stream_with_context(stream()), mimetype="text/event-stream",
                     headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# --- Dashboard HTML ----------------------------------------------------------
DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Negotiation Practice — Live Demo</title>
<style>
  :root{--bg:#0b0f14;--panel:#121821;--panel2:#0e131a;--line:#1f2a36;--ink:#e6edf3;--mut:#8b9aaa;--acc:#3b82f6;
    --in:#38bdf8;--out:#34d399;--web:#f59e0b;--err:#f87171;--dtmf:#a78bfa;--score:#fbbf24;--info:#94a3b8}
  *{box-sizing:border-box} body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:var(--bg);color:var(--ink);line-height:1.5}
  header{padding:1.1rem 1.6rem;border-bottom:1px solid var(--line);background:var(--panel)}
  header h1{margin:0;font-size:1.15rem;font-weight:600;letter-spacing:.2px}
  header h1 .tag{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;color:var(--acc);
    background:#0f1c2e;border:1px solid #14304d;padding:.15rem .45rem;border-radius:5px;margin-left:.6rem;vertical-align:middle}
  header p{margin:.35rem 0 0;color:var(--mut);font-size:.84rem}
  .flow{display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;margin-top:.55rem;font-size:.78rem}
  .flow .n{padding:.25rem .5rem;border:1px solid var(--line);border-radius:6px;background:var(--panel2);color:var(--ink)}
  .flow .n.bot{border-color:#0e3a2a;color:var(--out)} .flow .n.tel{border-color:#1c3958;color:var(--in)}
  .flow .arr{color:var(--mut);font-family:ui-monospace,monospace}
  main{display:grid;grid-template-columns:1fr 1.4fr;gap:1px;background:var(--line);min-height:calc(100vh - 100px)}
  @media(max-width:920px){main{grid-template-columns:1fr}}
  section{background:var(--bg);padding:1.1rem 1.25rem;overflow:hidden}
  .h{display:flex;align-items:center;justify-content:space-between;margin:0 0 .8rem}
  .h h2{margin:0;font-size:.82rem;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);font-weight:600}
  .pill{font-size:.7rem;color:var(--mut);border:1px solid var(--line);padding:.12rem .45rem;border-radius:20px}
  .pill.live{color:var(--out);border-color:#0e3a2a} .pill.live::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--out);margin-right:.35rem;vertical-align:middle;animation:p 1.4s infinite}
  @keyframes p{0%,100%{opacity:1}50%{opacity:.3}}

  /* Call panel */
  .call-panel{display:flex;flex-direction:column;gap:1rem}
  .input-row{display:flex;gap:.5rem}
  .input-row input{flex:1;padding:.6rem .8rem;background:var(--panel);border:1px solid var(--line);border-radius:9px;
    color:var(--ink);font-size:.9rem;font-family:inherit;outline:none}
  .input-row input:focus{border-color:var(--acc)}
  .input-row input::placeholder{color:var(--mut)}
  .btn{padding:.6rem 1.3rem;border:none;border-radius:9px;font-size:.85rem;font-weight:600;cursor:pointer;transition:opacity .15s;white-space:nowrap}
  .btn-go{background:var(--acc);color:#fff} .btn-go:hover{opacity:.88} .btn-go:disabled{opacity:.4;cursor:not-allowed}
  .btn-reset{background:var(--panel2);color:var(--mut);border:1px solid var(--line)} .btn-reset:hover{color:var(--ink)}
  .info-box{padding:.7rem .85rem;border:1px solid var(--line);border-radius:8px;background:var(--panel2);font-size:.78rem;color:var(--mut)}
  .info-box b{color:var(--ink)}
  .scenarios{display:flex;flex-direction:column;gap:.5rem;margin-top:.4rem}
  .scn{padding:.5rem .7rem;border:1px solid var(--line);border-radius:7px;background:var(--panel);font-size:.78rem}
  .scn .k{font-family:ui-monospace,monospace;color:var(--dtmf);font-weight:600;margin-right:.4rem}
  .scn .r{color:var(--out);font-weight:600}

  /* Conversation */
  #conv{display:flex;flex-direction:column;gap:.7rem;max-height:calc(100vh - 260px);overflow-y:auto;padding-right:.3rem}
  .turn{padding:.6rem .75rem;border-radius:10px;max-width:92%;font-size:.82rem;line-height:1.4}
  .turn.user{background:#11243a;border:1px solid #1c3958;align-self:flex-start}
  .turn.bot{background:#0e2418;border:1px solid #163a29;align-self:flex-end;text-align:right}
  .turn .who{font-size:.62rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin-bottom:.18rem}
  .turn.user .who{color:var(--in)} .turn.bot .who{color:var(--out)}
  .turn .txt{color:var(--ink)}
  .empty{color:var(--mut);font-size:.8rem;text-align:center;padding:2.5rem 1rem;border:1px dashed var(--line);border-radius:8px}

  /* Score card */
  .score-card{margin-top:1rem;padding:1rem 1.1rem;border:1px solid #3d3010;border-radius:12px;background:linear-gradient(135deg,#15130a,#1a1610)}
  .score-card h3{margin:0 0 .6rem;font-size:.9rem;color:var(--score)}
  .score-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;margin-bottom:.8rem}
  .sc{text-align:center;padding:.5rem;border:1px solid var(--line);border-radius:8px;background:var(--panel2)}
  .sc .v{font-size:1.4rem;font-weight:700;color:var(--score);font-family:ui-monospace,monospace}
  .sc .l{font-size:.66rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin-top:.15rem}
  .score-list{font-size:.78rem;color:var(--ink);margin-top:.4rem}
  .score-list ul{margin:.2rem 0 0;padding-left:1.1rem} .score-list li{margin-bottom:.2rem}
  .score-list .lbl{color:var(--mut);font-weight:600}

  /* Event log */
  #frames{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.76rem;display:flex;flex-direction:column;gap:.5rem;
    max-height:calc(100vh - 260px);overflow-y:auto;padding-right:.3rem}
  .row{border:1px solid var(--line);border-left:3px solid var(--line);border-radius:7px;padding:.5rem .65rem;background:var(--panel)}
  .row.in{border-left-color:var(--in)} .row.out{border-left-color:var(--out)} .row.web{border-left-color:var(--web)}
  .row.err{border-left-color:var(--err)} .row.score{border-left-color:var(--score)} .row.dtmf{border-left-color:var(--dtmf)}
  .top{display:flex;align-items:center;gap:.4rem;color:var(--mut);font-size:.68rem;margin-bottom:.2rem}
  .top .ico{font-size:.8rem} .top .t{margin-left:auto;font-family:ui-monospace,monospace}
  .ttl{color:var(--ink);font-size:.74rem;font-weight:600}
  .body{color:var(--ink);font-family:ui-monospace,monospace;font-size:.74rem;white-space:pre-wrap;word-break:break-word;margin-top:.15rem}
  .row.out .body{color:var(--out)} .row.in .body{color:var(--in)} .row.score .body{color:var(--score)}
</style></head>
<body>
<header>
  <h1>AI Negotiation Practice <span class="tag">live demo</span></h1>
  <p>Practice salary negotiations, sales deals, and vendor contracts with an AI that plays the opposing side — then scores your technique.</p>
  <div class="flow">
    <span class="n">Your phone</span><span class="arr">→</span>
    <span class="n tel">Telnyx Call Control</span><span class="arr">→</span>
    <span class="n">This app</span><span class="arr">→</span>
    <span class="n bot">AI Inference (Llama 3.3 70B)</span><span class="arr">→</span>
    <span class="n tel">TTS back to you</span>
  </div>
</header>

<main>
  <!-- Left: Call controls + score -->
  <section>
    <div class="h"><h2>Call controls</h2><span id="conn" class="pill">connecting…</span></div>
    <div class="call-panel">
      <div class="input-row">
        <input id="phoneInput" type="password" placeholder="+1 555 123 4567" autocomplete="off">
        <button class="btn btn-go" id="callBtn">Call Me</button>
      </div>
      <div class="input-row">
        <button class="btn btn-reset" id="resetBtn">Reset Demo</button>
      </div>
      <div class="info-box">
        Enter your phone number and click <b>Call Me</b>. When you pick up, the AI will ask you to choose a scenario.
        <div class="scenarios">
          <div class="scn"><span class="k">1</span><span class="r">Salary Negotiation</span> — you're the candidate, AI is the hiring manager</div>
          <div class="scn"><span class="k">2</span><span class="r">Sales Deal</span> — you're the seller, AI is the enterprise buyer</div>
          <div class="scn"><span class="k">3</span><span class="r">Vendor Contract</span> — you're the client, AI is the vendor account manager</div>
        </div>
      </div>
      <div class="info-box" id="callStatus">No active call. Click <b>Call Me</b> to start.</div>
      <div id="scoreArea"></div>
    </div>
  </section>

  <!-- Right: Conversation + event log -->
  <section>
    <div class="h"><h2>Live conversation</h2><span id="stat" class="pill">no call</span></div>
    <div id="conv"><div class="empty">Start a call to see the negotiation in real time.</div></div>
    <div class="h" style="margin-top:1.2rem"><h2>Event log</h2></div>
    <div id="frames"></div>
  </section>
</main>

<script>
const ICON={setup:"⚙️",speak:"🔊",gather:"👂",dtmf:"🔢",prompt:"🎤",reply:"💬",score:"🏆",error:"❌",webhook:"🌐",info:"ℹ️"};
const LABEL={speak:"app → Telnyx (TTS)",gather:"app → Telnyx (listen)",dtmf:"Telnyx → app (DTMF)",
  prompt:"Telnyx → app (caller speech)",reply:"app → Telnyx (AI reply)",score:"scoring complete",
  error:"error",webhook:"webhook",info:"info"};

const phoneInput=document.getElementById("phoneInput");
const callBtn=document.getElementById("callBtn");
const resetBtn=document.getElementById("resetBtn");
const connEl=document.getElementById("conn");
const statEl=document.getElementById("stat");
const convEl=document.getElementById("conv");
const framesEl=document.getElementById("frames");
const callStatusEl=document.getElementById("callStatus");
const scoreAreaEl=document.getElementById("scoreArea");
let es=null, startedAt=null;

// Reset on page load for clean demo
fetch("/api/reset",{method:"POST"}).catch(()=>{});

callBtn.addEventListener("click",async()=>{
  const to=phoneInput.value.trim();
  if(!to){phoneInput.focus();return}
  callBtn.disabled=true; callBtn.textContent="Dialing…";
  callStatusEl.innerHTML="Placing outbound call to <b>"+to+"</b>…";
  try{
    const r=await fetch("/api/call",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to})});
    const d=await r.json();
    if(d.error){callStatusEl.innerHTML="<b style='color:var(--err)'>Error:</b> "+d.error;callBtn.disabled=false;callBtn.textContent="Call Me"}
    else{callStatusEl.innerHTML="Calling <b>"+to+"</b>… Pick up your phone!";callBtn.textContent="Ringing…"}
  }catch(err){callStatusEl.innerHTML="<b style='color:var(--err)'>Network error</b>";callBtn.disabled=false;callBtn.textContent="Call Me"}
});

resetBtn.addEventListener("click",async()=>{
  await fetch("/api/reset",{method:"POST"});
  convEl.innerHTML="<div class='empty'>Demo reset. Start a new call.</div>";
  framesEl.innerHTML="";
  scoreAreaEl.innerHTML="";
  statEl.textContent="no call"; statEl.className="pill";
  startedAt=null;
  callBtn.disabled=false; callBtn.textContent="Call Me";
  callStatusEl.innerHTML="No active call. Click <b>Call Me</b> to start.";
});

function esc(s){return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}

function initSSE(){
  es=new EventSource("/events");
  es.onopen=()=>{connEl.textContent="live";connEl.className="pill live"};
  es.onerror=()=>{connEl.textContent="reconnecting…";connEl.className="pill"};
  es.onmessage=(ev)=>{
    const e=JSON.parse(ev.data);
    const d=new Date(e.ts*1000),t=d.toTimeString().slice(0,8);
    const dirCls=e.dir||"info";
    const body=e.text?`<div class="body">${esc(e.text)}</div>`:"";
    const row=`<div class="row ${dirCls}"><div class="top"><span class="ico">${ICON[e.kind]||""}</span>
      <span>${esc(LABEL[e.kind]||e.title)}</span><span class="t">${t}</span></div>
      <div class="ttl">${esc(e.title)}</div>${body}</div>`;
    framesEl.insertAdjacentHTML("beforeend",row);
    framesEl.scrollTop=framesEl.scrollHeight;
    if(e.kind==="prompt"||e.kind==="reply"||e.kind==="dtmf"||e.kind==="score"){renderState()}
  };
}

async function renderState(){
  try{
    const r=await fetch("/api/active");
    const s=await r.json();
    if(s.active===false){
      const sr=await fetch("/sessions");
      const sd=await sr.json();
      if(sd.sessions&&sd.sessions.length>0){
        const last=sd.sessions[sd.sessions.length-1];
        if(last.score){renderScore(last)}
      }
      return;
    }
    if(!startedAt&&s.duration){startedAt=Date.now()-s.duration*1000}
    const dur=Math.round((Date.now()-(startedAt||Date.now()))/1000);
    statEl.textContent=`${s.state} · ${dur}s`; statEl.className="pill live";
    callStatusEl.innerHTML=`<b>${s.state==="select"?"Selecting scenario":"Negotiating"}</b> — ${s.direction} call, ${dur}s`;
    const conv=s.conversation||[];
    if(conv.length===0){
      convEl.innerHTML="<div class='empty'>Call connected — waiting for scenario selection…</div>";
    }else{
      convEl.innerHTML=conv.map(m=>{
        const who=m.role==="user"?"You said":"AI replied";
        return `<div class="turn ${m.role==="user"?"user":"bot"}"><div class="who">${who}</div><div class="txt">${esc(m.content)}</div></div>`;
      }).join("");
      convEl.scrollTop=convEl.scrollHeight;
    }
  }catch(e){}
}

function renderScore(session){
  const sc=session.score;
  const bars=[
    {l:"Anchoring",v:sc.anchoring},{l:"Concessions",v:sc.concession_strategy},
    {l:"Listening",v:sc.active_listening},{l:"Creativity",v:sc.creativity},
    {l:"Confidence",v:sc.confidence},{l:"Overall",v:sc.overall},
  ];
  let html='<div class="score-card"><h3>🏆 Negotiation Score</h3>';
  html+='<div class="score-grid">';
  bars.forEach(b=>{
    html+=`<div class="sc"><div class="v">${b.v||"—"}</div><div class="l">${b.l}</div></div>`;
  });
  html+='</div>';
  if(sc.deal_outcome){
    html+=`<div class="score-list"><span class="lbl">Deal outcome:</span> ${esc(sc.deal_outcome)}</div>`;
  }
  if(sc.strengths&&sc.strengths.length){
    html+='<div class="score-list" style="margin-top:.5rem"><span class="lbl">Strengths:</span><ul>';
    sc.strengths.forEach(s=>{html+=`<li>${esc(s)}</li>`});
    html+='</ul></div>';
  }
  if(sc.improvements&&sc.improvements.length){
    html+='<div class="score-list" style="margin-top:.5rem"><span class="lbl">Areas to improve:</span><ul>';
    sc.improvements.forEach(s=>{html+=`<li>${esc(s)}</li>`});
    html+='</ul></div>';
  }
  html+='</div>';
  scoreAreaEl.innerHTML=html;
  statEl.textContent="scored"; statEl.className="pill";
  callStatusEl.innerHTML="<b style='color:var(--out)'>Call complete!</b> Score is ready below.";
  callBtn.disabled=false; callBtn.textContent="Call Me";
}

initSSE();
renderState();
setInterval(renderState,2000);
</script>
</body></html>"""

@app.route("/", methods=["GET"])
def dashboard():
    return Response(DASHBOARD_HTML, mimetype="text/html")

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "5000")), threaded=True)
