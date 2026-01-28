#!/bin/bash
# 불면증 클로드 - 잠 못 자는 Claude Code

caffeinate -dims &
CAFFEINATE_PID=$!

cleanup() {
    kill $CAFFEINATE_PID 2>/dev/null
    echo "☕ 불면증 해제, 클로드 잠들 수 있음"
}

trap cleanup EXIT

echo "☕ 불면증 모드 ON - 맥이 안 잠듭니다"
claude "$@"
