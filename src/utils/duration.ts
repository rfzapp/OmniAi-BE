const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/** Parses simple durations like "15m", "7d", "30s" (as used by our own env vars) into milliseconds. */
export function parseDurationToMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration format: "${value}". Expected formats like "15m", "7d", "30s".`);
  }
  const [, amount, unit] = match as unknown as [string, string, string];
  return Number(amount) * UNIT_MS[unit]!;
}
