---
name: orchestration
description: "에이전트 오케스트레이션 생명주기, 실행 전략, 병렬 엔진 규칙"
---

# Skill: Agent Orchestration

## 초기화 의존성 체인
```
Redis → AgentRegistry.initialize() → SkillLoader → AgentManager → ParallelEngine
```
- Redis 연결 실패 시 orchestration 전체 비활성화
- `agentManager`, `parallelEngine`이 null이면 모든 agent_* 도구가 에러 반환

## Agent 생명주기

### Spawn → Delegate → Collect → Terminate
1. `agent_spawn`: role + task_id로 인스턴스 생성 (skills 선택적)
2. `agent_delegate`: instructions 전달 후 running 상태
3. `agent_collect`: 결과 수집 (timeout 지원, 기본 60초)
4. `agent_terminate`: 명시적 종료

### 에이전트 역할 (6종)
- `code`, `test`, `review`, `docs`, `security`, `performance`
- 역할 정의는 AgentRegistry가 파일 시스템에서 로드 (`~/.claude/agents/` + 프로젝트)

## 실행 전략 (ExecutionStrategy)

### parallel
- 모든 에이전트가 단일 스테이지에서 동시 실행
- 각 에이전트 간 충돌 감지 (`conflicts` 필드)

### sequential
- 에이전트별로 개별 스테이지 생성, 순차 실행

### pipeline
- `stage` 번호로 그룹화, 같은 스테이지 내 에이전트는 병렬
- 스테이지 간은 순차 — 이전 스테이지 완료 후 다음 진행

## 주의사항

### AgentRegistry 캐시
- `setInterval(syncAgentCache, 2000)` — 2초 간격으로 HTTP 캐시 갱신
- 에이전트 상태 변경이 Dashboard에 최대 2초 지연 반영

### Agent Source 전환
- `POST /api/agent-sources/select` — source 변경 시 registry 재초기화
- 전환 중 기존 에이전트 인스턴스는 유지 (새 spawn만 영향)

### OrchestrationPlan ID 생성
- `plan-{timestamp}-{uuid8자리}` 형식 — 충돌 방지

## 안티패턴

- Redis 없이 orchestration 기능 호출 → null 체크 누락 시 런타임 크래시
- `agentManager.startAgent` 없이 delegate → 에이전트가 idle 상태 유지
- ParallelEngine에 `setEventPublisher` 미호출 → 실행 이벤트 발행 안 됨
