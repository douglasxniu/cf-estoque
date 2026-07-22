# NIU Estoque (cf-estoque)

Sistema de controle de estoque de equipamentos elétricos da **NIU Experience Agency**,
rodando 100% em Cloudflare Workers + D1 (SQLite), sem build step — HTML/CSS/JS puro em
`public/`, servido como Workers Assets.

- **Site em produção:** https://estoque.niupt.workers.dev (Worker renomeado duas vezes em
  2026-07-22: "niu-estoque" → "niu" → "estoque"; o subdomínio da conta também mudou de
  `douglas-silva-c55` para `niupt`. Cada rename cria um Worker novo — mesmo banco D1
  sempre, mas secrets `AUTH_SECRET`/`RESEND_API_KEY` precisam ser recriados a cada vez;
  Workers antigos foram apagados.)
- **Repositório:** https://github.com/douglasxniu/cf-estoque (público)
- **Dono:** Douglas Silva (douglas.silva@niu.pt / GitHub: douglasxniu)

## Como rodar comandos wrangler

Sempre a partir da **raiz do repositório** (nunca de dentro de `public/` — um wrangler
rodado de dentro de `public/` cria um `.wrangler/cache` ali dentro, que vira asset público
por engano e vaza no site publicado; já aconteceu uma vez, foi corrigido).

```
cd cf-estoque
wrangler deploy
```

Se `wrangler` não for encontrado no PATH (comum em terminais não-interativos), procure o
binário com `which wrangler` ou instale com `npm install -g wrangler` / `npm install`
dentro do projeto.

## Secrets necessários no Worker

Configurados com `wrangler secret put NOME_DO_SECRET` (não aparecem em `wrangler secret
list` com o valor, só o nome — se precisar trocar, é preciso gerar um novo valor, não dá
pra recuperar o antigo).

| Secret | Para quê | Status |
|---|---|---|
| `AUTH_SECRET` | Assina os tokens de login (sistema de usuários) | ✅ configurado |
| `RESEND_API_KEY` | Envio de e-mails (notificações, backup, "enviar OT por email") | ✅ configurado |
| `ADMIN_TOKEN` | Token legado de admin único (bootstrap do 1º usuário + fallback `X-Admin-Token`) | ❌ **não configurado atualmente** — não é bloqueante porque já existe usuário admin cadastrado, mas o fluxo de "configuração inicial" (bootstrap) e o header legado `X-Admin-Token` não funcionam sem ele |

Ao migrar de conta/worker (ex: renomear o Worker), **secrets não são copiados** — precisam
ser recriados manualmente.

## Autenticação

- Sistema de usuários próprio (tabela `usuarios`: nome, email, senha com hash PBKDF2,
  papel `admin`/`operador`, ativo). Login por email/senha em `/api/auth/login`, token
  assinado (HMAC, válido 30 dias) guardado no `localStorage` (`niu_sessao`).
- Papel **admin**: acesso total. Papel **operador**: dia a dia (aprovar/devolver, criar OT,
  cadastrar item, ajustar quantidade) mas não pode excluir item/OT, mesclar OT, editar
  cadastro completo de item, nem gerenciar usuários.
- `public/auth-gate.js` intercepta todo `fetch` para `/api/*` e injeta
  `Authorization: Bearer <token>`; mostra tela de login (ou "configuração inicial" se não
  houver nenhum usuário ainda) quando necessário.
- Criar um novo admin sem precisar do `ADMIN_TOKEN` (útil se o bootstrap não for uma
  opção): gerar hash PBKDF2 localmente com Node e inserir direto via
  `wrangler d1 execute estoque-db --remote --command "INSERT INTO usuarios ..."` — foi
  feito uma vez nesta conversa, ver histórico do git/conversa se precisar repetir.

## Banco de dados (D1: `estoque-db`)

Schema completo em `schema.sql`. Alterações de schema em produção são aplicadas por
arquivos `migration_*.sql` (rodados uma vez cada, manualmente, via
`wrangler d1 execute estoque-db --remote --file=./migration_x.sql`) — não há runner de
migrations, então `schema.sql` deve ser mantido em sincronia manual com o que já rodou.

Tabelas: `itens`, `projetos` (OTs formais, número único reservável), `solicitacoes`
(linhas de pedido, snapshot do nome do item), `unidades` (peças físicas serializadas com
QR individual), `solicitacao_unidades` (vínculo unidade ↔ solicitação, um vínculo ativo
por vez), `usuarios`.

Backup automático diário (03h UTC, cron trigger) manda um dump JSON por e-mail — ver
`scheduled()` em `src/worker.js`. Tem um botão "📦 Backup" no painel (admin) pra disparar
manualmente.

## Estrutura do frontend (`public/`)

Sem framework, sem bundler — cada `.html` é uma página completa com seu próprio
`<script>` inline. Módulos compartilhados carregados via `<script src="/x.js">`:

- `theme.css` / `theme.js` — design system (tema claro/escuro via `data-theme`, tokens de
  cor em custom properties, fonte Inter).
- `auth-gate.js` — login + injeção do token em `/api/*`.
- `dialogs.js` — `niuAlert()` / `niuConfirm()` / `niuPrompt()`, substituem
  `alert()`/`confirm()`/`prompt()` nativos por modais no padrão visual do site.
- `pdf-folha.js` — gera a Folha de Requisição (PDF, 2 vias).
- `etiquetas.js` — gera etiquetas/QR em lote (grid de páginas).
- `neural-bg.js` — fundo animado reativo ao mouse do dashboard.

Páginas: `index.html` (painel admin), `solicitar.html` (catálogo público pra pedidos),
`nova-ot.html` (criar OT), `scan.html` (leitor QR, check-in/check-out de unidades),
`unidade.html` (info pública de uma unidade física), `ot.html` (redireciona pro PDF da OT).

## Backend (`src/worker.js`, ~900 linhas)

Um arquivo só, rotas despachadas via `if (path === ... && method === ...)` dentro de
`fetch()`. Rotas públicas (sem login) listadas em `PUBLIC_ROUTES`/`PUBLIC_ROUTE_PATTERNS`
no topo do arquivo — qualquer rota nova sob `/api/` exige login por padrão, a menos que
seja explicitamente adicionada a uma dessas listas. Rotas só-admin em
`ADMIN_ONLY_PATTERNS`.

## Lições aprendidas (não repetir)

- **Nunca rodar `wrangler` de dentro de `public/`** — cria `.wrangler/cache` ali, que vira
  asset público. Sempre a partir da raiz.
- **Elementos de overlay/modal criados dinamicamente**: nunca usar
  `document.getElementById()` pra pegar um elemento logo após criá-lo via `innerHTML` — se
  o `<body>` ainda não existir (script no `<head>`), o elemento pode não estar anexado ao
  documento ainda, e o listener falha silenciosamente. Usar `wrap.querySelector(...)` a
  partir da referência do próprio elemento criado, não `document.getElementById`.
- **Animações CSS de entrada (`animation:` numa classe) em elementos recriados via
  `innerHTML` com frequência** (polling, digitação em busca) fazem a animação disparar de
  novo a cada recriação — parece "flicker"/tremulação. Se o elemento é recriado com
  frequência, usar `animation:none` nele especificamente.
- **PDF (jsPDF)**: qualquer ajuste de altura/posição precisa levar em conta TODOS os
  elementos que compartilham aquela faixa vertical (ex: bloco de texto e QR code lado a
  lado, alturas diferentes) — usar `Math.max()` pra garantir que o próximo bloco só comece
  depois que todos os elementos anteriores tiverem terminado.
