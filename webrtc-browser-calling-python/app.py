#!/usr/bin/env python3
"""Production-ready WebRTC calling application with Telnyx Voice API and FastAPI."""

import os
import telnyx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

# Configuration
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
TELNYX_PHONE_NUMBER = os.getenv("TELNYX_PHONE_NUMBER")
TELNYX_CONNECTION_ID = os.getenv("TELNYX_CONNECTION_ID")
WEBHOOK_URL = os.getenv("WEBHOOK_URL")

if not all([TELNYX_API_KEY, TELNYX_PHONE_NUMBER, TELNYX_CONNECTION_ID, WEBHOOK_URL]):
    raise ValueError(
        "Missing required environment variables: "
        "TELNYX_API_KEY, TELNYX_PHONE_NUMBER, TELNYX_CONNECTION_ID, WEBHOOK_URL"
    )

# Initialize Telnyx client
client = telnyx.Telnyx(api_key=TELNYX_API_KEY)

# In-memory call store (use Redis in production)
active_calls = {}

# Pydantic models
class CallInitiateRequest(BaseModel):
    to_number: str = Field(..., description="Destination phone number in E.164 format")
    client_state: Optional[str] = Field(None, description="Custom state for tracking")


class CallInitiateResponse(BaseModel):
    call_control_id: str
    from_number: str
    to_number: str
    status: str


class CallActionRequest(BaseModel):
    call_control_id: str = Field(..., description="Unique call identifier")
    action: str = Field(..., description="Action: answer, hangup, transfer, etc.")
    transfer_to: Optional[str] = Field(None, description="Destination for transfer")


# FastAPI app
app = FastAPI(title="Telnyx WebRTC Calling")


def initiate_webrtc_call(to_number: str, client_state: str = None) -> CallInitiateResponse:
    """Initiate a WebRTC call to a phone number."""
    if not to_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")
    
    response = client.calls.dial(
        from_=TELNYX_PHONE_NUMBER,
        to=to_number,
        connection_id=TELNYX_CONNECTION_ID,
    )
    
    call_control_id = response.data.call_control_id
    
    active_calls[call_control_id] = {
        "to_number": to_number,
        "from_number": TELNYX_PHONE_NUMBER,
        "client_state": client_state,
        "status": "initiated",
    }
    
    return CallInitiateResponse(
        call_control_id=call_control_id,
        from_number=TELNYX_PHONE_NUMBER,
        to_number=to_number,
        status="initiated",
    )


def hangup_call(call_control_id: str) -> dict:
    """Terminate an active call."""
    client.calls.actions.hangup(call_control_id)
    
    if call_control_id in active_calls:
        del active_calls[call_control_id]
    
    return {
        "call_control_id": call_control_id,
        "action": "hangup",
        "status": "success",
    }


def transfer_call(call_control_id: str, transfer_to: str) -> dict:
    """Transfer an active call to another number."""
    if not transfer_to.startswith("+"):
        raise ValueError("Transfer destination must be in E.164 format")
    
    client.calls.actions.transfer(call_control_id, to=transfer_to)
    
    return {
        "call_control_id": call_control_id,
        "action": "transfer",
        "transfer_to": transfer_to,
        "status": "success",
    }


def get_call_status(call_control_id: str) -> dict:
    """Retrieve the current status of a call."""
    response = client.calls.retrieve_status(call_control_id)
    
    return {
        "call_control_id": response.data.call_control_id,
        "is_alive": response.data.is_alive,
        "state": response.data.state if hasattr(response.data, "state") else "unknown",
    }


@app.post("/calls/initiate")
async def initiate_call(request: CallInitiateRequest):
    """Initiate a WebRTC call to a phone number."""
    try:
        result = initiate_webrtc_call(
            to_number=request.to_number,
            client_state=request.client_state,
        )
        return result
    
    except telnyx.AuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid API key")
    except telnyx.RateLimitError:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    except telnyx.APIStatusError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except telnyx.APIConnectionError:
        raise HTTPException(status_code=503, detail="Network error connecting to Telnyx")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/calls/hangup")
async def hangup_endpoint(request: CallActionRequest):
    """Terminate an active call."""
    try:
        result = hangup_call(request.call_control_id)
        return result
    
    except telnyx.APIStatusError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except telnyx.APIConnectionError:
        raise HTTPException(status_code=503, detail="Network error connecting to Telnyx")


@app.post("/calls/transfer")
async def transfer_endpoint(request: CallActionRequest):
    """Transfer an active call to another number."""
    if not request.transfer_to:
        raise HTTPException(status_code=400, detail="transfer_to is required")
    
    try:
        result = transfer_call(request.call_control_id, request.transfer_to)
        return result
    
    except telnyx.APIStatusError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/calls/{call_control_id}/status")
async def status_endpoint(call_control_id: str):
    """Get the current status of a call."""
    try:
        result = get_call_status(call_control_id)
        return result
    
    except telnyx.APIStatusError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except telnyx.APIConnectionError:
        raise HTTPException(status_code=503, detail="Network error connecting to Telnyx")


@app.post("/webhooks/call-events")
async def handle_call_webhook(request: Request):
    """Webhook endpoint to receive call state change events from Telnyx."""
    body = await request.json()
    
    event_type = body.get("data", {}).get("event_type")
    call_control_id = body.get("data", {}).get("call_control_id")
    
    if not event_type or not call_control_id:
        return JSONResponse({"status": "ignored"}, status_code=200)
    
    if event_type == "call.initiated":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "initiated"
    
    elif event_type == "call.answered":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "answered"
    
    elif event_type == "call.hangup":
        if call_control_id in active_calls:
            active_calls[call_control_id]["status"] = "hangup"
            del active_calls[call_control_id]
    
    elif event_type == "call.dtmf.received":
        digit = body.get("data", {}).get("dtmf_digit")
    
    return JSONResponse({"status": "received"}, status_code=200)


@app.get("/calls/active")
async def list_active_calls():
    """List all active calls."""
    calls_list = [
        {
            "call_control_id": cid,
            "to_number": data.get("to_number"),
            "status": data.get("status"),
        }
        for cid, data in active_calls.items()
    ]
    return {"active_calls": calls_list}


@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
