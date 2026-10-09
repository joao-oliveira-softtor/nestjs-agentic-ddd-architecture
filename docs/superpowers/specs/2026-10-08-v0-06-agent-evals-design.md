# Plano 6 — Runner de avaliações com agentes reais

**Data:** 2026-10-08. **Status:** desenho aprovado; implementação não iniciada.

Refina a [issue #6](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/issues/6). [Plano de execução](../plans/2026-10-08-v0-06-agent-evals.md). Base investigada: main limpa em `75570a7d26ca4e46e75ef0cd6e0daac809b2e593`, após o Plano 5.

## 1. Objetivo, evidências e fronteiras

Medir compreensão das skills e implementação de contratos por agentes reais, com julgamento determinístico, isolamento e verificação independente. O runner é tooling em `scripts/evals`, executado por Bun; não é um adapter de `LlmPort` nem um canal de operação do domínio.

Evidências consultadas: [roadmap](../../ROADMAP.md), [ADR-0001](../../adr/ADR-0001.md), [design v0, §12.3](2026-10-06-agentic-ddd-v0-design.md), [spec do Plano 5](2026-10-08-v0-05-agent-skills-design.md), [validação e smokes do Plano 5](../validation/2026-10-08-plan5.md), skill autoral e referências de gerente/executor/tutorial, dataset orders, testes do dataset, gerador tasks e interfaces atuais do compilador/runtime.

- `evals/skills/orders.yaml` tem cinco perguntas com expectativas `exact`/`tool_call`. `test/evals.test.ts` valida o dataset contra o domínio; ainda não pergunta a agentes.
- `packet` devolve Markdown; `status --json` expõe `specHash`; `verify --item` aceita hash e retorna `done|failed`, com gates I1–I5. Hash exclui coordenadas de fonte e corpos. `verify` não audita o limite de edição do executor.
- `verify --item` executa testes do workspace. Coleta JUnit ausente/incompleta pode encerrar o CLI sem relatório de gates. O runner preserva esse erro; ausência de relatório nunca é sucesso.
- O compilador inclui `source` nos gerados. O Cursor precisou de uma correção de linhas no smoke; Codex preservou os slots na primeira execução. Ambos concluíram `entity:Task` com verificação independente. Portanto, hash e verify sozinhos são evidência insuficiente de estabilidade.
- Compile arquiva a proposta tasks antes de implementar corpos. O packet pode omitir critérios arquivados; o gerente precisa entregá-los separadamente.
- O tutorial aponta scripts, aliases, skills e dependências para o checkout que o criou. Criá-lo diretamente da origem não atende ao isolamento desta avaliação.

Adapters iniciais: **scripted, Codex CLI e Cursor CLI**. Claude continua adiado. Framework e runtime mantêm suas interfaces; `src/core` preserva sua fronteira; compiler/runtime não passam a se importar. Não evoluir `examples/orders`, gerar soluções no tutorial, implementar Planos 7–8, treinar modelos, usar LLM-juiz ou criar ranking público amplo.

## 2. Manifesto e entrada

Entrada separada da CLI do framework:

```bash
bun run evals --config evals/run.reference.json --out /tmp/agentic-evals-reference --real --trusted-source
```

Sem `--real`, apenas adapters scripted podem executar. Um manifesto real sem opt-in falha antes de iniciar qualquer CLI real. O runner não instala CLIs, efetua login nem altera configuração global.

Manifesto JSON estrito, validado com Zod, `schemaVersion: 1`:

| Campo            | Contrato                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceRef`      | Ref Git resolvida uma vez para commit; referência real usa o HEAD que contém o runner. Origem limpa, incluindo índice e arquivos não ignorados.                                                                                                       |
| `skillDatasets`  | Lista não vazia de `{ path, contextRoots: { dev, runtime } }`; paths e raízes relativos ao snapshot da origem. IDs únicos dentro de cada dataset.                                                                                                     |
| `benchmark`      | Literal `tasks`; os cinco itens da seção 5, sem opções de outros domínios nesta entrega.                                                                                                                                                              |
| `configurations` | Lista de `{ id, adapter, model, parameters }`; IDs únicos, adapter `scripted                                                                                                                                                                          | codex-cli | cursor-cli`, modelo explícito, sem `auto`. `parameters.reasoningEffort`é opcional; é`high` no perfil Codex de referência. |
| `budget`         | `{ maxInvocations, skillTimeoutMs, implementationTimeoutMs, totalTimeoutMs, maxCorrectionsPerItem, repetitions, concurrency }`. Valores explícitos para execução real, limites positivos; v1 fixa correções em 0 ou 1 e repetitions/concurrency em 1. |

O manifesto de referência usa `evals/skills/orders.yaml`, contexto dev `AGENTS.md` + `.agents/skills/orders-dev`, contexto runtime `.agentic/runtime/order-operator`, e os perfis/orçamento da seção 7. Arrays de casos/configurações são executados na ordem declarada. Itens de uma mesma onda seguem a ordem retornada por `next`.

Contexto é um bundle de paths relativos POSIX e bytes dos arquivos selecionados, ordenado por path; diretórios incluem seus arquivos e referências. Materializar links somente após validar os destinos. Proibir raízes de contexto que incluam datasets, soluções ou testes de referência. Para perguntas, expor somente contexto e instruções do protocolo; não expor fonte, expectativas ou critérios de implementação.

Config, dataset e contexto são congelados e identificados por SHA-256. Hash de bundle usa a serialização canônica da lista ordenada de pares path/conteúdo. Datas e paths temporários não entram em sua identidade. Evidências individuais conservam os comandos e paths efetivamente utilizados.

## 3. Protocolo determinístico e adapters

### 3.1 Resposta do agente

```ts
type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type Answer =
  | { type: 'exact'; value: string }
  | { type: 'tool_call'; name: string; input: Record<string, JsonValue> };
type ImplementationReply = {
  status: 'done' | 'blocked' | 'failed';
  summary: string;
};
```

Exigir um único JSON, sem cercas ou prosa. Usar `JSON.parse` e schemas estritos de objetos; whitespace externo ao JSON é permitido, mas strings de resposta não são normalizadas. Não extrair JSON por heurística nem corrigir a resposta pelo conteúdo esperado.

- `exact`: string igual, incluindo caixa, acentos e espaços.
- `tool_call`: nome igual e input estruturalmente igual; ordenar chaves recursivamente, conservar tipos e ordem dos arrays. Argumento extra, ausente ou de tipo diferente reprova.
- `tool_call` é escolha declarativa de tool/argumentos; não executa tools de negócio nem usa `OperatorRuntime`.
- JSON/shape inválido é `malformed`; resposta estruturalmente válida mas diferente é `incorrect`. Esgotar tempo é `timeout`, com causa não inferida.
- O status de implementação é uma alegação do agente, armazenada separadamente de `accepted`. `done` declarado não libera dependências.

### 3.2 Interface interna

```ts
type AdapterId = 'scripted' | 'codex-cli' | 'cursor-cli';
type Measured<T> =
  | { status: 'available'; value: T; source: string }
  | { status: 'unavailable'; reason: string };

interface AdapterRequest {
  id: string;
  mode: 'skills' | 'implementation';
  cwd: string;
  prompt: string;
  timeoutMs: number;
  evidenceDir: string; // destino do supervisor, nunca um mount do agente
}
interface AdapterInfo {
  id: AdapterId;
  version: string;
  executableSha256: string;
}
interface Usage {
  inputTokens: Measured<number>;
  cachedInputTokens: Measured<number>;
  outputTokens: Measured<number>;
  cost: Measured<{ amount: number; currency: string }>;
}
interface AdapterResult {
  transport: 'finished' | 'timeout' | 'cancelled' | 'infra_error';
  finalText: string | null;
  exitCode: number | null;
  signal: string | null;
  sessionId: Measured<string>;
  observedModel: Measured<string>;
  modelRevision: Measured<string>;
  usage: Usage;
  durationMs: number;
  evidence: string[]; // paths relativos ao diretório externo de evidências
  diagnostic: string | null;
}
interface EvalAdapter {
  probe(): Promise<AdapterInfo>;
  run(
    request: AdapterRequest,
    options: { signal: AbortSignal },
  ): Promise<AdapterResult>;
}
```

Cada instância recebe sua configuração de modelo/parâmetros ao ser criada. Probe consulta versão/capacidades locais, sem inferência. Resultados do supervisor não carregam expectativas; erros esperados retornam `AdapterResult`. Exceção inesperada na implementação do adapter vira infraestrutura no runner.

Capturar argv sem segredos, eventos, stdout/stderr, mensagem final e session ID. Registrar modelo solicitado e observado separadamente. Não preencher modelo observado ou revisão de pesos a partir do nome solicitado. Campo efetivo sem evidência é indisponível; metadados nativos confiáveis podem ser coletados no estado privado da sessão.

Codex: `exec --json`, modelo/effort explícitos, mensagem final de `agent_message` e término `turn.completed`; falha de turno/processo impede sucesso de transporte. Não usar `--output-schema` exclusivamente no Codex: os dois recebem o mesmo protocolo por prompt. Cursor: `--print --output-format stream-json`, sem deltas parciais; última mensagem completa do assistant e terminal `result` de sucesso. Não interpretar como mensagem final a concatenação de progresso do campo `result`. Aceitar campos novos em eventos do CLI; exigir os campos necessários ao término/parsing. Referências consultadas: [Codex non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode), [Cursor output format](https://cursor.com/docs/cli/reference/output-format) e [Cursor headless](https://cursor.com/docs/cli/headless).

Sessões novas usam homes privados, sem configs/hooks/MCP/plugins globais. Credenciais externas iniciais por `CODEX_API_KEY` e `CURSOR_API_KEY`, injetadas somente na invocação que precisa delas; não são exigidas em testes offline. Não copiar o home autenticado de origem. Flags para execução não interativa e escrita são restritas ao processo sob bubblewrap: Codex com política sem prompts e Cursor com `--force` na implementação; perguntas montam contexto somente leitura. Não permitir delegação pelo prompt; no Codex desabilitar multi-agent pela configuração explícita. Invocações internas do provedor não são contabilizadas como sessões pelo runner.

### 3.3 Supervisão e falhas

O supervisor usa argv em array, nunca shell interpolado; drena stdout/stderr simultaneamente, mede tempo monotônico e limita os dois streams somados a **8 MiB por tentativa**. Ao atingir o limite, retorna infraestrutura com `output_limit`; evidência limitada é sinalizada, não tratada como transcript completo.

Timeout ou AbortSignal encerram processo e descendentes. Dar **2 segundos** para término gracioso, depois forçar encerramento da árvore; só retornar quando não houver descendentes executando. Namespace de PID/bubblewrap e supervisão são testados com um filho resistente. Tratar SIGINT/SIGTERM no runner, persistir resultados existentes e cancelar a execução ativa.

| Situação                                                                                              | Classificação                                                                      |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Resposta errada/malformada; limite de edição violado; verificação comportamental negativa             | Resultado do agente, sem erro de infraestrutura                                    |
| Agente sem término no tempo permitido                                                                 | Timeout de adapter; causa desconhecida, insucesso avaliável                        |
| Verify/oráculo trava depois de executar código submetido                                              | Falha de verificação com timeout; não certificar conclusão                         |
| CLI ausente, spawn/sandbox falha, autenticação/quota/rede, crash ou stream de transporte incompatível | Infraestrutura; sem retry automático                                               |
| Coleta/import falha devido ao código/teste submetido, após preflight válido                           | Falha de verificação atribuída à submissão; guardar stdout/stderr, mesmo sem gates |
| Coleta/harness não funciona por ambiente ou artefato confiável defeituoso                             | Infraestrutura; evidência para diagnosticar                                        |
| Cancelamento ou orçamento esgotado                                                                    | Estado próprio, sem inventar resposta ou julgamento                                |

## 4. Isolamento e integridade

Execução real inicial em **Linux/WSL com bubblewrap**, sem fallback para processo desprotegido. Usar cópias privadas; suporte a worktree e outras plataformas fica posterior.

1. Resolver a raiz física e o commit; registrar fingerprints de HEAD, índice, arquivos não ignorados e seus bytes/links. Origem limpa é precondição. Mudança concorrente detectada ao final é infraestrutura; nunca restaurar alterações alheias.
2. Preparar snapshot privado do framework com produção de `src`, configuração/manifestos necessários, scripts de instalação/geração e fonte autoral/assets tasks. Excluir testes, fixtures de solução, evals, documentação de smokes e credenciais da superfície montada ao agente.
3. Materializar dependências privadas ou montá-las somente leitura. Validar links por realpath: nenhum caminho pode alcançar uma área gravável da origem. Fonte do framework, dependências, skills, configuração e propostas ficam somente leitura.
4. Criar tasks pelo gerador dentro do snapshot privado, em subprocesso. Os paths absolutos/links produzidos apontam para esse snapshot. Compile e instalação/check são feitos pelo runner antes do baseline; não mudar o comportamento público do tutorial.
5. Bubblewrap oculta origem, homes globais, expectativas, testes privados e demais diretórios do runner. Expõe runtime/CLI e dependências necessários como somente leitura, home/tmp privados e o workspace atribuído. Não expor sockets do host para escapar do isolamento. Rede é disponível ao CLI para o provedor; não é habilitada no verificador independente.
6. Para perguntas, workspace de contexto é somente leitura. Para implementação, edição permitida é corpo atribuído + arquivo de teste da seção 5; paths auxiliares graváveis só em home/tmp privados. Metadados Git/baseline são controlados pelo runner.
7. Verificações e código submetido também executam sob isolamento, sem credenciais, sem acesso ao checkout/artefatos do runner e com deadline. Uma cópia de verificação recebe os oráculos depois do término do agente; nunca é reaproveitada como workspace de próxima tentativa.

O diretório `--out` deve ser externo à origem e inexistente; criar com exclusividade após validar todos os ancestrais/links. JSON/Markdown são gravados atomicamente. Arquivos de evidência usam paths relativos ao diretório do run. Segredos injetados são removidos dos logs antes de persistir; hashes correspondem aos bytes efetivamente preservados, com indicação de redação. Não registrar valores de ambiente nem chaves em argv.

Não publicar a cópia de dependências/homes como evidência. Preservar manifestos de integridade, contexto/prompts, transcripts saneados, submissões/patches, verificação e metadados suficientes para reprodução. Remover workspaces privados ao terminar, depois de persistir evidências; cancelamento/erro seguem a mesma ordem.

## 5. Benchmark de implementação tasks

Executar os cinco itens, por configuração nova, a partir do tutorial não implementado. Sem testes/solução previamente aplicados ao workspace inicial.

| Item                     | Corpo permitido                                            | Teste permitido                           | Critérios arquivados entregues |
| ------------------------ | ---------------------------------------------------------- | ----------------------------------------- | ------------------------------ |
| `entity:Task`            | `app/domain/task.ts`, `Task.create`                        | `app/test/entity-Task.test.ts`            | `titulo-invalido`, `criacao`   |
| `method:Task.complete`   | mesmo arquivo, `Task.complete`                             | `app/test/method-Task-complete.test.ts`   | `conclusao`                    |
| `usecase:create_task`    | `app/application/create-task.ts`, `CreateTask.execute`     | `app/test/usecase-create_task.test.ts`    | `persistencia-criacao`         |
| `usecase:complete_task`  | `app/application/complete-task.ts`, `CompleteTask.execute` | `app/test/usecase-complete_task.test.ts`  | `persistencia-conclusao`       |
| `operator:task-operator` | nenhum                                                     | `app/test/operator-task-operator.test.ts` | `tools`                        |

Após compile, confirmar a proposta arquivada `0001`, os cinco itens, os slots e as ondas: entidade → método/create use-case → complete use-case → operator. Registrar skills/lock/proposta/config/declarações/testes e hashes originais dos cinco itens a partir de status dinâmico. A suíte inicial vazia é esperada somente na preparação; não certifica done.

Para cada despacho:

1. Obter `next --change 0001 --json` em subprocesso novo. Selecionar item da primeira onda, ainda não terminal no ledger desta avaliação, com dependências aceitas pelo runner e done na consulta dinâmica. Projeção de ondas futuras não autoriza despacho.
2. Na primeira tentativa do item, obter packet integral e conferir seu hash contra o registrado antes de executar agentes. Congelar packet e comando. Entregar raiz/config, corpo/teste permitido, instruções autorais de executor e critérios automáticos da proposta arquivada. `criterion:0001/<id>` não altera o hash do packet: é complemento do handoff, não nova proposta.
3. Capturar resposta, árvore de arquivos e diff, incluindo arquivos novos/apagados/links e testes. Não confiar na lista de arquivos informada pelo agente nem no Git que ele pode ter usado.
4. Auditar estaticamente com TypeScript AST e comparação de bytes fora do corpo selecionado. Preservar imports, assinaturas, decorators, outros corpos, configuração, infraestrutura, propostas e todos os testes já aceitos. Exigir a mesma quantidade de linhas dentro do corpo e coordenadas iguais das declarações. Parsing impossível reprova antes de importar/executar código.
5. Na cópia independente, repetir `verify --item <id> --spec-hash <original> --config agentic.config.ts --json`, por argv construído pelo runner. Capturar código/streams/gates. Rodar também a suíte do executor com JUnit e exigir testes passando que cubram as obrigações e os critérios arquivados entregues. Não permitir que testes do runner preencham cobertura ausente do executor.
6. Rodar somente os oráculos privados pertinentes ao item em processo novo, separado da suíte do executor, importando os módulos da cópia independente. Não carregar testes escritos pelo agente no processo dos oráculos. Cobrir título vazio/espaços, normalização/estado/evento; conclusão/repetição/evento; persistência/publicação/duplicidade; ausência de tarefa; operator com FakeLlm, allowlist e eventos. Não entregar código de teste, solução ou transcript interno dos oráculos ao agente; findings de correção identificam critério e comportamento reprovado.
7. Exigir `compile --check` e igualdade dos gerados contra o baseline. Aceitar somente se protocolo e todos os checks anteriores passarem. Atualizar o baseline aceito com corpo/teste e recalcular next.

Deadline de cada comando confiável de consulta/verificação: **120 segundos**, também subordinado ao orçamento total; erros e duração da verificação aparecem separadamente da duração do agente.

Permitir até **uma correção** de resultado do agente por item. Nova sessão e workspace do último baseline aceito, mesmo packet/hash, patch anterior e findings. Não reaplicar automaticamente o patch; o agente produz a nova submissão. Sem retry de infraestrutura; cancelamento/budget não inicia correção. Registrar sucesso inicial e após correção separadamente.

Após falha final do item, descartar suas alterações do baseline aceito, conservar evidência e tentar branches independentes executáveis. Não redispatchar o item terminal. Quando não houver elegíveis, dependentes de falha são `blocked`; itens não iniciados por infraestrutura/budget/cancelamento conservam o motivo específico.

Ao terminar normalmente, executar `verify 0001` no baseline aceito, sem oráculos incluídos na descoberta da suíte. Guardar relatório mesmo quando failed. Os oráculos já passaram separadamente para itens aceitos. Conclusão integral exige cinco itens aceitos e change `done`; `needs-human` é registrado, nunca convertido em done. Se orçamento/cancelamento impedir a verificação final, ela é indisponível.

## 6. Evidências e métricas

Relatório JSON com `schemaVersion: 1`, Markdown derivado exclusivamente desse JSON, e manifest de artefatos `{ path, sha256, bytes }`. Ordenação estável de registros; timestamps UTC e durações são evidências medidas, não parte dos hashes de especificação/contexto.

| Grupo do relatório | Conteúdo obrigatório                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run                | Identidade, modalidade real/scripted, horários, status `completed                                                                                                           | infra_error | budget_exhausted | cancelled`, orçamento planejado/consumido, checks de origem antes/depois |
| Proveniência       | Commit da fonte e do runner, plataforma, Bun/CLIs, executável, manifesto, dataset e respectivos hashes; modelo solicitado/parâmetros, observado/revisão com disponibilidade |
| Caso de skill      | Dataset/ID/audience, pergunta, expectativa, resposta observada, verdict `correct                                                                                            | incorrect   | malformed        | timeout                                                                  | infra_error | not_run`, motivo, duração, usage e evidências |
| Benchmark          | Cinco itens; packet/hash original, handoff, baseline, submissões, respostas declaradas, tentativas, accepted, motivos, checks, gates e status final da change               |
| Artefatos          | Contexto/prompts, packet, hash original, proposta/declarações iniciais, stdout/stderr/eventos saneados, respostas, patches e resultados independentes com hashes            |

Métrica sem valor usa `Measured<T>` com motivo; nunca zero, string ambígua ou estimativa. Somar tokens/custos somente quando todos os componentes necessários forem informados; custo agregado exige mesma moeda. Componentes conhecidos continuam visíveis mesmo quando o total é indisponível. Não estimar consumo por chars/4 nem aplicar tabela de preços para inventar custos de CLI/assinatura.

### 6.1 Acurácia e conclusão

- Acurácia por configuração, dataset e audience = correct / (correct + incorrect + malformed + timeout). Falha de agente que termina sem resposta protocolar é malformed; infraestrutura e not_run ficam fora desse denominador. Denominador zero torna a métrica indisponível.
- Informar totais planejados, avaliáveis, infraestrutura e não executados; cobertura = avaliáveis / planejados. Nunca apresentar acurácia parcial como se todos os casos tivessem sido avaliados.
- Benchmark: itens aceitos inicialmente / 5, itens aceitos ao final / 5, número de correções e conclusão da change. Esses percentuais são realização observada do benchmark, não acurácia de perguntas; mostrar os motivos dos restantes, inclusive infraestrutura/bloqueio.
- Medir duração do agente, de verificação e do run; uso/duração da correção não substitui a primeira tentativa.

### 6.2 Concordância

Comparar configurações completas, não atribuir diferenças exclusivamente ao modelo. Para cada par, igualdade das respostas estruturadas válidas nos mesmos casos/dataset, por comparação canônica, com numerator/denominator e cobertura. Dois erros iguais podem concordar; ausência de resposta nunca conta como concordância.

Fleiss' κ usa ratings binários **correto/incorreto**, não strings de respostas de perguntas diferentes. `incorrect`, `malformed` e `timeout` recebem rating incorreto. Usar só casos avaliáveis por todas as configurações comparadas, com número fixo de raters ≥2; excluir linhas com infraestrutura/not_run. Para N casos e n raters: `P_i = Σ_j n_ij(n_ij−1)/(n(n−1))`, `P_o = média(P_i)`, `p_j = Σ_i n_ij/(Nn)`, `P_e = Σ_j p_j²`, `κ = (P_o−P_e)/(1−P_e)`. Informar indisponibilidade quando N=0, n<2 ou P_e=1, e a cobertura da matriz usada.

Não aplicar κ às implementações nesta entrega. Não estabelecer threshold de modelo antes da baseline nem declarar significância estatística com cinco perguntas/uma repetição.

## 7. Execução real de referência e orçamento

Uma repetição por configuração, concorrência 1, mesmos inputs/skills e ordem determinística:

| ID                    | Adapter      | Modelo solicitado | Parâmetros                                                        |
| --------------------- | ------------ | ----------------- | ----------------------------------------------------------------- |
| `codex-sol-high`      | `codex-cli`  | `gpt-6.1-sol`     | reasoningEffort `high`                                            |
| `cursor-codex-medium` | `cursor-cli` | `gpt-5.3-codex`   | sem override adicional; rótulo observado registrado separadamente |

| Limite explícito              | Valor                                                                       |
| ----------------------------- | --------------------------------------------------------------------------- |
| `maxInvocations`              | 30 sessões de CLI no run inteiro                                            |
| `skillTimeoutMs`              | 120000                                                                      |
| `implementationTimeoutMs`     | 600000 por tentativa                                                        |
| `totalTimeoutMs`              | 5400000 (90 minutos), desde início do run, incluindo preparação/verificação |
| `maxCorrectionsPerItem`       | 1                                                                           |
| `repetitions` / `concurrency` | 1 / 1                                                                       |

Reservar a sessão no contador antes de spawn, incluindo tentativa de spawn que falha; probe e comandos de verificação não consomem sessões de agente. O deadline total sempre prevalece. Dez perguntas + até vinte tentativas de implementação dão o teto de 30; bloqueios podem consumir menos. Cada CLI pode efetuar várias chamadas internas de inferência. Não afirmar limite monetário ou limite de chamadas internas a partir desse contador.

Dados de disponibilidade coletados sem inferência em 2026-10-08: Bun `1.4.2`, Codex CLI `0.162.0`, Cursor CLI `2026.10.01-e373342`, bubblewrap `0.12.0`; gpt-6.1-sol constava no cache local do Codex e gpt-5.3-codex na lista autenticada do Cursor. Os logins locais estavam disponíveis, mas não foram copiados nem usados para inferência. O probe de bubblewrap ocultando origem/homes passou. Docker não estava operacional no WSL. Esses dados não comprovam acesso futuro aos modelos com outra credencial nem funcionamento completo dos CLIs dentro do sandbox.

O preflight real confere credenciais externas, modelos solicitados, CLIs/capacidades, sandbox e integridade. Ausência/incompatibilidade deixa o aceite externo pendente, sem fallback de modelo ou saída simulada. Atualizar versões observadas no relatório real; não reutilizar as versões de planejamento como medições.

Publicar uma comparação real e seus artefatos revisados em `docs/superpowers/validation/<data-real>-plan6.md` e pasta homônima. Preservar o relatório completo de tentativas, inclusive falhas. Falha comportamental de modelo é uma baseline válida; infraestrutura que impede a avaliação de uma configuração não satisfaz comparação de duas configurações. Toda omissão de evidência é identificada; não substituir esta referência pelos smokes ou fakes do Plano 5.

## 8. Aceite e dependências

- Testes offline cobrem exact/tool_call, agente errado/malformado, timeout/cancelamento, falha de processo/infraestrutura, orçamento, métricas indisponíveis, integridade de contexto e origem.
- Benchmark offline percorre os cinco itens e verify change; rejeita hash divergente, alteração fora do corpo, source deslocado, gerados editados, cobertura insuficiente e comportamento incorreto apesar de testes verdes do executor.
- CI padrão executa somente scripted, sem credenciais/CLIs reais. Instalar/verificar bubblewrap no job Linux e executar teste real de isolamento com processo roteirizado; indisponibilidade não pode ser silenciosamente ignorada. Não contornar com execução desprotegida.
- `bun test`, `bun run typecheck`, `bun run lint`, `bun run build`, `bun run agentic compile --check` passam; nenhuma alteração de API pública ou do domínio orders é necessária.
- Referência real compara pelo menos duas configurações, com evidência e orçamento explícito. Sem execução real, este aceite permanece pendente mesmo com CI verde.

Dependências: Plano 5 concluído; Bun/dependências do checkout; Linux/WSL com bubblewrap para execução isolada; CLI e credenciais externas para referência. Planos 7–8 não são dependências.

Na preparação desta spec passaram 12 testes direcionados (`test/evals.test.ts` e `test/architecture.test.ts`) e compile --check. Isso valida a base consultada, não é resultado do runner futuro. Nenhuma chamada de inferência foi feita nesta sessão.

## Refinamento de execução aprovado — 2026-10-09

O usuário aprovou autenticação pelos logins locais em homes isolados, pois as variáveis de API estavam ausentes. Cada configuração aceita `authentication: "api-key" | "local-login"`; ausência conserva `api-key`, sem fallback. A referência explicita `local-login`. Copiar somente os campos de autenticação de `~/.codex/auth.json` ou `~/.config/cursor/auth.json` para uma nova sessão privada (diretórios 0700, arquivo 0600), sem configurações/hooks/MCP/plugins. Remover a cópia após colher metadados, sem alterar o arquivo original nem sincronizar refresh de volta. Registrar o modo no manifesto e sanear os valores das credenciais também nos patches e relatórios antes dos hashes. Essa alteração não muda o orçamento operacional de 30 sessões/90 minutos nem autoriza estimativas de custo.

## Fronteira dos CLIs nativos esclarecida pela revisão — 2026-10-09

Os adapters iniciais servem somente fonte/skills/packets/datasets confiáveis. O CLI exige reconhecimento explícito `--trusted-source` junto de `--real`; a API do runner exige `trustedSource: true`, antes de preparar arquivos ou iniciar autenticação/processos. Ferramentas nativas compartilham credenciais e rede do host com o CLI. Bubblewrap protege o checkout e oculta homes globais, sem separar autenticação das ferramentas nem impedir exfiltração via rede diante de prompt injection. O reconhecimento não detecta conteúdo malicioso. Um broker com ferramentas sem rede/credenciais requer redesenhar os adapters; Planos 7–8 não entram nesta entrega.

Novos relatórios reais registram essa fronteira em `provenance.nativeToolAccess`, com sourceTrustAcknowledged=true, credentials=accessible e network=host, também descrita no Markdown. O campo é opcional para compatibilidade com evidências históricas; ausência em relatórios antigos não certifica reconhecimento ou isolamento de credenciais. Verificação independente permanece sem rede/credenciais.

JUnit pós-processo é lido somente por descritor O_NOFOLLOW/O_NONBLOCK, após validar arquivo regular, ancestrais privados e limite de 8 MiB; a leitura também tem limite de bytes, sem confiar apenas em stat. Metadados opcionais de sessão Codex têm limite de 1 MiB por arquivo, 64 entradas e 8 MiB agregados, sem seguir links/dirs externos. Rejeição de JUnit impede certificação; metadados inseguros/excessivos ficam explicitamente indisponíveis. A referência original continua associada ao runner observado, sem alteração retroativa ou novo run pago.

A auditoria materializa no máximo 256 KiB por arquivo, 1024 entradas e 4 MiB de conteúdo por árvore. Verifica tamanhos antes de ler, limita descritores e enumera diretórios de forma limitada, sem seguir links. O patch serializado tem teto de 8 MiB; ao ultrapassar limites, registra violação e não retém conteúdo excessivo. Esses limites também protegem a inspeção final da cópia verificadora; efeitos excessivos do código submetido reprovam a submissão, sem fingir erro de processo do runner.

Os oráculos são privados em relação ao contexto fornecido ao agente antes da implementação. Executam depois em outra cópia, mas o código submetido pode observar o ambiente de execução, incluindo argv/stack com o caminho do teste. As verificações certificam comportamento nos casos executados, sem provar correção em todos os ambientes nem resistência a um solver que detecta e manipula a avaliação. Não afirmar que os oráculos são invisíveis ao código em execução. Resistência adversarial e um harness com outra fronteira de execução exigem refinamento próprio, fora deste benchmark inicial.
