"""Telnyx Edge entry point.

Edge calls new() and passes every request to handle(), which hands it to a
FastAPI app:

    GET  /       health check
    POST /texml  answers an incoming call and streams its audio to /ws
    WS   /ws     Telnyx call audio <-> the Pipecat bot
"""

from html import escape

from fastapi import FastAPI, Request, Response, WebSocket
from pipecat.runner.types import WebSocketRunnerArguments

from .bot import bot

app = FastAPI()


@app.get("/")
async def health():
    return {"ok": True}


@app.api_route("/texml", methods=["GET", "POST"])
async def texml(request: Request):
    host = request.headers.get("x-forwarded-host") or request.headers["host"]
    stream_url = escape(f"wss://{host}/ws", quote=True)
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="{stream_url}" bidirectionalMode="rtp"></Stream>
  </Connect>
</Response>"""
    return Response(content=xml, media_type="application/xml")


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    await bot(WebSocketRunnerArguments(websocket=websocket))


class Function:
    async def handle(self, scope, receive, send):
        await app(scope, receive, send)


def new():
    return Function()
