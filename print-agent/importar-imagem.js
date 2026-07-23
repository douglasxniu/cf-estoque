// Extrai etiquetas de um print screen de um sistema de OT de produção externo (troféus,
// credenciais, etc — formato livre, sem estrutura fixa) usando a API de visão da
// Anthropic. Diferente de importar-pdf.js (que lê texto real de um PDF nosso, sem IA),
// aqui é uma imagem qualquer e o "entendimento" da tabela fica por conta do modelo.
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Anthropic = require('@anthropic-ai/sdk');

const PROMPT = `Você está vendo um recorte de uma ordem de trabalho (OT) de produção interna (gráfica/manufatura — troféus, credenciais, impressos, etc).

Extraia os itens físicos a produzir, um por variante distinta. Se o mesmo produto tiver
variantes (cores, tamanhos, códigos de material diferentes), crie uma entrada separada por
variante, com a quantidade daquela variante específica — não some tudo numa linha só.

Ignore etapas de processo que não são o produto físico final (ex: "Arte Final", horas de
trabalho, datas de entrega) e campos técnicos do template que estejam vazios/zerados.

Responda SOMENTE com um array JSON, sem texto antes ou depois, nesse formato exato:
[{"nome": "nome do item/produto", "variante": "cor/tamanho/código, ou vazio se não houver", "quantidade": numero_inteiro, "obs": "detalhe extra relevante, ou vazio"}]`;

function clienteAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada (ver print-agent/.env)');
  return new Anthropic({ apiKey });
}

async function extrairLabelsDaImagem(buffer, mimeType) {
  const client = clienteAnthropic();
  const msg = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') } },
        { type: 'text', text: PROMPT }
      ]
    }]
  });
  const texto = msg.content.find(b => b.type === 'text')?.text || '';
  const jsonMatch = texto.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('A IA não retornou uma lista reconhecível. Resposta: ' + texto.slice(0, 200));
  let itens;
  try { itens = JSON.parse(jsonMatch[0]); } catch (e) { throw new Error('JSON da IA inválido: ' + e.message); }
  return itens
    .map(it => ({
      nome: String(it.nome || '').trim(),
      local: String(it.variante || '').trim(),
      obs: String(it.obs || '').trim(),
      quantidade: Math.max(1, Math.min(500, parseInt(it.quantidade, 10) || 1))
    }))
    .filter(it => it.nome);
}

module.exports = { extrairLabelsDaImagem };
