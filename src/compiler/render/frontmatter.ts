export interface SkillMeta {
  readonly name: string;
  readonly description: string;
  readonly audience: 'dev' | 'runtime';
  readonly irHash: string;
}

export function frontmatter(meta: SkillMeta): string {
  const description = meta.description.replace(/\s*\r?\n\s*/g, ' ').trim();
  return [
    '---',
    `name: ${meta.name}`,
    `description: ${JSON.stringify(description)}`,
    'metadata:',
    `  agentic-ddd.audience: ${meta.audience}`,
    '  agentic-ddd.generated: "true"',
    `  agentic-ddd.ir-hash: "${meta.irHash}"`,
    '---',
  ].join('\n');
}

export function GENERATED_HEADER(source: string): string {
  return `<!-- GERADO por agentic-ddd compile — não edite. Fonte: ${source} -->`;
}
