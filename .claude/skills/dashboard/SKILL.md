---
name: dashboard
description: "React 대시보드 구조, WebSocket 실시간 연동, 칸반보드 규칙"
---

# Skill: Dashboard

## 기술 스택
- React 18 + TypeScript + Vite
- 상태관리: Zustand (`store/taskStore.ts`)
- 스타일: Tailwind CSS + `clsx`
- D&D: `@dnd-kit/core` + `@dnd-kit/sortable`
- 아이콘: `lucide-react`
- 마크다운: `react-markdown` + `remark-gfm`

## 실시간 연동 구조

### WebSocket → Zustand 패턴
- Dashboard가 `ws://localhost:3101`에 연결
- Conductor의 Redis pub/sub → WebSocket bridge → Dashboard
- 이벤트 수신 시 Zustand store 업데이트 → React 자동 리렌더

### API 호출 패턴 (`lib/api.ts`)
- REST API (`localhost:3100/api/*`) — CRUD 조작
- WebSocket — 실시간 이벤트 수신 전용 (쓰기 안 함)

## 칸반보드 주의사항

### 컬럼 순서
- BACKLOG → READY → IN_PROGRESS → REVIEW → DONE → CLOSED
- `HiddenColumn` 컴포넌트: hidden 태스크 별도 표시

### D&D 상태 전이
- 카드 드래그 시 `task_transition` API 호출
- `VALID_TRANSITIONS`에 없는 이동은 서버에서 거부 — 프론트에서도 사전 검증 필요
- REVIEW → IN_PROGRESS 드래그 시 피드백 입력 모달 필요

### TaskModal
- 태스크 상세 보기 + 상태 전환 + 피드백 입력
- `context.md` 내용을 마크다운으로 렌더링

## 안티패턴

- Zustand store를 컴포넌트 외부에서 직접 mutate → React 리렌더 누락
- API 호출 후 store 수동 업데이트 + WebSocket 이벤트 중복 처리 → 상태 불일치
- `api.ts`의 baseURL 하드코딩 변경 시 환경별 대응 필요
