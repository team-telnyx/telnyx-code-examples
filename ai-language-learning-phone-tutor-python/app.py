#!/usr/bin/env python3
"""AI Language Learning Phone Tutor — call a number, practice a foreign language with AI.

Call a Telnyx number → press 1-4 to pick a language → AI tutors you in that language.
AI Inference handles the conversation, TTS speaks the target language, and the app
maintains per-call conversation history for context.

A live dashboard at / shows the call happening in real time (SSE) — handy for demos/video.
"""
import os, json, time, requests, telnyx
from dotenv import load_dotenv
from flask import Flask, request, jsonify, Response, stream_with_context
import threading, time as _ttl_time
from collections import deque
from html import escape
from typing import Any

load_dotenv()
app = Flask(__name__)
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"), public_key=os.getenv("TELNYX_PUBLIC_KEY"))
TELNYX_PUBLIC_KEY = os.getenv("TELNYX_PUBLIC_KEY", "")
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
active_calls = {}

# --- TTL cleanup (unchanged) ------------------------------------------------
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

session_history = []
_start_ttl_cleanup(session_history)

LANGUAGES = {"1": {"name": "Spanish", "code": "es", "flag": "🇪🇸"},
             "2": {"name": "French", "code": "fr", "flag": "🇫🇷"},
             "3": {"name": "Japanese", "code": "ja", "flag": "🇯🇵"},
             "4": {"name": "Mandarin", "code": "zh", "flag": "🇨🇳"}}

# --- Live event bus (for the dashboard) -------------------------------------
_events: deque[dict[str, Any]] = deque(maxlen=200)
_subscribers: list[Any] = []
_bus_lock = threading.Lock()

def emit(kind: str, direction: str, title: str, text: str = "", session: str | None = None, extra: dict | None = None) -> None:
    """Broadcast an event to the dashboard (ring buffer + SSE subscribers)."""
    evt = {
        "ts": time.time(),
        "kind": kind,            # call | info | lang | prompt | reply | hangup | error
        "dir": direction,        # "in" (caller) | "out" (app→caller) | "web" (webhook) | "info"
        "title": title,
        "text": text,
        "session": session,
        "extra": extra or {},
    }
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

# --- AI Inference -----------------------------------------------------------
def call_inference(messages, max_tokens=200):
    try:
        resp = requests.post(INFERENCE_URL, headers={"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"},
        json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7}, timeout=15)
    except requests.exceptions.RequestException as e:
        app.logger.error("Inference request failed: %s", e)
        return None
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

# --- Webhook handler --------------------------------------------------------
@app.route("/webhooks/voice", methods=["POST"])
def handle_voice():
    # Verify the Telnyx Ed25519 signature before trusting the event.
    try:
        client.webhooks.unwrap(request.get_data(as_text=True), headers=dict(request.headers))
    except Exception:
        return jsonify({"error": "invalid signature"}), 401
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "invalid request body"}), 400
    data = payload.get("data", {})
    p = data.get("payload", {})
    event_type = data.get("event_type")
    ccid = p.get("call_control_id")
    call = active_calls.get(ccid)

    if event_type == "call.initiated" and p.get("direction") == "incoming":
        caller = p.get("from", "unknown")
        active_calls[ccid] = {"caller": caller, "state": "language_select", "conversation": [], "_ts": time.time()}
        emit("call", "web", "Incoming call", text=f"From {caller}", session=ccid)
        client.calls.actions.answer(ccid)
        emit("info", "out", "Answering call", text="Sending answer command", session=ccid)
        return jsonify({"status": "answering"}), 200

    elif event_type == "call.answered" and call:
        client.calls.actions.speak(ccid, payload="Welcome to Language Tutor! Press 1 for Spanish, 2 for French, 3 for Japanese, 4 for Mandarin.", voice="female", language_code="en-US")
        emit("info", "out", "Greeting caller", text="TTS: Welcome to Language Tutor! Press 1 for Spanish, 2 for French, 3 for Japanese, 4 for Mandarin.", session=ccid)
        return jsonify({"status": "greeting"}), 200

    elif event_type == "call.speak.ended" and call:
        if call["state"] == "language_select":
            client.calls.actions.gather(ccid, input_type="dtmf speech", timeout_secs=10, min_digits=1, max_digits=1)
            emit("info", "out", "Waiting for language selection", text="Gathering DTMF input (press 1-4)", session=ccid)
        else:
            client.calls.actions.gather(ccid, input_type="speech", end_silence_timeout_secs=3, timeout_secs=20, language_code="en-US")
            emit("info", "out", "Listening", text="Gathering caller speech", session=ccid)
        return jsonify({"status": "listening"}), 200

    elif event_type == "call.gather.ended" and call:
        digits = p.get("digits", "")
        speech = p.get("speech", {}).get("result", "")
        if call["state"] == "language_select":
            lang_key = digits or speech.strip()[:1]
            lang = LANGUAGES.get(lang_key, LANGUAGES["1"])
            call["language"] = lang
            call["state"] = "tutoring"
            call["conversation"] = [{"role": "system", "content": f"You are a {lang['name']} language tutor. Start with a simple greeting in {lang['name']}, then English translation. Gradually increase difficulty. Correct mistakes gently. Mix {lang['name']} and English. Keep each response short for phone conversation."}]
            emit("lang", "in", f"Language selected: {lang['flag']} {lang['name']}", text=f"Caller pressed {lang_key}", session=ccid, extra={"language": lang["name"], "code": lang["code"]})
            emit("info", "out", "Starting AI tutor", text=f"Asking AI Inference ({AI_MODEL}) to start the lesson in {lang['name']}", session=ccid)
            intro = call_inference(call["conversation"] + [{"role": "user", "content": "Start the lesson."}])
            if not intro:
                intro = "Sorry, I had trouble generating a response. Let's try again."
            call["conversation"].append({"role": "assistant", "content": intro})
            client.calls.actions.speak(ccid, payload=intro, voice="female", language_code="en-US")
            emit("reply", "out", "Tutor replied", text=intro, session=ccid, extra={"language": lang["name"]})
        elif call["state"] == "tutoring" and speech:
            call["conversation"].append({"role": "user", "content": speech})
            emit("prompt", "in", "Caller said", text=speech, session=ccid, extra={"language": call.get("language", {}).get("name", "")})
            emit("info", "out", "Thinking", text=f"Asking AI Inference ({AI_MODEL})…", session=ccid)
            response = call_inference(call["conversation"])
            if not response:
                response = "Sorry, I didn't catch that. Could you repeat what you said?"
            call["conversation"].append({"role": "assistant", "content": response})
            client.calls.actions.speak(ccid, payload=response, voice="female", language_code="en-US")
            emit("reply", "out", "Tutor replied", text=response, session=ccid, extra={"language": call.get("language", {}).get("name", "")})
        else:
            client.calls.actions.speak(ccid, payload="Try again! Say something in the language you're learning.", voice="female", language_code="en-US")
            emit("info", "out", "No speech detected", text="Prompting caller to try again", session=ccid)
        return jsonify({"status": "processing"}), 200

    elif event_type == "call.hangup":
        call = active_calls.pop(ccid, None)
        if call and call.get("conversation"):
            exchanges = len(call["conversation"]) // 2
            lang_name = call.get("language", {}).get("name", "N/A")
            session_history.append({"caller": call["caller"], "language": lang_name, "exchanges": exchanges, "_ts": time.time()})
            emit("hangup", "web", "Call ended", text=f"{exchanges} exchanges in {lang_name}", session=ccid)
        else:
            emit("hangup", "web", "Call ended", text="No conversation recorded", session=ccid)
        return jsonify({"status": "ended"}), 200

    return jsonify({"status": "ok"}), 200

# --- API endpoints ----------------------------------------------------------

@app.route("/sessions", methods=["GET"])
def list_sessions():
    return jsonify({"sessions": session_history[-50:]}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "active": len(active_calls), "sessions": len(session_history)}), 200

@app.route("/api/state", methods=["GET"])
def api_state():
    """Snapshot for the dashboard's initial load."""
    with _bus_lock:
        recent = list(_events)
    return jsonify({
        "config": {
            "model": AI_MODEL,
            "inference_url": INFERENCE_URL,
        },
        "sessions": [
            {
                "id": ccid,
                "caller": s.get("caller", "unknown"),
                "language": s.get("language", {}).get("name") if isinstance(s.get("language"), dict) else None,
                "language_flag": s.get("language", {}).get("flag") if isinstance(s.get("language"), dict) else None,
                "state": s.get("state", ""),
                "turns": max(0, (len(s.get("conversation", [])) - 1) // 2),
                "started": s.get("_ts", time.time()),
                "conversation": [
                    {"role": m["role"], "content": m["content"]}
                    for m in s.get("conversation", [])
                    if m.get("role") in ("user", "assistant")
                ],
            }
            for ccid, s in active_calls.items()
        ],
        "events": recent,
    })

@app.route("/events")
def events():
    """Server-Sent Events stream — pushes each event to the dashboard live."""
    q: deque[dict[str, Any]] = deque(maxlen=100)
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

# --- Dashboard ---------------------------------------------------------------

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Language Tutor — Live Demo</title>
<style>
  :root{--bg:#0b0f14;--panel:#121821;--panel2:#0e131a;--line:#1f2a36;--ink:#e6edf3;--mut:#8b9aaa;--acc:#3b82f6;
    --in:#38bdf8;--out:#34d399;--web:#f59e0b;--err:#f87171;--lang:#a78bfa;--info:#94a3b8;--hangup:#fb923c;}
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
  main{display:grid;grid-template-columns:1.3fr 1fr;gap:1px;background:var(--line);min-height:calc(100vh - 86px)}
  @media(max-width:880px){main{grid-template-columns:1fr}}
  section{background:var(--bg);padding:1.1rem 1.25rem;overflow:hidden}
  .h{display:flex;align-items:center;justify-content:space-between;margin:0 0 .8rem}
  .h h2{margin:0;font-size:.82rem;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);font-weight:600}
  .pill{font-size:.7rem;color:var(--mut);border:1px solid var(--line);padding:.12rem .45rem;border-radius:20px}
  .pill.live{color:var(--out);border-color:#0e3a2a} .pill.live::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--out);margin-right:.35rem;vertical-align:middle;animation:p 1.4s infinite}
  @keyframes p{0%,100%{opacity:1}50%{opacity:.3}}
  #frames{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;display:flex;flex-direction:column;gap:.5rem;
    max-height:calc(100vh - 160px);overflow-y:auto;padding-right:.3rem}
  .row{border:1px solid var(--line);border-left:3px solid var(--line);border-radius:7px;padding:.5rem .65rem;background:var(--panel)}
  .row.in{border-left-color:var(--in)} .row.out{border-left-color:var(--out)} .row.web{border-left-color:var(--web)}
  .row.err{border-left-color:var(--err)} .row.lang{border-left-color:var(--lang)} .row.hangup{border-left-color:var(--hangup)}
  .top{display:flex;align-items:center;gap:.4rem;color:var(--mut);font-size:.68rem;margin-bottom:.2rem}
  .top .ico{font-size:.8rem} .top .t{margin-left:auto;font-family:ui-monospace,monospace}
  .ttl{color:var(--ink);font-size:.74rem;font-weight:600}
  .body{color:var(--ink);font-family:ui-monospace,monospace;font-size:.76rem;white-space:pre-wrap;word-break:break-word;margin-top:.15rem}
  .row.out .body{color:var(--out)} .row.in .body{color:var(--in)}
  .empty{color:var(--mut);font-size:.8rem;text-align:center;padding:2.5rem 1rem;border:1px dashed var(--line);border-radius:8px}
  #conv{display:flex;flex-direction:column;gap:.7rem;max-height:calc(100vh - 160px);overflow-y:auto;padding-right:.3rem}
  .turn{padding:.6rem .75rem;border-radius:10px;max-width:92%;font-size:.82rem}
  .turn.user{background:#11243a;border:1px solid #1c3958;align-self:flex-start}
  .turn.bot{background:#0e2418;border:1px solid #163a29;align-self:flex-end;text-align:right}
  .turn .who{font-size:.62rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin-bottom:.18rem}
  .turn.user .who{color:var(--in)} .turn.bot .who{color:var(--out)}
  .turn .txt{color:var(--ink)}
  .lang-badge{display:inline-block;font-size:.72rem;color:var(--lang);border:1px solid #2a1f4a;background:#140e26;padding:.15rem .5rem;border-radius:6px;margin-left:.4rem}
</style></head>
<body>
<header>
  <h1>AI Language Tutor — Live Demo <span class="tag">call &amp; learn</span></h1>
  <p>Call a Telnyx number, pick a language, and practice with an AI tutor. Telnyx Voice handles the call; AI Inference runs the conversation.</p>
  <div class="flow">
    <span class="n">Caller dials</span><span class="arr">&rarr;</span>
    <span class="n tel">Telnyx &middot; Voice AI</span><span class="arr">&rarr;</span>
    <span class="n">This app <span style="color:var(--mut)">(webhook)</span></span><span class="arr">&rarr;</span>
    <span class="n bot">AI Inference</span>
    <span class="arr" style="margin-left:.4rem">&rarr;</span>
    <span class="n bot">reply</span><span class="arr">&rarr;</span>
    <span class="n tel">Telnyx &middot; TTS</span><span class="arr">&rarr;</span>
    <span class="n">Caller hears it</span>
  </div>
</header>
<main>
  <section>
    <div class="h"><h2>Live events</h2><span id="conn" class="pill">connecting&hellip;</span></div>
    <div id="frames"></div>
  </section>
  <section>
    <div class="h"><h2>Conversation</h2><span id="stat" class="pill">no call yet</span></div>
    <div id="conv"><div class="empty">Dial the number to start a call.<br>Events will stream here the moment they happen.</div></div>
  </section>
</main>
<script>
const ICON={call:"\\uD83D\\uDCDE",info:"i",lang:"L",prompt:"\\uD83C\\uDFA4",reply:"\\uD83D\\uDCAC",hangup:"\\uD83D\\uDD34",error:"\\u274C"};
const LABEL={call:"webhook",info:"app",lang:"caller to app",prompt:"caller to app (speech)",
  reply:"app to caller (TTS)",hangup:"webhook",error:"error"};
const framesEl=document.getElementById("frames");
const convEl=document.getElementById("conv");
const connEl=document.getElementById("conn");
const statEl=document.getElementById("stat");
let turns=0, startedAt=null;

function esc(s){return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}

function row(e){
  const d=new Date(e.ts*1000),t=d.toTimeString().slice(0,8);
  const dirCls=e.dir||"info";
  const body=e.text?`<div class="body">${esc(e.text)}</div>`:"";
  return `<div class="row ${dirCls}"><div class="top"><span class="ico">${ICON[e.kind]||""}</span>
    <span>${esc(LABEL[e.kind]||e.title)}</span><span class="t">${t}</span></div>
    <div class="ttl">${esc(e.title)}</div>${body}</div>`;
}

function renderConv(){
  fetch("/api/state").then(r=>r.json()).then(s=>{
    const sess=s.sessions[0];
    if(!sess){return}
    if(!startedAt){startedAt=sess.started*1000}
    turns=sess.turns;
    const dur=Math.round((Date.now()-startedAt)/1000);
    const langName=sess.language?`<span class="lang-badge">${sess.language_flag||""} ${esc(sess.language)}</span>`:"";
    statEl.innerHTML=`${turns} turn${turns===1?"":"s"} &middot; ${dur}s ${langName}`;
    const h=sess.conversation||[];
    convEl.innerHTML=h.length?h.map(m=>{
      const who=m.role==="user"?"Caller said":"Tutor replied";
      return `<div class="turn ${m.role==="user"?"user":"bot"}"><div class="who">${who}</div><div class="txt">${esc(m.content)}</div></div>`;
    }).join(""):"<div class='empty'>Listening&hellip; speak after the greeting.</div>";
    convEl.scrollTop=convEl.scrollHeight;
  });
}

const es=new EventSource("/events");
es.onopen=()=>{connEl.textContent="live";connEl.className="pill live"};
es.onerror=()=>{connEl.textContent="reconnecting&hellip;";connEl.className="pill"};
es.onmessage=(ev)=>{
  const e=JSON.parse(ev.data);
  framesEl.insertAdjacentHTML("beforeend",row(e));
  framesEl.scrollTop=framesEl.scrollHeight;
  if(e.kind==="prompt"||e.kind==="reply"||e.kind==="lang"){renderConv()}
};

fetch("/api/state").then(r=>r.json()).then(s=>{
  (s.events||[]).forEach(e=>framesEl.insertAdjacentHTML("beforeend",row(e)));
  framesEl.scrollTop=framesEl.scrollHeight;
  renderConv();
});
</script>
</body></html>"""

@app.route("/", methods=["GET"])
def dashboard():
    return Response(DASHBOARD_HTML, mimetype="text/html")

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
