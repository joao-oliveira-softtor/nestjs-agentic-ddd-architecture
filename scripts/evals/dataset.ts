import { readFile } from 'node:fs/promises';
import { datasetSchema, type EvalCase } from './contracts';

export async function loadDataset(path: string): Promise<readonly EvalCase[]> {
  return datasetSchema.parse(Bun.YAML.parse(await readFile(path, 'utf8')));
}
