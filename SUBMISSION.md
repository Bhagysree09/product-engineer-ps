# Product Engineering Challenge Submission

## Candidate

- **Name:** TODO
- **Email:** akankshyakar106@gmail.com
- **GitHub:** TODO
- **Selected problem:** Problem 5: Reliable AI Conversation Runtime
- **Demo video:** TODO (paste link, check it opens in a private window)

## Run the project

Prerequisite: Node 20+ (developed on Node 24). No API keys or network access are needed.

```text
cd runtime
npm install
npm run demo -- all        # every scenario, streamed live, with persisted records and trace
npm run demo -- failure    # or: success | rejection | cancellation | timeout
```

`demo` uses the real clock and a scripted fake provider. Each scenario shows the streamed text, the terminal state, what was persisted, and the ordered trace.
- **Success:** `success`
- **Failure or recovery:** `cancellation`, `timeout` and `failure` (partial output, no completed response)

## Run the tests

```text
cd runtime
npm test          # 16 deterministic tests, no sleeping, no network
npm run verify    # typecheck + tests + benchmark
```

## Acceptance scenarios and verification

AC1 to AC7 are implemented and covered by `test/runtime.test.ts` (AC1 success, AC2 rejection, AC3 cancellation, AC4 timeout, AC5 provider failure, AC6 terminal race, AC7 safe trace). I did not interpret any requirement differently.

Benchmark (10 iterations of each of the 5 scenarios, fake clock, no live model):

```text
cd runtime
npm run bench                  # BENCH_ITERATIONS=50 npm run bench for more
```

Observed on my machine (10 iterations each):

```text
success -> completed 10 | rejection -> rejected 10 | cancellation -> cancelled 10
timeout -> timed_out 10 | failure -> failed 10
PASS
```

For every run it checks: exactly one terminal event; the last trace event is that terminal event; the trace does not grow after settling; rejected runs never call the provider; non-completed runs have no persisted assistant message; completed runs have exactly one. Any violation prints the run and exits non-zero.

## Architecture and data flow

```text
start(input) -> Turn
  received -> policy_check --(rejected)--> END
                 |
                 v (allowed: user message saved)
             streaming <- provider.stream(AsyncIterable, AbortSignal)
                 |
   completed | cancelled | timed_out | failed   (exactly one wins)
                 |
        store.finalizeRun(run [, assistant])  ->  terminal trace event  ->  result resolves
```

| File | Responsibility |
| --- | --- |
| `src/types.ts` | States and the `Policy`, `ModelProvider` and `ConversationStore` interfaces |
| `src/stateMachine.ts` | Transition table. Terminal states have no outgoing edges |
| `src/runtime.ts` | Orchestration. `Turn` owns one run; the only place state changes is `transition()` |
| `src/policy.ts` | Deterministic pre-response gate |
| `src/store.ts` | In-memory conversation and run records with the commit rules |
| `src/trace.ts`, `src/redact.ts` | Append-only ordered trace that closes on the terminal event, plus redaction |
| `src/clock.ts` | `Clock` interface with a `FakeClock` so timeouts are tested without sleeping |
| `src/fakeProvider.ts` | Scripted deterministic provider (text, reasoning, fail, hang, gate, malformed) |
| `src/cli.ts`, `src/bench.ts` | Presentation (CLI) and the verification benchmark |

## Technology choices

TypeScript on Node. Async iterators and `AbortController` fit streaming and cancellation, and the same core runs unchanged behind an HTTP/SSE server or a React Native client. Tests use vitest. There are no runtime dependencies, so setup is `npm install` and go. Alternatives considered: Python `asyncio` (equally fine, but I would rather share types with a web or mobile client) and a real DB such as SQLite (deferred; the `ConversationStore` interface is the seam).

## Important decisions

1. **One state machine, one transition point.** All state changes go through `Turn.transition()`, which checks a table. `settle()` runs synchronously inside the winning transition, so the store commit, the terminal trace event and the result cannot interleave with a rival terminal. Later attempts return false and are recorded in `ignoredTransitions`.
2. **Persistence boundary.**
   - The user message is saved once the policy accepts the input.
   - The assistant message is saved only atomically with a `completed` run (`finalizeRun`).
   - Partial output is never persisted; the trace keeps only chunk index and length.
   - Rejected input is not saved as a conversation message, but the run record is kept.
   - The store also refuses an assistant message for a non-completed run.
3. **Cancellation and timeout share one `AbortController`.** The runtime races each `iterator.next()` against the abort signal. It stops consuming immediately even if the provider ignores the signal (tested), and it calls `iterator.return()` on cleanup.
4. **Trace safety.**
   - Chunk text is never traced.
   - `reasoning` provider events are dropped.
   - Keys matching secret, token, key, password, reasoning or thought are dropped.
   - Secret-looking values (`sk-...`, `Bearer ...`) are masked inside strings.
5. **Late attempts are not in the trace.** "No events after terminal" and "reject late transitions observably" conflict if both use the trace. Late attempts go to `ignoredTransitions` on the result.

## Assumptions and limitations

- The timeout covers the whole turn, starting at acceptance. It is not per chunk.
- The policy is a small regex and length ruleset, meant to show the gate and not to be a real moderation system.
- The store is in memory and synchronous, so the commit is atomic. A real DB would use a transaction and write the terminal state in the same transaction.
- No live model provider is included. The provider interface is the seam for one.
- If `finalizeRun` itself throws (not possible with the in-memory store), the state has already moved and the later `failed` transition is refused, so the result would never resolve. A real implementation needs an explicit persistence-failure path. This is a known gap.
- There is no HTTP layer. The CLI is the presentation layer.

## Production and scale

First changes: a durable store (transaction per turn); write the run record as `streaming` at start so a crashed process leaves an inspectable orphan; a real provider adapter with retry rules; per-conversation concurrency limits; and trace export to a log pipeline. Behind a web client, expose `start` over SSE with cancel as a `DELETE`. If users could keep partial output after cancel, I would persist it as an assistant message with an explicit `partial` status, so it is never confused with a completed turn.

## AI usage

TODO: edit this to be accurate. I used Claude Code to scaffold the project and draft the code and tests, then reviewed and ran them. (Describe what you personally reviewed, changed and can explain.)

## Credibility note

TODO: describe one product or system you actually shipped (problem, your contribution, scale, one hard decision, link).
