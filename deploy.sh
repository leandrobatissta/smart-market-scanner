#!/usr/bin/env bash
# Sobe (e gerencia) todo o ambiente do Smart Market Scanner. Se faltar Docker/Compose, chama o setup.sh, que instala tudo.
#
#   ./deploy.sh              sobe o ambiente local (build, testes, coletor, API e site) e espera ficar saudável
#   ./deploy.sh up --fresh   igual, reconstruindo as imagens do zero
#   ./deploy.sh up --skip-tests
#   ./deploy.sh status       mostra containers, saúde e a idade dos preços
#   ./deploy.sh scan         dispara uma coleta completa em segundo plano (não trava o terminal)
#   ./deploy.sh logs [serviço]
#   ./deploy.sh restart | down
#   ./deploy.sh pages        publica no GitHub Pages (push, ativa o Pages com "GitHub Actions" e dispara a rotina)
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mErro:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

URL="http://localhost:8080"
CMD="${1:-up}"; [ $# -gt 0 ] && shift || true
FRESH=0; SKIP_TESTS=0
for a in "$@"; do case "$a" in --fresh) FRESH=1 ;; --skip-tests) SKIP_TESTS=1 ;; esac; done

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then echo "docker compose"
  elif have docker-compose; then echo "docker-compose"
  else echo ""; fi
}

ensure_docker() {
  if ! have docker || [ -z "$(compose_cmd)" ] || ! docker info >/dev/null 2>&1; then
    warn "Docker/Compose indisponível ou parado: chamando o setup.sh, que instala e sobe tudo."
    exec ./setup.sh
  fi
  COMPOSE="$(compose_cmd)"
  chmod 666 scanner/user_terms.txt 2>/dev/null || true; mkdir -p docs/data; chmod 777 docs/data 2>/dev/null || true
}

wait_http() { # url, rótulo, tentativas
  local url="$1" label="$2" tries="${3:-40}"
  for _ in $(seq 1 "$tries"); do
    if curl -fsS -m 3 -o /dev/null "$url" 2>/dev/null; then ok "$label respondendo"; return 0; fi
    sleep 2
  done
  warn "$label não respondeu a tempo ($url)"; return 1
}

prices_age() {
  if [ -f docs/data/prices.json ]; then
    local m now; m=$(stat -f %m docs/data/prices.json 2>/dev/null || stat -c %Y docs/data/prices.json)
    now=$(date +%s); echo "$(( (now - m) / 60 )) min"
  else echo "ainda não existe (a primeira coleta está rodando em segundo plano)"; fi
}

cmd_up() {
  ensure_docker
  say "Construindo as imagens$([ "$FRESH" = 1 ] && echo ' (do zero)')"
  if [ "$FRESH" = 1 ]; then $COMPOSE build --no-cache; else $COMPOSE build; fi
  if [ "$SKIP_TESTS" = 0 ]; then
    say "Rodando os testes"
    $COMPOSE --profile test run --rm test
    $COMPOSE --profile test run --rm test-js
  fi
  say "Subindo coletor, API e site"
  mkdir -p docs/data
  $COMPOSE up -d
  say "Conferindo a saúde"
  wait_http "$URL/" "Site"
  wait_http "$URL/api/health" "API de busca" 20 || true
  ok "Preços: $(prices_age)"
  printf '\n\033[1;32mNo ar!\033[0m  %s   |   status: ./deploy.sh status   |   coleta completa: ./deploy.sh scan\n' "$URL"
}

cmd_status() {
  ensure_docker
  $COMPOSE ps
  echo
  curl -fsS -m 3 -o /dev/null "$URL/" && ok "Site respondendo ($URL)" || warn "Site fora do ar"
  curl -fsS -m 3 "$URL/api/health" >/dev/null 2>&1 && ok "API de busca respondendo" || warn "API de busca fora do ar"
  ok "Idade dos preços: $(prices_age)"
}

cmd_scan() {
  ensure_docker
  say "Coleta completa em segundo plano (os mercados são consultados em paralelo)"
  $COMPOSE run -d --rm --name sms-scan-manual scanner python scan.py --out /out/prices.json >/dev/null
  ok "Rodando. Acompanhe: docker logs -f sms-scan-manual   (recarregue o site quando terminar)"
}

cmd_pages() {
  have git || die "git não encontrado"
  have gh  || die "GitHub CLI (gh) não encontrado: brew install gh"
  local remote owner repo login
  remote="$(git remote get-url origin 2>/dev/null)" || die "sem remote 'origin'. Rode: git remote add origin git@github.com:leandrobatissta/smart-market-scanner.git"
  repo="$(printf '%s' "$remote" | sed -E 's#^(git@[^:]+:|https://github.com/)##; s#\.git$##')"
  owner="${repo%%/*}"
  say "Conferindo antes de publicar ($repo)"
  [ -z "$(git status --porcelain)" ] || die "há alterações sem commit; faça o commit antes de publicar"
  [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "publique a partir da branch main"
  ensure_docker
  $COMPOSE --profile test run --rm test
  $COMPOSE --profile test run --rm test-js
  say "Enviando para o GitHub"
  git push -u origin main
  login="$(gh api user --jq .login 2>/dev/null || true)"
  if [ "$login" != "$owner" ]; then
    warn "o gh está logado como '${login:-ninguém}', mas o repositório é de '$owner'."
    printf '    Termine à mão: GitHub > %s > Settings > Pages > Source: GitHub Actions; depois Actions > "Publicar no GitHub Pages" > Run workflow.\n' "$repo"
    printf '    (ou rode: gh auth login   com a conta %s, e depois ./deploy.sh pages)\n' "$owner"
    exit 0
  fi
  say "Ativando o GitHub Pages (Source: GitHub Actions)"
  gh api -X POST "repos/$repo/pages" -f build_type=workflow >/dev/null 2>&1 \
    || gh api -X PUT "repos/$repo/pages" -f build_type=workflow >/dev/null 2>&1 \
    || warn "não consegui configurar o Pages pela API; ative em Settings > Pages > Source: GitHub Actions"
  gh workflow run pages.yml --repo "$repo" >/dev/null 2>&1 && ok "Rotina disparada (testes, coleta de preços e publicação)" || warn "dispare à mão em Actions > Publicar no GitHub Pages"
  printf '\n\033[1;32mPublicando.\033[0m  Em alguns minutos: https://%s.github.io/%s/\n' "$owner" "${repo#*/}"
}

case "$CMD" in
  up)      cmd_up ;;
  status)  cmd_status ;;
  scan)    cmd_scan ;;
  logs)    ensure_docker; $COMPOSE logs -f --tail=100 "$@" ;;
  restart) ensure_docker; $COMPOSE restart; wait_http "$URL/" "Site" ;;
  down)    ensure_docker; $COMPOSE down ;;
  pages)   cmd_pages ;;
  -h|--help|help) sed -n '2,13p' "$0" ;;
  *) die "comando desconhecido: $CMD (use: up, status, scan, logs, restart, down, pages)" ;;
esac
