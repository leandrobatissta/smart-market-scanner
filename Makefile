COMPOSE := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo docker-compose)

.PHONY: setup up down logs scan scan-fast test open

setup:      ## prepara a máquina inteira (Docker, imagens, testes e primeira coleta)
	./setup.sh

up:         ## sobe coletor + site em http://localhost:8080
	$(COMPOSE) up -d --build
	@echo "Site: http://localhost:8080  (a primeira coleta completa leva alguns minutos; 'make scan-fast' faz uma rápida)"

down:       ## para tudo
	$(COMPOSE) down

logs:       ## acompanha o coletor
	$(COMPOSE) logs -f scanner

scan:       ## coleta completa uma vez (alguns minutos), gravando docs/data/prices.json
	$(COMPOSE) run --rm scanner python scan.py --out /out/prices.json

scan-fast:  ## coleta rápida (só 15 termos), para testar
	$(COMPOSE) run --rm scanner python scan.py --out /out/prices.json --limit-terms 15

test:       ## roda os testes (Python do coletor e JavaScript da lista/comparação)
	$(COMPOSE) --profile test run --rm test
	$(COMPOSE) --profile test run --rm test-js

open:       ## abre o site no navegador (macOS)
	open http://localhost:8080
