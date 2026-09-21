import { EXPECTED_STATE, SCENARIOS, runScenario, type ScenarioName, type ScenarioOutcome } from './scenarios';
import { isTerminal } from './stateMachine';
import type { RunState } from './types';

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 10);

/** Returns a list of violated invariants for one run (empty = correct). */
function check(name: ScenarioName, { result, provider, store }: ScenarioOutcome, traceLenAfterSettle: number): string[] {
  const problems: string[] = [];
  const terminalEvents = result.trace.filter((e) => e.type === 'state_changed' && isTerminal(e.data?.to as RunState));
  if (terminalEvents.length !== 1) problems.push(`expected exactly 1 terminal event, found ${terminalEvents.length}`);
  if (result.state !== EXPECTED_STATE[name]) problems.push(`expected ${EXPECTED_STATE[name]}, got ${result.state}`);
  if (result.trace.at(-1) !== terminalEvents[0]) problems.push('events found after the terminal event');
  if (traceLenAfterSettle !== result.trace.length) problems.push('trace grew after the terminal event');
  if (name === 'rejection' && provider.calls !== 0) problems.push('provider was invoked for a rejected run');

  const assistant = store.messages('default').filter((m) => m.role === 'assistant');
  if (result.state === 'completed') {
    if (assistant.length !== 1) problems.push(`expected 1 assistant message, found ${assistant.length}`);
  } else if (assistant.length !== 0) {
    problems.push('non-completed run has a persisted assistant response');
  }
  if (store.runs().length !== 1) problems.push(`expected 1 run record, found ${store.runs().length}`);
  return problems;
}

async function main(): Promise<void> {
  const counts = new Map<string, number>();
  const failures: string[] = [];

  for (const name of SCENARIOS) {
    for (let i = 1; i <= ITERATIONS; i++) {
      const outcome = await runScenario(name);
      const key = `${name} -> ${outcome.result.state}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      for (const problem of check(name, outcome, outcome.result.trace.length)) failures.push(`${name} #${i}: ${problem}`);
    }
  }

  console.log(`Terminal-state counts (${ITERATIONS} iterations per scenario):`);
  for (const [key, count] of counts) console.log(`  ${key.padEnd(24)} ${count}`);

  if (failures.length > 0) {
    console.log(`\nFAILED: ${failures.length} invariant violation(s)`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nPASS: one terminal state per run, no provider call on rejection,');
  console.log('      no successful assistant record for non-completed runs, no events after terminal.');
}

void main();
