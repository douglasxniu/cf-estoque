// Impressão de etiquetas QR em lote — um único PDF com grade de etiquetas por página,
// em vez de um download separado por etiqueta. Usado pela aba "QR Codes" e pelo
// "Imprimir todas" do modal de Unidades.

// nível de correção de erro 'L' (~7%, o mínimo) em vez de 'M' — pra uma URL curta como a
// nossa, mantém a versão do QR na menor possível, com módulos maiores/mais simples. Numa
// etiquetadora térmica de baixa definição, módulo maior importa mais pra leitura do celular
// do que resiliência a dano físico (o problema aqui é resolução de impressão, não sujeira).
// margin = quantos módulos de zona de silêncio (borda branca) entram na própria imagem.
function qrDataUrl(url, cell = 6, margin = 2) {
  const qr = qrcode(0, 'L'); qr.addData(url); qr.make();
  const mc = qr.getModuleCount();
  const total = mc + margin * 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = total * cell;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
  for (let r = 0; r < mc; r++) for (let c = 0; c < mc; c++) { if (qr.isDark(r, c)) { cx.fillStyle = '#000'; cx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell); } }
  return cv.toDataURL('image/png');
}

// labels: [{url, titulo, subtitulo}]
function construirEtiquetasPDF(labels, opts = {}) {
  if (typeof window.jspdf === 'undefined') { alert('Gerador de PDF não carregou.'); return null; }
  const { jsPDF } = window.jspdf;
  const cols = opts.cols || 4, rows = opts.rows || 6;
  const W = 210, H = 297, M = 8;
  const gap = 3;
  const cellW = (W - 2 * M - (cols - 1) * gap) / cols;
  const cellH = (H - 2 * M - (rows - 1) * gap) / rows;
  const qrSize = Math.min(cellW, cellH) * 0.62;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const perPage = cols * rows;
  labels.forEach((lab, idx) => {
    const posOnPage = idx % perPage;
    if (idx > 0 && posOnPage === 0) doc.addPage();
    const col = posOnPage % cols, row = Math.floor(posOnPage / cols);
    const x = M + col * (cellW + gap), y = M + row * (cellH + gap);

    doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.15); doc.rect(x, y, cellW, cellH);
    const qrImg = qrDataUrl(lab.url, 5);
    const qx = x + (cellW - qrSize) / 2;
    doc.addImage(qrImg, 'PNG', qx, y + 2, qrSize, qrSize);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20);
    doc.text(String(lab.titulo || ''), x + cellW / 2, y + qrSize + 6, { align: 'center', maxWidth: cellW - 2 });
    if (lab.subtitulo) {
      doc.setFontSize(5.8); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 90, 90);
      doc.text(String(lab.subtitulo), x + cellW / 2, y + qrSize + 10, { align: 'center', maxWidth: cellW - 2 });
    }
  });
  return doc;
}

function imprimirEtiquetasEmLote(labels, filename = 'etiquetas.pdf', opts) {
  const doc = construirEtiquetasPDF(labels, opts);
  if (doc) doc.save(filename);
}

// Dados da empresa pro cabeçalho discreto das etiquetas de item (logo em logo-niu.svg).
const EMPRESA_NOME = 'NIU Experience Agency';
const EMPRESA_NOME_CURTO = 'Experience Agency'; // ao lado da logo, que já mostra "niu" — não repetir
const EMPRESA_ENDERECO = 'Rua Cidade Cordova Nº5 - 2610-038 Alfragide';
const EMPRESA_TELEFONE = '(+351) 210 108 700';
const LOGO_RATIO = 10.22 / 36.4; // altura/largura do viewBox de logo-niu.svg

// Rasteriza o logo (SVG) uma única vez — jsPDF não desenha SVG diretamente via addImage.
let _logoNiuDataUrlPromise = null;
function logoNiuDataUrl() {
  if (!_logoNiuDataUrlPromise) {
    _logoNiuDataUrlPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const escala = 8; // resolução maior que o tamanho impresso, pra não sair borrado
        const cv = document.createElement('canvas');
        cv.width = img.width * escala; cv.height = img.height * escala;
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = '/logo-niu.svg';
    });
  }
  return _logoNiuDataUrlPromise;
}

// doc.text com maxWidth quebra em várias linhas sozinho — mas o resto do layout
// (principalmente o rodapé, numa posição Y fixa) assume texto de uma linha só. Texto
// livre (nome/local/obs) pode vir arbitrariamente longo, então força uma linha só,
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

// Etiquetas de item (sem QR) pra colar no equipamento físico — grade 2x7 fixa em A4,
// célula sempre do mesmo tamanho. Cada label: [{ot, nomeOt, nome, local, obs, unitIdx, unitTotal}]
// ou, pra etiqueta de resumo, {tipoQr:true, titulo, url}.
// unitIdx/unitTotal = posição da peça física dentro da quantidade daquele mesmo item
// (ex: 2/5 = segundo de cinco transformadores iguais), não a posição no lote inteiro da OT.
async function construirEtiquetasItensPDF(labels) {
  if (typeof window.jspdf === 'undefined') { alert('Gerador de PDF não carregou.'); return null; }
  const { jsPDF } = window.jspdf;
  const cols = 2, rows = 7;
  const W = 210, H = 297, M = 10, pad = 5;
  const cellW = (W - 2 * M) / cols, cellH = (H - 2 * M) / rows;
  const logoImg = await logoNiuDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const perPage = cols * rows;

  // marcas de corte (cut marks) em cada interseção da grade, em vez de linha de borda —
  // um pequeno "+" com vão no centro, no padrão gráfico usado pra guiar a tesoura/faca.
  const xs = Array.from({ length: cols + 1 }, (_, c) => M + c * cellW);
  const ys = Array.from({ length: rows + 1 }, (_, r) => M + r * cellH);
  const marcaLen = 3.5, marcaGap = 1;
  function desenharMarcasCorte() {
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.15);
    xs.forEach(px => {
      ys.forEach(py => {
        doc.line(px, py - marcaLen, px, py - marcaGap);
        doc.line(px, py + marcaGap, px, py + marcaLen);
        doc.line(px - marcaLen, py, px - marcaGap, py);
        doc.line(px + marcaGap, py, px + marcaLen, py);
      });
    });
  }

  // cabeçalho discreto (logo + nome + endereço + telefone) — mesmo em todas as etiquetas,
  // inclusive a de QR, pra identificar a empresa dona do material.
  const headerH = 9.5;
  function desenharCabecalho(x, y) {
    const logoW = 6.5, logoH = logoW * LOGO_RATIO;
    if (logoImg) doc.addImage(logoImg, 'PNG', x + pad, y + 3, logoW, logoH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(90, 90, 90);
    doc.text(EMPRESA_NOME_CURTO, x + pad + logoW + 1.5, y + 5.3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5); doc.setTextColor(140, 140, 140);
    doc.text(`${EMPRESA_ENDERECO} · ${EMPRESA_TELEFONE}`, x + pad, y + headerH, { maxWidth: cellW - 2 * pad });
  }

  // rodapé indicando que a peça pertence ao inventário da empresa (só nas etiquetas de item)
  function desenharRodapeInventario(x, y) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(150, 150, 150);
    doc.text(`Patrimônio ${EMPRESA_NOME}`, x + pad, y + cellH - 3.5, { maxWidth: cellW - 2 * pad });
  }

  labels.forEach((lab, idx) => {
    const posOnPage = idx % perPage;
    if (idx === 0) desenharMarcasCorte();
    if (idx > 0 && posOnPage === 0) { doc.addPage(); desenharMarcasCorte(); }
    const col = posOnPage % cols, row = Math.floor(posOnPage / cols);
    const x = M + col * cellW, y = M + row * cellH;
    const maxW = cellW - 2 * pad;

    desenharCabecalho(x, y);

    // etiqueta especial com QR (ex: resumo da OT) em vez do texto de item padrão
    if (lab.tipoQr) {
      const areaTopo = y + headerH + 2, areaAltura = cellH - headerH - 2;
      const qrSize = Math.min(cellW - 2 * pad, areaAltura) * 0.7;
      const qrImg = qrDataUrl(lab.url, 4);
      doc.addImage(qrImg, 'PNG', x + pad, areaTopo + (areaAltura - qrSize) / 2, qrSize, qrSize);
      const tx = x + pad + qrSize + pad;
      const tMaxW = cellW - qrSize - 3 * pad;
      let qty = areaTopo + areaAltura / 2 - 3;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(15, 15, 15);
      doc.text(String(lab.titulo || 'Resumo da OT'), tx, qty, { maxWidth: tMaxW });
      qty += 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90, 90, 90);
      doc.text('Aponte a câmera para ver o resumo', tx, qty, { maxWidth: tMaxW });
      return;
    }

    let ty = y + headerH + 4.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(70, 70, 70);
    doc.text(`${lab.ot || ''}${lab.nomeOt ? ' - ' + lab.nomeOt : ''}`, x + pad, ty, { maxWidth: maxW * 0.75 });
    // contador de peça dentro da quantidade do item (ex: "2/5") — permite conferir se falta colar alguma unidade igual
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
    doc.text(`${lab.unitIdx ?? idx + 1}/${lab.unitTotal ?? labels.length}`, x + cellW - pad, ty, { align: 'right' });

    ty += 6.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 15, 15);
    doc.text(linhaUnica(doc, String(lab.nome || ''), maxW), x + pad, ty);

    ty += 5.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40, 40, 40);
    doc.text(linhaUnica(doc, String(lab.local || ''), maxW), x + pad, ty);

    ty += 4.5;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(100, 100, 100);
    if (lab.obs) doc.text(linhaUnica(doc, String(lab.obs), maxW), x + pad, ty);

    desenharRodapeInventario(x, y);
  });
  return doc;
}

async function imprimirEtiquetasItens(labels, filename = 'etiquetas-itens.pdf') {
  const doc = await construirEtiquetasItensPDF(labels);
  if (doc) doc.save(filename);
}

// Etiqueta térmica pra etiquetadoras (ex: Zebra GC420d) — padrão 76x51mm, uma etiqueta por
// página. Cabeçalho só com logo + "Experience Agency" (sem repetir "niu"); OT e nome do
// trabalho em linhas separadas logo abaixo, cada uma com fonte responsiva (encolhe pra
// caber inteira antes de truncar); contador de unidade como quadradinhos preenchidos/
// vazios (com o número sempre junto) — mesmo desenho usado no print-agent (imprimir.js),
// só portado pra rodar no navegador via jsPDF em vez de Node. Só gera/baixa o PDF; não
// imprime sozinho — ver print-agent/ pra impressão direta na Zebra desta máquina.
async function construirEtiquetaTermicaPDF(labels) {
  if (typeof window.jspdf === 'undefined') { alert('Gerador de PDF não carregou.'); return null; }
  const { jsPDF } = window.jspdf;
  const W = 76, H = 51, pad = 4, maxW = W - 2 * pad;
  const logoImg = await logoNiuDataUrl().catch(() => null);

  const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: W > H ? 'landscape' : 'portrait', compress: true });

  // pensada como etiqueta de identificação/selo postal pra colar do lado de fora de uma
  // caixa: OT e nome do trabalho precisam dar pra ler de longe, sem escanear nada — o QR é
  // só o complemento (link pro resumo completo).
  function desenharQr(lab, idx) {
    const qrImg = qrDataUrl(lab.url, 5);
    const qrSize = Math.min(W * 0.34, H - 2 * pad);
    const qrY = pad;
    doc.addImage(qrImg, 'PNG', pad, qrY, qrSize, qrSize);
    const tx = pad + qrSize + pad, tMaxW = W - qrSize - 3 * pad;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(140, 140, 140);
    doc.text('ORDEM DE TRABALHO', tx, pad + 3, { maxWidth: tMaxW });

    doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20);
    const otResp = fonteResponsiva(doc, String(lab.ot || ''), tMaxW, 15, 9);
    doc.setFontSize(otResp.fonte);
    const otY = pad + 9.5;
    doc.text(otResp.texto, tx, otY);

    let ultimaY = otY;
    if (lab.nomeOt) {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(70, 70, 70);
      const nomeResp = fonteResponsiva(doc, String(lab.nomeOt), tMaxW, 8.5, 6.5);
      doc.setFontSize(nomeResp.fonte);
      ultimaY = otY + 5;
      doc.text(nomeResp.texto, tx, ultimaY);
    }

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(120, 120, 120);
    doc.text('Aponte a câmera para ver os itens', tx, Math.max(ultimaY + 4.5, qrY + qrSize - 1.5), { maxWidth: tMaxW });
  }

  function desenharItem(lab, idx) {
    // cabeçalho: só a logomarca + o nome curto da empresa, sem repetir "niu"
    let headerX = pad;
    const headerY = 4.3;
    if (logoImg) {
      const logoW = 5, logoH = logoW * LOGO_RATIO;
      doc.addImage(logoImg, 'PNG', pad, headerY - 0.3 * 2.294 - logoH / 2, logoW, logoH);
      headerX = pad + logoW + 1.4;
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(100, 100, 100);
    doc.text(EMPRESA_NOME_CURTO, headerX, headerY);

    // QR pequeno de resumo da OT no canto superior direito — mesmo link da etiqueta de QR
    // dedicada, em toda etiqueta de item também. 15x15mm: menor que isso, o celular tem
    // dificuldade de ler na resolução da impressora térmica.
    let larguraColunaDireita = 0;
    let alturaColunaDireita = 0;
    if (lab.qrResumoUrl) {
      const qrSize = 15;
      const qrX = W - pad - qrSize, qrY = 2;
      doc.addImage(qrDataUrl(lab.qrResumoUrl, 5), 'PNG', qrX, qrY, qrSize, qrSize);
      larguraColunaDireita = qrSize;
      alturaColunaDireita = qrY + qrSize;
    }

    // indicador de unidade: quadradinhos preenchidos até a posição atual e vazios depois,
    // com o número sempre junto embaixo — cai pra um badge numérico sozinho acima de 8
    // unidades, onde a fileira de quadrados ficaria ilegível/apertada. Fica embaixo do QR
    // (mesma coluna à direita) quando o QR existe.
    const totalUnidades = lab.unitTotal ?? 1;
    const idxAtual = lab.unitIdx ?? (idx + 1);
    const topoContador = lab.qrResumoUrl ? alturaColunaDireita + 1.5 : 2.1;
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
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...corPreenchido);
      doc.text(`${idxAtual}/${totalUnidades}`, W - pad, qy + quad + 2.6, { align: 'right' });
      larguraColunaDireita = Math.max(larguraColunaDireita, largura);
      alturaColunaDireita = (qy + quad + 2.6);
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
      alturaColunaDireita = contadorY + contadorH;
    }

    // número da OT e nome do trabalho em linhas separadas, cada uma com fonte responsiva
    const otY = 9;
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

    // a divisória precisa ficar abaixo de qualquer coisa no cabeçalho — tanto o texto da
    // esquerda quanto a coluna da direita (bem mais alta quando tem QR)
    const dividerY = Math.max(ultimaLinhaCabecalhoY + 2.6, alturaColunaDireita + 2);
    doc.setDrawColor(215, 213, 205); doc.setLineWidth(0.25);
    doc.line(pad, dividerY, W - pad, dividerY);

    // corpo: nome do item, local e observação, centralizados no espaço que sobra abaixo
    // do cabeçalho
    const linhas = [];
    linhas.push({ texto: linhaUnica(doc, String(lab.nome || ''), maxW), fonte: 14, bold: true, cor: [15, 15, 15], altura: 6.8 });
    if (lab.local) linhas.push({ texto: linhaUnica(doc, String(lab.local), maxW), fonte: 10, cor: [55, 55, 55], altura: 6 });
    if (lab.obs) linhas.push({ texto: linhaUnica(doc, String(lab.obs), maxW), fonte: 8.5, italic: true, cor: [110, 110, 110], altura: 5.5 });

    const totalH = linhas.reduce((s, l) => s + l.altura, 0);
    const espacoDisponivel = H - dividerY - 2;
    let ty = dividerY + 2 + Math.max(0, (espacoDisponivel - totalH) / 2) + linhas[0].altura * 0.72;

    linhas.forEach(l => {
      doc.setFont('helvetica', l.italic ? 'italic' : (l.bold ? 'bold' : 'normal'));
      doc.setFontSize(l.fonte);
      doc.setTextColor(...l.cor);
      doc.text(l.texto, pad, ty);
      ty += l.altura;
    });
  }

  labels.forEach((lab, idx) => {
    if (idx > 0) doc.addPage();
    if (lab.tipoQr) desenharQr(lab, idx);
    else desenharItem(lab, idx);
  });

  return doc;
}

async function imprimirEtiquetaTermica(labels, filename = 'etiqueta-termica.pdf') {
  const doc = await construirEtiquetaTermicaPDF(labels);
  if (doc) doc.save(filename);
}
