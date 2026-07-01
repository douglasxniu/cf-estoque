CREATE TABLE IF NOT EXISTS projetos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  nome TEXT,
  setor TEXT,
  status TEXT NOT NULL DEFAULT 'aberto',
  criado_em TEXT DEFAULT (datetime('now'))
);

ALTER TABLE solicitacoes ADD COLUMN projeto_id INTEGER;

INSERT INTO projetos (numero, setor, status, criado_em)
SELECT
  s.ot,
  (SELECT s2.setor FROM solicitacoes s2 WHERE s2.ot = s.ot ORDER BY s2.id LIMIT 1),
  CASE WHEN EXISTS (SELECT 1 FROM solicitacoes s3 WHERE s3.ot = s.ot AND s3.status != 'devolvido') THEN 'aberto' ELSE 'encerrado' END,
  MIN(s.data)
FROM solicitacoes s
GROUP BY s.ot;

UPDATE solicitacoes SET projeto_id = (SELECT id FROM projetos WHERE projetos.numero = solicitacoes.ot);
