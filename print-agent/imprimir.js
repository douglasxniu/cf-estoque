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
const TAMANHO_PADRAO = '76x51'; // rolo físico atualmente carregado/calibrado na impressora

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

// pra campos que não podem simplesmente truncar (ex: nome da OT, que pode crescer no
// futuro) — reduz o tamanho da fonte em passos pequenos até caber inteiro na largura
// disponível; só recorre a reticências (via linhaUnica) se nem no tamanho mínimo couber.
// Requer que doc.setFont (família/estilo) já esteja configurado por quem chama, já que a
// largura do texto depende disso.
function fonteResponsiva(doc, texto, maxWidth, fonteMax, fonteMin) {
  let fonte = fonteMax;
  doc.setFontSize(fonte);
  while (fonte > fonteMin && doc.getTextWidth(texto) > maxWidth) {
    fonte = Math.max(fonteMin, fonte - 0.5);
    doc.setFontSize(fonte);
  }
  const coube = doc.getTextWidth(texto) <= maxWidth;
  return { fonte, texto: coube ? texto : linhaUnica(doc, texto, maxWidth) };
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

async function desenharEtiquetaMedia(doc, lab, W, H, opts = {}, y0 = 0) {
  const pad = 4, maxW = W - 2 * pad;

  // cabeçalho: só a logomarca (opcional) + o nome curto da empresa, sem repetir "niu" (o
  // logo já mostra) — igual ao padrão já usado nas outras etiquetas/documentos do sistema.
  // Logo e texto alinhados pelo centro vertical (não pela base do texto), senão a logo
  // fica visualmente "flutuando" acima da frase.
  const logo = opts.comLogo ? carregarLogoBase64() : false;
  const headerY = y0 + 4.3; // baseline do texto
  let headerX = pad;
  if (logo) {
    const logoW = 5, logoH = logoW * LOGO_RATIO;
    // centro da logo alinhado com a altura-x do texto (~0.3em acima da baseline pra fonte
    // minúscula), não com a baseline em si
    doc.addImage(logo, 'PNG', pad, headerY - 0.3 * 2.294 - logoH / 2, logoW, logoH);
    headerX = pad + logoW + 1.4;
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(100, 100, 100);
  doc.text('Experience Agency', headerX, headerY);

  // QR pequeno de resumo da OT no canto superior direito — mesmo link da etiqueta de QR
  // dedicada, só que em toda etiqueta de item também (pra quem já tem a peça em mãos poder
  // ver o resumo sem precisar procurar a etiqueta de resumo separada). 15x15mm: menor que
  // isso, testes mostraram que o celular tem dificuldade de ler na resolução da impressora
  // térmica — módulo físico do QR precisa ficar grande o bastante.
  let larguraColunaDireita = 0;
  let alturaColunaDireita = 0;
  if (lab.qrResumoUrl) {
    const qrSize = 15;
    const qrX = W - pad - qrSize, qrY = y0 + 2;
    const qrImg = await gerarQrDataUrl(lab.qrResumoUrl);
    doc.addImage(qrImg, 'PNG', qrX, qrY, qrSize, qrSize);
    larguraColunaDireita = qrSize;
    alturaColunaDireita = qrY + qrSize - y0;
  }

  // indicador de unidade: em vez de um número solto, quadradinhos preenchidos até a
  // posição atual e vazios depois — mostra de cara "esse item faz parte de um grupo de
  // outros X" sem precisar ler texto. Cai pra um badge numérico só em lotes muito grandes
  // (mais de 8 unidades), onde uma fileira de quadradinhos ficaria ilegível/apertada. Fica
  // embaixo do QR (mesma coluna à direita) quando o QR existe.
  const totalUnidades = lab.unitTotal ?? 1;
  const idxAtual = lab.unitIdx ?? 1;
  const topoContador = y0 + (lab.qrResumoUrl ? alturaColunaDireita + 1.5 : 2.1);
  if (totalUnidades <= 8) {
    const quad = 1.9, gap = 0.7;
    const n = totalUnidades;
    const largura = n * quad + (n - 1) * gap;
    const qx = W - pad - largura, qy = topoContador;
    const corPreenchido = totalUnidades > 1 ? [216, 90, 48] : [140, 140, 140];
    for (let i = 0; i < n; i++) {
      const x = qx + i * (quad + gap);
      if (i < idxAtual) {
        doc.setFillColor(...corPreenchido);
        doc.roundedRect(x, qy, quad, quad, 0.35, 0.35, 'F');
      } else {
        doc.setDrawColor(200, 197, 188); doc.setLineWidth(0.25);
        doc.roundedRect(x, qy, quad, quad, 0.35, 0.35, 'S');
      }
    }
    // o grafismo sozinho não é auto-explicativo pra quem não conhece o padrão — o número
    // continua sempre presente junto, embaixo dos quadradinhos
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...corPreenchido);
    doc.text(`${idxAtual}/${totalUnidades}`, W - pad, qy + quad + 2.6, { align: 'right' });
    larguraColunaDireita = Math.max(larguraColunaDireita, largura);
    alturaColunaDireita = (qy + quad + 2.6) - y0;
  } else {
    const textoContador = `${idxAtual}/${totalUnidades}`;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    const contadorW = doc.getTextWidth(textoContador) + 4, contadorH = 5;
    const contadorX = W - pad - contadorW, contadorY = topoContador;
    doc.setFillColor(216, 90, 48);
    doc.roundedRect(contadorX, contadorY, contadorW, contadorH, 1.2, 1.2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(textoContador, contadorX + contadorW / 2, contadorY + contadorH / 2 + 1.1, { align: 'center' });
    larguraColunaDireita = Math.max(larguraColunaDireita, contadorW);
    alturaColunaDireita = (contadorY + contadorH) - y0;
  }

  // número da OT e nome do trabalho em linhas separadas (não "OT - Nome" numa linha só) —
  // nome de trabalho pode crescer bastante no futuro, e numa linha só ou ele empurra a OT
  // pra fora ou trunca cedo demais. Cada linha encolhe a própria fonte pra caber inteira em
  // vez de truncar (só recorre a reticências se nem a fonte mínima couber). As duas linhas
  // reservam a largura da coluna à direita (QR/quadradinhos/badge), que agora pode ser bem
  // mais alta que o texto por causa do QR — não afeta a posição Y das linhas, só a largura.
  const otY = y0 + 9;
  const otMaxW = maxW - larguraColunaDireita - 2;
  doc.setFont('helvetica', 'bold'); doc.setTextColor(25, 25, 25);
  const otResp = fonteResponsiva(doc, String(lab.ot || ''), otMaxW, 9.5, 7);
  doc.setFontSize(otResp.fonte);
  doc.text(otResp.texto, pad, otY);

  let ultimaLinhaCabecalhoY = otY;
  if (lab.nomeOt) {
    ultimaLinhaCabecalhoY = otY + 4.6;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(95, 95, 95);
    const nomeOtResp = fonteResponsiva(doc, String(lab.nomeOt), otMaxW, 8.5, 6);
    doc.setFontSize(nomeOtResp.fonte);
    doc.text(nomeOtResp.texto, pad, ultimaLinhaCabecalhoY);
  }

  // a divisória precisa ficar abaixo de QUALQUER coisa no cabeçalho — tanto o texto da
  // esquerda (OT/nome) quanto a coluna da direita (que fica bem mais alta quando tem QR)
  const dividerY = Math.max(ultimaLinhaCabecalhoY + 2.6, y0 + alturaColunaDireita + 2);
  doc.setDrawColor(215, 213, 205); doc.setLineWidth(0.25);
  doc.line(pad, dividerY, W - pad, dividerY);

  // corpo: nome do item, local e observação — o bloco fica centralizado no espaço que
  // sobra abaixo do cabeçalho (não colado no topo), pra aproveitar bem o resto da etiqueta.
  const linhas = [];
  linhas.push({ texto: linhaUnica(doc, String(lab.nome || ''), maxW), fonte: 14, bold: true, cor: [15, 15, 15], altura: 6.8 });
  if (lab.local) linhas.push({ texto: linhaUnica(doc, String(lab.local), maxW), fonte: 10, cor: [55, 55, 55], altura: 6 });
  if (lab.obs) linhas.push({ texto: linhaUnica(doc, String(lab.obs), maxW), fonte: 8.5, italic: true, cor: [110, 110, 110], altura: 5.5 });

  const totalH = linhas.reduce((s, l) => s + l.altura, 0);
  const espacoDisponivel = (y0 + H) - dividerY - 2;
  let ty = dividerY + 2 + Math.max(0, (espacoDisponivel - totalH) / 2) + linhas[0].altura * 0.72;

  linhas.forEach(l => {
    doc.setFont('helvetica', l.italic ? 'italic' : (l.bold ? 'bold' : 'normal'));
    doc.setFontSize(l.fonte);
    doc.setTextColor(...l.cor);
    doc.text(l.texto, pad, ty);
    ty += l.altura;
  });
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

// errorCorrectionLevel 'L' (~7% de recuperação, o mínimo da especificação) em vez do 'M'
// padrão da lib — pra uma URL curta como a nossa, isso mantém a versão do QR na menor
// possível, com módulos maiores/mais simples. Numa impressora térmica de baixa definição,
// um módulo maior importa mais pra leitura do celular do que a resiliência a dano físico
// (o problema aqui é resolução de impressão, não etiqueta suja/rasgada).
async function gerarQrDataUrl(url) {
  return QRCode.toDataURL(url, { margin: 2, width: 300, errorCorrectionLevel: 'L', color: { dark: '#000000', light: '#ffffff' } });
}

// etiqueta especial com QR "Resumo da OT" — pensada como uma etiqueta de identificação/
// selo postal pra colar do lado de fora de uma caixa/embalagem: precisa dar pra ler o
// número da OT e o nome do trabalho de longe, sem precisar escanear nada. O QR é só o
// complemento (link pro resumo completo), não o protagonista.
async function desenharEtiquetaQr(doc, lab, W, H, nivel, y0 = 0) {
  const qrImg = await gerarQrDataUrl(lab.url);
  if (nivel === 'pequena') {
    const qrSize = Math.min(W, H) * 0.9;
    doc.addImage(qrImg, 'PNG', (W - qrSize) / 2, y0 + (H - qrSize) / 2, qrSize, qrSize);
    return;
  }
  const pad = nivel === 'grande' ? 5 : 4;
  const qrSize = nivel === 'grande' ? Math.min(W * 0.36, H - 2 * pad) : Math.min(W * 0.34, H - 2 * pad);
  const qrY = y0 + pad;
  doc.addImage(qrImg, 'PNG', pad, qrY, qrSize, qrSize);

  const tx = pad + qrSize + pad, tMaxW = W - qrSize - 3 * pad;

  // "OT" como legenda pequena (igual etiqueta de correio: "Nº DE RASTREIO", "REMETENTE"
  // etc.), o número em si é que precisa ter destaque de verdade
  doc.setFont('helvetica', 'bold'); doc.setFontSize(nivel === 'grande' ? 7 : 6); doc.setTextColor(140, 140, 140);
  doc.text('ORDEM DE TRABALHO', tx, y0 + pad + (nivel === 'grande' ? 3.5 : 3), { maxWidth: tMaxW });

  doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20);
  const otResp = fonteResponsiva(doc, String(lab.ot || ''), tMaxW, nivel === 'grande' ? 20 : 15, nivel === 'grande' ? 12 : 9);
  doc.setFontSize(otResp.fonte);
  const otY = y0 + pad + (nivel === 'grande' ? 12 : 9.5);
  doc.text(otResp.texto, tx, otY);

  let ultimaY = otY;
  if (lab.nomeOt) {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(70, 70, 70);
    const nomeResp = fonteResponsiva(doc, String(lab.nomeOt), tMaxW, nivel === 'grande' ? 11 : 8.5, nivel === 'grande' ? 8 : 6.5);
    doc.setFontSize(nomeResp.fonte);
    ultimaY = otY + (nivel === 'grande' ? 6.5 : 5);
    doc.text(nomeResp.texto, tx, ultimaY);
  }

  // legenda do QR: ancorada no fundo da etiqueta (não colada no texto acima, que varia de
  // tamanho) — cabe embaixo do QR ou ao lado do texto, o que sobrar de espaço
  doc.setFont('helvetica', 'normal'); doc.setFontSize(nivel === 'grande' ? 7.5 : 6); doc.setTextColor(120, 120, 120);
  doc.text('Aponte a câmera para ver os itens', tx, Math.max(ultimaY + (nivel === 'grande' ? 6 : 4.5), qrY + qrSize - 1.5), { maxWidth: tMaxW });
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
  // compress:true ativa Flate nos streams do PDF (inclusive imagens) — sem isso, a logo
  // embutida vai praticamente crua (bitmap RGB sem compressão: 730x200x3 bytes ≈ 438KB só
  // pra logo numa etiqueta de poucos KB), o que já se mostrou capaz de travar/corromper o
  // job na fila da Zebra (ver nota no topo do arquivo e no README).
  const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: W > H ? 'landscape' : 'portrait', compress: true });
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
    else if (nivel === 'media') await desenharEtiquetaMedia(doc, lab, W, subH, opts, y0);
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
