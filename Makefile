.PHONY: setup validate generate test ci clean help

help:  ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup:  ## Install dependencies
	pip install -e ".[dev]"

validate:  ## Run all validators
	python scripts/validate_repo.py

generate:  ## Generate INDEX.yaml
	python scripts/generate_index.py

generate-check:  ## Verify INDEX.yaml is up to date
	python scripts/generate_index.py --check

test:  ## Run pytest
	pytest scripts/tests/ -v

ci:  ## Full CI check (validate + test)
	python scripts/validate_repo.py
	pytest scripts/tests/ -v
	@echo "✓ All checks passed"

clean:  ## Remove generated files
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	rm -rf .pytest_cache/ .ruff_cache/
