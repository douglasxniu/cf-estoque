CREATE TABLE IF NOT EXISTS solicitacao_unidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitacao_id INTEGER NOT NULL,
  unidade_id INTEGER NOT NULL,
  vinculado_em TEXT DEFAULT (datetime('now')),
  devolvido_em TEXT
);

-- uma unidade só pode ter um vínculo ATIVO por vez (ou seja, só pode estar "no evento" de uma OT de cada vez)
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitacao_unidades_ativo
  ON solicitacao_unidades(unidade_id) WHERE devolvido_em IS NULL;
