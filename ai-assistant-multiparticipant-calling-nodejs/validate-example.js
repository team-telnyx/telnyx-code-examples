import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.TELNYX_API_KEY = process.env.TELNYX_API_KEY || "KEY_test";
process.env.CONNECTION_ID = process.env.CONNECTION_ID || "conn_test";
process.env.TELNYX_NUMBER = process.env.TELNYX_NUMBER || "+13125550001";
process.env.SPECIALIST_NUMBER = process.env.SPECIALIST_NUMBER || "+13125550002";
process.env.PUBLIC_URL = process.env.PUBLIC_URL || "https://example.ngrok-free.app";

const { buildAssistantConfig, joinSpecialistToAiConversation } = await import("./server.js");

const assistant = buildAssistantConfig();
assert.equal(assistant.model, process.env.AI_ASSISTANT_MODEL || "openai/gpt-4o");
assert.ok(assistant.instructions.includes("dial_specialist"));
assert.equal(assistant.tools.length, 3);
assert.equal(assistant.tools[2].webhook.name, "dial_specialist");
assert.equal(assistant.tools[2].webhook.url, `${process.env.PUBLIC_URL}/tools/dial-specialist`);

let capturedRequest;
globalThis.fetch = async (url, options) => {
  capturedRequest = {
    url,
    method: options.method,
    headers: options.headers,
    body: JSON.parse(options.body),
  };
  return {
    ok: true,
    json: async () => ({ data: {} }),
  };
};

await joinSpecialistToAiConversation(
  { conversationId: "conv_123", events: [], status: "dialing_specialist" },
  "call_456",
);

assert.equal(
  capturedRequest.url,
  "https://api.telnyx.com/v2/calls/call_456/actions/ai_assistant_join",
);
assert.equal(capturedRequest.method, "POST");
assert.equal(capturedRequest.body.conversation_id, "conv_123");
assert.equal(capturedRequest.body.participant.id, "call_456");
assert.equal(capturedRequest.body.participant.role, "user");
assert.equal(capturedRequest.body.participant.on_hangup, "continue_conversation");

await assert.rejects(
  () => joinSpecialistToAiConversation({ conversationId: "", events: [] }, "call_456"),
  /Missing AI conversation_id/,
);

console.log("Example validation passed.");
