// Substitui alert()/confirm()/prompt() nativos por modais no mesmo padrão visual do site.
// API: await niuAlert("mensagem"), await niuConfirm("mensagem") -> true/false,
//      await niuPrompt("mensagem", {placeholder, type, value}) -> string|null
(function () {
  const estiloCaixa = "max-width:380px;width:92%;background:var(--surface,#161a24);border:1px solid var(--border,rgba(255,255,255,.12));border-radius:16px;padding:24px 24px 20px;box-shadow:var(--shadow-float,0 16px 44px rgba(0,0,0,.5));font-family:'Inter',Arial,sans-serif;animation:niuDialogIn .18s cubic-bezier(.16,1,.3,1)";
  const estiloMsg = "color:var(--text,#eef0f4);font-size:.92rem;line-height:1.5;margin-bottom:14px;white-space:pre-line";
  const estiloBtns = "display:flex;gap:8px;justify-content:flex-end";
  const estiloBtnSec = "padding:9px 16px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.15));background:var(--surface-2,#20242f);color:var(--text,#eef0f4);font-weight:600;cursor:pointer;font-size:.85rem;font-family:inherit";
  const estiloBtnPrim = "padding:9px 18px;border:none;border-radius:10px;background:linear-gradient(135deg,#5b8cff,#7c5cff);color:#fff;font-weight:700;cursor:pointer;font-size:.85rem;font-family:inherit";
  const estiloBtnDanger = "padding:9px 18px;border:none;border-radius:10px;background:#e0505f;color:#fff;font-weight:700;cursor:pointer;font-size:.85rem;font-family:inherit";
  const estiloInput = "width:100%;padding:9px 11px;margin-bottom:16px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.15));background:var(--surface-2,#20242f);color:var(--text,#eef0f4);font-size:.9rem;font-family:inherit;box-sizing:border-box";

  if (!document.getElementById("niuDialogStyle")) {
    const s = document.createElement("style");
    s.id = "niuDialogStyle";
    s.textContent = `
      @keyframes niuDialogIn{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
      @keyframes niuDialogBgIn{from{opacity:0}to{opacity:1}}
      .niu-dialog-bg{position:fixed;inset:0;z-index:9990;display:flex;align-items:center;justify-content:center;background:rgba(5,6,10,.55);backdrop-filter:blur(4px);padding:20px;animation:niuDialogBgIn .15s ease}
    `;
    document.head.appendChild(s);
  }

  function montar(mensagem, botoesHtml) {
    const bg = document.createElement("div");
    bg.className = "niu-dialog-bg";
    bg.innerHTML = `<div style="${estiloCaixa}"><div class="niu-dlg-msg" style="${estiloMsg}"></div><div style="${estiloBtns}">${botoesHtml}</div></div>`;
    bg.querySelector(".niu-dlg-msg").textContent = mensagem; // via textContent: evita HTML injection na mensagem
    document.body.appendChild(bg);
    return bg;
  }

  window.niuAlert = function (mensagem) {
    return new Promise(resolve => {
      const bg = montar(mensagem, `<button id="niuDlgOk" type="button" style="${estiloBtnPrim}">OK</button>`);
      const fechar = () => { bg.remove(); resolve(); };
      bg.querySelector("#niuDlgOk").addEventListener("click", fechar);
      bg.addEventListener("click", e => { if (e.target === bg) fechar(); });
      document.addEventListener("keydown", function onKey(e) { if (e.key === "Enter" || e.key === "Escape") { document.removeEventListener("keydown", onKey); fechar(); } });
      bg.querySelector("#niuDlgOk").focus();
    });
  };

  window.niuConfirm = function (mensagem, opts) {
    opts = opts || {};
    const corBtn = opts.danger ? estiloBtnDanger : estiloBtnPrim;
    const textoConfirmar = opts.confirmText || "Confirmar";
    const textoCancelar = opts.cancelText || "Cancelar";
    return new Promise(resolve => {
      const bg = montar(mensagem, `
        <button id="niuDlgCancel" type="button" style="${estiloBtnSec}">${textoCancelar}</button>
        <button id="niuDlgConfirm" type="button" style="${corBtn}">${textoConfirmar}</button>
      `);
      const fechar = v => { bg.remove(); resolve(v); };
      bg.querySelector("#niuDlgConfirm").addEventListener("click", () => fechar(true));
      bg.querySelector("#niuDlgCancel").addEventListener("click", () => fechar(false));
      bg.addEventListener("click", e => { if (e.target === bg) fechar(false); });
      document.addEventListener("keydown", function onKey(e) {
        if (e.key === "Escape") { document.removeEventListener("keydown", onKey); fechar(false); }
        else if (e.key === "Enter") { document.removeEventListener("keydown", onKey); fechar(true); }
      });
      bg.querySelector("#niuDlgConfirm").focus();
    });
  };

  window.niuPrompt = function (mensagem, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const bg = document.createElement("div");
      bg.className = "niu-dialog-bg";
      bg.innerHTML = `<div style="${estiloCaixa}">
        <div class="niu-dlg-msg" style="${estiloMsg}"></div>
        <input id="niuDlgInput" type="${opts.type || 'text'}" placeholder="${opts.placeholder || ''}" style="${estiloInput}">
        <div style="${estiloBtns}">
          <button id="niuDlgCancel" type="button" style="${estiloBtnSec}">Cancelar</button>
          <button id="niuDlgConfirm" type="button" style="${estiloBtnPrim}">${opts.confirmText || 'OK'}</button>
        </div>
      </div>`;
      bg.querySelector(".niu-dlg-msg").textContent = mensagem;
      const input = bg.querySelector("#niuDlgInput");
      if (opts.value) input.value = opts.value;
      document.body.appendChild(bg);
      const fechar = v => { bg.remove(); resolve(v); };
      bg.querySelector("#niuDlgConfirm").addEventListener("click", () => fechar(input.value.trim() || null));
      bg.querySelector("#niuDlgCancel").addEventListener("click", () => fechar(null));
      bg.addEventListener("click", e => { if (e.target === bg) fechar(null); });
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") fechar(input.value.trim() || null);
        else if (e.key === "Escape") fechar(null);
      });
      input.focus();
    });
  };
})();
