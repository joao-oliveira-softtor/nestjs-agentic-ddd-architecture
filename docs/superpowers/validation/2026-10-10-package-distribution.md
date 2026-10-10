# Validação da distribuição — issue #13

Data: 2026-10-10. Base: main 0cbd74b (inclui os planos 5/6 posteriores à release fonte v0.1.0). Runtime local: Bun 1.4.2, Node 24.19.0, npm 11.9.0, TypeScript 6.0.3. Nenhum pacote publicado e nenhuma integração na main realizada.

## Resultado do pacote

- `bun install --frozen-lockfile`: aprovado.
- `bun run typecheck`, `bun run lint`, `bun run build`: aprovados.
- `bun run agentic compile --check` e `bun run skills:install --check`: aprovados; domínio e gerados de orders preservados.
- Testes focados finais de app, metadados, transformação e auditoria: 9 aprovados, 0 falhas. Incluem inicialização do exemplo com BunAdapter e teste executável do bloqueio de publicação.
- `bun run test:package`: aprovado. npm pack constrói o pacote, audita os 310 arquivos reais do tarball e npm instala em consumidor temporário fora do checkout, sem NODE_PATH e sem tsconfig paths.
- Consumidor compila todas as fronteiras e raiz em NodeNext e bundler, com skipLibCheck false. Private import de dist rejeitado por exports.
- CLI instalada gera e verifica skills a partir de proposta inicial do consumidor. Instruções geradas referenciam imports públicos e comando `bun run agentic-ddd`, que é executado no smoke.
- Nest application context resolve os providers, a dependência prefix de GreetPerson, o token LLM_PORT e OperatorRuntime; tool retorna `DI: Hello Joao` e run completed.
- Bundle contém o framework e o domínio; Nest, reflect-metadata, rxjs, Zod e TypeScript permanecem externos. Fonte e bundle preservam o mesmo IR hash `5c1fa3f5627f883c73e27c0a6ad7820a736bc6cb6b084da93df5ae17b0ed1367` e source `src/shop/domain.ts:12`.
- Maps de JS são emitidos junto com transformação AST; maps de declarações também embutem sourcesContent. Nenhuma reescrita de código após a emissão invalida colunas.

## Suíte completa e ambiente

Baseline: 400 aprovados, 9 falhas, 14 snapshots. Execução completa após a implementação: **403 aprovados, 9 falhas, 14 snapshots** (412 testes, 55 arquivos). Três testes adicionais finais (transformação, templates interpolados e gate executável) também passaram na execução focada acima.

As mesmas 9 falhas já aparecem no baseline, provocadas por `bwrap: Creating new namespace failed: Operation not permitted`; os gates de verify propagam a falha da suíte. Não enfraquecemos o isolamento nem marcamos esses casos como aprovados:

1. Hook sem nome em evals-implementation: tutorial no sandbox não inicializa.
2. `all five original cases judged correctly in fresh readonly sessions without expectations`.
3. `wrong, malformed, timeout, infrastructure remain distinct and do not stop independent questions`.
4. `complete native adapters execute only offline stub CLIs in private homes and redact injected secrets`.
5. `physical source snapshot excludes solutions and materializes dependencies privately`.
6. `timeout and cancellation terminate resistant descendant processes`.
7. `offline integrated run stops after one reservation, preserves evidence and original hashes, and leaves origin unchanged`.
8. `agentic-ddd verify > verify 0001 do exemplo retorna done` (G5 da suíte).
9. `agentic-ddd verify > verify 0002 do exemplo retorna needs-human por causa do critério manual` (G5 da suíte).

O CI existente mantém Ubuntu 22.04 e o probe obrigatório de bubblewrap. A validação do tarball foi adicionada como etapa de CI; o resultado remoto deve ser acompanhado na PR.

## Incompatibilidades e decisões

- Compiler/CLI usam Bun.Glob/Bun.spawn/Bun.YAML; Node como runtime integral e CommonJS não são certificados. Node é usado no smoke apenas para TypeScript e rejeição de export privado.
- Bun CLI build 1.4.2 produziu bundle dentro de src e mapas com paths src/src neste ambiente, mesmo com outfile/root explícitos. O smoke usa Bun.build com root/outdir/naming explícitos, cuja execução preservou paths e hashes.
- O compilador exige proposta do domínio inicial: a fixture inclui changes/0001-greeting antes da compilação; compile sem proposta não certifica check.
- prepublishOnly sozinho não protege publicação direta de tarball. Mantemos private:true e o hook até definição do nome final, disponibilidade e permissões. npm pack/install funciona com private:true.
- Nome provisório preservado: nestjs-agentic-ddd-architecture. Nenhuma alegação de disponibilidade no registry ou controle de um scope.
- Revisão independente: corrigidos comando gerado, mapas após transformação, conteúdo fonte de declaration maps e bloqueio de publicação do tarball. Sem achados importantes pendentes.
