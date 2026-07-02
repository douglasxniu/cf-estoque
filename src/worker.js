const EMAIL_DESTINO_PADRAO = "douglas.silva@niu.pt"; // fallback; defina env.EMAIL_DESTINO para configurar sem editar código
const EMAIL_REMETENTE_PADRAO = "onboarding@resend.dev"; // troque após verificar domínio próprio no Resend

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = e => typeof e === "string" && EMAIL_RE.test(e.trim());

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

const PUBLIC_ROUTES = [
  { method: "GET", path: "/api/itens" },
  { method: "GET", path: "/api/categorias" },
  { method: "GET", path: "/api/projetos" },
  { method: "POST", path: "/api/solicitacoes/lote" },
  { method: "GET", path: "/api/auth/status" },
  { method: "POST", path: "/api/auth/bootstrap" },
  { method: "POST", path: "/api/auth/login" }
];
// GET /api/ot/:ot e GET /api/unidades/:id precisam ser públicos: são acessados pelo QR
// físico colado no item / link do email, sem que quem lê tenha o token de admin.
const PUBLIC_ROUTE_PATTERNS = [
  { method: "GET", pattern: /^\/api\/ot\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/unidades\/\d+$/ }
];

function isPublicRoute(path, method) {
  if (PUBLIC_ROUTES.some(r => r.method === method && r.path === path)) return true;
  return PUBLIC_ROUTE_PATTERNS.some(r => r.method === method && r.pattern.test(path));
}

// Ações destrutivas/administrativas — exigem papel "admin" (não bastam apenas estar logado).
const ADMIN_ONLY_PATTERNS = [
  { method: "DELETE", pattern: /^\/api\/itens\/\d+$/ },
  { method: "DELETE", pattern: /^\/api\/solicitacoes\/ot\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/projetos\/[^/]+\/mesclar$/ },
  { method: "GET", pattern: /^\/api\/usuarios$/ },
  { method: "POST", pattern: /^\/api\/usuarios$/ },
  { method: "PATCH", pattern: /^\/api\/usuarios\/\d+$/ }
];
function isAdminOnlyRoute(path, method) {
  return ADMIN_ONLY_PATTERNS.some(r => r.method === method && r.pattern.test(path));
}

// ---------- Hash de senha (PBKDF2) e tokens de sessão assinados (HMAC) ----------
const PBKDF2_ITER = 100000;
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function toBase64Url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = ""; bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hashSenha(senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, keyMaterial, 256);
  return `${toHex(salt)}:${PBKDF2_ITER}:${toHex(bits)}`;
}
async function verificarSenha(senha, hashArmazenado) {
  const [saltHex, iterStr, hashHex] = (hashArmazenado || "").split(":");
  if (!saltHex || !iterStr || !hashHex) return false;
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromHex(saltHex), iterations: parseInt(iterStr, 10), hash: "SHA-256" }, keyMaterial, 256);
  return toHex(bits) === hashHex;
}
async function assinarToken(env, payload) {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${toBase64Url(sig)}`;
}
async function verificarToken(env, token) {
  if (!token || !env.AUTH_SECRET) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valido = await crypto.subtle.verify("HMAC", key, fromBase64Url(sig), new TextEncoder().encode(body));
    if (!valido) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}
// Resolve o usuário autenticado a partir do header Authorization: Bearer <token>.
// Também aceita, por compatibilidade, o antigo header X-Admin-Token (concede papel "admin").
async function usuarioAtual(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (bearer) {
    const payload = await verificarToken(env, bearer);
    if (payload) return payload;
  }
  const legado = request.headers.get("X-Admin-Token");
  if (env.ADMIN_TOKEN && legado === env.ADMIN_TOKEN) {
    return { uid: 0, nome: "Admin", papel: "admin", legado: true };
  }
  return null;
}

async function enviarEmail(env, { item, quantidade, unidade, ot, solicitante, setor }) {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.EMAIL_REMETENTE || EMAIL_REMETENTE_PADRAO,
        to: env.EMAIL_DESTINO || EMAIL_DESTINO_PADRAO,
        subject: `📋 Nova solicitação: ${item} (OT ${ot})`,
        html: `
        <div style="background:#0f1115;padding:32px;font-family:-apple-system,Helvetica,Arial,sans-serif">
          <div style="max-width:420px;margin:0 auto;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:18px;padding:26px;backdrop-filter:blur(10px)">
            <div style="font-size:13px;color:#9aa3b2;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Nova solicitação de material</div>
            <div style="font-size:21px;font-weight:700;color:#fff;margin-bottom:18px">${item}</div>
            <table style="width:100%;font-size:14px;color:#e2e6ed;border-collapse:collapse">
              <tr><td style="padding:6px 0;color:#9aa3b2">Quantidade</td><td style="padding:6px 0;text-align:right;font-weight:600">${quantidade} ${unidade || ""}</td></tr>
              <tr style="border-top:1px solid rgba(255,255,255,.1)"><td style="padding:6px 0;color:#9aa3b2">OT</td><td style="padding:6px 0;text-align:right;font-weight:600">${ot}</td></tr>
              <tr style="border-top:1px solid rgba(255,255,255,.1)"><td style="padding:6px 0;color:#9aa3b2">Solicitante</td><td style="padding:6px 0;text-align:right;font-weight:600">${solicitante}</td></tr>
              <tr style="border-top:1px solid rgba(255,255,255,.1)"><td style="padding:6px 0;color:#9aa3b2">Setor</td><td style="padding:6px 0;text-align:right;font-weight:600">${setor || "-"}</td></tr>
            </table>
          </div>
        </div>`
      })
    });
  } catch (e) {
    console.log("Falha ao enviar e-mail:", e);
  }
}

async function enviarEmailLote(env, { ot, solicitante, setor, itens }) {
  if (!env.RESEND_API_KEY) return;
  const linhas = itens.map(i => `
    <tr><td style="padding:6px 0;color:#e2e6ed">${i.item}</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#e2e6ed">${i.quantidade}</td></tr>
  `).join("");
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_REMETENTE || EMAIL_REMETENTE_PADRAO,
        to: env.EMAIL_DESTINO || EMAIL_DESTINO_PADRAO,
        subject: `Nova solicitação (OT ${ot}) — ${itens.length} item(ns)`,
        html: `
        <div style="background:#0f1115;padding:32px;font-family:-apple-system,Helvetica,Arial,sans-serif">
          <div style="max-width:440px;margin:0 auto;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:18px;padding:26px;backdrop-filter:blur(10px)">
            <div style="font-size:13px;color:#9aa3b2;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Nova solicitação de material</div>
            <div style="font-size:21px;font-weight:700;color:#fff;margin-bottom:14px">OT ${ot}</div>
            <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:14px">
              <tr style="border-bottom:1px solid rgba(255,255,255,.15)"><td style="padding:6px 0;color:#9aa3b2">Item</td><td style="padding:6px 0;text-align:right;color:#9aa3b2">Qtd.</td></tr>
              ${linhas}
            </table>
            <table style="width:100%;font-size:13px;color:#e2e6ed;border-collapse:collapse">
              <tr style="border-top:1px solid rgba(255,255,255,.1)"><td style="padding:6px 0;color:#9aa3b2">Solicitante</td><td style="padding:6px 0;text-align:right;font-weight:600">${solicitante}</td></tr>
              <tr style="border-top:1px solid rgba(255,255,255,.1)"><td style="padding:6px 0;color:#9aa3b2">Setor</td><td style="padding:6px 0;text-align:right;font-weight:600">${setor || "-"}</td></tr>
            </table>
          </div>
        </div>`
      })
    });
  } catch (e) { console.log("Falha ao enviar e-mail:", e); }
}

// Fecha uma solicitação: libera de volta ao estoque só o que ainda não foi devolvido por leitura
// individual de QR. Se a linha nunca teve unidades vinculadas por scan (item sem rastreio por
// unidade), devolve a quantidade inteira de uma vez (comportamento legado).
async function devolverSolicitacao(env, sol) {
  if (sol.status === "devolvido") return;
  await env.DB.prepare("UPDATE solicitacoes SET status='devolvido' WHERE id=?").bind(sol.id).run();

  const { results: ativos } = await env.DB.prepare(
    "SELECT * FROM solicitacao_unidades WHERE solicitacao_id = ? AND devolvido_em IS NULL"
  ).bind(sol.id).all();
  const { results: totalVinculos } = await env.DB.prepare(
    "SELECT id FROM solicitacao_unidades WHERE solicitacao_id = ?"
  ).bind(sol.id).all();

  if (totalVinculos.length === 0) {
    // nunca foi rastreada por unidade — devolve a quantidade inteira
    await env.DB.prepare("UPDATE itens SET quantidade = quantidade + ? WHERE id=?").bind(sol.quantidade, sol.item_id).run();
  } else {
    // fecha à força os vínculos que ainda estavam ativos (unidade não foi escaneada na volta)
    for (const link of ativos) {
      await env.DB.prepare("UPDATE solicitacao_unidades SET devolvido_em = datetime('now') WHERE id = ?").bind(link.id).run();
      await env.DB.prepare("UPDATE unidades SET status='disponivel' WHERE id = ?").bind(link.unidade_id).run();
      await env.DB.prepare("UPDATE itens SET quantidade = quantidade + 1 WHERE id=?").bind(sol.item_id).run();
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token, Authorization"
        }
      });
    }

    let usuarioLogado = null;
    if (path.startsWith("/api/") && !isPublicRoute(path, method)) {
      if (env.ADMIN_TOKEN || env.AUTH_SECRET) {
        usuarioLogado = await usuarioAtual(request, env);
        if (!usuarioLogado) return json({ error: "Não autorizado" }, 401);
        if (isAdminOnlyRoute(path, method) && usuarioLogado.papel !== "admin") {
          return json({ error: "Ação restrita a administradores" }, 403);
        }
      }
    }

    // ---------- AUTENTICAÇÃO E USUÁRIOS ----------
    if (path === "/api/auth/status" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT id FROM usuarios LIMIT 1").all();
      return json({ precisaBootstrap: results.length === 0 });
    }

    if (path === "/api/auth/bootstrap" && method === "POST") {
      const b = await request.json();
      if (!env.ADMIN_TOKEN || b.adminToken !== env.ADMIN_TOKEN) {
        return json({ error: "Token de administrador inválido" }, 401);
      }
      const { results: existentes } = await env.DB.prepare("SELECT id FROM usuarios LIMIT 1").all();
      if (existentes.length > 0) return json({ error: "Já existe usuário cadastrado. Use o login normal." }, 400);
      if (!b.nome || !isValidEmail(b.email || "") || !b.senha || b.senha.length < 6) {
        return json({ error: "Preencha nome, email válido e senha com pelo menos 6 caracteres" }, 400);
      }
      const hash = await hashSenha(b.senha);
      const r = await env.DB.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, 'admin')")
        .bind(b.nome, b.email.trim().toLowerCase(), hash).run();
      const token = await assinarToken(env, { uid: r.meta.last_row_id, nome: b.nome, papel: "admin", exp: Date.now() + 1000 * 60 * 60 * 24 * 30 });
      return json({ token, nome: b.nome, papel: "admin" });
    }

    if (path === "/api/auth/login" && method === "POST") {
      const b = await request.json();
      const email = (b.email || "").trim().toLowerCase();
      const usuario = await env.DB.prepare("SELECT * FROM usuarios WHERE email = ? AND ativo = 1").bind(email).first();
      if (!usuario || !(await verificarSenha(b.senha || "", usuario.senha_hash))) {
        return json({ error: "Email ou senha inválidos" }, 401);
      }
      const token = await assinarToken(env, { uid: usuario.id, nome: usuario.nome, papel: usuario.papel, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 });
      return json({ token, nome: usuario.nome, papel: usuario.papel });
    }

    if (path === "/api/auth/me" && method === "GET") {
      return json({ nome: usuarioLogado.nome, papel: usuarioLogado.papel });
    }

    if (path === "/api/usuarios" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, nome, email, papel, ativo, criado_em FROM usuarios ORDER BY nome").all();
      return json(results);
    }

    if (path === "/api/usuarios" && method === "POST") {
      const b = await request.json();
      if (!b.nome || !isValidEmail(b.email || "") || !b.senha || b.senha.length < 6) {
        return json({ error: "Preencha nome, email válido e senha com pelo menos 6 caracteres" }, 400);
      }
      const hash = await hashSenha(b.senha);
      try {
        const r = await env.DB.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)")
          .bind(b.nome, b.email.trim().toLowerCase(), hash, b.papel === "admin" ? "admin" : "operador").run();
        return json({ id: r.meta.last_row_id });
      } catch (e) {
        return json({ error: "Já existe um usuário com esse email" }, 409);
      }
    }

    const usuarioMatch = path.match(/^\/api\/usuarios\/(\d+)$/);
    if (usuarioMatch && method === "PATCH") {
      const b = await request.json();
      if (b.senha) {
        if (b.senha.length < 6) return json({ error: "Senha deve ter pelo menos 6 caracteres" }, 400);
        await env.DB.prepare("UPDATE usuarios SET senha_hash=? WHERE id=?").bind(await hashSenha(b.senha), usuarioMatch[1]).run();
      }
      await env.DB.prepare("UPDATE usuarios SET nome=COALESCE(?,nome), papel=COALESCE(?,papel), ativo=COALESCE(?,ativo) WHERE id=?")
        .bind(b.nome ?? null, b.papel ?? null, b.ativo !== undefined ? (b.ativo ? 1 : 0) : null, usuarioMatch[1]).run();
      return json({ ok: true });
    }

    // ---------- ITENS ----------
    if (path === "/api/itens" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM itens ORDER BY nome").all();
      return json(results);
    }

    const itemGetMatch = path.match(/^\/api\/itens\/(\d+)$/);
    if (itemGetMatch && method === "GET") {
      const item = await env.DB.prepare("SELECT * FROM itens WHERE id = ?").bind(itemGetMatch[1]).first();
      return item ? json(item) : json({ error: "Not found" }, 404);
    }

    if (path === "/api/solicitacoes" && method === "GET") {
      const item_id = url.searchParams.get("item_id");
      const status = url.searchParams.get("status");
      let query = "SELECT * FROM solicitacoes WHERE 1=1";
      const binds = [];
      if (item_id) { query += " AND item_id = ?"; binds.push(item_id); }
      if (status === "aberto") { query += " AND status != 'devolvido'"; }
      query += " ORDER BY data DESC";
      const { results } = await env.DB.prepare(query).bind(...binds).all();
      return json(results);
    }

    if (path === "/api/itens" && method === "POST") {
      const b = await request.json();
      const r = await env.DB.prepare(
        "INSERT INTO itens (nome, categoria, quantidade, unidade, modelo, voltagem, codigo, imagem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(b.nome, b.categoria || "Outro", b.quantidade || 0, b.unidade || "un", b.modelo || "", b.voltagem || "", b.codigo || "", b.imagem || null).run();
      return json({ id: r.meta.last_row_id });
    }

    const itemMatch = path.match(/^\/api\/itens\/(\d+)$/);
    if (itemMatch && method === "PATCH") {
      const id = itemMatch[1];
      const b = await request.json();
      if (b.delta !== undefined) {
        const upd = await env.DB.prepare(
          "UPDATE itens SET quantidade = quantidade + ? WHERE id = ? AND quantidade + ? >= 0"
        ).bind(b.delta, id, b.delta).run();
        if (upd.meta.changes === 0) return json({ error: "Quantidade insuficiente" }, 400);
      } else if (b.imagem !== undefined && b.nome === undefined) {
        // atualização leve: só a foto (usada pelo botão "trocar imagem" do card)
        await env.DB.prepare("UPDATE itens SET imagem=? WHERE id=?").bind(b.imagem, id).run();
      } else {
        // edição completa do cadastro (nome/categoria/modelo/voltagem/código) — só admin
        if (usuarioLogado && usuarioLogado.papel !== "admin") {
          return json({ error: "Ação restrita a administradores" }, 403);
        }
        await env.DB.prepare(
          "UPDATE itens SET nome=?, categoria=?, quantidade=?, unidade=?, modelo=?, voltagem=?, codigo=?, imagem=? WHERE id=?"
        ).bind(b.nome, b.categoria, b.quantidade, b.unidade, b.modelo || "", b.voltagem || "", b.codigo || "", b.imagem ?? null, id).run();
      }
      return json({ ok: true });
    }

    if (itemMatch && method === "DELETE") {
      await env.DB.prepare("DELETE FROM itens WHERE id = ?").bind(itemMatch[1]).run();
      return json({ ok: true });
    }

    // ---------- PROJETOS ----------
    if (path === "/api/projetos" && method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT numero, nome, setor, status, criado_em FROM projetos ORDER BY criado_em DESC"
      ).all();
      return json(results);
    }

    if (path === "/api/projetos" && method === "POST") {
      const b = await request.json();
      const numeroManual = (b.numero || "").trim();
      if (numeroManual) {
        try {
          const r = await env.DB.prepare(
            "INSERT INTO projetos (numero, nome, setor) VALUES (?, ?, ?)"
          ).bind(numeroManual, b.nome || "", b.setor || "").run();
          return json({ id: r.meta.last_row_id, numero: numeroManual });
        } catch (e) {
          return json({ error: `Projeto ${numeroManual} já existe` }, 409);
        }
      }
      const year = new Date().getFullYear();
      for (let tentativa = 0; tentativa < 30; tentativa++) {
        const { results } = await env.DB.prepare(
          "SELECT COUNT(*) as total FROM projetos WHERE numero LIKE ?"
        ).bind(`OT-${year}-%`).all();
        const seq = String((results[0]?.total || 0) + 1 + tentativa).padStart(4, "0");
        const candidato = `OT-${year}-${seq}`;
        try {
          const r = await env.DB.prepare(
            "INSERT INTO projetos (numero, nome, setor) VALUES (?, ?, ?)"
          ).bind(candidato, b.nome || "", b.setor || "").run();
          return json({ id: r.meta.last_row_id, numero: candidato });
        } catch (e) { /* número já reservado por outra requisição concorrente; tenta o próximo */ }
      }
      return json({ error: "Não foi possível reservar um número de projeto" }, 500);
    }

    const projetoMatch = path.match(/^\/api\/projetos\/([^/]+)$/);
    if (projetoMatch && method === "PATCH") {
      const b = await request.json();
      await env.DB.prepare(
        "UPDATE projetos SET nome = COALESCE(?, nome), setor = COALESCE(?, setor), status = COALESCE(?, status) WHERE numero = ?"
      ).bind(b.nome ?? null, b.setor ?? null, b.status ?? null, decodeURIComponent(projetoMatch[1])).run();
      return json({ ok: true });
    }

    // Mescla outra OT (origem) dentro desta (:alvo, que prevalece). Os itens da origem passam
    // a pertencer ao alvo, e a origem é removida.
    const mesclarMatch = path.match(/^\/api\/projetos\/([^/]+)\/mesclar$/);
    if (mesclarMatch && method === "POST") {
      const alvoNumero = decodeURIComponent(mesclarMatch[1]);
      const b = await request.json();
      const origemNumero = b.origem;
      if (!origemNumero) return json({ error: "Informe a OT de origem" }, 400);
      if (origemNumero === alvoNumero) return json({ error: "Escolha duas OTs diferentes" }, 400);

      const alvo = await env.DB.prepare("SELECT * FROM projetos WHERE numero = ?").bind(alvoNumero).first();
      const origem = await env.DB.prepare("SELECT * FROM projetos WHERE numero = ?").bind(origemNumero).first();
      if (!alvo || !origem) return json({ error: "OT não encontrada" }, 404);

      await env.DB.prepare("UPDATE solicitacoes SET ot = ?, projeto_id = ? WHERE ot = ?")
        .bind(alvoNumero, alvo.id, origemNumero).run();
      await env.DB.prepare("DELETE FROM projetos WHERE numero = ?").bind(origemNumero).run();
      await env.DB.prepare("UPDATE projetos SET status='aberto' WHERE numero = ?").bind(alvoNumero).run();

      return json({ ok: true });
    }

    // ---------- NOTIFICAÇÕES (para sino do painel) ----------
    if (path === "/api/notificacoes" && method === "GET") {
      const since = url.searchParams.get("since") || "1970-01-01";
      const { results } = await env.DB.prepare(
        "SELECT * FROM solicitacoes WHERE data > ? ORDER BY data DESC LIMIT 20"
      ).bind(since).all();
      return json(results);
    }

    // ---------- CATEGORIAS ----------
    if (path === "/api/categorias" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT DISTINCT categoria FROM itens ORDER BY categoria").all();
      return json(results.map(r => r.categoria));
    }

    if (path === "/api/solicitacoes/lote" && method === "POST") {
      const b = await request.json();
      const { ot, solicitante, setor, itens: lista } = b;
      if (!ot || !solicitante || !Array.isArray(lista) || lista.length === 0) {
        return json({ error: "Dados incompletos" }, 400);
      }
      const projeto = await env.DB.prepare("SELECT * FROM projetos WHERE numero = ?").bind(ot).first();
      if (!projeto) {
        return json({ error: `Projeto ${ot} não encontrado. Peça ao responsável pelo estoque para criá-lo primeiro.` }, 404);
      }
      // reserva atômica: cada UPDATE só afeta linha se houver quantidade suficiente
      const reservados = [];
      for (const li of lista) {
        const upd = await env.DB.prepare(
          "UPDATE itens SET quantidade = quantidade - ? WHERE id = ? AND quantidade >= ?"
        ).bind(li.quantidade, li.itemId, li.quantidade).run();
        if (upd.meta.changes === 0) {
          for (const r of reservados) {
            await env.DB.prepare("UPDATE itens SET quantidade = quantidade + ? WHERE id = ?").bind(r.quantidade, r.itemId).run();
          }
          const item = await env.DB.prepare("SELECT nome FROM itens WHERE id = ?").bind(li.itemId).first();
          return json({ error: `Quantidade indisponível para ${item ? item.nome : li.itemId}` }, 400);
        }
        reservados.push(li);
      }
      const resultado = [];
      for (const li of lista) {
        const item = await env.DB.prepare("SELECT * FROM itens WHERE id = ?").bind(li.itemId).first();
        await env.DB.prepare(
          "INSERT INTO solicitacoes (projeto_id, item_id, item_nome, unidade, quantidade, ot, solicitante, setor, local_uso) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(projeto.id, li.itemId, item.nome, item.unidade, li.quantidade, ot, solicitante, setor || "", li.localUso || "").run();
        resultado.push({ item: item.nome, quantidade: li.quantidade });
      }
      await env.DB.prepare("UPDATE projetos SET status='aberto' WHERE numero=?").bind(ot).run();
      await enviarEmailLote(env, { ot, solicitante, setor, itens: resultado });
      return json({ ok: true });
    }

    // ---------- SOLICITAÇÕES ----------

    if (path === "/api/solicitacoes" && method === "POST") {
      const b = await request.json();
      const projeto = await env.DB.prepare("SELECT * FROM projetos WHERE numero = ?").bind(b.ot).first();
      if (!projeto) {
        return json({ error: `Projeto ${b.ot} não encontrado. Peça ao responsável pelo estoque para criá-lo primeiro.` }, 404);
      }
      const upd = await env.DB.prepare(
        "UPDATE itens SET quantidade = quantidade - ? WHERE id = ? AND quantidade >= ?"
      ).bind(b.quantidade, b.itemId, b.quantidade).run();
      if (upd.meta.changes === 0) {
        return json({ error: "Quantidade indisponível" }, 400);
      }
      const item = await env.DB.prepare("SELECT * FROM itens WHERE id = ?").bind(b.itemId).first();

      await env.DB.prepare(
        "INSERT INTO solicitacoes (projeto_id, item_id, item_nome, unidade, quantidade, ot, solicitante, setor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(projeto.id, b.itemId, item.nome, item.unidade, b.quantidade, b.ot, b.solicitante, b.setor || "").run();
      await env.DB.prepare("UPDATE projetos SET status='aberto' WHERE numero=?").bind(b.ot).run();

      await enviarEmail(env, {
        item: item.nome, quantidade: b.quantidade, unidade: item.unidade,
        ot: b.ot, solicitante: b.solicitante, setor: b.setor
      });

      return json({ ok: true });
    }

    const delOtMatch = path.match(/^\/api\/solicitacoes\/ot\/([^/]+)$/);
    if (delOtMatch && method === "DELETE") {
      const ot = decodeURIComponent(delOtMatch[1]);
      const { results } = await env.DB.prepare("SELECT * FROM solicitacoes WHERE ot = ?").bind(ot).all();
      for (const sol of results) await devolverSolicitacao(env, sol);
      await env.DB.prepare("DELETE FROM solicitacoes WHERE ot = ?").bind(ot).run();
      return json({ ok: true });
    }

    const aprovOtMatch = path.match(/^\/api\/solicitacoes\/ot\/([^/]+)\/aprovar$/);
    if (aprovOtMatch && method === "PATCH") {
      const ot = decodeURIComponent(aprovOtMatch[1]);
      // Aprovar só confirma a solicitação; o vínculo com unidades físicas acontece via leitura de QR
      // (POST /api/unidades/:id/vincular), não automaticamente aqui.
      await env.DB.prepare("UPDATE solicitacoes SET status='aprovado' WHERE ot = ? AND status='pendente'").bind(ot).run();
      return json({ ok: true });
    }

    const devOtMatch = path.match(/^\/api\/solicitacoes\/ot\/([^/]+)\/devolver$/);
    if (devOtMatch && method === "PATCH") {
      const ot = decodeURIComponent(devOtMatch[1]);
      const { results } = await env.DB.prepare("SELECT * FROM solicitacoes WHERE ot = ? AND status != 'devolvido'").bind(ot).all();
      for (const sol of results) await devolverSolicitacao(env, sol);
      await env.DB.prepare("UPDATE projetos SET status='encerrado' WHERE numero=?").bind(ot).run();
      return json({ ok: true });
    }

    const delSolMatch = path.match(/^\/api\/solicitacoes\/(\d+)$/);
    if (delSolMatch && method === "DELETE") {
      const sol = await env.DB.prepare("SELECT * FROM solicitacoes WHERE id = ?").bind(delSolMatch[1]).first();
      if (sol) await devolverSolicitacao(env, sol);
      await env.DB.prepare("DELETE FROM solicitacoes WHERE id = ?").bind(delSolMatch[1]).run();
      return json({ ok: true });
    }

    const aprovMatch = path.match(/^\/api\/solicitacoes\/(\d+)\/aprovar$/);
    if (aprovMatch && method === "PATCH") {
      await env.DB.prepare("UPDATE solicitacoes SET status='aprovado' WHERE id=? AND status='pendente'").bind(aprovMatch[1]).run();
      return json({ ok: true });
    }

    const solMatch = path.match(/^\/api\/solicitacoes\/(\d+)\/devolver$/);
    if (solMatch && method === "PATCH") {
      const sol = await env.DB.prepare("SELECT * FROM solicitacoes WHERE id = ?").bind(solMatch[1]).first();
      if (sol) await devolverSolicitacao(env, sol);
      return json({ ok: true });
    }

    if (path === "/api/ot/email" && method === "POST") {
      const b = await request.json();
      if (!env.RESEND_API_KEY) return json({ error: "RESEND_API_KEY não configurado no servidor" }, 400);
      const destino = b.to || b.email;
      if (!destino) return json({ error: "Email de destino não informado" }, 400);
      if (!isValidEmail(destino)) return json({ error: "Email de destino inválido" }, 400);
      const linhas = b.linhas || (b.itens ? b.itens.map(it => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${it.nome}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${it.qty} ${it.unidade}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280">${it.local||b.local||'—'}</td></tr>`).join('') : '');
      const resendResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.EMAIL_REMETENTE || EMAIL_REMETENTE_PADRAO, to: destino.trim(),
          subject: `OT ${b.ot} · NIU Experience Agency`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <div style="background:#0c0e16;border-radius:12px;padding:20px 24px;margin-bottom:20px">
              <div style="color:#fff;font-size:18px;font-weight:800">NIU <span style="color:#5b8cff">EXPERIENCE AGENCY</span></div>
              <div style="color:#9aa3b2;font-size:12px">Folha de Requisição de Material</div>
            </div>
            <h2 style="font-size:22px;color:#0f1117;margin:0 0 4px">${b.ot}</h2>
            <p style="color:#6b7280;margin:0 0 20px;font-size:14px">${b.local||''}</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
              <tr style="background:#f3f4f6"><td style="padding:8px;font-weight:700">Solicitante</td><td style="padding:8px">${b.solic||''}</td><td style="padding:8px;font-weight:700">Setor</td><td style="padding:8px">${b.setor||'—'}</td></tr>
            </table>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr style="background:#f3f4f6"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:left">Qtd.</th><th style="padding:8px;text-align:left">Local</th></tr>
              ${linhas}
            </table>
            ${b.obs?`<div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:8px;font-size:13px;color:#374151"><b>Observações:</b> ${b.obs}</div>`:''}
            ${b.url?`<p style="margin-top:20px"><a href="${b.url}" style="background:#5b8cff;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">Ver OT online</a></p>`:''}
            <p style="margin-top:24px;font-size:12px;color:#9ca3af">Gerado automaticamente · ${new Date().toLocaleString('pt-BR')}</p>
          </div>`
        })
      });
      if (!resendResp.ok) {
        const errBody = await resendResp.text().catch(() => '');
        return json({ error: `Resend respondeu ${resendResp.status}: ${errBody}` }, 502);
      }
      return json({ ok: true });
    }

    const otGetMatch = path.match(/^\/api\/ot\/(.+)$/);
    if (otGetMatch && method === "GET") {
      const ot = decodeURIComponent(otGetMatch[1]);
      const { results } = await env.DB.prepare("SELECT * FROM solicitacoes WHERE ot=? ORDER BY id").bind(ot).all();
      return json(results);
    }

    // ---------- UNIDADES FÍSICAS ----------
    if (path === "/api/unidades" && method === "POST") {
      const b = await request.json();
      // gera N unidades para um item
      const item = await env.DB.prepare("SELECT * FROM itens WHERE id=?").bind(b.itemId).first();
      if(!item) return json({error:"Item não encontrado"},404);
      const prefix = (item.codigo || item.nome.slice(0,6).replace(/\s/g,'')).toUpperCase();

      // continua a numeração a partir do maior serial já existente para este item, em vez de
      // reiniciar em 001 (evita colisões e séries confusas como "-003-1")
      const { results: existentes } = await env.DB.prepare("SELECT serial FROM unidades WHERE item_id=?").bind(b.itemId).all();
      const prefixRe = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}-(\\d{3})(?:-\\d+)?$`);
      let maxSeq = 0;
      existentes.forEach(r => {
        const m = r.serial.match(prefixRe);
        if (m) { const n = parseInt(m[1], 10); if (n > maxSeq) maxSeq = n; }
      });

      const serials = [];
      for(let i=1; i<=b.quantidade; i++){
        const serial = `${prefix}-${String(maxSeq + i).padStart(3,'0')}`;
        // tenta inserir, incrementa se já existe
        let s = serial, attempt = 0;
        while(attempt<99){
          try{
            await env.DB.prepare("INSERT INTO unidades (item_id, serial) VALUES (?,?)").bind(b.itemId, s).run();
            serials.push(s); break;
          }catch(e){ attempt++; s = `${serial}-${attempt}`; }
        }
      }
      return json({ serials });
    }

    if (path === "/api/unidades/contagem" && method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT item_id, COUNT(*) as total, SUM(CASE WHEN status='disponivel' THEN 1 ELSE 0 END) as disponiveis " +
        "FROM unidades GROUP BY item_id"
      ).all();
      return json(results);
    }

    if (path.match(/^\/api\/unidades\/item\/\d+$/) && method === "GET") {
      const itemId = path.split('/').pop();
      const { results } = await env.DB.prepare(
        "SELECT u.*, s.ot, s.solicitante, s.local_uso FROM unidades u " +
        "LEFT JOIN solicitacao_unidades su ON su.unidade_id = u.id AND su.devolvido_em IS NULL " +
        "LEFT JOIN solicitacoes s ON s.id = su.solicitacao_id " +
        "WHERE u.item_id=? ORDER BY u.serial"
      ).bind(itemId).all();
      return json(results);
    }

    const unidadeMatch = path.match(/^\/api\/unidades\/(\d+)$/);
    if (unidadeMatch && method === "GET") {
      const u = await env.DB.prepare(
        "SELECT u.*, i.nome, i.categoria, i.voltagem, i.modelo, i.unidade, i.codigo, s.ot, s.solicitante, s.setor, s.local_uso " +
        "FROM unidades u JOIN itens i ON i.id=u.item_id " +
        "LEFT JOIN solicitacao_unidades su ON su.unidade_id = u.id AND su.devolvido_em IS NULL " +
        "LEFT JOIN solicitacoes s ON s.id = su.solicitacao_id " +
        "WHERE u.id=?"
      ).bind(unidadeMatch[1]).first();
      return u ? json(u) : json({error:"Não encontrado"},404);
    }

    if (unidadeMatch && method === "PATCH") {
      const b = await request.json();
      await env.DB.prepare("UPDATE unidades SET status=? WHERE id=?").bind(b.status, unidadeMatch[1]).run();
      return json({ok:true});
    }

    // Lista as linhas de solicitação em aberto (não devolvidas) deste item que ainda precisam
    // de mais unidades físicas vinculadas — usado pelo leitor de QR para perguntar "para qual OT
    // vai esta unidade?" quando ela é escaneada disponível.
    const itemPendentesMatch = path.match(/^\/api\/itens\/(\d+)\/pendentes$/);
    if (itemPendentesMatch && method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM (" +
        "  SELECT s.id, s.ot, s.solicitante, s.setor, s.local_uso, s.quantidade, s.status, s.data, " +
        "  (SELECT COUNT(*) FROM solicitacao_unidades su WHERE su.solicitacao_id = s.id AND su.devolvido_em IS NULL) as vinculadas " +
        "  FROM solicitacoes s WHERE s.item_id = ? AND s.status != 'devolvido'" +
        ") WHERE vinculadas < quantidade ORDER BY data DESC"
      ).bind(itemPendentesMatch[1]).all();
      return json(results);
    }

    // Vincula esta unidade física a uma linha de solicitação específica (escaneada "saindo" para o evento).
    const vincularMatch = path.match(/^\/api\/unidades\/(\d+)\/vincular$/);
    if (vincularMatch && method === "POST") {
      const unidadeId = vincularMatch[1];
      const b = await request.json();
      const unidade = await env.DB.prepare("SELECT * FROM unidades WHERE id = ?").bind(unidadeId).first();
      if (!unidade) return json({ error: "Unidade não encontrada" }, 404);
      if (unidade.status !== "disponivel") return json({ error: "Esta unidade já está em uso em outra OT" }, 400);

      const sol = await env.DB.prepare("SELECT * FROM solicitacoes WHERE id = ?").bind(b.solicitacaoId).first();
      if (!sol) return json({ error: "Solicitação não encontrada" }, 404);
      if (sol.item_id !== unidade.item_id) return json({ error: "Esta unidade não corresponde ao item desta solicitação" }, 400);

      const { results: vinc } = await env.DB.prepare(
        "SELECT id FROM solicitacao_unidades WHERE solicitacao_id = ? AND devolvido_em IS NULL"
      ).bind(sol.id).all();
      if (vinc.length >= sol.quantidade) return json({ error: "Esta linha já teve toda a quantidade vinculada" }, 400);

      try {
        await env.DB.prepare(
          "INSERT INTO solicitacao_unidades (solicitacao_id, unidade_id) VALUES (?, ?)"
        ).bind(sol.id, unidadeId).run();
      } catch (e) {
        return json({ error: "Esta unidade já está vinculada a uma OT em aberto" }, 409);
      }
      await env.DB.prepare("UPDATE unidades SET status='em_uso' WHERE id = ?").bind(unidadeId).run();

      const totalVinculadas = vinc.length + 1;
      if (totalVinculadas >= sol.quantidade) {
        await env.DB.prepare("UPDATE solicitacoes SET status='aprovado' WHERE id = ?").bind(sol.id).run();
      }
      return json({ ok: true, ot: sol.ot, vinculadas: totalVinculadas, quantidade: sol.quantidade });
    }

    // Devolve esta unidade específica ao estoque (escaneada "voltando" do evento).
    const devolverUnidadeMatch = path.match(/^\/api\/unidades\/(\d+)\/devolver-unidade$/);
    if (devolverUnidadeMatch && method === "POST") {
      const unidadeId = devolverUnidadeMatch[1];
      const link = await env.DB.prepare(
        "SELECT su.*, s.item_id, s.ot FROM solicitacao_unidades su JOIN solicitacoes s ON s.id = su.solicitacao_id " +
        "WHERE su.unidade_id = ? AND su.devolvido_em IS NULL"
      ).bind(unidadeId).first();
      if (!link) return json({ error: "Esta unidade não está vinculada a nenhuma OT em aberto" }, 400);

      await env.DB.prepare("UPDATE solicitacao_unidades SET devolvido_em = datetime('now') WHERE id = ?").bind(link.id).run();
      await env.DB.prepare("UPDATE unidades SET status='disponivel' WHERE id = ?").bind(unidadeId).run();
      await env.DB.prepare("UPDATE itens SET quantidade = quantidade + 1 WHERE id = ?").bind(link.item_id).run();

      const { results: aindaAtivos } = await env.DB.prepare(
        "SELECT id FROM solicitacao_unidades WHERE solicitacao_id = ? AND devolvido_em IS NULL"
      ).bind(link.solicitacao_id).all();
      if (aindaAtivos.length === 0) {
        await env.DB.prepare("UPDATE solicitacoes SET status='devolvido' WHERE id = ?").bind(link.solicitacao_id).run();
        const { results: abertasNaOt } = await env.DB.prepare(
          "SELECT id FROM solicitacoes WHERE ot = ? AND status != 'devolvido'"
        ).bind(link.ot).all();
        if (abertasNaOt.length === 0) {
          await env.DB.prepare("UPDATE projetos SET status='encerrado' WHERE numero = ?").bind(link.ot).run();
        }
      }
      return json({ ok: true, ot: link.ot });
    }

    // ---------- estático (frontend) ----------
    return env.ASSETS.fetch(request);
  }
};
