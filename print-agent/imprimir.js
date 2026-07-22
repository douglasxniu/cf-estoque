#!/usr/bin/env node
// Ferramenta LOCAL (roda só nesta máquina, não faz parte do deploy do Worker) — gera um PDF
// de 100x150mm com até 5 etiquetas de 100x30mm empilhadas e manda pra fila de impressão da
// Zebra GC420d via CUPS. O driver "Zebra EPL1 Label Printer" já converte PDF->EPL sozinho
// (filtro rastertolabel), então não precisamos escrever comandos EPL manualmente.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { jsPDF } = require('jspdf');

const EMPRESA_NOME = 'NIU Experience Agency';
const LOGO_RATIO = 200 / 730; // altura/largura de logo-niu.png (rasterizado de public/logo-niu.svg)

const PRINTER = 'Zebra_Technologies_ZTC_GC420d__EPL_';
const PAGE_W_MM = 100, PAGE_H_MM = 150;
const LABELS_PER_PAGE = 5;
// margens de segurança — a primeira impressão saiu colada na borda de cima, sem folga
const TOPO_MM = 3, BASE_MM = 3;
const LABEL_H_MM = (PAGE_H_MM - TOPO_MM - BASE_MM) / LABELS_PER_PAGE;

// desenha uma linha tracejada "na mão" (segmento a segmento) — alguns filtros de
// rasterização (ex: o da Zebra via CUPS) não respeitam setLineDashPattern do PDF
function linhaTracejada(doc, x0, y, x1, tracoMM = 2, vaoMM = 1.2) {
  doc.setDrawColor(60, 60, 60); doc.setLineWidth(0.35);
  for (let x = x0; x < x1; x += tracoMM + vaoMM) {
    doc.line(x, y, Math.min(x + tracoMM, x1), y);
  }
}

function carregarLogoBase64() {
  const buf = fs.readFileSync(path.join(__dirname, 'logo-niu.png'));
  return 'data:image/png;base64,' + buf.toString('base64');
}

// labels: array de até 5 {ot, nomeOt, nome, local, obs, unitIdx, unitTotal} — o mesmo
// formato usado em public/etiquetas.js, só que sem o tipoQr (não cabe nesse formato menor).
function gerarPaginaPDF(labels) {
  const logo = carregarLogoBase64();
  const doc = new jsPDF({ unit: 'mm', format: [PAGE_W_MM, PAGE_H_MM] });
  const pad = 4;

  labels.slice(0, LABELS_PER_PAGE).forEach((lab, i) => {
    const y = TOPO_MM + i * LABEL_H_MM;
    if (i > 0) {
      // linha de picote entre as etiquetas empilhadas na mesma folha física
      linhaTracejada(doc, 0, y, PAGE_W_MM);
    }
    const maxW = PAGE_W_MM - 2 * pad;
    const logoW = 6, logoH = logoW * LOGO_RATIO;
    doc.addImage(logo, 'PNG', pad, y + 2, logoW, logoH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(70, 70, 70);
    doc.text(EMPRESA_NOME, pad + logoW + 1.5, y + 4.3);

    let ty = y + 9;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
    doc.text(`${lab.ot || ''}${lab.nomeOt ? ' - ' + lab.nomeOt : ''}`, pad, ty, { maxWidth: maxW * 0.7 });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
    doc.text(`${lab.unitIdx ?? 1}/${lab.unitTotal ?? 1}`, PAGE_W_MM - pad, ty, { align: 'right' });

    ty += 5.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15, 15, 15);
    doc.text(String(lab.nome || ''), pad, ty, { maxWidth: maxW });

    ty += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(40, 40, 40);
    doc.text(String(lab.local || ''), pad, ty, { maxWidth: maxW });

    ty += 4.5;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(100, 100, 100);
    if (lab.obs) doc.text(String(lab.obs), pad, ty, { maxWidth: maxW });

    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(150, 150, 150);
    doc.text(`Patrimônio ${EMPRESA_NOME}`, pad, y + LABEL_H_MM - 2.5, { maxWidth: maxW });
  });

  return doc;
}

function salvarPDF(labels, arquivo) {
  const doc = gerarPaginaPDF(labels);
  fs.writeFileSync(arquivo, Buffer.from(doc.output('arraybuffer')));
  return arquivo;
}

function imprimir(labels, { salvarEm } = {}) {
  const arquivo = salvarEm || path.join(os.tmpdir(), `etiqueta-termica-${Date.now()}.pdf`);
  salvarPDF(labels, arquivo);
  const wPt = Math.round(PAGE_W_MM / 25.4 * 72), hPt = Math.round(PAGE_H_MM / 25.4 * 72);
  // sem "fit-to-page" (pode fazer o driver reescalar/repetir em cima de etiquetas contínuas
  // por gap) e "-n 1" explícito — só uma folha física de 100x150mm por chamada.
  execFileSync('/usr/bin/lp', ['-d', PRINTER, '-n', '1', '-o', `media=Custom.${wPt}x${hPt}pt`, arquivo]);
  return arquivo;
}

module.exports = { gerarPaginaPDF, salvarPDF, imprimir };

if (require.main === module) {
  // uso: node imprimir.js dados.json   (ou pipe via stdin)
  // dados.json: array de labels (ver formato acima), até 5 por chamada (1 folha física)
  const entrada = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
  const labels = JSON.parse(entrada);
  const arquivo = imprimir(labels);
  console.log(`Impresso via ${PRINTER}. PDF salvo em ${arquivo}`);
}
