---
name: task-management
description: "Task 상태 머신, 피드백 루프, 자동 파이프라인 규칙"
---

# Skill: Task Management

## 상태 전이 주의사항

### 피드백 처리 함정
- REVIEW → IN_PROGRESS 거절 시 기존 미해결 피드백이 **모두 resolved 처리**됨
- 새 피드백만 `resolved: false`로 추가 — 이전 피드백 참조 시 `feedback_history` 전체 확인 필요
- 피드백 없이 REVIEW → IN_PROGRESS 시도하면 에러 반환

### Task 생성 시 암묵적 동작
- `title`이 비어있으면 `description` 첫 줄에서 자동 추출 (50자 truncate)
- `project_id` 미지정 시 `getCurrentProjectId()`로 현재 프로젝트 자동 할당
- 생성 즉시 `context.md` 템플릿이 자동 생성됨 (requirements 자동 파싱)
- 새 태스크는 항상 `READY` 상태로 생성 (BACKLOG 아님)

### DONE 전환 시 자동 동작
- REVIEW → DONE 시 `handleChangelogGenerate` 자동 호출
- `base_commit`이 있으면 해당 커밋부터 diff 기반 CHANGELOG 생성
- CHANGELOG 생성 실패는 non-blocking (경고만 출력)

### 삭제 규칙
- READY 또는 BACKLOG 상태만 삭제 가능
- IN_PROGRESS/REVIEW/DONE 태스크는 삭제 불가 — 먼저 상태 전이 필요

## Auto-Pipeline (`auto-pipeline.ts`)

- Redis 기반 이벤트 감시로 READY 태스크 자동 감지
- `triggerPipeline(taskId)` — HTTP API에서 수동 트리거 가능
- 파이프라인 에이전트는 `addPipelineAgent/updatePipelineAgent`로 HTTP 캐시에 노출
- Dashboard의 에이전트 목록은 MCP 에이전트 + 파이프라인 워커 합산

## 안티패턴

- registry.json 직접 파일 수정 → 이벤트 발행 누락, 대시보드 동기화 깨짐
- `task.status`를 직접 변경 후 `writeTaskRegistry` → `VALID_TRANSITIONS` 검증 우회
- `publishEvent` 호출 누락 → WebSocket 실시간 업데이트 안 됨
- `createActivity` 누락 → 대시보드 활동 피드 누락
