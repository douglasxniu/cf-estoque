// Nota de Transporte (guia de entrega) em PDF, A4 — fechamento do Checkout de Entrega
// (checkout.html). Layout inspirado nos modelos oficiais de guia de transporte portugueses:
// formulário em grelha com caixas de traço grosso, só preto e branco, maiúsculas nos
// rótulos estruturais, tipografia grotesca (Helvetica) pra estrutura e monoespaçada
// (Courier) pra dados/números — nada de cor, nada arredondado.
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
  const W = 210, H = 297, M = 15;
  const CW = W - 2 * M;
  const PRETO = [0, 0, 0], CINZA = [95, 95, 95];

  // reduz a fonte em passos até caber na largura, só recorrendo a reticências se nem o
  // tamanho mínimo couber — evita texto encavalado em qualquer campo de tamanho variável
  function fonteAjustada(texto, maxWidth, fonteMax, fonteMin, fam = 'helvetica', estilo = 'bold') {
    let fonte = fonteMax;
    doc.setFont(fam, estilo); doc.setFontSize(fonte);
    while (fonte > fonteMin && doc.getTextWidth(texto) > maxWidth) { fonte -= 0.5; doc.setFontSize(fonte); }
    let out = texto;
    if (doc.getTextWidth(out) > maxWidth) {
      while (out.length > 1 && doc.getTextWidth(out + '…') > maxWidth) out = out.slice(0, -1);
      out += '…';
    }
    return { fonte, texto: out };
  }
  function linhaUnica(texto, maxWidth) {
    if (doc.getTextWidth(texto) <= maxWidth) return texto;
    let t = texto;
    while (t.length > 1 && doc.getTextWidth(t + '…') > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }
  // quebra em várias linhas em vez de truncar — usado no endereço de entrega, que NUNCA
  // pode cortar (o motorista precisa do endereço completo, não de um pedaço com "…")
  function quebrarLinhas(texto, maxWidth, fonte, estilo, fam = 'helvetica') {
    doc.setFont(fam, estilo); doc.setFontSize(fonte);
    return doc.splitTextToSize(String(texto || '—'), maxWidth);
  }
  // remove o ano embutido no meio do número (ex: "OT-2026-0383" → "OT-0383") só pra
  // exibição — a busca/gravação continua usando o valor completo original
  function otParaExibicao(bruto) {
    const t = String(bruto || '').trim();
    const m = t.match(/^OT-(\d{4})-(\d{1,6})$/i);
    return m ? `OT-${m[2]}` : t;
  }

  const verificarUrl = `${location.origin}/ordem-transporte.html?id=${id}`;
  const qrObj = qrcode(0, 'M'); qrObj.addData(verificarUrl); qrObj.make();
  const mc = qrObj.getModuleCount(), cell = 6;
  const cv = document.createElement('canvas'); cv.width = cv.height = mc * cell;
  const cx = cv.getContext('2d');
  for (let r = 0; r < mc; r++) for (let c = 0; c < mc; c++) { cx.fillStyle = qrObj.isDark(r, c) ? '#000' : '#fff'; cx.fillRect(c * cell, r * cell, cell, cell); }
  const qrImg = cv.toDataURL('image/png');
  const dataObj = new Date(criadoEm.replace(' ', 'T') + 'Z');
  const dataFmt = dataObj.toLocaleDateString('pt-PT');
  const horaFmt = dataObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const numGuia = String(id).padStart(6, '0');

  doc.setDrawColor(...PRETO);

  // ============ CABEÇALHO: empresa | identificação do documento ============
  const hY = 12, hH = 22, hDivX = M + 64;
  doc.setLineWidth(0.6); doc.rect(M, hY, CW, hH);
  doc.setLineWidth(0.3); doc.line(hDivX, hY, hDivX, hY + hH);

  const colEsqW = hDivX - M - 6, colDirW = W - M - hDivX - 8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...PRETO);
  doc.text(linhaUnica('NIU EXPERIENCE AGENCY', colEsqW), M + 4, hY + 8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.4); doc.setTextColor(...CINZA);
  doc.text(linhaUnica('RUA CIDADE DE CÓRDOVA, 5 · ALFRAGIDE', colEsqW), M + 4, hY + 13.2);
  doc.text(linhaUnica('2610-038 LISBOA · +351 210 108 700', colEsqW), M + 4, hY + 17.6);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...PRETO);
  doc.text(linhaUnica('NOTA DE TRANSPORTE', colDirW), hDivX + 4, hY + 8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(5.7); doc.setTextColor(...CINZA);
  doc.text(linhaUnica('DOCUMENTO INTERNO DE CONTROLO DE ENTREGA', colDirW), hDivX + 4, hY + 12.2);
  doc.setFont('courier', 'bold'); doc.setFontSize(10); doc.setTextColor(...PRETO);
  doc.text(`Nº ${numGuia}`, hDivX + 4, hY + 17.6);
  doc.setFont('courier', 'normal'); doc.setFontSize(7);
  doc.text(`${dataFmt}  ${horaFmt}`, W - M - 4, hY + 17.6, { align: 'right' });

  // ============ FAIXA: Nº DA OT + NOME DO TRABALHO — uma linha só, em destaque ============
  // ganha uma legenda pequena embaixo quando não é a primeira guia desta OT — mostra
  // quantas guias já saíram pra essa OT e referencia as anteriores pelo número
  const temHistorico = numeroSequencial > 1;
  const bY = hY + hH, bH = temHistorico ? 19 : 15;
  doc.setLineWidth(0.6); doc.rect(M, bY, CW, bH);
  const otTxt = otParaExibicao(ot || 'MÚLTIPLAS OTs').toUpperCase();
  const nomeTxt = (nomeOt || '').toUpperCase().trim();
  const linhaOt = nomeTxt ? `${otTxt}   —   ${nomeTxt}` : otTxt;
  const tituloY = temHistorico ? bY + 9 : bY + bH / 2 + 3;
  const ajOt = fonteAjustada(linhaOt, CW - 8, temHistorico ? 15 : 17, 10, 'helvetica', 'bold');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(ajOt.fonte); doc.setTextColor(...PRETO);
  doc.text(ajOt.texto, M + CW / 2, tituloY, { align: 'center' });
  if (temHistorico) {
    const listaAnteriores = (guiasAnteriores || []).map(gid => `Nº${String(gid).padStart(6, '0')}`).join(', ');
    const legenda = `GUIA ${numeroSequencial}ª DESTA OT${listaAnteriores ? '  ·  ANTERIORES: ' + listaAnteriores : ''}`;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.4); doc.setTextColor(...CINZA);
    doc.text(linhaUnica(legenda, CW - 8), M + CW / 2, bY + bH - 3, { align: 'center' });
  }

  // ============ ENDEREÇO DE ENTREGA (opcional) — largura total, endereço NUNCA é cortado
  // (quebra em várias linhas em vez de "…"), mapa grande abaixo, e um rodapé com pontos de
  // referência reais perto do pin, pra ajudar o motorista a confirmar visualmente o local
  // (pedido explícito: mapa bem maior e sem cortar o texto do endereço) ============
  let eY = bY + bH, eH = 0;
  if (mapaDataUrl) {
    const padX = 4;
    const linhasEndereco = quebrarLinhas(destinoEndereco, CW - padX * 2, 10, 'bold');
    const enderecoH = 6 + linhasEndereco.length * 4.6 + 2;

    const mapaH = 92; // mapa grande de propósito — legibilidade em papel pede tamanho, não miniatura

    const linhasPontos = (destinoPontos || []).slice(0, 3).map(p => quebrarLinhas('•  ' + p, CW - padX * 2 - 3, 7.4, 'normal'));
    const pontosH = linhasPontos.length ? 6 + linhasPontos.reduce((s, l) => s + l.length * 3.6, 0) + 3 : 0;

    eH = enderecoH + mapaH + pontosH;
    doc.setLineWidth(0.6); doc.rect(M, eY, CW, eH);

    // endereço — texto completo, quebrado em quantas linhas precisar
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...CINZA);
    doc.text('ENDEREÇO DE ENTREGA', M + padX, eY + 5.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...PRETO);
    linhasEndereco.forEach((linha, i) => doc.text(linha, M + padX, eY + 11 + i * 4.6));

    // mapa — largura total do documento, bem grande
    const mapaY = eY + enderecoH;
    doc.setLineWidth(0.3); doc.line(M, mapaY, M + CW, mapaY);
    try { doc.addImage(mapaDataUrl, 'PNG', M, mapaY, CW, mapaH); } catch (e) {}

    // pontos de referência — rodapé abaixo do mapa, só quando existem
    if (linhasPontos.length) {
      const pontosY = mapaY + mapaH;
      doc.setLineWidth(0.3); doc.line(M, pontosY, M + CW, pontosY);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...CINZA);
      doc.text('PONTOS DE REFERÊNCIA PRA LOCALIZAR', M + padX, pontosY + 5);
      let py = pontosY + 9.5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4); doc.setTextColor(...PRETO);
      linhasPontos.forEach(linhas => { linhas.forEach((linha, i) => doc.text(linha, M + padX + (i > 0 ? 4 : 0), py + i * 3.6)); py += linhas.length * 3.6; });
    }
  }

  // ============ GRELHA DE META: retirado por / liberado por / data-hora / peças / QR ========
  // data/hora ganha coluna mais larga e fonte maior — é o campo com mais destaque pedido
  // depois do cabeçalho da OT, junto com quem retirou/liberou
  const gY = eY + eH, gH = 22;
  const colX = [M, M + 44, M + 88, M + 134, M + 150, M + CW];
  doc.setLineWidth(0.6); doc.rect(M, gY, CW, gH);
  doc.setLineWidth(0.3);
  for (let i = 1; i < colX.length - 1; i++) doc.line(colX[i], gY, colX[i], gY + gH);

  function celula(i, rotulo, valor, mono, fonteValor) {
    const x = colX[i] + 3, w = colX[i + 1] - colX[i] - 5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...CINZA);
    doc.text(linhaUnica(rotulo, w), x, gY + 6);
    doc.setFont(mono ? 'courier' : 'helvetica', 'bold'); doc.setFontSize(fonteValor || 9.5); doc.setTextColor(...PRETO);
    doc.text(linhaUnica(String(valor || '—'), w), x, gY + 15);
  }
  const totalPecas = itens.reduce((s, it) => s + (it.quantidade || 1), 0);
  celula(0, 'RETIRADO POR', retiradoPor);
  celula(1, 'LIBERADO POR', criadoPor);
  celula(2, 'DATA / HORA', `${dataFmt}  ${horaFmt}`, true, 11);
  celula(3, 'Nº PEÇAS', String(totalPecas), true);

  const qs = 15, qx = colX[4] + (colX[5] - colX[4] - qs) / 2, qy = gY + 2.5;
  doc.addImage(qrImg, 'PNG', qx, qy, qs, qs);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(4.6); doc.setTextColor(...CINZA);
  doc.text('VERIFICAR', colX[4] + (colX[5] - colX[4]) / 2, gY + gH - 2, { align: 'center' });

  // ============ TABELA DE PEÇAS (paginada, com moldura e colunas próprias por página) ====
  // só nome + quantidade — a observação, quando existe, entra como uma segunda linha
  // pequena e em itálico embaixo do nome (por isso a linha é mais alta que o texto sozinho
  // precisaria, pra sempre sobrar espaço pra essa segunda linha sem encavalar a próxima)
  const tColX = [M, M + 150, M + CW]; // PEÇA | QUANTIDADE
  const rowH = 9.5;
  const cabecalhoTabelaH = 8;
  const rodapeReservado = 55;

  function desenharMolduraTabela(yIni, nLinhas, continuacao) {
    const altura = cabecalhoTabelaH + nLinhas * rowH;
    doc.setLineWidth(0.6); doc.rect(M, yIni, CW, altura);
    doc.setLineWidth(0.3);
    doc.line(M, yIni + cabecalhoTabelaH, W - M, yIni + cabecalhoTabelaH);
    for (let i = 1; i < tColX.length - 1; i++) doc.line(tColX[i], yIni, tColX[i], yIni + altura);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); doc.setTextColor(...PRETO);
    doc.text(continuacao ? 'PEÇA (CONTINUAÇÃO)' : 'PEÇA', tColX[0] + 3, yIni + 5.4);
    doc.text('QUANTIDADE', tColX[1] + 3, yIni + 5.4);
    return altura;
  }

  let y = gY + gH + 8;
  let restantes = itens.slice();
  let primeiraPagina = true;
  while (restantes.length > 0) {
    const espacoDisponivel = H - rodapeReservado - y;
    const maxLinhas = Math.max(1, Math.floor((espacoDisponivel - cabecalhoTabelaH) / rowH));
    const pagina = restantes.slice(0, maxLinhas);
    restantes = restantes.slice(maxLinhas);
    desenharMolduraTabela(y, pagina.length, !primeiraPagina);

    let ry = y + cabecalhoTabelaH;
    pagina.forEach((it, i) => {
      if (i > 0) doc.setLineWidth(0.15), doc.line(M, ry, W - M, ry);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...PRETO);
      doc.text(linhaUnica(String(it.nome || '—'), tColX[1] - tColX[0] - 6), tColX[0] + 3, ry + 4.4);
      if (it.obs) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(6.6); doc.setTextColor(...CINZA);
        doc.text(linhaUnica(String(it.obs), tColX[1] - tColX[0] - 6), tColX[0] + 3, ry + 8.2);
      }
      doc.setFont('courier', 'bold'); doc.setFontSize(9); doc.setTextColor(...PRETO);
      doc.text(String(it.quantidade || 1), tColX[2] - 4, ry + 4.4, { align: 'right' });
      ry += rowH;
    });

    if (restantes.length > 0) { doc.addPage(); y = 16; primeiraPagina = false; }
  }

  // ============ RODAPÉ: assinaturas + aviso ============
  const fY = H - rodapeReservado + 6;
  const meio = M + CW / 2, gap = 5;
  doc.setLineWidth(0.6);
  doc.rect(M, fY, CW / 2 - gap / 2, 28);
  doc.rect(meio + gap / 2, fY, CW / 2 - gap / 2, 28);

  function caixaAssinatura(x0, largura, rotulo, nome) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2); doc.setTextColor(...CINZA);
    doc.text(rotulo, x0 + 3, fY + 5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...PRETO);
    doc.text(linhaUnica(String(nome || '—'), largura - 6), x0 + 3, fY + 10.5);
    doc.setLineWidth(0.25); doc.line(x0 + 3, fY + 21, x0 + largura - 3, fY + 21);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8); doc.setTextColor(...CINZA);
    doc.text('ASSINATURA E DATA', x0 + 3, fY + 25);
  }
  caixaAssinatura(M, CW / 2 - gap / 2, 'ENTREGUE POR (NIU)', criadoPor);
  caixaAssinatura(meio + gap / 2, CW / 2 - gap / 2, 'RECEBIDO POR', retiradoPor);

  doc.setFont('helvetica', 'italic'); doc.setFontSize(5.6); doc.setTextColor(...CINZA);
  doc.text('Documento interno de controlo de entrega — não substitui a guia de transporte fiscal (ATCUD), quando aplicável.', M, fY + 34, { maxWidth: CW });
  doc.setFont('courier', 'normal'); doc.setFontSize(5.6);
  doc.text(`GUIA Nº ${numGuia}  ·  ${totalPecas} PEÇA(S)  ·  NIU EXPERIENCE AGENCY`, W / 2, H - 6, { align: 'center' });

  return doc;
}

function gerarNotaTransportePDF(opts) {
  const doc = construirNotaTransportePDF(opts);
  if (doc) doc.save(`nota-transporte-${opts.id}.pdf`);
}
