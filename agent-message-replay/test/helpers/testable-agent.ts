/**
 * A ReplayAgent double-driver for tests: exposes the protected alarm hook so
 * a test can play the role of the platform's alarm scheduler, and an access
 * path to the protected state. Construction wires the real Agent base
 * (MessageLog, EventLog, StateStore, TaskScheduler) against in-memory storage.
 */
import type { AlarmInfo } from "@telnyx/edge-runtime";
import type { ReplayState } from "../../src/types.js";
import { ReplayAgent } from "../../src/replay-agent.js";
import type { ReplayEnv } from "../../src/types.js";

const FIRST_ALARM: AlarmInfo = { retryCount: 0, isRetry: false };

export class TestableReplayAgent extends ReplayAgent {
  async driveAlarm(): Promise<void> {
    await this.alarm(FIRST_ALARM);
  }
  snapshot(): Promise<ReplayState> {
    return this.getState();
  }
}
