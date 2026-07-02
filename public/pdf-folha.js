// Folha de Requisição de Material (2 vias) em PDF — usada pelo dashboard (index.html), pela Nova OT
// (nova-ot.html) e pelo link "Ver OT online" enviado por email (ot.html).
function construirFolhaRequisicaoPDF({ ot, solicitante, setor, local, data, obs, itens }) {
  if (typeof window.jspdf === 'undefined') { alert('Gerador de PDF não carregou.'); return null; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 12;

  const otUrl = `${location.origin}/ot.html?ot=${encodeURIComponent(ot)}`;
  const qrObj = qrcode(0, 'M'); qrObj.addData(otUrl); qrObj.make();
  const mc = qrObj.getModuleCount(), cell = 6;
  const cv = document.createElement('canvas'); cv.width = cv.height = mc * cell;
  const cx = cv.getContext('2d');
  for (let r = 0; r < mc; r++) for (let c = 0; c < mc; c++) { cx.fillStyle = qrObj.isDark(r, c) ? '#000' : '#fff'; cx.fillRect(c * cell, r * cell, cell, cell); }
  const qrImg = cv.toDataURL('image/png');
  const dataFmt = data ? new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const CW = W - 2 * M;

  function via(T, alturaVia, etiqueta, itensPagina) {
    doc.setFillColor(12, 14, 22); doc.rect(M, T, CW, 18, 'F');
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
    doc.text('NIU', M + 4, T + 8);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(160, 165, 185);
    doc.text('EXPERIENCE AGENCY', M + 4, T + 13);
    doc.setDrawColor(50, 55, 80); doc.setLineWidth(0.3); doc.line(M + 34, T + 2, M + 34, T + 16);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(220, 225, 240);
    doc.text('FOLHA DE REQUISIÇÃO DE MATERIAL', M + 38, T + 8);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(140, 145, 165);
    doc.text(etiqueta, M + 38, T + 13);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(100, 140, 255);
    doc.text(ot, M + CW - 2, T + 9, { align: 'right' });
    doc.setFontSize(6); doc.setFont('helvetica', 'normal'); doc.setTextColor(140, 145, 165);
    doc.text(dataFmt, M + CW - 2, T + 14, { align: 'right' });

    const qs = 28;
    doc.setFillColor(255, 255, 255); doc.rect(M + CW - qs - 1, T + 20, qs + 2, qs + 8, 'F');
    doc.addImage(qrImg, 'PNG', M + CW - qs, T + 21, qs, qs);
    doc.setFontSize(5.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80);
    doc.text('Ver OT online', M + CW - qs / 2, T + 51, { align: 'center' });

    const infoW = CW - qs - 8;
    let y = T + 22;
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(90, 95, 110); doc.text('SOLICITANTE', M, y); y += 4;
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(12, 15, 28); doc.text(solicitante || '—', M, y, { maxWidth: infoW }); y += 7;
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(90, 95, 110);
    doc.text('SETOR', M, y); doc.text('DATA', M + 52, y); y += 4;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(12, 15, 28);
    doc.text(setor || '—', M, y, { maxWidth: 48 }); doc.text(dataFmt || '—', M + 52, y); y += 7;
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(90, 95, 110); doc.text('LOCAL / OBRA', M, y); y += 4;
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(12, 15, 28); doc.text(local || '—', M, y, { maxWidth: infoW }); y += 8;

    doc.setDrawColor(200, 203, 215); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 5;

    doc.setFillColor(238, 240, 248); doc.rect(M, y - 3, CW, 7, 'F');
    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(70, 75, 100);
    doc.text('MATERIAL / ITEM', M + 1, y + 1); doc.text('QTD.', M + 90, y + 1); doc.text('LOCAL ESPECÍFICO', M + 110, y + 1); doc.text('OBSERVAÇÕES', M + 158, y + 1);
    y += 5; doc.setDrawColor(200, 203, 215); doc.line(M, y, W - M, y); y += 3;

    const rowH = 6;
    const maxR = Math.floor((alturaVia - (y - T) - 36) / rowH);
    const itensRenderizados = itensPagina.slice(0, maxR);
    itensRenderizados.forEach((it, i) => {
      const yy = y + i * rowH;
      if (i % 2 === 0) { doc.setFillColor(248, 249, 252); doc.rect(M, yy - 1.5, CW, rowH, 'F'); }
      doc.setDrawColor(225, 227, 235); doc.setLineWidth(0.1); doc.line(M, yy + rowH - 1.5, W - M, yy + rowH - 1.5);
      doc.setFontSize(7.3); doc.setFont('helvetica', 'bold'); doc.setTextColor(12, 15, 28);
      doc.text(String(it.nome || '—'), M + 1, yy + 2.7, { maxWidth: 86 });
      doc.setFont('helvetica', 'normal');
      doc.text(`${it.qtd} ${it.unidade || ''}`, M + 90, yy + 2.7);
      doc.text(String(it.local || local || '—'), M + 110, yy + 2.7, { maxWidth: 45 });
      doc.setTextColor(80, 85, 100);
      doc.text(String(it.obs || '—'), M + 158, yy + 2.7, { maxWidth: W - M - 160 });
    });

    const yObs = T + alturaVia - 34;
    doc.setFillColor(244, 245, 250); doc.rect(M, yObs, CW, 16, 'F');
    doc.setDrawColor(200, 203, 215); doc.setLineWidth(0.2); doc.rect(M, yObs, CW, 16);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(90, 95, 110); doc.text('OBSERVAÇÕES GERAIS', M + 2, yObs + 5);
    if (obs) { doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(12, 15, 28); doc.text(obs, M + 2, yObs + 11, { maxWidth: CW - 4 }); }

    const ySign = T + alturaVia - 13;
    const sw = (CW - 12) / 2;
    doc.setDrawColor(140, 143, 160); doc.setLineWidth(0.3);
    doc.line(M, ySign, M + sw, ySign); doc.line(M + sw + 12, ySign, M + CW, ySign);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 115, 130);
    doc.text('Solicitante', M, ySign + 4); doc.text('Responsável pelo Estoque', M + sw + 12, ySign + 4);
    return itensRenderizados.length;
  }

  // Se os itens não couberem em uma página (folha de 2 vias), continua em páginas extras —
  // nunca descarta itens silenciosamente.
  const meio = H / 2;
  let restantes = itens.slice();
  let pagina = 0;
  do {
    if (pagina > 0) doc.addPage();
    const sufixo = pagina > 0 ? ` (CONT. ${pagina + 1})` : '';
    const usados1 = via(6, meio - 10, 'VIA DO SOLICITANTE' + sufixo, restantes);
    restantes = restantes.slice(usados1);
    doc.setLineDashPattern([3, 2], 0); doc.setDrawColor(170, 173, 190); doc.setLineWidth(0.4);
    doc.line(M, meio, W - M, meio); doc.setLineDashPattern([], 0);
    const usados2 = via(meio + 4, meio - 10, 'VIA DO ESTOQUE' + sufixo, restantes);
    restantes = restantes.slice(usados2);
    doc.setFontSize(6); doc.setTextColor(160, 163, 175);
    doc.text(`${ot} · ${new Date().toLocaleString('pt-BR')} · NIU Experience Agency`, W / 2, H - 2, { align: 'center' });
    pagina++;
  } while (restantes.length > 0 && pagina < 20);
  return doc;
}

// Gera e baixa o PDF (usado pelos botões "Gerar OT e PDF" / "PDF" do painel).
function gerarFolhaRequisicaoPDF(opts) {
  const doc = construirFolhaRequisicaoPDF(opts);
  if (doc) doc.save(`${opts.ot}.pdf`);
}

// Constrói o PDF e navega para ele, exibindo-o inline no navegador (usado pelo link "Ver OT online" do email).
function abrirFolhaRequisicaoPDF(opts) {
  const doc = construirFolhaRequisicaoPDF(opts);
  if (doc) window.location.href = doc.output('bloburl');
}
