import { ScreenWorkflow, defaultRubric, type CandidateProfile } from "./src/workflow.js";

const profile: CandidateProfile = {
  candidateId: "cand_demo",
  candidateName: "Jordan Lee",
  candidatePhone: "+15558675309",
  role: "developer advocate",
  recruiterEmail: "recruiting@example.com",
  rubric: defaultRubric("developer advocate"),
};

const screen = new ScreenWorkflow();

console.log("\n=== candidate screening call agent demo ===\n");
const opened = screen.openScreen(profile);
console.log("1. actor born:", opened.actorName);
console.log("2. assistant payload:");
console.log(JSON.stringify(opened.assistantPayload, null, 2));
console.log("3. outbound texml ai call payload:");
console.log(JSON.stringify(opened.dialPayload, null, 2));

for (const [qIdx, answer] of [
  [0, "I built Telnyx developer examples and measured activation from docs to first API call."],
  [1, "I explained webhooks with a specific example for a developer audience and tracked outcome."],
  [2, "I debugged a customer issue, found the root cause, documented the tradeoff, and shipped follow-up."],
  [3, "I measure usage, activation, and qualitative feedback from developers."],
  [4, "I am excited about this role because it blends building and teaching for developers, and i get to work on things they can run."],
] as const) {
  console.log(`\nanswer ${qIdx + 1}:`, screen.recordAnswer(qIdx, answer));
}

console.log("\n4. recruiter dashboard view:");
console.log(JSON.stringify(screen.screenView(), null, 2));
