"""
Persistent AI Agent Memory Demo (CLI tool).

Demonstrates long-term memory for AI agents using the Telnyx Agent Memory
beta API (https://api.telnyx.com/v2/ai/memory).

ASSUMPTION: The spec asks for a CLI tool (not a web service) that calls the
beta Agent Memory API directly with `requests`, mirroring the documented
curl requests 1:1. No SDK wrapper exists for this beta, so raw HTTP is used.

Demo flow:
  1. Ingest a sample support transcript for profile "user_123" in namespace "default".
  2. Poll the returned operation_id until the write completes.
  3. Recall facts by asking "What is the user's preferred contact method?".
  4. Print the ranked facts returned by the recall endpoint.

Usage:
  python app.py
"""

import os
import sys
import time
import urllib.parse
import requests
from typing import Any

from dotenv import load_dotenv

load_dotenv()

TELNYX_API_BASE = "https://api.telnyx.com/v2/ai/memory"
DEFAULT_NAMESPACE = "default"
DEFAULT_PROFILE_ID = "user_123"
POLL_INTERVAL_SECONDS = 2
POLL_TIMEOUT_SECONDS = 60

# Sample support transcript with an extractable fact about preferred contact method.
SAMPLE_TRANSCRIPT: list[dict[str, str]] = [
    {"role": "user", "content": "Hi, I'm having trouble with my Telnyx SMS messaging."},
    {"role": "assistant", "content": "I'm sorry to hear that. Can you tell me more about the issue?"},
    {"role": "user", "content": "Messages are failing to send to some international destinations."},
    {"role": "assistant", "content": "Let me check your account configuration. What's your account ID?"},
    {"role": "user", "content": "My account ID is AC-1234567890."},
    {"role": "assistant", "content": "Thanks. I see the issue — you need to enable international routing."},
    {"role": "user", "content": "Got it. By the way, my preferred contact method is email at user@example.com."},
    {"role": "assistant", "content": "Noted. I've enabled international routing for your account. You should be all set."},
]

RECALL_QUERY = "What is the user's preferred contact method?"


def _get_api_key() -> str:
    """Load the Telnyx API key from the environment."""
    api_key = os.getenv("TELNYX_API_KEY")
    if not api_key:
        print("ERROR: TELNYX_API_KEY environment variable is not set.", file=sys.stderr)
        sys.exit(1)
    return api_key


def _auth_headers(api_key: str) -> dict[str, str]:
    """Build standard auth headers for Telnyx API requests."""
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _encode_path_segment(segment: str) -> str:
    """Percent-encode a path segment (e.g. profile id with reserved chars)."""
    return urllib.parse.quote(segment, safe="")


def ingest_transcript(
    api_key: str,
    namespace: str,
    profile_id: str,
    messages: list[dict[str, str]],
    session_id: str | None = None,
) -> dict[str, Any]:
    """
    POST to the ingest endpoint and return the parsed response data.

    Returns a dict with keys: operation_id, profile_id, session_id, source_id.
    Raises requests.HTTPError on non-202 responses.
    """
    ns_enc = _encode_path_segment(namespace)
    pid_enc = _encode_path_segment(profile_id)
    url = f"{TELNYX_API_BASE}/namespaces/{ns_enc}/profiles/{pid_enc}/ingest"

    params: dict[str, str] = {}
    if session_id:
        if len(session_id) > 128:
            raise ValueError("session_id must be <= 128 characters")
        params["session_id"] = session_id

    body = {"messages": messages}
    headers = _auth_headers(api_key)

    resp = requests.post(url, headers=headers, params=params, json=body, timeout=30)
    if resp.status_code != 202:
        resp.raise_for_status()

    data = resp.json().get("data", {})
    return data


def poll_operation(
    api_key: str,
    namespace: str,
    operation_id: str,
    interval: float = POLL_INTERVAL_SECONDS,
    timeout: float = POLL_TIMEOUT_SECONDS,
) -> str:
    """
    Poll the operation status endpoint until a terminal status is reached.

    Terminal statuses: completed, failed, cancelled.
    Returns the final status string.
    Raises TimeoutError if polling exceeds the timeout.
    """
    ns_enc = _encode_path_segment(namespace)
    op_enc = _encode_path_segment(operation_id)
    url = f"{TELNYX_API_BASE}/namespaces/{ns_enc}/operations/{op_enc}"
    headers = _auth_headers(api_key)

    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json().get("data", {})
        status = data.get("status", "unknown")

        if status in ("completed", "failed", "cancelled"):
            return status

        time.sleep(interval)

    raise TimeoutError(f"Operation {operation_id} did not complete within {timeout}s")


def recall_facts(
    api_key: str,
    namespace: str,
    profile_id: str,
    query: str,
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """
    POST to the recall endpoint and return the ranked list of memory facts.

    Each fact dict has: id, text, recorded_at, score.
    """
    if not query or len(query) > 4096:
        raise ValueError("query must be between 1 and 4096 characters")
    if not (1 <= top_k <= 100):
        raise ValueError("top_k must be between 1 and 100")

    ns_enc = _encode_path_segment(namespace)
    pid_enc = _encode_path_segment(profile_id)
    url = f"{TELNYX_API_BASE}/namespaces/{ns_enc}/profiles/{pid_enc}/recall"

    body = {"query": query, "top_k": top_k}
    headers = _auth_headers(api_key)

    resp = requests.post(url, headers=headers, json=body, timeout=30)
    resp.raise_for_status()

    return resp.json().get("data", [])


def run_demo() -> None:
    """Execute the full demo flow: ingest -> poll -> recall -> display."""
    api_key = _get_api_key()

    print("=" * 60)
    print("Persistent AI Agent Memory Demo")
    print("=" * 60)

    # Step 1: Ingest
    print(f"\n[1/3] Ingesting transcript for profile '{DEFAULT_PROFILE_ID}'...")
    ingest_data = ingest_transcript(
        api_key=api_key,
        namespace=DEFAULT_NAMESPACE,
        profile_id=DEFAULT_PROFILE_ID,
        messages=SAMPLE_TRANSCRIPT,
        session_id="demo-session-001",
    )
    operation_id = ingest_data.get("operation_id")
    print(f"  -> Ingest accepted (202). operation_id: {operation_id}")

    # Step 2: Poll
    print(f"\n[2/3] Polling operation {operation_id} until complete...")
    status = poll_operation(api_key, DEFAULT_NAMESPACE, operation_id)
    print(f"  -> Operation status: {status}")
    if status != "completed":
        print(f"  WARNING: Operation did not complete successfully (status={status}).")
        print("  Recall may return no results.")

    # Step 3: Recall
    print(f"\n[3/3] Recalling facts for query: '{RECALL_QUERY}'")
    facts = recall_facts(
        api_key=api_key,
        namespace=DEFAULT_NAMESPACE,
        profile_id=DEFAULT_PROFILE_ID,
        query=RECALL_QUERY,
        top_k=10,
    )

    # Step 4: Display
    print("\n" + "=" * 60)
    print("Recalled Facts (ranked by relevance):")
    print("=" * 60)
    if not facts:
        print("  (no facts returned)")
    else:
        for i, fact in enumerate(facts, 1):
            text = fact.get("text", "")
            score = fact.get("score", 0)
            recorded = fact.get("recorded_at", "")
            print(f"  {i}. [score={score}] {text}")
            print(f"     recorded_at: {recorded}")

    print("\nDemo complete.")


if __name__ == "__main__":
    run_demo()
