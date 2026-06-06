#!/bin/sh
set -e

echo "Running database seed..."
node dist/db/seed.js

echo "Starting server..."
exec node dist/index.js
