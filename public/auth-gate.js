// Login do painel: injeta "Authorization: Bearer <token>" em toda chamada /api/, mostra a
// tela de login (ou configuração inicial, se ainda não existir nenhum usuário) quando preciso.
(function () {
  const SESSION_KEY = "niu_sessao"; // { token, nome, papel }

  function getSessao() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }
  function setSessao(s) {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }

  window.usuarioAtual = getSessao();
  window.niuLogout = function () {
    setSessao(null);
    window.usuarioAtual = null;
    location.reload();
  };

  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    if (!url.includes("/api/")) return origFetch(input, init);

    init = init || {};
    init.headers = new Headers(init.headers || {});
    const sessao = getSessao();
    if (sessao && sessao.token) init.headers.set("Authorization", "Bearer " + sessao.token);

    const resp = await origFetch(input, init);
    if (resp.status === 401 && !url.includes("/api/auth/")) {
      setSessao(null);
      window.usuarioAtual = null;
      mostrarLogin();
    }
    return resp;
  };

  function overlay(html) {
    const wrap = document.createElement("div");
    wrap.id = "niuAuthOverlay";
    wrap.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--bg,#0a0c10);padding:20px";
    wrap.innerHTML = html;
    const montar = () => document.body.appendChild(wrap);
    if (document.body) montar();
    else document.addEventListener("DOMContentLoaded", montar);
    return wrap;
  }
  function removerOverlay() {
    const el = document.getElementById("niuAuthOverlay");
    if (el) el.remove();
  }

  const estiloCaixa = "max-width:360px;width:100%;background:var(--surface,#161a24);border:1px solid var(--border,rgba(255,255,255,.12));border-radius:16px;padding:28px 26px;box-shadow:var(--shadow-float,0 16px 44px rgba(0,0,0,.5));font-family:'Inter',Arial,sans-serif";
  const estiloInput = "width:100%;padding:10px 12px;margin-top:4px;margin-bottom:14px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,.15));background:var(--surface-2,#20242f);color:var(--text,#eef0f4);font-size:.9rem;font-family:inherit;box-sizing:border-box";
  const estiloLabel = "font-size:.72rem;color:var(--muted,#9aa3b2);font-weight:700";
  const estiloBtn = "width:100%;padding:11px;border:none;border-radius:10px;background:linear-gradient(135deg,#5b8cff,#7c5cff);color:#fff;font-weight:700;cursor:pointer;font-size:.88rem;font-family:inherit";
  const estiloErro = "color:#f87171;font-size:.8rem;margin:-6px 0 12px;min-height:1em";

  async function mostrarLogin() {
    if (document.getElementById("niuAuthOverlay")) return;
    let precisaBootstrap = false;
    try {
      const r = await origFetch("/api/auth/status");
      const d = await r.json();
      precisaBootstrap = !!d.precisaBootstrap;
    } catch (e) {}
    if (precisaBootstrap) mostrarBootstrap();
    else mostrarFormLogin();
  }

  function mostrarFormLogin() {
    const wrap = overlay(`
      <div style="${estiloCaixa}">
        <div style="font-weight:800;font-size:1.05rem;color:var(--text,#eef0f4);margin-bottom:2px">Entrar no painel</div>
        <div style="font-size:.78rem;color:var(--muted,#9aa3b2);margin-bottom:20px">NIU Experience Agency · Controle de Estoque</div>
        <label style="${estiloLabel}">Email</label>
        <input id="niuLoginEmail" type="email" style="${estiloInput}" autocomplete="username">
        <label style="${estiloLabel}">Senha</label>
        <input id="niuLoginSenha" type="password" style="${estiloInput}" autocomplete="current-password">
        <div id="niuLoginErro" style="${estiloErro}"></div>
        <button id="niuLoginBtn" style="${estiloBtn}">Entrar</button>
      </div>
    `);
    const fazerLogin = async () => {
      const email = document.getElementById("niuLoginEmail").value.trim();
      const senha = document.getElementById("niuLoginSenha").value;
      const erroEl = document.getElementById("niuLoginErro");
      erroEl.textContent = "";
      if (!email || !senha) { erroEl.textContent = "Preencha email e senha."; return; }
      try {
        const r = await origFetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, senha }) });
        const d = await r.json();
        if (!r.ok) { erroEl.textContent = d.error || "Erro ao entrar."; return; }
        setSessao({ token: d.token, nome: d.nome, papel: d.papel });
        window.usuarioAtual = { nome: d.nome, papel: d.papel };
        removerOverlay();
        location.reload();
      } catch (e) { erroEl.textContent = "Erro de conexão."; }
    };
    document.getElementById("niuLoginBtn").addEventListener("click", fazerLogin);
    wrap.querySelectorAll("input").forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") fazerLogin(); }));
  }

  function mostrarBootstrap() {
    const wrap = overlay(`
      <div style="${estiloCaixa}">
        <div style="font-weight:800;font-size:1.05rem;color:var(--text,#eef0f4);margin-bottom:2px">Configuração inicial</div>
        <div style="font-size:.78rem;color:var(--muted,#9aa3b2);margin-bottom:20px">Crie a primeira conta de administrador do painel.</div>
        <label style="${estiloLabel}">Seu nome</label>
        <input id="niuBsNome" style="${estiloInput}">
        <label style="${estiloLabel}">Email</label>
        <input id="niuBsEmail" type="email" style="${estiloInput}">
        <label style="${estiloLabel}">Senha (mín. 6 caracteres)</label>
        <input id="niuBsSenha" type="password" style="${estiloInput}">
        <label style="${estiloLabel}">Token de administrador (o mesmo definido com "wrangler secret put ADMIN_TOKEN")</label>
        <input id="niuBsToken" type="password" style="${estiloInput}">
        <div id="niuBsErro" style="${estiloErro}"></div>
        <button id="niuBsBtn" style="${estiloBtn}">Criar conta e entrar</button>
      </div>
    `);
    const criar = async () => {
      const nome = document.getElementById("niuBsNome").value.trim();
      const email = document.getElementById("niuBsEmail").value.trim();
      const senha = document.getElementById("niuBsSenha").value;
      const adminToken = document.getElementById("niuBsToken").value;
      const erroEl = document.getElementById("niuBsErro");
      erroEl.textContent = "";
      if (!nome || !email || !senha || !adminToken) { erroEl.textContent = "Preencha todos os campos."; return; }
      try {
        const r = await origFetch("/api/auth/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, email, senha, adminToken }) });
        const d = await r.json();
        if (!r.ok) { erroEl.textContent = d.error || "Erro ao criar conta."; return; }
        setSessao({ token: d.token, nome: d.nome, papel: d.papel });
        window.usuarioAtual = { nome: d.nome, papel: d.papel };
        removerOverlay();
        location.reload();
      } catch (e) { erroEl.textContent = "Erro de conexão."; }
    };
    document.getElementById("niuBsBtn").addEventListener("click", criar);
    wrap.querySelectorAll("input").forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") criar(); }));
  }

  const sessaoAtual = getSessao();
  if (!sessaoAtual || !sessaoAtual.token) mostrarLogin();
})();
