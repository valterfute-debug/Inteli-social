-- Mantenedor passa a ser uma atuação (frente), como pediu a Ampara na entrega da sprint.
-- Aditiva: só acrescenta o valor ao enum. A unidade "Mantenedor" do catálogo continua e é a
-- unidade derivada dessa frente. Animais antigos não são movidos de frente aqui (o PostgreSQL
-- não deixa usar um valor de enum na mesma transação em que ele é criado); quem estiver na
-- unidade Mantenedor pode ser passado para a frente MANTENEDOR pela edição normal da ficha.
ALTER TYPE "Front" ADD VALUE IF NOT EXISTS 'MANTENEDOR';
