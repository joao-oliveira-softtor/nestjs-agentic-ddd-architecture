# Plano 4 — Runtime e integração Nest

> Execução: usar `superpowers:executing-plans` ou `superpowers:subagent-driven-development`, com TDD e commits por entrega.

**Objetivo:** executar operators com LLM roteirizado, aprovação e eventos, expostos pela composição Nest.
**Arquitetura:** runtime depende dos ports e do registry; Nest compõe instâncias e infraestrutura; domínio e use-cases preservam isolamento. Compartilhar a projeção canônica necessária ao hash sem imports entre compiler e runtime.
**Stack:** Bun, TypeScript, Zod, Nest e testes `bun:test`.

Spec: [v0 §§9–10, aceite 2 e 3](../specs/2026-10-06-agentic-ddd-v0-design.md).
Pré-condição: plano 3 implementado. Este plano descreve o próximo marco, sem implementar runtime nesta entrega.

## Base real e limites de imports

- `src/core/use-case.ts`: `UseCase<In, Out>.execute(input, ctx)` e `UseCaseContext` com correlationId, causationId e publish.
- `src/decorators/registry.ts`: UseCaseRecord (schemas Zod, target, uses, emits) e OperatorRecord (allowlist, requiresApproval, limites, model).
- `src/compiler/ir.ts`: buildIR e irHash; `src/compiler/render/runtime-skill.ts`: skill com metadata de hash.
- `src/testing/context.ts`: createTestContext já carimba eventos e registra publicações.
- `examples/orders`: três use-cases prontos, OrderRepository e InMemoryOrderRepository; OrderOperator tem cancel_order em requiresApproval.
- `test/architecture.test.ts`: compiler/runtime não se importam; core só importa zod; domínio/application não importam Nest. Não criar imports runtime → compiler para obter IR: extrair a projeção/hash compartilhada ou introduzir port de contrato fornecido na composição. A extração precisa preservar os hashes e snapshots existentes.

## 1. Contratos e fakes (TDD + commit)

Criar `src/runtime/ports.ts`, `types.ts`, `index.ts` com LlmPort, LlmRequest/Response/Message/AssistantBlock, ApprovalPort e EventBus conforme §9.1/9.6. JSON Schema do port é tipo local/compartilhado; sem dependência de compiler. Expor OperatorRunResult/Step e motivos de término.

Em `src/testing/fake-llm.ts`, implementar roteiro de respostas ou funções e histórico de requests; roteiro esgotado lança erro explícito. FakeApproval aceita boolean ou função. EventBus in-memory preserva ordem e aguarda handlers. Testar preservação de providerPayload, consumo do roteiro e ordem dos eventos. Exportar via `@agentic-ddd/testing`.

## 2. Montagem do operator (TDD + commit)

Criar `src/runtime/operator-runtime.ts` com registro de operator e instâncias de use-cases injetadas pela composição. Validar skill runtime presente e metadata ir-hash contra projeção canônica do registry; erro orienta compile. System combina instructions + corpo da skill. Tools usam somente allowlist e schemas de entrada; descrição inclui whenToUse/whenNotToUse. Testar skill ausente/divergente, allowlist, model e providerPayload.

## 3. Loop e política de término (TDD + commit)

Implementar run(name, { message, context? }) com IDs por run/passo. Executar tool_calls sequencialmente; devolver todos os resultados em uma única mensagem tool. Validar entrada Zod; unknown_tool, invalid_input, approval_denied e DomainError tornam-se isError sem encerrar. Aprovação precede execute. Publicações carimbam correlação/causação, alimentam EventBus e entram no resultado da tool/run. Output inválido e exceção inesperada encerram failed/use_case_error.

Cobrir completed, maxSteps por chamada LLM, timeout com promises pendentes, max_tokens, refusal e provider_error. Registrar Steps com decisões e eventos. Timeout não pode iniciar tools adicionais depois de encerrado; documentar cancelamento cooperativo de operações já iniciadas.

## 4. Integração Nest e composição orders (TDD + commit)

Criar `src/nestjs/agentic.module.ts` e `index.ts`: forRoot registra ports/runtime com tokens; forFeature registra operators/use-cases. Criar `examples/orders/orders.module.ts` usando useFactory para repositories e use-cases; nenhum decorator Nest no domínio/application. Manter BunAdapter e ausência de controllers. Verificar resolução DI em TestingModule e executar OperatorRuntime.run por nome.

## 5. E2E, documentação e aceite (TDD + commit)

Roteiro FakeLlm cria e confirma pedido, termina com texto; asserts: system contém skill, tools são exatamente três, output/eventos e correlationId/causationId corretos. Segundo roteiro cancela com aprovação requerida: negar não chama execute/não publica; aprovar cancela/publica. Marcar covers(['operator:order-operator']) e critérios de change se declarações de negócio mudarem. Atualizar documentação e substituir a cobertura exclusivamente declarativa do operator por e2e real.

Executar typecheck, lint, bun test, build, compile --check, verify 0001 e verify 0002. Os novos e2e devem cumprir aceite 2/3 e manter o fluxo de coordenação e hashes do plano 3. Review final antes de integração.

Para cada entrega acima:

- [ ] Escrever os testes dos cenários descritos.
- [ ] Rodar o arquivo de testes e confirmar RED por comportamento ausente.
- [ ] Implementar o contrato nos arquivos indicados.
- [ ] Rodar testes relevantes, typecheck e lint; confirmar GREEN.
- [ ] Criar commit da entrega com testes e documentação pertinente.

Aceite final esperado: `bun test` sem falhas; `bun run agentic verify 0001` = `done`; `bun run agentic verify 0002` = `needs-human`; cobertura do operator passa pelo FakeLlm e pela composição Nest.

## Registro de execução — 2026-10-08

Base: `7a6163f`, branch `feat/plan-4-runtime-nest`. Execução inline no checkout solicitado, com TDD e commits por entrega.

Pre-flight: entrega 1 fornece ports/fakes para 2–5; entrega 2 fornece registro/projeção para loop e Nest; entrega 3 fornece run para E2E; entrega 4 fornece composição para 5. Não há conflitos de interfaces.

Decisão: extrair IR e canonicalização para `src/contracts`, com reexports no compiler, preservando bytes/hashes e fronteira compiler/runtime. Configuração de runtime recebe root/modules (mesma identidade do compilador); a composição filtra o registry por módulos para isolar declarações de outros projetos/testes.
Decisão: timeout termina o run e fecha a admissão de tools/publicações; operações já iniciadas têm cancelamento cooperativo (sem rollback de efeitos externos). Aprovação ausente nega por padrão.

Entrega 1 concluída: RED por exports ausentes; GREEN com 3 testes (roteiro/payload, aprovação, bus concorrente/ordem/unsubscribe), typecheck e lint. Ports/resultados públicos e fakes entregues. Bus reside no runtime e é reexportado em testing.

Entrega 2 concluída: RED por OperatorRuntime ausente; GREEN (36 testes relevantes, 4 snapshots existentes intactos), typecheck/lint. Registro rejeita skill ausente, hash ausente/divergente, declaração alterada e instância ausente; request contém apenas allowlist, schemas, instructions+corpo, model e contexto. IR/canonical extraídos com reexports compatíveis. O run desta entrega só monta o turno textual; loop e payload entre turnos na entrega 3.
Decisão: root/modules são configuração explícita de identidade da IR no runtime/Nest (modules obrigatório, root default cwd), sem ler/importar configuração do compiler. Evita inferência de paths/nome de módulos que invalidaria hashes existentes.

Entrega 3 concluída: RED com 15 falhas comportamentais; GREEN com 21 testes runtime, typecheck/lint. Loop sequencial, resultados agrupados, providerPayload preservado por identidade, IDs/eventos/trace, validação entrada/saída, aprovação e erros recuperáveis. Todas as linhas da tabela de término testadas; timeout cobre LLM/aprovação/execute/bus pendentes e resoluções tardias.
Baseline confirmada: 316 testes, 14 snapshots, nenhuma falha.

Entrega 4 concluída: RED na ausência de módulo/DI e no AppModule vazio; GREEN em 12 testes de composição/arquitetura, typecheck/lint/build/compile --check. AgenticModule global forRoot + forFeature com providers/factories/imports, registro assíncrono durante TestingModule.compile, tokens públicos, aprovação default deny e bus in-memory. OrdersModule e AppModule compostos, BunAdapter preservado. Ajuste de testes: get<T> explícito nos tokens Symbol evita inferência undefined no expect do Bun.

Entrega 5: E2E real substitui o teste exclusivamente declarativo. Compile em saída temporária → skill carregada → Nest → criar/confirmar com output/eventos/IDs; cancelar com deny/allow, spy provando ausência de execute e eventos no deny. Testes passaram (17 testes E2E/composição/source). Declarações de negócio preservadas; OrderCancelled mantém o payload declarado `{ orderId }`.

Decisão adicional (RED→GREEN): smoke do bundle mostrou registro sem operator: `captureSource` usava import.meta.url do bundle para excluir frames do decorator. Build agora gera source map linked; captureSource deriva o diretório dos frames mapeados. Smoke real do dist com BunAdapter passou; hashes/snapshots/compile --check preservados. Distribuir o .map junto ao bundle.

Documentação atualizada com uso Nest/FakeLlm, tokens/configuração de identidade, traces, limites e cancelamento cooperativo. Helpers de runtime isolados de arquivos de teste. A revisão final e aceite completo seguem abaixo.

Revisão independente: dois P2 reproduzidos e corrigidos com RED→GREEN. (1) publicação reentrante aguardada no mesmo bus causava deadlock: rejeitada explicitamente via contexto assíncrono do handler; a fila continua utilizável após o erro, sem antecipar reactsTo. (2) registros simultâneos podiam sobrescrever o mesmo operator: rechecagem de duplicidade no ponto de commit após leitura da skill.

Aceite integrado encontrou a fixture do plano 3 importando OrdersModule sem resolver Nest. A fixture temporária agora compartilha node_modules via symlink; seus E2E usam root/modules do próprio agentic.config.ts, em vez do layout fixo do checkout. As quatro ondas continuam verificadas com execução real do operator na última onda, sem testes iniciais nem evidência fabricada.

Correções revisadas independentemente, sem novos findings. Suíte final: 348 testes, zero falhas, 14 snapshots intactos; typecheck, lint, build e compile --check aprovados. A fixture completa também passou isoladamente (45 assertions). Verificações explícitas dos changes em execução antes da publicação.
