# Plano 5 — Skill e agentes para Cursor, Codex e Claude Code

Refina a [issue #5](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/5), sobre a base v0.1.0. Fonte autoral em `skills/agentic-ddd/`: entrada curta, descoberta automática e referências de autoria, gerente, executor, instalação e tutorial. As skills geradas de módulo continuam sendo a autoridade para detalhes do domínio.

## Decisões

- Instalador Bun `skills:install --scope project|user --target cursor|codex|claude|all --root <diretório> --check`; padrões project/all/cwd (user usa o diretório pessoal). Root é a raiz do projeto ou do usuário, não a pasta de agentes. Cria links para a fonte e adaptadores nativos; preflight completo, idempotência e recusa de arquivos alheios. Não modifica configurações ou permissões. Instalação global depende da permanência do checkout fonte.
- Cursor/Codex descobrem `.agents/skills/agentic-ddd`; Claude recebe `.claude/skills/agentic-ddd` apontando à mesma fonte. Agentes Markdown em `.cursor/agents` e `.claude/agents`, TOML em `.codex/agents`; modelo herdado e instruções de papel compartilhadas. Claude precarrega `skills: [agentic-ddd]`. Caminhos ajustados por instalação, sem cópias das instruções por ambiente.
- Gerente escreve proposta antes das declarações, prepara contratos/imports/infra/config, compila e despacha um executor por vez da primeira onda de `next --change NNNN`. Entrega packet inteiro, hash original, configuração, limites e critérios automáticos. Consulta propostas abertas e arquivadas.
- Executor altera somente corpos atribuídos e testes; preserva imports, assinaturas, decorators, schemas, propostas, config e gerados. Operators declarativos recebem testes. Usa verify do packet com hash original e devolve resultado/arquivos/findings, inclusive coleta. Dependência pendente, hash divergente, edição fora do contrato ou duas correções sem progresso devolvem ao gerente.
- Gerente revisa diff, repete verify individual, recalcula next e encerra com verify change. Só done conclui item; needs-human vale para change e expõe critérios manuais. Retomada usa packet/hash originais; novo hash exige revisão da spec pelo gerente. Sessão principal pode despachar sem delegação aninhada.
- `skills:example --root <destino>` cria workspace isolado tasks e recusa destino existente. Proposta precede contratos Task/create/complete/eventos/repositório em memória/use-cases/operator, corpos com notImplemented e sem testes aplicados. Aliases apontam ao checkout e typecheck é real.

## Aceite

Instalação local/global dos três ambientes testada em temporários: formatos, referências válidas, idempotência, conflitos, check sem escrita e preservação pelo compilador sem alterar APIs. Tutorial percorre consultas sem testes (sem done), ondas/packet/verify individual/verify change, hash e gerados estáveis com corpos, rejeição de alteração de declaração. Skill passa quick_validate.py. Typecheck, lint, suíte, build e compile --check passam.

Smokes independentes reais em Cursor e Codex concluem um item a partir de packet, registrando versão, modelo efetivo, hash, diff e relatório. Falta de ferramenta/autenticação deixa esse aceite pendente. Claude validado por definições, instalação e referências; execução real adiada. Sem npm, runner da issue #6, orquestrador genérico, UI ou app permanente adicional; orders não evolui.

Formatos consultados em 2026-10-08: [Cursor](https://cursor.com/docs/subagents), [Claude](https://code.claude.com/docs/en/sub-agents), [Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents). Codex atual descobre TOML em agents sem registro em config; omitir model e model_reasoning_effort herda sessão.
