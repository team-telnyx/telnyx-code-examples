#!/usr/bin/env python3
"""AI Assistant Filler Messages Demo — webhook server with live split-screen dashboard for demoing filler messages during sync tool calls."""
import os, json, time, threading, queue
from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template, Response

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
app = Flask(__name__, template_folder=os.path.join(BASE_DIR, "templates"))

WEBHOOK_DELAY_SECONDS = int(os.getenv("WEBHOOK_DELAY_SECONDS", "12"))

MOCK_ORDERS = {
    "12345": {"order_id": "12345", "status": "shipped", "carrier": "FedEx", "tracking": "FX-98765", "eta": "2026-07-20", "items": ["Wireless Headset", "USB-C Cable"]},
    "67890": {"order_id": "67890", "status": "processing", "carrier": "pending", "tracking": "pending", "eta": "2026-07-25", "items": ["Desk Lamp"]},
    "11111": {"order_id": "11111", "status": "delivered", "carrier": "UPS", "tracking": "1Z999AA10123456784", "eta": "2026-07-14", "items": ["Keyboard", "Mouse", "Monitor Stand"]},
}

FILLER_CONFIG = [
    {"type": "request_start", "content": "Let me look that up for you.", "timing_ms": 0},
    {"type": "request_response_delayed", "content": "Still working on this, one moment please.", "timing_ms": 5000},
    {"type": "request_response_delayed", "content": "Almost there, thanks for your patience.", "timing_ms": 15000},
]

clients = []
clients_lock = threading.Lock()


def broadcast(event_type, data):
    """Send an SSE event to all connected dashboard clients."""
    payload = json.dumps({"type": event_type, "timestamp": time.time(), **data})
    msg = f"event: {event_type}\ndata: {payload}\n\n"
    dead = []
    with clients_lock:
        for q in clients:
            try:
                q.put_nowait(msg)
            except queue.Full:
                dead.append(q)
        for q in dead:
            clients.remove(q)


@app.route("/webhook/order-status", methods=["POST"])
def webhook_order_status():
    body = request.get_json(silent=True) or {}
    order_id = body.get("order_id", "unknown")
    received_at = time.time()

    app.logger.info("Webhook received: order_id=%s", order_id)
    broadcast("tool_call_received", {
        "order_id": order_id,
        "request_body": body,
        "delay_seconds": WEBHOOK_DELAY_SECONDS,
    })

    for filler in FILLER_CONFIG:
        elapsed_ms = filler.get("timing_ms", 0)
        if elapsed_ms / 1000 < WEBHOOK_DELAY_SECONDS:
            broadcast("filler_message", {
                "content": filler["content"],
                "filler_type": filler["type"],
                "timing_ms": elapsed_ms,
            })

    for elapsed in range(1, WEBHOOK_DELAY_SECONDS + 1):
        time.sleep(1)
        broadcast("countdown", {
            "elapsed": elapsed,
            "total": WEBHOOK_DELAY_SECONDS,
            "remaining": WEBHOOK_DELAY_SECONDS - elapsed,
        })

    order = MOCK_ORDERS.get(order_id, {"order_id": order_id, "status": "not_found", "error": "Order not found"})
    response_body = {"result": order}

    app.logger.info("Webhook responding: order_id=%s status=%s", order_id, order.get("status"))
    broadcast("response_sent", {
        "order_id": order_id,
        "response_body": response_body,
        "duration_seconds": round(time.time() - received_at, 1),
    })

    return jsonify(response_body), 200


@app.route("/")
def dashboard():
    return render_template("index.html",
                           delay_seconds=WEBHOOK_DELAY_SECONDS,
                           filler_config=FILLER_CONFIG)


@app.route("/events")
def events():
    q = queue.Queue(maxsize=100)
    with clients_lock:
        clients.append(q)

    def stream():
        try:
            yield f"data: {json.dumps({'type': 'connected', 'timestamp': time.time(), 'delay_seconds': WEBHOOK_DELAY_SECONDS})}\n\n"
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield msg
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            with clients_lock:
                if q in clients:
                    clients.remove(q)

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/health")
def health():
    return jsonify({"status": "ok", "delay_seconds": WEBHOOK_DELAY_SECONDS, "connected_clients": len(clients)}), 200


if __name__ == "__main__":
    app.run(debug=False, threaded=True, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")))
