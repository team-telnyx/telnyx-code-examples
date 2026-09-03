# API Reference — SQL Migration Agent

## POST /migrate

Triggers a schema migration rollout across all registered actor instances. The `MigrationAgent` queues per-instance work, each instance reads its current schema version from SQL, applies the next migration script from CloudFS, updates the version table, and — when all instances report completion — sends an SMS notification via Telnyx.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `migrationId` | `string` | Yes | Unique identifier for this migration run (UUIDv4 recommended). |
| `targetVersion` | `string` | Yes | Target schema version to migrate to (e.g. `"v1.2.0"`). |
| `instances` | `string[]` | Yes | List of actor instance identifiers to roll out to. |
| `dryRun` | `boolean` | No | If `true`, logs planned actions without applying migrations or sending SMS. Defaults to `false`. |
| `notifyPhone` | `string` | No | E.164 phone number to receive the completion/failure SMS. Required when `dryRun` is `false`. |

### Example Request

```bash
curl -X POST https://<your-worker-url>/migrate \
  -H "Content-Type: application/json" \
  -d '{
    "migrationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "targetVersion": "v1.2.0",
    "instances": ["actor-us-east-1", "actor-us-west-2", "actor-eu-central-1"],
    "dryRun": false,
    "notifyPhone": "+1555XXXXXXXX"
  }'
```

### Response Schema

#### 200 OK

Migration rollout accepted and queued.

```json
{
  "migrationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "queued",
  "instances": ["actor-us-east-1", "actor-us-west-2", "actor-eu-central-1"],
  "targetVersion": "v1.2.0",
  "dryRun": false,
  "queuedAt": "2025-01-15T10:30:00.000Z"
}
```

#### 400 Bad Request

Invalid request body — missing required fields or malformed values.

```json
{
  "error": "Invalid request",
  "details": "Field 'targetVersion' is required"
}
```

#### 404 Not Found

The requested target version migration script does not exist in CloudFS.

```json
{
  "error": "Migration script not found",
  "details": "No script found in CloudFS for version 'v1.2.0'"
}
```

#### 500 Internal Server Error

Unexpected server error during migration orchestration.

```json
{
  "error": "Internal server error",
  "details": "An unexpected error occurred while processing the migration."
}
```

### Status Codes

| Status | Description |
|--------|-------------|
| `200` | Migration rollout successfully queued across all instances. |
| `400` | Request body is missing required fields or contains invalid values. |
| `404` | Target version migration script not found in CloudFS. |
| `500` | Internal server error during migration orchestration. |

### Notes

- When `dryRun` is `true`, the agent logs each planned step (version read, script fetch, version update) but does not execute migrations or send SMS.
- When `dryRun` is `false`, the agent applies migrations in parallel across instances via `this.queue()`. If any instance fails, a rollback is triggered on all instances that have already applied the migration, and an SMS failure notification is sent to `notifyPhone`.
- SMS notifications are sent via `this.env.TELNYX.messages.send()` using the Telnyx API key from the `TELNYX_API_KEY` environment variable.
- Schema version tracking is persisted in the SQL DB version table. Each instance maintains its own version row keyed by instance identifier.
