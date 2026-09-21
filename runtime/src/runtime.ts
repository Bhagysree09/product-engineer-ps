import { randomUUID } from 'node:crypto';
import { systemClock, type Clock, type Timer } from './clock';
import { canTransition, isTerminal } from './stateMachine';
import { Trace, type TraceEvent } from './trace';
import type {
  ConversationStore,
  Message,
  ModelProvider,
  Policy,
  ProviderEvent,
  RunState,
  TerminalState,
} from './types';

export interface RuntimeDeps {
  policy: Policy;
  provider: ModelProvider;
  store: ConversationStore;
  clock?: Clock;
  newId?: () => string;
}

export interface StartOptions {
  input: string;
  conversationId?: string;
  timeoutMs?: number;
  /** Presentation hook. Called only while the run is streaming, never after a terminal state. */
  onChunk?: (text: string, index: number) => void;
}

export interface IgnoredTransition {
  from: RunState;
  to: RunState;
  at: number;
  reason?: string;
}

export interface RunResult {
  runId: string;
  state: TerminalState;
  reason?: string;
  /** Full text; present only when the run completed. */
  outputText?: string;
  /** Text streamed before the terminal state. Ephemeral: never persisted. */
  partialText: string;
  trace: readonly TraceEvent[];
  /** Late terminal attempts. Kept off the trace so nothing follows the terminal event. Live array. */
  ignoredTransitions: readonly IgnoredTransition[];
}

export interface RunHandle {
  runId: string;
  cancel(reason?: string): void;
  result: Promise<RunResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const ABORTED = Symbol('aborted');

/** One streamed turn, from request to a single terminal state. */
class Turn {
  private state: RunState = 'received';
  private readonly trace: Trace;
  private readonly ignored: IgnoredTransition[] = [];
  private readonly chunks: string[] = [];
  private readonly controller = new AbortController();
  private readonly conversationId: string;
  private readonly clock: Clock;
  private timer?: Timer;
  private resolve!: (result: RunResult) => void;
  readonly result = new Promise<RunResult>((resolve) => (this.resolve = resolve));

  constructor(
    readonly runId: string,
    private readonly opts: StartOptions,
    private readonly deps: RuntimeDeps,
  ) {
    this.clock = deps.clock ?? systemClock;
    this.conversationId = opts.conversationId ?? 'default';
    this.trace = new Trace(runId, () => this.clock.now());
  }

  cancel(reason = 'user_cancelled'): void {
    this.transition('cancelled', reason);
  }

  async run(): Promise<void> {
    try {
      const { input, timeoutMs = DEFAULT_TIMEOUT_MS } = this.opts;
      this.trace.append('run_received', { conversationId: this.conversationId, inputLength: input.length, timeoutMs });
      this.timer = this.clock.setTimeout(() => this.transition('timed_out', 'deadline_exceeded'), timeoutMs);

      this.transition('policy_check');
      const decision = this.deps.policy.check(input);
      this.trace.append('policy_decision', decision.allowed ? { allowed: true } : { allowed: false, code: decision.code });
      if (!decision.allowed) {
        this.transition('rejected', decision.code);
        return;
      }

      this.deps.store.addUserMessage(this.message('user', input));
      if (!this.transition('streaming')) return;
      this.trace.append('provider_started');
      await this.consume();
    } catch (error) {
      this.trace.append('internal_error', { error });
      this.transition('failed', 'internal_error');
    }
  }

  private async consume(): Promise<void> {
    const { signal } = this.controller;
    const aborted = new Promise<typeof ABORTED>((resolve) =>
      signal.addEventListener('abort', () => resolve(ABORTED), { once: true }),
    );
    let iterator: AsyncIterator<ProviderEvent> | undefined;
    try {
      iterator = this.deps.provider.stream({ input: this.opts.input, signal })[Symbol.asyncIterator]();
      for (;;) {
        const pending = iterator.next();
        pending.catch(() => {}); // a provider that rejects after we stopped listening must not go unhandled
        const step = await Promise.race([pending, aborted]);
        // Cancel/timeout already decided the outcome: stop pulling from the provider.
        if (step === ABORTED || isTerminal(this.state)) return;
        if (step.done) {
          this.transition('completed');
          return;
        }
        this.handleProviderEvent(step.value);
      }
    } catch (error) {
      this.trace.append('provider_error', { error });
      this.transition('failed', 'provider_error');
    } finally {
      try {
        void Promise.resolve(iterator?.return?.()).catch(() => {});
      } catch {
        /* provider cleanup is best effort */
      }
    }
  }

  private handleProviderEvent(event: ProviderEvent): void {
    const kind = (event as { type?: unknown } | null)?.type;
    if (kind === 'text' && typeof event.text === 'string') {
      const index = this.chunks.length;
      this.chunks.push(event.text);
      this.trace.append('chunk', { index, length: event.text.length });
      try {
        this.opts.onChunk?.(event.text, index);
      } catch (error) {
        this.trace.append('consumer_error', { error });
      }
    } else if (kind === 'reasoning') {
      // Hidden reasoning is dropped: not streamed, not persisted, not traced.
      this.trace.append('provider_event_ignored', { kind: 'reasoning' });
    } else {
      this.trace.append('malformed_provider_event', { receivedType: typeof kind });
      this.transition('failed', 'malformed_provider_event');
    }
  }

  /** The only place state changes. The first terminal transition wins; later ones are recorded and refused. */
  private transition(to: RunState, reason?: string): boolean {
    const from = this.state;
    if (!canTransition(from, to)) {
      this.ignored.push({ from, to, at: this.clock.now(), ...(reason ? { reason } : {}) });
      return false;
    }
    this.state = to;
    if (isTerminal(to)) this.settle(from, to, reason);
    else this.trace.append('state_changed', { from, to });
    return true;
  }

  /** Runs synchronously inside the winning transition, so no other terminal can interleave. */
  private settle(from: RunState, to: TerminalState, reason?: string): void {
    this.timer?.cancel();
    const assistant = to === 'completed' ? this.message('assistant', this.chunks.join('')) : undefined;
    this.deps.store.finalizeRun(
      { runId: this.runId, conversationId: this.conversationId, state: to, chunkCount: this.chunks.length, ...(reason ? { reason } : {}) },
      assistant,
    );
    if (assistant) this.trace.append('records_committed', { messageCount: 2 });
    this.trace.append('state_changed', { from, to, ...(reason ? { reason } : {}) }, { terminal: true });
    if (to !== 'completed') this.controller.abort(); // reaches the provider and stops consumption
    this.resolve({
      runId: this.runId,
      state: to,
      ...(reason ? { reason } : {}),
      ...(assistant ? { outputText: assistant.content } : {}),
      partialText: this.chunks.join(''),
      trace: this.trace.snapshot(),
      ignoredTransitions: this.ignored,
    });
  }

  private message(role: Message['role'], content: string): Message {
    return {
      id: `${this.runId}:${role}`,
      conversationId: this.conversationId,
      runId: this.runId,
      role,
      content,
    };
  }
}

export class ConversationRuntime {
  private readonly newId: () => string;

  constructor(private readonly deps: RuntimeDeps) {
    this.newId = deps.newId ?? randomUUID;
  }

  start(opts: StartOptions): RunHandle {
    const turn = new Turn(this.newId(), opts, this.deps);
    void turn.run();
    return { runId: turn.runId, cancel: (reason) => turn.cancel(reason), result: turn.result };
  }
}
