import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import type { AuditReport } from './contracts';
import { sha256 } from './isolation';

export const TASK_ITEMS = [
  {
    id: 'entity:Task',
    file: 'app/domain/task.ts',
    className: 'Task',
    method: 'create',
    test: 'app/test/entity-Task.test.ts',
    criteria: ['titulo-invalido', 'criacao'],
  },
  {
    id: 'method:Task.complete',
    file: 'app/domain/task.ts',
    className: 'Task',
    method: 'complete',
    test: 'app/test/method-Task-complete.test.ts',
    criteria: ['conclusao'],
  },
  {
    id: 'usecase:create_task',
    file: 'app/application/create-task.ts',
    className: 'CreateTask',
    method: 'execute',
    test: 'app/test/usecase-create_task.test.ts',
    criteria: ['persistencia-criacao'],
  },
  {
    id: 'usecase:complete_task',
    file: 'app/application/complete-task.ts',
    className: 'CompleteTask',
    method: 'execute',
    test: 'app/test/usecase-complete_task.test.ts',
    criteria: ['persistencia-conclusao'],
  },
  {
    id: 'operator:task-operator',
    file: null,
    className: null,
    method: null,
    test: 'app/test/operator-task-operator.test.ts',
    criteria: ['tools'],
  },
] as const;
export interface TreeEntry {
  kind: 'file' | 'link' | 'directory';
  mode: number;
  hash: string;
  content: string;
}
export async function readTree(root: string): Promise<Map<string, TreeEntry>> {
  const tree = new Map<string, TreeEntry>();
  async function visit(directory: string) {
    for (const name of (await readdir(join(root, directory))).sort()) {
      const path = directory ? `${directory}/${name}` : name;
      const full = join(root, path);
      const stat = await lstat(full);
      const kind = stat.isSymbolicLink()
        ? 'link'
        : stat.isDirectory()
          ? 'directory'
          : 'file';
      if (kind === 'file' && !stat.isFile())
        throw Error(`Unsupported file type: ${path}`);
      const bytes =
        kind === 'file'
          ? await readFile(full)
          : Buffer.from(kind === 'link' ? await readlink(full) : '');
      tree.set(path, {
        kind,
        mode: stat.mode,
        hash: sha256(bytes),
        content: bytes.toString('utf8'),
      });
      if (kind === 'directory') await visit(path);
    }
  }
  await visit('');
  return tree;
}
export async function treeHash(root: string): Promise<string> {
  return sha256(
    JSON.stringify(
      [...(await readTree(root))].map(([path, e]) => [
        path,
        e.kind,
        e.mode,
        e.hash,
      ]),
    ),
  );
}
function body(
  text: string,
  className: string,
  methodName: string,
): { start: number; end: number } {
  const parsed = ts.createSourceFile(
    'submission.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics =
    ts.transpileModule(text, {
      reportDiagnostics: true,
      compilerOptions: {
        experimentalDecorators: true,
        target: ts.ScriptTarget.ESNext,
      },
    }).diagnostics ?? [];
  if (diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error))
    throw Error('Submission syntax invalid');
  for (const statement of parsed.statements)
    if (
      ts.isClassDeclaration(statement) &&
      statement.name?.text === className
    ) {
      const method = statement.members.find(
        (m) =>
          ts.isMethodDeclaration(m) && m.name.getText(parsed) === methodName,
      );
      if (method && ts.isMethodDeclaration(method) && method.body)
        return {
          start: method.body.getStart(parsed) + 1,
          end: method.body.end - 1,
        };
    }
  throw Error('Assigned method body missing');
}
export async function auditSubmission(
  baselineRoot: string,
  submissionRoot: string,
  item: string,
): Promise<AuditReport> {
  const assignment = TASK_ITEMS.find((i) => i.id === item);
  if (!assignment) throw Error(`Unknown assignment: ${item}`);
  const baseline = await readTree(baselineRoot);
  let submission: Map<string, TreeEntry>;
  try {
    submission = await readTree(submissionRoot);
  } catch (error) {
    return {
      ok: false,
      findings: [`Unsafe submission tree: ${String(error)}`],
      changedFiles: [],
      patch: '[]',
    };
  }
  const findings: string[] = [];
  const changedFiles: string[] = [];
  const changes: unknown[] = [];
  for (const path of [
    ...new Set([...baseline.keys(), ...submission.keys()]),
  ].sort()) {
    const before = baseline.get(path),
      after = submission.get(path);
    if (
      before?.kind === after?.kind &&
      before?.mode === after?.mode &&
      before?.hash === after?.hash
    )
      continue;
    changedFiles.push(path);
    changes.push({ path, before: before ?? null, after: after ?? null });
    if (path === 'app/test' && !before && after?.kind === 'directory') continue;
    if (
      path === assignment.test &&
      !before &&
      after?.kind === 'file' &&
      (after.mode & 0o111) === 0
    )
      continue;
    if (
      path !== assignment.file ||
      before?.kind !== 'file' ||
      after?.kind !== 'file' ||
      before.mode !== after.mode
    ) {
      findings.push(`Forbidden file change: ${path}`);
      continue;
    }
    try {
      const oldBody = body(
        before.content,
        assignment.className!,
        assignment.method!,
      );
      const newBody = body(
        after.content,
        assignment.className!,
        assignment.method!,
      );
      if (
        before.content.slice(0, oldBody.start) !==
          after.content.slice(0, newBody.start) ||
        before.content.slice(oldBody.end) !== after.content.slice(newBody.end)
      )
        findings.push(`Bytes outside assigned body changed: ${path}`);
      if (
        (before.content.slice(oldBody.start, oldBody.end).match(/\n/g) ?? [])
          .length !==
        (after.content.slice(newBody.start, newBody.end).match(/\n/g) ?? [])
          .length
      )
        findings.push(`Body line count changed: ${path}`);
    } catch (error) {
      findings.push(String(error));
    }
  }
  return {
    ok: findings.length === 0,
    findings,
    changedFiles,
    patch: JSON.stringify(changes, null, 2),
  };
}
