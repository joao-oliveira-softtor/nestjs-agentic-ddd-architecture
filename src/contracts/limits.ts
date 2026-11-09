// Single rule for operator limits: the compiler applies it at compile time and the
// runtime when it assembles the operator, without either importing the other.
const MAX_TIMEOUT_MS = 2_147_483_647;

export function limitsError(limits: {
  readonly maxSteps: number;
  readonly timeoutMs: number;
}): string | null {
  if (!Number.isInteger(limits.maxSteps) || limits.maxSteps <= 0)
    return 'maxSteps must be a positive integer';
  if (!Number.isFinite(limits.timeoutMs) || limits.timeoutMs <= 0)
    return 'timeoutMs must be a finite positive number';
  // setTimeout clamps anything above 2^31-1 to 1 ms, so every run would time out at once.
  if (limits.timeoutMs > MAX_TIMEOUT_MS)
    return `timeoutMs must not exceed ${MAX_TIMEOUT_MS} (the setTimeout maximum)`;
  return null;
}
