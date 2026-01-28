# Claude Conductor - 구현 권장 조치

> 작성일: 2025-01-28
> 스펙 vs 구현 비교 검토 결과

---

## 1. 미구현 기능 정리

### Phase 6: 알림 시스템 (미구현)

| 기능 | 스펙 | 우선순위 | 비고 |
|------|------|----------|------|
| Slack Integration | 있음 | 낮음 | 외부 서비스 의존 |
| Discord Integration | 있음 | 낮음 | 외부 서비스 의존 |
| Email Integration | 있음 | 낮음 | SMTP 설정 필요 |
| Webhook Integration | 있음 | 중간 | 범용성 높음 |
| GitHub Integration | 있음 | 중간 | PR/Issue 연동 |
| Linear Integration | 있음 | 낮음 | 특정 툴 의존 |

**권장사항**:
- 현재 시스템은 WebSocket으로 실시간 UI 알림 제공 중
- 외부 알림이 필요한 경우 Webhook부터 구현 권장
- `services/notification/` 디렉토리 활용

---

### Phase 7: 고급 기능 (부분 미구현)

| 기능 | 스펙 | 구현 | 우선순위 | 비고 |
|------|------|------|----------|------|
| Metrics 수집 | 있음 | ❌ | 낮음 | 운영 시 필요 |
| Metrics 집계 | 있음 | ❌ | 낮음 | 운영 시 필요 |
| Backup/Restore | 있음 | ❌ | 중간 | 데이터 안전성 |
| Dashboard Charts | 있음 | ❌ | 낮음 | 시각화 개선 |
| Docusaurus 문서 | 있음 | ❌ | 낮음 | 사용자 가이드 |

**권장사항**:
- Backup/Restore는 `.claude/` 디렉토리 단순 복사로 대체 가능
- 메트릭스는 운영 환경 배포 전 구현 권장
- 차트는 대시보드 고도화 시 추가

---

## 2. 스펙 문서 단순화 제안

### 현재 문제

- Phase 6, 7 스펙이 상세하지만 구현되지 않음
- 실제 구현과 스펙 사이 괴리 존재

### 제안

1. **Phase 1-5**: 현재 스펙 유지 (구현 완료)
2. **Phase 6-7**: "Future Work" 섹션으로 분리
3. **새 문서 작성**: 현재 구현된 기능 기준 "Quick Start" 가이드

---

## 3. 추가 구현 검토 사항

### 현재 구현되었으나 스펙에 없는 기능

| 기능 | 설명 | 스펙 반영 |
|------|------|----------|
| Auto-pipeline | Claude CLI 자동 실행으로 태스크 처리 | 권장 |
| BACKLOG 상태 | 태스크 초기 상태로 추가됨 | 권장 |
| Manual Trigger | 대시보드에서 Run 버튼으로 작업 시작 | 권장 |
| Real-time Pipeline Output | WebSocket으로 AI 작업 출력 스트리밍 | 권장 |
| Pipeline Queue | 동시 실행 제한 (maxConcurrent) | 권장 |

### 권장사항

위 기능들은 스펙 문서에 추가 반영하여 문서-코드 일관성 유지

---

## 4. 우선순위별 액션 플랜

### 즉시 (이번 세션)

- [x] 스펙 문서에 Docker 아키텍처 변경 반영
- [x] BACKLOG 상태 추가 반영
- [x] Auto-pipeline 기능 문서화
- [x] 본 권장 조치 문서 작성

### 단기 (1-2주)

- [ ] Phase 7 Backup/Restore 기능 구현 검토
- [ ] Quick Start 가이드 작성

### 중기 (1개월)

- [ ] Webhook 알림 기능 (필요시)
- [ ] Dashboard Charts (필요시)

### 장기 (필요시)

- [ ] Phase 6 외부 알림 통합
- [ ] Metrics 시스템
- [ ] Docusaurus 문서 사이트

---

## 5. 참고: 현재 구현 MCP 도구 목록 (33개)

### Task 도구 (5개)
- `task_create`, `task_list`, `task_get`, `task_start`, `task_transition`

### Project 도구 (5개)
- `project_create`, `project_list`, `project_select`, `project_get`, `project_delete`

### Server 도구 (7개)
- `server_start`, `server_stop`, `server_status`, `server_logs`, `server_health`, `server_open`, `api_docs`

### Review/Changelog 도구 (2개)
- `review_code`, `changelog_generate`

### Agent/Orchestration 도구 (9개)
- `agent_spawn`, `agent_delegate`, `agent_status`, `agent_collect`, `agent_terminate`
- `agent_list_roles`, `orchestrate`, `orchestrate_review`, `orchestrate_implement`

### MCP Resources (3개)
- `conductor://tasks`, `conductor://servers`, `conductor://changelog`

---

*문서 끝*
