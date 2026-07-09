-- Permite item_id NULL em solicitacoes, pra suportar itens "avulsos" (não cadastrados no
-- estoque) adicionados a uma OT — não reservam nem devolvem quantidade de nenhum item.
-- SQLite não suporta alterar NOT NULL de uma coluna existente, então a tabela é recriada.
PRAGMA foreign_keys=OFF;

CREATE TABLE solicitacoes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projeto_id INTEGER,
  item_id INTEGER,
  item_nome TEXT NOT NULL,
  unidade TEXT,
  quantidade INTEGER NOT NULL,
  ot TEXT NOT NULL,
  solicitante TEXT NOT NULL,
  setor TEXT,
  local_uso TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  data TEXT DEFAULT (datetime('now'))
);

INSERT INTO solicitacoes_new (id, projeto_id, item_id, item_nome, unidade, quantidade, ot, solicitante, setor, local_uso, status, data)
SELECT id, projeto_id, item_id, item_nome, unidade, quantidade, ot, solicitante, setor, local_uso, status, data FROM solicitacoes;

DROP TABLE solicitacoes;
ALTER TABLE solicitacoes_new RENAME TO solicitacoes;

UPDATE sqlite_sequence SET name='solicitacoes' WHERE name='solicitacoes_new';

PRAGMA foreign_keys=ON;
