-- Zoom do mapa de entrega escolhido pelo usuário no checkout — usado tanto na prévia
-- quanto na imagem impressa no PDF/guia pública, pra manter consistência entre os dois.
ALTER TABLE checkouts ADD COLUMN destino_zoom INTEGER;
