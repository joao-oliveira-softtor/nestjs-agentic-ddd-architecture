import { renderBrief } from '../agent-briefs';

/**
 * `legacy`: "Leia SKILL.md" + packet, como a campanha de 2026-10-10.
 * `brief`: o brief D5 de `renderBrief` no lugar da leitura da skill. O resto do
 * protocolo (root, arquivo de teste, critérios, hash, formato de resposta) é o mesmo,
 * para que só o contexto difira entre os dois modos.
 */
export type PromptMode = 'legacy' | 'brief';

export interface ImplementationPromptInput {
  readonly mode: PromptMode;
  readonly packet: string;
  readonly root: string;
  readonly configPath: string;
  readonly specHash: string;
  /** Item sem corpo (operator declarativo): `file`, `className` e `method` são null. */
  readonly file: string | null;
  readonly className: string | null;
  readonly method: string | null;
  readonly test: string;
  readonly criteria: readonly {
    readonly id: string;
    readonly [key: string]: unknown;
  }[];
  /** Texto de correção já formatado (começa com `\n`); vazio na primeira tentativa. */
  readonly correction?: string;
}

const SESSION = 'Use só a sessão principal, sem delegação ou subagentes.';
const RESPONSE_FORMAT =
  'Resposta final: objeto JSON com exatamente duas propriedades, status e summary; sem propriedades adicionais. Exemplo {"status":"done","summary":"texto"}; status deve ser done, blocked ou failed, sem prosa ou cercas.';

export function buildImplementationPrompt(
  input: ImplementationPromptInput,
): string {
  const edit = `Edite somente ${input.file ? `${input.file} ${input.className}.${input.method} (somente interior do corpo, mesma quantidade de linhas)` : 'nenhum corpo'} e o novo teste ${input.test}. Preserve imports, contratos, decorators, outros corpos, testes existentes, configurações, propostas e gerados.`;
  const criteria = `Critérios adicionais arquivados: ${JSON.stringify(input.criteria.map((c) => ({ ...c, id: `criterion:0001/${c.id}` })))}. Cubra-os com covers do executor.`;
  const root = `Root atual: ${input.root}; configuração atual: ${input.configPath}. Use esses paths no lugar de paths temporários do packet; conserve o specHash original ${input.specHash}.`;
  const correction = input.correction ?? '';
  if (input.mode === 'brief') {
    const brief = renderBrief({
      packet: input.packet,
      expectedSpecHash: input.specHash,
    });
    return `${brief}\n---\nProtocolo do benchmark (prevalece sobre o brief acima):\n${root}\n${edit}\n${criteria}\n${SESSION} Este protocolo de resposta final substitui o formato de resposta final do brief. ${RESPONSE_FORMAT}${correction}`;
  }
  return `Packet:\n${input.packet}\nEnd packet\n${root}\n${edit}\n${criteria}\nLeia .agents/skills/agentic-ddd/SKILL.md e referências de executor pertinentes. ${SESSION} Neste benchmark, este protocolo de resposta final substitui o handoff normal da skill/referência de executor. ${RESPONSE_FORMAT}${correction}`;
}
