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

// Etiquetas de item (sem QR) pra colar no equipamento físico — grade 2x7 fixa em A4,
// célula sempre do mesmo tamanho. Cada label: [{ot, nomeOt, nome, local, obs, unitIdx, unitTotal}].
// unitIdx/unitTotal = posição da peça física dentro da quantidade daquele mesmo item
// (ex: 2/5 = segundo de cinco transformadores iguais), não a posição no lote inteiro da OT.
function construirEtiquetasItensPDF(labels) {
  if (typeof window.jspdf === 'undefined') { alert('Gerador de PDF não carregou.'); return null; }
  const { jsPDF } = window.jspdf;
  const cols = 2, rows = 7;
  const W = 210, H = 297, M = 10, pad = 4;
  const cellW = (W - 2 * M) / cols, cellH = (H - 2 * M) / rows;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const perPage = cols * rows;
  labels.forEach((lab, idx) => {
    const posOnPage = idx % perPage;
    if (idx > 0 && posOnPage === 0) doc.addPage();
    const col = posOnPage % cols, row = Math.floor(posOnPage / cols);
    const x = M + col * cellW, y = M + row * cellH;
    const maxW = cellW - 2 * pad;

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.25); doc.rect(x, y, cellW, cellH);

    let ty = y + 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(70, 70, 70);
    doc.text(`${lab.ot || ''}${lab.nomeOt ? ' - ' + lab.nomeOt : ''}`, x + pad, ty, { maxWidth: maxW * 0.75 });
    // contador de peça dentro da quantidade do item (ex: "2/5") — permite conferir se falta colar alguma unidade igual
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
    doc.text(`${lab.unitIdx ?? idx + 1}/${lab.unitTotal ?? labels.length}`, x + cellW - pad, ty, { align: 'right' });

    ty += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(15, 15, 15);
    doc.text(String(lab.nome || ''), x + pad, ty, { maxWidth: maxW });

    ty += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(40, 40, 40);
    doc.text(String(lab.local || ''), x + pad, ty, { maxWidth: maxW });

    ty += 6.5;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
    if (lab.obs) doc.text(String(lab.obs), x + pad, ty, { maxWidth: maxW });
  });
  return doc;
}

function imprimirEtiquetasItens(labels, filename = 'etiquetas-itens.pdf') {
  const doc = construirEtiquetasItensPDF(labels);
  if (doc) doc.save(filename);
}
