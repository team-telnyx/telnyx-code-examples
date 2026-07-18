# AI Subscription Cancel-Save Retention Agent - Build Guide

This sample creates a managed Telnyx AI Assistant for subscription cancellation
and save conversations. It is designed for a fast voice demo: provision the
assistant, attach a phone number, call the number, and speak naturally.

## Why AI Assistant

A low-level Call Control state machine is useful when you need exact webhook
control, but it is brittle for demos where callers go off script. A managed
Telnyx AI Assistant is the better fit for this use case because the assistant
owns turn-taking, speech recognition, interruption handling, and natural
conversation.

The Python app is still useful: it lets developers create the assistant,
inspect the workflow prompt, and wire a phone number from code.

## What It Builds

The sample provisions an assistant with:

- `telephony` enabled
- `openai/gpt-4o` by default
- Telnyx Ultra voice
- a first-turn account question
- a subscription cancel-save workflow
- exactly one save offer before accepting cancellation
- escalation behavior for human requests, fraud, chargeback, or legal language

## Workflow

```text
caller dials telnyx number
  -> telnyx ai assistant answers
  -> asks whether caller has an account or wants to create one
  -> recognizes cancellation intent in natural speech
  -> classifies the reason internally
  -> makes one eligible save offer
  -> accepts save, pause, follow-up, cancellation, or escalation
```

## Step 1: Configure

```bash
cp .env.example .env
```

Fill in `TELNYX_API_KEY`. Optionally fill in `PHONE_NUMBER` or
`PHONE_NUMBER_ID` if you want the provision call to assign a number.

## Step 2: Run The Setup App

```bash
pip install -r requirements.txt
python app.py
```

## Step 3: Review The Workflow

```bash
curl http://localhost:5000/workflow | python3 -m json.tool
```

Use this endpoint when recording. It shows the workflow the assistant will use.

## Step 4: Provision The Assistant

```bash
curl -X POST http://localhost:5000/assistant/provision \
  -H "Content-Type: application/json" \
  -d '{}'
```

To assign a phone number at the same time:

```bash
curl -X POST http://localhost:5000/assistant/provision \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+15551234567"}'
```

## Step 5: Call The Number

Say something natural, for example:

```text
i think i need to cancel. i am barely using this and it is getting expensive.
```

Then accept or decline the offer:

```text
yeah, the discount would help.
```

or:

```text
no, please cancel it.
```

## Production Notes

For production, add assistant tools for:

- customer lookup
- billing discount application
- subscription cancellation
- pause/resume billing
- support ticket creation
- human transfer

Dynamic variables such as `first_name`, `plan`, `monthly_price`, and
`renewal_date` can personalize the conversation without hard-coding account
state in the prompt.

## Resources

- [AI Assistant quickstart](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Conversation workflows](https://developers.telnyx.com/docs/inference/ai-assistants/workflows)
- [Dynamic variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
- [AI Assistants API](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)
