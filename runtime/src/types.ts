export type RunState =
  | 'received'
  | 'policy_check'
  | 'streaming'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'timed_out'
  | 'failed';

export type TerminalState = Extract<RunState, 'completed' | 'rejected' | 'cancelled' | 'timed_out' | 'failed'>;

export type PolicyDecision = { allowed: true } | { allowed: false; code: string; reason: string };

/** Deterministic, synchronous gate that runs before the provider is ever invoked. */
export interface Policy {
  check(input: string): PolicyDecision;
}

/** Everything a provider may emit. `reasoning` is accepted but dropped by the runtime. */
export type ProviderEvent = { type: 'text'; text: string } | { type: 'reasoning'; text: string };

export interface ProviderRequest {
  input: string;
  /** Aborted when the run is cancelled, times out or fails. */
  signal: AbortSignal;
}

/** Provider abstraction: the runtime knows nothing about any vendor SDK. Normal end of iteration = done. */
export interface ModelProvider {
  stream(req: ProviderRequest): AsyncIterable<ProviderEvent>;
}

export interface Message {
  id: string;
  conversationId: string;
  runId: string;
  role: 'user' | 'assistant';
  content: string;
}

/** Outcome of a run. Deliberately holds no text: partial output is never persisted. */
export interface RunRecord {
  runId: string;
  conversationId: string;
  state: TerminalState;
  reason?: string;
  chunkCount: number;
}

export interface ConversationStore {
  addUserMessage(message: Message): void;
  /** Atomic commit: run outcome plus the assistant message, which is present only for `completed`. */
  finalizeRun(run: RunRecord, assistant?: Message): void;
  messages(conversationId: string): readonly Message[];
  runs(): readonly RunRecord[];
}
