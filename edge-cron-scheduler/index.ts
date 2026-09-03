import { Agent, ScheduleContext, KVNamespace, DurableObjectNamespace } from '@telnyx/edge-sdk';
import { Telnyx } from '@telnyx/edge-sdk';

// --- Type definitions ---

interface JobEntry {
  id: string;
  name: string;
  cron: string; // cron expression, e.g. "*/5 * * * *"
  type: 'call' | 'sms' | 'webhook';
  target: string; // phone number for call/sms, URL for webhook
  payload?: Record<string, any>;
  lastRun?: string; // ISO timestamp
  nextRun?: string; // ISO timestamp
}

interface JobLog {
  id: string;
  name: string;
  last_run: string;
  status: 'success' | 'failure';
  result: string;
}

// --- CronAgent ---

class CronAgent extends Agent {
  // KV binding: job registry
  declare kv: KVNamespace;
  // SQL binding: execution log
  declare db: DurableObjectNamespace;
  // Telnyx binding for SMS
  declare env: {
    TELNYX: Telnyx;
    DEMO_MODE?: string;
  };

  /**
   * Register a job in the KV registry.
   */
  async registerJob(job: JobEntry): Promise<void> {
    const jobs = await this.getJobs();
    const existing = jobs.findIndex((j) => j.id === job.id);
    if (existing >= 0) {
      jobs[existing] = job;
    } else {
      jobs.push(job);
    }
    await this.kv.put('jobs', JSON.stringify(jobs));
  }

  /**
   * Retrieve all jobs from KV.
   */
  async getJobs(): Promise<JobEntry[]> {
    const raw = await this.kv.get('jobs');
    if (!raw) return [];
    try {
      return JSON.parse(raw) as JobEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Compute next run time from a cron expression (simplified: supports */N and fixed intervals).
   * Returns ISO string or null if unparseable.
   */
  parseCron(cron: string): string | null {
    // Simplified parser: supports "*/N * * * *" style
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return null;

    const minutePart = parts[0];
    const now = new Date();

    if (minutePart.startsWith('*/')) {
      const interval = parseInt(minutePart.slice(2), 10);
      if (isNaN(interval) || interval <= 0) return null;
      const next = new Date(now.getTime() + interval * 60 * 1000);
      return next.toISOString();
    }

    // Default: every minute
    const next = new Date(now.getTime() + 60 * 1000);
    return next.toISOString();
  }

  /**
   * Check if a job is due based on its nextRun timestamp.
   */
  isDue(job: JobEntry): boolean {
    if (!job.nextRun) return true;
    const nextRun = new Date(job.nextRun);
    const now = new Date();
    return now >= nextRun;
  }

  /**
   * Execute a single job based on its type.
   */
  async executeJob(job: JobEntry): Promise<{ status: 'success' | 'failure'; result: string }> {
    const demoMode = this.env.DEMO_MODE === 'true';

    try {
      switch (job.type) {
        case 'call': {
          if (demoMode) {
            this.env.TELNYX.logger.info(`[DEMO] Would place call to ${job.target} with payload:`, job.payload);
            return { status: 'success', result: 'demo_call_placed' };
          }
          // Real call via Telnyx Call Control
          const call = await this.env.TELNYX.calls.create({
            connection_id: job.payload?.connection_id || process.env.TELNYX_CONNECTION_ID!,
            from: job.payload?.from || process.env.TELNYX_PHONE_NUMBER!,
            to: job.target,
          });
          return { status: 'success', result: `call_created:${call.id}` };
        }

        case 'sms': {
          if (demoMode) {
            this.env.TELNYX.logger.info(`[DEMO] Would send SMS to ${job.target}:`, job.payload?.text || 'Hello from CronAgent');
            return { status: 'success', result: 'demo_sms_sent' };
          }
          // Real SMS via Telnyx Messaging
          const message = await this.env.TELNYX.messages.send({
            from: job.payload?.from || process.env.TELNYX_PHONE_NUMBER!,
            to: job.target,
            text: job.payload?.text || 'Hello from CronAgent',
          });
          return { status: 'success', result: `sms_sent:${message.id}` };
        }

        case 'webhook': {
          if (demoMode) {
            this.env.TELNYX.logger.info(`[DEMO] Would POST to ${job.target}:`, job.payload);
            return { status: 'success', result: 'demo_webhook_posted' };
          }
          // Real webhook via fetch
          const response = await fetch(job.target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(job.payload || {}),
          });
          const body = await response.text();
          if (!response.ok) {
            return { status: 'failure', result: `http_${response.status}:${body}` };
          }
          return { status: 'success', result: `webhook_ok:${response.status}` };
        }

        default:
          return { status: 'failure', result: `unknown_job_type:${job.type}` };
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'unknown_error';
      this.env.TELNYX.logger.error(`Job execution failed for ${job.name}:`, err);
      return { status: 'failure', result: errorMsg };
    }
  }

  /**
   * Log job execution result to SQL DB.
   */
  async logExecution(job: JobEntry, log: { status: 'success' | 'failure'; result: string }): Promise<void> {
    const stmt = this.db.prepare(
      'INSERT INTO jobs (id, name, last_run, status, result) VALUES (?, ?, ?, ?, ?)'
    );
    await stmt.bind(
      job.id,
      job.name,
      new Date().toISOString(),
      log.status,
      log.result
    ).run();
  }

  /**
   * Send SMS notification on job failure.
   */
  async notifyFailure(job: JobEntry, result: string): Promise<void> {
    const demoMode = this.env.DEMO_MODE === 'true';
    const notificationNumber = process.env.NOTIFICATION_PHONE_NUMBER || '+1555XXXXXXXX';

    if (demoMode) {
      this.env.TELNYX.logger.info(`[DEMO] Would send failure SMS to ${notificationNumber} for job ${job.name}: ${result}`);
      return;
    }

    try {
      await this.env.TELNYX.messages.send({
        from: process.env.TELNYX_PHONE_NUMBER!,
        to: notificationNumber,
        text: `⚠️ CronAgent job "${job.name}" failed: ${result}`,
      });
    } catch (err: any) {
      this.env.TELNYX.logger.error('Failed to send failure notification SMS:', err);
    }
  }

  /**
   * Main scheduling loop — runs every minute, checks KV registry, executes due jobs.
   */
  async every(ctx: ScheduleContext): Promise<void> {
    const jobs = await this.getJobs();

    for (const job of jobs) {
      if (this.isDue(job)) {
        // Queue the execution
        await this.queue('execute', job);

        // Update nextRun
        const nextRun = this.parseCron(job.cron);
        if (nextRun) {
          job.nextRun = nextRun;
          job.lastRun = new Date().toISOString();
          await this.registerJob(job);
        }
      }
    }
  }

  /**
   * Queue handler — processes queued 'execute' tasks.
   */
  async queue(type: string, job: JobEntry): Promise<void> {
    if (type === 'execute') {
      const result = await this.executeJob(job);
      await this.logExecution(job, result);

      if (result.status === 'failure') {
        await this.notifyFailure(job, result.result);
      }
    }
  }
}

// --- Default export: app handler ---

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // List jobs
    if (url.pathname === '/jobs' && request.method === 'GET') {
      const agent = new CronAgent(env, ctx);
      const jobs = await agent.getJobs();
      return new Response(JSON.stringify(jobs), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Register a job
    if (url.pathname === '/jobs' && request.method === 'POST') {
      const body = await request.json() as JobEntry;
      const agent = new CronAgent(env, ctx);
      await agent.registerJob(body);
      return new Response(JSON.stringify({ success: true, job: body }), {
        headers: { 'Content-Type': 'application/json' },
        status: 201,
      });
    }

    // Get job execution logs
    if (url.pathname === '/logs' && request.method === 'GET') {
      const agent = new CronAgent(env, ctx);
      const stmt = agent.db.prepare('SELECT * FROM jobs ORDER BY last_run DESC LIMIT 100');
      const { results } = await stmt.all();
      return new Response(JSON.stringify(results), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Webhook endpoint — verify Telnyx signature
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const signature = request.headers.get('Telnyx-Signature-Ed25519');
      const timestamp = request.headers.get('Telnyx-Timestamp');
      const body = await request.text();

      if (!signature || !timestamp) {
        return new Response('Missing signature headers', { status: 401 });
      }

      try {
        const unwrapped = env.TELNYX.webhooks.unwrap(body, signature, timestamp, process.env.TELNYX_PUBLIC_KEY!);
        const event = unwrapped.data.payload;

        // Log the webhook event
        const agent = new CronAgent(env, ctx);
        const stmt = agent.db.prepare(
          'INSERT INTO jobs (id, name, last_run, status, result) VALUES (?, ?, ?, ?, ?)'
        );
        await stmt.bind(
          `webhook_${Date.now()}`,
          event.event,
          new Date().toISOString(),
          'success',
          JSON.stringify(event)
        ).run();

        return new Response(JSON.stringify({ received: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        env.TELNYX.logger.error('Webhook signature verification failed:', err);
        return new Response('Invalid signature', { status: 401 });
      }
    }

    return new Response('Not Found', { status: 404 });
  },

  // Scheduled handler — triggers every minute
  async scheduled(controller: any, env: any, ctx: any): Promise<void> {
    const agent = new CronAgent(env, ctx);
    await agent.every({} as ScheduleContext);
  },
};

// --- Seed initial jobs on first run ---

async function seedJobs(env: any): Promise<void> {
  const agent = new CronAgent(env, {} as any);
  const jobs = await agent.getJobs();

  if (jobs.length === 0) {
    const seedJobs: JobEntry[] = [
      {
        id: 'job-1',
        name: 'hourly-sms-check',
        cron: '*/60 * * * *',
        type: 'sms',
        target: '+1555XXXXXXXX',
        payload: { text: 'Hourly check-in from CronAgent' },
        nextRun: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'job-2',
        name: 'daily-call',
        cron: '*/1440 * * * *',
        type: 'call',
        target: '+1555XXXXXXXX',
        payload: { from: process.env.TELNYX_PHONE_NUMBER },
        nextRun: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'job-3',
        name: 'webhook-ping',
        cron: '*/5 * * * *',
        type: 'webhook',
        target: 'https://httpbin.org/post',
        payload: { message: 'ping from CronAgent' },
        nextRun: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
    ];

    for (const job of seedJobs) {
      await agent.registerJob(job);
    }
  }
}

// Export for testing
export { CronAgent, seedJobs };
