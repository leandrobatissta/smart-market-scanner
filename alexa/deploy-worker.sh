#!/usr/bin/env bash
# Coloca o Worker da lista no ar (Cloudflare, plano gratuito) e deixa o site apontando para ele.
#   ./alexa/deploy-worker.sh            faz tudo (pede o login da Cloudflare no navegador na primeira vez)
#   ./alexa/deploy-worker.sh --dry-run  só mostra o que faria, sem mexer em nada
# No fim imprime os DOIS valores que você cola nas variáveis da skill: LISTA_URL e SKILL_SECRET.
set -euo pipefail
cd "$(dirname "$0")/worker"

DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mErro:\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then printf '    [simulação] %s\n' "$*"; else "$@"; fi; }

command -v node >/dev/null || die "Node.js não encontrado (instale: brew install node)."
command -v npx  >/dev/null || die "npx não encontrado (vem com o Node.js)."
command -v openssl >/dev/null || die "openssl não encontrado."

say "1/5 Login na Cloudflare (abre o navegador na primeira vez)"
run npx --yes wrangler login

say "2/5 Armazenamento da lista (KV)"
if grep -q 'TROQUE_PELO_ID_DO_KV' wrangler.toml; then
  if [ "$DRY" = 1 ]; then printf '    [simulação] npx wrangler kv namespace create LISTAS  (e grava o id em wrangler.toml)\n'
  else
    SAIDA="$(npx --yes wrangler kv namespace create LISTAS 2>&1)"
    ID="$(printf '%s' "$SAIDA" | grep -Eo '[0-9a-f]{32}' | head -1)"
    [ -n "$ID" ] || die "não consegui ler o id do KV. Saída do wrangler:\n$SAIDA"
    sed -i.bak "s/TROQUE_PELO_ID_DO_KV/$ID/" wrangler.toml && rm -f wrangler.toml.bak
    ok "KV criado ($ID)"
  fi
else ok "KV já configurado em wrangler.toml"; fi

say "3/5 Segredo da skill"
SEGREDO_ARQ="$(pwd)/.segredo-da-skill"      # fica só neste computador (o .gitignore ignora)
if [ -f "$SEGREDO_ARQ" ]; then SEGREDO="$(cat "$SEGREDO_ARQ")"; ok "reaproveitando o segredo já gerado"
else SEGREDO="$(openssl rand -hex 24)"; [ "$DRY" = 1 ] || { umask 077; printf '%s' "$SEGREDO" > "$SEGREDO_ARQ"; }; ok "segredo gerado"; fi
if [ "$DRY" = 1 ]; then printf '    [simulação] grava o segredo no Worker (wrangler secret put SKILL_SECRET)\n'
else printf '%s' "$SEGREDO" | npx --yes wrangler secret put SKILL_SECRET >/dev/null 2>&1 || die "não consegui gravar o segredo no Worker."; ok "segredo gravado no Worker"; fi

say "4/5 Publicando o Worker"
if [ "$DRY" = 1 ]; then printf '    [simulação] npx wrangler deploy\n'; URL="https://smart-market-lista.SUACONTA.workers.dev"
else
  SAIDA="$(npx --yes wrangler deploy 2>&1)" || die "o deploy falhou:\n$SAIDA"
  URL="$(printf '%s' "$SAIDA" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -1)"
  [ -n "$URL" ] || die "não achei o endereço do Worker na saída:\n$SAIDA"
  ok "no ar: $URL"
fi

say "5/5 Apontando o site para o Worker"
CONFIG="../../docs/data/config.json"
if [ "$DRY" = 1 ]; then printf '    [simulação] grava %s em %s\n' "$URL" "$CONFIG"; else printf '{ "syncUrl": "%s" }\n' "$URL" > "$CONFIG"; ok "docs/data/config.json atualizado (faça commit e push para o site publicado enxergar)"; fi

printf '\n\033[1;32mPronto.\033[0m Cole estes dois valores nas variáveis de ambiente da skill (Alexa Developer Console > Code > Environment Variables):\n\n'
printf '  LISTA_URL    = %s\n' "$URL"
if [ "$DRY" = 1 ]; then printf '  SKILL_SECRET = (será gerado; fica em alexa/worker/.segredo-da-skill)\n'; else printf '  SKILL_SECRET = %s\n' "$SEGREDO"; fi
printf '\n  O segredo também fica guardado em alexa/worker/.segredo-da-skill (não vai ao GitHub).\n'
