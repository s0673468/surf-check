NODE ?= node
NPM ?= npm
RUNTIME_SCRIPTS := forecast-api.js score-model.js forecast-selectors.js rain-radar.js app.js

.PHONY: check lint test

check: lint test

lint:
	@set -e; for f in $(RUNTIME_SCRIPTS); do \
		$(NODE) --check "$$f"; \
	done

test:
	$(NPM) test
