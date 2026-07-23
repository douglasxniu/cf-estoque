#!/usr/bin/env node
// Ferramenta LOCAL (roda só nesta máquina, não faz parte do deploy do Worker) — gera um PDF
// com uma etiqueta por página, no tamanho físico real do rolo carregado na impressora, e
// manda pra fila de impressão da Zebra GC420d via CUPS. O driver "Zebra EPL2 Label Printer"
// já converte PDF->EPL sozinho (filtro rastertolabel), então não escrevemos EPL na mão.
//
// IMPORTANTE: pra imprimir de verdade nesse driver, o PageSize do job precisa bater com o
// PageSize PADRÃO ATUAL da fila CUPS (confirmado que ele ignora overrides por job). Trocar
// de tamanho aqui não muda sozinho o padrão da fila — isso ainda precisa ser configurado no
// CUPS (`lpadmin -p ... -o PageSize=...`) toda vez que o rolo físico carregado mudar.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { jsPDF } = require('jspdf');

const EMPRESA_NOME = 'NIU Experience Agency';
const LOGO_RATIO = 200 / 730; // altura/largura de logo-niu.png (rasterizado de public/logo-niu.svg)
const PRINTER = 'Zebra_Technologies_ZTC_GC420d__EPL_';

// tamanhos de etiqueta comuns no mercado (largura x altura, mm) — "TAMANHO_PADRAO" é o que
// já validamos fisicamente antes. Adicionar um novo tamanho aqui é só adicionar a entrada.
const TAMANHOS = {
  '100x150': { w: 100, h: 150, label: '10 x 15 cm' },
  '76x51': { w: 76, h: 51, label: '7,6 x 5,1 cm' },
  '57x19': { w: 57, h: 19, label: '5,7 x 1,9 cm' },
  '32x25': { w: 32, h: 25, label: '3,2 x 2,5 cm' }
};
const TAMANHO_PADRAO = '100x150';

let _logoCache = null;
function carregarLogoBase64() {
  if (_logoCache === null) {
    const arq = path.join(__dirname, 'logo-niu.png');
    _logoCache = fs.existsSync(arq) ? 'data:image/png;base64,' + fs.readFileSync(arq).toString('base64') : false;
  }
  return _logoCache;
}

// o quanto de informação cabe muda com o tamanho físico da etiqueta — uma de 32x25mm não
// tem espaço pra cabeçalho/rodapé, uma de 100x150mm tem sobra.
function nivelDeConteudo(w, h) {
  if (h >= 100) return 'grande';
  if (h >= 40) return 'media';
  return 'pequena';
}

function desenharEtiquetaGrande(doc, lab, W, H, opts) {
  const pad = 4, maxW = W - 2 * pad;
  const logo = opts.comLogo ? carregarLogoBase64() : false;
  let empresaX = pad, ty = 4.3;
  if (logo) {
    const logoW = 6, logoH = logoW * LOGO_RATIO;
    doc.addImage(logo, 'PNG', pad, 2, logoW, logoH);
    empresaX = pad + logoW + 1.5;
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(70, 70, 70);
  doc.text(EMPRESA_NOME, empresaX, ty);

  ty = 9;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
  doc.text(`${lab.ot || ''}${lab.nomeOt ? ' - ' + lab.nomeOt : ''}`, pad, ty, { maxWidth: maxW * 0.7 });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
  doc.text(`${lab.unitIdx ?? 1}/${lab.unitTotal ?? 1}`, W - pad, ty, { align: 'right' });

  ty += 6.5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(15, 15, 15);
  doc.text(String(lab.nome || ''), pad, ty, { maxWidth: maxW });

  ty += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(40, 40, 40);
  doc.text(String(lab.local || ''), pad, ty, { maxWidth: maxW });

  ty += 5.5;
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
  if (lab.obs) doc.text(String(lab.obs), pad, ty, { maxWidth: maxW });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(150, 150, 150);
  doc.text(`Patrimônio ${EMPRESA_NOME}`, pad, H - 3.5, { maxWidth: maxW });
}

function desenharEtiquetaMedia(doc, lab, W, H) {
  const pad = 3, maxW = W - 2 * pad;
  let ty = 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(110, 110, 110);
  doc.text(`${lab.ot || ''}${lab.nomeOt ? ' - ' + lab.nomeOt : ''}`, pad, ty, { maxWidth: maxW * 0.7 });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(140, 140, 140);
  doc.text(`${lab.unitIdx ?? 1}/${lab.unitTotal ?? 1}`, W - pad, ty, { align: 'right' });

  ty += 6.5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15, 15, 15);
  doc.text(String(lab.nome || ''), pad, ty, { maxWidth: maxW });

  ty += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(50, 50, 50);
  doc.text(String(lab.local || ''), pad, ty, { maxWidth: maxW });

  if (lab.obs) {
    ty += 5;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(110, 110, 110);
    doc.text(String(lab.obs), pad, ty, { maxWidth: maxW });
  }
}

function desenharEtiquetaPequena(doc, lab, W, H) {
  // sem espaço pra cabeçalho/rodapé/observação — só o essencial: nome e local
  const pad = 2, maxW = W - 2 * pad;
  const fonteNome = W < 40 ? 8 : 9.5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(fonteNome); doc.setTextColor(15, 15, 15);
  doc.text(String(lab.nome || ''), pad, H * 0.42, { maxWidth: maxW });
  if (lab.local) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(fonteNome - 2); doc.setTextColor(70, 70, 70);
    doc.text(String(lab.local), pad, H * 0.72, { maxWidth: maxW });
  }
}

// labels: array de N {ot, nomeOt, nome, local, obs, unitIdx, unitTotal} — cada item vira
// uma página própria, no tamanho de opts.tamanho (chave de TAMANHOS, padrão 100x150).
function gerarPDF(labels, opts = {}) {
  const tam = TAMANHOS[opts.tamanho] || TAMANHOS[TAMANHO_PADRAO];
  const { w: W, h: H } = tam;
  const doc = new jsPDF({ unit: 'mm', format: [W, H] });
  const nivel = nivelDeConteudo(W, H);

  labels.forEach((lab, idx) => {
    if (idx > 0) doc.addPage();
    if (nivel === 'grande') desenharEtiquetaGrande(doc, lab, W, H, opts);
    else if (nivel === 'media') desenharEtiquetaMedia(doc, lab, W, H);
    else desenharEtiquetaPequena(doc, lab, W, H);
  });

  return doc;
}

function salvarPDF(labels, arquivo, opts) {
  const doc = gerarPDF(labels, opts);
  fs.writeFileSync(arquivo, Buffer.from(doc.output('arraybuffer')));
  return arquivo;
}

function imprimir(labels, { salvarEm, comLogo, tamanho } = {}) {
  const arquivo = salvarEm || path.join(os.tmpdir(), `etiqueta-termica-${Date.now()}.pdf`);
  salvarPDF(labels, arquivo, { comLogo, tamanho });
  // sem -o media/-o PageSize — usa o padrão atual da fila (o único que imprime de verdade
  // nesse driver, ver comentário no topo do arquivo) — "-n 1" explícito.
  execFileSync('/usr/bin/lp', ['-d', PRINTER, '-n', '1', arquivo]);
  return arquivo;
}

module.exports = { gerarPDF, salvarPDF, imprimir, TAMANHOS, TAMANHO_PADRAO };

if (require.main === module) {
  // uso: node imprimir.js dados.json   (ou pipe via stdin)
  const entrada = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
  const labels = JSON.parse(entrada);
  const arquivo = imprimir(labels);
  console.log(`Impresso via ${PRINTER}. PDF salvo em ${arquivo}`);
}
