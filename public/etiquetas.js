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
