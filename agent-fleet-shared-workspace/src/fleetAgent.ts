import { Agent, type ActorNamespace, type ActorStub, type IdFromNameOptions } from "@telnyx/edge-runtime";
import { AgentSocketServer, type AgentServerSocket } from "@telnyx/edge-runtime/agent-socket";
import { join, resolve } from "node:path";
import { listArtifacts, readArtifact, writeArtifactAtomic, type WorkspaceFile } from "./workspace";

export interface FileMetadata extends WorkspaceFile {
  agentId: string;
  operation: "read" | "write";
  recordedAt: number;
}

export interface AgentRecord {
  agentId: string;
  role: string;
  status: string;
  lastArtifact: string;
  updatedAt: number;
}

export interface FleetAgentState extends Record<string, unknown> {
  agentId: string;
  role: string;
  status: "idle" | "reading" | "writing" | "done" | "error";
  lastArtifact: string;
  operations: number;
  error: string;
}

type RegistryStub = ActorStub & Pick<FleetRegistry, "recordAgent" | "recordFile" | "listAgents" | "listFiles">;

interface RegistryNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): RegistryStub;
}

interface FleetEnv {
  REGISTRY: RegistryNamespace;
  CLOUDFS_MOUNT_PATH: string;
  CLOUDFS_WORKSPACE_DIR: string;
}

function workspaceRoot(env: FleetEnv): string {
  const mountPath = resolve(env.CLOUDFS_MOUNT_PATH || "/mnt/agentfs");
  const sharedDirectory = (env.CLOUDFS_WORKSPACE_DIR || "/shared").replace(/^[/\\]+/, "");
  return join(mountPath, sharedDirectory);
}

export class FleetAgent extends Agent<FleetEnv, FleetAgentState> {
  private readonly sockets = new AgentSocketServer<FleetAgentState>(this, {
    getState: () => this.getState(),
  });

  protected override initialState(): FleetAgentState {
    return {
      agentId: "",
      role: "worker",
      status: "idle",
      lastArtifact: "",
      operations: 0,
      error: "",
    };
  }

  override async webSocket(ws: AgentServerSocket, req: Request): Promise<void> {
    await this.sockets.attach(ws, req);
  }

  protected override async onStateChanged(next: FleetAgentState): Promise<void> {
    await this.sockets.broadcastSnapshot(next);
  }

  async initialize(params: { agentId: string; role: string }): Promise<FleetAgentState> {
    const next = await this.setState({
      agentId: params.agentId,
      role: params.role,
      status: "idle",
      error: "",
    });
    await this.registry().recordAgent(this.toAgentRecord(next));
    return next;
  }

  async write(params: { path: string; content: string }): Promise<FileMetadata> {
    const state = await this.getState();
    await this.setState({ status: "writing", error: "" });
    try {
      const file = await writeArtifactAtomic(workspaceRoot(this.env), params.path, params.content);
      const metadata: FileMetadata = {
        ...file,
        agentId: state.agentId,
        operation: "write",
        recordedAt: Date.now(),
      };
      await this.registry().recordFile(metadata);
      const next = await this.setState({
        status: "done",
        lastArtifact: file.path,
        operations: state.operations + 1,
      });
      await this.registry().recordAgent(this.toAgentRecord(next));
      return metadata;
    } catch (error: unknown) {
      await this.fail(error);
      throw error;
    }
  }

  async read(params: { path: string }): Promise<{ content: string; metadata: FileMetadata }> {
    const state = await this.getState();
    await this.setState({ status: "reading", error: "" });
    try {
      const content = await readArtifact(workspaceRoot(this.env), params.path);
      const listed = await listArtifacts(workspaceRoot(this.env));
      const file = listed.find((entry) => entry.path === params.path.replace(/^[/\\]+/, ""));
      if (!file) throw new Error(`artifact not found after read: ${params.path}`);
      const metadata: FileMetadata = {
        ...file,
        agentId: state.agentId,
        operation: "read",
        recordedAt: Date.now(),
      };
      await this.registry().recordFile(metadata);
      const next = await this.setState({
        status: "done",
        lastArtifact: file.path,
        operations: state.operations + 1,
      });
      await this.registry().recordAgent(this.toAgentRecord(next));
      return { content, metadata };
    } catch (error: unknown) {
      await this.fail(error);
      throw error;
    }
  }

  async list(): Promise<WorkspaceFile[]> {
    return listArtifacts(workspaceRoot(this.env));
  }

  async getStatus(): Promise<FleetAgentState> {
    return this.getState();
  }

  private registry(): RegistryStub {
    return this.env.REGISTRY.idFromName("shared");
  }

  private toAgentRecord(state: FleetAgentState): AgentRecord {
    return {
      agentId: state.agentId,
      role: state.role,
      status: state.status,
      lastArtifact: state.lastArtifact,
      updatedAt: Date.now(),
    };
  }

  private async fail(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const next = await this.setState({ status: "error", error: message });
    await this.registry().recordAgent(this.toAgentRecord(next));
  }
}

export class FleetRegistry extends Agent<Record<string, unknown>, Record<string, unknown>> {
  protected override initialState(): Record<string, unknown> {
    return {};
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        last_artifact TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        recorded_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS files_path_idx ON files(path, recorded_at DESC);
    `);
  }

  async recordAgent(record: AgentRecord): Promise<void> {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO agents (agent_id, role, status, last_artifact, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      record.agentId,
      record.role,
      record.status,
      record.lastArtifact,
      record.updatedAt,
    );
  }

  async recordFile(record: FileMetadata): Promise<void> {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `INSERT INTO files (path, size, modified_at, agent_id, operation, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      record.path,
      record.size,
      record.modifiedAt,
      record.agentId,
      record.operation,
      record.recordedAt,
    );
  }

  async listAgents(runId?: string): Promise<AgentRecord[]> {
    this.ensureSchema();
    const rows = runId
      ? this.ctx.storage.sql.exec(
          "SELECT agent_id, role, status, last_artifact, updated_at FROM agents WHERE agent_id LIKE ? ORDER BY agent_id",
          `${runId}:%`,
        )
      : this.ctx.storage.sql.exec(
          "SELECT agent_id, role, status, last_artifact, updated_at FROM agents ORDER BY agent_id",
        );
    return rows
      .toArray()
      .map((row) => ({
        agentId: String(row.agent_id),
        role: String(row.role),
        status: String(row.status),
        lastArtifact: String(row.last_artifact),
        updatedAt: Number(row.updated_at),
      }));
  }

  async listFiles(limit = 100, runId?: string): Promise<FileMetadata[]> {
    this.ensureSchema();
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const rows = runId
      ? this.ctx.storage.sql.exec(
          `SELECT path, size, modified_at, agent_id, operation, recorded_at
           FROM files WHERE path LIKE ? ORDER BY recorded_at DESC LIMIT ?`,
          `runs/${runId}/%`,
          safeLimit,
        )
      : this.ctx.storage.sql.exec(
          `SELECT path, size, modified_at, agent_id, operation, recorded_at
           FROM files ORDER BY recorded_at DESC LIMIT ?`,
          safeLimit,
        );
    return rows
      .toArray()
      .map((row) => ({
        path: String(row.path),
        size: Number(row.size),
        modifiedAt: Number(row.modified_at),
        agentId: String(row.agent_id),
        operation: row.operation === "read" ? "read" : "write",
        recordedAt: Number(row.recorded_at),
      }));
  }
}
