# Autoria do domínio

Leia a configuração em uso: `modules[].path` define raiz do módulo; `out.devSkills`, `out.runtimeSkills`, `mirrors`, `changes` e `verify` podem substituir padrões. Consulte `AGENTS.md` e a skill gerada `<módulo>-dev/SKILL.md` nesses caminhos. Não suponha `examples/orders` em consumidores.

Crie entidades, eventos, value objects e ports em `<módulo>/domain`, use-cases em `<módulo>/application`, operators em `<módulo>/operators` e adapters em `<módulo>/infrastructure` (camada própria, ver "Adapters"); a composição segue o projeto. Importe building blocks de `@agentic-ddd/core`, decorators de `@agentic-ddd/decorators`, testes de `@agentic-ddd/testing` e schemas de `zod`.

- `@AgentEntity({ description, states })` declara entidade e estados. Cada regra é `@Invariant({ id, text })`, na classe ou método; preserve IDs kebab-case, gerando obrigações `invariant:Entidade/id`.
- Todo método público de negócio tem `@AgentMethod({ description, emits, transition })`; auxiliares usam `#privado`. Fábrica estática `create` estabelece construção (`entity:Entidade`); métodos são `method:Entidade.nome`. Getters de estado e métodos herdados dos building blocks seguem as convenções existentes.
- `@AgentEvent({ description, payload: z.object(...) })` em classes que estendem `DomainEvent<Payload>` declara eventos; agregados usam `record`/`pullEvents`. Mantenha `emits` coerente nos métodos e use-cases. O `emits` do use-case cobre tudo o que os métodos em `uses` emitem (o compile reprova o que faltar), e o runtime recusa evento publicado fora dele.
- `@AgentUseCase({ name, description, whenToUse, whenNotToUse, input, output, uses, emits, ports })` usa schemas Zod explícitos e tipos `z.infer`. `uses` lista IDs reais como `method:Task.create` e `method:Task.complete`; define dependências. `ports` é opcional (ver "Ports"). Implemente `UseCase<In, Out>` e `execute(input, ctx)`, injete port de repositório e publique eventos via `ctx.publish`.
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

Preencha delta completo (eventos/use-cases/operators e os ids `valueobject:`/`port:`/`adapter:` inclusive; mudar um port exige proposta) e critérios Given/When/Then automáticos ou `manual: true`. Depois declare e rode `bun run agentic compile --config <config>`. Se código já mudou, `compile --draft-change <slug>` apenas gera rascunho; preencha Motivo/critérios antes de compilar. Compare lock/skills gerados e não os edite.

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

## Relações entre agregados

`@AgentEntity({ contains: () => [...], references: () => [...] })` declara as relações, sempre no dono e sempre por função (o que importa a classe depois de carregada).

- `contains`: VO ou entidade filha do mesmo agregado. Os itens contidos entram no `dependsOn` da entidade, então vêm antes dela nas ondas.
- `references`: só entidades (raiz de outro agregado). Citar um VO é erro. Não cria aresta, então agregados podem se referenciar em ciclo; o packet traz o contrato do id e da raiz referenciada.
- Raiz: é derivada. A entidade que nenhum `contains` cita é raiz.
- Erros: entidade filha em mais de um `contains`; entidade filha de outro módulo (um VO de outro módulo é aceito); ciclo de `contains` entre entidades; função de `contains`/`references` que lança ou devolve classe sem decorator (erro de compilação, com o `source` do dono).
- Um VO pode estar em vários `contains`; uma entidade filha, em um só.
- Aviso, não erro: raiz que não estende `AggregateRoot`, ou filha que estende.
- O que o campo guarda é conferido pelo "Gate T" (T1 e T3).

```ts
@AgentEntity({
  description: 'Matrícula de um aluno numa turma.',
  states: ['ativa', 'cancelada'],
  contains: () => [AlunoId, TurmaId],
  references: () => [Aluno, Turma],
})
export class Matricula extends AggregateRoot<string> {}
```

## Invariante em use-case

`@Invariant({ id, text })` também vale em `@AgentUseCase`, para regra que atravessa agregados (como "aluno ativo"). O id é `invariant:<use-case>/<id>` (`matricular_aluno/aluno-ativo`), com `on: null`, e é obrigação do item do use-case: cubra com `covers([...])` no teste dele.

## Ports

Port (contrato de repositório que o domínio usa) é uma classe `abstract` com `@AgentPort({ description, root: () => Raiz, methods: { nome: 'descrição' } })`. Vira o elemento `port:<Nome>`, sem item próprio: quem o implementa é o adapter (ver "Adapters").

- `root` precisa ser raiz de agregado.
- Todo método abstrato da classe está em `methods`, e todo método de `methods` é abstrato na classe; a diferença é erro de compilação.
- Os métodos entram no `specHash`, então mudar um port exige proposta.
- O use-case declara `ports: () => [Port]` e o packet dele traz os métodos. Isso não cria `dependsOn`; a ordem vem de `uses`.
- Port sem métodos deixa o adapter em erro, porque ele ficaria sem obrigações.

## Gate T

O gate T confere, em `entity:` e `valueobject:`, o que o campo guarda. T1: campo ou parâmetro de construtor cujo tipo nomeia a raiz de outro agregado (guarde o id, como `AlunoId`). T2: campo ou prop de VO que nomeia uma entidade. T3: campo de entidade que nomeia um VO fora do seu `contains`, ou uma entidade filha de outro agregado; filhas do mesmo agregado são permitidas.

O T roda só no `verify --item` de item `entity:` ou `valueobject:` em projeto com elemento tático (VO, `contains`/`references`, port ou adapter). `status` e `verify <NNNN>` não o veem, e um use-case ou operator que edite o arquivo da entidade não é reconferido.

Quem corrige: o executor só troca o tipo de um `#privado` que criou num VO. Campo declarado, parameter property, `contains`/`references` e props do VO são declaração, e o gerente ajusta: proposta e compile quando a IR muda, novo packet quando o specHash muda.

Falsos negativos, que o T não enxerga: alias de tipo e import renomeado; tipo inferido sem anotação; props do VO em interface ou alias nomeado (`ValueObject<Props>`); tipos de função, `typeof`, `keyof`, acesso indexado (`Aluno['id']`) e argumentos de genérico do usuário (`Partial<Aluno>`); `Promise`, `WeakMap`, `WeakSet` e `WeakRef` não são abertos; campos herdados não são lidos; o tipo do id em `extends AggregateRoot<X>` não é conferido.

Limite herdado: classe por expressão ou decorator por alias cai no fail-closed, que reprova com "classe não encontrada" em vez de passar.

## Regras do time

As regras do time ficam em `.ai/rules/*.md` (pasta trocável por `rules.dir`); cada arquivo é uma regra e a chave é o caminho sem `.md`, como `testes` para `.ai/rules/testes.md`. Um frontmatter opcional com só `paths:` (globs relativos à raiz) limita a regra: sem ele, ela entra inteira em "Convenções" do AGENTS.md; com ele, entra no índice "Regras por caminho" e na seção "Regras do time" das skills de dev cujos arquivos casam. O corpo é lista com `- `, sem título `#`. Um arquivo com a mesma chave de uma regra do núcleo (`core/...`) substitui essa regra, e `rules.exclude` remove uma; os briefs de executor e revisor recebem as regras do time aplicáveis ao arquivo do item (as do núcleo não; uma substituição sua, inclusive de regra de coordenação como `core/coordination`, chega ao executor), até `rules.briefMaxTokens` (padrão 2000), e acima do limite o brief falha em vez de truncar. Gates (verify, specHash, fronteiras, `covers`) sempre vencem uma regra. Depois de editar, recompile: `compile --check` reprova regra alterada sem recompilação.

## Convenções de layout

Por padrão, as camadas são `domain`, `application` e `operators` dentro de cada módulo; `infrastructure` (adapters) tem as pastas em `conventions.infrastructure` (padrão `['infrastructure', 'infra']`), não em `conventions.layers`. Para mudar nomes de pasta, sufixos ou imports proibidos, use `conventions` em `agentic.config.ts`:

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

- `domain`, `application` e `operators` são, cada uma, o nome de uma pasta só dentro do módulo; `infrastructure` aceita uma lista de pastas. Layout aninhado, como `src/<bc>/core/domain`, se faz por `modules[].path`; camadas em pais diferentes não são suportadas.
- A camada de um item continua vindo do decorator, não da pasta.
- `forbiddenImports` diz o que `domain` e `application` não podem importar. Uma lista substitui o padrão, não soma a ele; declarar uma camada mantém o padrão da outra. `[]` desliga a regra de pastas daquela camada, mas a barreira a `@nestjs/*` e ao runtime continua. `operators` não tem regra de import.
- `suffixes` só muda o texto da tabela "Como estender"; nenhum gate valida nome de arquivo pelo sufixo.
- Essas convenções valem para a tabela "Como estender" da skill de dev, para o texto de camadas no bloco do AGENTS.md e para o gate de import do `orchestrate`.
- Uma regra do time com a chave `core/layers` muda só o texto; o gate continua o mesmo.
- O CLI `bun scripts/boundary-gates.ts imports` usa só o padrão; ele não lê o `agentic.config.ts`.

## Adapters

Adapter (implementação de um port, o contrato de repositório que o domínio usa) usa `@AgentAdapter({ description, implements: () => Port })` em classe que estende o port, declarado como classe abstrata com `@AgentPort`. Fica em `<módulo>/infrastructure` (as pastas aceitas estão em `conventions.infrastructure`; padrão `infrastructure` ou `infra`) e vira o item `adapter:<Nome>` da camada `infrastructure`, que depende da raiz do port.

- Obrigações: um id `port:<Port>.<método>` por método do port, cada um coberto por `covers([...])` no teste do adapter.
- Um adapter por port na v0.5; um segundo adapter do mesmo port é erro.
- Escopo de classe: o executor altera corpos e membros `#privados`, mas não os decorators, o `extends`/`implements` nem a assinatura pública.
- Imports e campos `#privados` já vêm no esqueleto.
- O arquivo não pode ter efeito colateral no import (o `compile` importa todo `.ts` do módulo): conexões ficam no construtor ou numa fábrica.

```ts
@AgentAdapter({
  description: 'Matrículas em memória.',
  implements: () => MatriculaRepository,
})
export class InMemoryMatriculaRepository extends MatriculaRepository {
  #itens = new Map<string, Matricula>();

  async save(matricula: Matricula): Promise<void> {
    return notImplemented();
  }
  async contarPorTurma(turma: TurmaId): Promise<number> {
    return notImplemented();
  }
}
```
