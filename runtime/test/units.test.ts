import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/clock';
import { redact } from '../src/redact';
import { canTransition, isTerminal } from '../src/stateMachine';
import { InMemoryStore } from '../src/store';
import { Trace } from '../src/trace';
import type { RunState } from '../src/types';

const TERMINALS: RunState[] = ['completed', 'rejected', 'cancelled', 'timed_out', 'failed'];
const ALL: RunState[] = ['received', 'policy_check', 'streaming', ...TERMINALS];

describe('state machine', () => {
  it('has no outgoing transitions from any terminal state', () => {
    for (const from of TERMINALS) for (const to of ALL) expect(canTransition(from, to)).toBe(false);
  });

  it('allows completion only from streaming and rejection only from policy_check', () => {
    expect(ALL.filter((s) => canTransition(s, 'completed'))).toEqual(['streaming']);
    expect(ALL.filter((s) => canTransition(s, 'rejected'))).toEqual(['policy_check']);
    expect(isTerminal('streaming')).toBe(false);
  });
});

describe('trace', () => {
  it('drops appends after the terminal event', () => {
    const trace = new Trace('r', () => 0);
    trace.append('a');
    trace.append('done', undefined, { terminal: true });
    expect(trace.append('late')).toBe(false);
    expect(trace.snapshot().map((e) => e.type)).toEqual(['a', 'done']);
  });

  it('redacts sensitive keys and secret values', () => {
    const trace = new Trace('r', () => 0);
    trace.append('x', { apiKey: 'plain', nested: { reasoning: 'hidden', note: 'token sk-abcdef123456' } });
    const text = JSON.stringify(trace.snapshot());
    expect(text).not.toContain('plain');
    expect(text).not.toContain('hidden');
    expect(text).not.toContain('sk-abcdef123456');
  });
});

describe('redact', () => {
  it('handles errors and arbitrarily deep data', () => {
    expect(redact(new Error('bad sk-abcdef123456'))).toEqual({ name: 'Error', message: 'bad [REDACTED]' });
    expect(redact({ a: { b: { c: { d: { e: { f: 1 } } } } } })).toBeTruthy();
  });
});

describe('store', () => {
  it('refuses an assistant message for a non-completed run', () => {
    const store = new InMemoryStore();
    const message = { id: 'm', conversationId: 'c', runId: 'r', role: 'assistant' as const, content: 'x' };
    expect(() => store.finalizeRun({ runId: 'r', conversationId: 'c', state: 'failed', chunkCount: 1 }, message)).toThrow();
  });
});

describe('fake clock', () => {
  it('fires due timers in order and skips cancelled ones', () => {
    const clock = new FakeClock();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('b'), 20);
    clock.setTimeout(() => fired.push('a'), 10);
    clock.setTimeout(() => fired.push('never'), 15).cancel();
    clock.advance(30);
    expect(fired).toEqual(['a', 'b']);
  });
});
