# Gestão de acessos

Somente contas autenticadas, ativas e com `gerenciaEquipe` habilitado podem listar a equipe, convidar por e-mail e ativar ou desativar outra conta. O guard consulta essa permissão no banco em cada requisição, além da validação global da conta. Todos mantêm acesso às demais funções da plataforma. Para evitar bloqueio acidental, uma pessoa não pode desativar a própria conta. Cada alteração é registrada na auditoria sem senha ou token.

Após aplicar a migration, todas as contas começam sem permissão de gestão. A primeira conta administradora deve ser escolhida pela Ampara e habilitada por uma operação controlada no banco; nenhuma promoção é automática. Novos convites não concedem essa permissão. A interface para transferir ou conceder administração ainda não está implementada.

## Configuração do convite por e-mail

- Configurar `CONVITE_REDIRECT_URL` com o endereço HTTPS da aplicação seguido de `/ativar-acesso`, sem parâmetros, fragmento ou credenciais.
- Adicionar exatamente esse endereço à lista de redirecionamentos permitidos do Supabase Auth.
- Configurar um remetente SMTP no Supabase Auth, como Resend, e validar domínio, quotas e entrega. A API usa o mecanismo de convite do Supabase; não solicita nem armazena senha.
- Validar o fluxo completo com contas sintéticas, inclusive convite vencido, link já utilizado, e-mail não entregue, conta desativada e erro entre o envio e a gravação local, antes de publicar.

O provedor envia o convite antes de a API registrar a conta. Se a gravação falhar após o envio, a API retorna erro e a conta não recebe liberação pela API; é necessária reconciliação antes de reenviar. Esse cenário ainda precisa de um fluxo operacional confiável e teste de integração com o provedor antes do uso real.

## Contrato

- `GET /api/v1/equipe`: lista até 200 pessoas e informa `temMais`.
- `POST /api/v1/equipe/convites`: recebe `{ "nome": "...", "email": "..." }`.
- `PATCH /api/v1/equipe/:id/acesso`: recebe `{ "ativo": false }` para desativar ou `true` para reativar.

Não há convite por QR Code nem recuperação automática de confirmação incerta nesta entrega. Não enviar links de convite, tokens ou dados pessoais a logs.
