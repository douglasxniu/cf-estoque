-- Resumo público de uma OT alimentada no painel de Etiquetas Térmicas (print-agent) —
-- separado da tabela de solicitações porque os itens podem vir de sistemas externos (ex:
-- import de print screen de produção de terceiros), sem corresponder a nenhuma OT real do
-- Estoque. O QR "resumo da OT" gerado no print-agent aponta pra cá, não pra /api/ot/:ot.
CREATE TABLE etiquetas_resumo (
  ot TEXT PRIMARY KEY,
  nome_ot TEXT,
  itens_json TEXT NOT NULL,
  atualizado_em TEXT DEFAULT (datetime('now'))
);
