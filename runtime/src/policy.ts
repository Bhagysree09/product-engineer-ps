import type { Policy, PolicyDecision } from './types';

export interface RulePolicyOptions {
  maxLength?: number;
  blocked?: readonly RegExp[];
}

const DEFAULT_BLOCKED: readonly RegExp[] = [/reveal (the )?system prompt/i, /build (a )?bomb/i];

/** Pure rule-based policy: same input always gives the same decision. */
export class RulePolicy implements Policy {
  private readonly maxLength: number;
  private readonly blocked: readonly RegExp[];

  constructor({ maxLength = 4000, blocked = DEFAULT_BLOCKED }: RulePolicyOptions = {}) {
    this.maxLength = maxLength;
    this.blocked = blocked;
  }

  check(input: string): PolicyDecision {
    if (input.trim().length === 0) return { allowed: false, code: 'empty_input', reason: 'Input is empty' };
    if (input.length > this.maxLength) return { allowed: false, code: 'too_long', reason: 'Input is too long' };
    if (this.blocked.some((rule) => rule.test(input))) {
      return { allowed: false, code: 'blocked_content', reason: 'Input matches a blocked rule' };
    }
    return { allowed: true };
  }
}
