CREATE TABLE itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'Outro',
  quantidade INTEGER NOT NULL DEFAULT 0,
  unidade TEXT NOT NULL DEFAULT 'un',
  modelo TEXT,
  voltagem TEXT,
  codigo TEXT,
  imagem TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_itens_codigo_unico
  ON itens(codigo) WHERE codigo IS NOT NULL AND codigo != '';

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

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'operador',
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now'))
);

-- Fila de etiquetas pendentes de impressão numa etiquetadora térmica — ver
-- migration_fila_impressao.sql. Nenhuma automação de impressão consome isso ainda; é só o
-- registro do que precisou ser impresso, pronto pra quando essa automação for implementada.
CREATE TABLE fila_impressao_etiquetas (
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
