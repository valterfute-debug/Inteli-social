# Relatório de validação técnica

Data da execução: 2026-10-23, revalidada em 2026-10-24 sobre a `main` com a branch `fix/ajustes-reuniao-ampara` (commit `012e176`). A CI do PR #10 passou nesse commit, inclusive o e2e de backup no Linux. As alterações estão descritas em `decisoes-pendentes.md`.

## Resumo

**Passaram por execução:** `npm ci`, `prisma generate`, `prisma validate`, lint, typecheck, build, `openapi:validate`, **197 testes unitários**, **89 testes e2e com PostgreSQL 16.9 real** (exceto o de backup, que a CI roda no Linux), as 17 migrations do zero, a migração de **contas legadas fictícias**, três cenários de dados da migration da onça e a comparação banco × schema (`migrate diff`, sem diferença).

**Reprovado, por causa do ambiente:** o e2e de backup/restauração no Windows (teste escrito para Linux). Na CI (Linux) ele passou.

**Não executado / não verificável aqui:** o e2e de backup em Linux/CI; qualquer teste de interface e o fluxo offline (não existem); o frontend institucional publicado (código fora deste repositório); a aplicação das migrations em um banco real (proibida e sem cópia disponível). `npm audit --omit=dev` encontrou 0 vulnerabilidades.

**Prontidão para merge:** pronta para revisão. Para publicar: rodar o e2e de backup na CI, testar a migration numa **cópia** do banco real com backup verificável e coordenar a publicação com o frontend já publicado (INC-39).

## Ambiente

| Item       | Esperado pelo projeto                                    | Usado nesta execução                                                                                                            |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Sistema    | —                                                        | Windows 11 Pro 10.0.26200                                                                                                       |
| Node.js    | `>=24` (`package.json` `engines`; CI `node-version: 24`) | v24.22.1 (zip oficial de nodejs.org, SHA-256 conferido), **portátil**, em `AppData\Local\ampara-tools`                          |
| npm        | com `package-lock.json`                                  | 11.19.1                                                                                                                         |
| Prisma     | 6.19.3 (lockfile)                                        | 6.19.3                                                                                                                          |
| PostgreSQL | 16 (CI `postgres:16-alpine`)                             | 16.9, binários da EDB (sem assinatura digital; domínio oficial por HTTPS), **portátil**, `127.0.0.1:54329`, cluster descartável |
| Docker     | opcional                                                 | **Não usado** (o Docker Desktop exige administrador, WSL2 e reinício; não viável neste modo)                                    |

Nada foi instalado globalmente nem alterado no PATH, no registro ou em serviços. Todos os bancos usados são locais e descartáveis (`ampara_*`), com dados fictícios e sem credenciais reais. O cluster foi encerrado ao final.

## Comandos e resultados (execução final, depois de todas as alterações)

| Verificação               | Comando                                                                                  | Resultado                                                                                                                                                                    | Duração |
| ------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Instalação reproduzível   | `npm ci`                                                                                 | **Aprovado por execução** (`package-lock.json` inalterado)                                                                                                                   | —       |
| Prisma Client             | `npm run prisma:generate`                                                                | **Aprovado**                                                                                                                                                                 | 4 s     |
| Schema                    | `npm run prisma:validate`                                                                | **Aprovado**                                                                                                                                                                 | 4 s     |
| Lint                      | `npm run lint`                                                                           | **Aprovado** (0 erros)                                                                                                                                                       | 3 s     |
| Typecheck                 | `npm run typecheck`                                                                      | **Aprovado**                                                                                                                                                                 | 3 s     |
| Testes unitários          | `npx jest --runInBand`                                                                   | **Aprovado: 17 suítes, 197/197**                                                                                                                                             | 22 s    |
| OpenAPI                   | `npm run openapi:validate`                                                               | **Aprovado** (28 operações, lista do validador conferida)                                                                                                                    | 2 s     |
| Build                     | `npm run build`                                                                          | **Aprovado**                                                                                                                                                                 | 12 s    |
| e2e (sem backup)          | `jest --config jest.e2e.config.cjs --runInBand --testPathIgnorePatterns backup.e2e-spec` | **Aprovado: 8 suítes, 89/89**, banco com as 17 migrations do zero                                                                                                            | 40 s    |
| e2e de backup             | `test/e2e/backup.e2e-spec.ts`                                                            | **Reprovado — ambiente** (ver abaixo)                                                                                                                                        | —       |
| Banco × schema            | `prisma migrate diff --from-url … --to-schema-datamodel …`                               | **Aprovado**: "No difference detected" (banco novo e banco migrado de contas legadas)                                                                                        | —       |
| Formatação                | `prettier --check --end-of-line auto` em `src`, `test`, `prisma`, `docs`                 | **Aprovado**                                                                                                                                                                 | —       |
| `npm run format` (padrão) | `prettier --check`                                                                       | **Reprovado — ambiental**: os arquivos do Windows estão em CRLF (`core.autocrlf=true`) e o Prettier espera LF. A CI não executa `format`                                     | —       |
| Dependências              | `npm audit --omit=dev`                                                                   | **Aprovado: 0 vulnerabilidades** (a primeira tentativa, dentro da rotina automática, ficou pendurada no endpoint de advisories e foi abortada; a repetição isolada concluiu) | 2 s     |

### e2e de backup (reprovado)

`test/e2e/backup.e2e-spec.ts` (preexistente em `main`) foi escrito para Linux: o `bindir` padrão é `/usr/lib/postgresql/16/bin` e ele inicia o próprio PostgreSQL com `pg_ctl` e pipes. No Windows o `pg_ctl` trava com pipes herdados e o teste estoura por timeout; o servidor chegou a subir. Sem evidência de defeito do produto. **Não corrigi o teste.** Pendente: executar no Linux/CI. Não afirmo que o backup foi validado.

### Dependências (`npm audit --omit=dev`)

`npm audit --omit=dev` (o mesmo comando da CI): **found 0 vulnerabilities**. Nenhuma dependência foi atualizada nem alterada.

## Migrations

Ordem: `20261022120000_cadastro_sem_localizacao_e_onca`, `20261022130000_prontuario_clinico`, `20261023120000_perfis_removidos_e_movimentacao_animal`. Banco: PostgreSQL 16.9 portátil, loopback, descartável; URL conferida antes de cada execução, credenciais não impressas.

| Verificação                                                                                 | Resultado                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 15 migrations em banco vazio                                                                | Aprovado (e2e roda sobre esse banco)                                                                                                                                                                                                                                                                                                                                     |
| Estado do commit anterior (14 migrations) com **contas legadas fictícias** → nova migration | Aprovado: 5 contas (administrador, operadores com um e com vários vínculos, sem vínculo, desativado) preservadas; `ativo` igual; 3 animais (1 arquivado), 1 foto e 1 chave de idempotência intactos; `papel`, `UsuarioUnidade` e `PapelUsuario` removidos; consulta do guard: as 4 contas ativas acessam (inclusive a que não tinha unidades), a desativada continua 403 |
| `MovimentacaoAnimal`                                                                        | Tabela criada vazia (animais anteriores começam sem linha do tempo); RLS ligada; FKs `RESTRICT` (corrigido o schema após o `migrate diff`, INC-38)                                                                                                                                                                                                                       |
| Onça — cenário A (dados antigos), C ("Onça" ativa pré-existente), B ("Onça" arquivada)      | Aprovado: A e C movem os animais com `version` 1→2 e preservam as localizações; B **aborta sem alterar nada** (falha fechada)                                                                                                                                                                                                                                            |
| Idempotência do SQL da migration `…120000`                                                  | Aprovado (reaplicada em cópia: sem erro, sem novo `version`)                                                                                                                                                                                                                                                                                                             |
| Integridade (13 verificações em SQL)                                                        | Aprovado: FK composta de localização, FK composta de raça, índice parcial de admissão, `RESTRICT`, RLS                                                                                                                                                                                                                                                                   |

**Riscos e verificações que faltam**

- A migration `20261023120000_…` **remove informação de forma irreversível** (papel e vínculos de unidade). **Faça backup verificável e teste numa cópia do banco real antes de aplicar.**
- Há um frontend publicado que pode depender de `papel`/`unidades` no `/me` (INC-39). Coordenar a publicação.
- Não foram testados volume nem dados de produção.
- `prisma migrate dev` (shadow database) falha numa migration já existente em `main` (INC-25); `migrate deploy` funciona.

## Testes de segurança, autorização e privacidade (executados)

Dados fictícios, HTTP real e banco real:

- **Acesso igual** (`acesso-igualitario.e2e-spec.ts`): duas contas quaisquer cadastram, listam, consultam, editam, transferem de unidade, registram evento e atendimento, geram PDF, consultam a auditoria, editam responsáveis e arquivam; uma conta continua vendo o animal depois que a outra o transfere. Sem token → 401; conta sem liberação ou desativada → 403. O banco não tem mais coluna `papel`, tabela `UsuarioUnidade` nem tipo `PapelUsuario`.
- **Autoria de foto** (regra independente de perfil): outra conta não confirma, reaproveita nem vincula a foto → 403.
- **Privacidade:** a auditoria de responsável, atendimento e `observacoes` do animal não contém e-mail, endereço, texto clínico nem o texto livre; respostas sem cache; erros 5xx sem stack trace.
- **Idempotência e concorrência:** três admissões simultâneas resultam em uma só; dois `PATCH` simultâneos com a mesma versão resultam em 200 e 409; mesma chave em paralelo cria um só atendimento; mesma chave em outro animal ou com outro conteúdo → 409.
- **Contrato:** `localizacaoId` e outros campos desconhecidos → 400; `null` em campo obrigatório → 400.

## Fluxo de animais (executado)

`fluxo-entre-areas.e2e-spec.ts` (18 testes): microchip como texto (zeros e 20 dígitos), duplicado → 409 com o animal existente; silvestres (nome, nomes repetidos, microchip permitido, unidade "Mantenedor"); passagem CED → CasAdote → CCPA no mesmo cadastro (identidade, `versao`, um só animal por microchip, atendimentos ligados); voltar a CED/CCPA sem dados → 400 sem alterar nada; linha do tempo (entrada e passagens, usuário, arquivamento, 404/401, sem escrita pela API).

## Correções feitas durante a validação

| Achado                                                                          | Origem                      | Correção                                               |
| ------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------ |
| Migration da onça movia animais para espécie "Onça" arquivada (rodada anterior) | teste de migration em banco | falha fechada                                          |
| FK `unidadeOrigemId`: schema `SET NULL` × migration `RESTRICT`                  | `migrate diff`              | `onDelete: Restrict` no schema                         |
| Auditoria de `Animal` gravava `observacoes`                                     | revisão para DP-15          | só o nome do campo                                     |
| Teste unitário reprovado: foto simulada sem autor (a regra estava certa)        | Jest                        | ajuste do mock                                         |
| e2e de auditoria esperava um evento que mudou com a nova regra de edição        | e2e                         | teste passou a localizar o evento que alterou o e-mail |

## Limitações restantes

- E2E de backup em Linux/CI; `npm run format` com fim de linha LF; frontend publicado e fluxo offline não verificados.
- Decisões bloqueadas (10 das 22): ver `decisoes-pendentes.md`.
- As duas branches originais (`feat/ajustar-cadastro-animal`, `feat/prontuario-clinico-animal`) não receberam nada desta entrega; o trabalho delas está contido na branch integrada.

## Reprodução

```
npm ci
npm run prisma:generate && npm run prisma:validate
npm run lint && npm run typecheck && npm test
npm run openapi:validate && npm run build
# e2e, num PostgreSQL 16 descartável em localhost (roles anon/authenticated criadas):
npm run prisma:migrate:deploy
E2E_DATABASE_URL=postgresql://…@localhost:5432/ampara_e2e npm run test:e2e
```
