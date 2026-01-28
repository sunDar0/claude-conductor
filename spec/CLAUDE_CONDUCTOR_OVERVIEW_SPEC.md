# Claude Conductor - 자동화 개발 지휘 시스템

> Claude Code의 Skills, Plugin, Sub-agent, Custom Commands, MCP, CLAUDE.md를 활용한 자동화 개발 지휘 시스템

---

## 📋 목차

1. [개요](#1-개요)
2. [시스템 아키텍처](#2-시스템-아키텍처)
3. [핵심 기능 명세](#3-핵심-기능-명세)
4. [상태 관리](#4-상태-관리)
5. [Skills 설계](#5-skills-설계)
6. [Custom Commands](#6-custom-commands)
7. [MCP 서버 연동](#7-mcp-서버-연동)
8. [데이터 구조](#8-데이터-구조)
9. [대시보드 UI](#9-대시보드-ui)
10. [구현 로드맵](#10-구현-로드맵)

---

## 1. 개요

### 1.1 프로젝트 목표

Claude Code를 활용하여 개발 작업의 전체 라이프사이클을 자동화하고 지휘하는 시스템 구축

### 1.2 핵심 가치

| 가치 | 설명 |
|------|------|
| **자동화** | 반복적인 개발 작업의 자동 수행 |
| **가시성** | 칸반 보드를 통한 작업 상태 시각화 |
| **추적성** | CHANGELOG를 통한 모든 변경사항 기록 |
| **검증** | 자동화된 코드 리뷰 및 품질 검증 |
| **개발자 경험** | 로컬 서버 자동 실행 및 API 문서 제공 |

### 1.3 대상 사용자

- Claude Code를 활용하는 개발자
- 개인 프로젝트 또는 소규모 팀

---

## 2. 시스템 아키텍처

### 2.1 전체 구조

```
┌─────────────────────────────────────────────────────────────┐
│                     Web Dashboard (4000)                     │
│            칸반 보드 │ CHANGELOG 뷰 │ 서버 상태              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator (MCP Server)                 │
│         상태 관리 │ 작업 큐 │ 이벤트 디스패치 │ Skill 조합    │
└─────────────────────────────────────────────────────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│  Claude   │  │ DevServer │  │  Git/PR   │  │ Changelog │
│ Sub-Agent │  │  Manager  │  │  Manager  │  │  Manager  │
└───────────┘  └───────────┘  └───────────┘  └───────────┘
```

### 2.2 디렉토리 구조

```
project-root/
├── .claude/
│   ├── CLAUDE.md                    # 프로젝트 컨텍스트
│   ├── skills/
│   │   ├── orchestrator/
│   │   │   └── SKILL.md
│   │   ├── task-management/
│   │   │   └── SKILL.md
│   │   ├── code-review/
│   │   │   └── SKILL.md
│   │   ├── changelog/
│   │   │   └── SKILL.md
│   │   ├── dev-server/
│   │   │   └── SKILL.md
│   │   ├── api-docs/
│   │   │   └── SKILL.md
│   │   └── dashboard/
│   │       └── SKILL.md
│   ├── commands/
│   │   ├── task-create.md
│   │   ├── task-start.md
│   │   ├── task-review.md
│   │   ├── task-approve.md
│   │   ├── task-list.md
│   │   └── dashboard.md
│   ├── tasks/
│   │   ├── registry.json            # 태스크 메타데이터
│   │   └── {TASK-ID}/
│   │       ├── context.md           # 작업 컨텍스트
│   │       ├── history.jsonl        # 대화 히스토리
│   │       └── CHANGELOG.md         # 개별 변경 이력
│   ├── servers/
│   │   └── registry.json            # 실행 중인 서버 정보
│   └── mcp.json                     # 프로젝트별 MCP 설정
├── conductor-mcp/                    # Docker 기반 MCP 서버 스택
│   ├── docker-compose.yml           # 프로덕션 구성
│   ├── docker-compose.dev.yml       # 개발 구성
│   ├── .env.example                 # 환경 변수 템플릿
│   ├── scripts/
│   │   ├── register.sh              # MCP 등록 스크립트
│   │   ├── start.sh                 # 스택 시작
│   │   └── stop.sh                  # 스택 종료
│   └── services/
│       ├── conductor/               # 핵심 오케스트레이터
│       │   ├── Dockerfile
│       │   ├── Dockerfile.dev
│       │   ├── package.json
│       │   ├── tsconfig.json
│       │   └── src/
│       │       ├── index.ts
│       │       ├── handlers/
│       │       ├── detectors/
│       │       └── types/
│       ├── dashboard/               # 대시보드 API + UI
│       │   ├── Dockerfile
│       │   ├── package.json
│       │   └── src/
│       ├── git/                     # Git 연동
│       │   ├── Dockerfile
│       │   └── src/
│       └── notification/            # 알림 서비스
│           ├── Dockerfile
│           └── src/
├── CHANGELOG.md                      # 통합 변경 이력 (랜딩 페이지)
└── ... (프로젝트 소스 코드)
```

---

## 3. 핵심 기능 명세

### 3.1 우선순위 기능 목록

| 우선순위 | 기능 | 설명 | 상태 |
|:--------:|------|------|:----:|
| P0 | 태스크 상태 관리 | 5단계 상태 전이 시스템 | 📋 |
| P0 | 칸반 대시보드 | 웹 기반 시각화 보드 | 📋 |
| P0 | CHANGELOG 자동화 | 진행↔검수 변경사항 기록 | 📋 |
| P0 | 로컬 서버 자동 실행 | 검수/완료 시 서버 기동 | 📋 |
| P0 | API 문서 자동화 | Swagger/Redoc 서빙 | 📋 |
| P1 | 컨텍스트 영속성 | 작업별 대화 히스토리 저장 | 📋 |
| P1 | Git 브랜치 연동 | 자동 브랜치 생성/커밋 | 📋 |
| P1 | 자동 검증 파이프라인 | 린트/테스트 자동 실행 | 📋 |
| P2 | 알림 시스템 | 검수 필요 시 알림 | 📋 |
| P2 | 작업 분해 | 서브태스크 자동 생성 | 📋 |
| P2 | 롤백 메커니즘 | 상태별 스냅샷 및 복원 | 📋 |
| P3 | 멀티 프로젝트 관리 | 프로젝트 간 전환 | 📋 |
| P3 | 메트릭스 수집 | 작업 시간/성공률 분석 | 📋 |

### 3.2 기능 상세

#### 3.2.1 프로젝트 선택 및 작업 조회

- 프로젝트 디렉토리 진입 시 자동으로 `.claude/tasks/registry.json` 로드
- 상태별(준비/진행/검수/완료/종료) 카드 형태로 시각화
- 각 카드에 표시될 정보:
  - 태스크 ID 및 제목
  - 현재 상태 및 우선순위
  - 생성/수정 일시
  - 담당 브랜치

#### 3.2.2 상태 전이 규칙

```
준비(READY) ──[시작 명령]──▶ 진행(IN_PROGRESS)
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              [코드 완성 +                    [작업 취소]
               테스트 통과]                         │
                    │                               ▼
                    ▼                           취소(CANCELLED)
             검수(REVIEW)
                    │
        ┌───────────┼───────────┐
        │           │           │
   [피드백 반영   [승인]    [반려]
      필요]         │           │
        │           ▼           │
        │      완료(DONE)       │
        │           │           │
        │     [최종 확인]       │
        │           │           │
        │           ▼           │
        │      종료(CLOSED)     │
        │                       │
        └───────────────────────┘
                (루프)
```

#### 3.2.3 CHANGELOG 적재

- **트리거**: 진행(IN_PROGRESS) ↔ 검수(REVIEW) 전환 시
- **감지 항목**:
  - Git diff 기반 파일 변경
  - 함수/클래스/API 엔드포인트 변경
  - 의존성 변경
- **저장 위치**:
  - 개별: `.claude/tasks/{TASK-ID}/CHANGELOG.md`
  - 통합: 프로젝트 루트 `CHANGELOG.md`

#### 3.2.4 검수/완료 단계 서버 실행

| 프로젝트 유형 | 감지 조건 | 서버 명령 | API 문서 |
|--------------|----------|----------|----------|
| Next.js | `next.config.js` 존재 | `npm run dev` | - |
| Vite | `vite.config.ts` 존재 | `npm run dev` | - |
| Express + OpenAPI | `express` + `swagger-ui-express` | `npm run start:dev` | `/api-docs`, `/redoc` |
| FastAPI | `main.py` + `fastapi` | `uvicorn main:app --reload` | `/docs`, `/redoc` |
| NestJS | `@nestjs/core` | `npm run start:dev` | `/api` |
| Spring Boot | `pom.xml` or `build.gradle` | `./gradlew bootRun` | `/swagger-ui` |
| Go + Gin | `go.mod` + `github.com/gin-gonic/gin` | `go run main.go` 또는 `air` | `/swagger/*` (swaggo) |

---

## 4. 상태 관리

### 4.1 태스크 상태 정의

| 상태 | 코드 | 설명 | 진입 조건 | 퇴장 조건 |
|------|------|------|----------|----------|
| 준비 | `READY` | 작업 생성됨, 시작 대기 | 태스크 생성 | 시작 명령 |
| 진행 | `IN_PROGRESS` | Claude가 작업 수행 중 | 시작 명령 또는 피드백 반영 | 코드 완성 + 검증 통과 |
| 검수 | `REVIEW` | 개발자 확인 대기 | 자동 검증 통과 | 승인/반려/피드백 |
| 완료 | `DONE` | 개발자 승인 완료 | 검수 승인 | 최종 확인 |
| 종료 | `CLOSED` | 작업 완전 종료 | 최종 확인 | - |
| 취소 | `CANCELLED` | 작업 취소됨 | 취소 명령 | - |

### 4.2 상태 전이 이벤트

```typescript
interface StateTransitionEvent {
  task_id: string;
  from_state: TaskState;
  to_state: TaskState;
  triggered_by: 'system' | 'developer';
  timestamp: string;
  metadata: {
    reason?: string;
    feedback?: string;
    changelog_version?: number;
  };
}
```

### 4.3 상태 전이 시 자동 실행 액션

| 전이 | 자동 액션 |
|------|----------|
| `READY → IN_PROGRESS` | 브랜치 생성, 컨텍스트 로드 |
| `IN_PROGRESS → REVIEW` | 테스트 실행, CHANGELOG 생성, 서버 시작, API 문서 생성 |
| `REVIEW → IN_PROGRESS` | 피드백 기록, 서버 유지 |
| `REVIEW → DONE` | 서버 유지, PR 생성 준비 |
| `DONE → CLOSED` | 서버 종료, 브랜치 머지 준비, 최종 CHANGELOG 확정 |

---

## 5. Skills 설계

### 5.1 Orchestrator Skill

**파일**: `.claude/skills/orchestrator/SKILL.md`

```markdown
# Orchestrator Skill

## 역할
전체 자동화 개발 지휘 시스템의 핵심 조율자

## 책임
1. 작업 흐름 전체 관리
2. Sub-agent 호출 결정
3. 상태 전이 검증 및 실행
4. 다른 Skill 조합 및 실행 순서 결정
5. 에러 핸들링 및 복구

## 의존 Skills
- task-management: 태스크 CRUD
- code-review: 코드 검증
- changelog: 변경 이력 관리
- dev-server: 로컬 서버 관리
- api-docs: API 문서 생성
- dashboard: 대시보드 서빙

## 워크플로우 예시

### 태스크 시작 플로우
1. task-management.load(task_id)
2. git.create_branch(task_id)
3. context.load(task_id)
4. state.transition(READY → IN_PROGRESS)
5. 실제 개발 작업 수행

### 검수 진입 플로우
1. code-review.run_all_checks()
2. IF 통과:
   a. changelog.generate()
   b. dev-server.start()
   c. api-docs.generate() (API 프로젝트인 경우)
   d. state.transition(IN_PROGRESS → REVIEW)
   e. dashboard.notify()
3. IF 실패:
   a. 실패 사유 리포트
   b. 자동 수정 시도 또는 개발자 개입 요청

## 상태 머신 정의
| 현재 상태 | 이벤트 | 다음 상태 | 가드 조건 |
|----------|--------|----------|----------|
| READY | START | IN_PROGRESS | - |
| IN_PROGRESS | COMPLETE | REVIEW | 테스트 통과 |
| IN_PROGRESS | CANCEL | CANCELLED | - |
| REVIEW | APPROVE | DONE | - |
| REVIEW | REJECT | IN_PROGRESS | 피드백 존재 |
| REVIEW | REQUEST_CHANGE | IN_PROGRESS | 피드백 존재 |
| DONE | CONFIRM | CLOSED | - |

## 에러 처리
- 테스트 실패: 자동 수정 3회 시도 후 개발자 개입 요청
- 서버 시작 실패: 포트 충돌 해결 시도, 실패 시 수동 실행 안내
- Git 충돌: 충돌 내용 표시 후 개발자 결정 요청
```

### 5.2 Task Management Skill

**파일**: `.claude/skills/task-management/SKILL.md`

```markdown
# Task Management Skill

## 역할
태스크의 생성, 조회, 수정, 삭제 및 상태 관리

## 데이터 스키마

### Task
| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 고유 식별자 (TASK-XXX) |
| title | string | 태스크 제목 |
| description | string | 상세 설명 |
| status | TaskState | 현재 상태 |
| priority | 'critical' \| 'high' \| 'medium' \| 'low' | 우선순위 |
| created_at | ISO8601 | 생성 일시 |
| updated_at | ISO8601 | 수정 일시 |
| started_at | ISO8601? | 시작 일시 |
| completed_at | ISO8601? | 완료 일시 |
| branch | string? | 연결된 Git 브랜치 |
| context_file | string | 컨텍스트 파일 경로 |
| changelog_versions | number[] | CHANGELOG 버전 목록 |
| feedback_history | Feedback[] | 피드백 이력 |
| metadata | object | 추가 메타데이터 |

### Feedback
| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 피드백 ID |
| content | string | 피드백 내용 |
| created_at | ISO8601 | 생성 일시 |
| resolved | boolean | 해결 여부 |
| resolved_at | ISO8601? | 해결 일시 |

## 명령어

### task:create
새 태스크 생성
- 입력: title, description?, priority?
- 출력: Task 객체
- 부수효과: registry.json 업데이트, context.md 생성

### task:list
태스크 목록 조회
- 입력: status?, priority?
- 출력: Task[]

### task:get
단일 태스크 조회
- 입력: task_id
- 출력: Task

### task:update
태스크 정보 수정
- 입력: task_id, updates
- 출력: Task

### task:transition
상태 전이
- 입력: task_id, target_state, metadata?
- 출력: StateTransitionEvent
- 가드: Orchestrator의 상태 머신 규칙 적용

### task:delete
태스크 삭제 (READY 또는 CANCELLED 상태만)
- 입력: task_id
- 출력: boolean

## 저장소

### registry.json 구조
{
  "tasks": {
    "TASK-001": { ... },
    "TASK-002": { ... }
  },
  "counter": 2,
  "version": "1.0.0"
}

### 개별 태스크 디렉토리
.claude/tasks/{TASK-ID}/
├── context.md      # 작업 컨텍스트 (목표, 요구사항, 결정사항)
├── history.jsonl   # Claude 대화 히스토리
└── CHANGELOG.md    # 변경 이력
```

### 5.3 Code Review Skill

**파일**: `.claude/skills/code-review/SKILL.md`

```markdown
# Code Review Skill

## 역할
검수 단계 진입 전 코드 품질 자동 검증

## 검증 체크리스트

### 필수 검증 (통과 필수)
1. **린트 검사**
   - ESLint, Prettier (JS/TS)
   - Pylint, Black (Python)
   - 프로젝트 설정 자동 감지

2. **타입 검사**
   - TypeScript: `tsc --noEmit`
   - Python: `mypy` (설정 존재 시)

3. **테스트 실행**
   - 단위 테스트 전체 실행
   - 최소 커버리지 기준 확인 (기본: 70%)

4. **빌드 검증**
   - 프로덕션 빌드 성공 여부

### 권장 검증 (경고만)
5. **보안 취약점 스캔**
   - `npm audit` / `pip-audit`
   - 의존성 취약점 확인

6. **코드 복잡도**
   - 순환 복잡도 체크
   - 함수 길이 체크

7. **문서화**
   - 공개 API 문서화 여부
   - README 업데이트 여부

## 검증 실행 명령

### JavaScript/TypeScript 프로젝트
npm run lint
npm run type-check  # 또는 tsc --noEmit
npm run test -- --coverage
npm run build
npm audit

### Python 프로젝트
ruff check .  # 또는 pylint
mypy .
pytest --cov
pip-audit

## 리포트 포맷

### Review Summary - {TASK-ID}

**검증 일시**: {timestamp}
**검증 결과**: ✅ 통과 / ❌ 실패

#### 필수 검증
| 항목 | 결과 | 상세 |
|------|------|------|
| 린트 | ✅/❌ | {상세 메시지} |
| 타입 체크 | ✅/❌ | {상세 메시지} |
| 테스트 | ✅/❌ | 커버리지: {n}% |
| 빌드 | ✅/❌ | {상세 메시지} |

#### 권장 검증
| 항목 | 결과 | 상세 |
|------|------|------|
| 보안 | ⚠️/✅ | {취약점 수} |
| 복잡도 | ⚠️/✅ | {이슈 수} |

#### 수정 필요 사항
- `{파일}:{라인}` - {이슈 설명}

#### 개선 제안
- {제안 내용}

## 자동 수정 시도
- 린트 오류: `--fix` 옵션으로 자동 수정 시도
- 포맷팅: Prettier/Black 자동 적용
- 간단한 타입 오류: 자동 수정 시도

## 설정 오버라이드
.claude/skills/code-review/config.json
{
  "min_coverage": 70,
  "max_complexity": 10,
  "skip_security": false,
  "custom_lint_command": null,
  "custom_test_command": null
}
```

### 5.4 Changelog Skill

**파일**: `.claude/skills/changelog/SKILL.md`

```markdown
# Changelog Skill

## 역할
진행 ↔ 검수 간 변경사항 자동 감지 및 기록

## 변경 감지 방법

### 1. Git Diff 분석
git diff {from_commit} {to_commit} --stat
git diff {from_commit} {to_commit} --name-status

### 2. AST 분석 (선택적)
- 함수/클래스 추가/수정/삭제 감지
- API 엔드포인트 변경 감지
- 의존성 변경 감지

## CHANGELOG 포맷 (Keep a Changelog 기반)

# Changelog - {TASK-ID}: {TASK-TITLE}

## [v{n}] - {date} ({from_state} → {to_state})

### Added
- 새로 추가된 기능

### Changed
- 기존 기능의 변경사항

### Deprecated
- 곧 삭제될 기능

### Removed
- 삭제된 기능

### Fixed
- 버그 수정

### Security
- 보안 관련 수정

---

**변경 파일 목록**
| 파일 | 상태 | 변경 라인 |
|------|------|----------|
| src/api/login.ts | Modified | +45 / -12 |
| src/utils/auth.ts | Added | +120 |

## 통합 CHANGELOG

프로젝트 루트의 `CHANGELOG.md`는 모든 태스크의 변경사항을 통합

# Project Changelog

## [{version}] - {date}

### TASK-001: 로그인 API 구현
- Added: POST /api/auth/login 엔드포인트
- Added: JWT 토큰 발급 로직

### TASK-002: 회원가입 기능
- Added: POST /api/auth/register 엔드포인트
- Added: 이메일 인증 플로우

## 자동 버전 관리
- 각 검수 진입 시 버전 자동 증가 (v1, v2, v3...)
- 통합 CHANGELOG는 Semantic Versioning 권장

## 저장 위치
- 개별: .claude/tasks/{TASK-ID}/CHANGELOG.md
- 통합: ./CHANGELOG.md

## 트리거
- IN_PROGRESS → REVIEW: 새 버전 생성
- REVIEW → IN_PROGRESS: 피드백 반영 기록
- DONE → CLOSED: 최종 확정 마킹
```

### 5.5 Dev Server Skill

**파일**: `.claude/skills/dev-server/SKILL.md`

```markdown
# Dev Server Skill

## 역할
검수/완료 단계에서 로컬 개발 서버 자동 관리

## 서버 유형 감지

### 감지 로직
1. package.json 확인 (Node.js 프로젝트)
2. requirements.txt / pyproject.toml 확인 (Python)
3. pom.xml / build.gradle 확인 (Java)
4. 프레임워크별 설정 파일 확인

### 지원 프레임워크
| 프레임워크 | 감지 조건 | 기본 포트 | 시작 명령 |
|-----------|----------|----------|----------|
| Next.js | next.config.* | 3000 | npm run dev |
| Vite | vite.config.* | 5173 | npm run dev |
| Create React App | react-scripts | 3000 | npm start |
| Express | express in deps | 3000 | npm run start:dev |
| NestJS | @nestjs/core | 3000 | npm run start:dev |
| FastAPI | fastapi in deps | 8000 | uvicorn main:app --reload |
| Django | django in deps | 8000 | python manage.py runserver |
| Flask | flask in deps | 5000 | flask run |
| Spring Boot | spring-boot | 8080 | ./gradlew bootRun |
| Go + Gin | gin-gonic/gin in go.mod | 8080 | go run main.go 또는 air |

## 서버 레지스트리

### .claude/servers/registry.json
{
  "servers": {
    "TASK-001": {
      "task_id": "TASK-001",
      "server_type": "express",
      "port": 3000,
      "pid": 12345,
      "status": "running",
      "started_at": "2025-01-27T14:00:00Z",
      "url": "http://localhost:3000",
      "api_docs_url": "http://localhost:3000/api-docs"
    }
  }
}

## 포트 충돌 처리
1. 기본 포트 사용 시도
2. 충돌 시 다음 포트 시도 (3001, 3002...)
3. 5회 실패 시 개발자에게 포트 지정 요청

## 서버 생명주기

### 시작 트리거
- IN_PROGRESS → REVIEW 전이 시

### 유지 조건
- REVIEW 상태 유지
- REVIEW → DONE 전이 후에도 유지

### 종료 트리거
- DONE → CLOSED 전이 시
- 명시적 종료 명령
- 태스크 취소 시

## 명령어
- server:start {task_id} - 서버 시작
- server:stop {task_id} - 서버 종료
- server:restart {task_id} - 서버 재시작
- server:status - 전체 서버 상태 조회
- server:logs {task_id} - 서버 로그 스트리밍
```

### 5.6 API Docs Skill

**파일**: `.claude/skills/api-docs/SKILL.md`

```markdown
# API Docs Skill

## 역할
API 프로젝트의 문서 자동 생성 및 서빙

## 지원 도구

| 프레임워크 | 문서 도구 | 설정 방법 |
|-----------|----------|----------|
| Express | swagger-ui-express + swagger-jsdoc | 자동 설정 주입 |
| Express | redoc-express | 자동 설정 주입 |
| FastAPI | 내장 | 자동 (기본 제공) |
| NestJS | @nestjs/swagger | 자동 설정 주입 |
| Spring Boot | springdoc-openapi | build.gradle 수정 |
| Go + Gin | swaggo/swag + gin-swagger | swag init 실행 |

## OpenAPI 스펙 생성

### 자동 감지
1. 기존 openapi.json / openapi.yaml 확인
2. JSDoc/데코레이터 기반 자동 생성
3. 라우트 분석을 통한 스키마 추론

### 스펙 저장 위치
- ./docs/openapi.json
- ./docs/openapi.yaml

## 문서 엔드포인트 설정

### Express 예시
// 자동 주입되는 코드
const swaggerUi = require('swagger-ui-express');
const redoc = require('redoc-express');
const swaggerDocument = require('./docs/openapi.json');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get('/redoc', redoc({ specUrl: '/api-docs.json' }));
app.get('/api-docs.json', (req, res) => res.json(swaggerDocument));

## 출력 메시지

📚 API 문서가 준비되었습니다:

| 문서 유형 | URL |
|----------|-----|
| Swagger UI | http://localhost:{port}/api-docs |
| Redoc | http://localhost:{port}/redoc |
| OpenAPI JSON | http://localhost:{port}/api-docs.json |

## 문서 자동 업데이트
- 코드 변경 감지 시 OpenAPI 스펙 재생성
- Hot reload 지원 (가능한 경우)
```

### 5.7 Dashboard Skill

**파일**: `.claude/skills/dashboard/SKILL.md`

```markdown
# Dashboard Skill

## 역할
웹 기반 칸반 대시보드 및 CHANGELOG 뷰어 제공

## 기능

### 1. 칸반 보드
- 5개 컬럼: 준비 | 진행 | 검수 | 완료 | 종료
- 각 카드 표시 정보:
  - 태스크 ID, 제목
  - 우선순위 뱃지
  - 생성/수정 시간
  - 브랜치명
- 카드 클릭 시 상세 패널 열림
- 실시간 상태 업데이트 (WebSocket)

### 2. 태스크 상세 패널
- 기본 정보
- 컨텍스트 요약
- 피드백 히스토리
- 개별 CHANGELOG
- 연결된 서버 정보 및 링크

### 3. 통합 CHANGELOG 뷰
- 전체 프로젝트 변경 이력
- 필터링: 날짜, 태스크, 변경 타입
- 검색 기능
- 마크다운 렌더링

### 4. 서버 상태 패널
- 실행 중인 서버 목록
- 서버별 상태 (running/stopped/error)
- 원클릭 URL 접속
- 로그 스트리밍 뷰

## 기술 스택
- Vite + React (또는 순수 HTML/JS/CSS)
- WebSocket (실시간 업데이트)
- 로컬 JSON 파일 기반 데이터

## 대시보드 서버
- 기본 포트: 4000
- 시작 명령: /project:dashboard
- 자동 브라우저 열기 옵션

## UI 목업

┌─────────────────────────────────────────────────────────────┐
│  🎯 Claude Conductor                    [CHANGELOG] [서버]  │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────┬─────────┬─────────┬─────────┬─────────┐        │
│ │  준비   │  진행   │  검수   │  완료   │  종료   │        │
│ │  (2)    │  (1)    │  (1)    │  (0)    │  (3)    │        │
│ ├─────────┼─────────┼─────────┼─────────┼─────────┤        │
│ │┌───────┐│┌───────┐│┌───────┐│         │┌───────┐│        │
│ ││TASK-04││││TASK-01││││TASK-03││         │││TASK-02│││        │
│ ││로그아웃││││로그인 ││││회원가입│││         │││설정   ││        │
│ ││🟡 Med ││││🔴 High│││🔴 High││         │││🟢 Done│││        │
│ │└───────┘│└───────┘│└───────┘│         │└───────┘│        │
│ │┌───────┐│         │         │         │┌───────┐│        │
│ ││TASK-05││         │         │         ││TASK-06││        │
│ ││...    ││         │         │         ││...    ││        │
│ │└───────┘│         │         │         │└───────┘│        │
│ └─────────┴─────────┴─────────┴─────────┴─────────┘        │
└─────────────────────────────────────────────────────────────┘

## 파일 구조
.claude/dashboard/
├── index.html
├── src/
│   ├── main.js
│   ├── components/
│   │   ├── KanbanBoard.js
│   │   ├── TaskCard.js
│   │   ├── TaskDetail.js
│   │   ├── ChangelogView.js
│   │   └── ServerStatus.js
│   └── styles/
│       └── main.css
├── package.json
└── vite.config.js
```

---

## 6. Custom Commands

### 6.1 명령어 목록

| 명령어 | 파일 | 설명 |
|--------|------|------|
| `/project:task-create` | task-create.md | 새 태스크 생성 |
| `/project:task-start` | task-start.md | 태스크 시작 (READY → IN_PROGRESS) |
| `/project:task-list` | task-list.md | 태스크 목록 조회 |
| `/project:task-review` | task-review.md | 검수 요청 (IN_PROGRESS → REVIEW) |
| `/project:task-approve` | task-approve.md | 검수 승인 (REVIEW → DONE) |
| `/project:task-reject` | task-reject.md | 검수 반려 (REVIEW → IN_PROGRESS) |
| `/project:task-complete` | task-complete.md | 최종 완료 (DONE → CLOSED) |
| `/project:dashboard` | dashboard.md | 대시보드 실행 |
| `/project:changelog` | changelog.md | CHANGELOG 조회 |
| `/project:server-status` | server-status.md | 서버 상태 조회 |

### 6.2 명령어 상세

#### /project:task-create

**파일**: `.claude/commands/task-create.md`

```markdown
# Task Create Command

새로운 개발 태스크를 생성합니다.

## 사용법
/project:task-create "태스크 제목" [--priority high|medium|low] [--description "설명"]

## 예시
/project:task-create "로그인 API 구현" --priority high
/project:task-create "버그 수정: 회원가입 오류" --priority critical --description "이메일 중복 체크 실패"

## 실행 흐름
1. task-management skill의 task:create 호출
2. 고유 ID 생성 (TASK-XXX)
3. 컨텍스트 파일 생성
4. registry.json 업데이트
5. 생성 결과 출력

## 출력 예시
✅ 태스크 생성 완료

| 항목 | 값 |
|------|-----|
| ID | TASK-007 |
| 제목 | 로그인 API 구현 |
| 우선순위 | 🔴 High |
| 상태 | 📋 준비 |
| 컨텍스트 | .claude/tasks/TASK-007/context.md |

시작하려면: /project:task-start TASK-007
```

#### /project:task-start

**파일**: `.claude/commands/task-start.md`

```markdown
# Task Start Command

태스크 작업을 시작합니다.

## 사용법
/project:task-start {TASK-ID}

## 예시
/project:task-start TASK-007

## 실행 흐름
1. 태스크 존재 및 상태 확인 (READY 상태여야 함)
2. Git 브랜치 생성 (feature/{TASK-ID})
3. 컨텍스트 파일 로드
4. 상태 전이 (READY → IN_PROGRESS)
5. 개발 작업 시작

## 전제 조건
- 태스크가 READY 상태여야 함
- Git 워킹 트리가 깨끗해야 함

## 출력 예시
🚀 태스크 시작: TASK-007 - 로그인 API 구현

📁 브랜치 생성: feature/TASK-007
📄 컨텍스트 로드 완료

작업을 시작합니다. 완료되면 자동으로 검수 단계로 전환됩니다.
```

#### /project:dashboard

**파일**: `.claude/commands/dashboard.md`

```markdown
# Dashboard Command

웹 기반 대시보드를 실행합니다.

## 사용법
/project:dashboard [--port 4000]

## 예시
/project:dashboard
/project:dashboard --port 8080

## 실행 흐름
1. 대시보드 의존성 확인 및 설치
2. 대시보드 서버 시작
3. 브라우저 자동 열기 (선택)

## 대시보드 기능
- 칸반 보드: 상태별 태스크 시각화
- CHANGELOG 뷰: 통합 변경 이력
- 서버 상태: 실행 중인 서버 모니터링

## 출력 예시
🎯 Claude Conductor 대시보드

| 항목 | URL |
|------|-----|
| 대시보드 | http://localhost:4000 |
| 칸반 보드 | http://localhost:4000/#/board |
| CHANGELOG | http://localhost:4000/#/changelog |
| 서버 상태 | http://localhost:4000/#/servers |

브라우저에서 열기: [Y/n]
```

---

## 7. MCP 서버 연동

### 7.1 Docker 기반 MCP 인프라 아키텍처

**목적**: 컨테이너화된 MCP 서버들로 확장성과 관리 용이성 확보

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Docker Compose Stack                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │  conductor-mcp  │  │  dashboard-mcp  │  │   git-mcp       │     │
│  │     :3100       │  │     :3101       │  │    :3102        │     │
│  │  (Orchestrator) │  │  (Dashboard API)│  │  (Git 연동)     │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                    │               │
│           └────────────────────┼────────────────────┘               │
│                                │                                     │
│                    ┌───────────┴───────────┐                        │
│                    │     Redis (Queue)      │                        │
│                    │        :6379           │                        │
│                    └───────────┬───────────┘                        │
│                                │                                     │
│                    ┌───────────┴───────────┐                        │
│                    │   Shared Volume        │                        │
│                    │  /data/conductor       │                        │
│                    └───────────────────────┘                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌───────────────────────┐
                    │     Claude Code       │
                    │   (MCP Client)        │
                    └───────────────────────┘
```

### 7.2 Docker Compose 구성

**파일**: `conductor-mcp/docker-compose.yml`

```yaml
version: '3.8'

services:
  # 핵심 오케스트레이터 MCP 서버
  conductor-mcp:
    build:
      context: ./services/conductor
      dockerfile: Dockerfile
    container_name: conductor-mcp
    ports:
      - "3100:3100"
    volumes:
      - conductor-data:/data/conductor
      - ${PROJECT_ROOT:-.}:/workspace:ro
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - DATA_DIR=/data/conductor
      - WORKSPACE_DIR=/workspace
    depends_on:
      - redis
    restart: unless-stopped
    networks:
      - conductor-network

  # 대시보드 API 서버
  dashboard-mcp:
    build:
      context: ./services/dashboard
      dockerfile: Dockerfile
    container_name: dashboard-mcp
    ports:
      - "3101:3101"
      - "4000:4000"  # 대시보드 웹 UI
    volumes:
      - conductor-data:/data/conductor:ro
    environment:
      - NODE_ENV=production
      - CONDUCTOR_URL=http://conductor-mcp:3100
      - DASHBOARD_PORT=4000
    depends_on:
      - conductor-mcp
    restart: unless-stopped
    networks:
      - conductor-network

  # Git 연동 MCP 서버
  git-mcp:
    build:
      context: ./services/git
      dockerfile: Dockerfile
    container_name: git-mcp
    ports:
      - "3102:3102"
    volumes:
      - ${PROJECT_ROOT:-.}:/workspace
      - ~/.ssh:/root/.ssh:ro
      - ~/.gitconfig:/root/.gitconfig:ro
    environment:
      - CONDUCTOR_URL=http://conductor-mcp:3100
    depends_on:
      - conductor-mcp
    restart: unless-stopped
    networks:
      - conductor-network

  # 알림 서비스 MCP 서버
  notification-mcp:
    build:
      context: ./services/notification
      dockerfile: Dockerfile
    container_name: notification-mcp
    ports:
      - "3103:3103"
    environment:
      - SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL:-}
      - DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL:-}
      - CONDUCTOR_URL=http://conductor-mcp:3100
    depends_on:
      - conductor-mcp
    restart: unless-stopped
    networks:
      - conductor-network

  # Redis - 이벤트 큐 및 캐시
  redis:
    image: redis:7-alpine
    container_name: conductor-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    restart: unless-stopped
    networks:
      - conductor-network

volumes:
  conductor-data:
    driver: local
  redis-data:
    driver: local

networks:
  conductor-network:
    driver: bridge
```

### 7.3 MCP 서버 개별 구성

#### 7.3.1 Conductor MCP Server (핵심)

**파일**: `conductor-mcp/services/conductor/Dockerfile`

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 의존성 설치
COPY package*.json ./
RUN npm ci --only=production

# 소스 복사
COPY src/ ./src/
COPY tsconfig.json ./

# 빌드
RUN npm run build

EXPOSE 3100

CMD ["node", "dist/index.js"]
```

**파일**: `conductor-mcp/services/conductor/src/index.ts`

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

const server = new Server({
  name: "claude-conductor",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
    resources: {},
  },
});

// ===== TOOLS =====

server.setRequestHandler("tools/list", async () => ({
  tools: [
    // Task 관리
    {
      name: "task_create",
      description: "새 태스크 생성",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "태스크 제목" },
          description: { type: "string", description: "상세 설명" },
          priority: { 
            type: "string", 
            enum: ["critical", "high", "medium", "low"],
            default: "medium"
          },
        },
        required: ["title"],
      },
    },
    {
      name: "task_start",
      description: "태스크 시작 (READY → IN_PROGRESS)",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
        },
        required: ["task_id"],
      },
    },
    {
      name: "task_transition",
      description: "태스크 상태 전이",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          target_state: { 
            type: "string",
            enum: ["READY", "IN_PROGRESS", "REVIEW", "DONE", "CLOSED", "CANCELLED"]
          },
          feedback: { type: "string", description: "피드백 (반려 시)" },
        },
        required: ["task_id", "target_state"],
      },
    },
    {
      name: "task_list",
      description: "태스크 목록 조회",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "필터할 상태" },
          priority: { type: "string", description: "필터할 우선순위" },
        },
      },
    },
    
    // 서버 관리
    {
      name: "server_start",
      description: "개발 서버 시작",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          port: { type: "number", description: "커스텀 포트 (선택)" },
        },
        required: ["task_id"],
      },
    },
    {
      name: "server_stop",
      description: "개발 서버 종료",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
        },
        required: ["task_id"],
      },
    },
    {
      name: "server_status",
      description: "실행 중인 서버 상태 조회",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },

    // Changelog
    {
      name: "changelog_generate",
      description: "CHANGELOG 생성",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          from_commit: { type: "string" },
          to_commit: { type: "string", default: "HEAD" },
        },
        required: ["task_id"],
      },
    },

    // 대시보드
    {
      name: "dashboard_open",
      description: "대시보드 열기",
      inputSchema: {
        type: "object",
        properties: {
          port: { type: "number", default: 4000 },
        },
      },
    },
  ],
}));

// Tool 실행 핸들러
server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case "task_create":
      return await handleTaskCreate(args);
    case "task_start":
      return await handleTaskStart(args);
    case "task_transition":
      return await handleTaskTransition(args);
    // ... 기타 핸들러
  }
});

// ===== RESOURCES =====

server.setRequestHandler("resources/list", async () => ({
  resources: [
    {
      uri: "conductor://tasks",
      name: "All Tasks",
      description: "전체 태스크 목록",
      mimeType: "application/json",
    },
    {
      uri: "conductor://tasks/{task_id}",
      name: "Task Detail",
      description: "개별 태스크 상세",
      mimeType: "application/json",
    },
    {
      uri: "conductor://changelog",
      name: "Project Changelog",
      description: "통합 CHANGELOG",
      mimeType: "text/markdown",
    },
    {
      uri: "conductor://changelog/{task_id}",
      name: "Task Changelog",
      description: "태스크별 CHANGELOG",
      mimeType: "text/markdown",
    },
    {
      uri: "conductor://servers",
      name: "Running Servers",
      description: "실행 중인 서버 목록",
      mimeType: "application/json",
    },
    {
      uri: "conductor://dashboard",
      name: "Dashboard Status",
      description: "대시보드 상태",
      mimeType: "application/json",
    },
  ],
}));

// Resource 읽기 핸들러
server.setRequestHandler("resources/read", async (request) => {
  const { uri } = request.params;
  // URI 파싱 및 데이터 반환
  // ...
});

// ===== EVENT PUBLISHING (Redis) =====

async function publishEvent(event: string, data: any) {
  await redis.publish("conductor:events", JSON.stringify({
    event,
    data,
    timestamp: new Date().toISOString(),
  }));
}

// 서버 시작
const transport = new StdioServerTransport();
await server.connect(transport);
```

#### 7.3.2 Go + Gin 감지 로직 추가

**파일**: `conductor-mcp/services/conductor/src/detectors/go-gin.ts`

```typescript
import { ProjectDetector, ServerConfig } from "../types";
import * as fs from "fs";
import * as path from "path";

export const goGinDetector: ProjectDetector = {
  name: "go-gin",
  
  async detect(workspacePath: string): Promise<boolean> {
    const goModPath = path.join(workspacePath, "go.mod");
    
    if (!fs.existsSync(goModPath)) {
      return false;
    }
    
    const goModContent = fs.readFileSync(goModPath, "utf-8");
    return goModContent.includes("github.com/gin-gonic/gin");
  },
  
  async getServerConfig(workspacePath: string): Promise<ServerConfig> {
    // air (hot reload) 사용 가능 여부 확인
    const airConfigExists = fs.existsSync(path.join(workspacePath, ".air.toml"));
    
    return {
      type: "go-gin",
      port: 8080,
      command: airConfigExists ? "air" : "go run main.go",
      healthCheck: "/health",
      apiDocs: {
        swagger: "/swagger/index.html",
        openapi_json: "/swagger/doc.json",
      },
      env: {
        GIN_MODE: "debug",
      },
    };
  },
};
```

### 7.4 Claude Code에 MCP 서버 등록

#### 7.4.1 Docker 기반 등록 스크립트

**파일**: `conductor-mcp/scripts/register.sh`

```bash
#!/bin/bash

# Docker Compose 시작
docker-compose up -d

# MCP 서버들을 Claude Code에 등록
echo "Registering MCP servers to Claude Code..."

# Conductor MCP (핵심)
claude mcp add conductor \
  --transport http \
  --url http://localhost:3100/mcp

# Dashboard MCP
claude mcp add conductor-dashboard \
  --transport http \
  --url http://localhost:3101/mcp

# Git MCP
claude mcp add conductor-git \
  --transport http \
  --url http://localhost:3102/mcp

# Notification MCP
claude mcp add conductor-notify \
  --transport http \
  --url http://localhost:3103/mcp

echo "✅ All MCP servers registered successfully!"
echo ""
echo "Available commands:"
echo "  - Task management: task_create, task_start, task_list, task_transition"
echo "  - Server management: server_start, server_stop, server_status"
echo "  - Changelog: changelog_generate"
echo "  - Dashboard: dashboard_open"
echo ""
echo "Dashboard URL: http://localhost:4000"
```

#### 7.4.2 설정 파일 방식

**파일**: `~/.claude/mcp_servers.json` (또는 프로젝트별 `.claude/mcp.json`)

```json
{
  "mcpServers": {
    "conductor": {
      "transport": "http",
      "url": "http://localhost:3100/mcp",
      "description": "Claude Conductor - 핵심 오케스트레이터"
    },
    "conductor-dashboard": {
      "transport": "http", 
      "url": "http://localhost:3101/mcp",
      "description": "Claude Conductor - 대시보드 API"
    },
    "conductor-git": {
      "transport": "http",
      "url": "http://localhost:3102/mcp",
      "description": "Claude Conductor - Git 연동"
    },
    "conductor-notify": {
      "transport": "http",
      "url": "http://localhost:3103/mcp",
      "description": "Claude Conductor - 알림 서비스"
    }
  }
}
```

### 7.5 Docker 관리 명령어

| 명령어 | 설명 |
|--------|------|
| `docker-compose up -d` | 전체 스택 시작 |
| `docker-compose down` | 전체 스택 종료 |
| `docker-compose logs -f conductor-mcp` | Conductor 로그 확인 |
| `docker-compose restart conductor-mcp` | Conductor 재시작 |
| `docker-compose ps` | 컨테이너 상태 확인 |
| `docker-compose exec conductor-mcp sh` | 컨테이너 접속 |

### 7.6 개발 환경 vs 프로덕션 환경

#### 개발 환경 (docker-compose.dev.yml)

```yaml
version: '3.8'

services:
  conductor-mcp:
    build:
      context: ./services/conductor
      dockerfile: Dockerfile.dev
    volumes:
      - ./services/conductor/src:/app/src  # 소스 마운트 (Hot Reload)
      - conductor-data:/data/conductor
      - ${PROJECT_ROOT:-.}:/workspace:ro
    environment:
      - NODE_ENV=development
    command: npm run dev  # nodemon 또는 tsx watch
```

#### 프로덕션 환경 추가 설정

```yaml
services:
  conductor-mcp:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3100/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 7.7 외부 MCP 연동 (선택)

Docker 네트워크를 통해 외부 MCP 서버와도 연동 가능:

| MCP 서버 | 용도 | 연동 방법 |
|----------|------|----------|
| GitHub MCP | PR 자동 생성, 이슈 연동 | 별도 컨테이너 또는 공식 MCP |
| Slack MCP | 알림 전송 | notification-mcp에서 처리 |
| Linear MCP | 이슈 트래커 연동 | 별도 컨테이너 추가 |
| Notion MCP | 문서 연동 | 별도 컨테이너 추가 |

---

## 8. 데이터 구조

### 8.1 Task Registry

**파일**: `.claude/tasks/registry.json`

```json
{
  "version": "1.0.0",
  "counter": 7,
  "tasks": {
    "TASK-001": {
      "id": "TASK-001",
      "title": "로그인 API 구현",
      "description": "JWT 기반 인증 API 개발",
      "status": "REVIEW",
      "priority": "high",
      "created_at": "2025-01-27T09:00:00Z",
      "updated_at": "2025-01-27T14:30:00Z",
      "started_at": "2025-01-27T09:30:00Z",
      "branch": "feature/TASK-001",
      "context_file": ".claude/tasks/TASK-001/context.md",
      "changelog_versions": [1, 2],
      "feedback_history": [
        {
          "id": "FB-001",
          "content": "에러 핸들링 추가 필요",
          "created_at": "2025-01-27T12:00:00Z",
          "resolved": true,
          "resolved_at": "2025-01-27T14:00:00Z"
        }
      ],
      "server": {
        "port": 3000,
        "url": "http://localhost:3000",
        "api_docs_url": "http://localhost:3000/api-docs"
      }
    }
  }
}
```

### 8.2 Task Context

**파일**: `.claude/tasks/TASK-001/context.md`

```markdown
# TASK-001: 로그인 API 구현

## 목표
JWT 기반 사용자 인증 API 개발

## 요구사항
- POST /api/auth/login 엔드포인트
- 이메일/비밀번호 기반 인증
- JWT 액세스 토큰 발급 (유효기간: 1시간)
- 리프레시 토큰 발급 (유효기간: 7일)

## 기술 스택
- Express.js
- jsonwebtoken
- bcrypt

## 결정사항
- 2025-01-27: 토큰 저장은 httpOnly 쿠키 사용
- 2025-01-27: Rate limiting 적용 (5회/분)

## 참고 자료
- [JWT Best Practices](https://...)
- 기존 프로젝트 인증 모듈: src/auth/

## 진행 노트
### 2025-01-27 09:30
- 기본 라우트 구조 생성
- bcrypt를 이용한 비밀번호 해싱 구현

### 2025-01-27 12:00
- [피드백] 에러 핸들링 추가 필요
- 커스텀 에러 클래스 생성

### 2025-01-27 14:00
- 피드백 반영 완료
- 테스트 코드 추가
```

### 8.3 Server Registry

**파일**: `.claude/servers/registry.json`

```json
{
  "servers": {
    "TASK-001": {
      "task_id": "TASK-001",
      "type": "express",
      "port": 3000,
      "pid": 12345,
      "status": "running",
      "started_at": "2025-01-27T14:00:00Z",
      "url": "http://localhost:3000",
      "api_docs": {
        "swagger": "http://localhost:3000/api-docs",
        "redoc": "http://localhost:3000/redoc",
        "openapi_json": "http://localhost:3000/api-docs.json"
      },
      "logs_file": ".claude/servers/TASK-001.log"
    }
  }
}
```

---

## 9. 대시보드 UI

### 9.1 화면 구성

```
┌─────────────────────────────────────────────────────────────────────┐
│  🎯 Claude Conductor                                                │
│  ┌──────────┬──────────┬──────────┐                                │
│  │ 📋 Board │ 📝 Log   │ 🖥️ Server │                                │
│  └──────────┴──────────┴──────────┘                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │ 📋 준비  │ │ 🔄 진행  │ │ 👀 검수  │ │ ✅ 완료  │ │ 🏁 종료  │      │
│  │   (2)   │ │   (1)   │ │   (1)   │ │   (0)   │ │   (3)   │      │
│  ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤      │
│  │         │ │         │ │         │ │         │ │         │      │
│  │ ┌─────┐ │ │ ┌─────┐ │ │ ┌─────┐ │ │         │ │ ┌─────┐ │      │
│  │ │T-004│ │ │ │T-001│ │ │ │T-003│ │ │         │ │ │T-002│ │      │
│  │ │로그아 │ │ │ │로그인│ │ │ │회원가│ │ │         │ │ │설정 │ │      │
│  │ │웃    │ │ │ │API │ │ │ │입    │ │ │         │ │ │페이지│ │      │
│  │ │🟡Med │ │ │ │🔴High│ │ │ │🔴High│ │ │         │ │ │🟢Done│ │      │
│  │ └─────┘ │ │ └─────┘ │ │ └─────┘ │ │         │ │ └─────┘ │      │
│  │         │ │         │ │         │ │         │ │         │      │
│  │ ┌─────┐ │ │         │ │         │ │         │ │ ┌─────┐ │      │
│  │ │T-005│ │ │         │ │         │ │         │ │ │T-006│ │      │
│  │ │...  │ │ │         │ │         │ │         │ │ │...  │ │      │
│  │ └─────┘ │ │         │ │         │ │         │ │ └─────┘ │      │
│  │         │ │         │ │         │ │         │ │         │      │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘      │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  📊 Summary: 7 tasks | 1 running server | Last update: 14:30       │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.2 태스크 상세 모달

```
┌─────────────────────────────────────────────────────────────┐
│  TASK-001: 로그인 API 구현                              [×] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  상태: 🔄 진행 중        우선순위: 🔴 High                   │
│  브랜치: feature/TASK-001                                   │
│  생성: 2025-01-27 09:00  수정: 2025-01-27 14:30            │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  📝 컨텍스트 요약                                           │
│  JWT 기반 사용자 인증 API 개발                              │
│  - POST /api/auth/login 엔드포인트                         │
│  - 액세스/리프레시 토큰 발급                                │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  💬 피드백 히스토리                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 2025-01-27 12:00 - ✅ 해결됨                        │   │
│  │ 에러 핸들링 추가 필요                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  🖥️ 서버 정보                                               │
│  URL: http://localhost:3000                                │
│  API Docs: http://localhost:3000/api-docs                  │
│  상태: 🟢 Running                                           │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  [컨텍스트 열기] [CHANGELOG 보기] [서버 로그]               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 9.3 CHANGELOG 뷰

```
┌─────────────────────────────────────────────────────────────────────┐
│  📝 Project Changelog                                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 🔍 Search...                    [All] [Added] [Fixed] [v]   │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ## 2025-01-27                                                     │
│                                                                     │
│  ### TASK-001: 로그인 API 구현                                     │
│                                                                     │
│  **v2** (14:00) - 피드백 반영                                      │
│  - 🔧 Fixed: SQL Injection 취약점 수정                             │
│  - ➕ Added: Rate limiting 적용                                    │
│  - ➕ Added: 입력값 검증 추가                                      │
│                                                                     │
│  **v1** (12:00) - 초기 구현                                        │
│  - ➕ Added: POST /api/auth/login 엔드포인트                       │
│  - ➕ Added: JWT 토큰 발급 로직                                    │
│  - ➕ Added: bcrypt 비밀번호 해싱                                  │
│                                                                     │
│  ───────────────────────────────────────────────────────────────   │
│                                                                     │
│  ### TASK-003: 회원가입 기능                                       │
│                                                                     │
│  **v1** (11:00) - 초기 구현                                        │
│  - ➕ Added: POST /api/auth/register 엔드포인트                    │
│  - ➕ Added: 이메일 중복 체크                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 10. 구현 로드맵

### 10.1 Phase 1: 기반 구축 (Week 1-2)

| 작업 | 설명 | 산출물 |
|------|------|--------|
| 디렉토리 구조 생성 | .claude/ 하위 폴더 구조 | 폴더 템플릿 |
| Task Management Skill | 태스크 CRUD, 상태 관리 | SKILL.md, 핸들러 |
| Orchestrator Skill | 상태 머신, 흐름 제어 | SKILL.md, 핸들러 |
| 기본 Commands | task-create, task-start, task-list | 명령어 파일 |
| CLAUDE.md 템플릿 | 프로젝트 컨텍스트 기본 구조 | 템플릿 파일 |

### 10.2 Phase 2: Docker MCP 인프라 (Week 3-4)

| 작업 | 설명 | 산출물 |
|------|------|--------|
| Docker Compose 구성 | 전체 스택 정의 | docker-compose.yml |
| Conductor MCP 서버 | 핵심 오케스트레이터 구현 | TypeScript 서버 |
| Redis 연동 | 이벤트 큐 및 캐시 | Redis 컨테이너 |
| MCP 등록 스크립트 | Claude Code 연동 자동화 | register.sh |
| 프로젝트 감지기 | Go-Gin 등 프레임워크 감지 | detectors/*.ts |

### 10.3 Phase 3: 핵심 기능 (Week 5-6)

| 작업 | 설명 | 산출물 |
|------|------|--------|
| Code Review Skill | 자동 검증 파이프라인 | SKILL.md, 스크립트 |
| Changelog Skill | 변경사항 자동 감지/기록 | SKILL.md, 핸들러 |
| Dev Server Skill | 서버 자동 시작/관리 | SKILL.md, 핸들러 |
| API Docs Skill | Swagger/Redoc/swaggo 자동화 | SKILL.md, 템플릿 |
| 추가 Commands | task-review, task-approve 등 | 명령어 파일 |

### 10.4 Phase 4: 대시보드 (Week 7-8)

| 작업 | 설명 | 산출물 |
|------|------|--------|
| Dashboard MCP 서버 | 대시보드 API 컨테이너 | Docker 서비스 |
| Dashboard Skill | 대시보드 서버 관리 | SKILL.md |
| 칸반 보드 UI | React/Vite 기반 | 웹 앱 |
| CHANGELOG 뷰어 | 마크다운 렌더링 | 컴포넌트 |
| 서버 상태 패널 | 실시간 모니터링 | 컴포넌트 |
| WebSocket 연동 | 실시간 업데이트 | Redis Pub/Sub |

### 10.5 Phase 5: Git 및 알림 연동 (Week 9-10)

| 작업 | 설명 | 산출물 |
|------|------|--------|
| Git MCP 서버 | 브랜치/커밋/PR 자동화 | Docker 서비스 |
| Notification MCP 서버 | Slack/Discord 알림 | Docker 서비스 |
| Git 브랜치 연동 | 자동 브랜치/커밋/PR | Git 핸들러 |
| 알림 시스템 | 검수 필요 시 알림 | 알림 모듈 |

### 10.6 Phase 6: 고도화 (Week 11+)

| 작업 | 설명 | 산출물 |
|------|------|--------|
| 멀티 프로젝트 | 프로젝트 간 전환 | 확장 기능 |
| 메트릭스 | 통계 및 분석 | 대시보드 확장 |
| 외부 MCP 연동 | GitHub, Linear 등 | 연동 가이드 |
| 프로덕션 최적화 | 리소스 제한, 로깅, 헬스체크 | docker-compose.prod.yml |
| 문서화 | 사용자 가이드, API 문서 | 문서 사이트 |

---

## 부록

### A. 용어 정의

| 용어 | 정의 |
|------|------|
| Task | 하나의 개발 작업 단위 |
| Skill | Claude Code가 참조하는 전문화된 지식/워크플로우 |
| State | 태스크의 현재 진행 상태 |
| Transition | 상태 간 전이 |
| Context | 태스크 수행에 필요한 배경 정보 |
| Changelog | 코드 변경 이력 기록 |

### B. 참고 자료

- [Claude Code 공식 문서](https://docs.anthropic.com/claude-code)
- [MCP (Model Context Protocol)](https://modelcontextprotocol.io)
- [Keep a Changelog](https://keepachangelog.com)
- [Conventional Commits](https://conventionalcommits.org)

### C. 버전 히스토리

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| 0.1.0 | 2025-01-27 | 초기 스펙 문서 작성 |
| 0.2.0 | 2025-01-27 | Go-Gin 프레임워크 지원 추가, Docker 기반 MCP 인프라 설계 |

---

*이 문서는 Claude Conductor 프로젝트의 개발 스펙을 정의합니다.*
*최종 수정: 2025-01-27*
