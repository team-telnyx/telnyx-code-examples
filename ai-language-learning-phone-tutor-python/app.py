#!/usr/bin/env python3
"""AI Language Learning Phone Tutor — call a number, practice a foreign language with AI.

Uses Telnyx Conversation Relay (TeXML + WebSocket). Telnyx handles STT/TTS/call control.
This app only exchanges text over a WebSocket and forwards to AI Inference.

Flow:
  1. Caller dials → Telnyx fetches TeXML from /texml/inbound
  2. TeXML tells Telnyx to open a Conversation Relay WebSocket to /ws/conversation-relay
  3. Caller speaks → Telnyx transcribes → sends text frame to our WebSocket
  4. We forward to AI Inference (Llama-3.3-70B) with a language-tutor system prompt
  5. We stream the reply back token-by-token → Telnyx TTS speaks it to the caller

A live dashboard at / shows the call happening in real time (SSE) — handy for demos/video.
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
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "meta-llama/Llama-3.3-70B-Instruct")
INFERENCE_URL = os.getenv("INFERENCE_URL", "https://api.telnyx.com/v2/ai/chat/completions")
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "200"))
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "20"))
VOICE = os.getenv("VOICE", "Telnyx.Natural.abbie")
LANGUAGE = os.getenv("LANGUAGE", "en")
TRANSCRIPTION_PROVIDER = os.getenv("TRANSCRIPTION_PROVIDER", "deepgram")
WELCOME_GREETING = os.getenv(
    "WELCOME_GREETING",
    "Welcome to Language Tutor! Say the name of a language to start: Spanish, French, Japanese, or Mandarin.",
)

LANGUAGES = {
    "spanish": {"name": "Spanish", "code": "es", "flag": "🇪🇸"},
    "french": {"name": "French", "code": "fr", "flag": "🇫🇷"},
    "japanese": {"name": "Japanese", "code": "ja", "flag": "🇯🇵"},
    "mandarin": {"name": "Mandarin", "code": "zh", "flag": "🇨🇳"},
    "chinese": {"name": "Mandarin", "code": "zh", "flag": "🇨🇳"},
}

TUTOR_PROMPT = (
    "You are a {lang} language tutor on a phone call. "
    "Start with a simple greeting in {lang}, then give the English translation. "
    "Gradually increase difficulty. Correct mistakes gently. Mix {lang} and English. "
    "Keep each response short for phone conversation — 2-3 sentences max. "
    "No markdown, no bullet points, no headers. Speak naturally."
)

# Per-call session state
sessions: dict[str, dict[str, Any]] = {}

# --- Live event bus ----------------------------------------------------------
_events: deque[dict[str, Any]] = deque(maxlen=200)
_subscribers: list[Any] = []
_bus_lock = threading.Lock()


def emit(kind: str, direction: str, title: str, text: str = "", session: str | None = None, extra: dict | None = None) -> None:
    evt = {
        "ts": time.time(),
        "kind": kind,
        "dir": direction,
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


# --- AI Inference ------------------------------------------------------------

def call_inference_streamed(messages: list[dict[str, str]], ws) -> str:
    """Stream the AI reply — sends partial text frames so TTS starts speaking
    the first words while the LLM is still generating the rest."""
    headers = {
        "Authorization": f"Bearer {TELNYX_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": AI_MODEL,
        "messages": messages,
        "max_tokens": MAX_TOKENS,
        "temperature": 0.7,
        "stream": True,
    }
    full_reply = ""
    try:
        resp = requests.post(INFERENCE_URL, headers=headers, json=payload, timeout=REQUEST_TIMEOUT, stream=True)
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
                ws.send(json.dumps({"type": "text", "token": token, "last": False}))
        ws.send(json.dumps({"type": "text", "token": "", "last": True}))
    except requests.exceptions.RequestException as exc:
        app.logger.error("Inference streaming request failed: %s", exc)
        fallback = "Sorry, I had trouble generating a response. Let's try again."
        ws.send(json.dumps({"type": "text", "token": fallback, "last": True}))
        return fallback
    return full_reply


# --- TeXML -------------------------------------------------------------------

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


# --- HTTP routes -------------------------------------------------------------

@app.route("/texml/inbound", methods=["GET", "POST"])
def texml_inbound() -> Response:
    emit("webhook", "web", "TeXML instruction fetch", text="Telnyx requested the call XML (voice_url)")
    return Response(texml_response(), status=200, mimetype="application/xml")


@app.route("/callbacks/conversation-relay", methods=["GET", "POST"])
def conversation_relay_action() -> Response:
    body = request.get_json(silent=True) or request.values.to_dict(flat=False)
    log("conversation_relay.action", body)
    emit("webhook", "web", "Conversation Relay action callback", text=json.dumps(body)[:200] if isinstance(body, (dict, list)) else str(body)[:200])
    return Response(status=204)


@app.route("/health", methods=["GET"])
def health() -> Response:
    return jsonify({"status": "ok", "active_sessions": len(sessions)})


@app.route("/api/state", methods=["GET"])
def api_state() -> Response:
    with _bus_lock:
        recent = list(_events)
    return jsonify({
        "config": {
            "model": AI_MODEL,
            "inference_url": INFERENCE_URL,
            "voice": VOICE,
            "welcome_greeting": WELCOME_GREETING,
        },
        "sessions": [
            {
                "id": sid,
                "from": s.get("from"),
                "language": s.get("language", {}).get("name") if isinstance(s.get("language"), dict) else None,
                "language_flag": s.get("language", {}).get("flag") if isinstance(s.get("language"), dict) else None,
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
  .row.err{border-left-color:var(--err)} .row.lang{border-left-color:var(--lang)} .row.setup{border-left-color:var(--info)}
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
  <p>Call a Telnyx number, say a language name, and practice with an AI tutor. Telnyx Conversation Relay handles the audio; AI Inference runs the conversation.</p>
  <div class="flow">
    <span class="n">Caller dials</span><span class="arr">&rarr;</span>
    <span class="n tel">Telnyx &middot; STT/TTS</span><span class="arr">&rarr;</span>
    <span class="n">This app <span style="color:var(--mut)">(WebSocket text)</span></span><span class="arr">&rarr;</span>
    <span class="n bot">AI Inference</span>
    <span class="arr" style="margin-left:.4rem">&rarr;</span>
    <span class="n bot">reply</span><span class="arr">&rarr;</span>
    <span class="n tel">Telnyx &middot; TTS</span><span class="arr">&rarr;</span>
    <span class="n">Caller hears it</span>
  </div>
</header>
<main>
  <section>
    <div class="h"><h2>Live frames</h2><span id="conn" class="pill">connecting&hellip;</span></div>
    <div id="frames"></div>
  </section>
  <section>
    <div class="h"><h2>Conversation</h2><span id="stat" class="pill">no call yet</span></div>
    <div id="conv"><div class="empty">Dial the number to start a call.<br>Frames will stream here the moment they happen.</div></div>
  </section>
</main>
<script>
const ICON={setup:"\\u2699",call:"\\uD83D\\uDCDE",info:"i",lang:"L",prompt:"\\uD83C\\uDFA4",reply:"\\uD83D\\uDCAC",hangup:"\\uD83D\\uDD34",error:"\\u274C"};
const LABEL={setup:"Telnyx to app",call:"webhook",info:"app",lang:"caller to app",prompt:"caller to app (speech)",
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
    if(!startedAt){startedAt=sess.duration?(Date.now()-sess.duration*1000):Date.now()}
    turns=sess.turns;
    const dur=Math.round((Date.now()-startedAt)/1000);
    const langName=sess.language?`<span class="lang-badge">${sess.language_flag||""} ${esc(sess.language)}</span>`:"";
    statEl.innerHTML=`${turns} turn${turns===1?"":"s"} &middot; ${dur}s ${langName}`;
    const h=sess.history||[];
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
def dashboard() -> Response:
    return Response(DASHBOARD_HTML, mimetype="text/html")


# --- WebSocket: Conversation Relay -------------------------------------------

def detect_language(text: str) -> dict | None:
    text_lower = text.lower().strip()
    for keyword, lang in LANGUAGES.items():
        if keyword in text_lower:
            return lang
    return None


@sock.route("/ws/conversation-relay")
def conversation_relay_socket(ws) -> None:
    log("relay.connected", {"path": "/ws/conversation-relay"})
    emit("info", "info", "WebSocket connected", text="Telnyx opened the Conversation Relay socket")
    session_id: str | None = None

    while True:
        raw = ws.receive()
        if raw is None:
            log("relay.disconnected", {"session": session_id})
            if session_id:
                emit("hangup", "web", "Call ended", text="WebSocket closed", session=session_id)
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
            sessions[session_id] = {"history": [], "started": time.time(), "from": caller, "language": None}
            emit("setup", "in", "setup", text=f"sessionId={session_id}", session=session_id, extra=frame)

        elif ftype == "prompt" and frame.get("last") is True:
            if not session_id:
                session_id = str(frame.get("sessionId") or "unknown")
                sessions.setdefault(session_id, {"history": [], "started": time.time(), "from": None, "language": None})
            caller_text = str(frame.get("voicePrompt") or frame.get("text") or frame.get("transcript") or "").strip()
            if not caller_text:
                continue

            session = sessions[session_id]
            emit("prompt", "in", "Caller said", text=caller_text, session=session_id)

            # Language detection on first prompt
            if not session["language"]:
                lang = detect_language(caller_text)
                if lang:
                    session["language"] = lang
                    session["history"] = [{"role": "system", "content": TUTOR_PROMPT.format(lang=lang["name"])}]
                    emit("lang", "in", f"Language selected: {lang['flag']} {lang['name']}", text=f'Caller said "{caller_text}"', session=session_id, extra={"language": lang["name"]})
                    session["history"].append({"role": "user", "content": "Start the lesson."})
                    reply = call_inference_streamed(session["history"], ws)
                    session["history"].append({"role": "assistant", "content": reply})
                    emit("reply", "out", "Tutor replied", text=reply, session=session_id, extra={"language": lang["name"]})
                    continue
                else:
                    reply = "I heard you say: " + caller_text + ". Please say a language: Spanish, French, Japanese, or Mandarin."
                    ws.send(json.dumps({"type": "text", "token": reply, "last": True}))
                    emit("reply", "out", "Tutor replied", text=reply, session=session_id)
                    continue

            # Normal tutoring turn
            session["history"].append({"role": "user", "content": caller_text})
            reply = call_inference_streamed(session["history"], ws)
            session["history"].append({"role": "assistant", "content": reply})
            emit("reply", "out", "Tutor replied", text=reply, session=session_id, extra={"language": session["language"]["name"] if session.get("language") else ""})
            log("relay.replied", {"session": session_id, "chars": len(reply)})

        elif ftype == "prompt":
            partial = str(frame.get("voicePrompt") or frame.get("text") or "")
            if partial:
                log("relay.prompt_partial", {"text": partial, "last": False})

        elif ftype == "interrupt":
            emit("info", "in", "interrupt", text="Caller barged in over TTS", session=session_id)

        elif ftype == "dtmf":
            digit = str(frame.get("digit") or frame.get("digits") or "")
            emit("info", "in", "dtmf", text=f"digit: {digit}", session=session_id)

        elif ftype == "error":
            emit("error", "in", "error", text=json.dumps(frame)[:300], session=session_id)
            app.logger.warning("Conversation Relay error frame: %s", frame)

    if session_id:
        sessions.pop(session_id, None)


if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "5000")),
        threaded=True,
        debug=os.getenv("DEBUG", "").lower() in {"1", "true", "yes"},
    )
