#!/usr/bin/env node
// Painel web LOCAL pra montar/editar o lote de etiquetas antes de mandar pra Zebra.
// Roda só nesta máquina (não faz parte do deploy do Worker), mas escuta em 0.0.0.0 pra
// poder ser acessado de outros dispositivos na mesma rede Wi-Fi.
//
//   node server.js [porta]     (porta padrão: 4000)
//
// Estado em memória (some ao reiniciar o servidor — não é um banco de dados).
'use strict';
const express = require('express');
const multer = require('multer');
const os = require('os');
const { imprimir, gerarPDF, TAMANHOS, TAMANHO_PADRAO, nivelDeConteudo } = require('./imprimir');
const { extrairLabelsDoPDF } = require('./importar-pdf');
const { extrairLabelsDaImagem } = require('./importar-imagem');

const SITE_URL = 'https://estoque.niupt.workers.dev'; // pro QR de resumo da OT

const PORT = Number(process.argv[2]) || 4000;
const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// OT/nome do projeto são um cabeçalho único pra toda a fila, preenchido uma vez só —
// não é um campo por item.
let cabecalho = { ot: '', nomeOt: '' };
let fila = []; // [{nome, local, obs, quantidade}]

function ipsLocais() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const nome of Object.keys(nets)) {
    for (const n of nets[nome]) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  return ips;
}

function totalEtiquetas() {
  return fila.reduce((s, l) => s + (l.quantidade || 1), 0);
}
function estado() {
  return { cabecalho, fila, total: totalEtiquetas() };
}

app.get('/api/estado', (req, res) => res.json(estado()));

app.post('/api/cabecalho', (req, res) => {
  const { ot, nomeOt } = req.body || {};
  cabecalho = { ot: ot || '', nomeOt: nomeOt || '' };
  res.json(estado());
});

app.post('/api/fila', (req, res) => {
  const { nome, local, obs, quantidade } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ error: 'Nome do item é obrigatório.' });
  fila.push({
    nome: String(nome).trim(), local: local || '', obs: obs || '',
    quantidade: Math.max(1, Math.min(50, parseInt(quantidade, 10) || 1))
  });
  res.json(estado());
});

// edita qualquer campo de uma linha já existente (nome, local, obs, quantidade)
app.patch('/api/fila/:idx', (req, res) => {
  const idx = parseInt(req.params.idx, 10);
  if (idx < 0 || idx >= fila.length) return res.status(404).json({ error: 'Índice inválido.' });
  const atual = fila[idx];
  const { nome, local, obs, quantidade } = req.body || {};
  if (nome !== undefined && !String(nome).trim()) return res.status(400).json({ error: 'Nome do item é obrigatório.' });
  fila[idx] = {
    nome: nome !== undefined ? String(nome).trim() : atual.nome,
    local: local !== undefined ? local : atual.local,
    obs: obs !== undefined ? obs : atual.obs,
    quantidade: quantidade !== undefined ? Math.max(1, Math.min(50, parseInt(quantidade, 10) || 1)) : atual.quantidade
  };
  res.json(estado());
});

app.delete('/api/fila/:idx', (req, res) => {
  const idx = parseInt(req.params.idx, 10);
  if (idx < 0 || idx >= fila.length) return res.status(404).json({ error: 'Índice inválido.' });
  fila.splice(idx, 1);
  res.json(estado());
});

app.delete('/api/fila', (req, res) => { fila = []; res.json(estado()); });

// importa um PDF já gerado por este sistema — NÃO cai direto na fila, volta pro cliente
// pra revisão/edição num popup antes de confirmar (ver POST /api/fila/lote).
app.post('/api/importar-pdf', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  try {
    const extraidos = await extrairLabelsDoPDF(req.file.buffer);
    if (!extraidos.length) return res.status(422).json({ error: 'Não consegui reconhecer nenhuma etiqueta nesse PDF.' });
    const primeiro = extraidos.find(l => l.ot || l.nomeOt);
    res.json({ itens: extraidos, cabecalhoSugerido: primeiro ? { ot: primeiro.ot || '', nomeOt: primeiro.nomeOt || '' } : null });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao ler o PDF: ' + e.message });
  }
});

// importa um print screen de um sistema externo (formato livre, sem estrutura fixa) via
// IA de visão — idem, volta pro cliente pra revisão antes de confirmar.
app.post('/api/importar-imagem', upload.single('imagem'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
  try {
    const extraidos = await extrairLabelsDaImagem(req.file.buffer, req.file.mimetype);
    if (!extraidos.length) return res.status(422).json({ error: 'A IA não reconheceu nenhum item nessa imagem.' });
    res.json({ itens: extraidos });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao analisar a imagem: ' + e.message });
  }
});

// confirma o resultado (já revisado/editado no popup) e só aí entra na fila de verdade
app.post('/api/fila/lote', (req, res) => {
  const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
  const validos = itens.filter(it => it && String(it.nome || '').trim());
  if (!validos.length) return res.status(400).json({ error: 'Nenhum item válido pra adicionar.' });
  if (req.body.cabecalho && !cabecalho.ot && !cabecalho.nomeOt) {
    cabecalho = { ot: req.body.cabecalho.ot || '', nomeOt: req.body.cabecalho.nomeOt || '' };
  }
  validos.forEach(it => fila.push({
    nome: String(it.nome).trim(), local: it.local || '', obs: it.obs || '',
    quantidade: Math.max(1, Math.min(500, parseInt(it.quantidade, 10) || 1))
  }));
  res.json({ ...estado(), adicionados: validos.length });
});

// mescla várias linhas da fila numa só, somando as quantidades — útil quando a IA (ou
// importação de PDF) separa o mesmo item em duas linhas por engano
app.post('/api/fila/mesclar', (req, res) => {
  const indices = Array.isArray(req.body.indices) ? [...new Set(req.body.indices)].sort((a, b) => a - b) : [];
  if (indices.length < 2) return res.status(400).json({ error: 'Selecione pelo menos 2 itens pra mesclar.' });
  if (indices.some(i => i < 0 || i >= fila.length)) return res.status(400).json({ error: 'Índice inválido.' });
  const selecionados = indices.map(i => fila[i]);
  const mesclado = {
    nome: selecionados[0].nome,
    local: selecionados[0].local,
    obs: selecionados[0].obs,
    quantidade: selecionados.reduce((s, l) => s + (l.quantidade || 1), 0)
  };
  fila = fila.filter((_, i) => !indices.includes(i));
  fila.splice(indices[0], 0, mesclado);
  res.json(estado());
});

// o QR de resumo só entra no lote nos tamanhos grande/média — no pequeno não sobra espaço
// útil pro texto ao lado, e ainda assim vale mais um QR avulso (ver /api/imprimir-qr).
function podeIncluirQrNoLote(tamanhoChave) {
  const tam = TAMANHOS[tamanhoChave] || TAMANHOS[TAMANHO_PADRAO];
  return nivelDeConteudo(tam.w, tam.h) !== 'pequena';
}

// expande a fila atual (com quantidade) em N etiquetas físicas numeradas 1/N, 2/N...,
// opcionalmente com o QR de resumo como primeira etiqueta — usado tanto pra imprimir
// quanto só pra gerar/salvar o PDF.
function montarLabelsDaFila({ comQr, tamanho }) {
  const labels = [];
  if (comQr && cabecalho.ot && podeIncluirQrNoLote(tamanho)) {
    labels.push({ tipoQr: true, titulo: `OT ${cabecalho.ot}`, url: `${SITE_URL}/ot-resumo.html?ot=${encodeURIComponent(cabecalho.ot)}` });
  }
  fila.forEach(l => {
    const total = l.quantidade || 1;
    for (let i = 1; i <= total; i++) {
      labels.push({ ot: cabecalho.ot, nomeOt: cabecalho.nomeOt, nome: l.nome, local: l.local, obs: l.obs, unitIdx: i, unitTotal: total });
    }
  });
  return labels;
}

app.post('/api/imprimir', async (req, res) => {
  if (!fila.length) return res.status(400).json({ error: 'A fila está vazia.' });
  const tamanho = req.body.tamanho;
  const labels = montarLabelsDaFila({ comQr: req.body.comQr, tamanho });
  try {
    const arquivo = await imprimir(labels, { comLogo: !!req.body.comLogo, tamanho });
    fila = [];
    res.json({ ok: true, arquivo });
  } catch (e) {
    res.status(500).json({ error: e.message, stderr: e.stderr ? e.stderr.toString() : undefined });
  }
});

// só gera o PDF e devolve pra download — não manda pra impressora, não esvazia a fila.
// Pra quem quer imprimir depois (nesta máquina ou levando o arquivo pra outro lugar).
app.post('/api/gerar-pdf', async (req, res) => {
  if (!fila.length) return res.status(400).json({ error: 'A fila está vazia.' });
  const tamanho = req.body.tamanho;
  const labels = montarLabelsDaFila({ comQr: req.body.comQr, tamanho });
  try {
    const doc = await gerarPDF(labels, { comLogo: !!req.body.comLogo, tamanho });
    const buffer = Buffer.from(doc.output('arraybuffer'));
    const nome = `etiquetas${cabecalho.ot ? '-' + cabecalho.ot.replace(/[^\w-]/g, '') : ''}-${Date.now()}.pdf`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nome}"` });
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// imprime só uma etiqueta com o QR de resumo da OT, sem nenhum item — funciona em
// qualquer tamanho, inclusive os pequenos (só o QR, sem texto do lado).
app.post('/api/imprimir-qr', async (req, res) => {
  if (!cabecalho.ot) return res.status(400).json({ error: 'Preencha a OT no cabeçalho antes.' });
  const labels = [{ tipoQr: true, titulo: `OT ${cabecalho.ot}`, url: `${SITE_URL}/ot-resumo.html?ot=${encodeURIComponent(cabecalho.ot)}` }];
  try {
    const arquivo = await imprimir(labels, { tamanho: req.body.tamanho });
    res.json({ ok: true, arquivo });
  } catch (e) {
    res.status(500).json({ error: e.message, stderr: e.stderr ? e.stderr.toString() : undefined });
  }
});

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Etiquetas Térmicas · NIU Estoque</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCA0MCI+CiAgPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iOCIgZmlsbD0iIzFjMWMxYSIvPgogIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDEuOCwxNC44OSkiIGZpbGw9IiNmZmZmZmYiPgogICAgPHJlY3QgeD0iMTYuOTYiIHk9IjAiIHdpZHRoPSIyLjQ3IiBoZWlnaHQ9IjEwLjIyIi8+CiAgICA8cGF0aCBkPSJNMjIuMDQsNC44M1YwaDIuNDd2NC43NGMwLDIuMDkuNiwzLjEsMS44OCwzLjFzMi44LS43Nyw0LjUzLTIuMDNsMi45OC0yLjA2VjBoMi41djEwLjIyaC0yLjMyYzAtMS4xMywwLTIuODYuMDYtMy45OS0zLjk5LDIuNjgtNS43OCwzLjk5LTguMTQsMy45OS0yLjUzLDAtMy45Ni0xLjY0LTMuOTYtNS4zOSIvPgogICAgPHBhdGggZD0iTTE0LjM2LDUuMzl2NC44M2gtMi40N3YtNC43NGMwLTIuMDktLjYtMy4xLTEuODgtMy4xcy0yLjguNzctNC41MywyLjAzbC0yLjk4LDIuMDZ2My43NkgwVjBoMi4zMmMwLDEuMTMsMCwyLjg2LS4wNiwzLjk5QzYuMjYsMS4zMSw4LjA1LDAsMTAuNCwwYzIuNTMsMCwzLjk2LDEuNjQsMy45Niw1LjM5Ii8+CiAgPC9nPgo8L3N2Zz4K">
<style>
:root{color-scheme:dark}
:root,:root[data-theme="dark"]{
  --bg:#0b0d12; --surface:#12151c; --surface-2:#1a1e28; --surface-3:#20242f;
  --border:#262b36; --border-soft:#1d212b;
  --text:#e9ebf0; --muted:#8b91a0; --muted-2:#5b6070;
  --primary:#5b8cff; --primary-2:#7c5cff; --on-primary:#fff;
  --danger:#f0575c; --danger-bg:rgba(240,87,92,.12); --danger-border:rgba(240,87,92,.35);
  --success:#34c98f; --success-bg:rgba(52,201,143,.12);
  --shadow:0 12px 32px -14px rgba(0,0,0,.55);
  --shadow-sm:0 2px 8px rgba(0,0,0,.25);
}
:root[data-theme="light"]{
  --bg:#f3f4f7; --surface:#ffffff; --surface-2:#f7f8fa; --surface-3:#eef0f4;
  --border:#e1e4ea; --border-soft:#ececf0;
  --text:#161922; --muted:#666c7c; --muted-2:#9096a3;
  --primary:#3f6cf0; --primary-2:#7c4de0; --on-primary:#fff;
  --danger:#d8434c; --danger-bg:rgba(216,67,76,.08); --danger-border:rgba(216,67,76,.25);
  --success:#1f9d6e; --success-bg:rgba(31,157,110,.1);
  --shadow:0 12px 32px -16px rgba(20,22,35,.18);
  --shadow-sm:0 2px 10px rgba(20,22,35,.06);
}
@media (prefers-color-scheme: light){ :root:not([data-theme]){
  --bg:#f3f4f7; --surface:#ffffff; --surface-2:#f7f8fa; --surface-3:#eef0f4;
  --border:#e1e4ea; --border-soft:#ececf0;
  --text:#161922; --muted:#666c7c; --muted-2:#9096a3;
  --primary:#3f6cf0; --primary-2:#7c4de0; --on-primary:#fff;
  --danger:#d8434c; --danger-bg:rgba(216,67,76,.08); --danger-border:rgba(216,67,76,.25);
  --success:#1f9d6e; --success-bg:rgba(31,157,110,.1);
  --shadow:0 12px 32px -16px rgba(20,22,35,.18);
  --shadow-sm:0 2px 10px rgba(20,22,35,.06);
}}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:28px 20px 70px;background:var(--bg);color:var(--text);transition:background .15s,color .15s}
h1{font-size:1.15rem;margin:0 0 2px;letter-spacing:-.01em;font-weight:700}
h2{font-weight:700}
strong{font-weight:600}
.sub{color:var(--muted);font-size:.8rem;margin-bottom:20px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;margin-bottom:16px;box-shadow:var(--shadow-sm)}
.card-titulo{display:flex;align-items:center;gap:8px;font-size:.68rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px}
.card-titulo .ic{width:14px;height:14px;flex-shrink:0;opacity:.85}
label{display:block;font-size:.72rem;font-weight:700;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}
input,textarea,select{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border);border-radius:9px;background:var(--surface-2);color:var(--text);font-size:.9rem;margin-bottom:10px;font-family:inherit;transition:border-color .12s,background .12s}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--primary);background:var(--surface)}
input::placeholder{color:var(--muted-2)}
select{cursor:pointer}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
button{border:none;border-radius:9px;padding:10px 16px;font-weight:700;cursor:pointer;font-size:.85rem;font-family:inherit;transition:filter .12s,background .12s,transform .05s}
button:active{transform:scale(.98)}
.btn-primary{background:linear-gradient(135deg,var(--primary),var(--primary-2));color:var(--on-primary);width:100%;box-shadow:0 4px 14px -4px rgba(91,140,255,.5)}
.btn-primary:hover{filter:brightness(1.08)}
.btn-ghost{background:var(--surface-2);color:var(--text);border:1px solid var(--border)}
.btn-ghost:hover{background:var(--surface-3)}
.btn-sm{padding:6px 11px;font-size:.74rem;border-radius:7px}
.item{padding:12px 0;border-bottom:1px solid var(--border-soft)}
.item:last-child{border-bottom:none}
.item-view{display:flex;justify-content:space-between;align-items:center;gap:10px}
.item .info b{display:block;font-size:.9rem;font-weight:600}
.item .info span{font-size:.76rem;color:var(--muted)}
.item .acoes{display:flex;gap:6px;flex-shrink:0}
.item .rm{background:var(--danger-bg);color:var(--danger);border:1px solid var(--danger-border)}
.item .rm:hover{background:var(--danger-border)}
.item .ed{background:var(--surface-2);color:var(--text);border:1px solid var(--border)}
.item-edit{display:none;margin-top:10px}
.item-edit.aberto{display:block}
.item-edit .row2{margin-bottom:0}
.item-edit input{margin-bottom:8px}
.empty{color:var(--muted);text-align:center;padding:24px 10px;font-size:.85rem}
.counter{background:var(--surface-3);color:var(--muted);border:1px solid var(--border);font-size:.68rem;font-weight:700;border-radius:20px;padding:3px 10px;margin-left:8px}
.footer-actions{display:flex;gap:8px;margin-top:18px;position:sticky;bottom:16px}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.brand svg{width:50px;height:auto;flex-shrink:0;color:var(--text)}
.brand-info{flex:1;min-width:0}
.theme-toggle{width:36px;height:36px;border-radius:10px;background:var(--surface);border:1px solid var(--border);color:var(--muted);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;padding:0}
.theme-toggle:hover{color:var(--text);background:var(--surface-2)}
.theme-toggle svg{width:17px;height:17px}
.theme-toggle .ic-sun{display:none}
.theme-toggle .ic-moon{display:block}
[data-theme="light"] .theme-toggle .ic-sun{display:block}
[data-theme="light"] .theme-toggle .ic-moon{display:none}
.import-row{display:flex;gap:8px;align-items:center}
.import-row input[type=file]{flex:1;margin-bottom:0;padding:8px}
.hint{font-size:.72rem;color:var(--muted);margin-top:8px;line-height:1.5}
@keyframes girar{to{transform:rotate(360deg)}}
.spinner{display:inline-block;width:13px;height:13px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:girar .7s linear infinite;vertical-align:-2px;margin-right:7px}
.btn-ghost .spinner{border-color:var(--border);border-top-color:var(--text)}
button:disabled{opacity:.7;cursor:wait}
@keyframes pulsar{0%,100%{opacity:1}50%{opacity:.45}}
.analisando{color:var(--primary)!important;font-weight:600}
.analisando .ponto{animation:pulsar 1.1s ease-in-out infinite}
.analisando .ponto:nth-child(2){animation-delay:.15s}
.analisando .ponto:nth-child(3){animation-delay:.3s}
.progress-bar{height:3px;background:var(--surface-3);border-radius:3px;overflow:hidden;margin-top:8px;display:none}
.progress-bar.ativo{display:block}
.progress-bar .fill{height:100%;width:40%;background:linear-gradient(90deg,var(--primary),var(--primary-2));border-radius:3px;animation:varrer 1.2s ease-in-out infinite}
@keyframes varrer{0%{margin-left:-40%}100%{margin-left:100%}}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 18px;font-size:.85rem;max-width:90vw;box-shadow:var(--shadow);z-index:999;opacity:0;pointer-events:none;transition:opacity .2s}
.toast.mostrar{opacity:1}
.toast.erro{border-color:var(--danger-border);color:var(--danger);background:var(--danger-bg)}
.toast.sucesso{border-color:var(--primary);color:var(--text)}
.modal-fundo{display:none;position:fixed;inset:0;background:rgba(8,9,13,.65);backdrop-filter:blur(2px);z-index:900;align-items:flex-start;justify-content:center;overflow-y:auto;padding:40px 16px}
.modal-fundo.aberto{display:flex}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px;max-width:580px;width:100%;box-shadow:var(--shadow)}
.modal h2{font-size:1.05rem;margin:0 0 4px}
.modal .sub{margin-bottom:16px}
.rev-item{background:var(--surface-2);border:1px solid var(--border);border-radius:11px;padding:14px;margin-bottom:10px}
.rev-item input{margin-bottom:8px}
.rev-item .row2{margin-bottom:0}
.rev-item .row2 input{margin-bottom:0}
.rev-item-topo{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.rev-item-topo span{font-size:.68rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.modal-acoes{display:flex;gap:8px;margin-top:14px}
.check-row{display:flex;align-items:center;gap:8px;text-transform:none;cursor:pointer;font-size:.85rem;font-weight:500;color:var(--text)}
.check-row input{width:auto;margin:0;flex-shrink:0}
</style></head>
<body>
<script>
(function(){
  var salvo = localStorage.getItem('etTema');
  if(salvo) document.documentElement.setAttribute('data-theme', salvo);
})();
</script>
<div class="toast" id="toast"></div>
<div class="modal-fundo" id="modalRevisao">
  <div class="modal">
    <h2>Confira antes de adicionar</h2>
    <div class="sub hint" style="margin-top:0">A leitura automática pode errar — revise e corrija cada item antes de confirmar. Itens removidos aqui não entram na fila.</div>
    <div id="revLista"></div>
    <div class="modal-acoes">
      <button class="btn-ghost" style="flex:1" onclick="cancelarRevisao()">Cancelar tudo</button>
      <button class="btn-primary" style="flex:2" onclick="confirmarRevisao()">Adicionar à fila</button>
    </div>
  </div>
</div>
<div class="brand">
  <svg viewBox="0 0 36.4 10.22" fill="currentColor"><rect x="16.96" y="0" width="2.47" height="10.22"/><path d="M22.04,4.83V0h2.47v4.74c0,2.09.6,3.1,1.88,3.1s2.8-.77,4.53-2.03l2.98-2.06V0h2.5v10.22h-2.32c0-1.13,0-2.86.06-3.99-3.99,2.68-5.78,3.99-8.14,3.99-2.53,0-3.96-1.64-3.96-5.39"/><path d="M14.36,5.39v4.83h-2.47v-4.74c0-2.09-.6-3.1-1.88-3.1s-2.8.77-4.53,2.03l-2.98,2.06v3.76H0V0h2.32c0,1.13,0,2.86-.06,3.99C6.26,1.31,8.05,0,10.4,0c2.53,0,3.96,1.64,3.96,5.39"/></svg>
  <div class="brand-info">
    <h1>Etiquetas Térmicas</h1>
    <div class="sub" style="margin-bottom:0">NIU Experience Agency · Impressora Zebra GC420d</div>
  </div>
  <button class="theme-toggle" id="themeToggle" title="Alternar tema" aria-label="Alternar tema claro/escuro">
    <svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    <svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
  </button>
</div>

<div class="card">
  <div class="card-titulo"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 3 3 21M15 3h6v6M9 21H3v-6"/></svg>Tamanho da etiqueta</div>
  <select id="tamanho">
    ${Object.entries(TAMANHOS).map(([chave, t]) => `<option value="${chave}" ${chave === TAMANHO_PADRAO ? 'selected' : ''}>${t.label} (${t.w}x${t.h}mm)</option>`).join('')}
  </select>
  <div class="hint">Precisa bater com o rolo físico carregado na impressora — e com o PageSize padrão configurado na fila CUPS (troca de rolo exige reconfigurar isso também).</div>
</div>

<div class="card">
  <div class="card-titulo"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>Importar PDF gerado pelo site</div>
  <div class="import-row">
    <input type="file" id="arquivoPdf" accept="application/pdf">
    <button class="btn-ghost btn-sm" id="btnImportarPdf" onclick="importarPdf()">Importar</button>
  </div>
  <div class="progress-bar" id="progressoPdf"><div class="fill"></div></div>
  <div class="hint" id="hintPdf">Lê o texto do PDF e preenche a fila automaticamente. Confira sempre antes de imprimir — em etiquetas muito pequenas (5,7x1,9cm, 3,2x2,5cm) o nome pode vir cortado/incompleto, corrija manualmente se precisar.</div>
</div>

<div class="card">
  <div class="card-titulo"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>Importar print screen de outro sistema (IA)</div>
  <div class="import-row">
    <input type="file" id="arquivoImagem" accept="image/*">
    <button class="btn-ghost btn-sm" id="btnImportarImagem" onclick="importarImagem()">Importar</button>
  </div>
  <div class="progress-bar" id="progressoImagem"><div class="fill"></div></div>
  <div class="hint" id="hintImagem">Print de qualquer OT/tabela de produção — a IA identifica itens, variantes (cor/modelo) e quantidades. <b>Sempre revise antes de imprimir</b> — a IA pode interpretar algo errado; use "mesclar" abaixo se ela separar o mesmo item em duas linhas.</div>
</div>

<div class="card">
  <div class="card-titulo"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1"/></svg>OT — cabeçalho da fila</div>
  <div class="row2">
    <input id="ot" placeholder="OT-2026-0057" onchange="salvarCabecalho()">
    <input id="nomeOt" placeholder="Nome do projeto" onchange="salvarCabecalho()">
  </div>
</div>

<div class="card">
  <div class="card-titulo"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>Adicionar item</div>
  <label>Nome do item *</label>
  <input id="nome" placeholder="Transformador 24V 400W">
  <div class="row2">
    <div><label>Local de uso</label><input id="local" placeholder="Calhas Bar VIP"></div>
    <div><label>Quantidade</label><input id="quantidade" type="number" min="1" max="50" value="1"></div>
  </div>
  <label>Observação</label>
  <input id="obs" placeholder="Fixar com braçadeira">
  <button class="btn-primary" onclick="adicionar()">+ Adicionar à fila</button>
</div>

<div class="card">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
    <div class="card-titulo" style="margin-bottom:0"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>Fila</div>
    <span class="counter" id="contador">0</span>
  </div>
  <div id="lista"></div>
  <button class="btn-ghost btn-sm" style="width:100%;margin-top:10px" onclick="mesclarSelecionadas()">Mesclar selecionadas</button>
</div>

<div class="card">
  <div class="card-titulo"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h.01M14 18h.01M18 14h.01M18 18h.01"/></svg>QR de resumo da OT</div>
  <label class="check-row">
    <input type="checkbox" id="comQr">
    Incluir como primeira etiqueta do lote (só em 10x15cm e 7,6x5,1cm)
  </label>
  <button class="btn-ghost btn-sm" style="width:100%;margin-top:12px" id="btnSoQr" onclick="imprimirSoQr()">Imprimir só o QR (etiqueta avulsa)</button>
</div>

<div class="footer-actions">
  <button class="btn-ghost" style="flex:1" onclick="limpar()">Limpar fila</button>
  <button class="btn-ghost" style="flex:1" id="btnSalvar" onclick="salvarArquivo()">Salvar arquivo</button>
  <button class="btn-primary" style="flex:2" id="btnImprimir" onclick="imprimirFila()">Imprimir na Zebra</button>
</div>

<script>
document.getElementById('themeToggle').addEventListener('click', function(){
  const atual = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const novo = atual === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', novo);
  localStorage.setItem('etTema', novo);
});

const esc=s=>String(s??'').replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
let _avisoTimer=null;
function aviso(msg, tipo){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.className='toast mostrar'+(tipo?' '+tipo:'');
  clearTimeout(_avisoTimer);
  _avisoTimer=setTimeout(()=>el.classList.remove('mostrar'), tipo==='erro'?6000:3500);
}
let filaAtual=[];

async function carregar(){
  const r = await fetch('/api/estado').then(r=>r.json());
  filaAtual = r.fila;
  if(document.activeElement.id!=='ot') document.getElementById('ot').value = r.cabecalho.ot || '';
  if(document.activeElement.id!=='nomeOt') document.getElementById('nomeOt').value = r.cabecalho.nomeOt || '';
  document.getElementById('contador').textContent = filaAtual.length + ' itens · ' + r.total + ' etiquetas';
  document.getElementById('lista').innerHTML = filaAtual.length ? filaAtual.map((l,i)=>\`
    <div class="item">
      <div class="item-view">
        <input type="checkbox" class="chk-mesclar" data-i="\${i}" style="width:auto;margin:0 4px 0 0;flex-shrink:0">
        <div class="info"><b>\${esc(l.nome)} \${l.quantidade>1?'×'+l.quantidade:''}</b><span>\${l.local?esc(l.local):'—'}\${l.obs?' · '+esc(l.obs):''}</span></div>
        <div class="acoes">
          <button class="btn-sm ed" onclick="toggleEdit(\${i})">editar</button>
          <button class="btn-sm rm" onclick="remover(\${i})">remover</button>
        </div>
      </div>
      <div class="item-edit" id="edit-\${i}">
        <input id="e-nome-\${i}" placeholder="Nome do item" value="\${esc(l.nome)}">
        <div class="row2">
          <input id="e-local-\${i}" placeholder="Local" value="\${esc(l.local)}">
          <input id="e-quantidade-\${i}" type="number" min="1" max="50" value="\${l.quantidade}">
        </div>
        <input id="e-obs-\${i}" placeholder="Observação" value="\${esc(l.obs)}">
        <button class="btn-primary btn-sm" onclick="salvarEdicao(\${i})">Salvar</button>
      </div>
    </div>\`).join('') : '<div class="empty">Nenhuma etiqueta na fila ainda.</div>';
}

async function salvarCabecalho(){
  await fetch('/api/cabecalho',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    ot:document.getElementById('ot').value.trim(),
    nomeOt:document.getElementById('nomeOt').value.trim()
  })});
}

function toggleEdit(i){
  document.querySelectorAll('.item-edit.aberto').forEach(el=>{ if(el.id!=='edit-'+i) el.classList.remove('aberto'); });
  document.getElementById('edit-'+i).classList.toggle('aberto');
}

async function salvarEdicao(i){
  await fetch('/api/fila/'+i,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    nome:document.getElementById('e-nome-'+i).value.trim(),
    local:document.getElementById('e-local-'+i).value.trim(),
    obs:document.getElementById('e-obs-'+i).value.trim(),
    quantidade:document.getElementById('e-quantidade-'+i).value
  })});
  carregar();
}

async function adicionar(){
  const nome=document.getElementById('nome').value.trim();
  if(!nome){ aviso('Preencha o nome do item.','erro'); return; }
  await fetch('/api/fila',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    nome, local:document.getElementById('local').value.trim(),
    obs:document.getElementById('obs').value.trim(),
    quantidade:document.getElementById('quantidade').value
  })});
  document.getElementById('nome').value='';
  document.getElementById('local').value='';
  document.getElementById('obs').value='';
  document.getElementById('quantidade').value=1;
  carregar();
}

// mostra spinner no botão + barra de progresso animada + texto piscando no hint,
// pra deixar claro que a análise do arquivo está rolando (não travou)
function iniciarCarregamento(btn, progressoEl, hintEl, textoCarregando){
  btn.dataset.textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Analisando';
  progressoEl.classList.add('ativo');
  if(hintEl){
    hintEl.dataset.textoOriginal = hintEl.innerHTML;
    hintEl.innerHTML = '<span class="analisando">'+textoCarregando+'<span class="ponto">.</span><span class="ponto">.</span><span class="ponto">.</span></span>';
  }
}
function pararCarregamento(btn, progressoEl, hintEl){
  btn.disabled = false;
  btn.textContent = btn.dataset.textoOriginal;
  progressoEl.classList.remove('ativo');
  if(hintEl) hintEl.innerHTML = hintEl.dataset.textoOriginal;
}

async function importarPdf(){
  const input = document.getElementById('arquivoPdf');
  if(!input.files.length){ aviso('Escolha um arquivo PDF primeiro.','erro'); return; }
  const btn = document.getElementById('btnImportarPdf');
  const progresso = document.getElementById('progressoPdf');
  const hint = document.getElementById('hintPdf');
  iniciarCarregamento(btn, progresso, hint, 'Lendo o PDF');
  const fd = new FormData();
  fd.append('pdf', input.files[0]);
  try {
    const r = await fetch('/api/importar-pdf', { method:'POST', body:fd });
    const d = await r.json();
    if(!r.ok){ aviso('Erro: '+(d.error||'falha ao importar'),'erro'); return; }
    input.value='';
    abrirRevisao(d.itens, d.cabecalhoSugerido);
  } finally {
    pararCarregamento(btn, progresso, hint);
  }
}

async function importarImagem(){
  const input = document.getElementById('arquivoImagem');
  if(!input.files.length){ aviso('Escolha uma imagem primeiro.','erro'); return; }
  const btn = document.getElementById('btnImportarImagem');
  const progresso = document.getElementById('progressoImagem');
  const hint = document.getElementById('hintImagem');
  iniciarCarregamento(btn, progresso, hint, 'Analisando com IA (pode levar alguns segundos)');
  const fd = new FormData();
  fd.append('imagem', input.files[0]);
  try {
    const r = await fetch('/api/importar-imagem', { method:'POST', body:fd });
    const d = await r.json();
    if(!r.ok){ aviso('Erro: '+(d.error||'falha ao importar'),'erro'); return; }
    input.value='';
    abrirRevisao(d.itens, null);
  } finally {
    pararCarregamento(btn, progresso, hint);
  }
}

let revItens=[], revCabecalho=null;
function abrirRevisao(itens, cabecalhoSugerido){
  revItens = (itens||[]).map(it=>({nome:it.nome||'',local:it.local||'',obs:it.obs||'',quantidade:it.quantidade||1}));
  revCabecalho = cabecalhoSugerido;
  renderizarRevisao();
  document.getElementById('modalRevisao').classList.add('aberto');
}
function renderizarRevisao(){
  document.getElementById('revLista').innerHTML = revItens.length ? revItens.map((it,i)=>\`
    <div class="rev-item">
      <div class="rev-item-topo"><span>Item \${i+1} de \${revItens.length}</span><button class="btn-sm rm" onclick="removerRevItem(\${i})">remover</button></div>
      <input id="rev-nome-\${i}" placeholder="Nome do item" value="\${esc(it.nome)}">
      <div class="row2">
        <input id="rev-local-\${i}" placeholder="Local/variante" value="\${esc(it.local)}">
        <input id="rev-quantidade-\${i}" type="number" min="1" max="500" value="\${it.quantidade}">
      </div>
      <input id="rev-obs-\${i}" placeholder="Observação" value="\${esc(it.obs)}" style="margin-top:8px">
    </div>\`).join('') : '<div class="empty">Nenhum item restante.</div>';
}
function removerRevItem(i){ revItens.splice(i,1); renderizarRevisao(); }
function cancelarRevisao(){
  document.getElementById('modalRevisao').classList.remove('aberto');
  revItens=[]; revCabecalho=null;
}
async function confirmarRevisao(){
  // relê os campos (podem ter sido editados) antes de mandar
  const itens = revItens.map((it,i)=>({
    nome: document.getElementById('rev-nome-'+i).value.trim(),
    local: document.getElementById('rev-local-'+i).value.trim(),
    obs: document.getElementById('rev-obs-'+i).value.trim(),
    quantidade: document.getElementById('rev-quantidade-'+i).value
  })).filter(it=>it.nome);
  if(!itens.length){ aviso('Nenhum item pra adicionar.','erro'); return; }
  const r = await fetch('/api/fila/lote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({itens, cabecalho:revCabecalho})});
  const d = await r.json();
  if(!r.ok){ aviso('Erro: '+(d.error||'falha ao adicionar'),'erro'); return; }
  document.getElementById('modalRevisao').classList.remove('aberto');
  revItens=[]; revCabecalho=null;
  aviso(d.adicionados + ' etiqueta(s) adicionada(s) à fila.','sucesso');
  carregar();
}

async function mesclarSelecionadas(){
  const indices = [...document.querySelectorAll('.chk-mesclar:checked')].map(el=>parseInt(el.dataset.i,10));
  if(indices.length < 2){ aviso('Marque pelo menos 2 itens pra mesclar.','erro'); return; }
  const r = await fetch('/api/fila/mesclar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({indices})});
  const d = await r.json();
  if(!r.ok){ aviso('Erro: '+(d.error||'falha ao mesclar'),'erro'); return; }
  carregar();
}

async function remover(i){ await fetch('/api/fila/'+i,{method:'DELETE'}); carregar(); }
async function limpar(){ if(!confirm('Limpar toda a fila?')) return; await fetch('/api/fila',{method:'DELETE'}); carregar(); }
function botaoOcupado(btn, texto){
  btn.dataset.textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>'+texto;
}
function botaoLivre(btn){
  btn.disabled = false;
  btn.textContent = btn.dataset.textoOriginal;
}

async function salvarArquivo(){
  if(!filaAtual.length){ aviso('A fila está vazia.','erro'); return; }
  const btn = document.getElementById('btnSalvar');
  botaoOcupado(btn, 'Gerando PDF');
  try {
    const r = await fetch('/api/gerar-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      comLogo:false,
      tamanho:document.getElementById('tamanho').value,
      comQr:document.getElementById('comQr').checked
    })});
    if(!r.ok){ const d=await r.json().catch(()=>({})); aviso('Erro: '+(d.error||'falha ao gerar o PDF'),'erro'); return; }
    const blob = await r.blob();
    const nome = (r.headers.get('Content-Disposition')||'').match(/filename="([^"]+)"/)?.[1] || 'etiquetas.pdf';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    aviso('PDF salvo — a fila continua aqui pra imprimir depois.','sucesso');
  } finally {
    botaoLivre(btn);
  }
}

async function imprimirFila(){
  if(!confirm('Confirma o envio pra impressora física?')) return;
  const btn = document.getElementById('btnImprimir');
  botaoOcupado(btn, 'Enviando');
  try {
    const r = await fetch('/api/imprimir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      comLogo:false,
      tamanho:document.getElementById('tamanho').value,
      comQr:document.getElementById('comQr').checked
    })});
    const d = await r.json();
    if(!r.ok){ aviso('Erro: '+(d.error||'falha ao imprimir'),'erro'); return; }
    aviso('Enviado pra impressora.','sucesso');
    carregar();
  } finally {
    botaoLivre(btn);
  }
}
async function imprimirSoQr(){
  if(!document.getElementById('ot').value.trim()){ aviso('Preencha a OT no cabeçalho primeiro.','erro'); return; }
  if(!confirm('Imprimir uma etiqueta avulsa só com o QR de resumo da OT?')) return;
  const btn = document.getElementById('btnSoQr');
  botaoOcupado(btn, 'Enviando');
  try {
    const r = await fetch('/api/imprimir-qr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tamanho:document.getElementById('tamanho').value})});
    const d = await r.json();
    if(!r.ok){ aviso('Erro: '+(d.error||'falha ao imprimir'),'erro'); return; }
    aviso('QR enviado pra impressora.','sucesso');
  } finally {
    botaoLivre(btn);
  }
}
carregar();
</script>
</body></html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Painel de etiquetas rodando:`);
  console.log(`  http://localhost:${PORT}`);
  ipsLocais().forEach(ip => console.log(`  http://${ip}:${PORT}  (rede local)`));
});
