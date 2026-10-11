# Usar o framework em outra aplicação

A distribuição usa um pacote ESM único com seis fronteiras. O nome `nestjs-agentic-ddd-architecture` é provisório para testar tarballs locais; não foi validado para publicação. `private: true` bloqueia inclusive a publicação direta do tarball; `prepublishOnly` fornece um segundo gate no checkout. Pacotes privados ainda permitem npm pack e instalação local. Esta mudança não publica nem cria uma nova release npm.

## Compatibilidade

- Bun 1.4.2 é o runtime usado na validação; compiler/CLI dependem de Bun.Glob, Bun.spawn e Bun.YAML.
- Nest 12, reflect-metadata 0.2 e rxjs 7 são peers e devem ser compartilhados com a aplicação.
- Zod 4 e TypeScript 6 são dependências runtime: o compilador usa a API de TypeScript para evidências estáticas.
- Os imports ESM e declarações são validados com resolução TypeScript NodeNext e bundler, sem paths e com skipLibCheck false. Isso não certifica execução do framework inteiro em Node.
- CommonJS não tem export require nesta versão.
- Os source maps são distribuídos com sourcesContent e caminhos relativos. Mantenha maps ao empacotar o consumidor: o IR inclui localização original das declarações e o runtime valida o hash da skill.

O tarball v0.4.0 também é disponibilizado como asset da [release GitHub](https://github.com/joao-oliveira-softtor/nestjs-agentic-ddd-architecture/releases/tag/v0.4.0), com SHA-256 e logs de validação.

## Instalação local

```bash
bun install --frozen-lockfile
npm pack
# Na aplicação consumidora:
npm install ../framework/nestjs-agentic-ddd-architecture-0.4.0.tgz @nestjs/common@^12 @nestjs/core@^12 reflect-metadata@^0.2.2 rxjs@^7.8.1 zod@^4
```

Não adicione paths de `@agentic-ddd/*` ao tsconfig do consumidor. Esses aliases são exclusivamente do desenvolvimento deste checkout.

| Import público | Conteúdo |
| --- | --- |
| `nestjs-agentic-ddd-architecture/core` | Building blocks DDD; a raiz também exporta apenas core |
| `nestjs-agentic-ddd-architecture/decorators` | Declarações e registry compartilhado |
| `nestjs-agentic-ddd-architecture/compiler` | Configuração, IR, geração, verificação e coordenação |
| `nestjs-agentic-ddd-architecture/runtime` | OperatorRuntime, ports, tipos e event bus |
| `nestjs-agentic-ddd-architecture/nestjs` | AgenticModule e tokens de DI |
| `nestjs-agentic-ddd-architecture/testing` | covers, context e fakes; não exige bun:test |

A aplicação fornece agentic.config.ts com defineConfig do export compiler, decorators nas classes e imports de AgenticModule.forRoot/forFeature. O exemplo isolado completo está em test/fixtures/package-consumer.

```bash
# Na aplicação, com Bun no PATH:
./node_modules/.bin/agentic-ddd compile
./node_modules/.bin/agentic-ddd compile --check
```

CLI e compilador interpretam os caminhos a partir do config do consumidor. As instruções geradas usam o nome público do pacote. Imports privados de dist não são parte da API.

## Build e verificação

`bun run build` limpa dist e emite a biblioteca/CLI modular, declarações e maps. `bun run build:app` gera a aplicação demonstrativa dist/main.js; ela não entra no tarball. `start:prod` requer build:app.

`bun run test:package` faz npm pack (com prepack build), extrai e audita o tarball real, instala-o com npm em uma pasta temporária fora do checkout, compila as declarações em dois modos e executa geração/check de skills, operator com DI e bundle com source map. O bundle usa Bun.build com root/outdir explícitos (evitando deslocamento de paths observado na CLI de build 1.4.2). O teste remove NODE_PATH, verifica exports privados bloqueados e compara hash/localizações/resultados entre fonte e bundle. Limpa o consumidor e o tarball ao finalizar.

A allowlist exclui testes, fixtures, snapshots, configurações, avaliações, node_modules e a aplicação de exemplo. A auditoria adicional procura padrões de credenciais e caminhos locais absolutos, incluindo o conteúdo embutido dos maps; ela é uma defesa contra vazamentos acidentais, não um scanner universal de segredos.

## Publicação futura

1. Confirmar o nome definitivo, consultar disponibilidade no registry e validar o dono/organização e permissões de publicação (incluindo 2FA/trusted publishing).
2. Se o nome mudar, atualizar metadados e os imports da fixture/documentação. O build deriva os specifiers emitidos do package.json.name.
3. Definir versão, changelog, licença e access do pacote scoped quando aplicável.
4. Executar install frozen, typecheck, lint, suite, build e test:package no ambiente suportado; verificar o CI e revisar o conteúdo do tarball.
5. Alterar private para false e remover deliberadamente o gate prepublishOnly após aprovação do mantenedor e publicar o artefato validado. Não há workflow de publicação automática nesta mudança.
