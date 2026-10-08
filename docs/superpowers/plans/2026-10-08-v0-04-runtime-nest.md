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
