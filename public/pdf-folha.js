// Folha de Requisição de Material (2 vias) em PDF — usada pelo dashboard (index.html), pela Nova OT
// (nova-ot.html) e pelo link "Ver OT online" enviado por email (ot.html).
function construirFolhaRequisicaoPDF({ ot, nome, solicitante, setor, local, data, obs, itens }) {
  if (typeof window.jspdf === 'undefined') { if (window.niuAlert) niuAlert('Gerador de PDF não carregou.'); else alert('Gerador de PDF não carregou.'); return null; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 12;

  // Paleta alinhada à identidade visual do site — navy profundo no cabeçalho, azul da
  // marca como único acento (nada de blocos de cor decorativos), texto com contraste
  // reforçado no corpo, mesmo cuidado já aplicado no dashboard/estoque.
  const C = {
    headerBg: [9, 12, 24],
    headerBg2: [19, 24, 46],
    headerAccent: [99, 143, 255],
    headerSub: [151, 159, 194],
    text: [17, 20, 34],
    muted: [96, 102, 122],
    border: [223, 226, 235],
    borderSoft: [235, 237, 243],
    sectionAccent: [51, 88, 212],
    zebra: [249, 250, 252],
    primary: [43, 76, 196],
    primaryBg: [228, 234, 251],
    ok: [6, 122, 82],
    okBg: [221, 244, 234],
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
    // ---- cabeçalho: navy em dois tons (leve profundidade) + barra de acento ----
    doc.setFillColor(...C.headerBg); doc.rect(M, T, CW, 18, 'F');
    doc.setFillColor(...C.headerBg2); doc.rect(M, T + 12, CW, 6, 'F');
    doc.setFillColor(...C.headerAccent); doc.rect(M, T, CW, 0.6, 'F');
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.white);
    doc.text('NIU', M + 5, T + 8);
    doc.setFontSize(6.3); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.headerSub);
    doc.text('EXPERIENCE AGENCY', M + 5, T + 13);
    doc.setDrawColor(48, 54, 82); doc.setLineWidth(0.3); doc.line(M + 34, T + 3.5, M + 34, T + 14.5);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(236, 238, 247);
    doc.text('FOLHA DE REQUISIÇÃO DE MATERIAL', M + 38, T + 8);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.headerSub);
    doc.text(etiqueta, M + 38, T + 13);

    // número da OT em destaque, como um selo/pill
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold');
    const otW = doc.getTextWidth(ot) + 6;
    doc.setFillColor(...C.headerAccent); doc.roundedRect(M + CW - otW - 1, T + 3.2, otW, 6.4, 1.6, 1.6, 'F');
    doc.setTextColor(...C.headerBg); doc.text(ot, M + CW - otW / 2 - 1, T + 7.4, { align: 'center' });

    // nome do projeto em destaque, logo abaixo do número — contraste forte (branco sobre navy)
    if (nome) {
      doc.setFontSize(7.2); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.white);
      doc.text(String(nome), M + CW - 2, T + 13, { align: 'right', maxWidth: 65 });
    }

    doc.setFontSize(6); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.headerSub);
    doc.text(dataFmt, M + CW - 2, T + 17.3, { align: 'right' });

    const qs = 22;
    doc.setFillColor(...C.white); doc.setDrawColor(...C.primaryBg); doc.setLineWidth(0.4);
    doc.roundedRect(M + CW - qs - 1, T + 20, qs + 2, qs + 8, 1.2, 1.2, 'FD');
    doc.addImage(qrImg, 'PNG', M + CW - qs, T + 21, qs, qs);
    doc.setFontSize(5.3); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.muted);
    doc.text('Ver OT online', M + CW - qs / 2, T + 47, { align: 'center' });

    // Bloco de informações compacto (2 linhas) — a data já aparece no topo do cabeçalho,
    // então não se repete aqui, economizando espaço para mais itens por página.
    const infoW = CW - qs - 8;
    let y = T + 23;
    doc.setFontSize(6.4); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.primary); doc.text('SOLICITANTE', M, y); y += 3.8;
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.text); doc.text(solicitante || '—', M, y, { maxWidth: infoW }); y += 6;
    doc.setFontSize(6.4); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.primary);
    doc.text('SETOR', M, y); doc.text('LOCAL / OBRA', M + 45, y); y += 3.8;
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.text);
    doc.text(setor || '—', M, y, { maxWidth: 40 }); doc.setFont('helvetica', 'bold'); doc.text(local || '—', M + 45, y, { maxWidth: infoW - 45 }); y += 6;

    // O bloco de texto (esquerda) é mais baixo que o QR code (direita) — garante que a
    // tabela só comece depois do QR terminar, senão as duas partes se sobrepõem.
    y = Math.max(y, T + 20 + (qs + 8) + 3);

    doc.setDrawColor(...C.border); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 4.5;

    // ---- cabeçalho da tabela: faixa clara com acento lateral, não um bloco de cor ----
    doc.setFillColor(...C.borderSoft); doc.rect(M, y - 3, CW, 6.5, 'F');
    doc.setFillColor(...C.sectionAccent); doc.rect(M, y - 3, 1.1, 6.5, 'F');
    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.sectionAccent);
    doc.text('MATERIAL / ITEM', M + 3.5, y + 0.8); doc.text('QTD.', M + 92, y + 0.8); doc.text('LOCAL ESPECÍFICO', M + 112, y + 0.8); doc.text('OBSERVAÇÕES', M + 160, y + 0.8);
    y += 4.5; doc.setDrawColor(...C.border); doc.line(M, y, W - M, y); y += 3;

    const yObsAltura = obs ? 11 : 6;
    const rowH = 5.8;
    const maxR = Math.floor((alturaVia - (y - T) - yObsAltura) / rowH);
    const itensRenderizados = itensPagina.slice(0, maxR);
    itensRenderizados.forEach((it, i) => {
      const yy = y + i * rowH;
      if (i % 2 === 0) { doc.setFillColor(...C.zebra); doc.rect(M, yy - 1.8, CW, rowH, 'F'); }
      doc.setDrawColor(...C.borderSoft); doc.setLineWidth(0.1); doc.line(M, yy + rowH - 1.8, W - M, yy + rowH - 1.8);

      doc.setFontSize(7.3); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.text);
      const nomeStr = String(it.nome || '—');
      doc.text(nomeStr, M + 2, yy + 2.3, { maxWidth: 58 });

      // badges de potência/voltagem — destaque visual pedido para transformadores e afins,
      // colocados na mesma linha do nome pra não gastar altura extra por item
      let bx = M + 2 + Math.min(doc.getTextWidth(nomeStr), 58) + 2.5;
      const by = yy + 2.3;
      if (it.modelo) bx += badge(bx, by, String(it.modelo), C.primary, C.primaryBg) + 1.3;
      if (it.voltagem) bx += badge(bx, by, String(it.voltagem), C.ok, C.okBg) + 1.3;

      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.text);
      doc.text(`${it.qtd} ${it.unidade || ''}`, M + 92, yy + 2.3);
      doc.text(String(it.local || local || '—'), M + 112, yy + 2.3, { maxWidth: 45 });
      doc.setTextColor(...C.muted);
      doc.text(String(it.obs || '—'), M + 160, yy + 2.3, { maxWidth: W - M - 162 });
    });

    if (obs) {
      const yObs = T + alturaVia - yObsAltura;
      doc.setFillColor(...C.borderSoft); doc.roundedRect(M, yObs, CW, yObsAltura, 1.2, 1.2, 'F');
      doc.setFillColor(...C.sectionAccent); doc.rect(M, yObs, 1.1, yObsAltura, 'F');
      doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.sectionAccent); doc.text('OBSERVAÇÕES GERAIS', M + 3.5, yObs + 3.6);
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.text); doc.text(obs, M + 3.5, yObs + 8, { maxWidth: CW - 6 });
    }

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
