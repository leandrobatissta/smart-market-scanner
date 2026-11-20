#!/usr/bin/env bash
# Prepara a máquina inteira para rodar o Smart Market Scanner localmente: confere e instala o que faltar (Docker, Compose, runtime de containers),
# sobe o daemon, constrói as imagens, roda os testes e faz a primeira varredura. Pode rodar quantas vezes quiser (é idempotente).
set -euo pipefail

cd "$(dirname "$0")"
OS="$(uname -s)"
say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mErro:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then echo "docker compose"
  elif have docker-compose; then echo "docker-compose"
  else echo ""; fi
}

install_macos() {
  have brew || die "Homebrew não encontrado. Instale em https://brew.sh e rode ./setup.sh de novo."
  have docker || { say "Instalando Docker CLI (brew)"; brew install docker; }
  if [ -z "$(compose_cmd)" ]; then say "Instalando Docker Compose (brew)"; brew install docker-compose; fi
  if ! docker info >/dev/null 2>&1; then
    if ! have colima && ! [ -d "/Applications/Docker.app" ]; then say "Instalando Colima (runtime de containers sem Docker Desktop)"; brew install colima; fi
    if have colima; then
      say "Iniciando o Colima"
      colima start --cpu 2 --memory 2 --disk 20 >/dev/null 2>&1 || colima start
    else
      say "Abrindo o Docker Desktop"
      open -a Docker || true
    fi
  fi
}

install_linux() {
  have docker && [ -n "$(compose_cmd)" ] && return 0
  if have apt-get; then
    say "Instalando Docker e Compose (apt, precisa de sudo)"
    sudo apt-get update -y
    sudo apt-get install -y docker.io docker-compose-v2 || sudo apt-get install -y docker.io docker-compose
  elif have dnf; then
    say "Instalando Docker e Compose (dnf, precisa de sudo)"
    sudo dnf install -y docker docker-compose
  elif have pacman; then
    say "Instalando Docker e Compose (pacman, precisa de sudo)"
    sudo pacman -S --noconfirm docker docker-compose
  else
    die "Gerenciador de pacotes não reconhecido. Instale Docker + Compose: https://docs.docker.com/engine/install/"
  fi
  if have systemctl; then sudo systemctl enable --now docker || true; fi
  if ! docker info >/dev/null 2>&1; then
    warn "Seu usuário não alcança o Docker. Adicionando ao grupo docker (precisa sair e entrar na sessão); usando sudo por agora."
    sudo usermod -aG docker "$USER" || true
    DOCKER_SUDO=1
  fi
}

say "Sistema: $OS ($(uname -m))"
case "$OS" in
  Darwin) install_macos ;;
  Linux)  install_linux ;;
  *)      die "No Windows use o WSL2 (Ubuntu) com Docker Desktop e rode ./setup.sh dentro do WSL. Guia: https://docs.docker.com/desktop/wsl/" ;;
esac

have docker || die "Docker continua indisponível."
if ! docker info >/dev/null 2>&1; then
  if [ "${DOCKER_SUDO:-0}" = 1 ]; then SUDO="sudo "; else
    say "Aguardando o daemon do Docker"
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done
    docker info >/dev/null 2>&1 || die "O daemon do Docker não respondeu. Abra o Docker Desktop (ou rode 'colima start') e tente de novo."
  fi
fi
SUDO="${SUDO:-}"
COMPOSE="$(compose_cmd)"
[ -n "$COMPOSE" ] || die "Docker Compose indisponível."
ok "Docker: $(docker --version)"
ok "Compose: $($COMPOSE version | head -1)"

chmod 666 scanner/user_terms.txt 2>/dev/null || true; mkdir -p docs/data; chmod 777 docs/data 2>/dev/null || true   # a API grava aqui os itens novos pedidos pelo site

say "Construindo as imagens"
${SUDO}$COMPOSE build

say "Rodando os testes"
${SUDO}$COMPOSE --profile test run --rm test
${SUDO}$COMPOSE --profile test run --rm test-js

say "Primeira coleta de preços, versão rápida (precisa de internet; a completa é 'make scan')"
mkdir -p docs/data
if ${SUDO}$COMPOSE run --rm scanner python scan.py --out /out/prices.json --limit-terms 15; then
  ok "docs/data/prices.json gerado"
else
  warn "A coleta falhou (internet ou sites dos mercados indisponíveis). O site abre, mas sem preços até a próxima tentativa."
fi

say "Subindo o site"
${SUDO}$COMPOSE up -d
printf '\n\033[1;32mPronto!\033[0m  Site: http://localhost:8080   |   Parar: make down   |   Logs: make logs\n'
