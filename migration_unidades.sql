CREATE TABLE IF NOT EXISTS unidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  serial TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'disponivel',
  criado_em TEXT DEFAULT (datetime('now'))
);
