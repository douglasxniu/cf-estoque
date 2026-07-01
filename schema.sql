CREATE TABLE itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'Outro',
  quantidade INTEGER NOT NULL DEFAULT 0,
  unidade TEXT NOT NULL DEFAULT 'un',
  modelo TEXT,
  voltagem TEXT,
  imagem TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE projetos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  nome TEXT,
  setor TEXT,
  status TEXT NOT NULL DEFAULT 'aberto',
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE solicitacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projeto_id INTEGER,
  item_id INTEGER NOT NULL,
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

CREATE TABLE unidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  serial TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'disponivel',
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE solicitacao_unidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitacao_id INTEGER NOT NULL,
  unidade_id INTEGER NOT NULL,
  vinculado_em TEXT DEFAULT (datetime('now')),
  devolvido_em TEXT
);
CREATE UNIQUE INDEX idx_solicitacao_unidades_ativo
  ON solicitacao_unidades(unidade_id) WHERE devolvido_em IS NULL;
