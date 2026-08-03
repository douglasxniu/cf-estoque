// Nota de Transporte (guia de entrega) em PDF, A4 — fechamento do Checkout de Entrega
// (checkout.html). Preto e branco, tipografia grotesca (Helvetica) pra estrutura e
// monoespaçada (Courier) pra dados/números. Layout revisado com base em princípios de
// hierarquia tipográfica impressa (peso/tamanho > caixas por toda parte) e em modelos de
// guia de entrega/packing slip atuais: itens são o conteúdo principal (ficam logo após o
// cabeçalho, não espremidos no rodapé), seções respiram com espaço em branco real em vez
// de blocos colados borda-a-borda, e nada de texto cortado — tudo quebra em linha.
//
// IMPORTANTE: isto é um manifesto INTERNO de conferência/entrega — não é a "guia de
// transporte" fiscal exigida pela Autoridade Tributária (que precisa de ATCUD, série
// comunicada à AT, NIF de remetente/destinatário e software de faturação certificado —
// Decreto-Lei 28/2019 e Portaria 195/2020). Se o material sair fisicamente das instalações
// em circunstância sujeita a essa obrigação, a guia fiscal continua sendo necessária à parte.
function construirNotaTransportePDF({ id, ot, nomeOt, retiradoPor, criadoPor, criadoEm, itens, numeroSequencial, guiasAnteriores, mapaDataUrl, destinoEndereco, destinoPontos }) {
  if (typeof window.jspdf === 'undefined') { if (window.niuAlert) niuAlert('Gerador de PDF não carregou.'); else alert('Gerador de PDF não carregou.'); return null; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 16;
  const CW = W - 2 * M;
  const PRETO = [0, 0, 0], CINZA = [110, 110, 110], CINZA_CLARO = [190, 190, 190];
  const GAP = 6; // espaço em branco consistente entre seções — é o que mais muda a leitura de "formulário apertado" pra "documento organizado"

  function linhaUnica(texto, maxWidth) {
    if (doc.getTextWidth(texto) <= maxWidth) return texto;
    let t = texto;
    while (t.length > 1 && doc.getTextWidth(t + '…') > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }
  // quebra em várias linhas — nunca corta. fonte precisa já estar aplicada em quem chama
  // (setFont/setFontSize) antes de medir, senão a largura calculada não bate com a desenhada
  function quebrar(texto, maxWidth) {
    return doc.splitTextToSize(String(texto ?? '—').trim() || '—', maxWidth);
  }
  function otParaExibicao(bruto) {
    const t = String(bruto || '').trim();
    const m = t.match(/^OT-(\d{4})-(\d{1,6})$/i);
    return m ? `OT-${m[2]}` : t;
  }

  const verificarUrl = `${location.origin}/ordem-transporte.html?id=${id}`;
  const qrObj = qrcode(0, 'M'); qrObj.addData(verificarUrl); qrObj.make();
  const mc = qrObj.getModuleCount(), qcell = 6;
  const cv = document.createElement('canvas'); cv.width = cv.height = mc * qcell;
  const cx = cv.getContext('2d');
  for (let r = 0; r < mc; r++) for (let c = 0; c < mc; c++) { cx.fillStyle = qrObj.isDark(r, c) ? '#000' : '#fff'; cx.fillRect(c * qcell, r * qcell, qcell, qcell); }
  const qrImg = cv.toDataURL('image/png');
  const dataObj = new Date(criadoEm.replace(' ', 'T') + 'Z');
  const dataFmt = dataObj.toLocaleDateString('pt-PT');
  const horaFmt = dataObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const numGuia = String(id).padStart(6, '0');
  const totalPecas = itens.reduce((s, it) => s + (it.quantidade || 1), 0);

  doc.setDrawColor(...PRETO);

  // ============ CABEÇALHO ============
  const hY = 14, hH = 19, hDivX = M + 66;
  doc.setLineWidth(0.5); doc.rect(M, hY, CW, hH);
  doc.setLineWidth(0.2); doc.line(hDivX, hY, hDivX, hY + hH);

  const colEsqW = hDivX - M - 6, colDirW = W - M - hDivX - 8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...PRETO);
  doc.text(linhaUnica('NIU EXPERIENCE AGENCY', colEsqW), M + 4, hY + 7.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2); doc.setTextColor(...CINZA);
  doc.text(linhaUnica('Rua Cidade de Córdova, 5 · Alfragide', colEsqW), M + 4, hY + 12.2);
  doc.text(linhaUnica('2610-038 Lisboa · +351 210 108 700', colEsqW), M + 4, hY + 16);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...PRETO);
  doc.text(linhaUnica('NOTA DE TRANSPORTE', colDirW), hDivX + 4, hY + 7.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(5.4); doc.setTextColor(...CINZA);
  doc.text(linhaUnica('Documento interno de controlo de entrega', colDirW), hDivX + 4, hY + 11.4);
  doc.setFont('courier', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...PRETO);
  doc.text(`Nº ${numGuia}`, hDivX + 4, hY + 16);
  doc.setFont('courier', 'normal'); doc.setFontSize(6.6); doc.setTextColor(...CINZA);
  doc.text(`${dataFmt}  ${horaFmt}`, W - M - 4, hY + 16, { align: 'right' });

  // ============ OT + NOME DO TRABALHO — uma linha, hierarquia por peso/tamanho, não por
  // caixa: é o elemento mais importante da página, ganha espaço e contraste, não uma borda
  // grossa. Rodapé opcional com o histórico da OT (nº desta guia + anteriores). ============
  let y = hY + hH + GAP + 2;
  const otTxt = otParaExibicao(ot || 'MÚLTIPLAS OTs').toUpperCase();
  const nomeTxt = (nomeOt || '').toUpperCase().trim();
  const linhaOt = nomeTxt ? `${otTxt}   —   ${nomeTxt}` : otTxt;
  let fonteOt = 19;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(fonteOt);
  while (fonteOt > 11 && doc.getTextWidth(linhaOt) > CW) { fonteOt -= 0.5; doc.setFontSize(fonteOt); }
  const otFinal = doc.getTextWidth(linhaOt) > CW ? linhaUnica(linhaOt, CW) : linhaOt;
  doc.setTextColor(...PRETO);
  doc.text(otFinal, M + CW / 2, y, { align: 'center' });
  y += 3;
  doc.setLineWidth(0.6); doc.line(M, y, M + CW, y);
  if (numeroSequencial > 1) {
    y += 5;
    const listaAnteriores = (guiasAnteriores || []).map(gid => `Nº${String(gid).padStart(6, '0')}`).join(', ');
    const legenda = `${numeroSequencial}ª guia desta OT${listaAnteriores ? ' · anteriores: ' + listaAnteriores : ''}`;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(...CINZA);
    doc.text(linhaUnica(legenda, CW), M + CW / 2, y, { align: 'center' });
  }
  y += GAP + 3;

  // ============ FAIXA DE META: retirado / liberado / data-hora / peças / QR — uma linha
  // fina, sem caixa grossa em volta de cada célula, só separadores verticais leves ==========
  const metaY = y, metaH = 17;
  const colX = [M, M + 46, M + 92, M + 138, M + 156, M + CW];
  doc.setLineWidth(0.3); doc.line(M, metaY, M + CW, metaY); doc.line(M, metaY + metaH, M + CW, metaY + metaH);
  for (let i = 1; i < colX.length - 1; i++) { doc.setLineWidth(0.15); doc.line(colX[i], metaY + 3, colX[i], metaY + metaH - 3); }

  function celulaMeta(i, rotulo, valor, mono, fonteValor) {
    const x = colX[i] + (i === 0 ? 0 : 4), w = colX[i + 1] - colX[i] - (i === 0 ? 4 : 8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6); doc.setTextColor(...CINZA);
    doc.text(linhaUnica(rotulo, w), x, metaY + 5.5);
    doc.setFont(mono ? 'courier' : 'helvetica', 'bold'); doc.setFontSize(fonteValor || 9); doc.setTextColor(...PRETO);
    doc.text(linhaUnica(String(valor || '—'), w), x, metaY + 13);
  }
  celulaMeta(0, 'RETIRADO POR', retiradoPor);
  celulaMeta(1, 'LIBERADO POR', criadoPor);
  celulaMeta(2, 'DATA / HORA', `${dataFmt}  ${horaFmt}`, true, 10);
  celulaMeta(3, 'Nº PEÇAS', String(totalPecas), true);
  const qs = 13, qx = colX[4] + (colX[5] - colX[4] - qs) / 2, qy = metaY + (metaH - qs) / 2;
  doc.addImage(qrImg, 'PNG', qx, qy, qs, qs);

  y = metaY + metaH + GAP + 2;

  // ============ ITENS — conteúdo principal do documento, logo após a identificação; nome
  // NUNCA é cortado (quebra em quantas linhas precisar), altura de cada linha é calculada
  // pra caber o texto inteiro antes de desenhar qualquer coisa ============
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); doc.setTextColor(...CINZA);
  doc.text('ITENS PARA TRANSPORTE', M, y);
  y += 5;

  const tColX = [M, M + 143, M + CW]; // PEÇA | QUANTIDADE
  const nomeW = tColX[1] - tColX[0] - 5, obsW = nomeW;
  const linhaAltura = 4.2, obsLinhaAltura = 3.5;

  const medidos = itens.map(it => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.4);
    const linhasNome = quebrar(it.nome, nomeW);
    let linhasObs = [];
    if (it.obs) { doc.setFont('helvetica', 'italic'); doc.setFontSize(6.8); linhasObs = quebrar(it.obs, obsW); }
    const altura = 4.5 + linhasNome.length * linhaAltura + (linhasObs.length ? 1.4 + linhasObs.length * obsLinhaAltura : 0) + 3.2;
    return { it, linhasNome, linhasObs, altura };
  });

  const cabecalhoTabelaH = 7.5;
  const rodapeReservado = 46;
  let restantes = medidos.slice();
  let primeiraPagina = true;

  function desenharCabecalhoTabela(yIni, continuacao) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...CINZA);
    doc.text(continuacao ? 'PEÇA (CONTINUAÇÃO)' : 'PEÇA', tColX[0], yIni);
    doc.text('QTD.', tColX[2], yIni, { align: 'right' });
    doc.setLineWidth(0.3); doc.line(M, yIni + 2.5, M + CW, yIni + 2.5);
  }

  while (restantes.length > 0) {
    const espacoDisponivel = H - rodapeReservado - y - cabecalhoTabelaH;
    const pagina = [];
    let usado = 0;
    while (restantes.length && (usado + restantes[0].altura <= espacoDisponivel || pagina.length === 0)) {
      const prox = restantes.shift();
      pagina.push(prox);
      usado += prox.altura;
    }
    desenharCabecalhoTabela(y, !primeiraPagina);
    let ry = y + cabecalhoTabelaH;
    pagina.forEach(({ it, linhasNome, linhasObs, altura }, i) => {
      if (i > 0) { doc.setLineWidth(0.12); doc.setDrawColor(...CINZA_CLARO); doc.line(M, ry, M + CW, ry); doc.setDrawColor(...PRETO); }
      let ty = ry + 4.5;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.4); doc.setTextColor(...PRETO);
      linhasNome.forEach(linha => { doc.text(linha, tColX[0], ty); ty += linhaAltura; });
      if (linhasObs.length) {
        ty += 1.4;
        doc.setFont('helvetica', 'italic'); doc.setFontSize(6.8); doc.setTextColor(...CINZA);
        linhasObs.forEach(linha => { doc.text(linha, tColX[0], ty); ty += obsLinhaAltura; });
      }
      doc.setFont('courier', 'bold'); doc.setFontSize(9); doc.setTextColor(...PRETO);
      doc.text(String(it.quantidade || 1), tColX[2], ry + 4.5, { align: 'right' });
      ry += altura;
    });
    y = ry;

    if (restantes.length > 0) { doc.addPage(); y = 18; primeiraPagina = false; }
  }

  // ============ ENDEREÇO DE ENTREGA + MAPA (opcional) — lado a lado, mapa com metade da
  // largura do documento (não a página toda), endereço nunca cortado ============
  if (mapaDataUrl) {
    y += GAP;
    const gapCol = 8, colW = (CW - gapCol) / 2;
    const mapaH = 52;
    const padX = 0;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); doc.setTextColor(...CINZA);
    doc.text('ENDEREÇO DE ENTREGA', M, y);
    let ey = y + 5.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...PRETO);
    const linhasEndereco = quebrar(destinoEndereco, colW - padX);
    linhasEndereco.forEach(linha => { doc.text(linha, M, ey); ey += 4.6; });

    const pontos = (destinoPontos || []).slice(0, 3);
    if (pontos.length) {
      ey += 2;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8); doc.setTextColor(...CINZA);
      doc.text('PONTOS DE REFERÊNCIA', M, ey);
      ey += 4.4;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(...PRETO);
      pontos.forEach(p => {
        const linhas = quebrar('•  ' + p, colW - padX);
        linhas.forEach((linha, i) => { doc.text(linha, M + (i > 0 ? 4 : 0), ey); ey += 3.7; });
      });
    }

    const mapaX = M + colW + gapCol;
    doc.setLineWidth(0.4); doc.rect(mapaX, y - 1, colW, mapaH);
    try { doc.addImage(mapaDataUrl, 'PNG', mapaX, y - 1, colW, mapaH); doc.rect(mapaX, y - 1, colW, mapaH); } catch (e) {}

    y = Math.max(ey, y - 1 + mapaH) + GAP;
  } else {
    y += GAP;
  }

  // ============ RODAPÉ: assinaturas + aviso — fixo na base da última página ============
  const fY = Math.max(y, H - rodapeReservado + 4);
  const meio = M + CW / 2, gapAss = 8;
  const assW = CW / 2 - gapAss / 2;

  function caixaAssinatura(x0, rotulo, nome) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8); doc.setTextColor(...CINZA);
    doc.text(rotulo, x0, fY);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...PRETO);
    doc.text(linhaUnica(String(nome || '—'), assW), x0, fY + 5.5);
    doc.setLineWidth(0.25); doc.line(x0, fY + 17, x0 + assW, fY + 17);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.4); doc.setTextColor(...CINZA);
    doc.text('Assinatura e data', x0, fY + 20.5);
  }
  caixaAssinatura(M, 'ENTREGUE POR (NIU)', criadoPor);
  caixaAssinatura(meio + gapAss / 2, 'RECEBIDO POR', retiradoPor);

  doc.setFont('helvetica', 'italic'); doc.setFontSize(5.4); doc.setTextColor(...CINZA);
  doc.text('Documento interno de controlo de entrega — não substitui a guia de transporte fiscal (ATCUD), quando aplicável.', M, fY + 27, { maxWidth: CW });
  doc.setFont('courier', 'normal'); doc.setFontSize(5.4);
  doc.text(`GUIA Nº ${numGuia}  ·  ${totalPecas} PEÇA(S)  ·  NIU EXPERIENCE AGENCY`, W / 2, H - 6, { align: 'center' });

  return doc;
}

function gerarNotaTransportePDF(opts) {
  const doc = construirNotaTransportePDF(opts);
  if (doc) doc.save(`nota-transporte-${opts.id}.pdf`);
}
