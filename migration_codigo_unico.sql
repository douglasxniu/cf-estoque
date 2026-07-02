-- Impede códigos (SKU) duplicados entre itens, mas permite múltiplos itens sem código
-- (codigo NULL ou vazio) — só valida quando há um valor real preenchido.
CREATE UNIQUE INDEX IF NOT EXISTS idx_itens_codigo_unico
  ON itens(codigo) WHERE codigo IS NOT NULL AND codigo != '';
