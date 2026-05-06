#!/bin/bash
# Lint SQL migrations for common mistakes.
# Run: ./scripts/lint-migrations.sh [file ...]
# With no args, checks all migrations/*.sql files.
set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

errors=0

if [ $# -gt 0 ]; then
  files=("$@")
else
  files=(migrations/*.sql)
fi

for file in "${files[@]}"; do
  [ -f "$file" ] || continue
  basename="$(basename "$file")"

  content="$(cat "$file")"

  # --- Rule 1: ADD COLUMN ... NOT NULL without DEFAULT on same line ---
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    col=$(echo "$line" | sed -E 's/.*ADD[[:space:]]+COLUMN[[:space:]]+([a-zA-Z_][a-zA-Z0-9_]*).*/\1/i')
    if ! echo "$line" | grep -iq 'DEFAULT'; then
      echo -e "${RED}ERROR${NC} [$basename]: ADD COLUMN $col is NOT NULL but has no DEFAULT"
      echo "  → INSERTs that omit this column will fail. Add a DEFAULT value."
      errors=$((errors + 1))
    fi
  done < <(grep -iE 'ADD[[:space:]]+COLUMN[[:space:]]+[a-zA-Z_]+[[:space:]]+[a-zA-Z_]+.*NOT[[:space:]]+NULL' "$file")

  # --- Rule 2: ALTER COLUMN ... SET NOT NULL without a SET DEFAULT in same file ---
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    col=$(echo "$line" | sed -E 's/.*ALTER[[:space:]]+COLUMN[[:space:]]+([a-zA-Z_][a-zA-Z0-9_]*).*/\1/i')
    if ! echo "$content" | grep -iqE "ALTER[[:space:]]+COLUMN[[:space:]]+${col}[[:space:]]+SET[[:space:]]+DEFAULT"; then
      echo -e "${RED}ERROR${NC} [$basename]: ALTER COLUMN $col SET NOT NULL but no SET DEFAULT for $col in this migration"
      echo "  → INSERTs that omit this column will fail. Add: ALTER COLUMN $col SET DEFAULT <value>"
      errors=$((errors + 1))
    fi
  done < <(grep -iE 'ALTER[[:space:]]+COLUMN[[:space:]]+[a-zA-Z_]+[[:space:]]+SET[[:space:]]+NOT[[:space:]]+NULL' "$file")

  # --- Rule 3: DROP COLUMN / DROP TABLE without IF EXISTS ---
  if grep -iqE 'DROP[[:space:]]+(COLUMN|TABLE)[[:space:]]' "$file"; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      if ! echo "$line" | grep -iq 'IF EXISTS'; then
        target=$(echo "$line" | sed -E 's/.*DROP[[:space:]]+(COLUMN|TABLE)[[:space:]]+([a-zA-Z_][a-zA-Z0-9_]*).*/\2/i')
        echo -e "${YELLOW}WARN${NC}  [$basename]: DROP without IF EXISTS ($target)"
        echo "  → Migration will fail if re-run. Consider adding IF EXISTS."
      fi
    done < <(grep -iE 'DROP[[:space:]]+(COLUMN|TABLE)[[:space:]]' "$file")
  fi

done

if [ $errors -gt 0 ]; then
  echo ""
  echo -e "${RED}$errors error(s) found.${NC} Fix before committing."
  exit 1
else
  echo "Migration lint: all clear."
fi
