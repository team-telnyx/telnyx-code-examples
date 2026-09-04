import { z } from "zod";

export const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const Text = z.string().min(1).max(4000);

export interface Secrets {
  get(name: string): Promise<string>;
}
