# Claude Conductor

## 빌드 / 테스트 / 실행

```bash
# 전체 시작 (Redis + Conductor + Dashboard)
./start.sh

# 개별 서비스
cd conductor-mcp/services/conductor && pnpm run dev     # MCP + HTTP + WS
cd conductor-mcp/services/dashboard && pnpm run dev     # Vite dev server

# 빌드
cd conductor-mcp/services/conductor && pnpm run build   # tsup
cd conductor-mcp/services/dashboard && tsc && pnpm run build  # vite build

# 테스트
cd conductor-mcp/services/conductor && pnpm test        # vitest
```

- HTTP API: `localhost:3100`, WebSocket: `localhost:3101`, Dashboard: `localhost:4000`
- Redis 필수 (docker-compose로 관리)
- `WORKSPACE_DIR` 환경변수: 레지스트리 파일 경로 기준점

## 반드시 지켜야 할 규칙

### Task 상태 머신 (위반 시 장애)
```
BACKLOG → READY → IN_PROGRESS → REVIEW ⇄ IN_PROGRESS
                                    ↓
                                  DONE → CLOSED
```
- `VALID_TRANSITIONS` (`task.types.ts`)만 허용. 상태 건너뛰기 금지
- REVIEW → IN_PROGRESS 거절 시 반드시 `feedback` 필수
- REVIEW → DONE 전환 시 CHANGELOG 자동 생성됨

### 레지스트리 파일
- `.claude/tasks/registry.json` — 태스크 단일 소스. **직접 수정 금지**, 반드시 MCP 도구(`task_create`, `task_transition` 등) 사용
- `.claude/servers/registry.json` — 서버 상태 레지스트리
- `.claude/projects/registry.json` — 프로젝트 레지스트리

### Redis 이벤트
- 모든 상태 변경은 `publishEvent()`로 `conductor:events` 채널에 발행해야 함
- Dashboard WebSocket이 Redis pub/sub으로 실시간 업데이트 수신

### Orchestration 초기화 순서
- Redis 연결 → AgentRegistry → SkillLoader → AgentManager → ParallelEngine
- Redis 없으면 orchestration 비활성화 (graceful degradation)

## 수정 금지 영역

- `VALID_TRANSITIONS` 맵 변경 시 상태 머신 전체에 영향
- `registry.ts`의 경로 로직 (`WORKSPACE_DIR` 기반)
- MCP tool schema (`server.ts`의 ListToolsRequestSchema 핸들러) — 클라이언트 호환성

## 컨벤션

- ESM only (`"type": "module"`, `.js` 확장자 import)
- 로거: `pino` 사용 (`utils/logger.ts`), `console.log` 금지 (MCP stdio와 충돌)
- 날짜: `utils/date.ts`의 유틸 사용 (`nowISO`, `formatKorean`)
- 이벤트 발행: handler에서 `publish('event.name', data)` + `createActivity()` 패턴

## 도메인 지식 (필요할 때 참조)

- [Task & 상태 머신](.claude/skills/task-management/SKILL.md) — 상태 전이, 피드백, 자동 파이프라인
- [Agent Orchestration](.claude/skills/orchestration/SKILL.md) — 에이전트 생명주기, 병렬 실행, 전략
- [Dashboard](.claude/skills/dashboard/SKILL.md) — React/Zustand 구조, WebSocket, 칸반보드
