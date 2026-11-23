import type { DemoState } from "@/domain/types";

// State seam shared by the demo driver and (on Edge) the DemoAgent actor.
// Async: on Edge, state lives in actor storage.

export interface StateStore {
  get(): Promise<DemoState>;
  update(fn: (s: DemoState) => DemoState): Promise<DemoState>;
  reset(): Promise<DemoState>;
}

/** Plain in-memory store for tests and local tooling. */
export class InMemoryStateStore implements StateStore {
  private cache: DemoState | null = null;

  constructor(initial: DemoState) {
    this.cache = initial;
  }

  async get(): Promise<DemoState> {
    if (!this.cache) throw new Error("state not initialized");
    return this.cache;
  }

  async update(fn: (s: DemoState) => DemoState): Promise<DemoState> {
    if (!this.cache) throw new Error("state not initialized");
    this.cache = fn(this.cache);
    return this.cache;
  }

  async reset(): Promise<DemoState> {
    throw new Error("InMemoryStateStore.reset requires a factory — construct a new store instead");
  }
}
