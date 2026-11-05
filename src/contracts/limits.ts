// Single rule for operator limits: the compiler applies it at compile time and the
// runtime when it assembles the operator, without either importing the other.
export function limitsError(limits: {
  readonly maxSteps: number;
  readonly timeoutMs: number;
}): string | null {
  if (!Number.isInteger(limits.maxSteps) || limits.maxSteps <= 0)
    return 'maxSteps must be a positive integer';
  if (!Number.isFinite(limits.timeoutMs) || limits.timeoutMs <= 0)
    return 'timeoutMs must be a finite positive number';
  return null;
}
