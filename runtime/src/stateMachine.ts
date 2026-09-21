import type { RunState, TerminalState } from './types';

const TERMINAL: readonly TerminalState[] = ['completed', 'rejected', 'cancelled', 'timed_out', 'failed'];

/**
 * Allowed transitions. Terminal states have no outgoing edges, so once a run
 * finishes every later transition attempt is invalid: that is what makes
 * "exactly one terminal state wins" true by construction.
 * `completed` is reachable only from `streaming`, `rejected` only from `policy_check`.
 */
const ALLOWED: Record<RunState, readonly RunState[]> = {
  received: ['policy_check', 'cancelled', 'timed_out', 'failed'],
  policy_check: ['streaming', 'rejected', 'cancelled', 'timed_out', 'failed'],
  streaming: ['completed', 'cancelled', 'timed_out', 'failed'],
  completed: [],
  rejected: [],
  cancelled: [],
  timed_out: [],
  failed: [],
};

export function isTerminal(state: RunState): state is TerminalState {
  return (TERMINAL as readonly string[]).includes(state);
}

export function canTransition(from: RunState, to: RunState): boolean {
  return ALLOWED[from].includes(to);
}
