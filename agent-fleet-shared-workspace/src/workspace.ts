import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface WorkspaceFile {
  path: string;
  size: number;
  modifiedAt: number;
}

/** Resolve a user-supplied artifact path without allowing traversal outside the workspace. */
export function safeWorkspacePath(root: string, artifactPath: string): string {
  const normalizedRoot = resolve(root);
  const candidate = resolve(normalizedRoot, artifactPath.replace(/^[/\\]+/, ""));
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("artifact path escapes the shared workspace");
  }
  return candidate;
}

export async function writeArtifactAtomic(
  root: string,
  artifactPath: string,
  content: string,
): Promise<WorkspaceFile> {
  const target = safeWorkspacePath(root, artifactPath);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${crypto.randomUUID()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
  const info = await stat(target);
  return {
    path: relative(resolve(root), target),
    size: info.size,
    modifiedAt: info.mtimeMs,
  };
}

export async function readArtifact(root: string, artifactPath: string): Promise<string> {
  return readFile(safeWorkspacePath(root, artifactPath), "utf8");
}

export async function listArtifacts(root: string): Promise<WorkspaceFile[]> {
  const normalizedRoot = resolve(root);
  await mkdir(normalizedRoot, { recursive: true });
  const found: WorkspaceFile[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && !entry.name.includes(".tmp-")) {
        const info = await stat(absolute);
        found.push({
          path: relative(normalizedRoot, absolute),
          size: info.size,
          modifiedAt: info.mtimeMs,
        });
      }
    }
  }

  await walk(normalizedRoot);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}
