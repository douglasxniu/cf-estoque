// Injeta o token de admin (X-Admin-Token) em toda chamada /api/ e pede a senha quando necessário.
(function () {
  const TOKEN_KEY = "niu_admin_token";
  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const setToken = t => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

  function askToken() {
    const t = prompt("Senha de acesso ao painel administrativo:");
    setToken(t);
    return t;
  }

  if (!getToken()) askToken();

  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    if (!url.includes("/api/")) return origFetch(input, init);

    init = init || {};
    init.headers = new Headers(init.headers || {});
    const tok = getToken();
    if (tok) init.headers.set("X-Admin-Token", tok);

    const resp = await origFetch(input, init);
    if (resp.status === 401) {
      const novo = askToken();
      if (novo) {
        init.headers.set("X-Admin-Token", novo);
        return origFetch(input, init);
      }
    }
    return resp;
  };
})();
