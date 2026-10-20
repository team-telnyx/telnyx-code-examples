---
name: number-remediation
title: "Number Reputation Remediation Desk — Flag-Response Workflow with Tiered Outcomes"
description: "Read enterprise reputation data, submit flagged numbers for two-tier remediation, consume tiered webhooks or poll, and render per-number outcome buckets."
language: python
framework: flask
telnyx_products: [Number Reputation]
---

# Number Reputation Remediation Desk

Close the loop on flagged numbers: read enterprise reputation data, submit the flagged set for two-tier remediation, ride the tiered webhooks (or poll), and render the five per-number outcome buckets into a report.

## The Story

A dental clinic runs outbound appointment reminders every morning — a few hundred calls that keep no-shows down and the schedule full. When the clinic's numbers get flagged as spam, those reminders stop connecting: patients miss appointments, chairs sit empty, and the practice loses revenue it already booked. The clinic's ops lead needs to know which numbers are flagged, get them into remediation, and see — per number — what the carrier review actually decided. The actor IS the remediation desk. It is born the moment a number is flagged: the intake stage reads enterprise reputation data, splits flagged from clean, and writes the flagged set to disk. It evolves through submission — a single `202 Accepted` request carrying up to 2,000 numbers and a `call_purpose` — and then through the two-tier review, surviving the long wait between tier-1 and tier-2 completion, and surviving the case where the webhook endpoint is down entirely (the poll fallback reaches the same final state). It completes when the request reaches `completed` or `failed`, and it terminates by rendering the five outcome buckets — `remediated`, `not_flagged`, `requires_review`, `ineligible`, `refused` — into a reviewable report, with the two-tier timestamps showing where the wall-clock time actually went. The rest of this README is the API surface of that story.

## Why Telnyx

Number Reputation remediation is the operational half of outbound deliverability: Telnyx runs the two-tier carrier review and reports per-number verdicts, so a team can act on flagged numbers instead of guessing. This sample composes the enterprise-scoped reputation read, the remediation submit/poll contract, and the tiered webhooks on top of **AI Communications Infrastructure** — the same platform that carries the calls the clinic is trying to place.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/v2/enterprises/{enterprise_id}/reputation/phone_numbers/{number}` | Read per-number reputation data (`spam_risk`, scores, `spam_category`, `last_refreshed_at`) |
| `POST` | `/v2/enterprises/{enterprise_id}/reputation/remediation` | Submit 1–2,000 E.164 numbers for remediation; returns `202 Accepted` with `status: pending` |
| `GET` | `/v2/enterprises/{enterprise_id}/reputation/remediation/{id}` | Poll a remediation request for `status` and the `results` buckets |
| `GET` | `/v2/enterprises/{enterprise_id}/reputation/remediation` | List remediation requests for the enterprise |
| Webhook | `number_reputation.remediation.tier1_complete` | Tier-1 review finished; request continues to tier 2 |
| Webhook | `number_reputation.remediation.completed` | Request finished; `results` buckets populated |
| Webhook | `number_reputation.remediation.failed` | Request failed; `failure_reason` present |

## Architecture

```text
  numbers.csv
      │
      ▼
┌──────────────────────┐   GET .../reputation/phone_numbers/{n}
│  check_reputation.py │ ───────────────────────────────────────►  Enterprise
│  (flagged-number     │                                          Reputation
│   intake)            │ ◄───────────────────────────────────────  Service
└──────────┬───────────┘   spam_risk / scores / spam_category
           │               last_refreshed_at
           ▼
      flagged.csv
           │
           ▼
┌──────────────────────┐   POST .../reputation/remediation
│ submit_remediation.py│ ───────────────────────────────────────►  Remediation
│  (202 Accepted,      │                                          Pipeline
│   stores request id) │ ◄── 202 {status: pending, counts...}      (two-tier
└──────────┬───────────┘                                          review)
           │
           │  remediation_request_id.txt
           │
     ┌─────┴──────────────────────────────┐
     │                                    │
     ▼                                    ▼
┌──────────────────────┐   webhooks   ┌──────────────────────┐
│ webhook_receiver.py  │ ◄────────────│  tier1_complete      │
│ (Flask, Ed25519      │              │  completed / failed  │
│  verified)           │              └──────────────────────┘
└──────────────────────┘
     │
     │  (fallback when no webhook endpoint exists)
     ▼
┌──────────────────────┐   GET .../reputation/remediation/{id}
│ poll_remediation.py  │ ───────────────────────────────────────►  Remediation
│ (60 s interval,      │                                          Pipeline
│  status transitions) │ ◄── status / tier1_completed_at /        (two-tier
└──────────┬───────────┘     tier2_completed_at / results          review)
           │
           ▼
┌──────────────────────┐
│     report.py        │  renders remediated / not_flagged /
│ (five outcome        │  requires_review / ineligible / refused
│  buckets + timing)   │  → remediation_report.md
└──────────────────────�
