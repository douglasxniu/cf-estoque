// Extrai etiquetas de um PDF já gerado por este sistema (public/etiquetas.js ou
// print-agent/imprimir.js) — esses PDFs têm texto real desenhado via jsPDF, não são
// imagem, então dá pra ler de volta. Uma página pode conter VÁRIAS etiquetas empilhadas
// (ex: 10x15cm, até 5 por página — ver imprimir.js) ou só uma (tamanhos menores, sem
// cabeçalho/rodapé): se a página tem o rodapé "Patrimônio", usamos ele como delimitador
// entre etiquetas empilhadas; se não tem nenhum (formato pequeno, sem esse campo), a
// página inteira é uma etiqueta só.
'use strict';
const path = require('path');

// textos fixos do cabeçalho/rodapé da empresa — não são campos do item, descartar
function pareceRuidoDeCabecalho(str) {
  if (str === 'NIU Experience Agency' || str === 'Experience Agency') return true;
  if (str.includes('Cidade Cordova')) return true; // endereço
  if (str.includes('210 108 700')) return true; // telefone
  if (str === 'Aponte a câmera para ver o resumo') return true; // etiqueta de QR
  return false;
}

// linhas quebradas (texto longo demais pro maxWidth) viram vários itens do mesmo campo,
// todos com a mesma fonte — agrupa itens consecutivos de fonte igual antes de classificar
function agruparLinhasQuebradas(itens) {
  const grupos = [];
  itens.forEach(it => {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && Math.abs(ultimo.fontSize - it.fontSize) < 0.3) ultimo.str += ' ' + it.str;
    else grupos.push({ str: it.str, fontSize: it.fontSize });
  });
  return grupos;
}

function montarLabelDoGrupo(itensGrupo) {
  let ot = '', nomeOt = '';
  const restantes = [];
  itensGrupo.forEach(it => {
    if (pareceRuidoDeCabecalho(it.str)) return;
    if (/^Patrim[oô]nio\b/.test(it.str)) return; // rodapé de patrimônio, descarta
    if (/^\d+\/\d+$/.test(it.str)) return; // contador "2/5", descarta
    // "OT-2026-0057 - Projeto" (padrão novo) ou "0069 - Projeto" (numeração antiga, sem
    // prefixo "OT-") — sempre a primeira linha do grupo, então não arrisca confundir com
    // nome/local/obs que também tenham " - " no meio do texto
    if (!ot && (/^OT-/.test(it.str) || / - /.test(it.str))) {
      const m = it.str.match(/^(OT-\S+)(?:\s*-\s*(.+))?$/) || it.str.match(/^(\S.*?)\s*-\s*(.+)$/);
      if (m) { ot = m[1]; nomeOt = m[2] || ''; return; }
    }
    restantes.push(it);
  });
  if (!restantes.length) return null;
  const grupos = agruparLinhasQuebradas(restantes).sort((a, b) => b.fontSize - a.fontSize);
  const nome = grupos[0].str;
  const local = grupos[1] ? grupos[1].str : '';
  const obs = grupos[2] ? grupos[2].str : '';
  return { ot, nomeOt, nome, local, obs };
}

// junta etiquetas idênticas (mesmo ot/nome/local/obs) numa linha só com quantidade somada
function agruparIguais(labels) {
  const grupos = [];
  labels.forEach(l => {
    const existente = grupos.find(g => g.ot === l.ot && g.nomeOt === l.nomeOt && g.nome === l.nome && g.local === l.local && g.obs === l.obs);
    if (existente) existente.quantidade++;
    else grupos.push({ ...l, quantidade: 1 });
  });
  return grupos;
}

async function extrairLabelsDoPDF(buffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = path.join(__dirname, 'node_modules/pdfjs-dist/standard_fonts') + path.sep;
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), standardFontDataUrl }).promise;

  const labels = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const itensPagina = content.items
      .map(it => ({ str: (it.str || '').trim(), fontSize: Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 0 }))
      .filter(it => it.str);

    const temRodape = itensPagina.some(it => /^Patrim[oô]nio\b/.test(it.str));
    if (temRodape) {
      // página com uma ou mais etiquetas empilhadas — o rodapé de patrimônio marca o fim de cada uma
      let grupo = [];
      itensPagina.forEach(it => {
        grupo.push(it);
        if (/^Patrim[oô]nio\b/.test(it.str)) {
          const label = montarLabelDoGrupo(grupo);
          if (label) labels.push(label);
          grupo = [];
        }
      });
      if (grupo.length) { const label = montarLabelDoGrupo(grupo); if (label) labels.push(label); }
    } else {
      // sem rodapé (tamanhos pequenos/médios não têm esse campo) — a página inteira é 1 etiqueta
      const label = montarLabelDoGrupo(itensPagina);
      if (label) labels.push(label);
    }
  }
  return agruparIguais(labels);
}

module.exports = { extrairLabelsDoPDF };
