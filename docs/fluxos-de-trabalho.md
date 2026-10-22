# Fluxos de trabalho — o que cada pessoa faz no sistema

Escrito para três públicos: quem trabalha na Ampara, quem desenvolve e quem está começando. Branch `feat/integrar-cadastro-e-prontuario`.

**Leia antes:** este repositório é só o **backend (API)**. Não existe tela aqui. Cada fluxo descreve o que a API faz e exige; "o que a pessoa vê" depende de um frontend que **ainda não foi verificado** e é marcado como _interface a confirmar_. Os nomes de campos estão em `inventario-campos.md`; os requisitos (RF) em `requisitos-funcionais.md`; as regras (RN) em `regras-de-negocio.md`. **A API foi validada por 184 testes unitários e 83 testes de ponta a ponta com PostgreSQL real (sem interface, sem offline, sem o teste de backup — ver `relatorio-validacao-tecnica.md`).**

## 1. Perfis reais

Só existem dois papéis no código (`enum PapelUsuario`, `prisma/schema.prisma`; escopo em `src/auth/escopo.ts`). Nenhum outro foi inventado.

|                                              | ADMIN                                    | OPERADOR                                                                         |
| -------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| Objetivo                                     | Coordenar a operação e acompanhar tudo   | Cadastrar e acompanhar animais das unidades em que trabalha                      |
| Unidades                                     | Todas (`todasUnidades`)                  | Só as vinculadas a ele (`UsuarioUnidade`)                                        |
| Animais, eventos de saúde, atendimentos, PDF | Todos                                    | Só os de unidades vinculadas; fora delas, 403                                    |
| Responsáveis (lista)                         | Vê nome, endereço, **e-mail e telefone** | Vê nome e endereço                                                               |
| Responsáveis (editar)                        | Qualquer um                              | Só quem não tem animais ativos ou tem ao menos um animal ativo nas suas unidades |
| Auditoria (`GET /auditoria`)                 | Pode consultar                           | **Proibido** (403)                                                               |
| Foto                                         | Pode vincular foto de outra pessoa       | Só vincula foto que ele mesmo enviou                                             |

Conta que fez login no Supabase mas não foi liberada na API, ou foi desativada, recebe **403** em todas as rotas (exceto `/health`). A liberação é feita por linha de comando (`npm run usuario:liberar`), não pela API.

**Os perfis estão em discussão.** A equipe questionou a separação ADMIN × OPERADOR porque o negócio gira em torno do fluxo do animal entre áreas. O código foi mantido como está: hoje os dois perfis fazem as mesmas operações de negócio nas unidades que acessam; o que muda é o alcance (todas as unidades × unidades vinculadas), a auditoria e os dados de contato dos responsáveis. A decisão está em aberto (DP-13, DP-14, DP-15) e não foi simplificada para não afrouxar acesso a dados pessoais.

---

## Fluxo 1 — Cadastro de animal

- **Objetivo:** registrar a entrada de um animal com ficha, foto e responsável.
- **Ator:** OPERADOR ou ADMIN com acesso à unidade.
- **Pré-condições:** conta ativa; espécie e responsável já existem; foto enviada e confirmada.
- **RF/RN:** RF001–RF012; RN001–RN013, RN039. **Situação:** API implementada; interface a confirmar.

**Passo a passo (API)**

1. **Reunir as informações.** Espécie, frente (CCPA, CasAdote ou CED), responsável, uma foto; e, conforme a frente, microchip, sexo, idade, peso e porte (passo 10).
2. **Carregar as opções.** Espécies `GET /species`; raças da espécie escolhida `GET /breeds?especieId=`; responsáveis `GET /responsibles`; frentes `GET /fronts`.
3. **Escolher espécie e raça.** A raça é opcional e precisa pertencer à espécie (o banco rejeita combinação inválida → 400). Para onça: espécie "Onça", raça "Onça-pintada" ou "Onça-parda".
4. **Responsável.** Selecionar um existente; se não existir, criar antes (Fluxo 2). O endereço mora no responsável, não no animal.
5. **Unidade.** **Não é preenchida pela pessoa.** O servidor usa a unidade enviada (se houver), senão a única unidade do operador, senão a unidade de mesmo nome da frente. Se nada se aplica, 400. Se a unidade não for acessível à pessoa, 403. _Decisão de negócio pendente (INC-10)._
6. **Localização física.** Não existe mais no cadastro; enviar `localizacaoId` retorna 400.
7. **Foto.** `POST /fotos` (com `Idempotency-Key`) devolve uma URL de envio; a imagem é enviada direto ao Storage; `POST /fotos/{id}/confirmacao` confere tipo e tamanho. Só foto confirmada serve.
8. **Enviar o cadastro.** `POST /animals` com **`Idempotency-Key` obrigatório** (UUID v4, o mesmo em reenvios).
9. **Validação.** Campo desconhecido, UUID inválido, texto acima do limite → 400 com `mensagem` descrevendo o problema.
10. **Campos por frente.** Silvestre: exige **nome**, dispensa o resto. Não silvestre em **CCPA ou CED**: exige microchip, sexo, idade aproximada, peso e porte. **CasAdote**: nada além do básico. Falta de campo → 400 listando cada falta.
11. **Duplicidade.** Microchip já usado por animal ativo → 409; se o animal está numa unidade acessível, o corpo indica qual (para oferecer transferência em vez de duplicar).
12. **Resultado.** 201 com a ficha, incluindo identificador público gerado pelo servidor. Repetir a mesma requisição com a mesma chave devolve **200** e o mesmo animal (sem duplicar).
13. **Consultar depois.** `GET /animals/{id}` (ficha completa, com `responsavelEndereco`, `racaNome`, URL da foto) e `GET /animals` com `busca`, `nome`, `identificadorPublico`, `microchip`, `especieId`, `frente`, `unidadeId`, paginação.
14. **Editar / arquivar.** `PATCH /animals/{id}` com `versao`; versão antiga → 409 (recarregar). `DELETE` arquiva (não apaga).

**Erros:** 400 validação, 401 sem token, 403 conta sem acesso ou unidade não permitida, 404 animal inexistente, 409 versão/microchip/chave reutilizada com outro conteúdo.

**Interface a confirmar:** ordem dos campos, rótulos, máscaras, botão de "salvar e iniciar prontuário", mensagens exibidas.

---

## Fluxo 2 — Responsável

- **Objetivo:** manter quem responde pelo animal (tutor ou quem entregou) e seu endereço.
- **Ator:** qualquer conta ativa para criar e listar; edição conforme escopo.
- **RF/RN:** RF012–RF015; RN014–RN017. **Situação:** implementado; interface a confirmar.

1. **Listar** `GET /responsibles`: nome e endereço para todos; **e-mail e telefone só para ADMIN**.
2. **Criar** `POST /responsibles`: `nome` (≥2 caracteres úteis) obrigatório; `endereco`, `email`, `telefone` opcionais. Nome só com espaços → 400. E-mail inválido → 400.
3. **Editar** `PATCH /responsibles/{id}`: ao menos um campo. OPERADOR sem vínculo com o responsável → 403. A mudança vale para **todos** os animais ligados a ele.
4. **Relação com animais:** muitos animais para um responsável. Cada atendimento clínico guarda o responsável da época; trocar o responsável do animal não altera atendimentos antigos (mas o **endereço** exibido é o do cadastro atual).
5. **Auditoria:** a edição registra _quais_ campos mudaram, **não** o e-mail nem o telefone.
6. **Limitações:** não há endpoint para desativar/arquivar responsável (INC-15); a edição não tem controle de versão (INC-18); endereço é um texto livre.

---

## Fluxo 3 — Evento de saúde (vacina, vermífugo, castração)

Recurso **diferente** do atendimento clínico: registra um fato pontual de saúde.

- **Ator:** acesso à unidade do animal. **RF/RN:** RF016–RF018. **Situação:** implementado.

1. `POST /animals/{animalId}/health-events`: `tipo` (VACINA, VERMIFUGO, CASTRACAO) e `data` obrigatórios; `descricao` e `observacoes` opcionais (sem limite de tamanho — INC-14). `Idempotency-Key` **opcional**.
2. `GET` lista por data, mais recente primeiro (filtro `tipo`). `DELETE …/{id}` arquiva (cadastrado por engano).
3. Não há edição. Eventos aparecem no PDF do prontuário.
4. **Erros:** animal inexistente → 404; fora da unidade → 403.

---

## Fluxo 4 — Atendimento clínico (prontuário)

- **Objetivo:** registrar a avaliação clínica de um animal e seu histórico.
- **Ator:** acesso à unidade do animal. **Pré-condição:** animal ativo.
- **RF/RN:** RF019–RF026; RN018–RN026. **Situação:** implementado no código e coberto por testes unitários e e2e (executados).

**Tipos:** `ADMISSAO` (a avaliação inicial; **uma só por animal ativo**) e `ACOMPANHAMENTO` (quantos forem necessários).

1. **Criar** `POST /animals/{animalId}/atendimentos` com **`Idempotency-Key` obrigatório**. Todos os campos são opcionais: `tipo`, `dataAtendimento` (padrão: agora), `anamnese`, `exameFisico`, `examesComplementares`, `tratamento` (texto livre, até 10 000 caracteres cada). Sem `tipo`: o primeiro atendimento é admissão, os demais acompanhamento.
2. **Identificação:** o atendimento não copia dados; a resposta traz `animal` (identificador público, nome, espécie, raça, sexo) e `responsavel` (nome, endereço) por relacionamento. O responsável gravado é o **vigente na criação**.
3. **Segunda admissão** → 409. Duas admissões simultâneas: o banco recusa a segunda (409).
4. **Histórico:** `GET …/atendimentos` (mais recente primeiro, paginado). Nada é sobrescrito por um novo atendimento. **Não há exclusão.**
5. **Editar** `PATCH …/atendimentos/{id}` com **`versao` obrigatório**. Não aceita `tipo`. Versão desatualizada → 409 (recarregar e reaplicar). Duas edições simultâneas: só uma vence, a outra recebe 409. Se nada mudou de fato, devolve o registro sem gravar nem auditar.
6. **Reenvio:** mesma `Idempotency-Key` + mesmo conteúdo → 200 com o mesmo atendimento. Mesma chave com conteúdo ou animal diferente → 409.
7. **Auditoria:** criação e edição são registradas; a edição guarda só os **nomes** das seções alteradas, nunca o texto clínico.
8. **Exames complementares** são **texto**. **Não há anexos** de exame.
9. **Erros:** 400 (texto longo, campo desconhecido), 403, 404, 409.

**Interface a confirmar:** quando iniciar o prontuário (após o cadastro ou por ação explícita), como apresentar o histórico, tratamento de conflito de versão.

---

## Fluxo 5 — Consulta e emissão do prontuário (PDF)

- `GET /animals/{id}/prontuario` gera um PDF com: dados do animal (identificador, nome, espécie, raça, sexo, porte, cor, idade, peso, data de entrada, frente, unidade, responsável e **endereço do responsável**), histórico de eventos de saúde e **todos** os atendimentos clínicos (data no fuso de São Paulo, tipo, responsável da época, as quatro seções).
- Exige acesso à unidade do animal (403/404 caso contrário); só inclui dados do animal solicitado.
- O PDF não é salvo no servidor. Texto fora do alfabeto suportado (ex.: emoji) vira "?" para não impedir a geração.
- **RF/RN:** RF027; RN027. **Limitações:** a localização física não aparece (removida); eventos de saúde usam data em UTC (INC-13); não há anexos.

---

## Fluxo 6 — Fotos e arquivos

1. `POST /fotos` (`id` UUID gerado pelo cliente, `tipoMidia` jpeg/png/webp, `tamanhoBytes` ≤ 8 MiB, com `Idempotency-Key`): cria o registro PENDENTE e devolve a URL assinada de envio (válida 2 h).
2. O cliente envia o arquivo direto ao Storage (fora da API).
3. `POST /fotos/{id}/confirmacao` (com `Idempotency-Key`): confere que o arquivo existe, tipo igual ao declarado e tamanho dentro do limite; marca CONFIRMADA. Foto pendente expirada não confirma.
4. Só a foto **confirmada**, do próprio usuário (ou ADMIN), pode ser ligada a um animal; uma foto serve a um só animal.
5. Rotina de manutenção remove fotos pendentes expiradas e confirmadas sem ficha após 30 dias.
6. **Não existe** anexo de exame clínico, nem foto de atendimento. A foto de entrada é a única.

---

## Fluxo 7 — Auditoria e administração

- `GET /auditoria` (**só ADMIN**) com filtros `entidade` (Animal, HealthEvent, Foto, Responsible, AtendimentoClinico), `entidadeId`, `usuarioId`, `requisicaoId`; 50 por página.
- Registra: animal criado/atualizado/arquivado (com campos alterados, antes e depois), evento de saúde criado/arquivado, foto confirmada, responsável criado/atualizado (só nomes dos campos), atendimento criado/atualizado (só nomes das seções). Cada evento tem usuário, instante, unidade, frente e id da requisição.
- A trilha só recebe inserções (gatilho do banco recusa UPDATE/DELETE dentro do prazo de retenção).
- **Limites:** auditoria de animais guarda valores antes/depois (inclui nome, observações); leituras (consultas) **não** são auditadas; `GET /me` mostra papel e unidades da própria conta.
- Administração de contas: **fora da API**, por `npm run usuario:liberar` (`--email`/`--id`, `--papel`, `--unidade`, `--desativar`).

---

## Fluxo 8 — Outros processos encontrados (os Fluxos 9 a 13 vêm ao final)

| Processo               | Onde                                      | Resumo                                                                                     |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Disponibilidade        | `GET /health`, `GET /health/ready`        | Públicos; o segundo confirma banco e bucket de fotos privado                               |
| Manutenção             | `ManutencaoService`, `npm run manutencao` | Remove fotos órfãs e chaves de idempotência com mais de 30 dias                            |
| Backup                 | `npm run backup`, `backup:verificar`      | Dump do banco + cópia do Storage + verificação de restauração                              |
| Seed                   | `npm run db:seed`                         | Cria catálogos mínimos (espécies, unidades, localizações, responsável padrão); idempotente |
| Token de teste / smoke | `npm run token`, `npm run smoke`          | Utilitários de operação                                                                    |
| **Offline**            | —                                         | **Não implementado** (RF planejado); o backend só oferece idempotência e versão            |

---

## Fluxo 9 — Identificação do animal por microchip

- **Ator:** quem cadastra ou edita (OPERADOR com acesso à unidade, ou ADMIN). **RF/RN:** RF040, RF007; RN007. **Situação:** implementado (testes unitários e e2e executados).
- **Campos:** `microchip` (texto numérico de 1 a 20 dígitos).

1. Informar o microchip no cadastro (obrigatório em CED e CCPA para não silvestres; opcional nos demais casos).
2. A API guarda o número como **texto**: zeros à esquerda e 20 dígitos são preservados. Letras ou mais de 20 dígitos → 400.
3. Se o número já pertence a um animal **ativo** → 409; o corpo traz o identificador do animal existente quando ele está numa unidade acessível ao usuário, para continuar o atendimento nele em vez de duplicar a ficha.
4. A consulta por `GET /animals?microchip=` é exata; a busca livre aceita o início do número.
5. Arquivar o animal libera o número.

**Pendente:** formato definitivo do microchip (DP-04).

## Fluxo 10 — Animais silvestres e mantenedor

- **Ator:** quem cadastra. **RF/RN:** RF002, RF041, RF044; RN001, RN050, RN051, RN053. **Situação:** silvestre implementado; **mantenedor não implementado**.

1. A espécie escolhida tem `silvestre` verdadeiro (ex.: "Onça", "Outro silvestre").
2. O **nome** passa a ser obrigatório; sexo, idade, peso, porte e microchip ficam dispensados (em qualquer frente). Sem nome → 400.
3. Dois silvestres com o mesmo nome podem existir; cada um tem `id` e identificador público próprios.
4. O código **não proíbe** informar também o microchip (decisão pendente: DP-02). Duplicidade de silvestres com o mesmo nome não é bloqueada (DP-03).
5. **Mantenedor:** não existe campo nem entidade. O único vestígio é a unidade "Mantenedor" no seed. Nada foi implementado (DP-05, DP-06).

## Fluxo 11 — Entrada no CED/CCPA, passagem entre áreas e recebimento pelo CasAdote

- **Ator:** OPERADOR com acesso às unidades envolvidas, ou ADMIN. **RF/RN:** RF042, RF046; RN002–RN004, RN047–RN049, RN054. **Situação:** a operação existe e foi testada; **as condições da passagem não foram definidas pela equipe** (DP-07, DP-08, DP-14). O nome "CasAdot" não existe no código: a área é `CASADOTE` / "CasAdote" (DP-10).

1. **Entrada no CED ou no CCPA:** cadastro com `frente` CED ou CCPA. Para não silvestres, exige microchip, sexo, idade, peso, porte (e foto). É nessas áreas que se concentram as exigências de entrada.
2. **Passagem:** `PATCH /animals/{id}` com `versao` e `frente` de destino (e `unidadeId`, se a unidade também muda). É o **mesmo cadastro**: `id`, identificador público, microchip, foto, eventos de saúde e atendimentos permanecem; `versao` aumenta.
3. **Recebimento pelo CasAdote:** o animal chega com a identificação já completa; o CasAdote não repete as exigências. Um cadastro **novo** direto no CasAdote também é aceito sem os cinco campos.
4. **Volta para CED/CCPA:** só é aceita se o cadastro tiver os cinco campos; senão, 400 e nada muda.
5. **Quem pode:** na passagem com troca de unidade, o usuário precisa ter acesso à unidade de **origem e de destino** (senão 403). Um operador só do CED não envia o animal ao CasAdote, e quem só tem a origem perde o acesso à ficha depois da passagem.
6. **Sem sequência obrigatória:** o código não impõe CED → CCPA nem qualquer ordem, e permite qualquer troca de `frente` (inclusive CasAdote → CED).
7. **Frente e unidade:** trocar só a `frente` não muda a unidade.
8. **Erros:** 409 (versão desatualizada), 403 (sem acesso), 400 (campos faltando para CED/CCPA).

## Fluxo 12 — Histórico do animal

- **RF/RN:** RF009, RF016–RF017, RF022, RF043; RN047, RN052. **Situação:** parcial.

1. **Ficha atual:** `GET /animals/{id}` (frente atual, unidade, responsável e endereço).
2. **Eventos de saúde:** `GET /animals/{animalId}/health-events`.
3. **Atendimentos clínicos:** `GET /animals/{animalId}/atendimentos` — todos os atendimentos, de qualquer área, seguem ligados ao animal.
4. **Passagens entre áreas:** não há consulta própria. Só a trilha de auditoria (`GET /auditoria?entidade=Animal&entidadeId=…`, **apenas ADMIN**) registra `front`/`unitId` antes e depois, usuário e instante (DP-09).
5. **PDF:** `GET /animals/{id}/prontuario` reúne ficha, eventos e atendimentos; **não** inclui a linha do tempo de áreas.

## Fluxo 13 — Encerramento do ciclo

**Não suportado como processo.** Existe apenas o arquivamento lógico do animal (`DELETE /animals/{id}`), que o retira das consultas sem apagar o registro. Não há desfecho (adoção, óbito, devolução) — DP-12.
