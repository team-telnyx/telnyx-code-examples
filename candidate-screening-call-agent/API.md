# API

## `openScreen(profile)`

Creates the durable candidate screen, prepares the AI Assistant request, and prepares the outbound TeXML AI call request.

Required fields:

- `candidateId`
- `candidateName`
- `candidatePhone`
- `role`
- `recruiterEmail`
- `rubric` with five `RubricQuestion` entries

## `recordAnswer(qIdx, answer)`

Stores or replaces one answer for a rubric question, scores it with the same output shape expected from `telnyx/decision-flash`, and advances the current pointer.

## `resumeAfterDrop()`

Checks answered `qIdx` values, increments retry state, and returns the next unanswered question. This is the behavior to demo when explaining why the actor matters.

## `screenView()`

Returns recruiter dashboard state: candidate, phone, role, status, current question, answers, scores, summary, and recent events.
