# Contrato de integração para o frontend

**O frontend não está neste repositório.** Este documento é um contrato para a equipe de frontend; **nenhuma tela foi testada** e nenhum nome de componente ou layout é sugerido. Base: branch `feat/integrar-cadastro-e-prontuario`. Campos completos em `inventario-campos.md`; fluxos em `fluxos-de-trabalho.md`.

> **Atenção antes de publicar esta versão da API.** O `wad.md` registra um frontend institucional **já publicado** (Vercel), integrado a uma API em produção. Esta versão **muda o contrato**: `GET /me` deixa de devolver `papel`, `todasUnidades` e `unidades`; `GET /units` passa a listar todas as unidades; `localizacaoId` passa a ser rejeitado (400); e a migration remove definitivamente papel e vínculos de unidade. Um cliente que ainda leia `papel`/`unidades` do `/me` (por exemplo, para montar a lista de unidades do formulário) deixa de funcionar. **Publicar o frontend e a API de forma coordenada, depois de testar a migration numa cópia do banco.** Este repositório não tem como verificar o código do frontend.

## 1. Convenções gerais

| Item            | Regra                                                                                                                                                                                                               | Fonte                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Base            | `/api/v1/…` (health em `/api/health`, sem versão)                                                                                                                                                                   | controllers               |
| Autenticação    | `Authorization: Bearer <token do Supabase Auth>` em tudo, menos `/health*`. Login válido sem liberação na API ou conta desativada → **403**                                                                         | `autenticacao.guard.ts`   |
| Permissões      | **Iguais para toda conta ativa**, em todas as unidades. Não esconder nem bloquear funções por "perfil": ele não existe mais                                                                                         | RN010                     |
| Corpo           | JSON. **Campo desconhecido no corpo ou na query → 400**                                                                                                                                                             | `configurar-aplicacao.ts` |
| Identificadores | UUID v4                                                                                                                                                                                                             | DTOs                      |
| Datas           | ISO-8601 (`2026-10-22` ou `2026-10-22T14:30:00-03:00`). Respostas em UTC (`…Z`). **Decisão pendente** sobre data civil × instante (DP-16): até lá, enviar com offset e converter para America/Sao_Paulo na exibição | DTOs                      |
| Paginação       | `pagina` (≥1) e `limite` (1–100). Padrão 20; auditoria 50. Resposta `{ itens, pagina, limite, total }`                                                                                                              | DTOs                      |
| Cache           | Respostas não são cacheáveis (dados pessoais e links assinados)                                                                                                                                                     | `saude-http.spec.ts`      |
| Correlação      | Toda resposta traz `X-Request-Id`; pode enviar o seu                                                                                                                                                                | `contexto-requisicao.ts`  |
| CORS            | Origens via `CORS_ORIGINS`; cabeçalhos aceitos: `Content-Type`, `Authorization`, `Idempotency-Key`, `X-Request-Id`                                                                                                  | `configurar-aplicacao.ts` |

### Formato de erro

`{ statusCode, mensagem, detalhes?, caminho, requisicaoId?, timestamp }`. `mensagem` é texto ou lista de textos (validação).

| HTTP | Quando                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | Validação (campo desconhecido, UUID/enum/limite inválido, regra de admissão, `null` em campo obrigatório, unidade indefinível)                     |
| 401  | Sem token, token inválido ou vencido                                                                                                               |
| 403  | Conta não liberada ou desativada; foto enviada por outra conta                                                                                     |
| 404  | Recurso inexistente ou arquivado. **A mensagem é sempre genérica ("Recurso não encontrado")**                                                      |
| 409  | Versão desatualizada; microchip duplicado (com `detalhes` do animal existente); segunda admissão; `Idempotency-Key` reutilizada com outro conteúdo |
| 429  | Limite de requisições (padrão 600/min por IP)                                                                                                      |
| 503  | Banco indisponível (`/health/ready`) ou validação de token impossível                                                                              |

## 2. Mudanças que quebram clientes anteriores

- **`GET /me`** devolve só `{ id, email, nome }`. Não há `papel`, `todasUnidades` nem `unidades`.
- **`GET /units`** lista todas as unidades ativas, para qualquer conta. `GET /locations?unidadeId=` aceita qualquer unidade.
- **Sem escopo por unidade:** qualquer conta lê e edita qualquer animal; depois de passar o animal de unidade, todas continuam vendo a ficha. Não esperar 403 por "unidade alheia".
- **`GET /responsibles`** traz `email` e `telefone` para toda conta (antes, só para administradores). `PATCH /responsibles/{id}` é permitido a qualquer conta.
- **`GET /auditoria`** é aberto a qualquer conta ativa.
- **Não enviar `localizacaoId`** (nem exibir Localização Física): a API devolve **400**. A resposta de animal não traz `localizacaoId` nem `localizacaoNome`.
- **Unidade fora do formulário:** `unidadeId` é opcional; sem ele, vale a unidade de mesmo nome da frente (400 se não existir). Trocar só a `frente` **não** muda a unidade.
- **`PATCH /animals`:** `especieId`, `unidadeId`, `responsavelId`, `frente` e `fotoEntradaId` não aceitam `null` (400).
- **Espécie "Onça-pintada" foi arquivada:** use "Onça" com a raça "Onça-pintada" ou "Onça-parda". Descarte IDs de espécie em cache; animais antigos tiveram `versao` incrementada (ficha em cache + `PATCH` → 409).
- **`Idempotency-Key` obrigatório** também em `POST …/atendimentos`.
- **Novo:** `GET /animals/{id}/movimentacoes` (linha do tempo de áreas).

## 3. Catálogos (carregar opções)

| Opção        | Endpoint                    | Observação                                                                                                                                             |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Espécies     | `GET /species`              | traz `silvestre` (define a exigência de nome)                                                                                                          |
| Raças        | `GET /breeds?especieId=`    | `especieId` obrigatório                                                                                                                                |
| Frentes      | `GET /fronts`               | `CCPA`, `CASADOTE`, `CED`                                                                                                                              |
| Unidades     | `GET /units`                | todas; incluem "Mantenedor" (local dos silvestres)                                                                                                     |
| Responsáveis | `GET /responsibles`         | `id`, `nome`, `endereco`, `email`, `telefone`                                                                                                          |
| Enums fixos  | —                           | `Sexo`: MACHO, FEMEA · `Porte`: PEQUENO, MEDIO, GRANDE · `TipoEventoSaude`: VACINA, VERMIFUGO, CASTRACAO · `TipoAtendimento`: ADMISSAO, ACOMPANHAMENTO |
| Localizações | `GET /locations?unidadeId=` | legado; **não** faz parte do cadastro                                                                                                                  |

## 4. Cadastro, edição e passagem entre áreas

- `POST /animals` — corpo: `especieId`_, `responsavelId`_, `frente`_, `fotoEntradaId`_, `racaId`, `nome`, `microchip`, `dataEntrada`, `sexo`, `idadeAproximadaMeses`, `pesoKg`, `porte`, `cor`, `observacoes`, `unidadeId` (opcional). **`Idempotency-Key` obrigatório.** 201 (ou 200 + `Idempotent-Replayed: true` no reenvio).
- Exigências além dos marcados com *: silvestre → `nome`; CCPA/CED não silvestre → `microchip`, `sexo`, `idadeAproximadaMeses`, `pesoKg`, `porte`; CasAdote → nenhuma (regra confirmada na reunião de validação, DP-01).
- `PATCH /animals/{id}` — qualquer subconjunto + **`versao` obrigatório**. 409 → recarregar a ficha.
- **Passagem entre áreas** = `PATCH` com `frente` de destino (e `unidadeId`, se a unidade também muda). Não criar novo cadastro. Tratar 400 (voltar a CED/CCPA sem os cinco campos de identificação) e 409 (versão). Qualquer direção é aceita pela API (DP-07).
- **Linha do tempo:** `GET /animals/{id}/movimentacoes?pagina=&limite=` — itens com `frenteOrigem` (nula na entrada), `frenteDestino`, `unidadeOrigemNome`, `unidadeDestinoNome`, `usuarioId` e `criadoEm`. Funciona também para animal arquivado. Animais anteriores à migration começam sem itens.
- A ficha traz `racaNome`, `responsavelNome`, `responsavelEndereco`, `unidadeNome`, `especieNome`, `especieSilvestre`, `fotoEntradaUrl` (link temporário: não guardar) e `versao`.
- **Microchip é texto**: `"000123456789"` mantém os zeros e aceita até 20 dígitos. Nunca converter para número.
- **Idade:** `idadeAproximadaMeses` (meses, 0–600); converter anos/meses é do frontend.
- `GET /animals` — filtros `busca`, `nome`, `identificadorPublico`, `microchip`, `especieId`, `frente`, `unidadeId`. `DELETE /animals/{id}` arquiva (204).

## 5. Silvestres e mantenedor

- `especieSilvestre: true` indica que o **nome** é obrigatório e que microchip, sexo, idade, peso e porte são dispensados; informar o microchip também é aceito (DP-02). Nomes repetidos são aceitos; não usar o nome como chave.
- **Mantenedor = unidade "Mantenedor"** (o local onde ficam os silvestres, `wad.md` §7.5): selecionável em `unidadeId`. Não há campo nem endpoint de mantenedor como pessoa/organização (DP-06).

## 6. Foto de entrada (upload)

1. `POST /fotos` `{ id (UUID gerado no cliente), tipoMidia (image/jpeg|png|webp), tamanhoBytes (≤ 8 388 608) }` + `Idempotency-Key`.
2. `PUT` do arquivo na URL devolvida (2 h de validade), direto ao Storage.
3. `POST /fotos/{id}/confirmacao` + `Idempotency-Key`. 409 = arquivo ainda não chegou ou foto já confirmada.
4. Usar o `id` em `fotoEntradaId`. **Só a conta que enviou a foto pode vinculá-la** (403 caso contrário). Não há anexos de exame.

## 7. Responsáveis

- `POST /responsibles` `{ nome* (≥2 úteis), endereco, email, telefone }` → 201.
- `PATCH /responsibles/{id}` — qualquer subconjunto (corpo vazio → 400). **Sem `versao`** (última escrita vence; DP-17). O endereço vale para todos os animais ligados.
- Não existe desativação de responsável.

## 8. Prontuário clínico

- `GET /animals/{animalId}/atendimentos?pagina=&limite=` — mais recente primeiro; cada item traz `animal` e `responsavel` (o da época).
- `POST …/atendimentos` — corpo opcional: `tipo`, `dataAtendimento`, `anamnese`, `exameFisico`, `examesComplementares`, `tratamento` (até 10 000 caracteres cada). **`Idempotency-Key` obrigatório**: gerar uma vez por atendimento e reusar nos reenvios. Sem `tipo`: 1º = ADMISSAO, demais = ACOMPANHAMENTO. Segunda ADMISSAO → 409.
- `PATCH …/atendimentos/{id}` — seções/data + **`versao` obrigatório**; não aceita `tipo`. Sem mudança real → 200 sem alterar a versão.
- `GET …/atendimentos/{id}`. Não há exclusão. `GET /animals/{id}/prontuario` → PDF com os atendimentos (sem a linha do tempo de áreas).

## 9. Eventos de saúde (recurso distinto do atendimento)

`POST /animals/{animalId}/health-events` `{ tipo*, data*, descricao, observacoes }`; `Idempotency-Key` opcional; `GET` (filtro `tipo`); `DELETE …/{id}`. Sem edição.

## 10. Privacidade

- E-mail e telefone aparecem para toda conta ativa: tratar como dados pessoais na interface (não exibir sem necessidade, não registrar em log do cliente).
- Não registrar em log do cliente tokens, links assinados de foto nem texto clínico.
- A auditoria não grava contatos, texto clínico nem o conteúdo de `observacoes`.

## 11. Limitações a comunicar

- **Offline:** não implementado. O backend oferece idempotência e `versao`; **nenhum fluxo offline foi testado**.
- **Anexos de exames complementares:** não existem.
- **Dados legados:** animais antigos podem ter localização física no banco; a API não a devolve.
- **Telas:** nada foi validado com interface.
