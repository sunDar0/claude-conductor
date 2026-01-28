#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Starting Claude Conductor in development mode..."

# Create .env if not exists
[ ! -f "$PROJECT_DIR/.env" ] && cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"

# Start with dev compose file
docker compose -f "$PROJECT_DIR/docker-compose.yml" -f "$PROJECT_DIR/docker-compose.dev.yml" up -d

echo ""
echo "Development mode started!"
echo "  HTTP API: http://localhost:3100"
echo "  WebSocket: ws://localhost:3101"
echo ""
echo "To view logs: ./scripts/logs.sh"
