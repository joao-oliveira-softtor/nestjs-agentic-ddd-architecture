const ELEMENT_ID =
  /^(entity|invariant|method|event|usecase|operator|criterion):\S+$/;
const COVERS_PREFIX = /^\[covers: ([^\]]+)\]/;

export function covers(ids: readonly string[], title: string): string {
  if (ids.length === 0) throw new Error('covers() exige ao menos um ID');
  for (const id of ids) {
    if (!ELEMENT_ID.test(id))
      throw new Error(
        `ID inválido em covers(): ${id} (esperado tipo:caminho, ex.: method:Order.confirm)`,
      );
  }
  return `[covers: ${[...new Set(ids)].sort().join(', ')}] ${title}`;
}

export function parseCovers(testName: string): string[] {
  const match = COVERS_PREFIX.exec(testName);
  return match ? match[1]!.split(', ') : [];
}
