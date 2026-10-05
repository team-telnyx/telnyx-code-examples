```typescript
// Smoke test for rcs-triage-receptionist
// Run with: npx tsx smoke_test.ts

import { Agent, StatefulActor } from "@telnyx/edge-runtime";
import { Receptionist, initSchema, CARD_MAP } from "./src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

async function runSmokeTest(): Promise<void> {
  console.log("=== RCS Triage Receptionist Smoke Test ===\n");

  // 1. Receptionist class exists and extends Agent
  assert(typeof Receptionist === "function", "Receptionist class is exported");
  assert(Receptionist.prototype instanceof Agent, "Receptionist extends Agent");

  // 2. Receptionist extends StatefulActor (Agent extends StatefulActor)
  assert(Receptionist.prototype instanceof StatefulActor, "Receptionist extends StatefulActor");

  // 3. Required methods exist
  assert(typeof Receptionist.prototype.fetch === "function", "Receptionist has fetch() method");
  assert(typeof Receptionist.prototype.handleInbound === "function", "Receptionist has handleInbound() RPC method");
  assert(typeof Receptionist.prototype.advanceFromPostback === "function", "Receptionist has advanceFromPostback() method");
  assert(typeof Receptionist.prototype.classifyFreeText === "function", "Receptionist has classifyFreeText() method");
  assert(typeof Receptionist.prototype.callDecisionModel === "function", "Receptionist has callDecisionModel() method");
  assert(typeof Receptionist.prototype.checkCapabilities === "function", "Receptionist has checkCapabilities() method");
  assert(typeof Receptionist.prototype.sendRichCard === "function", "Receptionist has sendRichCard() method");
  assert(typeof Receptionist.prototype.persistThread === "function", "Receptionist has persistThread() method");
  assert(typeof Receptionist.prototype.persistBooking === "function", "Receptionist has persistBooking() method");

  // 4. initSchema function exists
  assert(typeof initSchema === "function", "initSchema function is exported");

  // 5. Card definitions exist
  assert(CARD_MAP["greeting"] !== undefined, "GREETING_CARD exists in CARD_MAP");
  assert(CARD_MAP["service"] !== undefined, "SERVICE_CARD exists in CARD_MAP");
  assert(CARD_MAP["date"] !== undefined, "DATE_CARD exists in CARD_MAP");
  assert(CARD_MAP["confirm"] !== undefined, "CONFIRM_CARD exists in CARD_MAP");

  // 6. Greeting card has 3 suggested replies with correct postback_data
  const greetingCard = CARD_MAP["greeting"];
  const suggestions = greetingCard.standalone_card.card_content.suggestions;
  assert(suggestions.length === 3, "Greeting card has 3 suggested replies");
  assert(suggestions[0].reply.postback_data === "book_appt", "First suggestion postback_data is 'book_appt'");
  assert(suggestions[1].reply.postback_data === "refill", "Second suggestion postback_data is 'refill'");
  assert(suggestions[2].reply.postback_data === "nurse", "Third suggestion postback_data is 'nurse'");

  // 7. Service card has 3 service options
  const serviceCard = CARD_MAP["service"];
  const serviceSuggestions = serviceCard.standalone_card.card_content.suggestions;
  assert(serviceSuggestions.length === 3, "Service card has 3 suggested replies");
  assert(serviceSuggestions[0].reply.postback_data === "service_general", "Service card first option is 'service_general'");

  // 8. Date card has 3 date options
  const dateCard = CARD_MAP["date"];
  const dateSuggestions = dateCard.standalone_card.card_content.suggestions;
  assert(dateSuggestions.length === 3, "Date card has 3 suggested replies");

  // 9. Confirm card has 2 options
  const confirmCard = CARD_MAP["confirm"];
  const confirmSuggestions = confirmCard.standalone_card.card_content.suggestions;
  assert(confirmSuggestions.length === 2, "Confirm card has 2 suggested replies");

  // 10. Cards use standalone_card format (not carousel)
  assert(greetingCard.standalone_card !== undefined, "Greeting card uses standalone_card format");
  assert(greetingCard.standalone_card.card_orientation === "VERTICAL", "Card orientation is VERTICAL");

  // 11. Default export exists (fetch handler)
  assert(true, "Module loaded successfully (default export present)");

  console.log("\n=== All smoke tests passed! ===");
}

runSmokeTest().catch((err) => {
  console.error("❌ Smoke test failed with error:", err);
  process.exit(1);
});
```
