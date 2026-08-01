-- Pontos de referência perto do endereço de entrega (JSON array de strings) — gerados a
-- partir de lugares reais (Geoapify Places) fraseados pela Workers AI, impressos como
-- rodapé abaixo do mapa na Nota de Transporte.
ALTER TABLE checkouts ADD COLUMN destino_pontos_json TEXT;
