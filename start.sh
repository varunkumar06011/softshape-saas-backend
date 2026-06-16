#!/bin/sh
set -e

echo "Resolving failed migration..."
npx prisma migrate resolve --rolled-back 20240615000000_add_sync_fields || true

echo "Running pending migrations..."
npx prisma migrate deploy

echo "Starting server..."
node dist/index.js
