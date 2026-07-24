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
const QRCode = require('qrcode');

const EMPRESA_NOME = 'NIU Experience Agency';
const LOGO_RATIO = 200 / 730; // altura/largura de logo-niu.png (rasterizado de public/logo-niu.svg)
const PRINTER = 'Zebra_Technologies_ZTC_GC420d__EPL_';

// tamanhos de etiqueta comuns no mercado (largura x altura, mm) — "TAMANHO_PADRAO" é o que
// já validamos fisicamente antes. Adicionar um novo tamanho aqui é só adicionar a entrada.
// porPagina > 1 empilha várias etiquetas na mesma folha física (com picote entre elas) em
// vez de gastar uma folha inteira por item — só faz sentido pro rolo grande (10x15cm); os
// outros já são etiquetas individuais pequenas, sem espaço sobrando pra dividir mais.
const TAMANHOS = {
  '100x150': { w: 100, h: 150, label: '10 x 15 cm', porPagina: 5 },
  '76x51': { w: 76, h: 51, label: '7,6 x 5,1 cm', porPagina: 1 },
  '57x19': { w: 57, h: 19, label: '5,7 x 1,9 cm', porPagina: 1 },
  '32x25': { w: 32, h: 25, label: '3,2 x 2,5 cm', porPagina: 1 }
};
const TAMANHO_PADRAO = '100x150';

// linha de picote entre etiquetas empilhadas na mesma folha — desenhada segmento a
// segmento porque o filtro de rasterização da impressora não respeita setLineDashPattern
function linhaPicote(doc, y, W) {
  doc.setDrawColor(60, 60, 60); doc.setLineWidth(0.35);
  for (let x = 0; x < W; x += 3.2) doc.line(x, y, Math.min(x + 2, W), y);
}

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

// doc.text com maxWidth quebra em várias linhas sozinho — mas todo o resto do layout
// (principalmente o rodapé, numa posição Y fixa) assume texto de uma linha só. Texto
// livre (nome/local/obs) pode vir arbitrariamente longo, então força uma linha só aqui,
// truncando com reticências, em vez de deixar quebrar e atropelar o que vem depois.
function linhaUnica(doc, texto, maxWidth) {
  const linhas = doc.splitTextToSize(texto, maxWidth);
  if (linhas.length <= 1) return texto;
  let linha = linhas[0].trimEnd();
  while (linha.length > 1 && doc.getTextWidth(linha + '…') > maxWidth) linha = linha.slice(0, -1).trimEnd();
  return linha + '…';
}

function desenharEtiquetaGrande(doc, lab, W, H, opts, y0 = 0) {
  const pad = 4, maxW = W - 2 * pad;
  const logo = opts.comLogo ? carregarLogoBase64() : false;
  let empresaX = pad, ty = y0 + 4.3;
  if (logo) {
    const logoW = 6, logoH = logoW * LOGO_RATIO;
    doc.addImage(logo, 'PNG', pad, y0 + 2, logoW, logoH);
    empresaX = pad + logoW + 1.5;
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(70, 70, 70);
  doc.text(EMPRESA_NOME, empresaX, ty);

  ty = y0 + 8;
  // OT + nome do trabalho em negrito — tem que ter destaque, não só uma legenda apagada
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(40, 40, 40);
  doc.text(linhaUnica(doc, `${lab.ot || ''}${lab.nomeOt ? ' - ' + lab.nomeOt : ''}`, maxW * 0.72), pad, ty);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
  doc.text(`${lab.unitIdx ?? 1}/${lab.unitTotal ?? 1}`, W - pad, ty, { align: 'right' });

  ty += 5.5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(15, 15, 15);
  doc.text(linhaUnica(doc, String(lab.nome || ''), maxW), pad, ty);

  ty += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(40, 40, 40);
  doc.text(linhaUnica(doc, String(lab.local || ''), maxW), pad, ty);

  if (lab.obs) {
    ty += 4.5;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
    doc.text(linhaUnica(doc, String(lab.obs), maxW), pad, ty);
  }

  // rodapé fica ancorado no fundo, mas nunca mais perto do que 3.5mm da última linha de
  // conteúdo acima dele — um rodapé fixo em y0+H-3.5 colidia com a obs quando ela existia
  // (a baseline da obs ficava abaixo da posição fixa do rodapé, sobrepondo os dois textos)
  const rodapeY = Math.max(y0 + H - 3.5, ty + 3.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(150, 150, 150);
  doc.text(`Patrimônio ${EMPRESA_NOME}`, pad, rodapeY, { maxWidth: maxW });
}

function desenharEtiquetaMedia(doc, lab, W, H, y0 = 0) {
  // conteúdo centralizado (horizontal e vertical) dentro da área útil da etiqueta —
  // monta a pilha de linhas que existem (obs é opcional) e centraliza o bloco todo,
  // em vez de ancorar tudo fixo no topo.
  const pad = 5, maxW = W - 2 * pad, cx = W / 2;

  // OT e nome do trabalho com destaque próprio (negrito, tamanho maior) — não é só uma
  // legenda pequena, é informação tão importante quanto o nome do item pra saber de qual
  // trabalho essa peça é.
  const linhas = [];
  if (lab.ot) linhas.push({ texto: linhaUnica(doc, String(lab.ot), maxW), fonte: 9.5, bold: true, cor: [20, 20, 20], altura: 5 });
  if (lab.nomeOt) linhas.push({ texto: linhaUnica(doc, String(lab.nomeOt), maxW), fonte: 8.5, bold: true, cor: [50, 50, 50], altura: 4.5 });
  linhas.push({ texto: linhaUnica(doc, String(lab.nome || ''), maxW), fonte: 12, bold: true, cor: [15, 15, 15], altura: 6.5 });
  if (lab.local) linhas.push({ texto: linhaUnica(doc, String(lab.local), maxW), fonte: 9, cor: [50, 50, 50], altura: 5.5 });
  if (lab.obs) linhas.push({ texto: linhaUnica(doc, String(lab.obs), maxW), fonte: 7.5, italic: true, cor: [110, 110, 110], altura: 5 });

  const totalH = linhas.reduce((s, l) => s + l.altura, 0);
  let ty = y0 + (H - totalH) / 2 + linhas[0].altura * 0.7;

  linhas.forEach(l => {
    doc.setFont('helvetica', l.italic ? 'italic' : (l.bold ? 'bold' : 'normal'));
    doc.setFontSize(l.fonte);
    doc.setTextColor(...l.cor);
    doc.text(l.texto, cx, ty, { align: 'center' });
    ty += l.altura;
  });

  // contador "2/5" discreto no canto — fica fora da pilha centralizada
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(170, 170, 170);
  doc.text(`${lab.unitIdx ?? 1}/${lab.unitTotal ?? 1}`, W - pad, y0 + H - 3, { align: 'right' });
}

function desenharEtiquetaPequena(doc, lab, W, H, y0 = 0) {
  // sem espaço pra cabeçalho/rodapé/observação — só o essencial: nome e local
  const pad = 2, maxW = W - 2 * pad;
  const fonteNome = W < 40 ? 8 : 9.5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(fonteNome); doc.setTextColor(15, 15, 15);
  doc.text(linhaUnica(doc, String(lab.nome || ''), maxW), pad, y0 + H * 0.42);
  if (lab.local) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(fonteNome - 2); doc.setTextColor(70, 70, 70);
    doc.text(linhaUnica(doc, String(lab.local), maxW), pad, y0 + H * 0.72);
  }
}

async function gerarQrDataUrl(url) {
  return QRCode.toDataURL(url, { margin: 1, width: 300, color: { dark: '#000000', light: '#ffffff' } });
}

// etiqueta especial com QR "Resumo da OT" — o quanto de texto ao lado do QR muda com o
// tamanho; nos formatos pequenos (pequena) é só o QR, sem texto (não cabe/não precisa).
async function desenharEtiquetaQr(doc, lab, W, H, nivel, y0 = 0) {
  const qrImg = await gerarQrDataUrl(lab.url);
  if (nivel === 'pequena') {
    const qrSize = Math.min(W, H) * 0.9;
    doc.addImage(qrImg, 'PNG', (W - qrSize) / 2, y0 + (H - qrSize) / 2, qrSize, qrSize);
    return;
  }
  const pad = nivel === 'grande' ? 4 : 3;
  const qrSize = Math.min(W * 0.42, H - 2 * pad);
  doc.addImage(qrImg, 'PNG', pad, y0 + (H - qrSize) / 2, qrSize, qrSize);
  const tx = pad + qrSize + pad, tMaxW = W - qrSize - 3 * pad;
  let ty = y0 + H / 2 - (nivel === 'grande' ? 3 : 1);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(nivel === 'grande' ? 11 : 8.5); doc.setTextColor(15, 15, 15);
  doc.text(String(lab.titulo || 'Resumo da OT'), tx, ty, { maxWidth: tMaxW });
  if (nivel === 'grande') {
    ty += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
    doc.text('Aponte a câmera para ver o resumo', tx, ty, { maxWidth: tMaxW });
  }
}

// labels: array de N {ot, nomeOt, nome, local, obs, unitIdx, unitTotal} — no tamanho de
// opts.tamanho (chave de TAMANHOS, padrão 100x150). Uma entrada {tipoQr:true, titulo, url}
// vira uma etiqueta de QR em vez de item normal. Quando o tamanho tem porPagina > 1 (hoje
// só o 10x15cm), várias etiquetas ficam empilhadas na mesma folha física, com picote entre
// elas, em vez de gastar uma folha inteira por item — poupa rolo.
async function gerarPDF(labels, opts = {}) {
  const tam = TAMANHOS[opts.tamanho] || TAMANHOS[TAMANHO_PADRAO];
  const { w: W, h: H, porPagina = 1 } = tam;
  // jsPDF assume retrato por padrão e pode reinterpretar a orientação do [W,H] passado —
  // precisa dizer explicitamente quando a etiqueta é mais larga que alta (a maioria dos
  // tamanhos aqui, exceto o 10x15cm), senão ele gira a página sem avisar.
  const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: W > H ? 'landscape' : 'portrait' });
  const subH = H / porPagina;
  // empilhado usa sempre o layout completo (cabeçalho+rodapé) — já testado que cabe numa
  // faixa de ~30mm; fora do modo empilhado, o nível depende do tamanho físico real da etiqueta
  const nivel = porPagina > 1 ? 'grande' : nivelDeConteudo(W, H);

  for (let idx = 0; idx < labels.length; idx++) {
    const lab = labels[idx];
    const posNaPagina = idx % porPagina;
    if (idx > 0 && posNaPagina === 0) doc.addPage();
    const y0 = posNaPagina * subH;
    if (posNaPagina > 0) linhaPicote(doc, y0, W);

    if (lab.tipoQr) await desenharEtiquetaQr(doc, lab, W, subH, nivel, y0);
    else if (nivel === 'grande') desenharEtiquetaGrande(doc, lab, W, subH, opts, y0);
    else if (nivel === 'media') desenharEtiquetaMedia(doc, lab, W, subH, y0);
    else desenharEtiquetaPequena(doc, lab, W, subH, y0);
  }

  return doc;
}

async function salvarPDF(labels, arquivo, opts) {
  const doc = await gerarPDF(labels, opts);
  fs.writeFileSync(arquivo, Buffer.from(doc.output('arraybuffer')));
  return arquivo;
}

async function imprimir(labels, { salvarEm, comLogo, tamanho } = {}) {
  const arquivo = salvarEm || path.join(os.tmpdir(), `etiqueta-termica-${Date.now()}.pdf`);
  await salvarPDF(labels, arquivo, { comLogo, tamanho });
  // sem -o media/-o PageSize — usa o padrão atual da fila (o único que imprime de verdade
  // nesse driver, ver comentário no topo do arquivo) — "-n 1" explícito.
  execFileSync('/usr/bin/lp', ['-d', PRINTER, '-n', '1', arquivo]);
  return arquivo;
}

module.exports = { gerarPDF, salvarPDF, imprimir, TAMANHOS, TAMANHO_PADRAO, nivelDeConteudo };

if (require.main === module) {
  // uso: node imprimir.js dados.json   (ou pipe via stdin)
  const entrada = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
  const labels = JSON.parse(entrada);
  imprimir(labels).then(arquivo => {
    console.log(`Impresso via ${PRINTER}. PDF salvo em ${arquivo}`);
  });
}
