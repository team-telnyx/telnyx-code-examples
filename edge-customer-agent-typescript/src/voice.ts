/**
 * Voice channel — TeXML for inbound answer, Call Control for programmatic actions.
 *
 * onCall is NOT shipped in Agent SDK V0. Inbound calls arrive as Telnyx
 * webhooks → fetch handler → actor.handleCall(). The actor returns a
 * TeXML response that connects the call to an AI Assistant.
 */

const AI_ASSISTANT_FIRST_MESSAGE = (customerName: string) =>
  `Hello ${customerName}, this is your Telnyx customer agent. How can I help you today?`;

export function buildInboundTeXml(customerName: string, assistantId?: string): string {
  const greeting = AI_ASSISTANT_FIRST_MESSAGE(customerName);
  if (assistantId) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Assistant id="${assistantId}" />
  </Connect>
</Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="female" language="en-US">${greeting}</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" enhanced="true">
    <Say voice="female" language="en-US">Please tell me how I can help you.</Say>
  </Gather>
  <Say voice="female" language="en-US">I didn't hear anything. Goodbye.</Say>
</Response>`;
}

export function buildHangupTeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup />
</Response>`;
}

export interface CallControlAction {
  call_control_id: string;
  command: string;
  params?: Record<string, unknown>;
}

export function buildAnswerCommand(callControlId: string): CallControlAction {
  return { call_control_id: callControlId, command: "answer" };
}

export function buildHangupCommand(callControlId: string): CallControlAction {
  return { call_control_id: callControlId, command: "hangup" };
}

export function buildSpeakCommand(callControlId: string, text: string): CallControlAction {
  return {
    call_control_id: callControlId,
    command: "send_speech",
    params: { payload: text, voice: "female", language: "en-US" },
  };
}
