export interface Timer {
  cancel(): void;
}

/** Injected so timeouts are deterministic in tests: no real sleeping. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): Timer;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(handle) };
  },
};

/** Manually advanced clock. Timers fire in due-time order during `advance`. */
export class FakeClock implements Clock {
  private time = 0;
  private timers: { at: number; fn: () => void; active: boolean }[] = [];

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): Timer {
    const timer = { at: this.time + ms, fn, active: true };
    this.timers.push(timer);
    return { cancel: () => void (timer.active = false) };
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => t.active && t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.active = false;
      this.time = due.at;
      due.fn();
    }
    this.time = target;
  }
}
