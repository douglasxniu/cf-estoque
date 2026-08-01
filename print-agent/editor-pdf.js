#!/usr/bin/env node
// Gera PDF a partir de um design livre (texto/imagem/traço picotado posicionados
// livremente pelo editor visual em editor/index.html) e manda pra mesma impressora
// Zebra usada pelo resto do print-agent. Ao contrário de imprimir.js (que desenha
// etiquetas com um template fixo), aqui o layout inteiro vem do cliente em mm.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { jsPDF } = require('jspdf');

const PRINTER = 'Zebra_Technologies_ZTC_GC420d__EPL_';

// o filtro de rasterização da impressora não respeita setLineDashPattern (mesma limitação
// documentada em imprimir.js), então o traço picotado é sempre desenhado segmento a segmento
function linhaTracejada(doc, x1, y1, x2, y2) {
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.35);
  const dx = x2 - x1, dy = y2 - y1;
  const comprimento = Math.hypot(dx, dy) || 1;
  const passos = Math.max(1, Math.round(comprimento / 3.2));
  const ux = dx / passos, uy = dy / passos;
  for (let i = 0; i < passos; i++) {
    doc.line(x1 + ux * i, y1 + uy * i, x1 + ux * (i + 0.6), y1 + uy * (i + 0.6));
  }
}

function desenharTexto(doc, el) {
  const estilo = el.negrito && el.italico ? 'bolditalic' : el.negrito ? 'bold' : el.italico ? 'italic' : 'normal';
  doc.setFont('helvetica', estilo);
  const tamanhoPt = el.tamanho || 10;
  doc.setFontSize(tamanhoPt);
  const [r, g, b] = Array.isArray(el.cor) && el.cor.length === 3 ? el.cor : [20, 20, 20];
  doc.setTextColor(r, g, b);
  const tamanhoMm = tamanhoPt * 0.3528;
  const baselineY = el.y + tamanhoMm * 0.8;
  const alinhamento = el.alinhamento === 'center' || el.alinhamento === 'right' ? el.alinhamento : 'left';
  const x = alinhamento === 'center' ? el.x + el.w / 2 : alinhamento === 'right' ? el.x + el.w : el.x;
  doc.text(String(el.texto || ''), x, baselineY, { maxWidth: el.w, align: alinhamento });
}

function desenharElementos(doc, elementos) {
  for (const el of elementos) {
    if (el.tipo === 'texto' && el.texto) desenharTexto(doc, el);
    else if (el.tipo === 'imagem' && el.dataUrl) doc.addImage(el.dataUrl, el.formato || 'PNG', el.x, el.y, el.w, el.h);
    else if (el.tipo === 'linha') linhaTracejada(doc, el.x1, el.y1, el.x2, el.y2);
  }
}

// largura/altura em mm; elementos com coordenadas já em mm (o editor converte de px pra mm
// antes de mandar, então este módulo não precisa saber nada sobre a escala usada na tela).
// copias > 1 repete a mesma etiqueta em páginas seguintes do mesmo PDF, pra imprimir várias
// de uma vez sem precisar reabrir o job pra cada uma.
function gerarPDFLivre({ largura, altura, elementos = [], copias = 1 }) {
  const W = Number(largura), H = Number(altura);
  if (!(W > 0) || !(H > 0)) throw new Error('Tamanho da etiqueta inválido.');
  const N = Math.max(1, Math.min(100, Number(copias) || 1));
  const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: W > H ? 'landscape' : 'portrait', compress: true });
  for (let i = 0; i < N; i++) {
    if (i > 0) doc.addPage([W, H], W > H ? 'landscape' : 'portrait');
    desenharElementos(doc, elementos);
  }
  return doc;
}

async function imprimirLivre(design, { salvarEm } = {}) {
  const doc = gerarPDFLivre(design);
  const arquivo = salvarEm || path.join(os.tmpdir(), `etiqueta-livre-${Date.now()}.pdf`);
  fs.writeFileSync(arquivo, Buffer.from(doc.output('arraybuffer')));
  execFileSync('/usr/bin/lp', ['-d', PRINTER, '-n', '1', arquivo]);
  return arquivo;
}

module.exports = { gerarPDFLivre, imprimirLivre };
