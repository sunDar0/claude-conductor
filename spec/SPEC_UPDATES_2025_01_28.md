# Claude Conductor 스펙 업데이트

> 업데이트 일자: 2025-01-28
> 이 문서는 기존 스펙 대비 실제 구현에서 변경된 사항을 명시합니다.

---

## 1. 아키텍처 변경: Docker → 로컬 실행

### 변경 전 (스펙)
```
conductor-mcp/
├── docker-compose.yml      # conductor-mcp + redis
└── services/conductor/     # Docker 컨테이너로 실행
```

### 변경 후 (실제)
```
conductor-mcp/
├── docker-compose.yml      # Redis만 Docker
└── services/
    ├── conductor/          # 로컬 Node.js로 실행
    └── dashboard/          # 로컬 Vite dev server
```

### 변경 이유
- 개발 편의성: 코드 변경 시 즉시 반영
- 디버깅 용이성: 로컬에서 직접 디버깅 가능
- 리소스 효율: Docker 오버헤드 감소

### 영향받는 스펙
- `CLAUDE_CONDUCTOR_PHASE2_SPEC.md`: docker-compose.yml 섹션
- `CLAUDE_CONDUCTOR_PHASE7_SPEC_PART_B.md`: Production Docker Config 섹션

### 현재 실행 방식
```bash
# Redis만 Docker로 실행
cd conductor-mcp
docker-compose up -d  # Redis만 시작

# Conductor MCP 서버 (로컬)
cd services/conductor
pnpm dev

# Dashboard (로컬)
cd services/dashboard
pnpm dev
```

---

## 2. 태스크 상태 확장: BACKLOG 추가

### 변경 전 (스펙)
```
READY → IN_PROGRESS → REVIEW ⇄ IN_PROGRESS → DONE → CLOSED
```

### 변경 후 (실제)
```
BACKLOG → READY → IN_PROGRESS → REVIEW ⇄ IN_PROGRESS → DONE → CLOSED
          ↑_____________________________|
          (반려 시 BACKLOG로 이동)
```

### 상태 정의 업데이트

| 상태 | 이모지 | 설명 |
|------|--------|------|
| **BACKLOG** | 📦 | 백로그, 아직 준비되지 않음 |
| READY | 📋 | 준비 완료, 시작 대기 |
| IN_PROGRESS | 🔄 | 작업 진행 중 |
| REVIEW | 👀 | 개발자 검수 대기 |
| DONE | ✅ | 검수 승인 완료 |
| CLOSED | 🏁 | 최종 종료 |

### 유효한 상태 전이

```typescript
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  BACKLOG: ['READY'],
  READY: ['IN_PROGRESS', 'BACKLOG'],
  IN_PROGRESS: ['REVIEW', 'BACKLOG'],
  REVIEW: ['DONE', 'IN_PROGRESS', 'BACKLOG'],
  DONE: ['CLOSED'],
  CLOSED: [],
};
```

### 영향받는 스펙
- `CLAUDE_CONDUCTOR_PHASE1_SPEC.md`: 상태 정의 섹션
- `CLAUDE_CONDUCTOR_PHASE2_SPEC.md`: task.types.ts 섹션

---

## 3. 신규 기능: Auto-Pipeline

### 개요
대시보드에서 "Run" 버튼 클릭 시 Claude CLI가 자동으로 태스크를 처리하는 기능.

### 워크플로우
```
1. 대시보드: [Run] 버튼 클릭
2. HTTP API: POST /tasks/{id}/run
3. Auto-Pipeline: Claude CLI 프로세스 생성
4. WebSocket: 실시간 출력 스트리밍 (pipeline:output)
5. 완료 시: REVIEW 상태로 자동 전이
```

### 관련 파일
- `services/conductor/src/handlers/auto-pipeline.ts`
- `services/conductor/src/http-server.ts` (POST /tasks/:id/run)

### WebSocket 이벤트

| 이벤트 | 설명 |
|--------|------|
| `task:started` | AI가 작업 시작 |
| `pipeline:output` | 실시간 출력 라인 |
| `task:review` | 작업 완료, 검수 대기 |
| `pipeline:error` | 오류 발생 |
| `pipeline:queued` | 대기열에 추가됨 |

### 대시보드 UI
- `TaskModal.tsx`: IN_PROGRESS 상태에서 실시간 로그 표시
- Live output 영역: 최근 100줄 표시, 자동 스크롤

---

## 4. 신규 기능: Manual Trigger Workflow

### 개요
기존 자동 시작 방식에서 사용자가 명시적으로 작업을 시작하는 방식으로 변경.

### 변경 전 (스펙)
```
태스크 생성 → 자동으로 AI가 처리 시작
```

### 변경 후 (실제)
```
태스크 생성 (READY) → 사용자가 [Run] 클릭 → AI 작업 시작 (IN_PROGRESS) → 완료 (REVIEW)
```

### 이점
- 사용자가 작업 시점 제어 가능
- 의도하지 않은 자동 실행 방지
- 작업 우선순위 조절 용이

### 대시보드 Review Actions
- **승인 (DONE)**: 작업 결과 승인
- **반려 (BACKLOG)**: 피드백과 함께 백로그로 이동
- **재실행**: 다시 Run (READY → IN_PROGRESS)

---

## 5. HTTP API 확장

### 신규 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/tasks/:id/run` | 태스크 실행 트리거 |
| GET | `/tasks/:id/context` | 태스크 컨텍스트 파일 조회 |
| GET | `/agents` | 활성 에이전트 목록 |
| GET | `/agents/roles` | 사용 가능한 에이전트 역할 |

### 기존 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/tasks` | 태스크 목록 |
| POST | `/tasks/:id/transition` | 상태 전이 |
| GET | `/projects` | 프로젝트 목록 |
| POST | `/projects/:id/select` | 프로젝트 선택 |
| GET | `/servers` | 서버 목록 |
| GET | `/servers/:id/logs` | 서버 로그 |

---

## 6. 대시보드 패널 구성

### 현재 구조

```
+------------------+------------------------+------------------+
|     Sidebar      |      Main Content      |   Right Panel    |
|------------------|------------------------|------------------|
| - Projects       |      Kanban Board      | - Servers        |
| - Navigation     |  BACKLOG | READY | ... | - Sub Agents     |
|                  |                        | - Activity       |
+------------------+------------------------+------------------+
```

### 패널 역할

| 패널 | 컴포넌트 | 역할 |
|------|----------|------|
| Servers | `ServerPanel.tsx` | 개발 서버 상태, 포트, 로그 뷰어 |
| Sub Agents | `AgentPanel.tsx` | 에이전트 역할/상태 모니터링 |
| Activity | `ActivityFeed.tsx` | 실시간 이벤트 피드 |

---

## 7. 구조화된 로깅 (pino)

### 변경 사항
- 기존: console.log/console.error
- 변경: pino 로거 사용

### 로거 설정
```typescript
// services/conductor/src/utils/logger.ts
import pino from 'pino';

export const mcpLogger = pino({
  name: 'conductor-mcp',
  level: process.env.LOG_LEVEL || 'info',
});

export const httpLogger = pino({
  name: 'conductor-http',
  level: process.env.LOG_LEVEL || 'info',
});
```

---

## 적용 대상 스펙 문서

| 문서 | 업데이트 내용 |
|------|--------------|
| Phase 1 | BACKLOG 상태 추가 |
| Phase 2 | Docker 아키텍처 변경, 상태 전이 업데이트 |
| Phase 4 | Auto-pipeline, Manual Trigger 추가 |
| Phase 7 | Production Docker Config 제거/수정 |

---

*업데이트 문서 끝*
