#!/bin/sh
set -e

echo "Resolving failed migration..."
npx prisma migrate resolve --applied 20240615000000_add_sync_fields

echo "Running pending migrations..."
npx prisma migrate deploy

echo "Starting server..."
node dist/index.js
