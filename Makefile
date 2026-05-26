.PHONY: setup validate generate generate-check test security ci clean search install-hooks help

help:  ## Show this help message
	@echo "agentic-coding-patterns — Available targets:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Examples:"
	@echo "  make setup         # First-time setup"
	@echo "  make install-hooks # Install pre-commit hooks (opt-in)"
	@echo "  make validate      # Before committing"
	@echo "  make ci            # Full local CI check"

setup:  ## Install dependencies (pip install -e .[dev])
	pip install -e ".[dev]"

install-hooks:  ## Install pre-commit hooks (opt-in for contributors)
	@echo "Installing pre-commit hooks..."
	@if git config --global --get core.hooksPath >/dev/null 2>&1; then \
		echo "⚠️  Detected global core.hooksPath: $$(git config --global --get core.hooksPath)"; \
		echo "    Setting repo-local core.hooksPath to empty to override..."; \
		git config core.hooksPath ""; \
		pre-commit install; \
		echo "✓ Pre-commit hooks installed"; \
		echo "  Note: Repo-local hooksPath set to override global"; \
	else \
		pre-commit install; \
		echo "✓ Pre-commit hooks installed"; \
	fi
	@echo "  Hooks will run automatically on git commit"
	@echo "  To skip hooks: git commit --no-verify"

validate:  ## Run all validators (frontmatter + sensitive terms)
	python scripts/validate_repo.py

generate:  ## Generate INDEX.yaml from patterns
	python scripts/generate_index.py

generate-check:  ## Verify INDEX.yaml is up to date (used in pre-commit)
	python scripts/generate_index.py --check

search:  ## Search patterns (e.g., make search TAG=security)
	@if [ -z "$(QUERY)" ] && [ -z "$(TAG)" ] && [ -z "$(STATUS)" ] && [ -z "$(PERSONA)" ] && [ -z "$(TOOL)" ]; then \
		echo "Usage: make search [QUERY=text] [TAG=tag] [STATUS=status] [PERSONA=persona] [TOOL=tool]"; \
		echo ""; \
		echo "Examples:"; \
		echo "  make search TAG=security"; \
		echo "  make search STATUS=recommended"; \
		echo "  make search QUERY='code review' TOOL=cursor"; \
	else \
		python scripts/search_patterns.py $(if $(QUERY),--query "$(QUERY)") $(if $(TAG),--tag $(TAG)) $(if $(STATUS),--status $(STATUS)) $(if $(PERSONA),--persona $(PERSONA)) $(if $(TOOL),--tool $(TOOL)); \
	fi

security:  ## Run security audit (pip-audit for CVEs)
	pip-audit

test:  ## Run pytest test suite
	@if [ -d "scripts/tests" ] && [ "$$(ls -A scripts/tests/*.py 2>/dev/null)" ]; then \
		pytest scripts/tests/ -v; \
	else \
		echo "⚠️  No tests found in scripts/tests/"; \
		echo "    Create tests to enable this check (see issue #16)"; \
	fi

ci:  ## Full CI check (validate + security + test + pre-commit checks)
	@echo "==> Running pre-commit checks (duplicates pre-commit hooks)..."
	@if command -v pre-commit >/dev/null 2>&1; then \
		pre-commit run --all-files; \
	else \
		echo "⚠️  pre-commit not installed, skipping hook checks"; \
		echo "    Install with: pip install pre-commit"; \
	fi
	@echo ""
	@echo "==> Running validators..."
	python scripts/validate_repo.py
	@echo ""
	@echo "==> Running security audit..."
	pip-audit
	@echo ""
	@echo "==> Running tests..."
	@if [ -d "scripts/tests" ] && [ "$$(ls -A scripts/tests/*.py 2>/dev/null)" ]; then \
		pytest scripts/tests/ -v; \
	else \
		echo "⚠️  No tests found — skipping"; \
	fi
	@echo ""
	@echo "✓ All checks passed"

clean:  ## Remove generated files and caches
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	rm -rf .pytest_cache/ .ruff_cache/
