# Claude Conductor 온보딩 가이드

> **대상**: 주니어 개발자 (프로젝트 유지보수 및 운영)
> **최종 업데이트**: 2026-02-03

---

## 1. 프로젝트 개요

### 1.1 한 줄 요약
AI 개발자(Claude)를 위한 태스크 관리 · 실행 · 검수 시스템입니다. 태스크를 생성하면 AI가 자동으로 구현하고, 사람은 검수와 피드백에만 집중하는 human-in-the-loop 개발 오케스트레이터입니다.

### 1.2 시스템 구조 (3-tier Architecture)
```
┌─────────────────┐      WebSocket       ┌─────────────────┐      stdin/stdout     ┌─────────────────┐
│   Dashboard     │ ←─────────────────→  │   MCP Server    │  ←─────────────────→  │   Claude AI     │
│   (React)       │      HTTP REST       │   (Node.js)     │                       │   (CLI)         │
│   Port: 4000    │                      │   Port: 3100    │                       │                 │
└─────────────────┘                      └─────────────────┘                       └─────────────────┘
                                                  │
                                                  ↕
                                          ┌───────────────┐
                                          │     Redis     │
                                          │  Port: 6379   │
                                          └───────────────┘
```

### 1.3 핵심 개념
- **Task**: 개발 작업 단위 (예: "API 엔드포인트 추가", "버그 수정")
- **Pipeline**: Claude AI가 Task를 자동으로 실행하는 프로세스
- **Agent**: 특정 역할을 가진 AI 작업자 (code, review, security, test 등)
- **Orchestration**: 여러 Agent를 조합하여 작업을 병렬/순차 실행
- **MCP (Model Context Protocol)**: Claude와 통신하는 표준 프로토콜

---

## 2. 기술 스택

### 2.1 Backend
- **언어**: Node.js 24+, TypeScript 5.x
- **프레임워크**: Express (HTTP API)
- **MCP**: `@modelcontextprotocol/sdk` (Claude와 통신)
- **WebSocket**: `ws` (실시간 이벤트)
- **데이터 저장**: Redis (이벤트 pub/sub), 파일 기반 JSON (Task/Project 레지스트리)
- **로깅**: Pino (구조화된 로깅)
- **Git**: `simple-git` (변경사항 추적)
- **프로세스 관리**: `child_process` (Claude CLI 실행)

### 2.2 Frontend
- **언어**: TypeScript 5.x
- **프레임워크**: React 18
- **빌드 도구**: Vite 5
- **스타일링**: TailwindCSS 3.x
- **상태 관리**: Zustand 4.x (경량 상태 관리)
- **드래그앤드롭**: `@dnd-kit/core` (Kanban 보드)
- **마크다운 렌더링**: `react-markdown`

### 2.3 Infrastructure
- **컨테이너**: Docker (Redis만 컨테이너화)
- **패키지 관리**: pnpm
- **AI**: Claude Code CLI (로컬 설치)

---

## 3. 디렉토리 구조

```
claude-conductor/
│
├── .claude/                          # 프로젝트 메타데이터 (데이터 파일 저장소)
│   ├── tasks/                        # Task 데이터
│   │   ├── registry.json             # 모든 Task 목록
│   │   └── TASK-XXX/                 # 각 Task별 폴더
│   │       ├── context.md            # Task 실행 결과 및 이력
│   │       └── prompt.md             # AI에게 전달한 프롬프트 히스토리
│   ├── projects/                     # Project 데이터
│   │   └── registry.json             # 프로젝트 목록
│   └── servers/                      # 실행 중인 개발 서버 정보
│       └── registry.json
│
├── conductor-mcp/                    # MCP Server 및 Dashboard
│   ├── services/
│   │   ├── conductor/                # Backend (MCP Server)
│   │   │   └── src/
│   │   │       ├── server.ts         # MCP 서버 메인 엔트리포인트 (Tool 정의)
│   │   │       ├── http-server.ts    # REST API 서버
│   │   │       ├── websocket-server.ts  # WebSocket 서버
│   │   │       ├── handlers/         # Tool 핸들러
│   │   │       │   ├── task.handler.ts      # Task CRUD
│   │   │       │   ├── project.handler.ts   # Project 관리
│   │   │       │   ├── auto-pipeline.ts     # **가장 중요** - Pipeline 자동화
│   │   │       │   └── review.handler.ts    # 코드 리뷰
│   │   │       ├── orchestration/    # Agent 오케스트레이션
│   │   │       │   ├── agent-registry.ts    # Agent 정의 관리
│   │   │       │   ├── agent-manager.ts     # Agent 인스턴스 관리
│   │   │       │   ├── agent-executor.ts    # Claude CLI 실행
│   │   │       │   └── parallel-engine.ts   # 병렬/순차 실행 엔진
│   │   │       ├── utils/            # 유틸리티
│   │   │       │   ├── registry.ts          # 파일 기반 DB 읽기/쓰기
│   │   │       │   ├── logger.ts            # Pino 로거
│   │   │       │   └── project-manager.ts   # Project CRUD
│   │   │       └── types/            # TypeScript 타입 정의
│   │   │
│   │   └── dashboard/                # Frontend (React)
│   │       └── src/
│   │           ├── components/       # React 컴포넌트
│   │           │   ├── kanban/       # Kanban 보드
│   │           │   │   ├── KanbanBoard.tsx  # 메인 보드
│   │           │   │   ├── TaskCard.tsx     # Task 카드
│   │           │   │   └── TaskModal.tsx    # Task 상세 모달 (fullscreen)
│   │           │   ├── ActivityFeed.tsx     # 타임라인
│   │           │   └── AgentPanel.tsx       # 실행 중인 Agent 목록
│   │           ├── store/            # Zustand Store
│   │           │   ├── taskStore.ts         # Task 상태
│   │           │   ├── projectStore.ts      # Project 상태
│   │           │   ├── serverStore.ts       # Server 상태
│   │           │   ├── agentStore.ts        # Agent 상태
│   │           │   ├── uiStore.ts           # UI 상태 (모달 등)
│   │           │   └── toastStore.ts        # 알림 상태
│   │           ├── hooks/            # Custom React Hook
│   │           │   └── useWebSocket.ts      # WebSocket 연결 관리
│   │           └── lib/              # 유틸리티
│   │               └── api.ts               # HTTP 클라이언트
│   │
│   └── docker-compose.yml            # Redis 컨테이너 정의
│
├── start.sh                          # 전체 시스템 시작 스크립트
├── README.md                         # 프로젝트 README
└── docs/
    └── ONBOARDING.md                 # 이 문서
```

---

## 4. 시스템 아키텍처

### 4.1 전체 데이터 흐름
```
[Dashboard UI 4000]
       │
       │ HTTP REST (Task CRUD, Project 관리)
       │ WebSocket (실시간 이벤트 수신)
       ↓
[HTTP Server 3100] + [WebSocket Server 3101]
       │
       │ MCP Tools (task_create, task_start, orchestrate 등)
       ↓
[MCP Server - server.ts]
       │
       ├──→ [Task Handler] ──→ registry.json (파일 저장)
       ├──→ [Auto-Pipeline] ──→ Claude CLI 실행
       └──→ [Parallel Engine] ──→ Agent Orchestration
                 │
                 ↓
           [AgentExecutor]
                 │
                 ↓ spawn
           [Claude CLI Process]
                 │
                 ↓ stdin/stdout (stream-json)
           [Claude AI Model]
```

### 4.2 실시간 이벤트 흐름
```
Handler (예: task_transition)
    │
    ↓ publishEvent('task:review', data)
[Redis Pub/Sub Channel: conductor:events]
    │
    ↓ subscribe
[WebSocket Server]
    │
    ↓ ws.send()
[Dashboard useWebSocket Hook]
    │
    ↓ event handler
[Zustand Store Update]
    │
    ↓ React re-render
[UI 업데이트]
```

---

## 5. 핵심 컴포넌트 설명

### 5.1 MCP Server (server.ts)

**역할**: Claude AI와 통신하는 Tool 제공자

**초기화 흐름**:
1. `initRedis()` - Redis 연결
2. `initOrchestration()` - Agent 시스템 초기화
   - AgentRegistry: Agent 정의 로드 (default/omc/global/project)
   - AgentManager: Agent 인스턴스 생명주기 관리
   - ParallelEngine: 병렬/순차 실행 엔진
3. `initAutoPipeline()` - Claude CLI 자동화 초기화
4. Tool 등록 (26개+)

**주요 Tool 카테고리**:
- **Task 관리**: `task_create`, `task_list`, `task_get`, `task_start`, `task_transition`
- **Project 관리**: `project_create`, `project_list`, `project_select`, `project_get`
- **Server 관리**: `server_start`, `server_stop`, `server_status`, `server_logs`
- **Agent 관리**: `agent_spawn`, `agent_delegate`, `agent_status`, `agent_terminate`
- **Orchestration**: `orchestrate`, `orchestrate_review`, `orchestrate_implement`
- **기타**: `review_code`, `changelog_generate`, `api_docs`

### 5.2 HTTP Server (http-server.ts)

**역할**: Dashboard를 위한 REST API 제공

**주요 엔드포인트**:

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/health` | GET | 헬스체크 |
| `/api/projects` | GET | 프로젝트 목록 |
| `/api/projects` | POST | 프로젝트 생성 |
| `/api/projects/:id` | PUT | 프로젝트 수정 |
| `/api/projects/:id` | DELETE | 프로젝트 삭제 |
| `/api/tasks` | GET | Task 목록 (project_id 필터 가능) |
| `/api/tasks` | POST | Task 생성 |
| `/api/tasks/:id` | GET | Task 상세 |
| `/api/tasks/:id/start` | POST | Task 시작 (READY → IN_PROGRESS) |
| `/api/tasks/:id/transition` | POST | Task 상태 전환 |
| `/api/tasks/:id/run` | POST | **Pipeline 수동 트리거** (▶️ 버튼) |
| `/api/tasks/:id/context` | GET | Task 실행 결과 조회 (context.md) |
| `/api/tasks/:id/prompt` | GET | Prompt 히스토리 조회 (prompt.md) |
| `/api/servers` | GET | 실행 중인 서버 목록 |
| `/api/agents` | GET | 실행 중인 Agent 목록 |
| `/api/agents/roles` | GET | 사용 가능한 Agent 역할 목록 |
| `/api/agent-sources` | GET | Agent 소스 (default/omc/global/project) |
| `/api/agent-sources/select` | POST | Agent 소스 변경 |

### 5.3 WebSocket Server (websocket-server.ts)

**역할**: 실시간 이벤트를 Dashboard에 전달

**작동 방식**:
1. Redis에서 `conductor:events` 채널 구독
2. 이벤트 수신 시 연결된 모든 WebSocket 클라이언트에게 broadcast
3. Dashboard는 `useWebSocket` Hook으로 이벤트 수신

**이벤트 타입**:
- `task:created`, `task:started`, `task:review`, `task:completed`
- `pipeline:output` (실시간 로그), `pipeline:error`, `pipeline:queued`
- `agent.spawned`, `agent.completed`, `agent.error`, `agent.terminated`
- `activity` (타임라인 이벤트)

### 5.4 Auto-Pipeline (auto-pipeline.ts) — **가장 중요**

**역할**: Task를 Claude CLI를 통해 자동으로 실행하는 핵심 로직

#### 5.4.1 전체 실행 흐름
```
1. Dashboard에서 ▶️ 클릭
    ↓
2. POST /api/tasks/:id/run → triggerPipeline(taskId)
    ↓
3. Task 상태: READY → IN_PROGRESS
    ↓
4. runAutoPipeline(taskId)
    ↓
5. 실행 전략 선택:
   ├─ shouldUseOrchestration() → true
   │   └→ runOrchestrated() (다중 Agent)
   │       ├─ Stage 1: main agent (code/test/docs/review)
   │       └─ Stage 2: review agents (review + security + test)
   │
   └─ shouldUseOrchestration() → false
       └→ runClaudeCLI() (단일 Claude CLI)
           └─ spawn('claude', [...args])
    ↓
6. 실행 중 실시간 로그 스트리밍
   - stdout → parseStreamEvent() → publishEvent('pipeline:output')
    ↓
7. 실행 완료
   ├─ Git 변경사항 수집 (collectGitChanges)
   ├─ AI 코드 리뷰 실행 (runCodeReview + runSecurityReview)
   ├─ context.md에 결과 저장
   └─ Task 상태: IN_PROGRESS → REVIEW
    ↓
8. 사용자가 Dashboard에서 검수
   ├─ 승인 → DONE → CLOSED
   └─ 피드백 입력 → REVIEW → IN_PROGRESS (재실행)
```

#### 5.4.2 Session Resume (세션 재개)
- Task에 `session_id` 저장
- 피드백 후 재실행 시 `--resume <session_id>` 옵션으로 이전 대화 컨텍스트 유지
- Claude CLI가 이전 작업 내용을 기억하여 증분 수정만 수행

#### 5.4.3 Prompt 구성
```markdown
# Conductor 태스크 실행

## 태스크 정보
- **ID**: TASK-XXX
- **제목**: API 엔드포인트 추가
- **설명**: /api/users GET 엔드포인트 구현
- **감지된 유형**: backend

## 실행 지침
1. **태스크 분석**
2. **적절한 전문 에이전트에 위임**
   - 코드 변경 → executor 에이전트
   - 문서화 → writer 에이전트
   - ...
3. **실제로 변경 사항을 구현**
4. **변경 사항이 올바르게 작동하는지 확인**
5. **변경된 내용을 요약**

## 중요 규칙
- 반드시 파일을 실제로 편집/작성해야 함
- 계획만 출력하지 말고 실행할 것
- **모든 출력과 문서는 한글로 작성**
```

#### 5.4.4 Git 변경사항 추적
1. **작업 전**: `captureBaseCommit()` - 현재 HEAD 커밋 저장
2. **작업 후**: `collectGitChanges()` - baseCommit..HEAD diff 수집
3. **결과**: context.md에 변경된 파일 목록 + diff 추가

#### 5.4.5 AI 코드 리뷰 파이프라인
성공적으로 실행된 후 자동으로:
1. `runCodeReview()` - 코드 품질 리뷰 (버그, 패턴, 성능)
2. `runSecurityReview()` - 보안 취약점 검사 (OWASP Top 10)
3. 결과를 Markdown으로 포맷팅 (심각도별 이슈 분류)
4. context.md에 추가

### 5.5 Parallel Engine (parallel-engine.ts)

**역할**: 여러 Agent를 조율하여 병렬/순차/파이프라인 실행

#### 5.5.1 실행 전략 (3가지)
| 전략 | 설명 | 사용 사례 |
|------|------|-----------|
| **parallel** | 모든 Agent 동시 실행 | 코드 리뷰 + 보안 리뷰 병렬 |
| **sequential** | Agent 순차 실행 (이전 결과를 다음 Agent에 전달) | 코드 작성 → 테스트 → 문서화 |
| **pipeline** | Stage별로 그룹화하여 실행 | Stage 1 (구현) → Stage 2 (검증) |

#### 5.5.2 Stage 시스템
```typescript
// 예: 구현 파이프라인
{
  stages: [
    {
      stage_id: 'stage-main',
      name: '메인 작업',
      agents: [{ role: 'code', skills: [] }],
      parallel: false,  // 순차 실행
      timeout_ms: 1800000
    },
    {
      stage_id: 'stage-review',
      name: '검증 (리뷰 & 보안 & 테스트)',
      agents: [
        { role: 'review', skills: [] },
        { role: 'security', skills: [] },
        { role: 'test', skills: [] }
      ],
      parallel: true,  // 병렬 실행
      timeout_ms: 600000
    }
  ]
}
```

#### 5.5.3 Context 전달
- **initial_shared**: 모든 Agent에게 전달 (예: baseCommit)
- **previous_stage_results**: 이전 Stage 결과를 다음 Stage에 전달
- **previous_result**: 순차 실행 시 바로 이전 Agent 결과 전달

### 5.6 Agent Registry (agent-registry.ts)

**역할**: Agent 정의를 관리 (4가지 소스)

#### 5.6.1 Agent 소스 우선순위
1. **default**: 내장 기본 Agent (code, test, review, docs, security)
2. **omc**: oh-my-claudecode 28개 Agent (executor, architect, designer 등)
3. **global**: `~/.claude/agents/` (사용자 전역 Agent)
4. **project**: `<project>/.claude/agents/` (프로젝트별 Agent)

#### 5.6.2 Role Mapping (omc 사용 시)
오케스트레이션의 canonical role을 omc 이름으로 변환:
- `code` → `executor`
- `review` → `code-reviewer`
- `security` → `security-reviewer`
- `test` → `qa-tester`
- `docs` → `writer`

#### 5.6.3 Agent 정의 파일 포맷
**YAML** (우선):
```yaml
role: code
name: Code Implementation Agent
description: 코드 구현 전문 Agent
skills:
  required: []
  optional: []
system_prompt: |
  You are a Code Agent...
tools: [Read, Write, Edit, Glob, Grep, Bash]
config:
  timeout_ms: 1800000
  max_retries: 2
  parallel_allowed: false
```

**Markdown** (대체):
```markdown
---
name: code-agent
description: 코드 구현 전문 Agent
tools: Read, Write, Edit
---

You are a Code Agent specialized in...
```

---

## 6. 태스크 상태 머신

### 6.1 상태 정의
```
BACKLOG → READY → IN_PROGRESS → REVIEW ⇄ IN_PROGRESS → DONE → CLOSED
   ↓                                ↕
 (삭제 가능)                      (피드백 루프)
```

| 상태 | 의미 | UI 컬럼 |
|------|------|---------|
| **BACKLOG** | 백로그 (작업 대기) | Backlog |
| **READY** | 생성됨, 시작 가능 | Ready |
| **IN_PROGRESS** | AI가 작업 중 | In Progress |
| **REVIEW** | 작업 완료, 검수 대기 | Review |
| **DONE** | 검수 승인됨 | Done |
| **CLOSED** | 최종 종료 (성공 or 취소) | Archived |

### 6.2 유효한 전환 (VALID_TRANSITIONS)
```typescript
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  BACKLOG: ['READY', 'CLOSED'],
  READY: ['IN_PROGRESS', 'BACKLOG', 'CLOSED'],
  IN_PROGRESS: ['REVIEW', 'READY', 'CLOSED'],  // 에러 시 READY로 복귀
  REVIEW: ['DONE', 'IN_PROGRESS', 'CLOSED'],   // 피드백 시 IN_PROGRESS
  DONE: ['CLOSED'],
  CLOSED: []  // 최종 상태
};
```

### 6.3 피드백 루프
```
사용자가 REVIEW 상태에서 피드백 입력
    ↓
POST /api/tasks/:id/transition
  { target_state: 'IN_PROGRESS', feedback: '버튼 색상 변경해주세요' }
    ↓
task.feedback_history.push({
  content: '버튼 색상 변경해주세요',
  created_at: '2026-02-03T...',
  resolved: false
})
    ↓
Task 상태: REVIEW → IN_PROGRESS
    ↓
runAutoPipeline() 재실행
  - session_id가 있으면 --resume로 컨텍스트 유지
  - 피드백을 Prompt에 포함
    ↓
Claude가 피드백 반영하여 증분 수정
    ↓
완료 후 다시 REVIEW 상태로 전환
    ↓
사용자 검수 → 승인 → DONE
```

---

## 7. 데이터 흐름 (가장 중요한 섹션)

### 7.1 태스크 실행 전체 흐름

#### Step 1: Dashboard에서 ▶️ 클릭
- **컴포넌트**: `TaskCard.tsx` 또는 `TaskModal.tsx`
- **액션**: `POST /api/tasks/:id/run`

#### Step 2: HTTP Server → triggerPipeline()
- **파일**: `auto-pipeline.ts:1196`
- **동작**:
  1. Task가 이미 실행 중인지 확인 (`activePipelines.has(taskId)`)
  2. Task 상태를 `READY` → `IN_PROGRESS`로 전환
  3. `registry.json` 업데이트
  4. Redis에 `task:started` 이벤트 발행

#### Step 3: runAutoPipeline(taskId)
- **파일**: `auto-pipeline.ts:177`
- **동작**:
  1. Task 조회 (registry.json에서)
  2. Project 경로 확인
  3. 프로젝트별 큐 체크 (동일 프로젝트는 한 번에 하나씩만 실행)
  4. 실행 전략 결정:
     - `shouldUseOrchestration()` → Orchestrated vs Direct CLI

#### Step 4-A: Orchestrated 실행 (다중 Agent)
- **파일**: `auto-pipeline.ts:551` - `runOrchestrated()`
- **동작**:
  1. `buildOrchestrationPlan()` - Task 유형에 따라 Plan 생성
  2. `captureBaseCommit()` - Git HEAD 저장
  3. `parallelEngine.execute(plan, workDir)` 호출
     - Stage 1: main agent (code/test/docs 등) 실행
     - Stage 2: review agents (review + security + test) 병렬 실행
  4. 각 Agent는 `agent-executor.ts`에서 Claude CLI 프로세스 spawn
  5. 실행 중 `publishEvent('pipeline:output', ...)` 로그 스트리밍
  6. 완료 후:
     - 결과를 `context.md`에 저장
     - Task 상태: `IN_PROGRESS` → `REVIEW`

#### Step 4-B: Direct CLI 실행 (단일 프로세스)
- **파일**: `auto-pipeline.ts:909` - `runClaudeCLI()`
- **동작**:
  1. Prompt 생성 (`buildPrompt()`)
  2. Session ID 확인 (resume 가능 여부)
  3. `spawn('claude', [...args])` - Claude CLI 실행
     - `--output-format stream-json` (실시간 JSON 스트리밍)
     - `--resume <session_id>` (재실행 시 컨텍스트 유지)
  4. stdout 파싱 (`parseStreamEvent()`)
     - `type: 'assistant'` → AI 응답
     - `type: 'tool'` → 도구 사용 (Read, Write, Bash 등)
     - `type: 'result'` → 최종 결과
  5. 실시간 로그를 WebSocket으로 전송
  6. 완료 후:
     - Git 변경사항 수집
     - AI 코드 리뷰 + 보안 검사 (병렬 실행)
     - `context.md`와 `prompt.md`에 저장
     - Task 상태: `IN_PROGRESS` → `REVIEW`

#### Step 5: 실시간 로그 스트리밍
```
Claude CLI stdout
    ↓ (JSON Lines)
parseStreamEvent(line)
    ↓
{ type: 'tool', content: '🔧 Read "src/api.ts"' }
    ↓
publishEvent('pipeline:output', { task_id, event_type: 'tool', output: ... })
    ↓
Redis Pub/Sub (conductor:events)
    ↓
WebSocket Server
    ↓
Dashboard useWebSocket.ts
    ↓
taskStore.appendPipelineOutput(taskId, output)
    ↓
TaskModal 컴포넌트 리렌더링 → 사용자가 실시간으로 로그 확인
```

#### Step 6: 작업 완료 및 REVIEW 전환
- **동작**:
  1. `context.md` 파일 생성/업데이트
     ```markdown
     ## Pipeline Output — 초기 실행 (2026-02-03T10:30:00Z)

     **사용된 도구**: Read, Write, Bash

     [AI의 설명 및 요약]

     ---
     ### Final Result
     [최종 결과]

     ## Changes
     ### 변경된 파일 (3개)
     | 파일 | 상태 | 변경 |
     |------|------|------|
     | `src/api.ts` | 수정됨 | +25 -10 |

     ## 코드 리뷰: TASK-XXX
     [AI 리뷰 내용]

     ## 보안 점검: TASK-XXX
     [보안 검사 결과]
     ```
  2. Task 상태 변경: `IN_PROGRESS` → `REVIEW`
  3. Redis에 `task:review` 이벤트 발행
  4. Dashboard에서 REVIEW 컬럼으로 카드 이동

### 7.2 실시간 업데이트 흐름

#### 이벤트 발행 → 구독 → UI 업데이트
```typescript
// 1. Backend에서 이벤트 발행
await publishEvent('task:review', { id: taskId, status: 'REVIEW' });

// 2. Redis Pub/Sub
redis.publish('conductor:events', JSON.stringify({
  event: 'task:review',
  data: { id: taskId, status: 'REVIEW' },
  timestamp: '2026-02-03T...'
}));

// 3. WebSocket Server (websocket-server.ts)
subscriber.on('message', (channel, message) => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
});

// 4. Dashboard (useWebSocket.ts)
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  handleEvent(data.event, data.data);
};

function handleEvent(eventType: string, data: any) {
  switch (eventType) {
    case 'task:review':
      taskStore.updateTask({ id: data.id, status: 'REVIEW' });
      break;
    case 'pipeline:output':
      taskStore.appendPipelineOutput(data.task_id, data.output);
      break;
    // ...
  }
}

// 5. Zustand Store 업데이트 → React 리렌더링
```

### 7.3 피드백 루프 (REVIEW → IN_PROGRESS)

#### Dashboard → Backend
```typescript
// TaskModal.tsx - 피드백 입력
const handleFeedback = async () => {
  await api.post(`/tasks/${task.id}/transition`, {
    target_state: 'IN_PROGRESS',
    feedback: '버튼 색상을 파란색으로 변경해주세요'
  });
};
```

#### Backend 처리
```typescript
// task.handler.ts - handleTaskTransition()
task.feedback_history.push({
  content: feedback,
  created_at: nowISO(),
  resolved: false
});
task.status = 'IN_PROGRESS';
await writeTaskRegistry(registry);

// auto-pipeline.ts - 재실행 트리거
// session_id가 있으면 resume, 없으면 이전 출력을 Prompt에 포함
const prompt = buildPrompt(task, isResume, previousOutput);
```

#### Resume vs Legacy 모드
| 모드 | 조건 | 동작 |
|------|------|------|
| **Resume** | `task.session_id` 존재 | `--resume <session_id>`로 이전 대화 유지 |
| **Legacy** | `session_id` 없음 | `context.md`에서 이전 결과 추출하여 Prompt에 포함 |

---

## 8. 프론트엔드 구조

### 8.1 Zustand Store (6개)

#### taskStore.ts
```typescript
{
  tasks: Record<string, Task>,           // Task ID → Task 객체
  loading: boolean,
  error: string | null,
  currentProjectId: string | null,       // 필터링된 프로젝트
  pipelineOutput: Record<string, string[]>, // 실시간 로그

  fetchTasks(projectId?),                // Task 목록 조회
  updateTask(task),                      // Task 업데이트
  moveTask(taskId, newStatus),           // Kanban 드래그
  appendPipelineOutput(taskId, output),  // 로그 추가
}
```

#### projectStore.ts
```typescript
{
  projects: Project[],
  selectedProject: Project | null,

  fetchProjects(),
  selectProject(id),
  createProject(data),
  updateProject(id, data),
  deleteProject(id),
}
```

#### serverStore.ts
```typescript
{
  servers: Server[],

  fetchServers(),
  startServer(taskId, port?),
  stopServer(taskId),
}
```

#### agentStore.ts
```typescript
{
  agents: Agent[],                       // 실행 중인 Agent 목록
  roles: AgentRole[],                    // 사용 가능한 역할
  sources: AgentSourceType[],            // [default, omc, global, project]
  currentSource: AgentSourceType,

  fetchAgents(),
  fetchRoles(),
  selectSource(source),                  // Agent 소스 변경
}
```

#### uiStore.ts
```typescript
{
  isTaskModalOpen: boolean,
  selectedTaskId: string | null,
  isFullscreen: boolean,                 // TaskModal 전체화면

  openTaskModal(taskId),
  closeTaskModal(),
  toggleFullscreen(),
}
```

#### toastStore.ts
```typescript
{
  toasts: Toast[],

  addToast(message, type, duration?),
  removeToast(id),
}
```

### 8.2 주요 컴포넌트

#### KanbanBoard.tsx
- **역할**: 드래그앤드롭 Kanban 보드
- **컬럼**: Backlog, Ready, In Progress, Review, Done, Archived
- **라이브러리**: `@dnd-kit/core` (DndContext, Droppable, Draggable)
- **드래그 로직**:
  ```typescript
  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && over.id !== task.status) {
      taskStore.moveTask(task.id, over.id as TaskStatus);
    }
  };
  ```

#### TaskCard.tsx
- **역할**: Kanban 카드
- **주요 정보**: 제목, 설명(요약), 우선순위, 생성 시간
- **액션 버튼**:
  - ▶️ Run (READY 상태에서만)
  - ⏸️ Cancel (IN_PROGRESS 상태에서만)
  - 🗑️ Delete (READY/BACKLOG 상태에서만)
- **클릭**: TaskModal 열기

#### TaskModal.tsx — **가장 복잡**
- **역할**: Task 상세 정보 + 실시간 로그 + 피드백
- **기능**:
  1. **Fullscreen 모드** (F11 키)
  2. **탭 구성**:
     - **Output**: 실시간 Pipeline 로그 (auto-scroll)
     - **Context**: context.md 내용 (Markdown 렌더링)
     - **Prompt**: prompt.md 히스토리
     - **Reviews**: 피드백 히스토리
  3. **액션 버튼**:
     - Run (▶️)
     - Cancel (⏸️)
     - Approve (✅ REVIEW → DONE)
     - Add Feedback (💬 REVIEW → IN_PROGRESS)
     - Close Task (🔒 DONE → CLOSED)

#### AgentPanel.tsx
- **역할**: 실행 중인 Agent 실시간 표시
- **표시 정보**:
  - Agent ID, Role, 상태 (running/completed/error)
  - Task ID, 생성 시간
  - Worker (Claude CLI 프로세스) 별도 표시
- **Agent 소스 선택**: 드롭다운으로 default/omc/global/project 전환

#### ActivityFeed.tsx
- **역할**: 타임라인 (최근 이벤트)
- **이벤트 타입**:
  - `task.created` - 새 Task 생성
  - `task.started` - AI 작업 시작
  - `task.review` - 검수 대기
  - `pipeline.error` - Pipeline 오류

### 8.3 WebSocket Hook (useWebSocket.ts)

```typescript
export const useWebSocket = () => {
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3101');

    ws.onopen = () => {
      console.log('WebSocket connected');
      toastStore.addToast('실시간 연결 성공', 'success');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleEvent(data.event, data.data);
    };

    ws.onerror = () => {
      toastStore.addToast('연결 오류', 'error');
    };

    return () => ws.close();
  }, []);
};

function handleEvent(eventType: string, data: any) {
  switch (eventType) {
    case 'task:created':
    case 'task:started':
    case 'task:review':
      taskStore.updateTask(data);
      break;

    case 'pipeline:output':
      taskStore.appendPipelineOutput(data.task_id, data.output);
      break;

    case 'pipeline:error':
      toastStore.addToast(`Pipeline 오류: ${data.error}`, 'error');
      break;

    case 'agent.spawned':
    case 'agent.completed':
    case 'agent.error':
      agentStore.fetchAgents(); // Refresh agent list
      break;

    case 'activity':
      // ActivityFeed 업데이트
      break;
  }
}
```

---

## 9. 환경 설정 및 실행

### 9.1 환경 변수

**파일**: `conductor-mcp/services/conductor/.env` (생성 필요)

```bash
# Redis 연결
REDIS_URL=redis://localhost:6379

# MCP Server 설정
MCP_SERVER_NAME=claude-conductor
MCP_SERVER_VERSION=1.1.0

# HTTP Server 포트
HTTP_PORT=3100
WEBSOCKET_PORT=3101

# 작업 디렉토리 (start.sh에서 자동 설정)
WORKSPACE_DIR=/Users/yourname/work/claude-conductor

# Auto-start Pipeline (기본값: false, 수동 트리거 사용)
AUTO_START_PIPELINE=false

# 홈 디렉토리 (Agent 정의 로드용)
HOME=/Users/yourname
```

**파일**: `conductor-mcp/services/dashboard/.env` (생성 필요)

```bash
# API Server URL
VITE_API_BASE_URL=http://localhost:3100
VITE_WS_URL=ws://localhost:3101
```

### 9.2 실행 방법

#### 전체 시스템 시작 (권장)
```bash
cd <project-root>
./start.sh
```

**start.sh가 하는 일**:
1. Redis 컨테이너 시작 (`docker-compose up -d redis`)
2. Redis 연결 대기 (health check)
3. Conductor 백그라운드 실행 (`pnpm run start:all`)
4. Conductor health check (http://localhost:3100/health)
5. Dashboard 백그라운드 실행 (`pnpm run dev`)
6. 접속 정보 출력
7. Ctrl+C로 종료 시 모든 자식 프로세스 정리

#### 개별 실행 (디버깅용)
```bash
# 1. Redis
cd conductor-mcp
docker-compose up -d redis

# 2. Conductor
cd conductor-mcp/services/conductor
pnpm run start:all  # MCP + HTTP + WebSocket 동시 시작

# 3. Dashboard
cd conductor-mcp/services/dashboard
pnpm run dev
```

### 9.3 포트 자동 감지

**Conductor (start:all)**:
- HTTP Server: 3100번 포트 사용 중이면 3101, 3102... 순차 시도
- WebSocket Server: HTTP_PORT + 1
- 환경변수로 오버라이드 가능 (`HTTP_PORT`, `WEBSOCKET_PORT`)

**Dashboard**:
- Vite 기본 포트: 4000
- 사용 중이면 4001, 4002... 자동 증가

### 9.4 접속 URL
- **Dashboard**: http://localhost:4000
- **API**: http://localhost:3100
- **WebSocket**: ws://localhost:3101
- **Health Check**: http://localhost:3100/health

---

## 10. 운영 가이드 (초급 개발자 핵심)

### 10.1 로그 확인 방법

#### Backend 로그 (Pino 구조화 로깅)
```bash
cd conductor-mcp/services/conductor
pnpm run start:all

# 로그 레벨
# - info: 일반 정보 (Task 생성, 실행 시작 등)
# - error: 오류 (Pipeline 실패, DB 쓰기 실패 등)
# - debug: 디버깅 (HTTP 요청, WebSocket 메시지 등)
```

**주요 로그 예시**:
```json
{"level":30,"time":1706950000000,"pid":12345,"msg":"Task completed, moved to REVIEW","taskId":"TASK-025"}
{"level":50,"time":1706950010000,"pid":12345,"msg":"Claude CLI exited with code 1","taskId":"TASK-026","error":"..."}
```

#### Frontend 로그 (Browser Console)
```bash
# Chrome DevTools → Console
# F12 또는 Cmd+Option+I

# 주요 로그
[WebSocket] Connected
[WebSocket] Received event: task:review
[Store] Task updated: TASK-025
```

#### Task 실행 로그 (context.md)
```bash
# 각 Task별 실행 결과
cat .claude/tasks/TASK-025/context.md

# 내용:
# - Pipeline Output (AI 응답, 도구 사용)
# - Changes (Git diff)
# - 코드 리뷰 결과
# - 보안 점검 결과
```

#### Prompt 히스토리 (prompt.md)
```bash
# AI에게 전달한 Prompt 기록
cat .claude/tasks/TASK-025/prompt.md

# 초기 실행, 재실행(피드백) 각각 기록됨
```

### 10.2 자주 발생하는 문제와 해결

#### 1. 포트 충돌
**증상**: `Error: listen EADDRINUSE: address already in use :::3100`

**해결**:
```bash
# 1. 포트 사용 중인 프로세스 확인
lsof -i :3100

# 2. 프로세스 종료
kill -9 <PID>

# 3. 또는 start.sh 재실행 (자동으로 다른 포트 시도)
./start.sh
```

#### 2. Redis 미실행
**증상**: `Error: connect ECONNREFUSED 127.0.0.1:6379`

**해결**:
```bash
# Redis 상태 확인
docker ps | grep redis

# Redis 시작
cd conductor-mcp
docker-compose up -d redis

# Redis 연결 테스트
docker exec conductor-redis redis-cli ping
# 출력: PONG (정상)
```

#### 3. WebSocket 연결 끊김
**증상**: Dashboard에서 "연결 오류" 토스트, 실시간 업데이트 안 됨

**해결**:
```bash
# 1. Redis bridge 로그 확인
cd conductor-mcp/services/conductor
pnpm run start:all
# Redis 구독 로그 확인: "Subscribed to conductor:events"

# 2. WebSocket 포트 확인
netstat -an | grep 3101

# 3. 브라우저 콘솔에서 재연결 확인
# F12 → Console → "WebSocket connected" 확인
```

#### 4. Task IN_PROGRESS 상태에서 멈춤
**증상**: Task가 IN_PROGRESS에서 오랫동안 변화 없음

**원인**: Claude CLI 프로세스 오류 또는 타임아웃

**해결**:
```bash
# 1. context.md 확인 (에러 메시지)
cat .claude/tasks/TASK-XXX/context.md

# 2. Task 취소
curl -X POST http://localhost:3100/api/tasks/TASK-XXX/transition \
  -H "Content-Type: application/json" \
  -d '{"target_state":"READY"}'

# 3. 재실행
# Dashboard에서 ▶️ 버튼 클릭
```

#### 5. Agent not found
**증상**: `Error: Agent not found: executor`

**원인**: Agent 소스가 omc인데 oh-my-claudecode 플러그인 미설치

**해결**:
```bash
# 1. Agent 소스 확인
curl http://localhost:3100/api/agent-sources

# 2. Agent 소스 변경 (default로)
curl -X POST http://localhost:3100/api/agent-sources/select \
  -H "Content-Type: application/json" \
  -d '{"source":"default"}'

# 3. 또는 Dashboard → AgentPanel → 드롭다운에서 "Default" 선택
```

#### 6. 빌드 에러
**증상**: TypeScript 컴파일 오류

**해결**:
```bash
# 1. 타입 체크만 수행 (빌드 없이)
cd conductor-mcp/services/conductor
npx tsc --noEmit

# 2. 전체 재빌드
pnpm run build

# 3. node_modules 재설치
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### 10.3 데이터 파일 위치

| 파일 | 경로 | 설명 |
|------|------|------|
| Task 목록 | `.claude/tasks/registry.json` | 모든 Task 메타데이터 |
| Task 실행 결과 | `.claude/tasks/TASK-XXX/context.md` | AI 출력, Git diff, 리뷰 결과 |
| Prompt 히스토리 | `.claude/tasks/TASK-XXX/prompt.md` | AI에게 전달한 Prompt |
| Project 목록 | `.claude/projects/registry.json` | 프로젝트 메타데이터 |
| Server 목록 | `.claude/servers/registry.json` | 실행 중인 개발 서버 |

**백업 방법**:
```bash
# .claude 폴더 전체 백업
tar -czf claude-backup-$(date +%Y%m%d).tar.gz .claude/

# 복원
tar -xzf claude-backup-20260203.tar.gz
```

### 10.4 모니터링 체크리스트

#### 시스템 헬스체크
```bash
# 1. Redis 상태
docker ps | grep redis
# 출력: conductor-redis (Up)

# 2. Conductor API 응답
curl http://localhost:3100/health
# 출력: {"status":"ok","timestamp":"..."}

# 3. WebSocket 연결
wscat -c ws://localhost:3101
# (wscat 설치: npm install -g wscat)

# 4. Dashboard 접속
curl http://localhost:4000
# 출력: HTML (Vite 페이지)
```

#### Task 큐 상태 확인
```bash
# 1. 전체 Task 목록
curl http://localhost:3100/api/tasks | jq

# 2. IN_PROGRESS Task 확인
curl http://localhost:3100/api/tasks | jq '.data | to_entries[] | select(.value.status == "IN_PROGRESS")'

# 3. 실행 중인 Agent
curl http://localhost:3100/api/agents | jq
```

#### 디스크 사용량 체크
```bash
# .claude 폴더 크기
du -sh .claude/

# Task별 context.md 크기 (큰 순서)
find .claude/tasks -name "context.md" -exec du -h {} \; | sort -rh | head -10
```

---

## 11. 코드 수정 시 주의사항

### 11.1 auto-pipeline.ts 수정 시
- **가장 복잡한 파일**: 700+ 라인, 여러 실행 경로
- **주의 포인트**:
  - `runClaudeCLI()`: 프로세스 누수 주의 (cleanup 로직 필수)
  - `parseStreamEvent()`: JSON 파싱 에러 처리 필수 (불완전한 라인)
  - `collectGitChanges()`: binary 파일 처리 (insertions/deletions 없음)
  - Session resume: `session_id` 저장/로드 타이밍

### 11.2 상태 전이 규칙 준수
- **VALID_TRANSITIONS 위반 시 API 거부**
- **예**: REVIEW → BACKLOG는 불가능 (REVIEW → IN_PROGRESS 또는 DONE만 가능)
- **수정 위치**: `handlers/task.handler.ts:handleTaskTransition()`

### 11.3 publishEvent 호출 필수
- **실시간 UI 업데이트를 위해 반드시 호출**
- **예시**:
  ```typescript
  task.status = 'REVIEW';
  await writeTaskRegistry(registry);
  await publishEvent('task:review', { id: taskId, status: 'REVIEW' });
  ```

### 11.4 agent-executor.ts 프로세스 관리
- **spawn()한 프로세스는 반드시 종료 처리**
- **타임아웃 설정 필수** (무한 대기 방지)
- **cleanup 로직**:
  ```typescript
  const timeout = setTimeout(() => {
    process.kill('SIGTERM');
  }, timeoutMs);

  process.on('close', () => {
    clearTimeout(timeout);
    // 리소스 정리
  });
  ```

### 11.5 context.md 포맷 변경 시
- **TaskModal.tsx의 파싱 로직도 수정 필요**
- **Markdown 섹션 제목 기반 파싱**:
  - `## Pipeline Output` → 실행 결과
  - `## Changes` → Git diff
  - `## 코드 리뷰` → 리뷰 결과

### 11.6 새로운 Tool 추가 시
1. `server.ts`에 Tool 정의 추가 (ListToolsRequestSchema)
2. `server.ts`에 Tool 핸들러 추가 (CallToolRequestSchema)
3. `handlers/` 폴더에 핸들러 구현
4. 타입 정의 (`types/` 폴더)
5. API 문서 업데이트

---

## 12. 용어집

| 용어 | 설명 |
|------|------|
| **MCP** | Model Context Protocol - Claude와 통신하는 표준 프로토콜 |
| **Agent** | 특정 역할을 가진 AI 작업자 (code, review, security 등) |
| **Pipeline** | Task를 자동으로 실행하는 프로세스 (Claude CLI 기반) |
| **Orchestration** | 여러 Agent를 조합하여 병렬/순차/파이프라인 실행 |
| **Stage** | Orchestration의 실행 단계 (Stage 1: 구현, Stage 2: 검증) |
| **Role** | Agent의 역할 (code, test, review, docs, security) |
| **Session Resume** | Claude CLI의 이전 대화 컨텍스트를 유지하는 기능 |
| **Feedback Loop** | REVIEW에서 피드백 입력 → IN_PROGRESS 재실행 |
| **Tool** | MCP에서 제공하는 기능 (task_create, orchestrate 등) |
| **Worker** | Dashboard에서 표시하는 가상 Agent (Claude CLI 프로세스) |
| **Context.md** | Task 실행 결과를 저장하는 파일 |
| **Prompt.md** | AI에게 전달한 Prompt 히스토리 |
| **Registry.json** | Task/Project/Server 메타데이터를 저장하는 파일 |
| **Pub/Sub** | Redis의 이벤트 발행/구독 패턴 |
| **Zustand** | React 경량 상태 관리 라이브러리 |
| **Kanban** | Task를 시각화하는 보드 (Trello 스타일) |
| **Git Base Commit** | 작업 시작 시점의 HEAD 커밋 (변경사항 추적용) |
| **stream-json** | Claude CLI의 출력 포맷 (실시간 JSON Lines) |

---

## 13. 추가 학습 자료

### 13.1 필수 개념
1. **MCP (Model Context Protocol)**
   - 공식 문서: https://modelcontextprotocol.io/
   - Claude와 통신하는 도구를 정의하는 방법

2. **Claude CLI**
   - `claude --help` 명령어로 옵션 확인
   - `--output-format stream-json` 포맷 이해

3. **Redis Pub/Sub**
   - https://redis.io/docs/manual/pubsub/
   - 이벤트 기반 아키텍처 패턴

4. **Zustand**
   - https://zustand-demo.pmnd.rs/
   - React 상태 관리 (Redux보다 간단)

### 13.2 디버깅 팁
```bash
# 1. MCP Server 디버깅
cd conductor-mcp/services/conductor
DEBUG=* pnpm run start:all

# 2. Frontend 디버깅
cd conductor-mcp/services/dashboard
pnpm run dev
# Chrome DevTools → Sources → 브레이크포인트 설정

# 3. Redis 이벤트 모니터링
docker exec -it conductor-redis redis-cli
> SUBSCRIBE conductor:events
> PSUBSCRIBE *

# 4. WebSocket 메시지 디버깅
wscat -c ws://localhost:3101
# 실시간 이벤트 수신 확인
```

### 13.3 유용한 명령어
```bash
# Task 생성 (CLI)
curl -X POST http://localhost:3100/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "API 엔드포인트 추가",
    "description": "GET /api/users 엔드포인트 구현",
    "priority": "high"
  }'

# Task 상태 확인
curl http://localhost:3100/api/tasks/TASK-025 | jq

# Task 실행
curl -X POST http://localhost:3100/api/tasks/TASK-025/run

# 실행 중인 Agent 확인
curl http://localhost:3100/api/agents | jq

# Task 피드백
curl -X POST http://localhost:3100/api/tasks/TASK-025/transition \
  -H "Content-Type: application/json" \
  -d '{
    "target_state": "IN_PROGRESS",
    "feedback": "버튼 색상 변경"
  }'
```

---

## 14. 마무리

### 14.1 핵심 요약
1. **시스템 구조**: Dashboard ↔ MCP Server ↔ Claude AI (3-tier)
2. **가장 중요한 파일**: `auto-pipeline.ts` (Pipeline 실행 로직)
3. **실행 흐름**: ▶️ 클릭 → runAutoPipeline → Claude CLI → REVIEW
4. **실시간 업데이트**: Redis Pub/Sub → WebSocket → Zustand → React
5. **피드백 루프**: REVIEW → 피드백 입력 → IN_PROGRESS → 재실행

### 14.2 다음 단계
1. **시스템 실행**:
   ```bash
   ./start.sh
   # http://localhost:4000 접속
   ```

2. **첫 Task 생성 및 실행**:
   - Dashboard → "New Task" 버튼
   - 제목/설명 입력 → ▶️ 클릭
   - Output 탭에서 실시간 로그 확인

3. **코드 탐색**:
   - `auto-pipeline.ts` 읽기 (전체 흐름 이해)
   - `TaskModal.tsx` 읽기 (UI 동작 이해)

4. **디버깅 연습**:
   - 의도적으로 Task 실패시키기 (잘못된 Prompt)
   - 에러 로그 확인 (`context.md`, Backend 로그)

### 14.3 질문이 있을 때
1. **로그 확인**: context.md, Backend 로그, Browser Console
2. **코드 검색**: `grep -r "함수명" conductor-mcp/services/`
3. **문서 참고**: README.md, 이 ONBOARDING.md
4. **실험**: 로컬 환경에서 직접 수정 후 테스트

---

**작성자**: Claude Sonnet 4.5
**피드백**: GitHub Issues 또는 Slack #claude-conductor
**버전**: v1.0 (2026-02-03)
