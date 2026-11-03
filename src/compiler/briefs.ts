import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256 } from './canonical';
import { DEFAULT_RULES_MAX_TOKENS } from './config';
import { approxTokens } from './lint';
import { isClassScopeItem } from './packet';
import type { Rule } from './rules';

export { sha256 };

export type BriefRole =
  'domain' | 'application' | 'infrastructure' | 'reviewer';
export interface PacketFacts {
  readonly id: string;
  readonly layer: string;
  readonly module: string;
  readonly sourcePath: string;
  readonly specHash: string;
}
export interface BriefSection {
  readonly title: string;
  readonly content: string;
}
export interface BriefInput {
  readonly packet: string;
  /** specHash do packet original; diverge do packet recebido → erro. */
  readonly expectedSpecHash?: string;
  /** Conteúdo fora do packet. Fica em seção própria, com hash próprio. */
  readonly extras?: readonly BriefSection[];
  readonly maxTokens?: number;
  /** Regras do time já filtradas (briefRules). */
  readonly rules?: readonly Rule[];
  readonly rulesMaxTokens?: number;
}

export const DEFAULT_MAX_TOKENS = 6000;

const RESPONSE_FORMAT =
  'Final answer: only a JSON object, no prose, in the format of the example: `{"item":"entity:Order","specHash":"<packet hash>","status":"done","verifyExitCode":0,"changedFiles":["examples/orders/domain/order.ts"],"findings":[]}`. `status` is `done`, `blocked` or `failed`. `specHash` is the packet hash, never recomputed.';

/** Single source of the domain core: the skill's authoring reference, which ships next to `src` and `dist`. */
export const DOMAIN_CORE = fileURLToPath(
  new URL(
    '../../skills/agentic-ddd/references/executor-domain.md',
    import.meta.url,
  ),
);

/** Single source do núcleo do revisor. */
export const REVIEWER_CORE = fileURLToPath(
  new URL('../../skills/agentic-ddd/references/reviewer.md', import.meta.url),
);

// Read on first use, not at import: a consumer that bundles the package into one file moves `import.meta.url`
// and would otherwise fail to load, even when it never renders a brief.
const readCore = (path: string): string => readFileSync(path, 'utf8').trimEnd();

export const ROLE_CORES: Readonly<Record<BriefRole, string>> = {
  get domain() {
    return readCore(DOMAIN_CORE);
  },
  application: [
    '# Role: application executor',
    '',
    'Implement ONE application or operator item from the packet below. Use the declared contracts of its dependencies (domain methods and entities), without editing them.',
    '',
    '- Change only the inside of the body given under "Files" and test files. Keep imports, signatures, decorators, schemas, rule IDs, proposals, configuration and generated files.',
    '- Keep the line count of the body (the `source` coordinates go into the generated files). Do not reformat the file.',
    '- Compose only the dependencies listed in `uses`/`Dependencies`; emitted events are the declared ones. Do not change the domain: if a dependency contradicts the contract, return the item.',
    '- A declarative operator is already implemented: add only tests that exercise its tools and contracts.',
    '- Cover each packet obligation with `covers([...ids], title)` from `@agentic-ddd/testing` in `bun:test` tests.',
    '- Keep identifiers, rule IDs and business text exactly as written; never translate them.',
    '- Do not run `compile` or change the hash. Pending dependency, hash mismatch or a need for infrastructure outside the contract: return the item.',
    '- A team rule never beats a gate (verify, specHash, boundary gates, `covers` obligations): on conflict, follow the gate and return the item describing the conflict.',
    '- After two corrections without progress on the findings, stop and return the diagnosis.',
    '',
    RESPONSE_FORMAT,
  ].join('\n'),
  infrastructure: [
    '# Role: infrastructure executor',
    '',
    'Implement ONE adapter (a class that implements a port) from the packet below. The port and its methods are the contract; do not edit them.',
    '',
    '- Change only the class of this item (bodies and `#private` members, same line count) and test files. Imports and `#private` fields already come in the skeleton; do not change `extends`/`implements`, decorators or the public signature. Do not reformat the file.',
    '- You may use external libraries that are already imported. No side effects on import.',
    "- Test each port method with `covers(['port:<Port>.<method>'], title)` from `@agentic-ddd/testing` in `bun:test` tests.",
    '- Keep identifiers, rule IDs and business text exactly as written; never translate them.',
    '- Do not run `compile` or change the hash. Pending dependency, hash mismatch or a need to edit something outside the contract: return the item.',
    '- A team rule never beats a gate (verify, specHash, boundary gates, `covers` obligations): on conflict, follow the gate and return the item describing the conflict.',
    '- After two corrections without progress on the findings, stop and return the diagnosis.',
    '',
    RESPONSE_FORMAT,
  ].join('\n'),
  get reviewer() {
    return readCore(REVIEWER_CORE);
  },
};

const FORBIDDEN = [
  'decorators and declarations',
  'proposals (`changes/**`)',
  'configuration (`agentic.config.ts`)',
  'generated files (`.agents/skills`, `.agentic/`, `.claude/skills`, the generated block of `AGENTS.md`)',
];

function field(packet: string, label: string): string {
  const match = new RegExp(`^- ${label}: \`?([^\`\\n]+)\`?$`, 'm').exec(packet);
  if (!match) throw new Error(`packet sem o campo "${label}"`);
  return match[1]!.trim();
}

export function parsePacket(packet: string): PacketFacts {
  const id = field(packet, 'ID');
  const specHash = field(packet, 'specHash');
  const command = /--item (\S+) --spec-hash ([a-f0-9]{64})/.exec(packet);
  if (!command)
    throw new Error('packet sem o comando de verificação com --spec-hash');
  if (command[2] !== specHash || command[1]!.replaceAll("'", '') !== id)
    throw new Error(
      'packet inconsistente: o comando de verificação não bate com o ID/specHash',
    );
  return {
    id,
    layer: field(packet, 'Layer'),
    module: field(packet, 'Module'),
    sourcePath: field(packet, 'source').replace(/:\d+$/, ''),
    specHash,
  };
}

export function roleForLayer(layer: string): BriefRole {
  switch (layer) {
    case 'domain':
      return 'domain';
    case 'application':
    case 'operators':
      return 'application';
    case 'infrastructure':
      return 'infrastructure';
    default: {
      const unreachable: string = layer;
      throw new Error(`camada sem papel de executor: ${unreachable}`);
    }
  }
}

const BODY_LINES = [
  '- Change only the inside of the body given under "Files" and test files. Keep imports, signatures, decorators, schemas, rule IDs, proposals, configuration and generated files.',
  '- Keep the line count of the body (the `source` coordinates go into the generated files). Do not reformat the file. Without enough space, return the item to the manager.',
];
const CLASS_LINES = [
  '- Change only the class given under "Files" (bodies and `#private` members, same line count) and test files. Do not change `extends`/`implements`, decorators or the public signature. Keep imports, schemas, rule IDs, proposals, configuration and generated files.',
  '- Keep the line count of the class (the `source` coordinates go into the generated files). Do not reformat the file. Without enough space, return the item to the manager.',
];

/** Item de classe (VO/adapter): troca as linhas de corpo do núcleo de domínio pelas de classe. */
function classScopeCore(core: string): string {
  return BODY_LINES.reduce((text, line, i) => {
    if (!text.includes(line))
      throw new Error('núcleo de domínio sem a linha de corpo esperada');
    return text.replace(line, CLASS_LINES[i]!);
  }, core);
}

export function renderExtras(extras: readonly BriefSection[]): string[] {
  if (!extras.length) return [];
  return [
    '',
    '## Additional sections (outside the specHash)',
    '',
    'These sections are not part of the packet and are not covered by the `specHash`; each one carries its own hash.',
    ...extras.flatMap((e) => [
      '',
      `### ${e.title} (sha256: \`${sha256(e.content)}\`)`,
      '',
      e.content.trimEnd(),
    ]),
  ];
}

const listRules = (rules: readonly Rule[]): string =>
  rules.map((r) => `${r.key} ~${approxTokens(r.body)}`).join(', ');

/** Seção "Regras do time" (vazia sem regras); nunca trunca. */
export function rulesSection(
  rules: readonly Rule[] = [],
  maxTokens = DEFAULT_RULES_MAX_TOKENS,
): BriefSection[] {
  if (!rules.length) return [];
  const content = rules.map((r) => `#### ${r.key}\n\n${r.body}`).join('\n\n');
  const tokens = approxTokens(content);
  if (tokens > maxTokens)
    throw new Error(
      `regras do time excedem o orçamento: ~${tokens} > ${maxTokens} tokens (${listRules(rules)})`,
    );
  return [{ title: 'Team rules', content }];
}

export function checkBudget(
  brief: string,
  maxTokens: number,
  rules: readonly Rule[] = [],
): string {
  const tokens = approxTokens(brief);
  if (tokens > maxTokens)
    throw new Error(
      `brief excede o orçamento: ~${tokens} > ${maxTokens} tokens${rules.length ? ` (regras do time: ${listRules(rules)})` : ''}`,
    );
  return brief;
}

/** Brief de executor (domínio ou aplicação), determinístico a partir do packet. */
export function renderBrief(input: BriefInput): string {
  const facts = parsePacket(input.packet);
  if (input.expectedSpecHash && input.expectedSpecHash !== facts.specHash)
    throw new Error(
      `specHash divergente: esperado ${input.expectedSpecHash}, packet ${facts.specHash}`,
    );
  const role = roleForLayer(facts.layer);
  const classItem = isClassScopeItem(facts.id);
  return checkBudget(
    [
      classItem && role === 'domain'
        ? classScopeCore(ROLE_CORES.domain)
        : ROLE_CORES[role],
      '',
      '## Files',
      '',
      `- May change: \`${facts.sourcePath}\` (only ${classItem ? 'the class' : 'the inside of the body'} of \`${facts.id}\`, same line count) and \`*.test.ts\` files.`,
      `- May not change: ${FORBIDDEN.join('; ')}.`,
      '',
      '## Packet',
      '',
      input.packet.trimEnd(),
      ...renderExtras([
        ...(input.extras ?? []),
        ...rulesSection(input.rules, input.rulesMaxTokens),
      ]),
      '',
    ].join('\n'),
    input.maxTokens ?? DEFAULT_MAX_TOKENS,
    input.rules,
  );
}

