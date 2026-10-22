# Contrato de integração para o frontend

**O frontend não está neste repositório.** Este documento é um contrato para a equipe de frontend; **nenhuma tela foi testada** e nenhum nome de componente ou layout é sugerido. Base: branch `feat/integrar-cadastro-e-prontuario`. Campos completos em `inventario-campos.md`; fluxos em `fluxos-de-trabalho.md`.

## 1. Convenções gerais

| Item            | Regra                                                                                                                                                                                                                | Fonte                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Base            | `/api/v1/…` (health em `/api/health`, sem versão)                                                                                                                                                                    | controllers                       |
| Autenticação    | `Authorization: Bearer <token do Supabase Auth>` em tudo, menos `/health*`. Login válido sem liberação na API ou conta desativada → **403**                                                                          | `autenticacao.guard.ts`           |
| Corpo           | JSON. **Campo desconhecido no corpo ou na query → 400** (nada é ignorado em silêncio)                                                                                                                                | `configurar-aplicacao.ts`         |
| Identificadores | UUID v4                                                                                                                                                                                                              | DTOs                              |
| Datas           | ISO-8601 (`2026-10-22` ou `2026-10-22T14:30:00-03:00`). Respostas em UTC (`…Z`). **Decisão pendente** sobre data civil × instante (INC-13): até lá, enviar com offset e converter para America/Sao_Paulo na exibição | DTOs; `relatorio-incoerencias.md` |
| Paginação       | `pagina` (≥1) e `limite` (1–100). Padrão 20; auditoria 50. Resposta `{ itens, pagina, limite, total }`                                                                                                               | DTOs                              |
| Cache           | Respostas não são cacheáveis (dados pessoais e links assinados)                                                                                                                                                      | `saude-http.spec.ts`              |
| Correlação      | Toda resposta traz `X-Request-Id`; pode enviar o seu                                                                                                                                                                 | `contexto-requisicao.ts`          |
| CORS            | Origens permitidas via `CORS_ORIGINS`; cabeçalhos aceitos: `Content-Type`, `Authorization`, `Idempotency-Key`, `X-Request-Id`                                                                                        | `configurar-aplicacao.ts`         |

### Formato de erro

`{ statusCode, mensagem, detalhes?, caminho, requisicaoId?, timestamp }`. `mensagem` é texto ou lista de textos (validação).

| HTTP | Quando                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | Validação (campo desconhecido, UUID/enum/limite inválido, regra de admissão, `null` em campo obrigatório, unidade indefinível)                                      |
| 401  | Sem token, token inválido ou vencido                                                                                                                                |
| 403  | Conta não liberada/desativada; unidade ou recurso fora do acesso; `/auditoria` sem ser ADMIN                                                                        |
| 404  | Recurso inexistente ou arquivado. **A mensagem é sempre genérica ("Recurso não encontrado")** — não dá para distinguir animal de atendimento pela mensagem          |
| 409  | Versão desatualizada; microchip duplicado (com `detalhes` do animal existente quando acessível); segunda admissão; `Idempotency-Key` reutilizada com outro conteúdo |
| 429  | Limite de requisições (padrão 600/min por IP)                                                                                                                       |
| 503  | Banco indisponível (`/health/ready`) ou validação de token impossível                                                                                               |

## 2. Mudanças que quebram clientes anteriores

- **Não enviar `localizacaoId`** (nem exibir Localização Física): a API devolve **400**. A resposta de animal **não traz mais** `localizacaoId` nem `localizacaoNome`.
- **Unidade fora do formulário:** `unidadeId` é opcional; envie apenas em transferência. Sem ele o servidor decide (única unidade do operador → unidade de mesmo nome da frente); se não conseguir, **400**.
- **`PATCH /animals`:** `especieId`, `unidadeId`, `responsavelId`, `frente` e `fotoEntradaId` não aceitam `null` (400). Os demais opcionais aceitam `null` para limpar.
- **Espécie "Onça-pintada" foi arquivada:** use a espécie "Onça" com a raça "Onça-pintada" ou "Onça-parda". Descarte IDs de espécie em cache/filtros salvos. Os animais antigos foram movidos e tiveram `versao` incrementada: ficha em cache + `PATCH` → 409.
- **E-mail e telefone** deixaram de vir em `GET /responsibles` para quem não é ADMIN (os campos simplesmente não existem no item).
- **`Idempotency-Key` obrigatório** também em `POST …/atendimentos`.

## 3. Catálogos (carregar opções)

| Opção        | Endpoint                    | Observação                                                                                                                                             |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Espécies     | `GET /species`              | traz `silvestre` (define a exigência de nome)                                                                                                          |
| Raças        | `GET /breeds?especieId=`    | `especieId` obrigatório; só raças da espécie                                                                                                           |
| Frentes      | `GET /fronts`               | `CCPA`, `CASADOTE`, `CED`                                                                                                                              |
| Unidades     | `GET /units`                | só as unidades do usuário (ADMIN: todas)                                                                                                               |
| Responsáveis | `GET /responsibles`         | `id`, `nome`, `endereco`; ADMIN também `email`, `telefone`                                                                                             |
| Enums fixos  | —                           | `Sexo`: MACHO, FEMEA · `Porte`: PEQUENO, MEDIO, GRANDE · `TipoEventoSaude`: VACINA, VERMIFUGO, CASTRACAO · `TipoAtendimento`: ADMISSAO, ACOMPANHAMENTO |
| Localizações | `GET /locations?unidadeId=` | mantido, mas **não** faz parte do cadastro                                                                                                             |

## 4. Cadastro e edição de animal

- `POST /animals` — corpo: `especieId`_, `responsavelId`_, `frente`_, `fotoEntradaId`_, `racaId`, `nome`, `microchip`, `dataEntrada`, `sexo`, `idadeAproximadaMeses`, `pesoKg`, `porte`, `cor`, `observacoes`, `unidadeId` (opcional). **Header `Idempotency-Key` obrigatório.** Resposta 201 (ou 200 + `Idempotent-Replayed: true` no reenvio).
- Campos exigidos além dos marcados com *: silvestre → `nome`; CCPA/CED não silvestre → `microchip`, `sexo`, `idadeAproximadaMeses`, `pesoKg`, `porte`; CasAdote → nenhum.
- `PATCH /animals/{id}` — qualquer subconjunto + **`versao` obrigatório**. 409 → recarregar a ficha e reaplicar.
- Resposta traz `racaNome`, `responsavelNome`, `responsavelEndereco`, `unidadeNome`, `especieNome`, `especieSilvestre`, `fotoEntradaUrl` (link temporário: não guardar), `versao`.
- `GET /animals` — filtros `busca`, `nome`, `identificadorPublico`, `microchip`, `especieId`, `frente`, `unidadeId`.
- `DELETE /animals/{id}` — arquiva (204).

## 5. Foto de entrada (upload)

1. `POST /fotos` `{ id (UUID gerado no cliente), tipoMidia (image/jpeg|png|webp), tamanhoBytes (≤ 8 388 608) }` + `Idempotency-Key`.
2. `PUT` do arquivo na URL devolvida (2 h de validade) — direto ao Storage.
3. `POST /fotos/{id}/confirmacao` + `Idempotency-Key`. 409 = arquivo ainda não chegou ou foto já confirmada.
4. Usar o `id` em `fotoEntradaId`. **Não há anexos de exame** nem outras fotos.

## 6. Responsáveis

- `POST /responsibles` `{ nome* (≥2 úteis), endereco, email, telefone }` → 201.
- `PATCH /responsibles/{id}` — qualquer subconjunto (corpo vazio → 400). **Sem `versao`** (última escrita vence). OPERADOR sem vínculo com o responsável → 403. O endereço vale para todos os animais ligados.
- Não existe desativação de responsável.

## 7. Prontuário clínico

- `GET /animals/{animalId}/atendimentos?pagina=&limite=` — mais recente primeiro. Cada item: `id`, `animalId`, `tipo`, `dataAtendimento`, `animal{…}`, `responsavel{id,nome,endereco}`, `anamnese`, `exameFisico`, `examesComplementares`, `tratamento`, `versao`, `criadoEm`, `atualizadoEm`. O `responsavel` é o da **época** do atendimento; o endereço é o atual.
- `POST …/atendimentos` — corpo opcional: `tipo`, `dataAtendimento`, `anamnese`, `exameFisico`, `examesComplementares`, `tratamento` (até 10 000 caracteres cada). **`Idempotency-Key` obrigatório**: gerar uma vez por atendimento e reusar nos reenvios. Sem `tipo`: 1º = ADMISSAO, demais = ACOMPANHAMENTO. Segunda ADMISSAO → 409.
- `PATCH …/atendimentos/{id}` — seções/data + **`versao` obrigatório**; **`tipo` não é aceito**. 409 → recarregar. Sem mudança real → 200 sem alterar a versão.
- `GET …/atendimentos/{id}`. Não há exclusão.
- `GET /animals/{id}/prontuario` → PDF (`application/pdf`), inclui os atendimentos.

## 8. Permissões e privacidade

- ADMIN: tudo, incluindo `GET /auditoria` e contato dos responsáveis. OPERADOR: só as unidades vinculadas; `/auditoria` → 403.
- Não exibir e-mail/telefone de responsável quando o campo não vier na resposta.
- Não registrar em log do cliente tokens, links assinados de foto nem texto clínico.

## 9. Eventos de saúde (recurso distinto do atendimento)

`POST /animals/{animalId}/health-events` `{ tipo*, data*, descricao, observacoes }`; `Idempotency-Key` opcional; `GET` (filtro `tipo`); `DELETE …/{id}`. Sem edição.

## 10. Limitações a comunicar

- **Offline:** não implementado. O backend oferece idempotência e `versao`, mas não há fila nem sincronização; **nenhum fluxo offline foi testado**.
- **Anexos de exames complementares:** não existem (campo de texto apenas).
- **Dados legados:** animais antigos podem ter localização física no banco; a API não a devolve.
- **Telas:** nada foi validado com interface.

## 11. Identificação, silvestres e passagem entre áreas

- **Microchip:** tratar como **texto** (nunca como número): `"000123456789"` mantém os zeros e aceita até 20 dígitos; convertê-lo para número perderia zeros e precisão. Exibir e enviar exatamente como digitado. Duplicado → 409 com `detalhes.animalExistenteId` (oferecer abrir a ficha existente).
- **Silvestres:** `especieSilvestre: true` na espécie indica que o **nome** é obrigatório e que microchip, sexo, idade, peso e porte são dispensados. Informar o microchip também é aceito (regra pendente, DP-02). Nomes repetidos são aceitos; não usar o nome como chave.
- **Mantenedor:** **não há campo nem endpoint**. Não criar campo de mantenedor no formulário até a equipe decidir (DP-05).
- **Passagem entre áreas:** é `PATCH /animals/{id}` com `versao` e `frente` (`CCPA`, `CASADOTE`, `CED`), mais `unidadeId` se a unidade também muda. Não criar novo cadastro. Tratar 403 (sem acesso à unidade de origem ou destino), 400 (voltar para CED/CCPA sem os cinco campos) e 409 (versão). Depois de uma passagem que muda a unidade, o usuário pode **perder o acesso** à ficha (403 no `GET`).
- **Histórico de passagens:** não há endpoint para operadores; só `GET /auditoria` (ADMIN). Não prometer uma linha do tempo de áreas na interface (DP-09).
- **Nome da área:** a API usa `CASADOTE` (código) e "CasAdote" (unidade); "CasAdot" não existe.
- **Idade:** o campo é `idadeAproximadaMeses` (meses, 0–600). Converter anos/meses na interface é responsabilidade do frontend.
- **Perfis:** não esconder campos por perfil no cliente além do que a API já omite (`email`, `telefone`); a decisão sobre ADMIN × OPERADOR está aberta (DP-13).
