#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Registering MCP server..."

# Check if containers are running
if ! docker compose -f "$PROJECT_DIR/docker-compose.yml" ps | grep -q "conductor-mcp"; then
    echo "Starting containers first..."
    docker compose -f "$PROJECT_DIR/docker-compose.yml" up -d
    sleep 5
fi

# Check if health endpoint is responding
if ! curl -sf http://localhost:3100/health > /dev/null 2>&1; then
    echo "Waiting for HTTP server to be ready..."
    sleep 5
fi

# Register with Claude Code using HTTP transport
# Note: If your Claude Code version supports HTTP transport, use:
# claude mcp add conductor --transport http --url http://localhost:3100

# For stdio transport via docker exec (fallback):
claude mcp add conductor --scope project -- docker exec -i conductor-mcp node dist/index.js --stdio

echo ""
echo "MCP server registered!"
echo ""
claude mcp list
