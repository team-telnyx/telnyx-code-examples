# Candidate Screening Call Agent Intro

## Recording setup

- Frame: talking head, shoulders up, eye-level camera
- Background: clean and quiet; no dashboard visible yet
- Length: 30 to 40 seconds
- Delivery: conversational, confident, one take is fine
- Avoid saying "benchmark" or describing this as a static mockup

## Script

Hiring teams still spend time on the first phone screen: calling candidates, asking the same questions, taking notes, and deciding who moves forward.

This example turns that first screen into an AI phone call and a durable candidate workflow. From the recruiter dashboard, I enter a candidate's phone number and start the call. Telnyx places the outbound call, the AI assistant asks a bounded set of screening questions, and each answer is scored against the role rubric.

The important part is that the candidate's state continues after the call. The same durable state keeps the answers, scores, and next action together. If the candidate is moving forward, the workflow can text them about the next interview. If the recruiter needs to review the result, or the candidate is not moving forward, the workflow can send the appropriate update without rebuilding the context from scratch.

In the demo, I'll start the call, answer as the candidate, and show how the screening result becomes the next candidate communication.

## Natural shorter version

This example turns a first-round phone screen into an AI call and a durable candidate workflow. Telnyx calls the candidate, the assistant asks role-specific questions, and the answers are scored against a rubric. That same candidate state can then text the candidate about the next interview, human review, or the outcome. I'll show the call start, the scorecard, and the next communication.

## Handoff into the demo

"Let's start the screen. I'll enter the candidate's number, click Start AI Screening Call, and then switch to the recruiter view as the answers come back. From that same candidate state, we can send the next update by text."
