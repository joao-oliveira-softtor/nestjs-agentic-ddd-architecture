# Autoria do domínio

Leia a configuração em uso: `modules[].path` define raiz do módulo; `out.devSkills`, `out.runtimeSkills`, `mirrors`, `changes` e `verify` podem substituir padrões. Consulte `AGENTS.md` e a skill gerada `<módulo>-dev/SKILL.md` nesses caminhos. Não suponha `examples/orders` em consumidores.

Crie entidades, eventos e ports em `<módulo>/domain`, use-cases em `<módulo>/application`, operators em `<módulo>/operators`; infraestrutura/composição segue o projeto. Importe building blocks de `@agentic-ddd/core`, decorators de `@agentic-ddd/decorators`, testes de `@agentic-ddd/testing` e schemas de `zod`.

- `@AgentEntity({ description, states })` declara entidade e estados. Cada regra é `@Invariant({ id, text })`, na classe ou método; preserve IDs kebab-case, gerando obrigações `invariant:Entidade/id`.
- Todo método público de negócio tem `@AgentMethod({ description, emits, transition })`; auxiliares usam `#privado`. Fábrica estática `create` estabelece construção (`entity:Entidade`); métodos são `method:Entidade.nome`. Getters de estado e métodos herdados dos building blocks seguem as convenções existentes.
- `@AgentEvent({ description, payload: z.object(...) })` em classes que estendem `DomainEvent<Payload>` declara eventos; agregados usam `record`/`pullEvents`. Mantenha `emits` coerente nos métodos e use-cases. O `emits` do use-case cobre tudo o que os métodos em `uses` emitem (o compile reprova o que faltar), e o runtime recusa evento publicado fora dele.
- `@AgentUseCase({ name, description, whenToUse, whenNotToUse, input, output, uses, emits })` usa schemas Zod explícitos e tipos `z.infer`. `uses` lista IDs reais como `method:Task.create` e `method:Task.complete`; define dependências. Implemente `UseCase<In, Out>` e `execute(input, ctx)`, injete port de repositório e publique eventos via `ctx.publish`.
- `@Operator({ name, description, instructions, useCases, requiresApproval })` referencia classes de use-case; é declarativo, sem corpo execute obrigatório. Prepare a infraestrutura de execução/teste antes de despachar.
- Corpo ainda pendente: `return notImplemented();` importado de core. Só a chamada literal é reconhecida; corpo vazio conta como implementado. Não substitua por throw genérico ou wrapper.

Antes de mudar regra, escreva proposta no diretório configurado:

```yaml
---
id: '0001'
title: Criar tarefas
status: proposed
origin: proposal-first
delta:
  added:
    ['entity:Task', 'method:Task.create', 'invariant:Task/titulo-obrigatorio']
  modified: []
  removed: []
acceptance:
  - id: titulo-invalido
    covers: ['invariant:Task/titulo-obrigatorio']
    given: título vazio
    when: criar uma tarefa
    then: rejeita com TASK_TITLE_REQUIRED
---
## Motivo

O usuário precisa de tarefas identificadas com um título válido.
```

Preencha delta completo (eventos/use-cases/operators inclusive) e critérios Given/When/Then automáticos ou `manual: true`. Depois declare e rode `bun run agentic compile --config <config>`. Se código já mudou, `compile --draft-change <slug>` apenas gera rascunho; preencha Motivo/critérios antes de compilar. Compare lock/skills gerados e não os edite.

Testes: `test(covers(['method:Task.create', 'invariant:Task/titulo-obrigatorio', 'criterion:0001/titulo-invalido'], 'rejeita título vazio'), () => { ... });`. IDs do packet determinam obrigações; não use cobertura sem asserções reais.

## Value objects

Value object (objeto de valor, definido pelos seus valores e sem identidade própria) usa `@AgentValueObject({ description })` em classe que estende `ValueObject` de `@agentic-ddd/core`. Vira o item `valueobject:<Nome>` da camada `domain`.

- Aceita `@Invariant` na classe (`invariant:<Nome>/<id>`); em método é erro.
- Obrigações: o próprio `valueobject:<Nome>` e cada invariante, cobertos por `covers([...])` nos testes.
- Esqueleto: a chamada literal `notImplemented()` em qualquer corpo da classe (construtor, `#privado` ou método).
- Não instancie um VO esqueleto no topo do módulo (ex.: `static ZERO = new Dinheiro(...)`): o `compile` importa o arquivo e lança erro.
- O arquivo do VO precisa ser importado pela aplicação, como o de uma entidade; o `irHash` do runtime inclui os VOs.

```ts
@AgentValueObject({ description: 'Valor monetário em centavos.' })
@Invariant({ id: 'nao-negativo', text: 'Dinheiro não é negativo.' })
export class Dinheiro extends ValueObject<{ centavos: number; moeda: string }> {
  // corpo com notImplemented() enquanto estiver pendente
}
```

## Regras do time

As regras do time ficam em `.ai/rules/*.md` (pasta trocável por `rules.dir`); cada arquivo é uma regra e a chave é o caminho sem `.md`, como `testes` para `.ai/rules/testes.md`. Um frontmatter opcional com só `paths:` (globs relativos à raiz) limita a regra: sem ele, ela entra inteira em "Convenções" do AGENTS.md; com ele, entra no índice "Regras por caminho" e na seção "Regras do time" das skills de dev cujos arquivos casam. O corpo é lista com `- `, sem título `#`. Um arquivo com a mesma chave de uma regra do núcleo (`core/...`) substitui essa regra, e `rules.exclude` remove uma; os briefs de executor e revisor recebem as regras do time aplicáveis ao arquivo do item (as do núcleo não; uma substituição sua, inclusive de regra de coordenação como `core/coordination`, chega ao executor), até `rules.briefMaxTokens` (padrão 2000), e acima do limite o brief falha em vez de truncar. Gates (verify, specHash, fronteiras, `covers`) sempre vencem uma regra. Depois de editar, recompile: `compile --check` reprova regra alterada sem recompilação.

## Convenções de layout

Por padrão, as camadas são `domain`, `application` e `operators` dentro de cada módulo. Para mudar nomes de pasta, sufixos ou imports proibidos, use `conventions` em `agentic.config.ts`:

```ts
export default defineConfig({
  modules: [{ name: 'shop', path: 'src/shop/core' }],
  conventions: {
    layers: { domain: 'model' },
    suffixes: { events: '.evt.ts' },
  },
});
```

Aqui, entidades e eventos ficam em `src/shop/core/model`, com eventos em `.evt.ts`; `application` e `operators` seguem o padrão.

- Cada camada é o nome de uma pasta só dentro do módulo. Layout aninhado, como `src/<bc>/core/domain`, se faz por `modules[].path`; camadas em pais diferentes não são suportadas.
- A camada de um item continua vindo do decorator, não da pasta.
- `forbiddenImports` diz o que `domain` e `application` não podem importar. Uma lista substitui o padrão, não soma a ele; declarar uma camada mantém o padrão da outra. `[]` desliga a regra de pastas daquela camada, mas a barreira a `@nestjs/*` e ao runtime continua. `operators` não tem regra de import.
- `suffixes` só muda o texto da tabela "Como estender"; nenhum gate valida nome de arquivo pelo sufixo.
- Essas convenções valem para a tabela "Como estender" da skill de dev, para o texto de camadas no bloco do AGENTS.md e para o gate de import do `orchestrate`.
- Uma regra do time com a chave `core/layers` muda só o texto; o gate continua o mesmo.
- O CLI `bun scripts/boundary-gates.ts imports` usa só o padrão; ele não lê o `agentic.config.ts`.
