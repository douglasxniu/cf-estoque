-- Remove solicitações duplicadas causadas por duplo-clique nos botões de confirmação
-- (mesmo ot/item/quantidade/local, criadas com segundos de diferença), mantendo a
-- primeira linha de cada grupo e devolvendo ao estoque a quantidade duplicada
-- (nenhuma delas estava com status 'devolvido', então o estoque estava debitado a mais).
DELETE FROM solicitacoes WHERE id IN (40,59,50,61,46,49,75,76,77,78,79,80,52,68,69,71,72);

UPDATE itens SET quantidade = quantidade + 2   WHERE id = 24;  -- TRANSFORMADOR 12V 200W
UPDATE itens SET quantidade = quantidade + 30  WHERE id = 58;  -- DIFUSOR BRANCO
UPDATE itens SET quantidade = quantidade + 2   WHERE id = 35;  -- TRANSFORMADOR 12V120W
UPDATE itens SET quantidade = quantidade + 4   WHERE id = 33;  -- TRANSFORMADOR 12V60W
UPDATE itens SET quantidade = quantidade + 600 WHERE id = 63;  -- CABO ELETRICO Vermelho e Preto
UPDATE itens SET quantidade = quantidade + 1   WHERE id = 30;  -- TRANSFORMADOR 24V 150
UPDATE itens SET quantidade = quantidade + 2   WHERE id = 42;  -- TRANSFORMADOR 24V 300W
