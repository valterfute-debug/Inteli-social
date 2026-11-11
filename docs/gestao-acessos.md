# Gestão de acessos

Somente contas autenticadas, ativas e com `gerenciaEquipe` habilitado podem listar a equipe, convidar por e-mail e ativar ou desativar outra conta. O guard consulta essa permissão no banco em cada requisição, além da validação global da conta. Todos mantêm acesso às demais funções da plataforma. Para evitar bloqueio acidental, uma pessoa não pode desativar a própria conta. Cada alteração é registrada na auditoria sem senha ou token.

Após aplicar a migration, todas as contas começam sem permissão de gestão. A primeira conta administradora deve ser escolhida pela Ampara e habilitada por uma operação controlada no banco; nenhuma promoção é automática. Novos convites não concedem essa permissão. A interface para transferir ou conceder administração ainda não está implementada.

## Configuração do convite por e-mail

- Configurar `CONVITE_REDIRECT_URL` com o endereço HTTPS da aplicação seguido de `/ativar-acesso`, sem parâmetros, fragmento ou credenciais.
- Adicionar exatamente esse endereço à lista de redirecionamentos permitidos do Supabase Auth.
- Configurar um remetente SMTP no Supabase Auth, como Resend, e validar domínio, quotas e entrega. A API usa o mecanismo de convite do Supabase; não solicita nem armazena senha.
- Validar o fluxo completo com contas sintéticas, inclusive convite vencido, link já utilizado, e-mail não entregue, conta desativada e erro entre o envio e a gravação local, antes de publicar.

A API registra primeiro uma solicitação durável com e-mail normalizado e uma restrição única. Com isso, tentativas concorrentes ou posteriores não disparam novo convite enquanto uma solicitação existir. O provedor envia o convite antes de a API registrar a conta; depois, conta, auditoria e conclusão da solicitação são gravadas na mesma transação. Se o provedor ou essa transação falhar, a solicitação permanece pendente e impede o reenvio automático, inclusive quando o resultado externo é incerto. Um operador precisa verificar o estado no Auth e na tabela `Usuario` antes de resolver a pendência; não existe ainda tela ou processo automatizado de reconciliação e reenvio. Não considerar o fluxo pronto para produção antes de definir esse procedimento e testá-lo com o provedor real.

A solicitação registra quem iniciou, quando e qual endereço foi solicitado; a auditoria recebe `CONVITE_SOLICITADO` antes da chamada externa. O identificador também é enviado nos metadados do convite para ajudar a investigação, mas metadados do usuário não são prova isolada de autorização. Na reconciliação, um responsável deve conferir conjuntamente a solicitação pendente, os registros de Auth e de `Usuario`, a auditoria e a evidência de entrega do provedor. Caso o Auth tenha criado a conta esperada, mas não exista `Usuario`, a correção deve criar o vínculo, registrar a decisão na auditoria e concluir a solicitação em uma única transação controlada. Se o estado externo não puder ser confirmado, mantenha a pendência e não reenvie. O procedimento operacional de correção e sua validação em ambiente real ainda precisam ser concluídos; não há rotina automática para fazer essa alteração.

## Contrato

- `GET /api/v1/equipe`: lista até 200 pessoas e informa `temMais`.
- `POST /api/v1/equipe/convites`: recebe `{ "nome": "...", "email": "..." }`.
- `PATCH /api/v1/equipe/:id/acesso`: recebe `{ "ativo": false }` para desativar ou `true` para reativar.

Não há convite por QR Code nem recuperação automática de confirmação incerta nesta entrega. Não enviar links de convite, tokens ou dados pessoais a logs.
