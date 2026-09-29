# Warm Transfer Demo Script

## Presenter opening

> This demo shows a billing-dispute warm transfer. The first agent collects the
> issue and asks for consent before escalating. Telnyx then creates a separate
> specialist call leg, plays a private introduction in a different voice, and
> bridges the caller to the specialist. For this demo the specialist is another
> automated agent. In a production deployment, the same transfer can connect
> to a human billing specialist or specialist queue.

## Live call

Assistant:

> hi, this is cedar harbor bank billing support. how can i help you today?

Caller:

> i was charged twice with an invoice.

Assistant:

> thanks for explaining that. if you would like to open a dispute for that
> invoice, i can transfer you to a billing specialist who can take a closer
> look. would you like me to connect you now?

Caller:

> yes, please connect me.

Presenter:

> The first agent has collected the intent and received consent. The server
> now dials the specialist destination and keeps a mapping between the
> original call and the new call leg.

Specialist leg:

> hi, this is the cedar harbor bank billing specialist. i have the details about
> the duplicate invoice. i can open the dispute case and submit the form for
> you. once it is submitted, you will receive a confirmation email, and someone
> will follow up with you soon.

Presenter:

> The specialist leg answered and received its context. The app now sends the
> transfer command for the original call, bridging the caller to the specialist.
> The second agent then handles the billing explanation and confirmation. After
> the call, explain that a real deployment could hand the call to a human agent
> at this exact point.

## Technical walkthrough

1. `call.initiated` answers the inbound call.
2. `call.answered` speaks the billing greeting.
3. `call.speak.ended` starts bounded AI gathering for `billing_issue`.
4. `call.ai_gather.ended` plays the dispute escalation question.
5. A second bounded gather returns `yes` or `no` for transfer consent.
6. On `yes`, `dial_specialist()` creates the second call leg and stores its
   original-call mapping in `transfer_sessions`.
7. The specialist `call.answered` event plays the second voice.
8. The specialist `call.speak.ended` event calls `bridge_calls()`.

## Test checklist

- Call the configured Telnyx number.
- Say `i was charged twice with an invoice`.
- Say `yes, please connect me`.
- Answer the specialist leg on a second phone or softphone, or use call waiting
  for the one-phone demo.
- Confirm the specialist uses the second voice and explains the dispute process.
- Confirm the caller can answer the specialist's follow-up question.
- Confirm the two call legs bridge.

With one phone, the specialist destination can be the same mobile number only
as a call-waiting demonstration. A second endpoint is the realistic setup.
