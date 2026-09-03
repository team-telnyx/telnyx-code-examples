# PatientAgent — Living Care Coordinator

A TypeScript Telnyx Edge example that demonstrates a **durable agent** representing a patient. The agent tracks appointments, medication schedules, and proactively checks in via SMS — escalating to a human nurse when symptoms worsen.

---

## Prerequisites

- Node.js 18+
- Telnyx account with SMS-enabled phone number
- `TELNYX_API_KEY` environment variable
- Basic familiarity with TypeScript and Telnyx Edge SDK

---

## Environment Setup

1. Clone the repo and navigate to the sample:

```bash
cd patient-agent
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file from the example:

```bash
cp .env.example .env
```

4. Edit `.env` and fill in your values:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PHONE_NUMBER=+1555XXXXXXXX
OPENAI_API_KEY=your_openai_api_key_here
EHR_API_BASE=https://your-ehr-api.example.com
```

> **Demo mode is enabled by default.** No real SMS or calls are sent. Set `DEMO_MODE=false` to switch to live mode.

---

## Running the Sample

### Local Development

```bash
npm run dev
```

This starts the Edge runtime locally. The agent will begin its lifecycle immediately.

### Deploying to Telnyx Edge

```bash
telnyx edge deploy
```

---

## How It Works — Step by Step

### 1. PatientAgent Class & Persistent State

The core of this sample is the `PatientAgent` class, which extends the Telnyx Edge `Agent` base class. It owns all patient state: appointment history, medication schedule, and check-in cadence.

```typescript
// src/index.ts — PatientAgent class definition
class PatientAgent extends Agent {
  patientId: string;
  appointments: Appointment[];
  medications: Medication[];
  lastCheckIn: Date | null;
  ...
}
```

The agent is instantiated with a patient ID (`patient-42`) and loads its state from the Edge KV store on startup.

### 2. Appointment Scheduling + 24h Reminder

When an appointment is scheduled (either via webhook from the EHR or manually), the agent uses `this.schedule()` to queue an SMS reminder 24 hours before the appointment time.

```typescript
// src/index.ts — schedule() usage for appointment reminders
this.schedule(
  'appointment-reminder',
  appointment.time,
  -24 * 60 * 60 * 1000, // 24h before
  () => this.sendAppointmentReminder(appointment)
);
```

The reminder is sent via the Telnyx SMS binding:

```typescript
// src/index.ts — SMS via telnyx binding
await this.env.TELNYX.sms.send({
  from: this.phoneNumber,
  to: this.patientPhone,
  text: `Reminder: You have an appointment on ${formatDate(appointment.time)}.`
});
```

### 3. Missed Appointment Detection

On the appointment date, the agent checks whether the patient attended. If no check-in was received, it triggers a proactive outreach SMS.

```typescript
// src/index.ts — missed appointment detection
this.schedule(
  'missed-appt-check',
  appointment.time,
  30 * 60 * 1000, // 30 min after appointment
  () => this.detectMissedAppointment(appointment)
);
```

The agent sends:

> "We noticed you missed your appointment. Would you like to reschedule?"

### 4. Patient Response → Reschedule via EHR API

When the patient replies "yes" or "reschedule", the agent calls the EHR API to find the next available slot and confirms via SMS.

```typescript
// src/index.ts — EHR API integration for rescheduling
const nextSlot = await this.callEHRApi('/appointments/next-available', {
  patientId: this.patientId,
  reason: appointment.reason
});

await this.env.TELNYX.sms.send({
  from: this.phoneNumber,
  to: this.patientPhone,
  text: `Your new appointment is scheduled for ${formatDate(nextSlot.time)}. Reply CONFIRM to confirm.`
});
```

### 5. Medication Reminders

Medication reminders are set up using `this.every()` — a recurring schedule that fires daily at the prescribed time.

```typescript
// src/index.ts — every() for daily medication reminders
this.every(
  'med-reminder',
  24 * 60 * 60 * 1000, // every 24h
  () => this.sendMedicationReminder()
);
```

SMS sent:

> "Time for your prescription: Lisinopril 10mg. Reply SKIP if you've already taken it."

### 6. Symptom Assessment via LLM

When the patient replies with symptoms (e.g., "feeling worse"), the agent uses OpenAI via the Telnyx AI binding to assess severity.

```typescript
// src/index.ts — LLM inference for symptom assessment
const assessment = await this.env.TELNYX.ai.openai.chat.createCompletion({
  model: 'gpt-3.5-turbo',
  messages: [
    { role: 'system', content: 'You are a clinical triage assistant...' },
    { role: 'user', content: `Patient says: "${message}"` }
  ]
});
```

If the LLM flags the response as high-risk, the agent escalates to a nurse.

### 7. Nurse Escalation (Human-in-the-Loop)

The agent queues the case into a Telnyx Queue and sends an alert to the on-call nurse. When the nurse responds, the agent relays the message back to the patient and schedules a follow-up.

```typescript
// src/index.ts — queue() for nurse escalation
const queueId = await this.env.TELNYX.queues.create({
  name: `nurse-escalation-${this.patientId}`,
  max_wait_time: 300 // 5 minutes
});

await this.env.TELNYX.sms.send({
  from: this.phoneNumber,
  to: this.nursePhone,
  text: `URGENT: Patient ${this.patientId} reports worsening symptoms. Respond with guidance.`
});
```

When the nurse replies, the agent:

1. Relays the nurse's message to the patient
2. Schedules a follow-up appointment via the EHR API
3. Sends a confirmation SMS to the patient

### 8. Self-Waking Follow-Up Check-In

After 14 days, the agent wakes itself using `this.schedule()` to send a proactive check-in.

```typescript
// src/index.ts — self-waking follow-up
this.schedule(
  'followup-checkin',
  Date.now() + 14 * 24 * 60 * 60 * 1000,
  () => this.sendCheckInSMS()
);
```

SMS sent:

> "It's been 2 weeks. How are you feeling? Reply with any concerns."

---

## Telnyx Primitives Used

| Primitive | Usage |
|-----------|-------|
| **Agent SDK** | `PatientAgent extends Agent` — durable entity with persistent state |
| **`this.schedule()`** | One-time scheduled tasks: appointment reminders, missed-appt checks, follow-up wake-ups |
| **`this.every()`** | Recurring tasks: daily medication reminders |
| **`this.queue()`** | Nurse escalation queue with max wait time |
| **SMS Binding** | All outbound/inbound SMS via `this.env.TELNYX.sms.send()` |
| **KV Store** | Patient state persistence (appointments, medications, check-in history) |
| **AI Binding** | OpenAI chat completion for symptom assessment |
| **EHR API** | External REST API for appointment read/write (mocked or real FHIR) |

---

## Demo Mode vs Live Mode

### Demo Mode (Default)

- `DEMO_MODE=true` in `.env`
- SMS messages are logged to console instead of sent
- EHR API calls are mocked with sample data
- No real charges incurred

### Live Mode

- Set `DEMO_MODE=false`
- Real SMS sent via Telnyx
- Real EHR API calls made
- Ensure your Telnyx number is SMS-capable and funded

---

## File Structure

```
patient-agent/
├── src/
│   └── index.ts          # Main agent implementation
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── API.md
├── GUIDE.md
└── smoke_test.ts
```

---

## Smoke Test

Verify the agent loads correctly:

```bash
npm run test
```

This imports the `PatientAgent` class and confirms it initializes without error.

---

## Next Steps

- [Telnyx Edge SDK Documentation](https://docs.telnyx.com/edge)
- [Agent SDK Guide](https://docs.telnyx.com/edge/agents)
- [SMS API Reference](https://developers.telnyx.com/docs/sms)
- [Call Control API](https://developers.telnyx.com/docs/voice/call-control)
- [Webhooks & Ed25519 Verification](https://developers.telnyx.com/docs/webhooks)
- [KV Store Guide](https://docs.telnyx.com/edge/kv-store)
- [Queue API](https://docs.telnyx.com/edge/queues)
- [AI Bindings](https://docs.telnyx.com/edge/ai-bindings)
