import type { ConversationStore, Message, RunRecord } from './types';

/**
 * Persistence boundary, enforced by the runtime and recorded here:
 *  - user message: saved once the policy accepts the input
 *  - assistant message: saved only together with a `completed` run, atomically
 *  - partial output: never saved (it exists only in the trace as chunk counts)
 *  - run record: saved for every terminal state, including rejected
 */
export class InMemoryStore implements ConversationStore {
  private readonly log: Message[] = [];
  private readonly runLog: RunRecord[] = [];

  addUserMessage(message: Message): void {
    this.log.push(message);
  }

  finalizeRun(run: RunRecord, assistant?: Message): void {
    if (assistant && run.state !== 'completed') {
      throw new Error(`assistant message cannot be stored for a ${run.state} run`);
    }
    this.runLog.push(run);
    if (assistant) this.log.push(assistant);
  }

  messages(conversationId: string): readonly Message[] {
    return this.log.filter((m) => m.conversationId === conversationId);
  }

  runs(): readonly RunRecord[] {
    return this.runLog;
  }
}
