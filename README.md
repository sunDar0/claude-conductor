# Claude Conductor

> n8n-like 자동화 개발 지휘 시스템

## 사용자가 할 일

1. 프로젝트 선택
2. 태스크 생성
3. 검수
4. 완료

끝.

## 설치 (최초 1회)

```bash
# 의존성 설치
cd conductor-mcp/services/conductor && pnpm install && cd ..
cd dashboard && pnpm install && cd ../..
```

## 실행

```bash
./start.sh
```

- Dashboard: http://localhost:4000
- API: http://localhost:3100
- WebSocket: ws://localhost:3101

## 워크플로우

```
태스크 생성 (READY)
     ↓ 자동
Claude CLI 실행 (IN_PROGRESS)
     ↓ 자동
작업 완료 (REVIEW)
     ↓ 사용자 검수
승인 (DONE → CLOSED)
```

## 아키텍처

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Dashboard  │ ──→ │  Conductor  │ ──→ │ Claude CLI  │
│   (:4000)   │     │   (:3100)   │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                          ▼
                    ┌─────────────┐
                    │    Redis    │
                    │   (Docker)  │
                    └─────────────┘
```
