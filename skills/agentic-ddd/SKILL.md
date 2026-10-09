---
name: agentic-ddd
description: "Declare domínios com decorators do framework agentic-ddd e coordene gerente/executor por propostas, ondas, packets e verificação. Use ao desenvolver módulos ou implementar itens atribuídos neste framework."
---

Use o código decorado como fonte da especificação. Leia `agentic.config.ts` (ou a configuração informada) e a skill gerada do módulo para caminhos, regras e contratos particulares. Esta skill é autoral e compartilhada; as skills `<módulo>-dev` e as skills de runtime são geradas pelo compilador.

Carregue somente as referências necessárias:

- [Autoria](references/authoring.md): declarar ou alterar domínio, schemas e propostas.
- [Gerente](references/manager.md): preparar contratos e coordenar execução sequencial.
- [Executor](references/executor.md): executar um packet sem mudar a especificação.
- [Instalação](references/installation.md): instalar/verificar links e adaptadores locais ou globais.
- [Tutorial](references/tutorial.md): praticar em um workspace tasks isolado.

Preserve IDs estáveis de invariantes e contratos públicos. Não edite artefatos gerados; altere a fonte decorada e compile. Corpo pendente usa a chamada literal `notImplemented()`. Testes usam `covers` com IDs reais e verificam comportamento.

Ao implementar corpos, preserve as linhas das declarações seguintes usando o espaço preparado no esqueleto: o compilador atual inclui coordenadas de fonte nos gerados. Sem espaço suficiente, devolva ao gerente para preparar/recompilar antes de redispatchar.

Um item exige `verify --item` com o hash original e resultado `done`. A change termina com `verify NNNN`: `done` conclui, `needs-human` expõe aceite manual pendente. Consulta estática nunca certifica `done`. Não confunda sucesso de `compile` (aplica/arquiva declarações) com implementação concluída.
