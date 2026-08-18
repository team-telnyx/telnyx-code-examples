## API Endpoints

### `POST /upload`

Upload an audio file and trigger the transcribe → summarize → SMS pipeline.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | **yes** | Audio file (WAV, MP3) |
| `recipient_phone` | string | **yes** | E.164 phone number to send the SMS summary to |

**Response:**

```json
{
  "action": "queued",
  "audioKey": "voicemails/1724359200000-voicemail.wav",
  "agentId": "voicemails-1724359200000-voicemail.wav",
  "recipientPhone": "+17177247292",
  "statusUrl": "/status/voicemails-1724359200000-voicemail.wav"
}
```

---

### `GET /status/:agentId`

Check the pipeline status for a given upload.

**Response (in progress):**

```json
{
  "audioKey": "voicemails/1724359200000-voicemail.wav",
  "bucket": "my-voicemail-bucket",
  "recipientPhone": "+17177247292",
  "senderPhone": "+18005551234",
  "transcript": "",
  "summary": "",
  "status": "transcribing",
  "error": "",
  "createdAt": 1724359200000,
  "completedAt": 0
}
```

**Response (done):**

```json
{
  "audioKey": "voicemails/1724359200000-voicemail.wav",
  "bucket": "my-voicemail-bucket",
  "recipientPhone": "+17177247292",
  "senderPhone": "+18005551234",
  "transcript": "Hi, this is John. I'm calling about the invoice from last week...",
  "summary": "John called about an invoice from last week. He wants a callback to discuss it.",
  "status": "done",
  "error": "",
  "createdAt": 1724359200000,
  "completedAt": 1724359210000
}
```

**Status values:** `pending` → `transcribing` → `summarizing` → `sending` → `done` | `error`

---

### `GET /health/liveness`

```json
"ok"
```

---

### `GET /health/readiness`

```json
"ok"
```

---

### `POST /debug/simulate`

Simulate the pipeline without uploading a real file. Uses a pre-existing Cloud Storage key.

**Request:** `application/json`

```json
{
  "audio_key": "voicemails/existing-file.wav",
  "recipient_phone": "+17177247292"
}
```

**Response:**

```json
{
  "action": "queued",
  "agentId": "debug-1724359200000",
  "recipientPhone": "+17177247292"
}
```
