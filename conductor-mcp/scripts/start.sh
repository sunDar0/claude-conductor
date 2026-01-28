#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Starting Claude Conductor..."

# Create .env if not exists
[ ! -f "$PROJECT_DIR/.env" ] && cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"

# Create data directory
mkdir -p "$PROJECT_DIR/data/conductor"

# Start Docker containers
docker compose -f "$PROJECT_DIR/docker-compose.yml" up -d

# Wait for containers
sleep 5

# Show status
docker compose -f "$PROJECT_DIR/docker-compose.yml" ps

echo ""
echo "Claude Conductor started!"
echo "  HTTP API: http://localhost:3100"
echo "  WebSocket: ws://localhost:3101"
echo ""
echo "Next step: ./scripts/register.sh"
