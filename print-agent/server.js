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
const { imprimir, TAMANHOS, TAMANHO_PADRAO } = require('./imprimir');
const { extrairLabelsDoPDF } = require('./importar-pdf');

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

// importa um PDF já gerado por este sistema e preenche a fila automaticamente. O
// ot/nomeOt extraído do PDF vira o cabeçalho (só se o cabeçalho ainda estiver vazio —
// não sobrescreve o que o usuário já preencheu na tela).
app.post('/api/importar-pdf', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  try {
    const extraidos = await extrairLabelsDoPDF(req.file.buffer);
    if (!extraidos.length) return res.status(422).json({ error: 'Não consegui reconhecer nenhuma etiqueta nesse PDF.' });
    if (!cabecalho.ot && !cabecalho.nomeOt) {
      const primeiro = extraidos.find(l => l.ot || l.nomeOt);
      if (primeiro) cabecalho = { ot: primeiro.ot || '', nomeOt: primeiro.nomeOt || '' };
    }
    extraidos.forEach(l => fila.push({ nome: l.nome, local: l.local, obs: l.obs, quantidade: l.quantidade }));
    res.json({ ...estado(), importados: extraidos.length });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao ler o PDF: ' + e.message });
  }
});

app.post('/api/imprimir', (req, res) => {
  if (!fila.length) return res.status(400).json({ error: 'A fila está vazia.' });
  // expande cada linha (com quantidade) em N etiquetas físicas numeradas 1/N, 2/N...
  const labels = [];
  fila.forEach(l => {
    const total = l.quantidade || 1;
    for (let i = 1; i <= total; i++) {
      labels.push({ ot: cabecalho.ot, nomeOt: cabecalho.nomeOt, nome: l.nome, local: l.local, obs: l.obs, unitIdx: i, unitTotal: total });
    }
  });
  try {
    const arquivo = imprimir(labels, { comLogo: !!req.body.comLogo, tamanho: req.body.tamanho });
    fila = [];
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
</style></head>
<body>
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
</div>

<div class="footer-actions">
  <button class="btn-ghost" style="flex:1" onclick="limpar()">Limpar fila</button>
  <button class="btn-primary" style="flex:2" onclick="imprimirFila()">Imprimir na Zebra</button>
</div>

<script>
const esc=s=>String(s??'').replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
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
  if(!nome){ alert('Preencha o nome do item.'); return; }
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
  if(!input.files.length){ alert('Escolha um arquivo PDF primeiro.'); return; }
  const fd = new FormData();
  fd.append('pdf', input.files[0]);
  const r = await fetch('/api/importar-pdf', { method:'POST', body:fd });
  const d = await r.json();
  if(!r.ok){ alert('Erro: '+(d.error||'falha ao importar')); return; }
  input.value='';
  alert(d.importados + ' etiqueta(s) importada(s) — confira/edite antes de imprimir.');
  carregar();
}

async function remover(i){ await fetch('/api/fila/'+i,{method:'DELETE'}); carregar(); }
async function limpar(){ if(!confirm('Limpar toda a fila?')) return; await fetch('/api/fila',{method:'DELETE'}); carregar(); }
async function imprimirFila(){
  if(!confirm('Confirma o envio pra impressora física?')) return;
  const r = await fetch('/api/imprimir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comLogo:false,tamanho:document.getElementById('tamanho').value})});
  const d = await r.json();
  if(!r.ok){ alert('Erro: '+(d.error||'falha ao imprimir')); return; }
  alert('Enviado pra impressora.');
  carregar();
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
