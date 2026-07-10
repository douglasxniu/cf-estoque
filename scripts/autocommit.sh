#!/bin/bash
# Commita e publica no GitHub as mudanças pendentes do dia, se houver alguma.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "$(git status --porcelain)" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') - sem mudanças, nada a fazer" >> scripts/autocommit.log
  exit 0
fi

git add -A
git commit -m "Atualização automática diária - $(date '+%Y-%m-%d')"
git push origin main
echo "$(date '+%Y-%m-%d %H:%M:%S') - commit e push realizados" >> scripts/autocommit.log
