// Impressão de etiquetas QR em lote — um único PDF com grade de etiquetas por página,
// em vez de um download separado por etiqueta. Usado pela aba "QR Codes" e pelo
// "Imprimir todas" do modal de Unidades.

function qrDataUrl(url, cell = 6) {
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const mc = qr.getModuleCount();
  const cv = document.createElement('canvas'); cv.width = cv.height = mc * cell;
  const cx = cv.getContext('2d');
  for (let r = 0; r < mc; r++) for (let c = 0; c < mc; c++) { cx.fillStyle = qr.isDark(r, c) ? '#000' : '#fff'; cx.fillRect(c * cell, r * cell, cell, cell); }
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

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
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

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
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
    doc.text(String(lab.nome || ''), x + pad, ty, { maxWidth: maxW });

    ty += 5.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40, 40, 40);
    doc.text(String(lab.local || ''), x + pad, ty, { maxWidth: maxW });

    ty += 4.5;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(100, 100, 100);
    if (lab.obs) doc.text(String(lab.obs), x + pad, ty, { maxWidth: maxW });

    desenharRodapeInventario(x, y);
  });
  return doc;
}

async function imprimirEtiquetasItens(labels, filename = 'etiquetas-itens.pdf') {
  const doc = await construirEtiquetasItensPDF(labels);
  if (doc) doc.save(filename);
}
