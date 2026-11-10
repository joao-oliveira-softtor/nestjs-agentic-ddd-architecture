# Usar o framework em outra aplicação

A distribuição é um pacote ESM único, publicado no npm como [`agentic-ddd`](https://www.npmjs.com/package/agentic-ddd), com oito fronteiras. Até a v0.5.0 ele se chamava `nestjs-agentic-ddd-architecture` e só saía como tarball da release GitHub; quem instalou assim troca os imports `nestjs-agentic-ddd-architecture/*` por `agentic-ddd/*`.

## Compatibilidade

- Bun 1.4.4 é o runtime usado na validação (CI em Linux e Windows); o mínimo declarado em `engines` segue 1.4.2. Compiler/CLI dependem de Bun.Glob, Bun.spawn e Bun.YAML.
- Nest 12, reflect-metadata 0.2 e rxjs 7 são peers e devem ser compartilhados com a aplicação.
- Zod 4 e TypeScript 6 são dependências runtime: o compilador usa a API de TypeScript para evidências estáticas.
- Os imports ESM e declarações são validados com resolução TypeScript NodeNext e bundler, sem paths e com skipLibCheck false. Isso não certifica execução do framework inteiro em Node.
- CommonJS não tem export require nesta versão.
- Os source maps são distribuídos com sourcesContent e caminhos relativos. Mantenha maps ao empacotar o consumidor: o IR inclui localização original das declarações e o runtime valida o hash da skill.

Cada release GitHub a partir da v0.6.0 também traz o tarball publicado e o `SHA256SUMS`.

## Instalação

```bash
# Na aplicação consumidora:
npm install agentic-ddd @nestjs/common@^12 @nestjs/core@^12 reflect-metadata@^0.2.2 rxjs@^7.8.1 zod@^4
```

Para testar um checkout local sem publicar, gere o tarball com `npm pack` neste repositório e instale o `agentic-ddd-<versão>.tgz` no lugar do nome.

Não adicione paths de `@agentic-ddd/*` ao tsconfig do consumidor. Esses aliases são exclusivamente do desenvolvimento deste checkout.

| Import público           | Conteúdo                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `agentic-ddd/core`       | Building blocks DDD; a raiz também exporta apenas core                                                 |
| `agentic-ddd/decorators` | Declarações e registry compartilhado                                                                   |
| `agentic-ddd/compiler`   | Configuração, IR, geração, verificação e coordenação                                                   |
| `agentic-ddd/runtime`    | OperatorRuntime, ports, tipos e event bus                                                              |
| `agentic-ddd/nestjs`     | AgenticModule e tokens de DI                                                                           |
| `agentic-ddd/testing`    | covers, context e fakes; não exige bun:test                                                            |
| `agentic-ddd/mcp`        | Servidor MCP local (stdio), somente leitura; requer o peer opcional @modelcontextprotocol/server 2.3.1 |
| `agentic-ddd/elysia`     | Plugin `agentic()` e rotas de use-case tipadas para Eden; requer o peer opcional `elysia` ^1.4.30      |

A aplicação fornece agentic.config.ts com defineConfig do export compiler, decorators nas classes e imports de AgenticModule.forRoot/forFeature. O exemplo isolado completo está em test/fixtures/package-consumer.

```bash
# Na aplicação, com Bun no PATH:
./node_modules/.bin/agentic-ddd compile
./node_modules/.bin/agentic-ddd compile --check
```

CLI e compilador interpretam os caminhos a partir do config do consumidor. As instruções geradas usam o nome público do pacote. Imports privados de dist não são parte da API.

## Servidor MCP local

MCP é o protocolo que deixa um agente chamar ferramentas externas. O servidor local deste pacote roda por stdio (o cliente o inicia como processo e conversa pela entrada e saída padrão) e expõe seis ferramentas de leitura (as cinco primeiras sobre o domínio compilado, a última sobre o guia de autoria):

- `domain_overview`: lista módulos, entidades, use-cases e operators.
- `domain_element`: devolve o contrato de um elemento pelo id.
- `domain_changes`: lista as mudanças de regra de negócio, ou só as de um id.
- `rules_for_path`: lista as regras do time que valem para um arquivo (caminho relativo à raiz do projeto, ou absoluto dentro dela). Uma token restrita a módulos só recebe resposta para caminhos dentro de um módulo permitido; fora deles, `mcp.path-out-of-scope`.
- `domain_source`: informa `{mode, version?, digest?}`, isto é, a versão e o digest do lock publicado, ou `working-copy`. De propósito não passa pela checagem de frescor do snapshot; por HTTP basta qualquer token aceito pelo gate (`domain:read` ou `skill:read`, também com sufixo de módulo), e ela só devolve modo, versão e digest, nenhum dado de módulo.
- `authoring_guide`: devolve o guia de autoria. Sem argumento, o índice (a skill `agentic-ddd`, a dev skill de cada módulo legível e as regras do time, com URI, título, finalidade e tamanho); com `doc` (URI `skill://…` ou nome curto como `orders-dev`), o documento. Documento desconhecido ou fora do escopo dá `mcp.doc-unknown`, igual nos dois casos; uma token sem `skill:read` recebe `auth.scope-missing` dizendo que esse escopo é necessário. A skill de autoria sai do pacote instalado, é lida uma vez por servidor (uma vez por processo com `--http`) e não depende do snapshot (funciona antes do primeiro `compile`; as dev skills e as regras continuam pedindo o snapshot ou o lock publicado) e não entra no digest do lock publicado. Os mesmos documentos saem como recursos MCP: `skill://agentic-ddd/SKILL.md`, `skill://agentic-ddd/references/<arquivo>.md`, `skill://<módulo>-dev/SKILL.md` (e `references/`) e `skill://agentic-ddd/rules/<regra>.md`, em `text/markdown`. Por HTTP exige o escopo `skill:read` (todos os módulos) ou `skill:read:<módulo>` (só a dev skill desse módulo e as regras do time, com os globs cortados aos que não citam nome nem caminho de módulo oculto, com chaves `{a,b}` expandidas); uma token com `skill:read` e sem `domain:read` lê só esses documentos, nenhum dado de domínio. As skills de runtime nunca são servidas. O stdio local vê tudo.

O servidor não executa código do projeto e não escreve arquivos. Ele lê `.agentic/domain.lock.json` e o snapshot `.agentic/mcp/snapshot.json`, que o `compile` grava quando termina bem (a pasta do snapshot ignora a si mesma no git). Cada chamada revalida o snapshot (com `--http`, chamadas simultâneas compartilham uma mesma checagem): se código, regras, config ou lock mudaram desde o último `compile` bem-sucedido, o servidor recusa responder e pede para rodar `compile` de novo. Sem snapshot na pasta do servidor, a recusa mostra onde ele procurou: abra o agente na raiz do projeto ou passe `--root`. Limite: arquivos importados de fora das pastas dos módulos não entram nessa checagem.

Na aplicação consumidora, instale o peer opcional e inicie o servidor:

```bash
npm install @modelcontextprotocol/server@2.3.1
./node_modules/.bin/agentic-ddd mcp [--root <dir>] [--config <file>] [--published <file> [--expect-digest <sha256>]] [--http [--port <n>] [--host <addr>]]
./node_modules/.bin/agentic-ddd publish-lock --version <v> --out <file> [--root <dir>]
```

Sem `--root`, o servidor usa a pasta atual. Sem o peer, o comando encerra com código 1 e uma mensagem pedindo a instalação.

Com `--http`, o servidor fala Streamable HTTP (porta 3333 por padrão) como resource server OAuth: lê a seção `mcp` (`issuer`, `resource`, `jwksUri` opcional) do `agentic.config.ts`, publica o Protected Resource Metadata (RFC 9728) e exige um token Bearer JWT com `aud` igual a `resource` e o escopo `domain:read` (todos os módulos; `skill:read` também basta para alcançar o servidor, mas só abre o `authoring_guide`) ou `domain:read:<módulo>` (só o módulo indicado, podendo repetir o escopo para vários módulos), sem o qual a requisição recebe 403 `auth.scope-missing`. Um token só com escopos de módulo lê apenas esses módulos. Um token aceito pelo gate mas sem `domain:read` (só `skill:read` ou `change:*`) recebe `auth.scope-missing` de `domain_overview`, `domain_element`, `domain_changes` e `rules_for_path`, sem que o projeto seja lido. O servidor de autorização é externo; este pacote só valida os tokens. Além do peer do SDK, exige o pacote `jose` instalado (`cli.jose-missing` se faltar). Por padrão escuta só em `127.0.0.1`; `--host` muda isso. Antes da autenticação, `Host` e `Origin` são validados (defesa contra DNS rebinding): `Host` deve ser `host:porta` do bind ou do `resource` (e, em bind de loopback, `localhost`, `127.0.0.1` ou `[::1]` com a porta efetiva); `Origin`, quando presente, deve ser a origem do bind ou do `resource` (ou o equivalente loopback). Sem `Origin` (cliente não navegador) a requisição passa; valores fora da lista recebem 403 com `mcp.host-denied` ou `mcp.origin-denied`. O endpoint e o metadata aceitam o caminho com ou sem barra final.

Com `--published <file>` (e `--expect-digest <sha256>` para fixar o digest), o servidor responde a partir de um lock publicado antes com `agentic-ddd publish-lock --version <v> --out <file>`, em vez da cópia de trabalho. Esse lock é imutável e não toca o disco, então serve uma versão fixa do domínio; o funcionamento, os limites de segurança e a demo local estão em [`docs/mcp-remote-demo.md`](mcp-remote-demo.md).

A partir deste checkout, o instalador grava a configuração do servidor para cada agente. É opt-in e só vale com `--scope project`:

```bash
bun run skills:install --mcp --scope project --root <projeto>
```

Os trechos abaixo são os que o instalador gera. `<CLI>` é o caminho relativo, a partir do projeto, até `src/cli/main.ts` deste checkout. Se o arquivo já existe com outro conteúdo, o instalador recusa substituí-lo: mescle o trecho à mão.

- Claude Code, `.mcp.json`:

  ```json
  {
    "mcpServers": {
      "agentic-ddd": { "command": "bun", "args": ["<CLI>", "mcp"] }
    }
  }
  ```

- Cursor, `.cursor/mcp.json`:

  ```json
  {
    "mcpServers": {
      "agentic-ddd": { "command": "bun", "args": ["<CLI>", "mcp"] }
    }
  }
  ```

- Codex, `.codex/config.toml`:

  ```toml
  [mcp_servers.agentic-ddd]
  command = "bun"
  args = ["<CLI>", "mcp"]
  ```

Notas por cliente:

- Claude Code pede aprovação para servidores do `.mcp.json` do projeto. Como o trecho não passa `--root`, o servidor usa a pasta em que o Claude Code foi aberto.
- Codex só lê `.codex/config.toml` de projeto marcado como confiável. Também não passa `--root`, então deve ser iniciado na raiz do projeto.
- Cursor: mesmo formato do Claude Code, porque o `cursor-agent` não expande `${workspaceFolder}`. O servidor usa a pasta em que o Cursor foi aberto, e ele também pede aprovação para servidores do projeto.

## Build e verificação

`bun run build` limpa dist e emite a biblioteca/CLI modular, declarações e maps. `bun run build:app` gera a aplicação demonstrativa dist/main.js; ela não entra no tarball. `start:prod` requer build:app.

`bun run test:package` faz npm pack (com prepack build), extrai e audita o tarball real, instala-o com npm em uma pasta temporária fora do checkout, compila as declarações em dois modos e executa geração/check de skills, operator com DI e bundle com source map. O bundle usa Bun.build com root/outdir explícitos (evitando deslocamento de paths observado na CLI de build 1.4.2). O teste remove NODE_PATH, verifica exports privados bloqueados e compara hash/localizações/resultados entre fonte e bundle. Limpa o consumidor e o tarball ao finalizar.

A allowlist exclui testes, fixtures, snapshots, configurações, avaliações, node_modules e a aplicação de exemplo. A auditoria adicional procura padrões de credenciais e caminhos locais absolutos, incluindo o conteúdo embutido dos maps; ela é uma defesa contra vazamentos acidentais, não um scanner universal de segredos.

## Publicação

Não há workflow de publicação automática: quem publica é o mantenedor, a partir da `main` com o CI verde.

1. Na PR de release: versão no `package.json` e no servidor MCP (`src/mcp/index.ts`), `CHANGELOG.md`, `docs/releases/<versão>.md` e a linha "Release atual" do README.
2. Depois do merge, na `main` atualizada: `bun install --frozen-lockfile` e `bun run test:package`, que constrói, empacota, audita e instala o tarball real.
3. `npm pack` (o `prepack` gera o `dist` de novo) e `sha256sum agentic-ddd-<versão>.tgz > SHA256SUMS`: o `test:package` apaga o tarball que auditou, e o `npm publish` sem argumento não deixa nenhum.
4. `npm publish agentic-ddd-<versão>.tgz`, que publica exatamente esse tarball (o npm pede a senha de uso único quando a conta tem 2FA).
5. Tag `v<versão>` e release GitHub com o mesmo tarball e o `SHA256SUMS`.
