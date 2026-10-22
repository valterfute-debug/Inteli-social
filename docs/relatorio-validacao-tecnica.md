# Relatório de validação técnica

Data da execução: 2026-10-22. Branch `feat/integrar-cadastro-e-prontuario` (worktree `Inteli-social-integracao`), commit-base `f6c79ae` (`main`), **sem commits**: todas as alterações estão em staging/working tree.

## Resumo

Tudo o que o ambiente permitiu foi **executado**. Passaram por execução: `prisma generate`, `prisma validate`, lint, typecheck, build, validação do OpenAPI, 184 testes unitários, 83 testes e2e com PostgreSQL 16 real e as duas migrations nos três cenários de dados. **Um teste e2e foi reprovado por causa do ambiente Windows** (backup/restauração), não pelo produto. Não estão validados: o fluxo offline (não existe), qualquer tela (não existe), o teste de backup em Linux, o `format --check` por inteiro (ver abaixo) e a aplicação em banco real/produção (proibida).

**Prontidão para merge:** _pronta para revisão_, **não** pronta para merge — dependem de decisão da equipe (INC-10, INC-13), da execução do e2e de backup em Linux/CI e da revisão das migrations em uma cópia do banco real.

## Ambiente

| Item       | Esperado pelo projeto                                    | Usado nesta execução                                                                                                                               |
| ---------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sistema    | —                                                        | Windows 11 Pro 10.0.26200                                                                                                                          |
| Node.js    | `>=24` (`package.json` `engines`; CI `node-version: 24`) | v24.22.1 (zip oficial de nodejs.org, SHA-256 conferido contra `SHASUMS256.txt`), **portátil**, em `AppData\Local\ampara-tools`                     |
| npm        | npm com `package-lock.json`                              | 11.19.1                                                                                                                                            |
| Prisma     | `6.19.3` (lockfile)                                      | 6.19.3                                                                                                                                             |
| PostgreSQL | 16 (CI `postgres:16-alpine`)                             | 16.9, binários da EDB (`get.enterprisedb.com`), **portátil**, `127.0.0.1:54329`, cluster descartável                                               |
| Docker     | opcional                                                 | **Não usado.** Docker Desktop exige administrador, WSL2 (não instalado) e reinício; não era viável neste modo. Substituído por PostgreSQL portátil |

**Impacto no computador:** nada foi instalado globalmente nem alterado no PATH, registro ou serviços. Tudo está em `C:\Users\valte\AppData\Local\ampara-tools` (pode ser apagado) e `node_modules/` na worktree (ignorado pelo Git). Os binários do PostgreSQL **não têm assinatura digital** (`NotSigned`) e não há hash publicado para comparar; vieram do domínio oficial por HTTPS, com o tamanho igual ao `Content-Length`. Foram usados apenas em loopback, com dados fictícios. Nenhuma credencial real foi usada; o banco usa autenticação `trust` em `127.0.0.1`. Nenhum banco remoto ou compartilhado foi tocado.

## Comandos e resultados (execução final, após todas as correções)

| Verificação                     | Comando                                                                                  | Executada? | Resultado                                   | Evidência                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ---------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| Instalação reproduzível         | `npm ci`                                                                                 | Sim        | **Aprovado por execução**                   | saída 0; `package-lock.json` inalterado                                |
| Prisma Client                   | `npm run prisma:generate`                                                                | Sim        | **Aprovado** (6 s)                          | Prisma Client v6.19.3 gerado                                           |
| Schema                          | `npm run prisma:validate`                                                                | Sim        | **Aprovado** (5 s)                          | "The schema … is valid"                                                |
| Lint                            | `npm run lint`                                                                           | Sim        | **Aprovado** (7 s)                          | 0 erros                                                                |
| Typecheck                       | `npm run typecheck`                                                                      | Sim        | **Aprovado** (7 s)                          | `tsc --noEmit` sem erros                                               |
| Testes unitários                | `npx jest --runInBand`                                                                   | Sim        | **Aprovado**: 17 suítes, **184/184** (29 s) | inclui os 7 do filtro de auditoria e 3 de regra de silvestre/microchip |
| OpenAPI                         | `npm run openapi:validate`                                                               | Sim        | **Aprovado** (1 s)                          | "Contrato OpenAPI válido; situações dos endpoints conferidas"          |
| Build                           | `npm run build`                                                                          | Sim        | **Aprovado** (11 s)                         | `nest build` sem erros                                                 |
| e2e (sem backup)                | `jest --config jest.e2e.config.cjs --runInBand --testPathIgnorePatterns backup.e2e-spec` | Sim        | **Aprovado**: 8 suítes, **83/83** (46 s)    | PostgreSQL 16.9 real, migrations aplicadas do zero (14)                |
| e2e de backup                   | `test/e2e/backup.e2e-spec.ts`                                                            | Sim        | **Reprovado — causa ambiental**             | ver abaixo                                                             |
| Migrations em banco descartável | `prisma migrate deploy`                                                                  | Sim        | **Aprovado**                                | ver seção Migrations                                                   |
| Deriva schema × banco           | `prisma migrate diff --from-url … --to-schema-datamodel …`                               | Sim        | **Aprovado**: "No difference detected"      | banco migrado vs `schema.prisma`                                       |
| Formatação                      | `npm run format` (`prettier --check`)                                                    | Sim        | **Reprovado — ambiental**; ver abaixo       | —                                                                      |

### e2e de backup (reprovado)

`test/e2e/backup.e2e-spec.ts` (preexistente em `main`) foi escrito para Linux: o `bindir` padrão é `/usr/lib/postgresql/16/bin` e ele inicia o próprio PostgreSQL com `pg_ctl` e pipes. No Windows, o `pg_ctl` com pipes herdados trava (ocorreu o mesmo ao eu iniciar o cluster com `-w`) e o teste estoura por timeout (`spawnSync … pg_ctl ETIMEDOUT`); o servidor chegou a subir ("pronto para aceitar conexões"). Não há evidência de defeito do produto. **Não corrigi** o teste. Ficou um servidor temporário órfão, que encerrei, e a pasta temporária do teste foi removida. **Pendente:** executar no Linux/CI (`npm run test:e2e`).

### Formatação

`npm run format` falha em 95 arquivos. Em 85 deles — inclusive arquivos que não toquei — a causa é só o fim de linha (CRLF na cópia de trabalho do Windows, com `core.autocrlf=true`; o Prettier espera LF). Com `--end-of-line auto` restavam 10 arquivos meus, que foram formatados. A CI **não** executa `format` (só lint, typecheck, test, prisma validate, openapi, build, audit). Não rodei `prettier --write` no repositório inteiro, para não reescrever arquivos preexistentes.

### Não executado

- `npm audit --omit=dev` (etapa da CI): não executado.
- Fluxos com Supabase Auth/Storage reais: os e2e usam tokens e Storage simulados (padrão do projeto).
- Teste de backup/restauração: ver acima.
- Qualquer teste de interface ou offline: não existem.

## Migrations

Banco: PostgreSQL 16.9 portátil, loopback, descartável. URL confirmada antes de cada execução (`127.0.0.1:54329`, bancos `ampara_*`); credenciais não impressas. Ordem: `20261022120000_cadastro_sem_localizacao_e_onca`, depois `20261022130000_prontuario_clinico`.

| Verificação                                                                                    | Resultado                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14 migrations em banco vazio (`migrate deploy`)                                                | Aprovado; 14 registradas, 0 falhas                                                                                                                                                                                                                                  |
| Schema final × banco migrado                                                                   | Sem diferença (`migrate diff`)                                                                                                                                                                                                                                      |
| Cenário A — dados antigos (5 animais, 3 de "Onça-pintada", 1 arquivado, todos com localização) | Aprovado: 3 animais movidos para "Onça" com raça "Onça-pintada", `version` 1→2, `locationId` preservado; total 5 antes e depois (4 ativos); espécie antiga arquivada; raças 1→3; sem espécie duplicada                                                              |
| Cenário C — "Onça" ativa já existente com a raça "Onça-parda"                                  | Aprovado: só criou "Onça-pintada"; sem duplicidade; animais movidos                                                                                                                                                                                                 |
| Cenário B — "Onça" **arquivada** já existente                                                  | A primeira versão da migration **movia os animais para a espécie arquivada** (defeito, INC-22). Corrigida para falhar fechada: com a versão nova, a migration aborta com mensagem clara, a transação é revertida e os 3 animais continuam em v1 na espécie original |
| Idempotência do SQL da migration 1 (em cópia do banco já migrado, reaplicada 2×)               | Aprovado: sem erro, versões permanecem v2, contagens iguais                                                                                                                                                                                                         |
| Animal sem localização (`locationId` NULL)                                                     | Aceito; a FK composta `(locationId, unitId)` continua barrando localização de outra unidade                                                                                                                                                                         |
| Raça de outra espécie                                                                          | Barrada pela FK `(breedId, speciesId)`; raça de onça numa onça aceita                                                                                                                                                                                               |
| Índice parcial de admissão                                                                     | Segunda admissão ativa barrada; vários acompanhamentos aceitos; admissão de outro animal aceita; arquivar a admissão libera nova                                                                                                                                    |
| FK `RESTRICT`                                                                                  | Apagar animal com atendimento barrado; atendimento para animal inexistente barrado                                                                                                                                                                                  |
| RLS na tabela nova                                                                             | `relrowsecurity = true`; `anon` e `authenticated` sem `SELECT`                                                                                                                                                                                                      |

**Ressalvas:** (1) não testei dados de produção nem volume; (2) a migration 2 não é idempotente por natureza (`CREATE TYPE`), como as demais; (3) `prisma migrate dev` (shadow database) falha numa migration **já existente em `main`** (`20261007143000_…` altera `_prisma_migrations`) — `migrate deploy` funciona (INC-25); (4) a migration corrigida está só na branch integrada: ao integrar, usar a versão desta branch. Antes de qualquer ambiente real: conferir `SELECT … FROM "Species" WHERE name IN ('Onça','Onça-pintada')` e testar numa **cópia** do banco.

## Testes de segurança, autorização e privacidade (executados)

Todos com dados fictícios, via HTTP real e banco real (`test/e2e/cadastro-e-privacidade.e2e-spec.ts`, 12 testes; `fluxo-entre-areas.e2e-spec.ts`, 13 testes; `atendimentos-clinicos.e2e-spec.ts`, 12 testes; `escopo`, `auditoria`, `idempotencia`, `rls` preexistentes):

- Operador sem acesso à unidade recebe 403 ao ler atendimentos e PDF de animal alheio.
- Listagem de responsáveis não traz `email`/`telefone` para operador; traz para ADMIN.
- Edição de responsável: 403 para operador sem vínculo; 200 com vínculo; responsável sem animais é editável.
- `localizacaoId` na criação: 400 (campo desconhecido). `null` em `responsavelId` no PATCH: 400.
- Auditoria de responsável e de atendimento não contém e-mail, endereço nem texto clínico; entidade desconhecida no filtro: 400; operador na auditoria: 403.
- Idempotência: reenvio devolve o mesmo atendimento; mesma chave em outro animal ou com outro conteúdo: 409 e nada gravado; mesma chave em paralelo cria um único atendimento.
- Concorrência: três admissões simultâneas resultam em exatamente uma ativa; dois `PATCH` simultâneos com a mesma versão resultam em 200 e 409. Rodado 3 vezes sem falha.
- Erros 5xx não expõem stack trace nem segredos (`saude-http.spec.ts` "oculta detalhes internos em erro 500").

## Correções feitas durante a validação

| Achado                                                                | Origem                      | Correção                                         |
| --------------------------------------------------------------------- | --------------------------- | ------------------------------------------------ |
| e2e novo de atendimentos não compilava (`responsibleId` sem variável) | typecheck                   | corrigido o teste                                |
| `ENTIDADES_AUDITADAS` não usada                                       | lint                        | decoradores passaram a usá-la                    |
| 1 teste unitário reprovado (foto simulada sem `criadoPorId`)          | Jest                        | corrigido o mock; a regra do código estava certa |
| Migration movia animais para espécie "Onça" arquivada                 | teste de migration em banco | migration falha fechada                          |
| Estilo em 6 arquivos de código                                        | Prettier                    | formatados só os meus arquivos                   |

## Limitações restantes

- Backup/restauração só foi reprovado no Windows; precisa rodar no Linux/CI.
- `npm audit`, `format` completo e testes de interface/offline não executados.
- Decisões de negócio pendentes: `relatorio-incoerencias.md` (INC-10, INC-13 e demais).
- As duas branches originais não receberam as correções desta rodada.

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

## Rodada de consolidação (identificação, silvestres e passagem entre áreas)

Executada depois de documentar as informações da equipe sobre microchip, silvestres, mantenedor, áreas e perfis. **Nenhuma regra nova foi implementada**: o código já fazia o que a equipe descreveu, e as lacunas foram registradas como decisões pendentes. Foram adicionados testes que fixam o comportamento atual:

| Teste                | Arquivo                                  | O que comprova (executado e aprovado)                                                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microchip como texto | `test/e2e/fluxo-entre-areas.e2e-spec.ts` | `000123456789` e 20 dígitos voltam idênticos; letras e 21 dígitos → 400; duplicado → 409 com o animal existente; CED/CCPA exigem os cinco campos                                                                                                                                                                            |
| Silvestres           | idem                                     | exigem nome; dois com o mesmo nome convivem; microchip em silvestre **não é vedado**                                                                                                                                                                                                                                        |
| Passagem entre áreas | idem                                     | CED → CasAdote → CCPA no mesmo cadastro (`id`, identificador público, microchip, `criadoEm` iguais; `versao` 1→3; um só animal por microchip); trilha de auditoria com `front` antes/depois e o usuário; atendimentos continuam ligados; voltar a CED/CCPA sem os dados → 400 sem alterar; só a `frente` não muda a unidade |
| Escopo × fluxo       | idem                                     | operador só do CED recebe 403 ao enviar ao CasAdote e, depois da passagem feita por quem tem as duas unidades, perde o acesso (INC-33)                                                                                                                                                                                      |
| Regra de silvestre   | `src/animals/regras-admissao.spec.ts`    | silvestre com nome e microchip é aceito; sem nome é recusado mesmo com microchip                                                                                                                                                                                                                                            |

**Referências da documentação:** um verificador local (fora do repositório) conferiu 899 referências a RF, RN, CA, DP, INC e EQ e os nomes de testes citados na matriz: nenhuma referência quebrada ao final (ele achou `INC-31` sem linha própria e um título de teste errado; ambos corrigidos).

**Resultado final desta rodada (mesmos comandos):** `prisma generate`, `prisma validate`, lint, typecheck, build e `openapi:validate` aprovados; **184/184** testes unitários (17 suítes); **83/83** e2e em 8 suítes contra PostgreSQL 16.9, exceto o de backup (reprovado por ambiente Windows, sem mudança).
