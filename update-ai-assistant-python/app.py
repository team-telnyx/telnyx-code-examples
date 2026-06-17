#!/usr/bin/env python3
"""Production-ready FastAPI endpoint for updating AI assistants via Telnyx."""

import os
import telnyx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import uvicorn

load_dotenv()

app = FastAPI()

# Initialize client with the new SDK pattern
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))


class UpdateAssistantRequest(BaseModel):
    """Request schema for updating an AI assistant."""
    name: Optional[str] = None
    instructions: Optional[str] = None
    model: Optional[str] = None
    enabled_features: Optional[List[str]] = None


def update_assistant(
    assistant_id: str,
    name: str = None,
    instructions: str = None,
    model: str = None,
    enabled_features: list = None,
) -> dict:
    """Update an AI assistant and return JSON-serializable response data."""
    # Build update payload with only provided fields
    update_params = {}
    
    if name is not None:
        update_params["name"] = name
    if instructions is not None:
        update_params["instructions"] = instructions
    if model is not None:
        update_params["model"] = model
    if enabled_features is not None:
        update_params["enabled_features"] = enabled_features
    
    if not update_params:
        raise ValueError("At least one field must be provided for update")
    
    # Use client.ai_assistants.update() — NOT client.ai_assistants.update()
    response = client.ai_assistants.update(assistant_id, **update_params)
    
    # Extract serializable data — SDK objects are NOT JSON-serializable
    return {
        "id": response.data.id,
        "name": response.data.name,
        "model": response.data.model,
        "instructions": response.data.instructions,
        "enabled_features": response.data.enabled_features,
        "created_at": response.data.created_at,
    }


@app.put("/assistants/{assistant_id}")
async def update_assistant_endpoint(assistant_id: str, request: UpdateAssistantRequest):
    """HTTP endpoint to update an AI assistant."""
    try:
        result = update_assistant(
            assistant_id=assistant_id,
            name=request.name,
            instructions=request.instructions,
            model=request.model,
            enabled_features=request.enabled_features,
        )
        return result
        
    except telnyx.AuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid API key")
    except telnyx.RateLimitError:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Please slow down.")
    except telnyx.APIStatusError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except telnyx.APIConnectionError:
        raise HTTPException(status_code=503, detail="Network error connecting to Telnyx")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
