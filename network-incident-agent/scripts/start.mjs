import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const configured = process.env.TELNYX_EDGE_BIN;
const homeBinary = join(homedir(), "bin", "telnyx-edge");
const command = configured || (existsSync(homeBinary) ? homeBinary : "telnyx-edge");
const port = process.env.TELNYX_EDGE_PORT;
const args = ["dev", ...(port ? ["--port", port] : [])];
const child = spawn(command, args, { stdio: "inherit" });

child.once("error", (error) => {
  if (error.code === "ENOENT") {
    console.error("telnyx-edge was not found. Install CLI v0.5.0+ or set TELNYX_EDGE_BIN.");
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
