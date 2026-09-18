/**
 * The built-in demo recording: a customer-support conversation captured with
 * the original agent's state trail. Every step carries the stage the support
 * agent had reached when it emitted the message, so replay re-enacts both
 * the conversation AND the state changes behind it.
 */
import type { ScriptStep } from "./types.js";

export const DEMO_CONVERSATION_ID = "billing-support-demo";

export const DEMO_SCRIPT: ScriptStep[] = [
  {
    role: "user",
    content: "Hi — I think I was charged twice on my March invoice.",
    delayMs: 600,
    stage: "intake",
  },
  {
    role: "assistant",
    content:
      "Sorry about that — duplicate charges are fixable. Could you confirm the last four digits of the invoice number?",
    delayMs: 1400,
    stage: "intake",
  },
  {
    role: "user",
    content: "Sure, it ends in 4211.",
    delayMs: 900,
    stage: "verifying",
  },
  {
    role: "assistant",
    content: "Thanks. Pulling up invoice …4211 now.",
    delayMs: 1800,
    stage: "verifying",
  },
  {
    role: "assistant",
    content:
      "Found it. I see two charges of $49.00 on March 14 — one at 09:02 UTC and a retry at 09:02:41 UTC.",
    delayMs: 2200,
    stage: "investigating",
  },
  {
    role: "assistant",
    content:
      "The second charge was a payment-retry duplicate on our side, not a second subscription. I've issued a refund for $49.00.",
    delayMs: 2400,
    stage: "resolving",
  },
  {
    role: "user",
    content: "Great — how long until the refund lands?",
    delayMs: 800,
    stage: "resolving",
  },
  {
    role: "assistant",
    content:
      "Card refunds typically settle in 3–5 business days depending on your bank. You'll get an email confirmation shortly.",
    delayMs: 2000,
    stage: "resolving",
  },
  {
    role: "user",
    content: "Perfect, that's everything. Thanks!",
    delayMs: 700,
    stage: "resolving",
  },
  {
    role: "assistant",
    content:
      "You're welcome. I've closed ticket #48211 with the refund reference — reach out any time.",
    delayMs: 1500,
    stage: "resolved",
  },
];

/** Stages in first-appearance order — used by the UI legend and tests. */
export function demoStages(): string[] {
  const seen: string[] = [];
  for (const step of DEMO_SCRIPT) {
    if (step.stage && !seen.includes(step.stage)) seen.push(step.stage);
  }
  return seen;
}
