NODE ?= node
NPM ?= npm
ACTIONLINT_VERSION ?= v1.7.12
ACTIONLINT ?= $(shell if command -v actionlint >/dev/null 2>&1; then command -v actionlint; elif command -v go >/dev/null 2>&1; then gobin="$$(go env GOBIN)"; if [ -n "$$gobin" ]; then printf "%s/actionlint" "$$gobin"; else printf "%s/bin/actionlint" "$$(go env GOPATH)"; fi; else printf "actionlint"; fi)
RUNTIME_SCRIPTS := surf-config.js forecast-api.js score-model.js forecast-selectors.js rain-radar.js app.js

.PHONY: check ensure-actionlint lint lint-workflows test

check: lint test

lint:
	@set -e; for f in $(RUNTIME_SCRIPTS); do \
		$(NODE) --check "$$f"; \
	done

ensure-actionlint:
	@if ! command -v "$(ACTIONLINT)" >/dev/null 2>&1 && [ ! -x "$(ACTIONLINT)" ]; then \
		if command -v go >/dev/null 2>&1; then \
			echo "Installing actionlint $(ACTIONLINT_VERSION)"; \
			go install github.com/rhysd/actionlint/cmd/actionlint@$(ACTIONLINT_VERSION); \
		else \
			echo "actionlint is required for make lint-workflows; install actionlint or Go, or set ACTIONLINT=/path/to/actionlint"; \
			exit 127; \
		fi; \
	fi

lint-workflows: ensure-actionlint
	find .github/workflows -type f \( -name '*.yml' -o -name '*.yaml' \) -print0 | xargs -0 "$(ACTIONLINT)"

test:
	$(NPM) test
