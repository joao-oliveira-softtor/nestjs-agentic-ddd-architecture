// Regra única dos limits de operator: o compilador a aplica na compilação e o
// runtime ao montar o operator, sem que um importe o outro.
export function limitsError(limits: {
  readonly maxSteps: number;
  readonly timeoutMs: number;
}): string | null {
  if (!Number.isInteger(limits.maxSteps) || limits.maxSteps <= 0)
    return 'maxSteps deve ser um inteiro positivo';
  if (!Number.isFinite(limits.timeoutMs) || limits.timeoutMs <= 0)
    return 'timeoutMs deve ser um número finito positivo';
  return null;
}
