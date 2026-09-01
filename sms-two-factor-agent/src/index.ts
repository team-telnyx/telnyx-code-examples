import { Agent, StateStore, KV, Binding, schedule, HttpRequest, HttpResponse, Env } from '@telnyx/edge-sdk';

/**
 * TwoFactorAgent — manages the full lifecycle of an SMS two-factor auth code:
 * generate, send, verify, and expire.
 *
 * Primitives used (per DEV-830):
 *  - Agent SDK            -> class extends Agent, this.schedule() for expiry
 *  - [telnyx] binding     -> this.env.TELNYX.messages.send()
 *  - KV                   -> ctx.kv.put('2fa:${phone}', code, { ttl: 300 })
 *  - StateStore           -> auth attempt tracking + rate limiting
 */
export class TwoFactorAgent extends Agent {
  // Rate-limit thresholds (per phone number)
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly CODE_TTL_SECONDS = 300; // 5 minutes

  /**
   * POST /verify
   * Body: { phone: string }
   *
   * Flow:
   *  1. Validate + rate-limit via StateStore
   *  2. Generate 6-digit code
   *  3. Store in KV with 5-minute TTL
   *  4. Send SMS via [telnyx] binding (zero-credential)
   *  5. Schedule cleanup as a safety net
   */
  async onRequest(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/verify') {
      return this.handleSendCode(req);
    }
    if (req.method === 'POST' && url.pathname === '/check') {
      return this.handleVerifyCode(req);
    }
    return new HttpResponse('Not Found', { status: 404 });
  }

  private async handleSendCode(req: HttpRequest): Promise<HttpResponse> {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return HttpResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const phone: string | undefined = body?.phone;
    if (!phone || !/^\+\d{10,15}$/.test(phone)) {
      return HttpResponse.json(
        { error: 'A valid E.164 phone number is required (e.g. +15551234567)' },
        { status: 400 },
      );
    }

    // --- StateStore: rate-limit auth attempts per phone ---
    const state = this.state as StateStore;
    const attemptKey = `attempts:${phone}`;
    const current = await state.get(attemptKey);
    const attempts = current ? parseInt(current, 10) : 0;
    if (attempts >= TwoFactorAgent.MAX_ATTEMPTS) {
      return HttpResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 },
      );
    }
    await state.put(attemptKey, String(attempts + 1), {
      ttl: TwoFactorAgent.CODE_TTL_SECONDS,
    });

    // --- Generate code ---
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // --- KV: store code with 5-minute TTL ---
    const kv = this.env.KV as KV;
    await kv.put(`2fa:${phone}`, code, {
      ttl: TwoFactorAgent.CODE_TTL_SECONDS,
    });

    // --- [telnyx] binding: send SMS (zero-credential) ---
    const telnyx = (this.env as any).TELNYX;
    const fromNumber = (this.env as any).TELNYX_FROM_NUMBER || '+1555XXXXXXXX';
    const messageText = `Your verification code is ${code}. It expires in 5 minutes.`;

    if ((this.env as any).DEMO_MODE !== 'false') {
      // Safe demo mode: log instead of sending real SMS
      console.log(`[demo] SMS to ${phone}: ${messageText}`);
    } else {
      // Live mode: real Telnyx SMS via binding
      await telnyx.messages.send({
        from: fromNumber,
        to: phone,
        text: messageText,
      });
    }

    // --- Agent SDK: schedule expiry as a safety net ---
    // KV TTL handles primary expiry; this is a backup cleanup.
    this.schedule('expireCode', TwoFactorAgent.CODE_TTL_SECONDS * 1000, { phone });

    return HttpResponse.json({
      ok: true,
      message: 'Verification code sent. Check your phone.',
      demo_mode: (this.env as any).DEMO_MODE !== 'false',
    });
  }

  private async handleVerifyCode(req: HttpRequest): Promise<HttpResponse> {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return HttpResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const phone: string | undefined = body?.phone;
    const code: string | undefined = body?.code;
    if (!phone || !code) {
      return HttpResponse.json(
        { error: 'phone and code are required' },
        { status: 400 },
      );
    }

    // --- KV: verify code against store ---
    const kv = this.env.KV as KV;
    const storedCode = await kv.get(`2fa:${phone}`);

    if (!storedCode) {
      return HttpResponse.json(
        { error: 'No active verification code. Request a new one.' },
        { status: 404 },
      );
    }

    if (storedCode !== code) {
      // Track failed attempts via StateStore
      const state = this.state as StateStore;
      const failKey = `fails:${phone}`;
      const failsStr = await state.get(failKey);
      const fails = failsStr ? parseInt(failsStr, 10) : 0;
      await state.put(failKey, String(fails + 1), {
        ttl: TwoFactorAgent.CODE_TTL_SECONDS,
      });

      return HttpResponse.json({ verified: false, error: 'Invalid code' }, { status: 401 });
    }

    // Success: clean up KV + StateStore
    await kv.delete(`2fa:${phone}`);
    await (this.state as StateStore).delete(`attempts:${phone}`);
    await (this.state as StateStore).delete(`fails:${phone}`);

    return HttpResponse.json({ verified: true, message: 'Phone number verified.' });
  }

  /**
   * Scheduled handler — invoked by this.schedule() to clean up expired codes.
   */
  async onScheduled(name: string, data: any): Promise<void> {
    if (name === 'expireCode' && data?.phone) {
      const kv = this.env.KV as KV;
      await kv.delete(`2fa:${data.phone}`);
      console.log(`[scheduled] Cleaned up 2FA code for ${data.phone}`);
    }
  }
}

/**
 * Default export — the Edge runtime instantiates this on cold start.
 */
export default TwoFactorAgent;
