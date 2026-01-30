#!/bin/bash
# Claude Conductor 시작 스크립트

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# WORKSPACE_DIR 설정 (Conductor 프로젝트 루트)
export WORKSPACE_DIR="$SCRIPT_DIR"

echo "=== Claude Conductor 시작 ==="

# 1. Redis 시작
echo "[1/3] Redis 시작..."
cd conductor-mcp
docker-compose up -d redis
cd ..

# Redis 준비 대기
echo "  Redis 연결 대기..."
until docker exec conductor-redis redis-cli ping 2>/dev/null | grep -q PONG; do
  sleep 1
done
echo "  Redis 준비 완료"

# 2. Conductor 시작 (백그라운드)
echo "[2/3] Conductor 시작..."
cd conductor-mcp/services/conductor
pnpm run start:all &
CONDUCTOR_PID=$!
cd ../../..

# Conductor 준비 대기
echo "  Conductor 연결 대기..."
until curl -s http://localhost:3100/health >/dev/null 2>&1; do
  sleep 1
done
echo "  Conductor 준비 완료"

# 3. Dashboard 시작 (백그라운드)
echo "[3/3] Dashboard 시작..."
cd conductor-mcp/services/dashboard
pnpm run dev &
DASHBOARD_PID=$!
cd ../../..

sleep 2

echo ""
echo "=== Claude Conductor 실행 중 ==="
echo ""
echo "  Dashboard: http://localhost:4000"
echo "  API:       http://localhost:3100"
echo "  WebSocket: ws://localhost:3101"
echo ""
echo "종료하려면 Ctrl+C"
echo ""

# 자식 프로세스 트리 종료 함수
kill_tree() {
  local pid=$1
  # 자식 프로세스들 먼저 종료
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
}

# 종료 핸들러
cleanup() {
  echo ""
  echo "=== 종료 중 ==="
  kill_tree $CONDUCTOR_PID
  kill_tree $DASHBOARD_PID
  wait $CONDUCTOR_PID 2>/dev/null || true
  wait $DASHBOARD_PID 2>/dev/null || true
  echo "완료"
  exit 0
}

trap cleanup SIGINT SIGTERM

# 대기 (시그널로 종료 시 wait의 non-zero 리턴 무시)
wait || true
