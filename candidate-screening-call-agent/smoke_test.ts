import assert from "node:assert/strict";
import {
  CandidateScreen,
  actorNameForPhone,
  defaultRubric,
  type CandidateProfile,
} from "./src/index.js";

const profile: CandidateProfile = {
  candidateId: "cand_123",
  candidateName: "Jordan Lee",
  candidatePhone: "+1 (555) 867-5309",
  role: "developer advocate",
  recruiterEmail: "recruiting@example.com",
  rubric: defaultRubric("developer advocate"),
};

assert.equal(actorNameForPhone(profile.candidatePhone), "candidate-screen-15558675309");

const screen = new CandidateScreen({
  OUTBOUND_TEXML_APP_ID: "texml_123",
  OUTBOUND_CALLER_ID: "+15551234567",
  WEBHOOK_TOOL_URL: "https://example.com/screen/score",
  SCREEN_RETRY_MAX: "2",
});

const opened = screen.openScreen(profile);
assert.equal(opened.actorName, "candidate-screen-15558675309");
assert.equal((opened.assistantPayload.voice_settings as { voice: string }).voice, "Telnyx.Ultra.Clara");
assert.equal((opened.assistantPayload.telephony_settings as { voicemail_detection: string }).voicemail_detection, "premium");
assert.equal((opened.dialPayload as { MachineDetection: string }).MachineDetection, "Enable");
assert.equal((opened.dialPayload as { DetectionMode: string }).DetectionMode, "Premium");

const first = screen.recordAnswer(
  0,
  "I want this Telnyx role because I built a specific developer onboarding example and measured activation from docs into first API call."
);
assert.equal(first.choice, "pass");
assert.equal(first.noul, "no");
assert.equal(screen.nextUnansweredQuestion()?.qIdx, 1);

const retry = screen.resumeAfterDrop();
assert.equal(retry.shouldRetry, true);
assert.equal(retry.nextQuestion?.qIdx, 1);

screen.recordAnswer(1, "I explained webhooks with an example, tailored to the audience, and measured outcome.");
screen.recordAnswer(2, "I debugged a customer issue, found the root cause, documented the tradeoff, and shipped follow-up.");
screen.recordAnswer(3, "I measure usage, activation, and qualitative feedback from developers.");
screen.recordAnswer(4, "I want to clarify how the team thinks about growth and specific launch goals.");

const view = screen.screenView() as { status: string; summary: { recommendedNextStep: string } };
assert.equal(view.status, "complete");
assert.equal(view.summary.recommendedNextStep, "advance");

const decisionPayload = screen.buildDecisionPayload(3);
assert.equal((decisionPayload as { model: string }).model, "telnyx/decision-flash");

const reviewScreen = new CandidateScreen();
reviewScreen.openScreen(profile);
const reviewScore = reviewScreen.recordAnswer(0, "visa");
assert.equal(reviewScore.noul, "yes");
assert.equal((reviewScreen.screenView() as { status: string }).status, "screening");

console.log("candidate-screening-call-agent smoke test passed");
