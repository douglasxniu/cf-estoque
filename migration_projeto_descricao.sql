-- Descrição livre da OT — separa "criar a OT" (número + nome + descrição) de "solicitar
-- itens" (que já tinha suas próprias observações por item). Antes não existia lugar pra
-- anotar do que se trata o trabalho antes mesmo de saber quais itens vai precisar.
ALTER TABLE projetos ADD COLUMN descricao TEXT;
