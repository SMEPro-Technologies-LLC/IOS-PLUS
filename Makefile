# ==============================================================
# IOS+ Makefile  -  SMEPro Technologies
# Requires: GNU Make  (winget install GnuWin32.Make)
# Usage:    make <target>   |   make rebuild svc=middleware-engine
# ==============================================================

.DEFAULT_GOAL := help
.PHONY: up down reset build rebuild migrate logs logs-me logs-flyway ps shell-db vault-init vault-check roles-check help

VAULT_ADDR_LOCAL := http://127.0.0.1:8200
VAULT_TOKEN_LOCAL := iosplus-dev-root-token
VAULT_KEY := transit/keys/ios-evidence-signing

up:
	docker compose up -d

down:
	docker compose down

reset:
	docker compose down -v

build:
	docker compose build

rebuild:
ifndef svc
	$(error Usage: make rebuild svc=<service-name>)
endif
	docker compose build --no-cache $(svc)
	docker compose up -d --force-recreate $(svc)

migrate:
	docker compose run --rm flyway

shell-db:
	docker exec -it cos-plus psql -U cos_admin ios_plus

roles-check:
	docker exec cos-plus psql -U cos_admin ios_plus -c "\du"

vault-init:
	-docker exec vault-dev sh -c "VAULT_ADDR=$(VAULT_ADDR_LOCAL) VAULT_TOKEN=$(VAULT_TOKEN_LOCAL) vault secrets enable transit"
	docker exec vault-dev sh -c "VAULT_ADDR=$(VAULT_ADDR_LOCAL) VAULT_TOKEN=$(VAULT_TOKEN_LOCAL) vault write -f $(VAULT_KEY) type=ed25519"

vault-check:
	docker exec vault-dev sh -c "VAULT_ADDR=$(VAULT_ADDR_LOCAL) VAULT_TOKEN=$(VAULT_TOKEN_LOCAL) vault read $(VAULT_KEY)"

logs:
	docker compose logs -f

logs-me:
	docker compose logs middleware-engine -f

logs-flyway:
	docker compose logs flyway

ps:
	docker compose ps

help:
	@cmd /c echo.
	@cmd /c echo IOS+ Local Dev -- Available Targets
	@cmd /c echo ------------------------------------------------
	@cmd /c echo   make up           Start the full IOS+ stack
	@cmd /c echo   make down         Stop services, keep volumes
	@cmd /c echo   make reset        DESTRUCTIVE: remove containers + volumes
	@cmd /c echo   make build        Build all Docker images
	@cmd /c echo   make rebuild      Rebuild one service  [svc=middleware-engine]
	@cmd /c echo   make migrate      Run Flyway migrations manually
	@cmd /c echo   make shell-db     Open psql shell as cos_admin
	@cmd /c echo   make roles-check  Print all PostgreSQL roles
	@cmd /c echo   make vault-init   Enable transit + create Ed25519 key
	@cmd /c echo   make vault-check  Read Vault signing key metadata
	@cmd /c echo   make logs         Tail all service logs
	@cmd /c echo   make logs-me      Tail middleware-engine logs only
	@cmd /c echo   make logs-flyway  Show Flyway output
	@cmd /c echo   make ps           Show container status
	@cmd /c echo ------------------------------------------------
	@cmd /c echo   REST API  --  http://localhost:3001
	@cmd /c echo   Vault UI  --  http://localhost:8200
	@cmd /c echo   Postgres  --  localhost:5432  db=ios_plus
	@cmd /c echo.
