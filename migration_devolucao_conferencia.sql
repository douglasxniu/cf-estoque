-- Conferência na devolução de OT: permite apontar que um item/unidade não voltou completo
-- (faltando/avariada) em vez de assumir sempre que tudo retornou. Ver devolverSolicitacao()
-- em src/worker.js.
ALTER TABLE solicitacoes ADD COLUMN obs_devolucao TEXT;
ALTER TABLE solicitacoes ADD COLUMN devolvida_com_pendencia INTEGER NOT NULL DEFAULT 0;
