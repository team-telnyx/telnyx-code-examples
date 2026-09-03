import { describe, it, expect } from 'vitest';
import { CronAgent, seedJobs } from '../src/index';

describe('CronAgent smoke test', () => {
  it('should import and instantiate CronAgent without error', () => {
    const mockEnv = {
      TELNYX: {
        logger: { info: () => {}, error: () => {} },
        messages: { send: async () => ({ id: 'test' }) },
        calls: { create: async () => ({ id: 'test' }) },
        webhooks: { unwrap: (body: string, sig: string, ts: string, key: string) => ({ data: { payload: {} } }) },
      },
      DEMO_MODE: 'true',
    };
    const mockCtx = {
      kv: {
        get: async () => null,
        put: async () => {},
      },
      db: {
        prepare: () => ({
          bind: () => ({
            run: async () => {},
            all: async () => ({ results: [] }),
          }),
        }),
      },
    };

    const agent = new CronAgent(mockEnv, mockCtx);
    expect(agent).toBeDefined();
    expect(typeof agent.every).toBe('function');
    expect(typeof agent.registerJob).toBe('function');
    expect(typeof agent.getJobs).toBe('function');
    expect(typeof agent.executeJob).toBe('function');
    expect(typeof agent.logExecution).toBe('function');
    expect(typeof agent.notifyFailure).toBe('function');
    expect(typeof agent.queue).toBe('function');
  });

  it('should parse cron expressions correctly', () => {
    const mockEnv = { TELNYX: { logger: { info: () => {}, error: () => {} } }, DEMO_MODE: 'true' };
    const mockCtx = {
      kv: { get: async () => null, put: async () => {} },
      db: { prepare: () => ({ bind: () => ({ run: async () => {}, all: async () => ({ results: [] }) }) }) },
    };
    const agent = new CronAgent(mockEnv, mockCtx);

    const nextRun = agent.parseCron('*/5 * * * *');
    expect(nextRun).not.toBeNull();
    expect(new Date(nextRun!).getTime()).toBeGreaterThan(Date.now());
  });

  it('should determine job due status correctly', () => {
    const mockEnv = { TELNYX: { logger: { info: () => {}, error: () => {} } }, DEMO_MODE: 'true' };
    const mockCtx = {
      kv: { get: async () => null, put: async () => {} },
      db: { prepare: () => ({ bind: () => ({ run: async () => {}, all: async () => ({ results: [] }) }) }) },
    };
    const agent = new CronAgent(mockEnv, mockCtx);

    const dueJob = { id: '1', name: 'test', cron: '*/1 * * * *', type: 'sms' as const, target: '+1555XXXXXXXX' };
    expect(agent.isDue(dueJob)).toBe(true);

    const futureJob = {
      id: '2',
      name: 'test',
      cron: '*/1 * * * *',
      type: 'sms' as const,
      target: '+1555XXXXXXXX',
      nextRun: new Date(Date.now() + 3600000).toISOString(),
    };
    expect(agent.isDue(futureJob)).toBe(false);
  });

  it('should execute SMS job in demo mode', async () => {
    const mockEnv = {
      TELNYX: {
        logger: { info: () => {}, error: () => {} },
        messages: { send: async () => ({ id: 'msg_test' }) },
        calls: { create: async () => ({ id: 'call_test' }) },
        webhooks: { unwrap: () => ({ data: { payload: {} } }) },
      },
      DEMO_MODE: 'true',
    };
    const mockCtx = {
      kv: { get: async () => null, put: async () => {} },
      db: { prepare: () => ({ bind: () => ({ run: async () => {}, all: async () => ({ results: [] }) }) }) },
    };
    const agent = new CronAgent(mockEnv, mockCtx);

    const job = {
      id: 'test-1',
      name: 'demo-sms',
      cron: '*/1 * * * *',
      type: 'sms' as const,
      target: '+1555XXXXXXXX',
      payload: { text: 'Test message' },
    };

    const result = await agent.executeJob(job);
    expect(result.status).toBe('success');
    expect(result.result).toBe('demo_sms_sent');
  });

  it('should execute webhook job in demo mode', async () => {
    const mockEnv = {
      TELNYX: {
        logger: { info: () => {}, error: () => {} },
      },
      DEMO_MODE: 'true',
    };
    const mockCtx = {
      kv: { get: async () => null, put: async () => {} },
      db: { prepare: () => ({ bind: () => ({ run: async () => {}, all: async () => ({ results: [] }) }) }) },
    };
    const agent = new CronAgent(mockEnv, mockCtx);

    const job = {
      id: 'test-2',
      name: 'demo-webhook',
      cron: '*/5 * * * *',
      type: 'webhook' as const,
      target: 'https://httpbin.org/post',
      payload: { message: 'ping' },
    };

    const result = await agent.executeJob(job);
    expect(result.status).toBe('success');
    expect(result.result).toBe('demo_webhook_posted');
  });

  it('should execute call job in demo mode', async () => {
    const mockEnv = {
      TELNYX: {
        logger: { info: () => {}, error: () => {} },
        calls: { create: async () => ({ id: 'call_test' }) },
      },
      DEMO_MODE: 'true',
    };
    const mockCtx = {
      kv: { get: async () => null, put: async () => {} },
      db: { prepare: () => ({ bind: () => ({ run: async () => {}, all: async () => ({ results: [] }) }) }) },
    };
    const agent = new CronAgent(mockEnv, mockCtx);

    const job = {
      id: 'test-3',
      name: 'demo-call',
      cron: '*/60 * * * *',
      type: 'call' as const,
      target: '+1555XXXXXXXX',
      payload: { from: '+1555XXXXXXXX' },
    };

    const result = await agent.executeJob(job);
    expect(result.status).toBe('success');
    expect(result.result).toBe('demo_call_placed');
  });

  it('should handle unknown job type gracefully', async () => {
    const mockEnv = {
      TELNYX: {
        logger: { info: () => {}, error: () => {} },
      },
      DEMO_MODE: 'true',
    };
    const mockCtx = {
      kv: { get: async () => null, put: async () => {} },
      db: { prepare: () => ({ bind: () => ({ run: async () => {}, all: async () => ({ results: [] }) }) }) },
    };
    const agent = new CronAgent(mockEnv, mockCtx);

    const job = {
      id: 'test-4',
      name: 'unknown-job',
      cron: '*/1 * * * *',
      type: 'unknown' as any,
      target: '+1555XXXXXXXX',
    };

    const result = await agent.executeJob(job);
    expect(result.status).toBe('failure');
    expect(result.result).toContain('unknown_job_type');
  });

  it('should seed jobs when registry is empty', async () => {
    const mockEnv = {
      TELNYX: {
        logger: { info: () => {}, error: () => {} },
      },
      DEMO_MODE: 'true',
      TELNYX_PHONE_NUMBER: '+1555XXXXXXXX',
    };
    const mockCtx = {
      kv: {
        get: async () => null,
        put: async () => {},
      },
      db: {
        prepare: () => ({
          bind: () => ({
            run: async () => {},
            all: async () => ({ results: [] }),
          }),
        }),
      },
    };

    await seedJobs(mockEnv);
    expect(mockCtx.kv.put).toHaveBeenCalled();
  });
});
EOF
