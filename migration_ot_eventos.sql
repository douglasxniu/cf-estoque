-- Canal de mensagens/eventos por OT: mistura eventos automáticos (mudança de quantidade,
-- item adicionado/removido, aprovação/devolução) com observações escritas por pessoas —
-- num único feed cronológico por OT, no estilo de canal de trabalho (Linear/Jira/Slack).
CREATE TABLE ot_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ot TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'evento', -- 'evento' (automático) | 'mensagem' (escrito por alguém)
  autor TEXT,
  texto TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ot_eventos_ot ON ot_eventos(ot);
CREATE INDEX idx_ot_eventos_criado ON ot_eventos(criado_em);
