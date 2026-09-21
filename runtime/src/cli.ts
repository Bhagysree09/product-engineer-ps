import { systemClock } from './clock';
import { SCENARIOS, runScenario, type ScenarioName } from './scenarios';

const arg = process.argv[2] ?? 'all';
const names: readonly ScenarioName[] =
  arg === 'all' ? SCENARIOS : (SCENARIOS as readonly string[]).includes(arg) ? [arg as ScenarioName] : [];

if (names.length === 0) {
  console.error(`Usage: npm run demo -- <${SCENARIOS.join('|')}|all>`);
  process.exit(1);
}

for (const name of names) {
  console.log(`\n=== ${name} ===`);
  process.stdout.write('stream: ');
  const { result, store } = await runScenario(name, {
    clock: systemClock,
    pace: 150,
    onChunk: (text) => process.stdout.write(text),
  });
  console.log(`\nterminal state: ${result.state}${result.reason ? ` (${result.reason})` : ''}`);
  console.log('persisted messages:', JSON.stringify(store.messages('default').map((m) => `${m.role}: ${m.content}`)));
  console.log('persisted run:', JSON.stringify(store.runs()));
  console.log('trace:');
  for (const e of result.trace) console.log(`  ${String(e.seq).padStart(2)}  ${e.type}${e.data ? ' ' + JSON.stringify(e.data) : ''}`);
}
