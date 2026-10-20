---
name: sched-events-retry
title: "Scheduled-Events Retry Campaign Desk — Deadline-Aware Call Campaigns with Attempt Forensics"
description: "Run an outbound reminder campaign on Assistant Scheduled Events with a retry budget, then rebuild every call's attempt history into a delivery scorecard."
language: python
telnyx_products: [AI Assistants, Scheduled Events, Voice, Call Control]
---

# Scheduled-Events Retry Campaign Desk

Schedule one phone-call event per contact with a retry budget, watch the attempt ledger rebuild itself, and print a delivery scorecard that separates reached-on-first-attempt from reached-on-retry-N.

## The Story

A regional outpatient clinic runs a reminder desk: every appointment in the next 48 hours gets a confirmation call, and a no-answer is not a "no" — it is a "try again in five minutes, up to three more times." If the desk misses a patient, the slot goes empty, the clinic eats the cost of an idle provider, and a patient who needed care slips through the cracks. The stakes are money and patient safety, in that order.

The actor IS the retry campaign. It is born when the scheduler stamps one phone-call event per contact across a 45-minute window, each carrying its own retry budget. It evolves as the platform dispatches, gets a busy signal, waits exactly `retry_interval_secs`, and fires again — the clock restarting at `now + interval`, never at the original schedule plus interval. It survives the watcher process dying and being restarted, because the attempt ledger lives on the event, not in memory. It completes when a call is answered and a `conversation_id` is recorded for transcript follow-up, or it terminates when the retry budget is exhausted and the contact is dead-lettered with its final `call_status`. The rest of this README is the API surface of that story.

## Why Telnyx

Scheduled Events is the assistant platform's built-in scheduler, and it is the rare piece of **AI Communications Infrastructure** that owns the hard part of outbound calling: dispatch timing, retry scheduling, and attempt recording. The retry fields (`
