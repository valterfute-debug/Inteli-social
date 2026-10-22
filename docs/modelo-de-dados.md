# Modelo e relacionamentos de dados

Fonte: `prisma/schema.prisma` e `prisma/migrations/` (14 migrations) da branch `feat/integrar-cadastro-e-prontuario`. Nomes são os do banco (inglês); a API usa nomes em português (ver `inventario-campos.md`). Verificado em PostgreSQL 16.9 descartável: o banco migrado e o schema não têm diferença (`prisma migrate diff`).

## Entidades

| Model (tabela)       | Papel                                                                | Campos de identidade e chaves                                                                                                             | Observações                                                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Animal`             | Ficha do animal; **o mesmo registro acompanha o animal entre áreas** | `id` (PK, UUID gerado pelo servidor); `publicId` (único); `microchip` (texto, único entre ativos); `fotoEntradaId` (FK única para `Foto`) | `front` (enum `Front`: CCPA, CASADOTE, CED) é a área atual; `unitId` (NOT NULL) é a unidade que delimita o acesso; `version` para controle de edição; `deletedAt` = arquivado. Silvestre é derivado da `Species` |
| `Species`            | Espécie                                                              | `id`; `name` único                                                                                                                        | `silvestre` define a regra de identificação por nome. Onça = uma espécie com duas raças                                                                                                                          |
| `Breed`              | Raça                                                                 | `id`; `@@unique([speciesId, name])`; `@@unique([id, speciesId])`                                                                          | FK composta de `Animal(breedId, speciesId)` garante que a raça pertence à espécie                                                                                                                                |
| `Unit`               | Unidade de acesso                                                    | `id`; `name` único                                                                                                                        | Seed: CCPA, CED, CasAdote, Encontrei um Amigo, Mutirão, **Mantenedor**. `endereco` e `horariosFuncionamento` não têm entrada                                                                                     |
| `Location`           | Localização física (legado)                                          | `id`; `@@unique([unitId, name])`; `@@unique([id, unitId])`                                                                                | `Animal.locationId` é opcional e só existe em dados antigos                                                                                                                                                      |
| `Responsible`        | Tutor / quem entregou o animal                                       | `id`                                                                                                                                      | `name`, `endereco`, `email`, `telefone`, `active`, `deletedAt`. **Não há** entidade de mantenedor                                                                                                                |
| `HealthEvent`        | Vacina, vermífugo, castração                                         | `id`; FK `animalId`                                                                                                                       | `tipo`, `data`, `descricao`, `observacoes`, `deletedAt`                                                                                                                                                          |
| `AtendimentoClinico` | Atendimento do prontuário                                            | `id`; FKs `animalId`, `responsibleId` (`RESTRICT`)                                                                                        | `tipo` (ADMISSAO/ACOMPANHAMENTO), `dataAtendimento`, 4 seções de texto, `criadoPorId`, `version`, `deletedAt`. Índice parcial: uma admissão ativa por animal                                                     |
| `Foto`               | Foto de entrada                                                      | `id` (UUID do cliente)                                                                                                                    | `situacao` PENDENTE/CONFIRMADA, `caminhoArmazenamento`, `expiraEm`, `criadoPorId` → `Usuario`                                                                                                                    |
| `RemocaoArquivo`     | Fila durável de remoção no Storage                                   | `id`; `caminhoArmazenamento` único                                                                                                        | Sem FK, de propósito                                                                                                                                                                                             |
| `Usuario`            | Conta liberada na API                                                | `id` = `sub` do Supabase Auth                                                                                                             | `papel` (`ADMIN`/`OPERADOR`), `ativo`, `email`, `nome`                                                                                                                                                           |
| `UsuarioUnidade`     | Vínculo conta × unidade                                              | PK `(usuarioId, unitId)`                                                                                                                  | Define o escopo do OPERADOR                                                                                                                                                                                      |
| `EventoAuditoria`    | Trilha de auditoria                                                  | `id`                                                                                                                                      | Só inserção (gatilho do banco). Sem FK, para sobreviver ao que descreve                                                                                                                                          |
| `ChaveIdempotencia`  | Reenvio seguro                                                       | PK `(usuarioId, chave)`                                                                                                                   | Retenção de 30 dias                                                                                                                                                                                              |

## Relacionamentos principais

```
Species 1─* Breed
Species 1─* Animal  ◄── (breedId, speciesId) ──► Breed          (raça da mesma espécie)
Unit    1─* Animal   ◄── (locationId, unitId) ──► Location       (opcional, legado)
Responsible 1─* Animal
Foto    1─0..1 Animal                                              (fotoEntradaId único)
Animal  1─* HealthEvent
Animal  1─* AtendimentoClinico *─1 Responsible                     (responsável da época)
Usuario *─* Unit  via UsuarioUnidade
Usuario 1─* Foto, 1─* ChaveIdempotencia
```

## Como a identidade do animal atravessa as áreas

- A área é o atributo `Animal.front`. **Mudar de CED/CCPA para CasAdote é alterar esse atributo no mesmo registro** (`PATCH /animals/{id}` com a versão); `id`, `publicId`, `microchip`, foto, eventos de saúde e atendimentos permanecem (e2e `fluxo-entre-areas.e2e-spec.ts`).
- Não há tabela de movimentações. O rastro (`front` e `unitId` antes e depois, usuário, instante) existe só em `EventoAuditoria` com a ação `ANIMAL_ATUALIZADO`, consultável por ADMIN. Ver DP-09.
- `unitId` e `front` são independentes: trocar a frente não troca a unidade (DP-08).

## Restrições de integridade verificadas em banco

| Restrição                                           | Onde                                                      | Verificado                                                          |
| --------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Raça pertence à espécie                             | FK composta `Animal_breedId_speciesId_fkey`               | Sim — erro ao violar                                                |
| Localização (se houver) pertence à unidade          | FK composta `Animal_locationId_unitId_fkey`, MATCH SIMPLE | Sim — aceita `locationId` nulo e barra localização de outra unidade |
| Microchip único entre ativos                        | índice parcial `Animal_microchip_ativo_key`               | Sim (e2e: cadastros simultâneos e duplicidade → 409)                |
| Uma admissão ativa por animal                       | índice parcial `AtendimentoClinico_admissao_ativa_key`    | Sim — 2ª admissão barrada; arquivar a primeira libera               |
| Animal/responsável com atendimento não são apagados | FKs `RESTRICT`                                            | Sim                                                                 |
| RLS nas tabelas; `anon`/`authenticated` sem acesso  | migrations `20261007143000_…` e `20261022130000_…`        | Sim (e2e `rls`; consulta de privilégios na tabela nova)             |

## Dados legados e migrations desta entrega

| Migration                                        | Efeito                                                                                                                                                                                             | Segurança verificada                                                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261022120000_cadastro_sem_localizacao_e_onca` | `Animal.locationId` passa a aceitar nulo; cria a espécie "Onça" com as raças "Onça-pintada" e "Onça-parda"; move os animais da espécie antiga "Onça-pintada" (incrementando `version`) e a arquiva | 3 cenários com dados fictícios (limpo, "Onça" ativa pré-existente, "Onça" arquivada → aborta sem alterar nada); SQL idempotente; contagem de animais preservada |
| `20261022130000_prontuario_clinico`              | Cria o enum `TipoAtendimento` e a tabela `AtendimentoClinico` com índices, FKs e RLS                                                                                                               | Aplicada do zero; integridade testada                                                                                                                           |

**Compatibilidade:** animais antigos mantêm `locationId` e demais campos; nenhum dado é apagado. `Animal.unitId` continua obrigatório. Não foi testada com volume nem com banco real.

## Lacunas do modelo (decisões pendentes)

Mantenedor (sem entidade/campo — DP-05), movimentação própria (DP-09), desfecho/encerramento do ciclo (DP-12), desativação de responsável (DP-17).
