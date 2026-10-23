# v0.5: value objects, relações entre entidades, ports e infraestrutura

Pesquisa de 2026-10-22 e 2026-10-23 para o [ADR-0006](../../adr/ADR-0006.md). Foi feita em rodadas, com subagentes independentes:
- rodada 0: fatos do código e precedentes externos;
- rodada 1: quatro propostas concorrentes;
- rodada 2: dois juízes sem contexto compartilhado;
- rodada 3: spikes das hipóteses decisivas;
- rodada 4: convergência e dois revisores adversários.

Os arquivos de trabalho de cada rodada se perderam quando o scratchpad da sessão foi limpo. Este relatório registra o que cada rodada concluiu.

## Demanda

Modelar value objects e dependências entre entidades, com regras táticas de DDD verificadas, e trazer a infraestrutura (ports e implementações) para o fluxo de packet e verify. Os dois exemplos que guiam o desenho:
1. **Composição:** `Pedido` contém `ItemDoPedido`, feito dos value objects `Quantidade` e `Dinheiro`; o total é uma invariante do pedido.
2. **Referência entre agregados:** `Matricula` guarda `AlunoId` e `TurmaId`; as regras "aluno ativo" e "turma com vaga" são do use-case `matricular_aluno`.

Também é preciso medir se o framework traz ganho: o piloto cycle-21 só variou o modelo, sempre com o framework.

## Hoje no agentic-ddd (origin/main 3a3b193)

- **O que é declarado:** o Registry tem 6 listas, sem value object, relação nem port (`src/decorators/registry.ts:74-89`). `ValueObject`, `Entity`, `AggregateRoot` e `Repository` existem em `src/core`, mas são invisíveis ao compilador.
- **O grafo** (`src/compiler/graph.ts`) só conhece as camadas domain, application e operators. A entidade nasce com `dependsOn: []`, e só o use-case (por `uses`) e o operator dependem de outros itens.
- **Hashes:**
  - `irHash` é o sha256 da IR estável e vai em todas as skills; o runtime recusa skill com hash diferente;
  - `canonicalize` descarta chaves `undefined` (`src/contracts/canonical.ts:6-9`);
  - `isValidLockStructure` aceita chave extra (`src/compiler/lock.ts:27-50`).
- **Pontos que recusam o que é novo:**
  - `validate.ts:182-188` recusa `@Invariant` fora de entidade;
  - `covers.ts:1-2` e `changes/proposal.ts:6` só aceitam os prefixos atuais;
  - `roleForLayer` lança erro para camada desconhecida (`scripts/agent-briefs.ts:122-126`);
  - `boundary-gates` não aceita `--layer infrastructure`.
- **O que supõe entidade:** o gate de corpo e o brief só conhecem "interior do corpo de `Classe.método`, mesma quantidade de linhas". O finder de invariante do MCP e o `history.ts` supõem que toda invariante é de uma entidade.
- **Benchmark:** `benchmark` é `z.literal('tasks')`; todo modo de prompt injeta o packet; `routing.byLayer` não tem infraestrutura (`scripts/evals/contracts.ts`).

## Precedentes externos

- **jMolecules** ([xmolecules/jmolecules](https://github.com/xmolecules/jmolecules)): `@AggregateRoot`, `@Entity`, `@ValueObject`, `@Identity`, `Association<T,ID>` e `@Repository`. O `JMoleculesDddRules` ([jmolecules-integrations](https://github.com/xmolecules/jmolecules-integrations)) verifica 4 regras:
  1. entidade não raiz só dentro do agregado do dono;
  2. agregado referencia outro só por id ou `Association`;
  3. identidade declarada;
  4. VO não referencia entidade.
- **Context Mapper** ([tactic-ddd](https://contextmapper.org/docs/tactic-ddd/)): o `Repository` só pode ser declarado na raiz do agregado.
- **ArchUnitTS** e eslint-plugin-boundaries verificam dependência entre pastas, mas não o tipo de um campo.
- **Vernon** ([InfoQ](https://www.infoq.com/news/2014/12/aggregates-ddd), [Effective Aggregate Design, parte 2](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_2.pdf), IDDD cap. 10):
  - invariantes dentro da fronteira do agregado;
  - um agregado modificado por transação;
  - outro agregado referenciado por identidade;
  - consistência eventual por eventos.

## Propostas (rodada 1)

| Proposta | Ideia | Fraqueza decisiva |
|---|---|---|
| A, declaração explícita (estilo jMolecules) | Decorators para tudo, relação declarada nos dois sentidos, 11 gates | O próprio exemplo quebra ao carregar (`ReferenceError` de ordem de classes); ~3.500 linhas; duas fontes de verdade |
| B, marcar o tipo e inferir as relações | O TypeChecker extrai composição e referência dos tipos dos campos | O `irHash` passa a depender de tsconfig, versão do TS e node_modules; fere o espírito do ADR-0005 D6 |
| C, agregado como unidade | `@Aggregate` com membros, VOs, repositório e `mutates`/`reads` | Repete `@AgentEntity`; o gate "um agregado por use-case" reprova o `matricular_aluno` legítimo, porque `uses` lista leituras |
| D, medir primeiro | Braço de controle num domínio maior; só `@ValueObject` e uma dependência | Adia a infraestrutura, que o usuário pediu primeiro; o aceite por oráculo bate no teto |

## Juízes (rodada 2)

Os dois juízes, sem contexto compartilhado, ordenaram **D > C ≈ A > B** e recomendaram a mesma convergência:
- a base da D, com a infraestrutura da A e da C;
- a IR feita só de declarações num único sentido, com a árvore sintática apenas como gate;
- `CORE_RULES` intacto;
- medição em paralelo, com outra métrica principal além do aceite.

O juiz 1 acrescentou `@Invariant` em use-case, que é o que dá contrato ao exemplo 2.

## Spikes (rodada 3)

| # | Hipótese | Resultado |
|---|---|---|
| H1 | Chave nova da IR omitida quando vazia preserva hash e lock | Confirmada pelo código. Ressalva: o snapshot do `bun:test` grava `"chave": undefined`, então a chave precisa ser omitida por spread condicional, nunca preenchida com `undefined` |
| H2 | Port como interface aceita decorator | Refutada: a interface some em runtime. Classe abstrata funciona, mas o método abstrato também some (o `toString` dá `class Repo { }`), então a assinatura só vem do código ou da declaração |
| H3a | O TypeChecker resolve o tipo dos campos (`#privado`, getter, parâmetro do construtor) | Confirmada (fixture com `Pedido`, `ItemDoPedido` e `Matricula`) |
| H3b | Desembrulha `Array`/`Set`/`Map` e detecta o agregado guardado inteiro | Confirmada (`aluno: Aluno`, `Map<string, Turma>`) |
| H3c | Id nominal por alias de intersecção (`type Id<T> = string & {...}`) | Refutada no desembrulho simples; um id como classe de VO funciona |
| H3d | Custo no projeto real, com `paths` | ~0,9 s para `examples/orders` via o tsconfig do repo (705 arquivos no programa) |
| H4 | Classe citada no argumento de decorator nos dois sentidos | Refutada (`Cannot access 'Pedido' before initialization`); exige um sentido só e função (`() => [X]`) |
| H5 | `Function.prototype.toString` da classe mostra `notImplemented()` no construtor, em `#privado` e em métodos | Confirmada: serve de sinal de esqueleto para VO e adapter |

O TypeChecker funciona, mas ficou para a v0.6. Na v0.5 os gates usam só a árvore sintática e os metadados, para não depender do ambiente.

## Revisão adversária (rodada 4)

Os dois revisores reprovaram a primeira convergência. Todos os pontos foram incorporados ao ADR-0006:
- o contrato do port ficava fora da IR, do diff e do `specHash`; agora os métodos do port são declarados;
- faltavam no plano os prefixos novos de `covers()` (`ELEMENT_ID`), o `knownIds` do G4, as chaves (KEYS) de `scope.ts`, o `history.ts` e o finder de invariante;
- o gate de corpo não comporta um item com vários corpos; agora há um gate de escopo de classe;
- um gate novo mudaria o relatório do `verify` de todo projeto; agora ele só aparece quando existe elemento tático;
- um `repositoryContract` genérico geraria testes dinâmicos, invisíveis ao `status --static`; saiu, e as obrigações passam a ser os métodos do port;
- o braço de controle não tinha como contar violações sem decorators, e misturava versões; agora o esqueleto é o mesmo nos dois braços, na mesma versão;
- o nome `@ValueObject` colidia com a classe `ValueObject` do core; os decorators passam a ter o prefixo `Agent`.

## Não confirmado

- A Parte 1 de Vernon e o conteúdo de `ensureOnionSimple` do jMolecules não foram lidos.
- O custo e o determinismo do TypeChecker em projetos com barrels e monorepo, que ficam para a spike da v0.6.
