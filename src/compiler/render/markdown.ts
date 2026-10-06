import type { JsonSchema } from '../ir.js';

export function cell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

export function code(text: string): string {
  return `\`${text}\``;
}

export function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const line = (columns: readonly string[]): string =>
    `| ${columns.map(cell).join(' | ')} |`;
  return [
    line(headers),
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map(line),
  ].join('\n');
}

export function stripKind(id: string): string {
  return id.slice(id.indexOf(':') + 1);
}

export function idList(ids: readonly string[]): string {
  return ids.length > 0 ? ids.map((id) => code(stripKind(id))).join(', ') : '—';
}

export function guardedBy(on: string | null): string {
  return on === null ? 'construção' : code(stripKind(on));
}

export function typeLabel(schema: JsonSchema): string {
  if (Array.isArray(schema.enum))
    return `enum: ${(schema.enum as unknown[]).map(String).join(', ')}`;
  if ('const' in schema) return `const: ${String(schema.const)}`;
  if (typeof schema.type === 'string') {
    if (schema.type === 'array' && schema.items) {
      const items = schema.items as JsonSchema;
      return `array<${typeLabel(items)}>`;
    }
    return schema.type;
  }
  if (Array.isArray(schema.type)) return (schema.type as string[]).join(' | ');
  if (Array.isArray(schema.anyOf))
    return (schema.anyOf as JsonSchema[]).map(typeLabel).join(' | ');
  return 'qualquer';
}

export function parameterRows(schema: JsonSchema): string[][] {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(properties).map(([key, property]) => [
    code(key),
    typeLabel(property),
    required.has(key) ? 'sim' : 'não',
    typeof property.description === 'string' ? property.description : '—',
  ]);
}
