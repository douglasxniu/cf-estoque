#!/bin/bash
# Commita e publica no GitHub as mudanças pendentes do dia.
# Se não houver nenhuma mudança real, registra um heartbeat (scripts/heartbeat.log)
# só pra garantir que sempre exista um commit publicado no dia (mantém o
# contribution graph do GitHub ativo). Commits vazios (--allow-empty) NÃO contam
# pro gráfico, por isso o heartbeat precisa alterar um arquivo de verdade.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "$(git status --porcelain)" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S')" >> scripts/heartbeat.log
fi

if [ -z "$(git status --porcelain)" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') - sem mudanças mesmo após heartbeat, nada a fazer" >> scripts/autocommit.log
  exit 0
fi

git add -A
git commit -m "Atualização automática diária - $(date '+%Y-%m-%d')"
git push origin main
echo "$(date '+%Y-%m-%d %H:%M:%S') - commit e push realizados" >> scripts/autocommit.log
