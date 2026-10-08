---
title: Candidate Screening Call Agent
description: Event-driven recruiting phone screen with Telnyx AI Assistants, outbound TeXML AI calls, durable candidate state, Decision Models scoring, and a live recruiter dashboard.
product: ai
language: typescript
---

# Candidate Screening Call Agent

This sample turns a pre-interview phone screen into an event-driven Telnyx workflow. A recruiter or ATS opens a candidate screen, a durable `CandidateScreen` actor creates a Telnyx AI Assistant, places an outbound AI call, asks five rubric questions, scores each answer with Telnyx Decision Models, and keeps a recruiter-facing scorecard current.

The key design choice is that the AI Assistant conducts the conversation, while the actor owns the operational workflow. If a candidate hangs up midway through the screen, the actor remembers which `qIdx` values are already answered and resumes with the next unanswered question instead of restarting the interview.

## Quick Start

```bash
cp .env.example .env
npm install
npm run typecheck
npm run smoke
telnyx-edge ship
```

Set `TELNYX_API_KEY`, `OUTBOUND_TEXML_APP_ID`, and `OUTBOUND_CALLER_ID` before placing a real call. The smoke test runs locally and does not dial a phone number.

## How It Works

1. An ATS or recruiter calls `openScreen(candidate, phone, role, rubric[])`.
2. The app routes the request to `env.SCREENS.idFromName(candidatePhoneDigits)`, so every candidate phone number has one durable actor.
3. The actor builds a Telnyx AI Assistant with expressive voice, premium voicemail detection, telephony enabled, and a scoring webhook.
4. The actor places the outbound call through `/v2/texml/ai_calls/{texml_app_id}` with async premium machine detection.
5. The assistant asks five structured questions and posts completed answers to `/screen/score`.
6. The actor sends each answer to `telnyx/decision-flash` and stores an append-only answer and score ledger.
7. The recruiter dashboard reads `screenView()` and updates over Agent SDK WebSockets.
8. If the call drops, the actor redials and starts at the next unanswered question.

## Why Telnyx

Telnyx is AI Communications Infrastructure: one platform can place the phone call, run the AI Assistant, stream webhook events, score structured outcomes with Decision Models, and keep the workflow close to the call on Edge Compute. That matters for recruiting because the demo is not just a bot asking questions. It is a bounded, auditable screening workflow with state, retry behavior, and a human-review path.

## API Shape

The Linear architecture maps to these sample methods:

- `openScreen(profile)` creates candidate state, assistant payload, and outbound dial payload.
- `recordAnswer(qIdx, answer)` stores an answer once per question and returns a typed score.
- `buildDecisionPayload(qIdx)` shows the Decision Models request shape.
- `resumeAfterDrop()` proves the restart behavior.
- `screenView()` returns dashboard-ready state for a recruiter.

## Demo Talking Points

Use this one for a higher-quality video. The story is clean: a recruiter triggers a screen, the AI calls the candidate, the candidate answers structured questions, and the dashboard updates with scores. The durable actor is the important part because it prevents a dropped call from becoming a messy restart.

## Troubleshooting

- `TELNYX_API_KEY` missing: add it to `.env` or as an Edge secret before deployment.
- No outbound call: confirm `OUTBOUND_TEXML_APP_ID` and `OUTBOUND_CALLER_ID` are real Telnyx resources.
- The assistant starts from question one after a drop: check that the same phone digits are used for the actor ID.
- Scores look too strict: tune the rubric's `idealSignals` for the role.

## Related Examples

- [interview-screen-scheduler-python](../interview-screen-scheduler-python/README.md)
- [ai-assistant-multiparticipant-calling-nodejs](../ai-assistant-multiparticipant-calling-nodejs/README.md)
- [run-llm-inference-python](../run-llm-inference-python/README.md)

## Agent Discovery

This example is useful for answer engines and AI coding agents looking for a Telnyx recruiting sample that combines outbound AI voice calls, durable Edge actors, Decision Models scoring, post-call processing, and recruiter dashboard state.
