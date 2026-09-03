import { Agent, env, logger } from '@telnyx/edge-sdk'

// ---------------------------------------------------------------------------
// AI Call Summarizer — Telnyx Edge Agent
//
// Flow:
//   1. Call hangup webhook arrives at /webhook
//   2. SummarizerAgent.onTask() receives the event
//   3. Conversation history is sent to OpenAI via this.messages.toOpenAI()
//   4. LLM summary generated via this.env.TELNYX.ai.openai.chat.createCompletion()
//   5. SMS summary sent to caller via this.env.TELNYX.messages.send()
//   6. Summary logged to SQL: summaries(call_id, caller, summary, duration, timestamp)
// ---------------------------------------------------------------------------

interface CallState {
  callId: string
  caller: string
  duration: number
  history: Array<{ role: string; content: string }>
}

class SummarizerAgent extends Agent {
  // In-memory call state store (per-agent; in production use KV or SQL)
  private calls: Map<string, CallState> = new Map()

  async onTask(event: any): Promise<any> {
    const { event_type, data } = event
    const payload = data?.payload ?? data

    logger.info('Received event', { event_type, call_id: payload?.call_id })

    switch (event_type) {
      case 'call.start':
        this.calls.set(payload.call_id, {
          callId: payload.call_id,
          caller: payload.from,
          duration: 0,
          history: [],
        })
        break

      case 'call.speech':
        const state = this.calls.get(payload.call_id)
        if (state) {
          state.history.push({
            role: payload.speaker === 'caller' ? 'user' : 'assistant',
            content: payload.transcript,
          })
        }
        break

      case 'call.hangup':
        return await this.handleHangup(payload)

      default:
        logger.warn('Unhandled event type', { event_type })
    }

    return { received: true }
  }

  private async handleHangup(payload: any): Promise<any> {
    const callId = payload.call_id
    const state = this.calls.get(callId)

    if (!state) {
      logger.warn('No call state found for hangup', { callId })
      return { error: 'no call state' }
    }

    const duration = payload.duration ?? state.duration
    state.duration = duration

    // 1. Conversation history via this.messages.toOpenAI()
    const openaiMessages = this.messages.toOpenAI(state.history)

    // 2. LLM summary via this.env.TELNYX.ai.openai.chat.createCompletion()
    const summary = await this.generateSummary(openaiMessages)

    // 3. SMS summary to caller via this.env.TELNYX.messages.send()
    await this.sendSummarySMS(state.caller, summary)

    // 4. SQL summary log for analytics
    await this.logToSQL(callId, state.caller, summary, duration)

    // Clean up
    this.calls.delete(callId)

    return { summarized: true, summary }
  }

  private async generateSummary(messages: Array<{ role: string; content: string }>): Promise<string> {
    try {
      const response = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that summarizes phone call conversations concisely.' },
          ...messages,
        ],
        max_tokens: 200,
        temperature: 0.3,
      })

      const summary = response.choices?.[0]?.message?.content?.trim() ?? 'No summary generated.'
      logger.info('Summary generated', { length: summary.length })
      return summary
    } catch (err) {
      logger.exception('Failed to generate summary', err)
      return 'Summary generation failed.'
    }
  }

  private async sendSummarySMS(caller: string, summary: string): Promise<void> {
    if (env.SAFE_DEMO_MODE === 'true') {
      logger.info('[DEMO MODE] Would send SMS to caller', {
        to: caller,
        message: `[Demo] Call Summary: ${summary.substring(0, 100)}...`,
      })
      return
    }

    try {
      await this.env.TELNYX.messages.send({
        from: env.TELNYX_SMS_FROM,
        to: caller,
        text: `Call Summary:\n${summary}`,
      })
      logger.info('SMS summary sent', { to: caller })
    } catch (err) {
      logger.exception('Failed to send SMS', err)
    }
  }

  private async logToSQL(callId: string, caller: string, summary: string, duration: number): Promise<void> {
    const timestamp = new Date().toISOString()

    if (env.SAFE_DEMO_MODE === 'true') {
      logger.info('[DEMO MODE] Would log to SQL', {
        call_id: callId,
        caller,
        summary: summary.substring(0, 100),
        duration,
        timestamp,
      })
      return
    }

    try {
      // SQL DB: summaries(call_id, caller, summary, duration, timestamp)
      await this.env.TELNYX.sql.query(
        'INSERT INTO summaries (call_id, caller, summary, duration, timestamp) VALUES (?, ?, ?, ?, ?)',
        [callId, caller, summary, duration, timestamp]
      )
      logger.info('Summary logged to SQL', { callId })
    } catch (err) {
      logger.exception('Failed to log to SQL', err)
    }
  }
}

// ---------------------------------------------------------------------------
// Webhook handler — verifies Telnyx Ed25519 signature
// ---------------------------------------------------------------------------

async function handleWebhook(request: Request): Promise<Response> {
  const body = await request.text()
  const signature = request.headers.get('Telnyx-Signature') ?? ''
  const nonce = request.headers.get('Telnyx-Signature-Nonce') ?? ''
  const timestamp = request.headers.get('Telnyx-Signature-Timestamp') ?? ''

  try {
    const event = await env.TELNYX.webhooks.unwrap(
      body,
      signature,
      nonce,
      timestamp,
      env.TELNYX_WEBHOOK_SECRET
    )

    const agent = new SummarizerAgent()
    await agent.onTask(event)

    return new Response(JSON.stringify({ received: true }), { status: 200 })
  } catch (err) {
    logger.exception('Webhook verification failed', err)
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 })
  }
}

// ---------------------------------------------------------------------------
// Default export — Edge app handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request)
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
  },
}

// ---------------------------------------------------------------------------
// Environment types
// ---------------------------------------------------------------------------

declare global {
  interface Env {
    TELNYX: {
      ai: {
        openai: {
          chat: {
            createCompletion: (params: any) => Promise<any>
          }
        }
      }
      messages: {
        send: (params: any) => Promise<any>
      }
      sql: {
        query: (sql: string, params: any[]) => Promise<any>
      }
      webhooks: {
        unwrap: (body: string, signature: string, nonce: string, timestamp: string, secret: string) => Promise<any>
      }
    }
    TELNYX_API_KEY: string
    TELNYX_SMS_FROM: string
    TELNYX_WEBHOOK_SECRET: string
    SAFE_DEMO_MODE: string
  }
}

declare const env: Env
declare const logger: {
  info: (msg: string, data?: any) => void
  warn: (msg: string, data?: any) => void
  exception: (msg: string, err: any) => void
}

declare module '@telnyx/edge-sdk' {
  interface Agent {
    messages: {
      toOpenAI: (history: Array<{ role: string; content: string }>) => Array<{ role: string; content: string }>
    }
  }
}
