# Documentação do backend — Ampara Animal

## Visão geral

API (NestJS, TypeScript, Prisma, PostgreSQL no Supabase) que centraliza a ficha de cada animal sob os cuidados do Instituto Ampara Animal: cadastro e identificação (microchip, silvestres), responsável, foto de entrada, eventos de saúde, **atendimentos clínicos** (prontuário) e PDF do prontuário, com autenticação, escopo por unidade, idempotência, controle de versão e trilha de auditoria. O animal passa pelas áreas **CED**, **CCPA** e **CasAdote** mantendo o mesmo cadastro (campo `frente`).

**Este repositório é só o backend.** Não há frontend, então nada aqui descreve telas verificadas; o contrato para o frontend está em `compatibilidade-frontend.md`. **Offline não está implementado.** Mantenedor, histórico de movimentação próprio e encerramento do ciclo **não existem** ainda e dependem de decisões da equipe (`decisoes-pendentes.md`).

## Documentos

| Documento                                                          | Para que serve                                                                                                                        | Para quem                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`fluxos-de-trabalho.md`](fluxos-de-trabalho.md)                   | O que cada perfil faz, passo a passo (cadastro, microchip, silvestres, passagem entre áreas, histórico, prontuário, fotos, auditoria) | Equipe da Ampara, quem está começando, desenvolvimento |
| [`requisitos-funcionais.md`](requisitos-funcionais.md)             | RF numerados, prioridade, status e critérios de aceite                                                                                | Produto, QA, desenvolvimento                           |
| [`regras-de-negocio.md`](regras-de-negocio.md)                     | Informações da equipe (EQ) e RN numeradas, separando código, plano e decisão pendente                                                 | Produto, Ampara, desenvolvimento                       |
| [`decisoes-pendentes.md`](decisoes-pendentes.md)                   | Perguntas à equipe (DP), com contexto, impacto e alternativas — sem escolher nenhuma                                                  | Ampara, produto                                        |
| [`modelo-de-dados.md`](modelo-de-dados.md)                         | Entidades, relacionamentos, restrições e migrations                                                                                   | Desenvolvimento                                        |
| [`inventario-campos.md`](inventario-campos.md)                     | Todos os campos e parâmetros de entrada, com regras, origem e persistência                                                            | Desenvolvimento, frontend, QA                          |
| [`matriz-rastreabilidade.md`](matriz-rastreabilidade.md)           | Liga RF, RN, campos, endpoints, tabelas e testes; lista lacunas                                                                       | QA, revisão                                            |
| [`relatorio-incoerencias.md`](relatorio-incoerencias.md)           | Defeitos e incoerências, corrigidos e pendentes, com evidência                                                                        | Revisão, Ampara                                        |
| [`relatorio-validacao-tecnica.md`](relatorio-validacao-tecnica.md) | O que foi executado, resultados reais, migrations testadas, limitações                                                                | Revisão, merge                                         |
| [`compatibilidade-frontend.md`](compatibilidade-frontend.md)       | Contrato de integração para a equipe de frontend                                                                                      | Frontend                                               |
| [`wad.md`](wad.md)                                                 | Documento de arquitetura e histórico (preexistente; partes anteriores a esta integração não foram revisadas)                          | Todos                                                  |

## Convenções

- **RF/RN novos** (RF001…, RN001…) substituem, para o sistema integrado, a numeração curta do WAD (RF01–RF08, RN01–RN08); a correspondência está em `requisitos-funcionais.md` e `regras-de-negocio.md`. **EQ** = informação fornecida pela equipe; **DP** = decisão pendente; **INC** = incoerência.
- **Status de validação:** _unit ✔_ e _e2e ✔_ só significam "executado e aprovado" (resultados em `relatorio-validacao-tecnica.md`); _Verificação estática_ é leitura sem execução; _Pendente de decisão_ depende da equipe.

## Como executar

Requisitos: Node.js 24 ou superior (`package.json` `engines`) e, para os testes e2e, PostgreSQL 16 em `localhost`.

```
npm ci
npm run prisma:generate
npm run prisma:validate
npm run lint
npm run typecheck
npm test                      # unitários (Jest, sem banco)
npm run openapi:validate
npm run build
```

Testes ponta a ponta (apagam as tabelas: **só** aceitam banco em `localhost`; use um banco descartável com as roles `anon` e `authenticated`):

```
psql "$E2E_DATABASE_URL" -c 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;'
DATABASE_URL="$E2E_DATABASE_URL" DIRECT_URL="$E2E_DATABASE_URL" npm run prisma:migrate:deploy
npm run test:e2e
```

Desenvolvimento: copie `.env.example` para `.env` e preencha só localmente. Liberar contas: `npm run usuario:liberar -- --email … --papel OPERADOR --unidade CED`. Catálogos iniciais: `npm run db:seed`. Nunca aplique migrations em banco real sem testá-las antes numa cópia.
