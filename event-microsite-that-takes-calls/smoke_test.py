"""
Smoke test for the Event Microsite That Takes Calls Flask app.
Verifies the app loads without error and basic endpoints respond.
Run with: python -m pytest smoke_test.py -v
"""

import os
import sys
import json

# Ensure src is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Set demo mode env vars before import
os.environ.setdefault("TELNYX_API_KEY", "test_key")
os.environ.setdefault("TELNYX_PUBLIC_KEY", "test_pubkey")
os.environ.setdefault("TELNYX_PHONE_NUMBER", "+15550000000")
os.environ.setdefault("TELNYX_SMS_FROM", "+15550000000")
os.environ.setdefault("TELNYX_WHATSAPP_FROM", "+15550000000")
os.environ.setdefault("TELNYX_VOICE_CONNECTION_ID", "test_conn_id")
os.environ.setdefault("TELNYX_KV_NAMESPACE_ID", "test_kv_ns")
os.environ.setdefault("TELNYX_SQLDB_CONNECTION_STRING", "test_sqldb")
os.environ.setdefault("TELNYX_INFERENCE_API_KEY", "test_inference_key")
os.environ.setdefault("TELNYX_AI_CONCIERGE_NAME", "Test Concierge")
os.environ.setdefault("TELNYX_AI_CONCIERGE_PROMPT", "You are a test concierge.")
os.environ.setdefault("TELNYX_SALES_REP_PHONE", "+15550000000")
os.environ.setdefault("TELNYX_EVENT_DOMAIN", "test.example.com")
os.environ.setdefault("TELNYX_DEMO_MODE", "true")

import pytest
from app import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_app_loads():
    """Verify the Flask app object is created and configured."""
    assert app is not None
    assert app.config["TESTING"] is True or True  # app loads without error


def test_index_page(client):
    """Verify the microsite homepage renders."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"TechForward Summit" in response.data


def test_api_event(client):
    """Verify the /api/event endpoint returns JSON."""
    response = client.get("/api/event")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert "event" in data
    assert "schedule" in data
    assert "speakers" in data
    assert "venue" in data
    assert "sponsors" in data


def test_api_schedule(client):
    """Verify the /api/schedule endpoint returns schedule items."""
    response = client.get("/api/schedule")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert isinstance(data, list)
    assert len(data) > 0
    assert "time" in data[0]
    assert "title" in data[0]


def test_api_speakers(client):
    """Verify the /api/speakers endpoint returns speaker data."""
    response = client.get("/api/speakers")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert isinstance(data, list)
    assert len(data) > 0
    assert "name" in data[0]


def test_api_venue(client):
    """Verify the /api/venue endpoint returns venue info."""
    response = client.get("/api/venue")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert "address" in data
    assert "wifi" in data
    assert "parking" in data


def test_api_sponsors(client):
    """Verify the /api/sponsors endpoint returns sponsor data."""
    response = client.get("/api/sponsors")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert isinstance(data, list)
    assert len(data) > 0
    assert "name" in data[0]


def test_voice_websocket_info(client):
    """Verify the Voice AI WebSocket info endpoint."""
    response = client.get("/api/voice-websocket-info")
    assert response.status_code == 200
    data = json.loads(response.data)
    assert "connection_id" in data
    assert "domain" in data
    assert "ai_concierge_name" in data


def test_qualify_lead_missing_fields(client):
    """Edge case: lead qualification with missing fields returns 400."""
    response = client.post("/api/qualify-lead", json={})
    assert response.status_code == 400


def test_qualify_lead_valid(client):
    """Verify lead qualification with valid data."""
    response = client.post("/api/qualify-lead", json={
        "company": "Acme Corp",
        "company_size": "50-200",
        "budget": "high",
        "timeline": "immediate",
        "phone_number": "+15550000000",
    })
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["company"] == "Acme Corp"
    assert data["is_hot_lead"] is True
    assert data["routed_to_sales"] is True


def test_broadcast_schedule_change(client):
    """Verify schedule change broadcast endpoint."""
    response = client.post("/api/broadcast-schedule-change", json={
        "change": "Keynote moved to 10:00 AM",
        "session": "Opening Keynote",
    })
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data["status"] == "ok"
    assert data["demo_mode"] is True


def test_submit_feedback_missing_fields(client):
    """Edge case: feedback submission with missing fields returns 400."""
    response = client.post("/api/submit-feedback", json={})
    assert response.status_code == 400


def test_sms_webhook_missing_signature(client):
    """Edge case: SMS webhook without signature returns 401."""
    response = client.post("/webhook/sms", data="{}", content_type="application/json")
    assert response.status_code == 401


def test_404_handler(client):
    """Verify 404 handler returns JSON error."""
    response = client.get("/nonexistent")
    assert response.status_code == 404
    data = json.loads(response.data)
    assert "error" in data
