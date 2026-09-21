const SENSITIVE_KEY = /secret|token|api[-_]?key|password|authorization|credential|reasoning|thought/i;
const SECRET_VALUE: readonly RegExp[] = [/sk-[A-Za-z0-9_-]{6,}/g, /Bearer\s+[A-Za-z0-9._~+/=-]+/gi];
const MAX_DEPTH = 5;

export const REDACTED = '[REDACTED]';

function redactString(value: string): string {
  return SECRET_VALUE.reduce((text, pattern) => text.replace(pattern, REDACTED), value);
}

/**
 * Trace data passes through here before it is stored. Two layers:
 * sensitive key names (including reasoning/thought) are dropped wholesale, and
 * secret-looking values are masked inside any remaining string.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1)]),
  );
}
