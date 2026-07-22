-- Fila de etiquetas pendentes de impressão numa etiquetadora térmica (Brother QL-820NWB
-- ou similar). Por enquanto só grava o que "Gerar Etiquetas" já gerou em PDF — nenhuma
-- automação real consome isso ainda. Serve pra, quando a impressão térmica for implementada,
-- já existir um histórico de tudo que precisou ser impresso, sem perder nada no meio tempo.
CREATE TABLE IF NOT EXISTS fila_impressao_etiquetas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ot TEXT NOT NULL,
  nome_projeto TEXT,
  item_nome TEXT NOT NULL,
  local_uso TEXT,
  observacao TEXT,
  unit_idx INTEGER NOT NULL DEFAULT 1,
  unit_total INTEGER NOT NULL DEFAULT 1,
  impresso INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now'))
);
