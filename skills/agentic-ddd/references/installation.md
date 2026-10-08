# Instalação

No checkout do framework, rode `bun install --frozen-lockfile` e:

```bash
bun run skills:install                                     # projeto atual, todos
bun run skills:install --root /caminho/do/projeto --target codex
bun run skills:install --scope user --target all            # instalação global explícita
bun run skills:install --scope user --root /caminho/do/home --check
bun run skills:install --check                              # sem escrita, 0 se íntegro
```

`--scope` aceita project/user e `--target` cursor/codex/claude/all. `--root` é a raiz do projeto ou do usuário; sem root, project usa cwd e user usa o diretório pessoal. Opção inválida sai 2, conflito/drift sai 1. Check nunca cria diretórios. O preflight recusa conflitos antes de qualquer escrita; instalar novamente preserva os artefatos idênticos. Adaptador editado manualmente também é conflito: revise/remova somente seus arquivos antes de reinstalar.

Cursor/Codex usam link `.agents/skills/agentic-ddd`; Claude usa link `.claude/skills/agentic-ddd`, ambos para `skills/agentic-ddd` do checkout. Adaptadores: `.cursor/agents/agentic-ddd-{manager,executor}.md`, `.codex/agents/agentic-ddd-{manager,executor}.toml`, `.claude/agents/agentic-ddd-{manager,executor}.md`. O mesmo layout é criado sob home para scope user. Não há mudança em config.toml, settings, permissões ou modelo global. Codex omite model/effort; Cursor/Claude usam inherit. Claude precarrega a skill no campo skills.

A fonte precisa permanecer no checkout original, inclusive em instalação global. Ao mover/apagar esse checkout, revise os links/adaptadores e reinstale; não há distribuição npm nesta entrega. A descoberta automática permanece habilitada. Reabra a sessão para recarregar skills/agentes quando necessário.

Os adaptadores referenciam a instrução compartilhada de cada papel. Invoque `agentic-ddd-manager` para preparar proposta/contratos ou `agentic-ddd-executor` com packet e limites. A sessão principal pode cumprir um papel, sem exigir subagente dentro de subagente.

Formatos oficiais: [Cursor](https://cursor.com/docs/subagents), [Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Claude Code](https://code.claude.com/docs/en/sub-agents). Releases antigas podem não descobrir TOML automaticamente; atualize o cliente sem o instalador modificar configurações globais.
