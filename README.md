# Claude Conductor

[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green?style=flat-square)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3%2B-blue?style=flat-square)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

> AI가 기반이 되는 자동화된 개발 오케스트레이션 시스템. n8n과 유사하지만 AI가 지원하는 개발 워크플로우를 위한 도구입니다.

Claude Conductor는 개발 작업의 전체 라이프사이클을 자동화합니다: 생성과 구현부터 코드 검토와 완료까지. Claude AI와 통합되어 개발자가 의사결정에만 집중할 수 있도록 지원하면서 프로젝트 작업을 지능적으로 처리합니다.

## 주요 기능

- **파이프라인 실행**: 대시보드에서 READY 상태 작업의 "작업 시작" 버튼을 클릭하면 Claude가 자동으로 구현하고 검토 상태로 전환 (Auto-Start 환경변수로 자동 감지 모드도 지원)
- **Multi-Agent 오케스트레이션**: 병렬, 순차, 파이프라인 실행 전략과 지능적인 작업 분배
- **프레임워크 자동 감지**: Next.js, Vite, Express, FastAPI, NestJS, Spring Boot, Go+Gin의 자동 감지 및 설정
- **개발 서버 관리**: 작업 상태에 따른 개발 서버의 지능적 자동 시작/중지
- **자동화된 코드 품질**: 내장 린팅, 타입 체크, 테스트, 보안 스캔
- **CHANGELOG 생성**: Conventional Commits 스타일의 자동 CHANGELOG 생성
- **실시간 대시보드**: WebSocket 업데이트를 포함한 라이브 Kanban 보드
- **멀티 프로젝트 지원**: 단일 인스턴스에서 여러 프로젝트 관리

## 고급 기능

- **CLI 세션 재개**: 작업별 Claude CLI 세션을 유지하고, 재실행 시 `--resume` 플래그로 이전 세션을 이어서 작업
- **프롬프트 히스토리**: 작업별 `prompt.md` 파일로 모든 프롬프트 기록 추적 및 디버깅 지원
- **AI 코드 리뷰 통합**: 작업 완료 후 자동으로 코드 품질 리뷰 및 보안 리뷰를 병렬 실행
- **피드백 반영 모드**: 리뷰어 피드백을 세션 기반(Resume) 또는 출력 기반(Legacy)으로 반영
- **파이프라인 큐 관리**: 프로젝트별 큐 시스템으로 작업 충돌 방지 (한 번에 하나의 작업만 실행)
- **향상된 대시보드 UI**: 풀스크린 모드, 접이식 섹션, 심각도 뱃지, Diff 시각화, Markdown 렌더링

## 아키텍처

```
┌──────────────────────────────────────────────────────────────────┐
│                   Claude Conductor 시스템                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────┐      ┌──────────────┐      ┌─────────────┐ │
│  │   대시보드     │      │  MCP Server  │      │  Claude AI  │ │
│  │   (React)      │◄────►│  (Node.js)   │◄────►│             │ │
│  │  Port 4000     │      │ Ports 3100/1 │      │  via stdin  │ │
│  └────────────────┘      └──────────────┘      └─────────────┘ │
│                                  │                               │
│                                  ▼                               │
│                          ┌──────────────┐                        │
│                          │    Redis     │                        │
│                          │  (Docker)    │                        │
│                          │ Port 6379    │                        │
│                          └──────────────┘                        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 기술 스택

**백엔드**
- TypeScript와 함께 Node.js 24+
- AI 통합을 위한 Model Context Protocol (MCP) SDK
- Express HTTP 서버
- 실시간 업데이트를 위한 WebSocket 서버
- 이벤트 큐잉 및 캐싱을 위한 Redis
- 스키마 검증을 위한 Zod
- 구조화된 로깅을 위한 Pino

**프론트엔드**
- Vite 5 빌드 도구가 포함된 React 18
- 스타일링을 위한 TailwindCSS
- 상태 관리를 위한 Zustand
- dnd-kit를 이용한 드래그 앤 드롭
- 아이콘을 위한 Lucide React

## 필수 요구사항

- **Node.js**: 24.0.0 이상
- **pnpm**: 패키지 매니저 (`npm install -g pnpm`으로 설치)
- **Docker & Docker Compose**: Redis용
- **Git**: CHANGELOG 생성 및 버전 관리 통합용

## 설치

### 저장소 클론 및 설정

```bash
# 저장소 클론
git clone https://github.com/yourusername/claude-conductor.git
cd claude-conductor

# 두 서비스 모두 의존성 설치
cd conductor-mcp/services/conductor
pnpm install

cd ../dashboard
pnpm install

cd ../../..
```

### 환경 설정

```bash
# 환경 설정 파일 복사
cd conductor-mcp
cp .env.example .env

# .env 파일을 설정에 맞게 수정
# 필수 설정:
# - WORKSPACE_DIR: 프로젝트 디렉토리 경로
# - REDIS_URL: Redis 연결 URL (기본값: redis://localhost:6379)
# - HTTP_PORT: HTTP API 포트 (기본값: 3100)
# - WS_PORT: WebSocket 포트 (기본값: 3101)
# - CLAUDE_API_KEY: Claude 통합을 위한 Anthropic API 키
```

### 설치 확인

```bash
# Node.js 버전 테스트
node --version  # 24.0.0 이상이어야 함

# pnpm 테스트
pnpm --version

# Docker 테스트
docker --version
docker-compose --version
```

## 빠른 시작

Claude Conductor를 실행하는 가장 빠른 방법은 제공된 시작 스크립트를 사용하는 것입니다:

```bash
# 프로젝트 루트에서 실행
./start.sh
```

이 스크립트는 자동으로 다음을 수행합니다:
1. Redis 컨테이너 시작
2. MCP 서버 시작 (REST API 포트 3100, WebSocket 포트 3101)
3. 대시보드 시작 (포트 4000)
4. 모든 서비스가 정상 상태가 될 때까지 대기

그 후 **http://localhost:4000**에서 대시보드에 접근할 수 있습니다.

### macOS에서 장시간 작업

macOS에서 장시간 작업 시 절전 방지를 위해:

```bash
# macOS에서 장시간 작업 시 절전 방지
./insomniac-claude.sh
```

### 수동 시작 (대안)

수동 제어를 선호하는 경우:

```bash
# Terminal 1: Redis 시작
cd conductor-mcp
docker-compose up -d redis

# Terminal 2: MCP 서버 시작
cd conductor-mcp/services/conductor
pnpm run start:all

# Terminal 3: 대시보드 시작
cd conductor-mcp/services/dashboard
pnpm run dev
```

## 사용 방법

### 워크플로우

Claude Conductor의 일반적인 워크플로우는 다음과 같습니다:

```
1. 대시보드에서 작업 생성
   │
   ├─ 제목: "사용자 인증 구현"
   ├─ 설명: 작업 세부사항
   └─ 상태: READY
         │
         ▼
2. 사용자가 "작업 시작(▶)" 버튼 클릭
   │
   ├─ 파이프라인 트리거
   ├─ 작업 컨텍스트 로드
   ├─ 요구사항 분석
   └─ Claude CLI 실행 및 구현 시작
         │
         ▼
3. 작업 진행 중
   │
   ├─ 코드 작성
   ├─ 테스트 실행
   ├─ 코드 검토 수행
   └─ 변경사항 커밋
         │
         ▼
3.5 자동 리뷰 실행
   │
   ├─ AI 코드 리뷰 (품질 검사)
   ├─ AI 보안 리뷰 (취약점 검사)
   └─ 리뷰 결과 대시보드에 표시
         │
         ▼
4. 검토 상태로 전환
   │
   ├─ 코드 검토 결과
   ├─ 테스트 결과
   ├─ AI 리뷰 결과
   └─ 상태: REVIEW
         │
         ▼
5. 대시보드에서 개발자 검토
   │
   ├─ 코드 변경사항 검토
   ├─ AI 리뷰 결과 확인
   ├─ 승인 또는 변경 요청
   └─ DONE 상태로 전환 또는 IN_PROGRESS로 되돌리기
         │
         ▼
6. 작업 완료
   ├─ 상태: DONE
   └─ 상태: CLOSED (최종 확정 시)
```

### 작업 상태

| 상태 | 설명 |
|-------|-------------|
| **BACKLOG** | 백로그에 있는 작업, 아직 준비되지 않음 |
| **READY** | 생성되고 작업할 준비가 됨 (사용자가 "작업 시작" 클릭 시 실행) |
| **IN_PROGRESS** | Claude가 작업 중 |
| **REVIEW** | 개발자 검토 대기 중 |
| **DONE** | 검토 승인됨 |
| **CLOSED** | 작업 완료 또는 취소됨 |

### 대시보드 사용

**작업 생성 및 실행:**
1. http://localhost:4000으로 이동
2. "Create Task" 버튼 클릭
3. 작업 제목, 설명, 프로젝트 입력
4. 상태를 "READY"로 설정 후 "Create" 클릭
5. 생성된 작업 카드를 클릭하여 상세 모달 열기
6. **"작업 시작(▶)" 버튼을 클릭**하여 파이프라인 실행

> **참고:** `AUTO_START_PIPELINE=true` 환경변수를 설정하면 READY 상태 작업이 생성 즉시 자동으로 실행됩니다. 기본값은 수동 트리거입니다.

**작업 검토:**
1. REVIEW 상태의 작업이 검토 열에 나타남
2. 작업을 클릭하여 코드 변경사항, 테스트 결과, 커밋 이력 확인
3. "Approve"를 클릭하여 DONE으로 표시하거나 "Request Changes"를 클릭하여 IN_PROGRESS로 되돌리기

**진행 상황 모니터링:**
- Claude가 작업할 때 실시간 업데이트 감시
- 에이전트 패널에서 활성 에이전트 및 현재 작업 표시
- 서버 상태에서 모든 서비스의 상태 표시

## 대시보드 기능

TaskModal은 다음과 같은 향상된 기능을 제공합니다:

### 풀스크린 모드
작업 상세 모달을 전체 화면으로 확장하여 더 넓은 작업 공간에서 효율적으로 작업할 수 있습니다.

### 리뷰 결과 패널
코드 리뷰 및 보안 리뷰 결과를 심각도 뱃지와 함께 표시:
- **Critical**: 중요한 이슈
- **Security**: 보안 취약점
- **Warning**: 경고 수준 이슈
- **Info**: 정보성 제안

### 변경사항 시각화
수정된 파일의 추가/삭제 라인 수를 Diff 형식으로 표시하여 변경 범위를 한눈에 파악할 수 있습니다.

### 프롬프트 히스토리 패널
작업에 전달된 모든 프롬프트 기록을 조회하고 각 프롬프트가 실행된 순서와 함께 추적할 수 있습니다.

### 실행 이력 뱃지
다음을 표시합니다:
- 초기 실행 횟수
- 재실행 횟수
- 피드백 반영 횟수

### 액션 버튼
작업 상태에 따른 조작:
- **READY 상태**: "시작" 버튼으로 작업 시작
- **IN_PROGRESS 상태**: "중지" 및 "재시작" 버튼으로 작업 제어

## MCP 도구 참고서

Claude Conductor는 작업 오케스트레이션 및 관리를 위한 26개의 MCP 도구를 제공합니다.

### 작업 관리 (5개 도구)

```
task_create       컨텍스트와 함께 새 작업 생성
task_list         필터를 포함한 모든 작업 나열
task_get          자세한 작업 정보 조회
task_start        작업을 READY에서 IN_PROGRESS로 전환
task_transition   작업을 상태 간 전환 (IN_PROGRESS → REVIEW → DONE → CLOSED)
```

**예시:**
```json
{
  "method": "task_create",
  "params": {
    "title": "비밀번호 재설정 구현",
    "description": "인증 모듈에 비밀번호 재설정 기능 추가",
    "project_id": "proj_123",
    "assignee": "claude",
    "priority": "high"
  }
}
```

### 프로젝트 관리 (5개 도구)

```
project_create    새 프로젝트 생성
project_list      모든 프로젝트 나열
project_select    활성 프로젝트 선택
project_get       프로젝트 세부사항 조회
project_delete    프로젝트 삭제
```

### 서버 관리 (7개 도구)

```
server_start      프로젝트의 개발 서버 시작
server_stop       실행 중인 개발 서버 중지
server_status     현재 서버 상태 조회
server_logs       서버 로그 조회
server_health     서버 상태 점검
server_open       브라우저에서 서버 URL 열기
api_docs          API 문서 생성
```

### 품질 및 검토 (4개 도구)

```
review_code       자동화된 코드 검토 수행 (린팅, 타입 체크, 테스트)
changelog_generate 커밋에서 CHANGELOG 생성
```

### 리뷰 및 프롬프트 (추가 도구)

```
review_code       AI 기반 코드 품질 리뷰 수행
review_security   AI 기반 보안 취약점 리뷰 수행
```

### 에이전트 오케스트레이션 (7개 도구)

```
agent_spawn       새 에이전트 생성 및 시작
agent_delegate    특정 에이전트에 작업 위임
agent_status      에이전트 상태 및 통계 조회
agent_collect     여러 에이전트의 결과 수집
agent_terminate   실행 중인 에이전트 중지
agent_list_roles  사용 가능한 에이전트 역할 나열
orchestrate       다중 에이전트 오케스트레이션 실행
orchestrate_review 오케스트레이션 결과 검토
orchestrate_implement 오케스트레이션 구현 실행
```

자세한 MCP 문서는 [MCP_TOOLS.md](./spec/MCP_TOOLS.md)를 참고하세요.

## 접근 지점

| 서비스 | URL | 용도 |
|---------|-----|---------|
| **대시보드** | http://localhost:4000 | 작업 관리 웹 UI |
| **REST API** | http://localhost:3100 | 프로그래밍 방식 접근용 HTTP API |
| **WebSocket** | ws://localhost:3101 | 실시간 이벤트 및 업데이트 |
| **상태 점검** | http://localhost:3100/health | 서비스 상태 확인 |
| **프롬프트 히스토리** | http://localhost:3100/api/tasks/:taskId/prompt | 작업별 프롬프트 기록 조회 |

## 개발

### 프로젝트 구조

```
claude-conductor/
├── conductor-mcp/                 # 핵심 MCP 서버
│   ├── services/
│   │   ├── conductor/             # MCP 서버 (Node.js/TypeScript)
│   │   │   ├── src/
│   │   │   │   ├── handlers/      # MCP 도구 핸들러
│   │   │   │   ├── orchestration/ # 다중 에이전트 오케스트레이션
│   │   │   │   ├── detectors/     # 프레임워크 자동 감지
│   │   │   │   ├── utils/         # 유틸리티 모듈
│   │   │   │   ├── types/         # TypeScript 타입
│   │   │   │   ├── index.ts       # 메인 진입점
│   │   │   │   ├── server.ts      # MCP 서버 설정
│   │   │   │   ├── http-server.ts # HTTP REST API
│   │   │   │   └── websocket-server.ts # WebSocket & Redis 브리지
│   │   │   ├── package.json
│   │   │   └── tsconfig.json
│   │   └── dashboard/             # React 대시보드
│   │       ├── src/
│   │       │   ├── components/    # React 컴포넌트
│   │       │   ├── store/         # Zustand 상태 저장소
│   │       │   ├── hooks/         # 커스텀 훅 (WebSocket 등)
│   │       │   ├── types/         # TypeScript 타입
│   │       │   └── App.tsx        # 메인 앱 컴포넌트
│   │       └── package.json
│   ├── docker-compose.yml         # Redis 컨테이너 설정
│   └── scripts/                   # 유틸리티 스크립트
├── spec/                          # 사양 문서
├── .claude/                       # 에이전트 및 스킬 정의
│   ├── agents/                    # 에이전트 역할 정의
│   ├── skills/                    # 스킬 모듈
│   │   ├── api-docs/             # API 문서 생성
│   │   ├── changelog/            # CHANGELOG 생성
│   │   ├── code-review/          # 코드 리뷰
│   │   ├── coding/               # 코드 구현
│   │   ├── dashboard/            # 대시보드 관리
│   │   ├── dev-server/           # 개발 서버 관리
│   │   ├── orchestrator/         # 오케스트레이션
│   │   ├── security/             # 보안 리뷰
│   │   ├── task-management/      # 작업 관리
│   │   └── testing/              # 테스트 실행
│   ├── projects/                 # 프로젝트 데이터
│   ├── commands/                  # Slash 명령어 정의
│   └── tasks/                     # 작업 데이터 (gitignored)
├── insomniac-claude.sh            # macOS 절전 방지 스크립트
├── start.sh                       # 빠른 시작 스크립트
├── README.md                      # 이 파일
└── spec/                          # 설계 사양 문서
```

### 개발 스크립트

**Conductor MCP 서버:**
```bash
cd conductor-mcp/services/conductor

# 개발 모드 (핫 리로드)
pnpm run dev

# 프로덕션용 빌드
pnpm run build

# 프로덕션 빌드 실행
pnpm run start

# MCP 및 HTTP/WS 서버 모두 실행
pnpm run start:all

# 테스트 실행
pnpm run test
```

**대시보드:**
```bash
cd conductor-mcp/services/dashboard

# 개발 모드 (핫 리로드)
pnpm run dev

# 프로덕션용 빌드
pnpm run build

# 프로덕션 빌드 미리 보기
pnpm run preview
```

### 프레임워크 감지

Conductor는 프로젝트 프레임워크를 자동으로 감지하고 적절한 개발 서버를 설정합니다. 지원되는 프레임워크:

- **프론트엔드**: Next.js, Vite, React
- **백엔드**: Express, FastAPI, NestJS, Spring Boot, Go+Gin
- **언어**: TypeScript, JavaScript, Python, Java, Go

감지는 다음의 경우에 자동으로 발생합니다:
1. 작업 공간에서 프로젝트가 생성될 때
2. 작업을 위해 개발 서버가 시작될 때
3. 구현 전에 작업 컨텍스트가 분석될 때

## 설정

### 환경 변수

`conductor-mcp` 디렉토리에 `.env` 파일 생성:

```bash
# 작업 공간 설정
WORKSPACE_DIR=/path/to/your/projects

# Redis 설정
REDIS_URL=redis://localhost:6379
REDIS_DB=0

# 서버 포트
HTTP_PORT=3100
WS_PORT=3101

# Claude AI 설정
CLAUDE_API_KEY=sk-your-api-key-here
CLAUDE_MODEL=claude-opus-4-5-20251101

# 파이프라인 설정
AUTO_START_PIPELINE=false  # true로 설정 시 READY 작업 자동 실행 (기본값: false, 수동 트리거)

# 선택사항: 특정 기능 활성화
DEBUG=false
LOG_LEVEL=info
```

### Redis 설정

Redis는 Docker Compose를 통해 제공됩니다. `conductor-mcp/docker-compose.yml`에서 설정을 사용자 정의합니다:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
```

## Claude Code 통합을 위한 명령어

Claude Code 내에서 Claude Conductor를 실행할 때 사용 가능한 slash 명령어:

```
/conductor-init       Conductor 서비스 초기화
/task-create          새 작업 생성
/task-list            모든 작업 나열
/task-start           작업 시작
/task-get             작업 세부사항 조회
/autopilot            READY 작업에 대한 auto-pilot 활성화
```

## 문제 해결

### Redis 연결 거부

```bash
# Redis 컨테이너가 실행 중인지 확인
docker ps | grep conductor-redis

# 실행 중이 아니면 Redis 시작
cd conductor-mcp
docker-compose up -d redis

# Redis에 접근 가능한지 확인
redis-cli ping
```

### 포트 이미 사용 중

Conductor는 자동으로 포트 충돌을 감지하고 사용 가능한 다음 포트를 사용합니다. 시작 로그를 확인하세요:

```bash
# 시작 스크립트가 실제 사용된 포트를 표시합니다
./start.sh
```

### 서비스가 시작되지 않음

```bash
# 서비스 로그 확인
cd conductor-mcp/services/conductor
pnpm run dev

# 다른 터미널에서 대시보드 확인
cd conductor-mcp/services/dashboard
pnpm run dev

# Node.js 버전 확인
node --version  # 24.0.0 이상이어야 함
```

### WebSocket 연결 문제

1. WebSocket 서버가 설정된 포트(기본값 3101)에서 실행 중인지 확인
2. 방화벽 규칙이 WebSocket 연결을 차단하지 않는지 확인
3. Redis가 이벤트 브리징을 위해 접근 가능한지 확인
4. 브라우저 콘솔에서 자세한 오류 메시지 확인

## 기여하기

기여를 환영합니다! 다음 가이드라인을 따라주세요:

1. **포크 및 클론**: 저장소를 포크하고 로컬 머신에 클론
2. **기능 브랜치 생성**: `git checkout -b feature/your-feature`
3. **변경사항 구현**: 테스트와 함께 기능 구현
4. **타입 안정성**: TypeScript 컴파일이 통과하는지 확인: `pnpm run build`
5. **철저한 테스트**: `pnpm run test`를 실행하여 확인
6. **명확한 커밋**: Conventional Commits 형식 사용
7. **PR 제출**: 명확한 설명과 함께 Pull Request 생성

### 코드 스타일

- Strict 모드가 활성화된 TypeScript
- 코드 린팅을 위한 ESLint
- 코드 포맷팅을 위한 Prettier
- 런타임 스키마 검증을 위한 Zod

## 성능 고려사항

- **Redis 메모리**: 기본값 128MB 최대 메모리 및 LRU 제거
- **동시 작업**: MCP 서버는 여러 동시 작업 처리
- **WebSocket**: 대시보드 업데이트를 위해 연결 풀링 사용
- **데이터베이스**: 작업 데이터는 Redis에 저장 (프로덕션 시 PostgreSQL 고려)

## 라이선스

이 프로젝트는 MIT 라이선스에 따라 라이센스됩니다.

## 지원

문제, 질문 또는 제안이 있으시면:

1. [GitHub Issues](https://github.com/yourusername/claude-conductor/issues) 확인
2. [문제 해결](#문제-해결) 섹션 검토
3. 서비스 로그에서 오류 세부사항 확인
4. 재현 단계와 함께 자세한 이슈 리포트 작성

## 로드맵

- [ ] 지속적인 작업 저장을 위한 PostgreSQL 지원
- [ ] 작업 스케줄링 및 반복 작업
- [ ] 고급 분석 및 인사이트
- [ ] 알림을 위한 Slack 통합
- [ ] 사용자 정의 에이전트 생성 UI
- [ ] 외부 시스템을 위한 Webhook 지원
- [ ] 멀티 유저 협업 기능
- [ ] 작업 의존성 및 워크플로우

## 감사의 말

다음으로 구축되었습니다:
- AI 통합을 위한 [Model Context Protocol](https://modelcontextprotocol.io/)
- AI 기능을 위한 [Anthropic Claude](https://www.anthropic.com/)
- 대시보드 UI를 위한 [React](https://react.dev/)
- HTTP API를 위한 [Express](https://expressjs.com/)

## 프로젝트 상태

Claude Conductor는 활발히 개발 중입니다. 핵심 기능은 안정적이고 사용할 준비가 되었으며, 일부 고급 기능은 계속 추가되고 있습니다.

---

**행복한 자동화되세요!** 작업을 생성하고 READY로 설정하면 Claude Conductor가 나머지를 처리합니다.
