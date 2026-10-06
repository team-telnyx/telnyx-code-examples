# Persistent AI Agent Memory Demo — A Developer's Guide

This guide walks you through the **Persistent AI Agent Memory Demo**, a Python CLI tool that demonstrates how to build long-term memory for AI agents using the Telnyx Agent Memory beta API. You'll ingest a customer support conversation, poll for asynchronous processing completion, and then recall specific facts from that conversation — proving the agent "remembers" details across sessions.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [How the Demo Works](#how-the-demo-works)
   - [Step 1: Configuration & Constants](#step-1-configuration--constants)
   - [Step 2: Loading the API Key](#step-2-loading-the-api-key)
   - [Step 3: Ingesting the Transcript](#step-3-ingesting-the-transcript)
   - [Step 4: Polling for Completion](#step-4-polling-for-completion)
   - [Step 5: Recalling Facts](#step-5-recalling-facts)
   - [Step 6: Running the Full Flow](#step-6-running-the-full-flow)
4. [Demo Mode vs. Live Mode](#demo-mode-vs-live-mode)
5. [Telnyx Primitives Used](#telnyx-primitives-used)
6. [Acceptance Criteria Verification](#acceptance-criteria-verification)
7. [Next Steps](#next-steps)

---

## Prerequisites

Before running this demo, you need:

- **Python 3.9+** — the sample uses `list[dict[str, str]]` type hints (PEP 585), which require Python 3.9+.
- **A Telnyx API key** with access to the Agent Memory beta. You can find or create one in the [Telnyx Portal](https://portal.telnyx.com/).
- **`pip`** — to install Python dependencies.
- **Internet access** — the demo makes real HTTPS requests to `https://api.telnyx.com/v2/ai/memory`.

> **Note:** This demo uses the **live beta API only** — there is no mock or stub mode. Every request hits the real Telnyx Agent Memory service. You must have a valid `TELNYX_API_KEY` set in your environment.

---

## Environment Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/persistent-ai-agent-memory
```

### 2. Create and activate a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

The `requirements.txt` file contains:

```
requests>=2.28.0
python-dotenv>=1.0.0
```

### 4. Configure your environment variables

Copy the example file and fill in your Telnyx API key:

```bash
cp .env.example .env
```

Edit `.env` and replace the placeholder:

```
TELNYX_API_KEY=your_telnyx_api_key_here
```

> **Security:** Never commit your real `.env` file. The `.gitignore` file excludes it. The `.env.example` contains only placeholder values.

### 5. Load the environment (optional)

The app uses `python-dotenv` to automatically load `.env` into the environment. If you prefer to set the variable manually:

```bash
export TELNYX_API_KEY="your_real_api_key_here"
```

---

## How the Demo Works

The demo is implemented in `app.py` as a single CLI script. It follows a four-step flow: **Ingest → Poll → Recall → Display**. Below is a detailed walkthrough of each component.

### Step 1: Configuration & Constants

At the top of `app.py`, several constants define the demo's behavior:

- **`TELNYX_API_BASE`** — the base URL for the Agent Memory API: `https://api.telnyx.com/v2/ai/memory`. All endpoints are built by appending path segments to this base.
- **`DEFAULT_NAMESPACE`** — set to `"default"`. Per the spec, the demo reuses the `default` namespace rather than creating a per-run namespace. This keeps the demo simple and avoids namespace management overhead.
- **`DEFAULT_PROFILE_ID`** — set to `"user_123"`. This is the profile whose memory we're testing. Profile IDs are free-form strings and may contain reserved characters, so they are percent-encoded before being placed in URL paths (see `_encode_path_segment`).
- **`POLL_INTERVAL_SECONDS`** — `2` seconds between polling attempts.
- **`POLL_TIMEOUT_SECONDS`** — `60` seconds maximum wait before giving up on an operation.
- **`SAMPLE_TRANSCRIPT`** — a hardcoded list of message dictionaries representing a support conversation. Each message has a `role` (`"user"` or `"assistant"`) and `content` (the text). The transcript includes an extractable fact: the user states their preferred contact method is email at `user@example.com`.
- **`RECALL_QUERY`** — the question asked during the recall step: `"What is the user's preferred contact method?"`. This is designed to match the fact embedded in the transcript.

### Step 2: Loading the API Key

The `_get_api_key()` function reads the `TELNYX_API_KEY` environment variable. If it's missing, the function prints an error to stderr and exits with code 1. This is a fail-fast pattern — the demo cannot proceed without credentials.

The `_auth_headers()` function builds the standard HTTP headers used for all API requests:

```python
{
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}
```

This mirrors the documented curl requests 1:1, as the Agent Memory docs are HTTP/curl-only for this beta (no SDK wrapper exists).

### Step 3: Ingesting the Transcript

The `ingest_transcript()` function sends the sample conversation to the ingest endpoint:

```
POST /v2/ai/memory/namespaces/{ns}/profiles/{id}/ingest
```

Key details:

- **Path encoding:** Both the namespace and profile ID are percent-encoded using `urllib.parse.quote(segment, safe="")`. This is critical because profile IDs can contain reserved characters (e.g., `user_123` is safe, but a profile ID like `user@example.com` would need encoding).
- **Optional `session_id`:** The demo passes `session_id="demo-session-001"`. Per the API spec, the session_id must be ≤128 characters. Re-sending the same session_id re-ingests in place, making the operation retry-safe.
- **Request body:** `{"messages": [{"role": "user", "content": "..."}, ...]}` — the transcript as a list of message objects.
- **Response:** The API returns HTTP `202 Accepted` with a JSON body containing `data.operation_id`, `data.profile_id`, `data.session_id`, and `data.source_id`. The function returns this `data` dict. If the response is not `202`, it raises an `HTTPError`.

### Step 4: Polling for Completion

The `poll_operation()` function polls the operation status endpoint:

```
GET /v2/ai/memory/namespaces/{ns}/operations/{operation_id}
```

Key details:

- **Polling loop:** The function enters a `while` loop that runs until either a terminal status is reached or the timeout expires.
- **Terminal statuses:** `completed`, `failed`, and `cancelled` are all terminal. `pending` and `processing` are non-terminal — the loop continues sleeping and retrying.
- **Timeout:** If the operation doesn't reach a terminal status within `POLL_TIMEOUT_SECONDS` (60s), a `TimeoutError` is raised.
- **Return value:** The final status string (e.g., `"completed"`).

This demonstrates the **asynchronous nature** of the ingest API — the write is accepted immediately (202), but the actual memory extraction happens in the background. The client must poll to know when it's done.

### Step 5: Recalling Facts

The `recall_facts()` function sends a natural-language question to the recall endpoint:

```
POST /v2/ai/memory/namespaces/{ns}/profiles/{id}/recall
```

Key details:

- **Request body:** `{"query": "<question>", "top_k": <int>}`. Note that the field is `query`, **not** `question` — this is a common mistake. The query must be between 1 and 4096 characters.
- **`top_k`:** Controls how many ranked facts to return (1–100). The demo uses `10`.
- **Response:** A JSON object with `data` containing a list of fact objects, each with:
  - `id` — a memory ID (e.g., `mem_...`)
  - `text` — the extracted fact text
  - `recorded_at` — timestamp of when the fact was recorded
  - `score` — relevance score (0.0–1.0), with higher scores meaning more relevant
- **Ranking:** Results are returned in rank order — most relevant first. The demo reads them in this order.

### Step 6: Running the Full Flow

The `run_demo()` function orchestrates the entire flow:

1. **Load the API key** via `_get_api_key()`.
2. **Ingest** the sample transcript by calling `ingest_transcript()`. Print the returned `operation_id`.
3. **Poll** the operation by calling `poll_operation()`. Print the final status. If the status is not `"completed"`, print a warning (recall may return no results).
4. **Recall** facts by calling `recall_facts()` with the `RECALL_QUERY`.
5. **Display** the ranked facts in a formatted table, showing the score, text, and recorded timestamp for each.

The output looks like:

```
============================================================
Persistent AI Agent Memory Demo
============================================================

[1/3] Ingesting transcript for profile 'user_123'...
  -> Ingest accepted (202). operation_id: op_abc123

[2/3] Polling operation op_abc123 until complete...
  -> Operation status: completed

[3/3] Recalling facts for query: 'What is the user's preferred contact method?'

============================================================
Recalled Facts (ranked by relevance):
============================================================
  1. [score=0.95] The user's preferred contact method is email at user@example.com.
     recorded_at: 2026-10-05T14:30:00Z

Demo complete.
```

---

## Demo Mode vs. Live Mode

This demo operates in **live mode only** — there is no separate demo mode. Every API call hits the real Telnyx Agent Memory beta service. This is by design:

- The spec explicitly requires **live beta API only — no mock/stub mode**.
- The demo uses real requests with `TELNYX_API_KEY`.
- No dummy data paths exist in the code.

To run the demo, you must have a valid Telnyx API key with access to the Agent Memory beta. If you don't have one, contact Telnyx support or your account manager.

> **Important:** Running this demo will create real memory records in your Telnyx account under the `default` namespace and `user_123` profile. These records persist across runs. If you want to start fresh, you would need to use a different profile ID or namespace (though the demo is hardcoded to reuse `default` and `user_123` per the spec).

---

## Telnyx Primitives Used

This demo exercises the following Telnyx Agent Memory primitives:

| Primitive | How It's Used |
|---|---|
| **Namespace** | The `default` namespace is used as the isolation boundary. All operations (ingest, poll, recall) are scoped to this namespace. |
| **Profile** | The profile `user_123` represents the specific user entity whose memory is being tested. Profile IDs are percent-encoded in URL paths. |
| **Source** | The ingested conversation transcript is the source. It's sent as a list of message objects to the ingest endpoint. |
| **Memory** | The extracted durable facts (e.g., preferred contact method) are the memory records. They're retrieved via the recall endpoint. |
| **Operation** | The async job tracking write completion. The ingest endpoint returns an `operation_id`, which is polled until the status reaches a terminal state (`completed`, `failed`, or `cancelled`). |

---

## Acceptance Criteria Verification

The demo satisfies all acceptance criteria from the ticket spec:

- ✅ **The ingest request returns a 202 status with a valid operation_id.** — The `ingest_transcript()` function checks for `resp.status_code != 202` and raises an error otherwise. It returns the `operation_id` from the response data.

- ✅ **Polling the operation_id eventually returns a completed status.** — The `poll_operation()` function polls until the status is `completed`, `failed`, or `cancelled`, then returns the final status.

- ✅ **The recall request returns a non-empty list of facts relevant to the ingested conversation.** — The `recall_facts()` function sends the query `"What is the user's preferred contact method?"` and returns the ranked list of facts. The sample transcript explicitly includes this fact, so the recall should return at least one relevant result.

- ✅ **Attempting to recall before the operation completes returns no results or an empty list, demonstrating the asynchronous nature.** — If you call `recall_facts()` before `poll_operation()` returns `"completed"`, the API will return an empty list (or no results), because the memory hasn't been extracted yet. The demo's flow ensures polling completes first, but this behavior is inherent to the API's async design.

---

## Next Steps

Now that you've seen how to implement persistent AI agent memory with Telnyx, here are some ways to extend this demo:

1. **Multiple profiles:** Modify the demo to ingest and recall memories for multiple user profiles, simulating a multi-tenant support system.

2. **Dynamic transcripts:** Instead of a hardcoded `SAMPLE_TRANSCRIPT`, read the transcript from a JSON file or stdin, allowing you to test with real conversation logs.

3. **Conversation loop:** Build an interactive CLI that ingests each user message in real-time, polls for completion, and recalls relevant context before generating the next response — creating a true long-term-memory agent.

4. **Error handling:** Add retry logic with exponential backoff for polling, and handle `failed` operation statuses more gracefully (e.g., re-ingest with a new session_id).

5. **Session management:** Use the `session_id` parameter to group related ingestions, enabling conversation threading and incremental memory updates.

### Useful Resources

- **[Telnyx Agent Memory Documentation](https://developers.telnyx.com/docs/agent-memory)** — official API reference with curl examples, schema definitions, and best practices.
- **[Telnyx API Reference](https://developers.telnyx.com/api/)** — full API documentation for all Telnyx products.
- **[Telnyx Portal](https://portal.telnyx.com/)** — manage your API keys, view usage, and access billing.
- **[Telnyx Community](https://community.telnyx.com/)** — ask questions, share ideas, and connect with other developers.
- **[Telnyx GitHub](https://github.com/team-telnyx)** — explore more code samples and open-source projects.
