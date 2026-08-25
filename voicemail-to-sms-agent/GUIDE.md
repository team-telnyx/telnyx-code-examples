# Guide: Voicemail-to-SMS Agent

This guide walks through the `voicemail-to-sms-agent` sample, a Flask application that automatically transcribes incoming voicemails, summarizes them using AI, and texts the summary to your phone. It demonstrates how to combine Telnyx Call Control, AI Inference, Messaging, and Cloud Storage into a single, cohesive agent workflow.

## Prerequisites

Before you begin, ensure you have the following:

* **Python 3.8+** installed on your machine.
* A **Telnyx account**. If you don't have one, [sign up here](https://telnyx.com/).
* A **Telnyx Phone Number** capable of sending and receiving SMS.
* A **Telnyx Call Control Application** configured to receive calls and send webhooks.
* A **Telnyx Cloud Storage Bucket** created to archive voicemail audio files.
* Your Telnyx API Key and Public Key (found in your Telnyx Portal).

## Environment Setup

This project uses `python-dotenv` to load credentials from a `.env` file. 

1. Create a `.env` file in the root of the project (you can copy from `.env.example`).
2. Fill in the following environment variables:

```dotenv
# .env
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
TELNYX_APP_NAME=voicemail-to-sms-agent
TELNYX_STORAGE_BUCKET=your_storage_bucket_name
TELNYX_FROM_NUMBER=+18005550100
TELNYX_TO_NUMBER=+18005550199
PORT=5000
```

* `TELNYX_API_KEY`: Your Telnyx API key used for SDK authentication.
* `TELNYX_PUBLIC_KEY`: Your Telnyx public key used to verify incoming webhook signatures.
* `TELNYX_STORAGE_BUCKET`: The name of the Telnyx Cloud Storage bucket where voicemails will be archived.
* `TELNYX_FROM_NUMBER`: The Telnyx phone number sending the SMS summaries (must be owned by your Telnyx account).
* `TELNYX_TO_NUMBER`: The phone number that will receive the SMS summaries.

## Installation

1. Create and activate a virtual environment:

```bash
python -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`
```

2. Install the required dependencies:

```bash
pip install -r requirements.txt
```

3. Run the Flask application:

```bash
python app.py
```

The server will start on `http://0.0.0.0:5000` (or the port specified in your `.env`).

## How It Works

The application exposes a single webhook endpoint (`/webhooks/voicemail`) that Telnyx calls when a voicemail is left. The processing is handled by a `VoicemailAgent` class that orchestrates the entire workflow.

### 1. Webhook Verification

Security is paramount when exposing webhooks to the public internet. Telnyx signs all webhook payloads with an Ed25519 signature.

In the `verify_webhook` function and the `/webhooks/voicemail` route, the application uses the Telnyx SDK to verify the signature against your `TELNYX_PUBLIC_KEY`. If the signature is invalid or missing, the request is aborted with a `401 Unauthorized` response. This ensures only Telnyx can trigger the voicemail processing agent.

### 2. Voicemail Event Detection

Once the webhook is verified, the application inspects the event payload. Telnyx Call Control sends various `call.status` events. The agent specifically looks for the `voicemail` status. If the event is anything else (e.g., `answered`, `hangup`), it is safely ignored.

### 3. The VoicemailAgent Class

The `VoicemailAgent` class is a minimal abstraction mirroring the shape of the Telnyx Agent SDK. It is initialized with an `env` dictionary containing all the necessary configuration and credentials.

When a voicemail event is detected, the `onTask` method is called with the webhook payload. This method orchestrates the following pipeline:

#### A. Audio Download
The agent extracts the `recording_urls` from the voicemail payload. It uses the `requests` library to download the raw audio bytes of the voicemail recording from Telnyx.

#### B. Speech-to-Text (STT)
The downloaded audio bytes are sent to the Telnyx AI Inference binding. Using the OpenAI-compatible Whisper transcription endpoint (`telnyx.ai.openai.audio.create_transcription`), the audio is converted into text. 

#### C. LLM Summarization
The transcript is then passed to the Telnyx AI Inference binding for chat completions (`telnyx.ai.openai.chat.createCompletion`). The agent uses a system prompt to instruct the model (`gpt-4o-mini`) to summarize the voicemail in 1-2 concise sentences, keeping it under 320 characters to fit within an SMS. If the transcript is empty or summarization fails, it gracefully falls back to a generic notification message.

#### D. SMS Delivery
The generated summary is sent to the mailbox owner via the Telnyx Messaging API (`telnyx.Message.create`). The SMS is sent from the `TELNYX_FROM_NUMBER` to the `TELNYX_TO_NUMBER` defined in your environment variables.

#### E. Cloud Storage Archiving
Finally, the original voicemail audio is archived for future reference. The agent uses the Telnyx Cloud Storage binding (`telnyx.storage.object.create`) to upload the audio bytes to the bucket specified in `TELNYX_STORAGE_BUCKET`. The object key includes a timestamp and the `call_control_id` for easy retrieval, and relevant metadata (like the call session ID) is attached to the object.

## Telnyx Primitives Used

This example showcases several core Telnyx primitives:

* **Call Control**: Handles the inbound call, detects the voicemail event, and provides the recording URLs for download.
* **AI Inference (Binding)**: Provides OpenAI-compatible endpoints for Speech-to-Text (`whisper-1`) and Chat Completions (`gpt-4o-mini`) to transcribe and summarize the audio.
* **Messaging**: Sends the final SMS summary to the user via the Telnyx SMS API.
* **Cloud Storage**: Archives the original voicemail audio files for compliance or future retrieval.

## Next Steps

Now that you have a working voicemail agent, here are some ideas for how to extend it:

* **Interactive Callbacks**: Add a button or reply keyword to the SMS that triggers a Call Control command to dial the caller back automatically.
* **Multi-Language Support**: Configure the STT and LLM models to detect and summarize voicemails in different languages.
* **Database Integration**: Store the transcripts, summaries, and call metadata in a database (like Telnyx SQL) for long-term tracking and analytics.

For more information on the Telnyx APIs used in this guide, check out our official developer documentation:
* [Call Control API](https://developers.telnyx.com/docs/voice/call-control)
* [AI Inference API](https://developers.telnyx.com/docs/ai-ml)
* [Messaging API](https://developers.telnyx.com/docs/messaging)
* [Cloud Storage API](https://developers.telnyx.com/docs/storage)
