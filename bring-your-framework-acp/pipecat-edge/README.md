# Pipecat on Telnyx Edge

Deploy your [Pipecat](https://github.com/pipecat-ai/pipecat) voice agent to a
[Telnyx Edge](https://github.com/team-telnyx/edge-compute) function and give it
a phone number. There are no servers, containers or media infrastructure to
run: `telnyx-edge ship` uploads your code, and Telnyx builds it, hosts it and
connects your callers to it.

Everything a phone agent needs is on one platform, with one API key: the phone
number, the call audio, Deepgram Flux speech-to-text, LLM inference and
text-to-speech.

```python
pipeline = Pipeline([
    transport.input(),   # Telnyx call audio
    stt,                 # TelnyxSTTService (Flux)
    user_aggregator,
    llm,                 # OpenAILLMService -> GLM-5.3-Flash on Telnyx
    tts,                 # TelnyxTTSService
    transport.output(),
    assistant_aggregator,
])
```

It's the Pipecat you already know, with no framework changes and no new SDK.
The agent lives in `function/bot.py`.

## What you need

- A [Telnyx account](https://telnyx.com/sign-up) and an
  [API key](https://portal.telnyx.com/#/app/api-keys).
- The [`telnyx-edge` CLI](https://github.com/team-telnyx/edge-compute#-installation).
- `curl` and [`jq`](https://jqlang.org).

## 1. Deploy the agent

Put your API key in your shell and log the CLI in with it:

```bash
export TELNYX_API_KEY=<your-api-key>
telnyx-edge auth api-key set "$TELNYX_API_KEY"
```

Clone this repo and create your function from it:

```bash
git clone https://github.com/team-telnyx/pipecat-edge
telnyx-edge new-func -l python -n my-pipecat-agent --from-dir pipecat-edge
```

`my-pipecat-agent` is your function's name. Pick any name you like; it
becomes part of your function's URL. `new-func` creates a folder with that
name, holding a copy of this repo. That folder is your function: edit and ship
from there, not from the clone.

Give the function your API key and ship it:

```bash
cd my-pipecat-agent
telnyx-edge secrets add TELNYX_API_KEY "$TELNYX_API_KEY"
telnyx-edge ship
```

The first build takes about 5 to 10 minutes. When it finishes, `ship` prints
your function's URL, such as `https://my-pipecat-agent-1a2b3c4d-5.telnyxcompute.com`.

## 2. Give it a phone number

Create a TeXML application that sends incoming calls to your function. Use
the URL `ship` printed:

```bash
FUNC_URL=https://my-pipecat-agent-1a2b3c4d-5.telnyxcompute.com  # replace with the URL ship printed

APP_ID=$(curl -s https://api.telnyx.com/v2/texml_applications \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"friendly_name\": \"my-pipecat-agent\", \"voice_url\": \"$FUNC_URL/texml\", \"voice_method\": \"post\"}" \
  | jq -r .data.id)
```

Buy a local US number and connect it to that application:

```bash
NUMBER=$(curl -sg "https://api.telnyx.com/v2/available_phone_numbers?filter[country_code]=US&filter[phone_number_type]=local&filter[features][]=voice&filter[limit]=1" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  | jq -r '.data[0].phone_number')

curl -s https://api.telnyx.com/v2/number_orders \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"phone_numbers\": [{\"phone_number\": \"$NUMBER\"}], \"connection_id\": \"$APP_ID\"}"

echo "Your agent's number: $NUMBER"
```

Already have a number? Connect it instead of buying one:

```bash
# Replace 15551234567 with your number. Keep the %2B; it's the "+".
NUMBER_ID=$(curl -s "https://api.telnyx.com/v2/phone_numbers?filter%5Bphone_number%5D=%2B15551234567" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  | jq -r '.data[0].id')

curl -s -X PATCH "https://api.telnyx.com/v2/phone_numbers/$NUMBER_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"connection_id\": \"$APP_ID\"}"
```

## 3. Call it

Call your number. The agent answers with "Hi! How can I help?" Talk to it as
you would to a person. You can interrupt it mid-sentence.

If the call connects but nobody speaks, watch your function's logs while you
call:

```bash
telnyx-edge logs my-pipecat-agent --tail
```

## Make it yours

Edit `function/bot.py` as you would any Pipecat bot, then run
`telnyx-edge ship` again. Prefer another provider? Swap in its Pipecat service
and add its key with `telnyx-edge secrets add`.
