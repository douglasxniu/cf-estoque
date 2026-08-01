-- Endereço de entrega opcional no checkout — guardado junto do registro imutável da guia
-- pra sair impresso no PDF (mapa estático com pin) e ficar consultável depois.
ALTER TABLE checkouts ADD COLUMN destino_endereco TEXT;
ALTER TABLE checkouts ADD COLUMN destino_lat REAL;
ALTER TABLE checkouts ADD COLUMN destino_lng REAL;
