import { Agent, AgentEnv, AgentRequest, AgentResponse, AgentTask } from '@telnyx/edge-sdk';
import { TelnyxBinding } from '@telnyx/edge-sdk/telnyx';

/**
 * VoicemailAgent
 *
 * Triggered by a Call Control webhook when a call ends in voicemail
 * (event: call.status = voicemail). The agent:
 *   1. Downloads the voicemail audio recording.
 *   2. Transcribes the audio via Telnyx AI (STT).
 *   3. Summarizes the transcription via Telnyx AI (OpenAI chat completion).
 *   4. Sends the summary as an SMS to the mailbox owner.
 *   5. Archives the original audio file to Telnyx Cloud Storage.
 */
export class VoicemailAgent extends Agent {
  /**
   * onTask is the main entry point for an Agent SDK task.
   * The Telnyx Edge runtime invokes this when a webhook is routed to the agent.
   */
  async onTask(task: AgentTask): Promise<AgentResponse> {
    const telnyx = this.env.TELNYX as TelnyxBinding;
    const log = this.env.log;

    // 1. Validate the incoming webhook payload
    const payload = task.input as WebhookPayload;
    if (!payload || payload.event !== 'call.status' || payload.data?.payload?.call_status !== 'voicemail') {
      log.warn('Ignoring non-voicemail webhook', { event: payload?.event });
      return { status: 'ignored' };
    }

    const callControlId = payload.data.payload.call_control_id;
    const recordingId = payload.data.payload.recording?.id;
    const callerNumber = payload.data.payload.from;

    if (!callControlId || !recordingId) {
      log.error('Missing call_control_id or recording_id in voicemail webhook');
      return { status: 'error', error: 'Missing required voicemail metadata' };
    }

    log.info('Processing voicemail', { callControlId, recordingId, callerNumber });

    try {
      // 2. Download audio from Call Control
      const audioBuffer = await telnyx.calls.downloadRecording({
        call_control_id: callControlId,
        recording_id: recordingId,
      });

      // 3. Transcribe audio via Telnyx AI (STT)
      const transcription = await telnyx.ai.stt.transcribe({
        audio: audioBuffer,
        language: 'en-US',
      });
      const transcriptText = transcription.text;
      log.info('Transcription complete', { preview: transcriptText.substring(0, 50) });

      // 4. Summarize via Telnyx AI (OpenAI chat completion binding)
      const summaryResponse = await telnyx.ai.openai.chat.createCompletion({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant. Summarize the following voicemail transcription into a concise SMS message (max 160 chars) for the mailbox owner. Include the caller number if relevant.',
          },
          {
            role: 'user',
            content: `Caller: ${callerNumber}\nTranscription: ${transcriptText}`,
          },
        ],
        max_tokens: 60,
      });
      const summaryText = summaryResponse.choices[0]?.message?.content?.trim() || 'New voicemail received.';

      log.info('Summary generated', { summary: summaryText });

      // 5. Send SMS summary via Telnyx binding
      const isLiveMode = this.env.config?.LIVE_MODE === 'true';
      const destinationNumber = this.env.config?.MAILBOX_OWNER_NUMBER;

      if (!destinationNumber) {
        log.error('MAILBOX_OWNER_NUMBER not configured');
        return { status: 'error', error: 'Missing destination number' };
      }

      if (isLiveMode) {
        await telnyx.messages.send({
          from: this.env.config?.TELNYX_SMS_NUMBER,
          to: destinationNumber,
          text: `Voicemail from ${callerNumber}: ${summaryText}`,
        });
        log.info('SMS sent in live mode', { to: destinationNumber });
      } else {
        log.info('Demo mode: SMS not sent. Would send:', {
          to: destinationNumber,
          text: `Voicemail from ${callerNumber}: ${summaryText}`,
        });
      }

      // 6. Archive audio to Cloud Storage
      await telnyx.storage.put({
        bucket: this.env.config?.STORAGE_BUCKET || 'voicemail-archives',
        key: `voicemails/${recordingId}.mp3`,
        body: audioBuffer,
        contentType: 'audio/mpeg',
      });
      log.info('Audio archived to Cloud Storage', { recordingId });

      return { status: 'success' };
    } catch (error) {
      log.exception('Failed to process voicemail', error);
      return { status: 'error', error: 'Voicemail processing failed' };
    }
  }
}

interface WebhookPayload {
  event: string;
  data: {
    payload: {
      call_control_id: string;
      call_status: string;
      from: string;
      recording?: {
        id: string;
      };
    };
  };
}

export default VoicemailAgent;
