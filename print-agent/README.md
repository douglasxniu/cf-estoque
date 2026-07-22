# print-agent (ferramenta local)

Gera e imprime etiquetas térmicas na Zebra GC420d (USB) conectada nesta máquina. **Não faz
parte do deploy do Worker** — não é publicado via `wrangler deploy`, roda só localmente com
`node`. Ver também a seção "Impressão térmica de etiquetas (preparação)" no `CLAUDE.md` da
raiz do repo.

## O que já funciona

- `imprimir.js` gera um PDF de **100×150mm** (10×15cm) com até 5 etiquetas de 100×30mm
  empilhadas na mesma folha física, no mesmo estilo visual das etiquetas A4 do painel
  (logo, cabeçalho da empresa, nome do item, local, observação, rodapé de patrimônio).
- Linha de picote entre as etiquetas desenhada segmento a segmento (`linhaTracejada`) — o
  filtro de rasterização da impressora não respeita `setLineDashPattern` do PDF, então o
  tracejado nativo do jsPDF não aparece impresso.
- Margem de segurança de 3mm no topo/base da folha (a primeira impressão saiu colada na
  borda, sem folga).

## Pendente: calibração de tamanho de página

A impressora (fila CUPS `Zebra_Technologies_ZTC_GC420d__EPL_`, driver "Zebra EPL1 Label
Printer") **só imprime fisicamente algo quando o job usa o `PageSize` padrão atual da
fila** (`w288h360` = 4×5in = 101,6×127mm, o valor marcado com `*` em
`lpoptions -p ... -l`). Testado e confirmado que **não funcionam**:

- `-o media=Custom.<w>x<h>pt`
- `-o PageSize=Custom.<w>x<h>` (sintaxe correta de tamanho customizado do CUPS)
- `-o PageSize=w288h432` (outro preset válido da lista, 4×6in)

Em todos esses casos o job é aceito e sai da fila (CUPS reporta sucesso), mas **nada é
impresso fisicamente** — o driver aparentemente ignora o `PageSize` por job e só usa o que
já está configurado como padrão da fila. `imprimir.js` ainda manda
`-o media=Custom.<w>x<h>pt` (não muda o padrão da fila), então **hoje ele gera o PDF
certo mas o comando de impressão real precisa ser revisto** antes de imprimir 10x15
de verdade.

Próximo passo mais provável: mudar o padrão **persistente** da fila (não por job) com
`lpadmin -p Zebra_Technologies_ZTC_GC420d__EPL_ -o PageSize=w288h432` (ainda não testado —
a última tentativa foi interrompida) e então imprimir sem `-o PageSize`/`-o media` no job,
deixando a impressora usar o novo padrão. Se isso também não colar fisicamente o conteúdo
certo, o caminho alternativo é abandonar o filtro `rastertolabel` do CUPS e falar EPL bruto
via `lp -o raw` (dá mais controle, mas perde a conveniência de reusar o PDF do jsPDF).

## Uso

```bash
cd print-agent
node imprimir.js dados.json   # dados.json = array de labels, até 5 por chamada
```

Formato de cada label (mesmo do `public/etiquetas.js`, sem `tipoQr` — não cabe nesse
tamanho menor):

```json
{ "ot": "OT-2026-0057", "nomeOt": "NEOPOP", "nome": "Transformador 24V 400W",
  "local": "Calhas Bar VIP", "obs": "Fixar com braçadeira", "unitIdx": 1, "unitTotal": 5 }
```
