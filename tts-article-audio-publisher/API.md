# API Reference — TTS Article-to-Audio Publisher

This document describes every HTTP endpoint exposed by the Flask application in `app.py`.

---

## Table of Contents

1. [GET /health](#get-health)
2. [POST /run](#post-run)
3. [POST /schedule](#post-schedule)
4. [GET /article/<article_id>/status](#get-articlearticle_idstatus)

---

## GET /health

Returns a simple health-check response indicating the service is running.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| *(none)* | — | — | No request body or query parameters. |

### Example Request

```bash
curl -X GET http://localhost:8080/health
```

### Response Schema

**Status Code: 200 OK**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"ok"`. |
| `service` | string | Service identifier: `"tts-article-audio-publisher"`. |

### Example Response

```json
{
  "status": "ok",
  "service": "tts-article-audio-publisher"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Service is healthy and responding. |

---

## POST /run

Manually triggers one full detect → synthesize → publish → verify cycle.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| *(none)* | — | — | No request body required. |

### Example Request

```bash
curl -X POST http://localhost:8080/run
```

### Response Schema

**Status Code: 200 OK**

| Field | Type | Description |
|-------|------|-------------|
| `total_articles` | integer | Total number of articles fetched from SQLDB. |
| `processed` | integer | Number of articles successfully synthesized, published, and verified. |
| `skipped` | integer | Number of articles skipped because they were unchanged. |
| `failed` | integer | Number of articles that failed during processing. |
| `details` | array of objects | Per-article result objects. See [Detail Object Schema](#detail-object-schema). |

#### Detail Object Schema

| Field | Type | Description |
|-------|------|-------------|
| `article_id` | string | The article identifier. |
| `status` | string | One of: `"success"`, `"cdn_verification_failed"`, `"error"`. |
| `cdn_url` | string | *(success / cdn_verification_failed)* Public CDN URL of the published audio. |
| `content_hash` | string | *(success)* SHA-256 hash of the article body. |
| `error` | string | *(error)* Error message describing the failure. |

### Example Response

```json
{
  "total_articles": 3,
  "processed": 3,
  "skipped": 0,
  "failed": 0,
  "details": [
    {
      "article_id": "article-001",
      "status": "success",
      "cdn_url": "https://cdn.telnyx.com/bucket/tts-audio/article-001/abc123.mp3",
      "content_hash": "abc123"
    },
    {
      "article_id": "article-002",
      "status": "success",
      "cdn_url": "https://cdn.telnyx.com/bucket/tts-audio/article-002/def456.mp3",
      "content_hash": "def456"
    },
    {
      "article_id": "article-003",
      "status": "success",
      "cdn_url": "https://cdn.telnyx.com/bucket/tts-audio/article-003/ghi789.mp3",
      "content_hash": "ghi789"
    }
  ]
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Cycle completed successfully (may include individual article failures in `details`). |
| 500 | Internal server error — the cycle could not be executed. |

---

## POST /schedule

Scheduled/cron trigger endpoint. Accepts a Telnyx Function cron event payload and runs one processing cycle.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | object | No | A Telnyx Function cron event payload. Logged for observability; does not affect processing logic. |

### Example Request

```bash
curl -X POST http://localhost:8080/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "event": "scheduled",
    "timestamp": "2024-01-15T10:00:00Z",
    "source": "telnyx-functions-cron"
  }'
```

### Response Schema

**Status Code: 200 OK**

Same schema as [POST /run](#post-run).

### Example Response

```json
{
  "total_articles": 3,
  "processed": 0,
  "skipped": 3,
  "failed": 0,
  "details": []
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Scheduled cycle completed successfully. |
| 500 | Internal server error — the scheduled cycle could not be executed. |

---

## GET /article/<article_id>/status

Checks the publication status of a specific article by its ID.

### Path Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `article_id` | string | Yes | The unique identifier of the article. |

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| *(none)* | — | — | No request body or query parameters. |

### Example Request

```bash
curl -X GET http://localhost:8080/article/article-001/status
```

### Response Schema

**Status Code: 200 OK**

#### When the article has been published (KV version exists):

| Field | Type | Description |
|-------|------|-------------|
| `article_id` | string | The article identifier. |
| `published` | boolean | Always `true`. |
| `content_hash` | string | The stored content hash used as the version key. |
| `cdn_url` | string | Public CDN URL of the published audio file. |

#### When the article has not been published (no KV version):

| Field | Type | Description |
|-------|------|-------------|
| `article_id` | string | The article identifier. |
| `published` | boolean | Always `false`. |

### Example Response (Published)

```json
{
  "article_id": "article-001",
  "published": true,
  "content_hash": "abc123",
  "cdn_url": "https://cdn.telnyx.com/bucket/tts-audio/article-001/abc123.mp3"
}
```

### Example Response (Not Published)

```json
{
  "article_id": "article-001",
  "published": false
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Status retrieved successfully. |
| 500 | Internal server error — status check failed. |

---

## Appendix: Detail Object Schema

Used in the `details` array of [POST /run](#post-run) and [POST /schedule](#post-schedule) responses.

| Field | Type | Description |
|-------|------|-------------|
| `article_id` | string | The article identifier. |
| `status` | string | One of: `"success"`, `"cdn_verification_failed"`, `"error"`. |
| `cdn_url` | string | *(success / cdn_verification_failed)* Public CDN URL of the published audio. |
| `content_hash` | string | *(success)* SHA-256 hash of the article body. |
| `error` | string | *(error)* Error message describing the failure. |
