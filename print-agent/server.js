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
const { imprimir, TAMANHOS, TAMANHO_PADRAO, nivelDeConteudo } = require('./imprimir');
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

app.post('/api/imprimir', async (req, res) => {
  if (!fila.length) return res.status(400).json({ error: 'A fila está vazia.' });
  const tamanho = req.body.tamanho;
  // expande cada linha (com quantidade) em N etiquetas físicas numeradas 1/N, 2/N...
  const labels = [];
  if (req.body.comQr && cabecalho.ot && podeIncluirQrNoLote(tamanho)) {
    labels.push({ tipoQr: true, titulo: `OT ${cabecalho.ot}`, url: `${SITE_URL}/ot-resumo.html?ot=${encodeURIComponent(cabecalho.ot)}` });
  }
  fila.forEach(l => {
    const total = l.quantidade || 1;
    for (let i = 1; i <= total; i++) {
      labels.push({ ot: cabecalho.ot, nomeOt: cabecalho.nomeOt, nome: l.nome, local: l.local, obs: l.obs, unitIdx: i, unitTotal: total });
    }
  });
  try {
    const arquivo = await imprimir(labels, { comLogo: !!req.body.comLogo, tamanho });
    fila = [];
    res.json({ ok: true, arquivo });
  } catch (e) {
    res.status(500).json({ error: e.message, stderr: e.stderr ? e.stderr.toString() : undefined });
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
<style>
:root{color-scheme:dark light}
body{font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px 16px 60px;background:#0d0f14;color:#e8eaed}
h1{font-size:1.1rem;margin:0 0 4px}
.sub{color:#8a8f98;font-size:.8rem;margin-bottom:20px}
.card{background:#171a21;border:1px solid #2a2e38;border-radius:12px;padding:16px;margin-bottom:14px}
label{display:block;font-size:.72rem;font-weight:700;color:#8a8f98;margin-bottom:4px;text-transform:uppercase;letter-spacing:.03em}
input,textarea{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #2a2e38;border-radius:8px;background:#0d0f14;color:#e8eaed;font-size:.9rem;margin-bottom:10px;font-family:inherit}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
button{border:none;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer;font-size:.85rem;font-family:inherit}
.btn-primary{background:#5b8cff;color:#fff;width:100%}
.btn-ghost{background:#22262f;color:#e8eaed;border:1px solid #2a2e38}
.btn-sm{padding:5px 10px;font-size:.74rem;border-radius:6px}
.item{padding:10px 0;border-bottom:1px solid #2a2e38}
.item:last-child{border-bottom:none}
.item-view{display:flex;justify-content:space-between;align-items:center;gap:10px}
.item .info b{display:block;font-size:.9rem}
.item .info span{font-size:.76rem;color:#8a8f98}
.item .acoes{display:flex;gap:6px;flex-shrink:0}
.item .rm{background:#3a1f24;color:#f87171}
.item .ed{background:#22262f;color:#e8eaed;border:1px solid #2a2e38}
.item-edit{display:none;margin-top:8px}
.item-edit.aberto{display:block}
.item-edit .row2{margin-bottom:0}
.item-edit input{margin-bottom:8px}
.empty{color:#8a8f98;text-align:center;padding:20px;font-size:.85rem}
.counter{background:#5b8cff;color:#fff;font-size:.7rem;font-weight:800;border-radius:20px;padding:1px 8px;margin-left:6px}
.footer-actions{display:flex;gap:8px;margin-top:14px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}
.brand svg{width:52px;height:auto;flex-shrink:0;color:#e8eaed}
.import-row{display:flex;gap:8px;align-items:center}
.import-row input[type=file]{flex:1;margin-bottom:0;padding:7px}
.hint{font-size:.72rem;color:#8a8f98;margin-top:6px}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#22262f;border:1px solid #2a2e38;border-radius:10px;padding:12px 18px;font-size:.85rem;max-width:90vw;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:999;opacity:0;pointer-events:none;transition:opacity .2s}
.toast.mostrar{opacity:1}
.toast.erro{border-color:#f87171;color:#f87171}
.toast.sucesso{border-color:#5b8cff}
.modal-fundo{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:900;align-items:flex-start;justify-content:center;overflow-y:auto;padding:30px 16px}
.modal-fundo.aberto{display:flex}
.modal{background:#171a21;border:1px solid #2a2e38;border-radius:14px;padding:20px;max-width:560px;width:100%}
.modal h2{font-size:1rem;margin:0 0 4px}
.modal .sub{margin-bottom:16px}
.rev-item{background:#0d0f14;border:1px solid #2a2e38;border-radius:10px;padding:12px;margin-bottom:10px}
.rev-item input{margin-bottom:8px}
.rev-item .row2{margin-bottom:0}
.rev-item .row2 input{margin-bottom:0}
.rev-item-topo{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.rev-item-topo span{font-size:.68rem;font-weight:800;color:#8a8f98;text-transform:uppercase;letter-spacing:.03em}
.modal-acoes{display:flex;gap:8px;margin-top:14px}
</style></head>
<body>
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
  <div>
    <h1>Etiquetas Térmicas</h1>
    <div class="sub" style="margin-bottom:0">Impressora: Zebra GC420d</div>
  </div>
</div>

<div class="card">
  <label>Tamanho da etiqueta</label>
  <select id="tamanho">
    ${Object.entries(TAMANHOS).map(([chave, t]) => `<option value="${chave}" ${chave === TAMANHO_PADRAO ? 'selected' : ''}>${t.label} (${t.w}x${t.h}mm)</option>`).join('')}
  </select>
  <div class="hint">Precisa bater com o rolo físico carregado na impressora — e com o PageSize padrão configurado na fila CUPS (troca de rolo exige reconfigurar isso também).</div>
</div>

<div class="card">
  <label>Importar PDF (gerado pelo site)</label>
  <div class="import-row">
    <input type="file" id="arquivoPdf" accept="application/pdf">
    <button class="btn-ghost btn-sm" onclick="importarPdf()">Importar</button>
  </div>
  <div class="hint">Lê o texto do PDF e preenche a fila automaticamente. Confira sempre antes de imprimir — em etiquetas muito pequenas (5,7x1,9cm, 3,2x2,5cm) o nome pode vir cortado/incompleto, corrija manualmente se precisar.</div>
</div>

<div class="card">
  <label>Importar print screen de outro sistema (IA)</label>
  <div class="import-row">
    <input type="file" id="arquivoImagem" accept="image/*">
    <button class="btn-ghost btn-sm" onclick="importarImagem()">Importar</button>
  </div>
  <div class="hint" id="hintImagem">Print de qualquer OT/tabela de produção — a IA identifica itens, variantes (cor/modelo) e quantidades. <b>Sempre revise antes de imprimir</b> — a IA pode interpretar algo errado; use "mesclar" abaixo se ela separar o mesmo item em duas linhas.</div>
</div>

<div class="card">
  <label>OT (cabeçalho — vale pra toda a fila)</label>
  <div class="row2">
    <input id="ot" placeholder="OT-2026-0057" onchange="salvarCabecalho()">
    <input id="nomeOt" placeholder="Nome do projeto" onchange="salvarCabecalho()">
  </div>
</div>

<div class="card">
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
  <div style="display:flex;align-items:center;margin-bottom:8px">
    <strong>Fila</strong><span class="counter" id="contador">0</span>
  </div>
  <div id="lista"></div>
  <button class="btn-ghost btn-sm" style="width:100%;margin-top:10px" onclick="mesclarSelecionadas()">Mesclar selecionadas</button>
</div>

<div class="card">
  <label style="display:flex;align-items:center;gap:8px;text-transform:none;cursor:pointer">
    <input type="checkbox" id="comQr" style="width:auto;margin:0">
    Incluir QR de resumo da OT no início do lote (só em 10x15cm e 7,6x5,1cm)
  </label>
  <button class="btn-ghost btn-sm" style="width:100%;margin-top:10px" onclick="imprimirSoQr()">Imprimir só o QR (etiqueta avulsa)</button>
</div>

<div class="footer-actions">
  <button class="btn-ghost" style="flex:1" onclick="limpar()">Limpar fila</button>
  <button class="btn-primary" style="flex:2" onclick="imprimirFila()">Imprimir na Zebra</button>
</div>

<script>
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

async function importarPdf(){
  const input = document.getElementById('arquivoPdf');
  if(!input.files.length){ aviso('Escolha um arquivo PDF primeiro.','erro'); return; }
  const fd = new FormData();
  fd.append('pdf', input.files[0]);
  const r = await fetch('/api/importar-pdf', { method:'POST', body:fd });
  const d = await r.json();
  if(!r.ok){ aviso('Erro: '+(d.error||'falha ao importar'),'erro'); return; }
  input.value='';
  abrirRevisao(d.itens, d.cabecalhoSugerido);
}

async function importarImagem(){
  const input = document.getElementById('arquivoImagem');
  if(!input.files.length){ aviso('Escolha uma imagem primeiro.','erro'); return; }
  const hint = document.getElementById('hintImagem');
  const textoOriginal = hint.textContent;
  hint.textContent = 'Analisando com IA... pode levar alguns segundos.';
  const fd = new FormData();
  fd.append('imagem', input.files[0]);
  try {
    const r = await fetch('/api/importar-imagem', { method:'POST', body:fd });
    const d = await r.json();
    if(!r.ok){ aviso('Erro: '+(d.error||'falha ao importar'),'erro'); return; }
    input.value='';
    abrirRevisao(d.itens, null);
  } finally {
    hint.textContent = textoOriginal;
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
async function imprimirFila(){
  if(!confirm('Confirma o envio pra impressora física?')) return;
  const r = await fetch('/api/imprimir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    comLogo:false,
    tamanho:document.getElementById('tamanho').value,
    comQr:document.getElementById('comQr').checked
  })});
  const d = await r.json();
  if(!r.ok){ aviso('Erro: '+(d.error||'falha ao imprimir'),'erro'); return; }
  aviso('Enviado pra impressora.','sucesso');
  carregar();
}
async function imprimirSoQr(){
  if(!document.getElementById('ot').value.trim()){ aviso('Preencha a OT no cabeçalho primeiro.','erro'); return; }
  if(!confirm('Imprimir uma etiqueta avulsa só com o QR de resumo da OT?')) return;
  const r = await fetch('/api/imprimir-qr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tamanho:document.getElementById('tamanho').value})});
  const d = await r.json();
  if(!r.ok){ aviso('Erro: '+(d.error||'falha ao imprimir'),'erro'); return; }
  aviso('QR enviado pra impressora.','sucesso');
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
