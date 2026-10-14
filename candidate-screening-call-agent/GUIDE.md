# Guide

## Architecture

`CandidateScreen` is the durable workflow owner. The assistant owns the conversation. Decision Models own structured scoring. The dashboard reads actor state.

The sample deliberately keeps the operational work outside the prompt. The prompt can ask a candidate a question, but it does not decide whether to retry a dropped call, overwrite a previous answer, or advance the candidate.

## Video Flow

1. Show the recruiter opening a screen for one candidate.
2. Show the outbound call payload and assistant settings.
3. Answer two rubric questions as the candidate.
4. Simulate a dropped call and show `resumeAfterDrop()`.
5. Finish the five answers and show the scorecard.

## Production Notes

Replace the local scoring helper with a real request to `POST /v2/ai/typesafe/v1/systemone` using model `telnyx/decision-flash`. Persist `answers`, `scores`, and `events` to SQL so the same actor can recover after deploys or restarts.
