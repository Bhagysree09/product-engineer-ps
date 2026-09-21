import { redact } from './redact';

export interface TraceEvent {
  seq: number;
  at: number;
  runId: string;
  type: string;
  data?: Record<string, unknown>;
}

/**
 * Append-only, ordered, redacted operational log for one run.
 * Once the terminal event is appended the trace is closed, so nothing can
 * appear after it. Chunk text is never recorded, only index and length.
 */
export class Trace {
  private readonly events: TraceEvent[] = [];
  private closed = false;

  constructor(
    private readonly runId: string,
    private readonly now: () => number,
  ) {}

  append(type: string, data?: Record<string, unknown>, opts: { terminal?: boolean } = {}): boolean {
    if (this.closed) return false;
    this.events.push({
      seq: this.events.length + 1,
      at: this.now(),
      runId: this.runId,
      type,
      ...(data ? { data: redact(data) as Record<string, unknown> } : {}),
    });
    if (opts.terminal) this.closed = true;
    return true;
  }

  snapshot(): readonly TraceEvent[] {
    return this.events.map((event) => ({ ...event }));
  }
}
