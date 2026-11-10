export interface Deadline {
  /** Aborted only when the deadline is reached, never by `dispose`. */
  readonly signal: AbortSignal;
  // Function properties, not methods: callers pass them around detached (`guardEmits(..., deadline.check)`).
  /** Throws the `onExpire` error once the deadline is reached or disposed. */
  readonly check: () => void;
  /** Runs `operation`, rejecting with the `onExpire` error when the deadline is reached first. */
  readonly wait: <T>(operation: () => Promise<T>) => Promise<T>;
  /** Clears the timer; a later `check` still throws, without aborting the signal. */
  readonly dispose: () => void;
}

/** One deadline for a run or an execution; without `timeoutMs` it never expires. */
export function createDeadline(
  timeoutMs: number | undefined,
  onExpire: () => Error,
): Deadline {
  const controller = new AbortController();
  if (timeoutMs === undefined)
    return {
      signal: controller.signal,
      check: () => {},
      wait: (operation) => operation(),
      dispose: () => {},
    };
  const deadline = performance.now() + timeoutMs;
  let live = true;
  const expire = () => {
    live = false;
    controller.abort();
    return onExpire();
  };
  let timer!: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(expire()), timeoutMs);
  });
  // Handled here so an expiry before any wait is not an unhandled rejection; wait still sees it.
  expired.catch(() => {});
  const check = () => {
    // A late call after expiry or dispose: refused, and only a reached deadline aborts.
    if (!live) throw onExpire();
    if (performance.now() >= deadline) throw expire();
  };
  return {
    signal: controller.signal,
    check,
    wait: async (operation) => {
      check();
      const value = await Promise.race([operation(), expired]);
      check();
      return value;
    },
    dispose: () => {
      live = false;
      clearTimeout(timer);
    },
  };
}
