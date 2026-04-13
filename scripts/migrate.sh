#!/bin/bash
set -e

DB_URL="postgres://chartkeeper:chartkeeper@localhost:5432/chartkeeper"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"

echo "Running migrations..."
for file in "$MIGRATIONS_DIR"/*.sql; do
  echo "  → $(basename "$file")"
  psql "$DB_URL" -f "$file"
done
echo "Done."
