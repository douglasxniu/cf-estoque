# print-agent (ferramenta local)

Painel web local pra montar, revisar e imprimir etiquetas térmicas na Zebra GC420d (USB)
conectada nesta máquina. **Não faz parte do deploy do Worker** — não é publicado via
`wrangler deploy`, roda só localmente com `node`. Ver também a seção "Impressão térmica de
etiquetas (preparação)" no `CLAUDE.md` da raiz do repo.

## Setup

```bash
cd print-agent
npm install
cp .env.example .env   # se existir; senão crie .env com:
# ANTHROPIC_API_KEY=sk-ant-...   (só necessário pra "Importar print screen (IA)")
node server.js          # porta padrão 4000
```

`.env` não vai pro git (`.gitignore`). Sem `ANTHROPIC_API_KEY`, tudo funciona exceto a
importação de imagem via IA.

## O que faz

- **Painel web** (`server.js`, `http://localhost:4000`, também acessível na rede local) —
  monta uma fila de etiquetas (nome, local/variante, observação, quantidade) com um
  cabeçalho único de OT/projeto pra todo o lote, e manda pra Zebra.
- **Tamanhos configuráveis** (`imprimir.js` → `TAMANHOS`): 10x15cm, 7,6x5,1cm, 5,7x1,9cm,
  3,2x2,5cm. O conteúdo desenhado se adapta ao espaço (etiquetas pequenas não têm
  cabeçalho/rodapé, só o essencial). Cada item da fila vira **uma página do PDF** (não mais
  várias etiquetas empilhadas numa folha).
- **Importar PDF** (`importar-pdf.js`) — lê de volta um PDF já gerado por este sistema
  (texto real, não OCR) e preenche a fila.
- **Importar print screen via IA** (`importar-imagem.js`) — manda uma imagem qualquer (ex:
  print de um sistema de OT de produção externo, sem estrutura fixa) pra API de visão da
  Anthropic, que devolve itens já separados por variante com quantidade.
- **Popup de revisão obrigatório** — tanto a importação de PDF quanto a de imagem abrem um
  popup com os itens extraídos, totalmente editáveis (e removíveis) antes de confirmar.
  Nada entra na fila sem essa confirmação — a leitura automática (principalmente a de IA)
  pode errar.
- **Mesclar selecionadas** — soma quantidades de linhas marcadas na fila numa só, pra
  corrigir duplicatas que a extração separou por engano.
- **QR de resumo da OT** — como primeira etiqueta do lote (só nos tamanhos 10x15cm e
  7,6x5,1cm) ou avulso em qualquer tamanho (útil nos formatos pequenos, só o QR).

## Trocando o tamanho físico da etiqueta na impressora

A impressora (fila CUPS `Zebra_Technologies_ZTC_GC420d__EPL_`, driver "Zebra EPL2 Label
Printer") **só imprime fisicamente algo quando o job usa o `PageSize` padrão ATUAL da
fila** — confirmado que ela ignora overrides de tamanho por job (`-o media=Custom...`,
`-o PageSize=Custom...`, ou até outro preset válido da lista). `imprimir()` não manda
`-o media`/`-o PageSize` no job por causa disso — usa sempre o que já está configurado como
padrão da fila.

Ou seja: **trocar o "Tamanho da etiqueta" no painel não muda sozinho o que a impressora
imprime fisicamente** — só muda como o conteúdo é desenhado dentro do espaço que a
impressora já assume. Trocar de verdade pra um rolo de tamanho diferente precisa de **dois
passos**, os dois obrigatórios:

1. **Trocar o `PageSize` padrão da fila**, apontando pro preset mais próximo do rolo
   físico novo (ver `lpoptions -p Zebra_Technologies_ZTC_GC420d__EPL_ -l` pra lista de
   presets aceitos — nem todo tamanho da lista `TAMANHOS` do `imprimir.js` tem um preset
   exato, ex: 57x19 e 32x25 não têm). Isso dá pra fazer sem sudo, a nível de usuário:
   ```bash
   lpoptions -p Zebra_Technologies_ZTC_GC420d__EPL_ -o PageSize=<preset>
   ```
   Presets já calibrados: `w288h360` = 10x15cm (100x150mm), `w216h144` = 7,6x5,1cm (76x51mm).

2. **Recalibrar o sensor de gap na própria impressora** — sem isso, ela continua "lendo" o
   comprimento do rolo antigo e sai imprimindo etiquetas em branco/cortadas até se perder
   (foi exatamente o que aconteceu ao trocar pro rolo de 76x51mm sem recalibrar: saíram 7
   etiquetas, várias em branco, de um job que devia gerar só 1). Com a impressora ligada:
   segurar o botão **FEED** até a luz de status **piscar duas vezes**, soltar logo em
   seguida — ela puxa e mede algumas etiquetas sozinha pra aprender o novo tamanho/gap.

Os dois passos são independentes: mudar só o `PageSize` sem recalibrar (ou vice-versa) não
resolve. Sempre testar com **uma etiqueta só** depois de trocar de rolo, antes de mandar um
lote inteiro.

Também já observamos que um PDF com imagem embutida grande (o logo) pode corromper o
stream EPL e causar impressão em loop/lixo — por precaução, `imprimir()` só embute o logo
se `opts.comLogo` for passado explicitamente (fica desligado por padrão).

## Uso via CLI (sem o painel web)

```bash
node imprimir.js dados.json   # dados.json = array de labels
```

Formato de cada label:

```json
{ "ot": "OT-2026-0057", "nomeOt": "NEOPOP", "nome": "Transformador 24V 400W",
  "local": "Calhas Bar VIP", "obs": "Fixar com braçadeira", "unitIdx": 1, "unitTotal": 5 }
```
