/**
 * Human-readable incident numbers: `INC-000123`.
 *
 * Backed by a dedicated PostgreSQL sequence so concurrent webhook deliveries
 * can never produce a duplicate number. The formatting itself is pure and
 * unit-tested.
 */

const PREFIX = "INC";
const WIDTH = 6;

export function formatIncidentNumber(seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error(`Invalid incident sequence: ${seq}`);
  }
  return `${PREFIX}-${String(seq).padStart(WIDTH, "0")}`;
}

export function parseIncidentNumber(number: string): number | null {
  const match = new RegExp(`^${PREFIX}-0*(\\d{1,${WIDTH}})$`, "i").exec(
    number.trim(),
  );
  if (!match) return null;
  const seq = Number(match[1]);
  if (!Number.isSafeInteger(seq) || seq < 1) return null;
  return seq;
}
