# Distribuição do framework — issue #13

Objetivo: instalar um tarball npm em uma aplicação externa, importar as seis fronteiras, compilar TypeScript, gerar skills e executar um operator com injeção Nest sem paths locais.

## Decisões

- Pacote ESM único; nome provisório `nestjs-agentic-ddd-architecture`, versão 0.1.0. Publicação permanece bloqueada por private: true e prepublishOnly até nome, disponibilidade e permissões serem validados pelo mantenedor.
- Exports explícitos de core (também raiz), decorators, compiler, runtime, nestjs e testing. Sem export wildcard de internals.
- Build TypeScript modular com declarations e source maps contendo o código fonte. Reescrever somente os specifiers emitidos: aliases internos viram self references públicas, imports relativos recebem extensão .js. Não criar bundles independentes que dupliquem registry ou tokens DI.
- `bin/agentic-ddd.js` usa shebang Bun e chama main da CLI. O compilador e a CLI exigem Bun 1.4.2; não prometer suporte Node do framework inteiro.
- Dependências do exemplo não devem ser necessárias à biblioteca. TypeScript é dependência runtime do compilador; Nest/reflect-metadata/rxjs são peers compartilhados com o consumidor.
- Allowlist de distribuição: dist das fronteiras/contracts/CLI, bin, README, LICENSE, CHANGELOG e guia de distribuição. Não publicar main/app.module do exemplo, testes, snapshots, fixtures, evidências, configs locais ou credenciais.
- Preservar build/start do exemplo em comando próprio. Não modificar declarações de negócio ou hashes do exemplo.

## Validação

Smoke reproduzível cria projeto em diretório temporário fora do checkout, instala npm pack com npm, usa tsconfig sem paths e skipLibCheck false, importa todas as fronteiras, testa registry compartilhado e DI por provider, executa compile/check pela CLI instalada e compara hash/localização em execução fonte e bundle com map.

Auditar conteúdo real do tarball por allowlist e scan de segredos/caminhos absolutos, incluindo sourcesContent dos maps. Testar bloqueio de imports privados e publicação. Executar suite, typecheck, lint, build e compile --check; registrar incompatibilidades reais separadamente.
