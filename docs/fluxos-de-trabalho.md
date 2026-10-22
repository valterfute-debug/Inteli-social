# Fluxos de trabalho — o que cada pessoa faz no sistema

Escrito para três públicos: quem trabalha na Ampara, quem desenvolve e quem está começando. Branch `feat/integrar-cadastro-e-prontuario`.

**Leia antes:** este repositório é só o **backend (API)**. Não existe tela aqui. Cada fluxo descreve o que a API faz e exige; "o que a pessoa vê" depende de um frontend que **ainda não foi verificado** e é marcado como _interface a confirmar_. A API foi validada por testes unitários e e2e com PostgreSQL real, sem interface, sem offline e sem o teste de backup (ver `relatorio-validacao-tecnica.md`). Campos: `inventario-campos.md`. Requisitos (RF): `requisitos-funcionais.md`. Regras (RN): `regras-de-negocio.md`. Decisões: `decisoes-pendentes.md`.

## 1. Quem usa o sistema

**Existe um único tipo de usuário: a conta ativa.** A equipe decidiu eliminar a divisão entre administrador e operador, e o código, o banco, o contrato e os testes foram ajustados: todas as contas ativas fazem as mesmas operações, em qualquer unidade (RN010).

| Pergunta                     | Resposta                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quem entra?                  | Quem tem login válido no Supabase Auth **e** conta liberada e ativa na API. Sem token → 401; sem liberação ou desativada → 403                                                                                                             |
| O que pode fazer?            | Tudo o que os fluxos abaixo descrevem: cadastrar e editar animais, passar animais entre áreas, registrar eventos de saúde e atendimentos, gerar o PDF, cadastrar e editar responsáveis, consultar a linha do tempo e a auditoria, arquivar |
| O que não pode?              | Usar a foto enviada por outra conta (RN008); mexer em registros que a API não permite alterar (movimentações, auditoria, atendimentos excluídos)                                                                                           |
| Como uma conta é liberada?   | Fora da API: `npm run usuario:liberar -- --email … [--nome …] [--desativar]` (sem papel e sem unidade)                                                                                                                                     |
| E as contas que já existiam? | Continuam acessando: a migration só remove o papel e os vínculos com unidades; ninguém foi apagado nem desativado                                                                                                                          |

O que continua protegendo os dados, **independente de perfil**: autenticação obrigatória; conta ativa; validação de entrada; versão e idempotência contra sobrescrita e duplicidade; auditoria sem dados pessoais nem texto clínico (RN025); respostas sem cache.

---

## Fluxo 1 — Cadastro de animal

- **Objetivo:** registrar a entrada de um animal com ficha, foto e responsável.
- **Ator:** qualquer conta ativa.
- **Pré-condições:** espécie e responsável já existem; foto enviada e confirmada pela própria conta.
- **RF/RN:** RF001–RF012; RN001–RN013, RN039, RN056. **Situação:** API implementada; interface a confirmar.

**Passo a passo (API)**

1. **Reunir as informações.** Espécie, frente (CCPA, CasAdote ou CED), responsável, uma foto; e, conforme a frente, microchip, sexo, idade, peso e porte (passo 10).
2. **Carregar as opções.** Espécies `GET /species`; raças da espécie `GET /breeds?especieId=`; responsáveis `GET /responsibles`; frentes `GET /fronts`.
3. **Espécie e raça.** A raça é opcional e precisa pertencer à espécie (o banco rejeita combinação inválida → 400). Onça: espécie "Onça", raça "Onça-pintada" ou "Onça-parda".
4. **Responsável.** Selecionar um existente; se não existir, criar antes (Fluxo 2). O endereço mora no responsável.
5. **Unidade.** **Não é preenchida pela pessoa** e **não decide acesso**. Sem `unidadeId`, vale a unidade de mesmo nome da frente (CCPA, CED, CasAdote); se não existir, 400. A unidade é informativa e independente da frente (RN056).
6. **Localização física.** Não existe mais no cadastro; enviar `localizacaoId` retorna 400.
7. **Foto.** `POST /fotos` (com `Idempotency-Key`) devolve uma URL de envio; a imagem vai direto ao Storage; `POST /fotos/{id}/confirmacao` confere tipo e tamanho. Só a conta que enviou a foto pode vinculá-la.
8. **Enviar o cadastro.** `POST /animals` com **`Idempotency-Key` obrigatório** (UUID v4, o mesmo em reenvios).
9. **Validação.** Campo desconhecido, UUID inválido, texto acima do limite → 400 com `mensagem` descrevendo o problema.
10. **Campos por frente.** Silvestre: exige **nome**, dispensa o resto. Não silvestre em **CCPA ou CED**: exige microchip, sexo, idade aproximada (em meses), peso e porte (e foto). **CasAdote**: nada além do básico. Falta de campo → 400 listando cada falta (DP-01: regra confirmada na reunião de validação).
11. **Duplicidade.** Microchip já usado por animal ativo → 409 com o animal existente em `detalhes`, para continuar o atendimento nele em vez de duplicar a ficha.
12. **Resultado.** 201 com a ficha e o identificador público gerado pelo servidor. A **entrada** é gravada na linha do tempo do animal (Fluxo 12). Repetir a mesma requisição com a mesma chave devolve **200** e o mesmo animal.
13. **Consultar depois.** `GET /animals/{id}` e `GET /animals` com `busca`, `nome`, `identificadorPublico`, `microchip`, `especieId`, `frente`, `unidadeId`, paginação.
14. **Editar / arquivar.** `PATCH /animals/{id}` com `versao`; versão antiga → 409 (recarregar). `DELETE` arquiva (não apaga).

**Erros:** 400 validação, 401 sem token, 403 conta sem acesso liberado ou foto de outra conta, 404 animal inexistente, 409 versão/microchip/chave reutilizada com outro conteúdo.

**Interface a confirmar:** ordem dos campos, rótulos, máscaras, mensagens.

---

## Fluxo 2 — Responsável

- **Objetivo:** manter quem responde pelo animal (tutor ou quem entregou) e seu endereço.
- **Ator:** qualquer conta ativa. **RF/RN:** RF013–RF015; RN014–RN017, RN025. **Situação:** implementado; interface a confirmar.

1. **Listar** `GET /responsibles`: nome, endereço, e-mail e telefone, igual para toda conta.
2. **Criar** `POST /responsibles`: `nome` (≥2 caracteres úteis) obrigatório; `endereco`, `email`, `telefone` opcionais. Nome só com espaços → 400. E-mail inválido → 400.
3. **Editar** `PATCH /responsibles/{id}`: ao menos um campo; qualquer conta pode editar qualquer responsável. A mudança vale para **todos** os animais ligados a ele.
4. **Relação com animais:** muitos animais para um responsável. Cada atendimento clínico guarda o responsável da época; o **endereço** exibido é o do cadastro atual.
5. **Auditoria:** a edição registra _quais_ campos mudaram, **não** o e-mail nem o telefone.
6. **Limitações:** sem endpoint para desativar responsável, sem controle de versão (última escrita vence) e endereço em texto livre (DP-17, bloqueada por decisão de negócio).

---

## Fluxo 3 — Evento de saúde (vacina, vermífugo, castração)

Recurso **diferente** do atendimento clínico: registra um fato pontual de saúde.

- **Ator:** qualquer conta ativa. **RF/RN:** RF016–RF018. **Situação:** implementado.

1. `POST /animals/{animalId}/health-events`: `tipo` (VACINA, VERMIFUGO, CASTRACAO) e `data` obrigatórios; `descricao` e `observacoes` opcionais (sem limite de tamanho — DP-18). `Idempotency-Key` **opcional** (DP-19).
2. `GET` lista por data, mais recente primeiro (filtro `tipo`). `DELETE …/{id}` arquiva (cadastrado por engano).
3. Não há edição. Eventos aparecem no PDF do prontuário.
4. **Erros:** animal inexistente ou arquivado → 404.

---

## Fluxo 4 — Atendimento clínico (prontuário)

- **Objetivo:** registrar a avaliação clínica de um animal e seu histórico.
- **Ator:** qualquer conta ativa. **Pré-condição:** animal ativo.
- **RF/RN:** RF019–RF026; RN018–RN026. **Situação:** implementado no código e coberto por testes unitários e e2e (executados).

**Tipos:** `ADMISSAO` (a avaliação inicial; **uma só por animal ativo**) e `ACOMPANHAMENTO` (quantos forem necessários).

1. **Criar** `POST /animals/{animalId}/atendimentos` com **`Idempotency-Key` obrigatório**. Todos os campos são opcionais: `tipo`, `dataAtendimento` (padrão: agora), `anamnese`, `exameFisico`, `examesComplementares`, `tratamento` (texto livre, até 10 000 caracteres cada). Sem `tipo`: o primeiro atendimento é admissão, os demais acompanhamento.
2. **Identificação:** o atendimento não copia dados; a resposta traz `animal` e `responsavel` por relacionamento. O responsável gravado é o **vigente na criação**.
3. **Segunda admissão** → 409. Duas admissões simultâneas: o banco recusa a segunda (409).
4. **Histórico:** `GET …/atendimentos` (mais recente primeiro). Nada é sobrescrito por um novo atendimento. **Não há exclusão.**
5. **Editar** `PATCH …/atendimentos/{id}` com **`versao` obrigatório**. Não aceita `tipo`. Versão desatualizada → 409. Se nada mudou de fato, devolve o registro sem gravar nem auditar.
6. **Reenvio:** mesma `Idempotency-Key` + mesmo conteúdo → 200 com o mesmo atendimento. Mesma chave com conteúdo ou animal diferente → 409.
7. **Auditoria:** criação e edição são registradas; a edição guarda só os **nomes** das seções alteradas.
8. **Exames complementares** são **texto**. **Não há anexos** (DP-20).
9. **Erros:** 400, 404, 409.

---

## Fluxo 5 — Consulta e emissão do prontuário (PDF)

- `GET /animals/{id}/prontuario` gera um PDF com dados do animal (inclui o **endereço do responsável**), eventos de saúde e **todos** os atendimentos clínicos (data no fuso de São Paulo, tipo, responsável da época, as quatro seções).
- Qualquer conta ativa gera; animal inexistente ou arquivado → 404. O PDF não é salvo no servidor. Texto fora do alfabeto suportado (ex.: emoji) vira "?".
- **RF/RN:** RF027; RN027. **Limitações:** não inclui a linha do tempo de áreas; datas de entrada e de eventos de saúde saem em UTC (DP-16).

---

## Fluxo 6 — Fotos e arquivos

1. `POST /fotos` (`id` UUID gerado pelo cliente, `tipoMidia` jpeg/png/webp, `tamanhoBytes` ≤ 8 MiB, com `Idempotency-Key`): cria o registro PENDENTE e devolve a URL assinada de envio (válida 2 h).
2. O cliente envia o arquivo direto ao Storage (fora da API).
3. `POST /fotos/{id}/confirmacao` (com `Idempotency-Key`): confere que o arquivo existe, tipo igual ao declarado e tamanho dentro do limite; marca CONFIRMADA.
4. Só a foto **confirmada**, da **própria conta**, pode ser ligada a um animal; uma foto serve a um só animal.
5. A manutenção remove fotos pendentes expiradas e confirmadas sem ficha após 30 dias.
6. **Não existe** anexo de exame clínico nem outra foto: a foto de entrada é a única.

---

## Fluxo 7 — Auditoria

- `GET /auditoria` (**qualquer conta ativa**) com filtros `entidade` (Animal, HealthEvent, Foto, Responsible, AtendimentoClinico), `entidadeId`, `usuarioId`, `requisicaoId`; 50 por página.
- Registra: animal criado/atualizado/arquivado, evento de saúde criado/arquivado, foto confirmada, responsável criado/atualizado, atendimento criado/atualizado. Cada evento tem usuário, instante, unidade, frente e id da requisição.
- **O que não grava:** e-mail e telefone do responsável, texto clínico e o conteúdo de `observacoes` do animal — só que o campo mudou (RN025).
- A trilha só recebe inserções (gatilho do banco). Leituras **não** são auditadas.
- **É uma trilha técnica.** A consulta operacional das passagens entre áreas é a linha do tempo (Fluxo 12).
- Administração de contas: **fora da API**, por `npm run usuario:liberar`.

---

## Fluxo 8 — Outros processos encontrados

| Processo               | Onde                                      | Resumo                                                                                     |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Disponibilidade        | `GET /health`, `GET /health/ready`        | Públicos; o segundo confirma banco e bucket de fotos privado                               |
| Manutenção             | `ManutencaoService`, `npm run manutencao` | Remove fotos órfãs e chaves de idempotência com mais de 30 dias                            |
| Backup                 | `npm run backup`, `backup:verificar`      | Dump do banco + cópia do Storage + verificação de restauração                              |
| Seed                   | `npm run db:seed`                         | Cria catálogos mínimos (espécies, unidades, localizações, responsável padrão); idempotente |
| Token de teste / smoke | `npm run token`, `npm run smoke`          | Utilitários de operação                                                                    |
| **Offline**            | —                                         | **Não implementado** (DP-21); o backend só oferece idempotência e versão                   |

---

## Fluxo 9 — Identificação do animal por microchip

- **Ator:** qualquer conta ativa. **RF/RN:** RF040, RF007; RN007. **Situação:** implementado (unit e e2e executados).
- **Campo:** `microchip` (texto numérico de 1 a 20 dígitos).

1. Informar o microchip no cadastro (obrigatório em CED/CCPA para não silvestres; opcional nos demais casos).
2. A API guarda como **texto**: zeros à esquerda e 20 dígitos são preservados. Letras ou mais de 20 dígitos → 400.
3. Número já usado por animal **ativo** → 409, com o animal existente em `detalhes`.
4. `GET /animals?microchip=` é exato; a busca livre aceita o início do número. Arquivar libera o número.

---

## Fluxo 10 — Animais silvestres e mantenedor

- **Ator:** qualquer conta ativa. **RF/RN:** RF002, RF041, RF044; RN001, RN050, RN051, RN053. **Situação:** silvestre implementado; mantenedor **parcial** (é a unidade).

1. A espécie escolhida tem `silvestre` verdadeiro (ex.: "Onça", "Outro silvestre").
2. O **nome** passa a ser obrigatório; sexo, idade, peso, porte e microchip ficam dispensados, em qualquer frente. Sem nome → 400.
3. Dois silvestres com o mesmo nome podem existir; cada um tem `id` e identificador público próprios (DP-03).
4. O microchip **pode** ser informado junto com o nome; a regra apenas o dispensa (DP-02).
5. **Mantenedor** é o **local onde ficam os silvestres**, modelado como a **unidade "Mantenedor"** do catálogo (decisão da reunião de validação, `wad.md` §7.5). O vínculo é a unidade do animal (`unidadeId`); entradas e saídas dessa unidade aparecem na linha do tempo. Não há entidade nem campo próprio. Pendente: obrigatoriedade do vínculo e se o mantenedor também é uma pessoa/organização com dados (DP-06).

---

## Fluxo 11 — Entrada no CED/CCPA, passagem entre áreas e recebimento pelo CasAdote

- **Ator:** qualquer conta ativa. **RF/RN:** RF042, RF046; RN002–RN004, RN047–RN049, RN055, RN056. **Situação:** a operação existe e foi testada; a **restrição de transições** não foi definida pela equipe (DP-07). A área se chama `CASADOTE` / "CasAdote" (DP-10).

1. **Entrada no CED ou no CCPA:** cadastro com `frente` CED ou CCPA. Para não silvestres, exige microchip, sexo, idade, peso, porte (e foto).
2. **Passagem:** `PATCH /animals/{id}` com `versao` e `frente` de destino (e `unidadeId`, se a unidade também muda). É o **mesmo cadastro**: `id`, identificador público, microchip, foto, eventos de saúde, atendimentos e linha do tempo permanecem; `versao` aumenta.
3. **Registro:** a passagem é gravada em `MovimentacaoAnimal` (origem, destino, usuário, instante) na mesma transação; a auditoria registra a mesma edição.
4. **Recebimento pelo CasAdote:** o animal chega com a identificação completa; o CasAdote não repete as exigências. Um cadastro **novo** direto no CasAdote também é aceito.
5. **Volta para CED/CCPA:** só é aceita se o cadastro tiver os cinco campos; senão, 400 e nada muda (inclusive a linha do tempo).
6. **Quem pode:** qualquer conta ativa, em qualquer unidade; depois da passagem **todas** continuam vendo a ficha (corrige o problema em que uma conta restrita à unidade de origem perdia o acesso).
7. **Matriz de transições**

| De \ Para | CED                      | CCPA                     | CasAdote                                           |
| --------- | ------------------------ | ------------------------ | -------------------------------------------------- |
| (entrada) | confirmada pela equipe   | confirmada pela equipe   | aceita pelo código; **não confirmada** pela equipe |
| CED       | —                        | aceita; **não definida** | **confirmada pela equipe**                         |
| CCPA      | aceita; **não definida** | —                        | **confirmada pela equipe**                         |
| CasAdote  | aceita; **não definida** | aceita; **não definida** | —                                                  |

O código aceita todas, desde que os dados de identificação existam quando o destino é CED ou CCPA. Restringir as "não definidas" é a pendência DP-07. 8. **Frente e unidade:** trocar só a `frente` não muda a unidade (RN056). 9. **Erros:** 409 (versão desatualizada), 400 (dados de identificação faltando).

---

## Fluxo 12 — Histórico do animal

- **RF/RN:** RF009, RF016–RF017, RF022, RF043; RN047, RN052. **Situação:** implementado.

1. **Ficha atual:** `GET /animals/{id}` (frente atual, unidade, responsável e endereço).
2. **Linha do tempo de áreas:** `GET /animals/{id}/movimentacoes` (qualquer conta, mais recente primeiro): entrada (origem nula) e cada passagem de frente ou unidade, com nomes das unidades, usuário e instante. Funciona também para animal arquivado; nada nela é alterado ou apagado pela API.
3. **Eventos de saúde:** `GET /animals/{animalId}/health-events`.
4. **Atendimentos clínicos:** `GET /animals/{animalId}/atendimentos` — todos seguem ligados ao animal, de qualquer área.
5. **Auditoria técnica:** `GET /auditoria?entidade=Animal&entidadeId=…` (valores técnicos antes/depois).
6. **Limites:** animais anteriores a esta versão começam com a linha do tempo vazia (as passagens antigas existem só na auditoria); o PDF não inclui a linha do tempo.

---

## Fluxo 13 — Encerramento do ciclo

**Não suportado como processo.** Existe apenas o arquivamento lógico (`DELETE /animals/{id}`), que retira o animal das consultas sem apagar o registro **nem a linha do tempo**. Não há desfecho (adoção, óbito, devolução) — DP-12.
