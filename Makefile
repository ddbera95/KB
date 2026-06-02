.PHONY: setup start build clean help

## First-time setup — installs all dependencies
setup:
	@chmod +x setup.sh start.sh
	@./setup.sh

## Start dev servers (backend + frontend)
start:
	@chmod +x start.sh
	@./start.sh

## Build release binary + frontend bundle
build:
	cargo build --release
	cd frontend-react && npm run build

## Remove build artifacts (keeps node_modules and data)
clean:
	cargo clean
	rm -rf frontend-react/build frontend-react/dist

## Show available commands
help:
	@grep -E '^##' Makefile | sed 's/## /  /'
