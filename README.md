# Deploy 100% Cloudflare (Workers + D1) — grátis

## 0) Preparar
Extraia esta pasta `cf-estoque` e abra o terminal dentro dela.

```
npm install -g wrangler
wrangler login
```
(abre o navegador — faça login na sua conta Cloudflare)

## 1) Criar o banco D1
```
wrangler d1 create estoque-db
```
Copie o `database_id` retornado e cole em `wrangler.toml` (campo `database_id`).

## 2) Criar as tabelas
```
wrangler d1 execute estoque-db --remote --file=./schema.sql
```

## 3) Configurar e-mail (Resend — grátis, 100 e-mails/dia)
1. Crie conta em resend.com → API Keys → criar chave.
2. No terminal:
```
wrangler secret put RESEND_API_KEY
```
Cole a chave quando solicitado.

> Nota: o domínio `onboarding@resend.dev` (já configurado no worker.js) funciona para testes sem precisar verificar domínio. Para produção, verifique seu próprio domínio no Resend e troque `EMAIL_REMETENTE` em `src/worker.js`.

## 3.1) Proteger o painel (obrigatório)
O painel (`index.html`, `nova-ot.html`, `scan.html`) e todas as rotas de escrita da API exigem uma senha de administrador. Defina-a como secret:
```
wrangler secret put ADMIN_TOKEN
```
Cole uma senha forte quando solicitado. Sem esse secret configurado, o painel fica **sem proteção** (modo dev). A página pública `solicitar.html` continua acessível sem senha.

Ao abrir o painel pela primeira vez em um navegador, ele vai pedir essa senha e guardá-la localmente (localStorage).

## 3.2) Projetos (se o banco já existia antes desta versão)
As OTs passaram a ser "projetos" formais (tabela própria, número reservado e único, permitindo adicionar itens a um projeto já existente ao longo do tempo). Se você já tinha um banco em produção, rode a migration de backfill uma única vez:
```
wrangler d1 execute estoque-db --remote --file=./migration_projetos.sql
```
Isso cria a tabela `projetos` e gera automaticamente um projeto para cada OT que já existia no histórico. Em bancos novos, o `schema.sql` já inclui essa tabela — não é necessário rodar essa migration.

## 3.3) Rastreio por leitura de QR (se o banco já existia antes desta versão)
Cada leitura de QR de uma unidade física agora vincula/devolve exatamente aquela peça a uma OT (em vez de vincular "qualquer unidade disponível" automaticamente). Se o banco já existia, rode:
```
wrangler d1 execute estoque-db --remote --file=./migration_solicitacao_unidades.sql
```
Em bancos novos, o `schema.sql` já inclui essa tabela.

## 4) Deploy
```
wrangler deploy
```
Você receberá um link tipo `https://estoque-eletrica.SEU-SUBDOMINIO.workers.dev` — já está no ar, com banco e e-mail funcionando.

## Atualizações futuras
Após editar `public/index.html` ou `src/worker.js`, rode só:
```
wrangler deploy
```

## Estrutura
- `public/index.html` → frontend (dashboard)
- `src/worker.js` → backend/API (itens, solicitações, e-mail)
- `schema.sql` → estrutura do banco D1
- `wrangler.toml` → configuração do projeto
