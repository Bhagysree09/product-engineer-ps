import type { Clock } from './clock';
import type { ModelProvider, ProviderEvent, ProviderRequest } from './types';

/** Manually opened latch so tests control exactly when the provider proceeds. */
export class Gate {
  readonly promise: Promise<void>;
  private release!: () => void;

  constructor() {
    this.promise = new Promise((resolve) => (this.release = resolve));
  }

  open(): void {
    this.release();
  }
}

export type Step =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'fail'; message: string }
  | { type: 'malformed' }
  | { type: 'wait'; ms: number }
  | { type: 'gate'; gate: Gate }
  /** Never finishes on its own; ends only when the runtime aborts it. */
  | { type: 'hang' };

/** Deterministic provider that plays back a script. Counters let tests assert on consumption. */
export class ScriptedProvider implements ModelProvider {
  calls = 0;
  yielded = 0;
  closed = 0;

  constructor(
    private readonly steps: readonly Step[],
    private readonly clock?: Clock,
  ) {}

  async *stream({ signal }: ProviderRequest): AsyncGenerator<ProviderEvent> {
    this.calls++;
    try {
      for (const step of this.steps) {
        switch (step.type) {
          case 'text':
          case 'reasoning':
            this.yielded++;
            yield step;
            break;
          case 'malformed':
            this.yielded++;
            yield { type: 'weird' } as unknown as ProviderEvent;
            break;
          case 'fail':
            throw new Error(step.message);
          case 'wait':
            await new Promise<void>((resolve) => this.clock!.setTimeout(resolve, step.ms));
            break;
          case 'gate':
            await step.gate.promise;
            break;
          case 'hang':
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else signal.addEventListener('abort', () => resolve(), { once: true });
            });
            return;
        }
      }
    } finally {
      this.closed++;
    }
  }
}
