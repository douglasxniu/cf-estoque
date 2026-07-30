// Popup do MacroView, embutido em qualquer página de qualquer sistema (Estoque, Mapa,
// Kanban, print-agent) — cada um só precisa incluir <script src="https://estoque.niupt.workers.dev/macroview-widget.js">
// e trocar o link "MacroView" por onclick="abrirMacroView();return false".
// CSS totalmente isolado (variáveis --mv-*, não depende do tema de quem incluiu o script) —
// os hosts têm sistemas de tema diferentes entre si (data-theme, body.theme-cad etc), então
// o popup só seleciona claro/escuro pelo prefers-color-scheme do sistema operacional.
// API sempre em URL absoluta: as rotas /api/resolver e /api/ot/sugestoes são públicas no
// Worker do Estoque justamente pra isso — não têm mais dado do que /api/ot/:ot e
// /api/etiquetas-resumo/:ot já expunham publicamente.
(function () {
  if (window.abrirMacroView) return; // já carregado (evita duplicar se o host incluir 2x)
  const MV_API = 'https://estoque.niupt.workers.dev/api';
  const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  let overlay, inputEl, sugestoesEl, resultadoEl, debounceTimer;

  function injetarEstilos() {
    if (document.getElementById('mvStyles')) return;
    const style = document.createElement('style');
    style.id = 'mvStyles';
    style.textContent = `
      #mvOverlay{--mv-bg:#fff;--mv-surface:#f6f5f2;--mv-border:#e4e1d8;--mv-text:#1c1a17;--mv-muted:#79746a;--mv-primary:#5b8cff;--mv-ok:#22a35e;--mv-warn:#c9860e;--mv-danger:#d94f47}
      @media (prefers-color-scheme: dark){ #mvOverlay{--mv-bg:#1b1a17;--mv-surface:#242320;--mv-border:#3a362d;--mv-text:#f1eee6;--mv-muted:#a39c8a} }
      #mvOverlay{position:fixed;inset:0;background:rgba(10,9,7,.55);z-index:99999;display:none;align-items:flex-start;justify-content:center;padding:8vh 16px 40px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-sizing:border-box}
      #mvOverlay.mv-open{display:flex}
      #mvOverlay *{box-sizing:border-box}
      #mvModal{background:var(--mv-bg);color:var(--mv-text);border:1px solid var(--mv-border);border-radius:16px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:20px;box-shadow:0 24px 60px -20px rgba(0,0,0,.5)}
      #mvModal h2{font-size:1.05rem;margin:0 0 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:800}
      #mvModal h2 button{background:none;border:none;color:var(--mv-muted);font-size:1.2rem;cursor:pointer;padding:2px 6px;line-height:1}
      #mvSearchWrap{position:relative}
      #mvInput{width:100%;padding:12px 14px;border:1px solid var(--mv-border);border-radius:10px;background:var(--mv-surface);color:var(--mv-text);font-size:.95rem;font-family:inherit}
      #mvInput:focus{outline:none;border-color:var(--mv-primary)}
      #mvSugestoes{position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--mv-bg);border:1px solid var(--mv-border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:10;max-height:220px;overflow-y:auto;display:none}
      #mvSugestoes.mv-open{display:block}
      .mv-sug-item{padding:10px 14px;cursor:pointer;font-size:.86rem;border-bottom:1px solid var(--mv-border)}
      .mv-sug-item:last-child{border-bottom:none}
      .mv-sug-item:hover{background:var(--mv-surface)}
      .mv-sug-item b{font-weight:700}
      .mv-sug-item span{color:var(--mv-muted);font-size:.78rem;display:block;margin-top:1px}
      #mvResultado{margin-top:16px}
      .mv-empty{color:var(--mv-muted);text-align:center;padding:24px;font-size:.88rem}
      .mv-header-ot{font-size:1.25rem;font-weight:800;color:var(--mv-primary);margin-bottom:2px}
      .mv-sub{color:var(--mv-muted);font-size:.8rem;margin-bottom:14px}
      .mv-eixo{margin-bottom:14px}
      .mv-eixo-titulo{display:flex;align-items:center;gap:8px;font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--mv-muted);margin-bottom:8px}
      .mv-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
      .mv-dot.estoque{background:#5b8cff}.mv-dot.kanban{background:#b9820a}.mv-dot.impressao{background:#8a8578}
      .mv-linha{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--mv-border);font-size:.85rem}
      .mv-linha:last-child{border-bottom:none}
      .mv-linha b{font-weight:700}
      .mv-linha span{font-size:.72rem;color:var(--mv-muted)}
      .mv-badge{font-size:.63rem;font-weight:800;padding:3px 9px;border-radius:20px;white-space:nowrap;flex-shrink:0}
      .mv-badge.pendente{background:rgba(201,134,14,.14);color:var(--mv-warn)}
      .mv-badge.aprovado{background:rgba(34,163,94,.14);color:var(--mv-ok)}
      .mv-badge.devolvido{background:var(--mv-surface);color:var(--mv-muted)}
      .mv-badge.bloqueado{background:rgba(217,79,71,.14);color:var(--mv-danger)}
      .mv-na{color:var(--mv-muted);font-style:italic;font-size:.8rem}
    `;
    document.head.appendChild(style);
  }

  function montarModal() {
    if (overlay) return;
    injetarEstilos();
    overlay = document.createElement('div');
    overlay.id = 'mvOverlay';
    overlay.innerHTML =
      '<div id="mvModal">' +
      '<h2>🔭 MacroView <button type="button" id="mvClose" aria-label="Fechar">✕</button></h2>' +
      '<div id="mvSearchWrap">' +
      '<input id="mvInput" type="text" autocomplete="off" placeholder="Digite o número ou nome da OT...">' +
      '<div id="mvSugestoes"></div>' +
      '</div>' +
      '<div id="mvResultado"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    inputEl = overlay.querySelector('#mvInput');
    sugestoesEl = overlay.querySelector('#mvSugestoes');
    resultadoEl = overlay.querySelector('#mvResultado');

    overlay.addEventListener('click', e => { if (e.target === overlay) window.fecharMacroView(); });
    overlay.querySelector('#mvClose').addEventListener('click', window.fecharMacroView);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.classList.contains('mv-open')) window.fecharMacroView();
    });

    // sugestões aparecem sozinhas ao digitar — sem precisar de Enter nem clicar em nada
    inputEl.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = inputEl.value.trim();
      if (q.length < 2) { sugestoesEl.classList.remove('mv-open'); return; }
      debounceTimer = setTimeout(() => buscarSugestoes(q), 220);
    });
    // Enter continua funcionando como atalho pra quem já sabe o número exato
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { sugestoesEl.classList.remove('mv-open'); buscarResolver(inputEl.value.trim()); }
    });
  }

  async function buscarSugestoes(q) {
    try {
      const r = await fetch(`${MV_API}/ot/sugestoes?q=${encodeURIComponent(q)}`).then(res => res.json());
      const lista = r.sugestoes || [];
      if (!lista.length) { sugestoesEl.classList.remove('mv-open'); return; }
      sugestoesEl.innerHTML = lista.map(s =>
        `<div class="mv-sug-item" data-ot="${esc(s.ot)}"><b>${esc(s.ot)}</b>${s.nome ? `<span>${esc(s.nome)}</span>` : ''}</div>`
      ).join('');
      sugestoesEl.classList.add('mv-open');
      sugestoesEl.querySelectorAll('.mv-sug-item').forEach(el => {
        el.addEventListener('click', () => {
          inputEl.value = el.dataset.ot;
          sugestoesEl.classList.remove('mv-open');
          buscarResolver(el.dataset.ot);
        });
      });
    } catch (e) { /* falha de rede não deve travar a digitação */ }
  }

  async function buscarResolver(ot) {
    if (!ot) return;
    resultadoEl.innerHTML = '<div class="mv-empty">Buscando...</div>';
    const r = await fetch(`${MV_API}/resolver?ot=${encodeURIComponent(ot)}`).then(res => res.json()).catch(() => ({ tipo: 'desconhecido' }));
    resultadoEl.innerHTML = renderResultado(r);
  }

  function renderResultado(r) {
    if (r.tipo === 'desconhecido') return '<div class="mv-empty">Nenhum sistema conhece essa OT ainda.</div>';
    let html = `<div class="mv-header-ot">${esc(r.ot)}</div>`;
    if (r.nomeOt) html += `<div class="mv-sub">${esc(r.nomeOt)}</div>`;

    html += '<div class="mv-eixo"><div class="mv-eixo-titulo"><span class="mv-dot estoque"></span>Material — Estoque</div>';
    if (r.tipo === 'ot' && r.itens.length) {
      html += r.itens.map(i => `
        <div class="mv-linha">
          <div><b>${esc(i.item_nome)}</b><br><span>${i.quantidade} ${esc(i.unidade || '')}${i.local_uso ? ' · ' + esc(i.local_uso) : ''}</span></div>
          <span class="mv-badge ${i.status}">${i.status === 'devolvido' ? 'Devolvido' : i.status === 'aprovado' ? 'Aprovado' : 'Pendente'}</span>
        </div>`).join('');
    } else {
      html += '<div class="mv-na">Sem OT formal registrada no Estoque.</div>';
    }
    html += '</div>';

    html += '<div class="mv-eixo"><div class="mv-eixo-titulo"><span class="mv-dot kanban"></span>Produção — Kanban</div>';
    if (r.kanban && r.kanban.length) {
      html += r.kanban.map(c => `
        <div class="mv-linha">
          <div><b>${esc(c.titulo || 'Sem título')}</b><br><span>${esc(c.coluna || '')}</span></div>
          ${c.blocked ? '<span class="mv-badge bloqueado">🚩 Atrasado</span>' : ''}
        </div>`).join('');
    } else {
      html += '<div class="mv-na">Nenhum cartão encontrado no Kanban.</div>';
    }
    html += '</div>';

    html += '<div class="mv-eixo"><div class="mv-eixo-titulo"><span class="mv-dot impressao"></span>Etiquetas impressas</div>';
    const imp = r.tipo === 'ot-impressao' ? { itens: r.itens, atualizadoEm: r.atualizadoEm } : r.impressao;
    if (imp && imp.itens && imp.itens.length) {
      html += `<div class="mv-linha"><span>${imp.itens.length} item(ns) já publicado(s)${imp.atualizadoEm ? ' · ' + new Date(imp.atualizadoEm.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR') : ''}</span></div>`;
    } else {
      html += '<div class="mv-na">Nenhuma etiqueta impressa registrada ainda.</div>';
    }
    html += '</div>';

    return html;
  }

  window.fecharMacroView = function () {
    if (overlay) overlay.classList.remove('mv-open');
  };

  window.abrirMacroView = function (otInicial) {
    montarModal();
    overlay.classList.add('mv-open');
    inputEl.value = otInicial || '';
    resultadoEl.innerHTML = '';
    sugestoesEl.classList.remove('mv-open');
    setTimeout(() => inputEl.focus(), 30);
    if (otInicial) buscarResolver(otInicial);
  };
})();
