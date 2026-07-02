// Folha de Requisição de Material (2 vias) em PDF — usada pelo dashboard (index.html), pela Nova OT
// (nova-ot.html) e pelo link "Ver OT online" enviado por email (ot.html).
function construirFolhaRequisicaoPDF({ ot, solicitante, setor, local, data, obs, itens }) {
  if (typeof window.jspdf === 'undefined') { if (window.niuAlert) niuAlert('Gerador de PDF não carregou.'); else alert('Gerador de PDF não carregou.'); return null; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 12;

  // Paleta alinhada à identidade visual do site (tons escuros no cabeçalho, texto com
  // contraste reforçado no corpo — mesmo cuidado aplicado no dashboard/estoque).
  const C = {
    headerBg: [13, 17, 32],
    headerAccent: [91, 140, 255],
    headerSub: [158, 165, 196],
    otNumber: [124, 163, 255],
    text: [16, 19, 32],
    muted: [80, 86, 106],
    border: [211, 215, 228],
    sectionBg: [228, 234, 250],
    zebra: [246, 248, 252],
    primary: [51, 88, 212],
    primaryBg: [221, 229, 250],
    ok: [7, 130, 87],
    okBg: [215, 241, 230],
    white: [255, 255, 255]
  };

  const otUrl = `${location.origin}/ot.html?ot=${encodeURIComponent(ot)}`;
  const qrObj = qrcode(0, 'M'); qrObj.addData(otUrl); qrObj.make();
  const mc = qrObj.getModuleCount(), cell = 6;
  const cv = document.createElement('canvas'); cv.width = cv.height = mc * cell;
  const cx = cv.getContext('2d');
  for (let r = 0; r < mc; r++) for (let c = 0; c < mc; c++) { cx.fillStyle = qrObj.isDark(r, c) ? '#000' : '#fff'; cx.fillRect(c * cell, r * cell, cell, cell); }
  const qrImg = cv.toDataURL('image/png');
  const dataFmt = data ? new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const CW = W - 2 * M;

  // Badge pequeno e arredondado (usado pra destacar potência/voltagem de cada item),
  // no mesmo espírito dos chips de especificação já usados nos cards do site.
  function badge(x, y, texto, corTexto, corFundo) {
    doc.setFontSize(6); doc.setFont('helvetica', 'bold');
    const tw = doc.getTextWidth(texto);
    const w = tw + 3.4, h = 3.8;
    doc.setFillColor(...corFundo);
    doc.roundedRect(x, y - h + 1, w, h, 0.9, 0.9, 'F');
    doc.setTextColor(...corTexto);
    doc.text(texto, x + 1.7, y - 0.3);
    return w;
  }

  function via(T, alturaVia, etiqueta, itensPagina) {
    // ---- cabeçalho ----
    doc.setFillColor(...C.headerBg); doc.rect(M, T, CW, 18, 'F');
    doc.setFillColor(...C.headerAccent); doc.rect(M, T, 1.6, 18, 'F');
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.white);
    doc.text('NIU', M + 5.5, T + 8);
    doc.setFontSize(6.3); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.headerSub);
    doc.text('EXPERIENCE AGENCY', M + 5.5, T + 13);
    doc.setDrawColor(60, 66, 96); doc.setLineWidth(0.3); doc.line(M + 35, T + 3, M + 35, T + 15);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(232, 235, 245);
    doc.text('FOLHA DE REQUISIÇÃO DE MATERIAL', M + 39, T + 8);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.headerSub);
    doc.text(etiqueta, M + 39, T + 13);
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.otNumber);
    doc.text(ot, M + CW - 2, T + 9, { align: 'right' });
    doc.setFontSize(6); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.headerSub);
    doc.text(dataFmt, M + CW - 2, T + 14, { align: 'right' });

    const qs = 26;
    doc.setFillColor(...C.white); doc.setDrawColor(...C.border); doc.setLineWidth(0.25);
    doc.roundedRect(M + CW - qs - 1, T + 20, qs + 2, qs + 8, 1.2, 1.2, 'FD');
    doc.addImage(qrImg, 'PNG', M + CW - qs, T + 21, qs, qs);
    doc.setFontSize(5.3); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.muted);
    doc.text('Ver OT online', M + CW - qs / 2, T + 51, { align: 'center' });

    const infoW = CW - qs - 8;
    let y = T + 22;
    doc.setFontSize(6.6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.primary); doc.text('SOLICITANTE', M, y); y += 4;
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.text); doc.text(solicitante || '—', M, y, { maxWidth: infoW }); y += 7;
    doc.setFontSize(6.6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.primary);
    doc.text('SETOR', M, y); doc.text('DATA', M + 52, y); y += 4;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.text);
    doc.text(setor || '—', M, y, { maxWidth: 48 }); doc.text(dataFmt || '—', M + 52, y); y += 7;
    doc.setFontSize(6.6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.primary); doc.text('LOCAL / OBRA', M, y); y += 4;
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.text); doc.text(local || '—', M, y, { maxWidth: infoW }); y += 8;

    doc.setDrawColor(...C.border); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 5;

    // ---- cabeçalho da tabela ----
    doc.setFillColor(...C.sectionBg); doc.roundedRect(M, y - 3, CW, 7, 1, 1, 'F');
    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.primary);
    doc.text('MATERIAL / ITEM', M + 2, y + 1); doc.text('QTD.', M + 90, y + 1); doc.text('LOCAL ESPECÍFICO', M + 110, y + 1); doc.text('OBSERVAÇÕES', M + 158, y + 1);
    y += 5; doc.setDrawColor(...C.border); doc.line(M, y, W - M, y); y += 3;

    const rowH = 7.2;
    const maxR = Math.floor((alturaVia - (y - T) - 20) / rowH);
    const itensRenderizados = itensPagina.slice(0, maxR);
    itensRenderizados.forEach((it, i) => {
      const yy = y + i * rowH;
      if (i % 2 === 0) { doc.setFillColor(...C.zebra); doc.rect(M, yy - 1.8, CW, rowH, 'F'); }
      doc.setDrawColor(...C.border); doc.setLineWidth(0.1); doc.line(M, yy + rowH - 1.8, W - M, yy + rowH - 1.8);

      doc.setFontSize(7.3); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.text);
      doc.text(String(it.nome || '—'), M + 2, yy + 2.3, { maxWidth: 84 });

      // badges de potência/voltagem — destaque visual pedido para transformadores e afins
      let bx = M + 2;
      const by = yy + 5.9;
      if (it.modelo) bx += badge(bx, by, String(it.modelo), C.primary, C.primaryBg) + 1.3;
      if (it.voltagem) bx += badge(bx, by, String(it.voltagem), C.ok, C.okBg) + 1.3;

      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.text);
      doc.text(`${it.qtd} ${it.unidade || ''}`, M + 90, yy + 2.3);
      doc.text(String(it.local || local || '—'), M + 110, yy + 2.3, { maxWidth: 45 });
      doc.setTextColor(...C.muted);
      doc.text(String(it.obs || '—'), M + 158, yy + 2.3, { maxWidth: W - M - 160 });
    });

    const yObs = T + alturaVia - 20;
    doc.setFillColor(...C.sectionBg); doc.roundedRect(M, yObs, CW, 16, 1.2, 1.2, 'F');
    doc.setDrawColor(...C.border); doc.setLineWidth(0.2); doc.roundedRect(M, yObs, CW, 16, 1.2, 1.2);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.primary); doc.text('OBSERVAÇÕES GERAIS', M + 2, yObs + 5);
    if (obs) { doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.text); doc.text(obs, M + 2, yObs + 11, { maxWidth: CW - 4 }); }

    return itensRenderizados.length;
  }

  // Cada via mostra a lista COMPLETA de itens (são cópias independentes — uma para o
  // solicitante, outra para o estoque), não uma continuação dividida entre as duas.
  // Se a lista não couber inteira numa via, essa via continua em páginas extras.
  const meio = H / 2;
  let restantesSolic = itens.slice();
  let restantesEstoq = itens.slice();
  let pagina = 0;
  do {
    if (pagina > 0) doc.addPage();
    const sufixo = pagina > 0 ? ` (CONT. ${pagina + 1})` : '';
    const usados1 = via(6, meio - 10, 'VIA DO SOLICITANTE' + sufixo, restantesSolic);
    restantesSolic = restantesSolic.slice(usados1);
    doc.setLineDashPattern([3, 2], 0); doc.setDrawColor(...C.border); doc.setLineWidth(0.4);
    doc.line(M, meio, W - M, meio); doc.setLineDashPattern([], 0);
    const usados2 = via(meio + 4, meio - 10, 'VIA DO ESTOQUE' + sufixo, restantesEstoq);
    restantesEstoq = restantesEstoq.slice(usados2);
    doc.setFontSize(6); doc.setTextColor(...C.muted);
    doc.text(`${ot} · ${new Date().toLocaleString('pt-BR')} · NIU Experience Agency`, W / 2, H - 2, { align: 'center' });
    pagina++;
  } while ((restantesSolic.length > 0 || restantesEstoq.length > 0) && pagina < 20);
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
