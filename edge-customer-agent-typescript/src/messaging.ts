/**
 * Messaging channel — SMS and WhatsApp via this.env.TELNYX binding.
 *
 * The [telnyx] binding in telnyx.toml gives zero-credential access to
 * the Telnyx API. No API key in code — the platform injects credentials
 * at the edge.
 */

export interface SendSMSParams {
  to: string;
  from: string;
  text: string;
}

export interface TelnyxMessagesBinding {
  send: (params: SendSMSParams) => Promise<unknown>;
}

export interface TelnyxAIBinding {
  openai: {
    chat: {
      createCompletion: (params: {
        model: string;
        messages: Array<{ role: string; content: string }>;
      }) => Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
    };
  };
}

export interface TelnyxBinding {
  messages: TelnyxMessagesBinding;
  ai: TelnyxAIBinding;
}

export async function sendSMS(
  telnyx: TelnyxBinding,
  to: string,
  from: string,
  text: string,
): Promise<void> {
  await telnyx.messages.send({ to, from, text });
}

export async function sendProactiveSMS(
  telnyx: TelnyxBinding,
  to: string,
  from: string,
  text: string,
): Promise<void> {
  await telnyx.messages.send({ to, from, text });
}
