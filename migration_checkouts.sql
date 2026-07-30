CREATE TABLE checkouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ot TEXT,
  retirado_por TEXT,
  itens_json TEXT NOT NULL,
  criado_por TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);
