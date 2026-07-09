#!/usr/bin/env python3
"""Conversation Relay Voice Bot — turn any text-in/text-out AI chatbot into a voice bot.

Telnyx Conversation Relay handles all the telephony audio (STT, TTS, call control).
This bridge only exchanges *text* over a WebSocket: caller speech is transcribed to
text by Telnyx, we forward it to an existing AI chatbot over its OpenAI-compatible
chat-completions endpoint, and send the bot's text reply back so Telnyx speaks it.

No changes to the chatbot. It doesn't know the input came from a phone call.

A live dashboard at / shows frames flowing in real time (SSE) — handy for demos/video.
"""
import json
import os
import time
import threading
from collections import deque
from html import escape
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, Response, request, jsonify, stream_with_context
from flask_sock import Sock

load_dotenv()

app = Flask(__name__)
sock = Sock(app)

# --- Configuration -----------------------------------------------------------
GATEWAY_BASE_URL = os.getenv("CHATBOT_BASE_URL", "http://localhost:18789").rstrip("/")
GATEWAY_TOKEN = os.getenv("CHATBOT_TOKEN", "")
CHATBOT_MODEL = os.getenv("CHATBOT_MODEL", "openclaw")
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "150"))
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "20"))
VOICE_SYSTEM_PROMPT = os.getenv(
    "VOICE_SYSTEM_PROMPT",
    "You are on a phone call. Keep responses short and conversational — 2-3 sentences max. "
    "No markdown, no bullet points, no headers. Speak naturally as if talking on the phone. "
    "If the question is complex, give a brief answer and offer to elaborate if they want more detail.",
)
WELCOME_GREETING = os.getenv(
    "WELCOME_GREETING",
    "Hi! This is Nyx. Ask me anything and I'll do my best to help.",
)
VOICE = os.getenv("VOICE", "Telnyx.Natural.abbie")
LANGUAGE = os.getenv("LANGUAGE", "en")
TRANSCRIPTION_PROVIDER = os.getenv("TRANSCRIPTION_PROVIDER", "deepgram")

# Per-call session state: session_id -> {"history": [...], "started": ts, "from": ...}
sessions: dict[str, dict[str, Any]] = {}

# --- Live event bus (for the dashboard) -------------------------------------
_events: deque[dict[str, Any]] = deque(maxlen=200)
_subscribers: list[Any] = []
_bus_lock = threading.Lock()


def emit(kind: str, direction: str, title: str, text: str = "", session: str | None = None, extra: dict | None = None) -> None:
    """Broadcast an event to the dashboard (ring buffer + SSE subscribers)."""
    evt = {
        "ts": time.time(),
        "kind": kind,            # setup | prompt | reply | interrupt | dtmf | error | webhook | info
        "dir": direction,        # "in" (Telnyx→app) | "out" (app→Telnyx) | "web" (webhook) | "info"
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


def log(label: str, value: Any) -> None:
    print(f"[{label}] {json.dumps(value, indent=2, sort_keys=True)}", flush=True)


# --- TeXML ------------------------------------------------------------------

def public_base_url() -> str:
    configured = os.getenv("TELNYX_PUBLIC_BASE_URL", "").strip()
    if configured:
        return configured.rstrip("/")
    return request.url_root.rstrip("/")


def conversation_relay_ws_url() -> str:
    base = public_base_url()
    if base.startswith("https://"):
        return "wss://" + base.removeprefix("https://") + "/ws/conversation-relay"
    if base.startswith("http://"):
        return "ws://" + base.removeprefix("http://") + "/ws/conversation-relay"
    return base + "/ws/conversation-relay"


def texml_response() -> str:
    ws_url = escape(conversation_relay_ws_url(), quote=True)
    action_url = escape(public_base_url() + "/callbacks/conversation-relay", quote=True)
    greeting = escape(WELCOME_GREETING, quote=True)
    voice = escape(VOICE, quote=True)
    language = escape(LANGUAGE, quote=True)
    provider = escape(TRANSCRIPTION_PROVIDER, quote=True)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect action="{action_url}">
        <ConversationRelay
            url="{ws_url}"
            interruptible="none"
            welcomeGreeting="{greeting}"
            welcomeGreetingInterruptible="none"
            voice="{voice}"
            language="{language}"
            transcriptionProvider="{provider}"
            dtmfDetection="true"
        />
    </Connect>
</Response>"""


def text_frame(token: str, last: bool = False) -> str:
    return json.dumps({"type": "text", "token": token, "last": last})


def ask_chatbot_streamed(history: list[dict[str, str]], ws) -> str:
    """Stream the chatbot reply — sends partial text frames so TTS starts speaking
    the first words while the LLM is still generating the rest."""
    url = f"{GATEWAY_BASE_URL}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if GATEWAY_TOKEN:
        headers["Authorization"] = f"Bearer {GATEWAY_TOKEN}"
    messages = [{"role": "system", "content": VOICE_SYSTEM_PROMPT}] + history
    payload = {"model": CHATBOT_MODEL, "messages": messages, "max_tokens": MAX_TOKENS, "stream": True}
    full_reply = ""
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=REQUEST_TIMEOUT, stream=True)
        resp.raise_for_status()
        for line in resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            data = line.removeprefix("data: ").strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            delta = chunk.get("choices", [{}])[0].get("delta", {})
            token = delta.get("content")
            if token:
                full_reply += token
                ws.send(text_frame(token, last=False))
        ws.send(text_frame("", last=True))
    except requests.exceptions.RequestException as exc:
        app.logger.error("Chatbot streaming request failed: %s", exc)
        fallback = "Sorry, I had trouble reaching my brain right now. Could you repeat that?"
        ws.send(text_frame(fallback, last=True))
        return fallback
    return full_reply


# --- HTTP routes ------------------------------------------------------------

@app.route("/texml/inbound", methods=["GET", "POST"])
def texml_inbound() -> Response:
    log("instruction_fetch", request.values.to_dict(flat=False))
    emit("webhook", "web", "TeXML instruction fetch", text="Telnyx requested the call XML (voice_url)")
    return Response(texml_response(), status=200, mimetype="application/xml")


@app.route("/callbacks/conversation-relay", methods=["GET", "POST"])
def conversation_relay_action() -> Response:
    body = request.get_json(silent=True) or request.values.to_dict(flat=False)
    log("conversation_relay.action", body)
    emit("webhook", "web", "Conversation Relay action callback", text=json.dumps(body)[:200])
    return Response(status=204)


@app.route("/health", methods=["GET"])
def health() -> Response:
    return jsonify({"status": "ok", "active_sessions": len(sessions)})


@app.route("/api/state", methods=["GET"])
def api_state() -> Response:
    """Snapshot for the dashboard's initial load."""
    with _bus_lock:
        recent = list(_events)
    return jsonify({
        "config": {
            "chatbot_base_url": GATEWAY_BASE_URL,
            "chatbot_model": CHATBOT_MODEL,
            "voice": VOICE,
            "transcription_provider": TRANSCRIPTION_PROVIDER,
            "public_base_url": os.getenv("TELNYX_PUBLIC_BASE_URL", "(auto)"),
            "welcome_greeting": WELCOME_GREETING,
        },
        "sessions": [
            {
                "id": sid,
                "from": s.get("from"),
                "turns": len(s.get("history", [])) // 2,
                "duration": int(time.time() - s.get("started", time.time())),
                "history": s.get("history", []),
            }
            for sid, s in sessions.items()
        ],
        "events": recent,
    })


@app.route("/events")
def events() -> Response:
    """Server-Sent Events stream — pushes each frame to the dashboard live."""
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

    return Response(stream_with_context(stream()), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conversation Relay — Live Demo</title>
<style>
  :root{--bg:#0b0f14;--panel:#121821;--panel2:#0e131a;--line:#1f2a36;--ink:#e6edf3;--mut:#8b9aaa;--acc:#3b82f6;
    --in:#38bdf8;--out:#34d399;--web:#f59e0b;--err:#f87171;--dtmf:#a78bfa;--int:#fb923c;--setup:#94a3b8;}
  *{box-sizing:border-box} body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:var(--bg);color:var(--ink);line-height:1.5}
  header{padding:1.1rem 1.6rem;border-bottom:1px solid var(--line);background:var(--panel)}
  header h1{margin:0;font-size:1.15rem;font-weight:600;letter-spacing:.2px}
  header h1 .tag{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;color:var(--acc);
    background:#0f1c2e;border:1px solid #14304d;padding:.15rem .45rem;border-radius:5px;margin-left:.6rem;vertical-align:middle}
  header p{margin:.35rem 0 0;color:var(--mut);font-size:.84rem}
  .flow{display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;margin-top:.55rem;font-size:.78rem}
  .flow .n{padding:.25rem .5rem;border:1px solid var(--line);border-radius:6px;background:var(--panel2);color:var(--ink)}
  .flow .n.bot{border-color:#0e3a2a;color:var(--out)}
  .flow .n.tel{border-color:#1c3958;color:var(--in)}
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
  .row.err{border-left-color:var(--err)} .row.setup{border-left-color:var(--setup)} .row.dtmf{border-left-color:var(--dtmf)}
  .row.int{border-left-color:var(--int)}
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
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:.5rem .8rem;font-size:.7rem;color:var(--mut)}
  .meta b{color:var(--ink);font-weight:500;font-family:ui-monospace,monospace}
</style></head>
<body>
<header>
  <h1>Conversation Relay — Live Demo <span class="tag">text in, voice out</span></h1>
  <p>The same AI chatbot that answers chat messages — now on a phone call. Telnyx handles the audio; this app only moves text.</p>
  <div class="flow">
    <span class="n">Caller</span><span class="arr">→</span>
    <span class="n tel">Telnyx · STT/TTS</span><span class="arr">→</span>
    <span class="n">This bridge <span style="color:var(--mut)">(text)</span></span><span class="arr">→</span>
    <span class="n bot">Your chatbot</span>
    <span class="arr" style="margin-left:.4rem">→</span>
    <span class="n bot">reply</span><span class="arr">→</span>
    <span class="n tel">Telnyx · TTS</span><span class="arr">→</span>
    <span class="n">Caller hears it</span>
  </div>
</header>
<main>
  <section>
    <div class="h"><h2>Live frames</h2><span id="conn" class="pill">connecting…</span></div>
    <div id="frames"></div>
  </section>
  <section>
    <div class="h"><h2>Conversation</h2><span id="stat" class="pill">no call yet</span></div>
    <div id="conv"><div class="empty">Dial the number to start a call.<br>Frames will stream here the moment they happen.</div></div>
  </section>
</main>
<script>
const ICON={setup:"⚙️",prompt:"🎤",reply:"💬",interrupt:"⚡",dtmf:"🔢",error:"❌",webhook:"🌐",info:"ℹ️"};
const LABEL={setup:"Telnyx → app",prompt:"Telnyx → app (caller speech)",reply:"app → Telnyx (bot reply)",
  interrupt:"Telnyx → app",dtmf:"Telnyx → app",error:"Telnyx → app",webhook:"webhook",info:"info"};
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
    if(!startedAt){startedAt=sess.duration?(Date.now()-sess.duration*1000):Date.now()}
    turns=sess.turns;
    const dur=Math.round((Date.now()-startedAt)/1000);
    statEl.textContent=`${turns} turn${turns==1?"":"s"} · ${dur}s`;
    const h=sess.history||[];
    convEl.innerHTML=h.length?h.map((m,i)=>{
      const who=m.role==="user"?"Caller said":"Nyx replied";
      return `<div class="turn ${m.role==="user"?"user":"bot"}"><div class="who">${who}</div><div class="txt">${esc(m.content)}</div></div>`;
    }).join(""):"<div class='empty'>Listening… speak after the greeting.</div>";
    convEl.scrollTop=convEl.scrollHeight;
  });
}
const es=new EventSource("/events");
es.onopen=()=>{connEl.textContent="live";connEl.className="pill live"};
es.onerror=()=>{connEl.textContent="reconnecting…";connEl.className="pill"};
es.onmessage=(ev)=>{
  const e=JSON.parse(ev.data);
  framesEl.insertAdjacentHTML("beforeend",row(e));
  framesEl.scrollTop=framesEl.scrollHeight;
  if(e.kind==="prompt"||e.kind==="reply"){renderConv()}
};
fetch("/api/state").then(r=>r.json()).then(s=>{
  (s.events||[]).forEach(e=>framesEl.insertAdjacentHTML("beforeend",row(e)));
  framesEl.scrollTop=framesEl.scrollHeight;
  renderConv();
});
</script>
</body></html>"""


@app.route("/", methods=["GET"])
def dashboard() -> Response:
    return Response(DASHBOARD_HTML, mimetype="text/html")


# --- WebSocket: the Conversation Relay bridge --------------------------------

@sock.route("/ws/conversation-relay")
def conversation_relay_socket(ws) -> None:
    log("relay.connected", {"path": "/ws/conversation-relay"})
    emit("info", "info", "WebSocket connected", text="Telnyx opened the Conversation Relay socket")
    session_id: str | None = None

    while True:
        raw = ws.receive()
        if raw is None:
            log("relay.disconnected", {"session": session_id})
            emit("info", "info", "WebSocket disconnected", text="Call/session ended", session=session_id)
            if session_id:
                sessions.pop(session_id, None)
            break

        try:
            frame = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            log("relay.parse_error", {"raw": str(raw)[:200]})
            continue

        ftype = str(frame.get("type") or "unknown")
        log(f"relay.{ftype}", frame)

        if ftype == "setup":
            session_id = str(frame.get("sessionId") or frame.get("session_id") or "unknown")
            caller = frame.get("from") or frame.get("callerName") or None
            sessions[session_id] = {"history": [], "started": time.time(), "from": caller}
            emit("setup", "in", "setup", text=f"sessionId={session_id}", session=session_id, extra=frame)

        elif ftype == "prompt" and frame.get("last") is True:
            if not session_id:
                session_id = str(frame.get("sessionId") or "unknown")
                sessions.setdefault(session_id, {"history": [], "started": time.time(), "from": None})
            caller_text = str(frame.get("voicePrompt") or frame.get("text") or frame.get("transcript") or "").strip()
            if not caller_text:
                continue
            emit("prompt", "in", "prompt (caller speech)", text=caller_text, session=session_id)
            session = sessions[session_id]
            session["history"].append({"role": "user", "content": caller_text})
            reply = ask_chatbot_streamed(session["history"], ws)
            session["history"].append({"role": "assistant", "content": reply})
            emit("reply", "out", "text frame (bot reply)", text=reply, session=session_id)
            log("relay.replied", {"session": session_id, "chars": len(reply)})

        elif ftype == "prompt":
            partial = str(frame.get("voicePrompt") or frame.get("text") or "")
            if partial:
                log("relay.prompt_partial", {"text": partial, "last": False})

        elif ftype == "interrupt":
            emit("interrupt", "in", "interrupt", text="Caller barged in over TTS", session=session_id)

        elif ftype == "dtmf":
            digit = str(frame.get("digit") or frame.get("digits") or "")
            emit("dtmf", "in", "dtmf", text=f"digit: {digit}", session=session_id)

        elif ftype == "error":
            emit("error", "in", "error", text=json.dumps(frame)[:300], session=session_id)
            app.logger.warning("Conversation Relay error frame: %s", frame)

    if session_id:
        sessions.pop(session_id, None)


if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        threaded=True,
        debug=os.getenv("DEBUG", "").lower() in {"1", "true", "yes"},
    )
