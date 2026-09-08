/**
 * Fake server-side socket implementing the `AgentServerSocket` surface, plus
 * a client-side frame driver so a test can speak the agent socket protocol
 * against a real `AgentSocketServer` with no transport.
 */
import { encodeFrame, parseKnownFrame, type AnyKnownFrame } from "@telnyx/edge-runtime/agent-socket";

export const SOCKET_OPEN = 1;
export const SOCKET_CLOSED = 3;

type Listener =
  | ((data: unknown, isBinary: boolean) => void | Promise<void>)
  | ((code: number, reason: string) => void)
  | ((err: Error) => void);

export class FakeServerSocket {
  readonly OPEN = SOCKET_OPEN;
  readonly CLOSED = SOCKET_CLOSED;
  readyState = SOCKET_OPEN;
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  private listeners = new Map<string, Listener[]>();

  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.readyState = SOCKET_CLOSED;
    this.closedWith = { code, reason };
    for (const l of this.listeners.get("close") ?? []) (l as (c: number, r: string) => void)(code ?? 1005, reason ?? "");
  }
  on(event: "message" | "close" | "error", listener: Listener): unknown {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  /** Client → server: deliver one text frame to the registered handler. */
  async clientSend(text: string): Promise<void> {
    for (const l of this.listeners.get("message") ?? []) {
      await (l as (data: unknown, isBinary: boolean) => void | Promise<void>)(text, false);
    }
  }
  /** Client → server: deliver an already-encoded frame object. */
  async clientSendFrame(frame: AnyKnownFrame): Promise<void> {
    await this.clientSend(encodeFrame(frame));
  }

  /** Server → client: decode everything sent so far. */
  serverFrames(): AnyKnownFrame[] {
    return this.sent.map((t) => parseKnownFrame(t));
  }
  /** Frames the server has sent SINCE `mark` frames were on the wire. */
  newServerFrames(since: number): AnyKnownFrame[] {
    return this.serverFrames().slice(since);
  }
  get serverFrameCount(): number {
    return this.sent.length;
  }
}
