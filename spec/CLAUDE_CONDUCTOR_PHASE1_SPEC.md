# Claude Conductor - Phase 1 상세 구현 스펙

> **목표**: 기반 구축 - 디렉토리 구조, Task Management, Orchestrator, 기본 Commands
> **예상 소요**: 1-2주
> **선행 조건**: Claude Code CLI 설치, Node.js 24+, Git

---

## 📋 구현 체크리스트

Phase 1 완료 시 다음이 동작해야 합니다:

- [ ] `.claude/` 디렉토리 구조 생성 완료
- [ ] `/project:task-create "테스트 태스크"` 실행 시 TASK-001 생성
- [ ] `/project:task-list` 실행 시 태스크 목록 출력
- [ ] `/project:task-start TASK-001` 실행 시 상태가 IN_PROGRESS로 변경
- [ ] `.claude/tasks/registry.json`에 태스크 데이터 영속화
- [ ] `.claude/tasks/TASK-001/context.md` 파일 생성

---

## Step 1: 디렉토리 구조 생성

### 1.1 실행 명령어

```bash
# 프로젝트 루트에서 실행
mkdir -p .claude/{skills/{orchestrator,task-management,code-review,changelog,dev-server,api-docs,dashboard},commands,tasks,servers}

# 빈 registry 파일 생성
touch .claude/tasks/registry.json
touch .claude/servers/registry.json
```

### 1.2 생성되어야 하는 구조

```
.claude/
├── CLAUDE.md
├── skills/
│   ├── orchestrator/
│   │   └── SKILL.md
│   ├── task-management/
│   │   └── SKILL.md
│   ├── code-review/
│   │   └── SKILL.md
│   ├── changelog/
│   │   └── SKILL.md
│   ├── dev-server/
│   │   └── SKILL.md
│   ├── api-docs/
│   │   └── SKILL.md
│   └── dashboard/
│       └── SKILL.md
├── commands/
│   ├── task-create.md
│   ├── task-start.md
│   ├── task-list.md
│   ├── task-get.md
│   └── conductor-init.md
├── tasks/
│   └── registry.json
└── servers/
    └── registry.json
```

---

## Step 2: CLAUDE.md 작성

### 2.1 파일: `.claude/CLAUDE.md`

```markdown
# Claude Conductor 프로젝트

## 개요

이 프로젝트는 Claude Conductor - 자동화 개발 지휘 시스템입니다.
Claude Code가 개발 태스크의 생성, 진행, 검수, 완료까지 전체 라이프사이클을 관리합니다.

## 프로젝트 구조

- `.claude/skills/`: 각 기능별 전문화된 Skill 정의
- `.claude/commands/`: 슬래시 명령어 정의
- `.claude/tasks/`: 태스크 데이터 저장소
- `.claude/servers/`: 실행 중인 서버 정보

## 핵심 규칙

### 태스크 상태 흐름

```
BACKLOG → READY → IN_PROGRESS → REVIEW ⇄ IN_PROGRESS
           ↑___________________________|      ↓
           (반려 시 BACKLOG로 이동)         DONE → CLOSED
```

### 상태 정의

| 상태 | 설명 |
|------|------|
| BACKLOG | 백로그, 아직 준비되지 않음 |
| READY | 준비 완료, 시작 대기 |
| IN_PROGRESS | 작업 진행 중 |
| REVIEW | 개발자 검수 대기 |
| DONE | 검수 승인 완료 |
| CLOSED | 최종 종료 |

> **Note**: CANCELLED 상태는 제거되었습니다. 취소가 필요한 경우 BACKLOG로 이동 후 관리합니다.

### 명령어 목록

| 명령어 | 설명 |
|--------|------|
| /project:task-create | 새 태스크 생성 |
| /project:task-list | 태스크 목록 조회 |
| /project:task-start | 태스크 시작 |
| /project:task-get | 태스크 상세 조회 |

## 데이터 파일 위치

- 태스크 레지스트리: `.claude/tasks/registry.json`
- 개별 태스크 컨텍스트: `.claude/tasks/{TASK-ID}/context.md`
- 서버 레지스트리: `.claude/servers/registry.json`

## Skills 참조

태스크 관련 작업 시 반드시 다음 Skill을 참조하세요:
- `.claude/skills/task-management/SKILL.md`: 태스크 CRUD
- `.claude/skills/orchestrator/SKILL.md`: 상태 전이 규칙
```

---

## Step 3: Task Registry 초기화

### 3.1 파일: `.claude/tasks/registry.json`

```json
{
  "version": "1.0.0",
  "counter": 0,
  "tasks": {}
}
```

### 3.2 파일: `.claude/servers/registry.json`

```json
{
  "version": "1.0.0",
  "servers": {}
}
```

---

## Step 4: Task Management Skill

### 4.1 파일: `.claude/skills/task-management/SKILL.md`

```markdown
# Task Management Skill

## 목적

태스크의 생성, 조회, 수정, 삭제 및 상태 관리를 담당합니다.

## 데이터 스키마

### Task 객체

```typescript
interface Task {
  id: string;                    // "TASK-001" 형식
  project_id: string;            // 프로젝트 ID (멀티 프로젝트 지원)
  title: string;                 // 태스크 제목
  description: string;           // 상세 설명 (선택)
  status: TaskStatus;            // 현재 상태
  priority: Priority;            // 우선순위
  created_at: string;            // ISO8601 형식
  updated_at: string;            // ISO8601 형식
  started_at: string | null;     // 시작 시간
  completed_at: string | null;   // 완료 시간
  branch: string | null;         // Git 브랜치명
  context_file: string;          // 컨텍스트 파일 경로
  changelog_versions: number[];  // CHANGELOG 버전 목록
  feedback_history: Feedback[];  // 피드백 이력
}

interface Project {
  id: string;                    // "PRJ-001" 형식
  name: string;                  // 프로젝트 이름
  path: string;                  // 프로젝트 경로
  created_at: string;            // ISO8601 형식
  updated_at: string;            // ISO8601 형식
  active: boolean;               // 활성화 여부
}

interface ProjectRegistry {
  version: string;               // "1.0.0"
  counter: number;               // 마지막 사용된 번호
  current_project_id: string | null;  // 현재 선택된 프로젝트
  projects: {
    [projectId: string]: Project;
  };
}

type TaskStatus = "READY" | "IN_PROGRESS" | "REVIEW" | "DONE" | "CLOSED" | "CANCELLED";
type Priority = "critical" | "high" | "medium" | "low";

interface Feedback {
  id: string;
  content: string;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
}
```

### Registry 구조

```typescript
interface TaskRegistry {
  version: string;      // "1.0.0"
  counter: number;      // 마지막 사용된 번호
  tasks: {
    [taskId: string]: Task;
  };
}
```

## 작업 정의

### task:create - 태스크 생성

**입력**:
- `title` (필수): 태스크 제목
- `description` (선택): 상세 설명
- `priority` (선택, 기본값: "medium"): 우선순위

**처리 순서**:
1. `.claude/tasks/registry.json` 파일 읽기
2. `counter` 값을 1 증가
3. 새 ID 생성: `TASK-{counter를 3자리 0패딩}` (예: TASK-001)
4. 현재 시간을 ISO8601 형식으로 생성
5. Task 객체 생성:
   ```json
   {
     "id": "TASK-001",
     "title": "{입력된 제목}",
     "description": "{입력된 설명 또는 빈 문자열}",
     "status": "READY",
     "priority": "{입력된 우선순위 또는 medium}",
     "created_at": "{현재 시간}",
     "updated_at": "{현재 시간}",
     "started_at": null,
     "completed_at": null,
     "branch": null,
     "context_file": ".claude/tasks/TASK-001/context.md",
     "changelog_versions": [],
     "feedback_history": []
   }
   ```
6. `registry.tasks`에 새 Task 추가
7. `registry.json` 파일 저장
8. `.claude/tasks/TASK-001/` 디렉토리 생성
9. `.claude/tasks/TASK-001/context.md` 파일 생성 (아래 템플릿 사용)

**Context 파일 템플릿**:
```markdown
# {TASK-ID}: {제목}

## 목표

{설명 또는 "목표를 작성해주세요."}

## 요구사항

- [ ] 요구사항 1
- [ ] 요구사항 2

## 기술적 결정사항

(작업 진행 중 결정된 사항을 기록)

## 진행 노트

### {생성일자}
- 태스크 생성됨
```

**출력 형식**:
```
✅ 태스크 생성 완료

| 항목 | 값 |
|------|-----|
| ID | TASK-001 |
| 제목 | {제목} |
| 우선순위 | {우선순위 이모지} {우선순위} |
| 상태 | 📋 준비 |
| 컨텍스트 | .claude/tasks/TASK-001/context.md |

시작하려면: /project:task-start TASK-001
```

**우선순위 이모지 매핑**:
- critical: 🔴
- high: 🟠
- medium: 🟡
- low: 🟢

---

### task:list - 태스크 목록 조회

**입력**:
- `status` (선택): 필터할 상태
- `priority` (선택): 필터할 우선순위

**처리 순서**:
1. `.claude/tasks/registry.json` 파일 읽기
2. 필터 조건이 있으면 적용
3. 상태별로 그룹화하여 출력

**출력 형식**:
```
📋 태스크 목록

## 📋 준비 (READY)
| ID | 제목 | 우선순위 | 생성일 |
|----|------|----------|--------|
| TASK-001 | 로그인 API | 🟠 high | 2025-01-27 |

## 🔄 진행 중 (IN_PROGRESS)
(해당 태스크 없음)

## 👀 검수 대기 (REVIEW)
(해당 태스크 없음)

## ✅ 완료 (DONE)
(해당 태스크 없음)

## 🏁 종료 (CLOSED)
(해당 태스크 없음)

---
총 1개 태스크
```

---

### task:get - 태스크 상세 조회

**입력**:
- `task_id` (필수): 조회할 태스크 ID

**처리 순서**:
1. `.claude/tasks/registry.json` 파일 읽기
2. 해당 ID의 태스크 찾기
3. 없으면 에러 메시지 출력
4. 있으면 상세 정보 출력

**출력 형식**:
```
## TASK-001: 로그인 API 구현

| 항목 | 값 |
|------|-----|
| 상태 | 🔄 진행 중 |
| 우선순위 | 🟠 high |
| 생성일 | 2025-01-27 09:00 |
| 수정일 | 2025-01-27 14:30 |
| 브랜치 | feature/TASK-001 |
| 컨텍스트 | .claude/tasks/TASK-001/context.md |

### 설명
JWT 기반 인증 API 개발

### 피드백 히스토리
(없음)
```

**에러 출력**:
```
❌ 태스크를 찾을 수 없습니다: TASK-999

사용 가능한 태스크 목록을 보려면: /project:task-list
```

---

### task:update - 태스크 정보 수정

**입력**:
- `task_id` (필수): 수정할 태스크 ID
- `title` (선택): 새 제목
- `description` (선택): 새 설명
- `priority` (선택): 새 우선순위

**처리 순서**:
1. `.claude/tasks/registry.json` 파일 읽기
2. 해당 ID의 태스크 찾기
3. 없으면 에러
4. 입력된 필드만 업데이트
5. `updated_at`을 현재 시간으로 갱신
6. `registry.json` 저장

---

### task:transition - 상태 전이

**입력**:
- `task_id` (필수): 태스크 ID
- `target_state` (필수): 목표 상태
- `feedback` (선택): 피드백 내용 (REVIEW → IN_PROGRESS 시)

**처리 순서**:
1. `.claude/tasks/registry.json` 파일 읽기
2. 해당 ID의 태스크 찾기
3. 상태 전이 유효성 검사 (Orchestrator Skill 참조)
4. 유효하지 않으면 에러
5. 상태 변경 및 관련 필드 업데이트:
   - `IN_PROGRESS` 진입 시: `started_at` 설정
   - `DONE` 진입 시: `completed_at` 설정
6. `updated_at` 갱신
7. `registry.json` 저장

**상태별 이모지**:
- READY: 📋
- IN_PROGRESS: 🔄
- REVIEW: 👀
- DONE: ✅
- CLOSED: 🏁
- CANCELLED: ❌
```

---

## Step 5: Orchestrator Skill

### 5.1 파일: `.claude/skills/orchestrator/SKILL.md`

```markdown
# Orchestrator Skill

## 목적

태스크 상태 전이 규칙을 정의하고, 전이 시 실행할 액션을 관리합니다.

## 상태 전이 규칙

### 허용된 전이

| 현재 상태 | 허용된 다음 상태 | 조건 |
|----------|-----------------|------|
| READY | IN_PROGRESS | 없음 |
| READY | CANCELLED | 없음 |
| IN_PROGRESS | REVIEW | 없음 (Phase 2에서 테스트 통과 조건 추가) |
| IN_PROGRESS | CANCELLED | 없음 |
| REVIEW | DONE | 없음 |
| REVIEW | IN_PROGRESS | feedback 필수 |
| DONE | CLOSED | 없음 |

### 금지된 전이

다음 전이는 허용되지 않습니다:
- CLOSED → 모든 상태 (종료된 태스크는 재개 불가)
- CANCELLED → 모든 상태 (취소된 태스크는 재개 불가)
- REVIEW → READY (준비 상태로 되돌릴 수 없음)
- DONE → IN_PROGRESS (완료 후 다시 진행 불가, 새 태스크 생성 필요)

### 전이 유효성 검사 로직

```
function isValidTransition(currentState, targetState, feedback):
    validTransitions = {
        "READY": ["IN_PROGRESS", "CANCELLED"],
        "IN_PROGRESS": ["REVIEW", "CANCELLED"],
        "REVIEW": ["DONE", "IN_PROGRESS"],
        "DONE": ["CLOSED"],
        "CLOSED": [],
        "CANCELLED": []
    }
    
    if targetState not in validTransitions[currentState]:
        return { valid: false, reason: "허용되지 않은 상태 전이입니다." }
    
    if currentState == "REVIEW" and targetState == "IN_PROGRESS":
        if not feedback or feedback.trim() == "":
            return { valid: false, reason: "피드백 없이 반려할 수 없습니다." }
    
    return { valid: true }
```

## 전이 시 자동 액션 (Phase 1)

### READY → IN_PROGRESS

1. `started_at` 필드를 현재 시간으로 설정
2. `branch` 필드를 `feature/{TASK-ID}`로 설정
3. 컨텍스트 파일에 진행 노트 추가:
   ```markdown
   ### {현재 날짜}
   - 태스크 시작됨
   ```

**출력**:
```
🚀 태스크 시작: {TASK-ID} - {제목}

📁 브랜치: feature/{TASK-ID}
📄 컨텍스트: {context_file}

작업을 시작합니다.
```

### IN_PROGRESS → REVIEW

1. 컨텍스트 파일에 진행 노트 추가:
   ```markdown
   ### {현재 날짜}
   - 검수 요청됨
   ```

**출력**:
```
👀 검수 요청: {TASK-ID} - {제목}

개발자 확인을 기다립니다.
승인: /project:task-approve {TASK-ID}
반려: /project:task-reject {TASK-ID} --feedback "피드백 내용"
```

### REVIEW → IN_PROGRESS (반려)

1. `feedback_history`에 피드백 추가:
   ```json
   {
     "id": "FB-{timestamp}",
     "content": "{피드백 내용}",
     "created_at": "{현재 시간}",
     "resolved": false,
     "resolved_at": null
   }
   ```
2. 컨텍스트 파일에 피드백 기록:
   ```markdown
   ### {현재 날짜}
   - [피드백] {피드백 내용}
   ```

**출력**:
```
🔄 피드백 반영 필요: {TASK-ID}

피드백: {피드백 내용}

작업을 계속합니다.
```

### REVIEW → DONE

1. `completed_at` 필드를 현재 시간으로 설정
2. 모든 미해결 피드백의 `resolved`를 true로, `resolved_at`을 현재 시간으로 설정
3. 컨텍스트 파일에 기록:
   ```markdown
   ### {현재 날짜}
   - 검수 승인됨
   ```

**출력**:
```
✅ 검수 승인: {TASK-ID} - {제목}

최종 확인 후 종료하려면: /project:task-complete {TASK-ID}
```

### DONE → CLOSED

1. 컨텍스트 파일에 기록:
   ```markdown
   ### {현재 날짜}
   - 태스크 종료됨
   ```

**출력**:
```
🏁 태스크 종료: {TASK-ID} - {제목}

총 소요 시간: {started_at부터 completed_at까지 계산}
```

### * → CANCELLED

1. 컨텍스트 파일에 기록:
   ```markdown
   ### {현재 날짜}
   - 태스크 취소됨
   ```

**출력**:
```
❌ 태스크 취소됨: {TASK-ID} - {제목}
```

## 에러 메시지

### 유효하지 않은 전이
```
❌ 상태 전이 실패

현재 상태: {현재 상태}
요청한 상태: {목표 상태}
사유: {reason}

허용된 전이: {현재 상태에서 허용된 상태 목록}
```

### 피드백 누락
```
❌ 피드백이 필요합니다

검수 반려 시 피드백을 제공해야 합니다.

사용법: /project:task-reject {TASK-ID} --feedback "피드백 내용"
```
```

---

## Step 6: Custom Commands

### 6.1 파일: `.claude/commands/task-create.md`

```markdown
---
description: 새로운 개발 태스크를 생성합니다
arguments:
  - name: title
    description: 태스크 제목
    required: true
  - name: --priority
    description: 우선순위 (critical, high, medium, low)
    required: false
    default: medium
  - name: --description
    description: 태스크 상세 설명
    required: false
---

# Task Create

새로운 개발 태스크를 생성합니다.

## 실행 지침

1. `.claude/skills/task-management/SKILL.md`의 `task:create` 작업을 참조하세요.
2. 입력된 인자를 파싱하세요:
   - 첫 번째 인자: title (따옴표로 감싸진 경우 처리)
   - --priority 플래그: 우선순위
   - --description 플래그: 설명
3. `task:create` 작업을 실행하세요.
4. 결과를 지정된 형식으로 출력하세요.

## 사용 예시

```
/project:task-create "로그인 API 구현"
/project:task-create "버그 수정" --priority high
/project:task-create "회원가입 기능" --priority critical --description "이메일 인증 포함"
```
```

### 6.2 파일: `.claude/commands/task-list.md`

```markdown
---
description: 태스크 목록을 조회합니다
arguments:
  - name: --status
    description: 필터할 상태
    required: false
  - name: --priority
    description: 필터할 우선순위
    required: false
---

# Task List

모든 태스크를 상태별로 그룹화하여 조회합니다.

## 실행 지침

1. `.claude/skills/task-management/SKILL.md`의 `task:list` 작업을 참조하세요.
2. 선택적 필터를 적용하세요.
3. 결과를 지정된 형식으로 출력하세요.

## 사용 예시

```
/project:task-list
/project:task-list --status READY
/project:task-list --priority high
```
```

### 6.3 파일: `.claude/commands/task-start.md`

```markdown
---
description: 태스크를 시작합니다 (READY → IN_PROGRESS)
arguments:
  - name: task_id
    description: 시작할 태스크 ID
    required: true
---

# Task Start

준비 상태의 태스크를 시작합니다.

## 실행 지침

1. `.claude/skills/task-management/SKILL.md`에서 태스크를 조회하세요.
2. `.claude/skills/orchestrator/SKILL.md`의 상태 전이 규칙을 확인하세요.
3. 현재 상태가 READY인지 확인하세요.
4. READY가 아니면 에러 메시지를 출력하세요.
5. `task:transition`을 실행하여 IN_PROGRESS로 전이하세요.
6. Orchestrator의 "READY → IN_PROGRESS" 액션을 실행하세요.

## 사용 예시

```
/project:task-start TASK-001
```

## 에러 케이스

### 태스크가 READY 상태가 아닌 경우
```
❌ 태스크를 시작할 수 없습니다

태스크 {TASK-ID}의 현재 상태: {현재 상태}
시작하려면 READY 상태여야 합니다.
```
```

### 6.4 파일: `.claude/commands/task-get.md`

```markdown
---
description: 태스크 상세 정보를 조회합니다
arguments:
  - name: task_id
    description: 조회할 태스크 ID
    required: true
---

# Task Get

특정 태스크의 상세 정보를 조회합니다.

## 실행 지침

1. `.claude/skills/task-management/SKILL.md`의 `task:get` 작업을 참조하세요.
2. 태스크 ID로 조회하세요.
3. 결과를 지정된 형식으로 출력하세요.

## 사용 예시

```
/project:task-get TASK-001
```
```

### 6.5 파일: `.claude/commands/conductor-init.md`

```markdown
---
description: Claude Conductor 초기 설정을 수행합니다
---

# Conductor Init

프로젝트에 Claude Conductor를 초기화합니다.

## 실행 지침

다음 순서로 초기화를 수행하세요:

### 1. 디렉토리 구조 확인 및 생성

```bash
mkdir -p .claude/{skills/{orchestrator,task-management,code-review,changelog,dev-server,api-docs,dashboard},commands,tasks,servers}
```

### 2. Registry 파일 초기화

`.claude/tasks/registry.json`이 없으면 생성:
```json
{
  "version": "1.0.0",
  "counter": 0,
  "tasks": {}
}
```

`.claude/servers/registry.json`이 없으면 생성:
```json
{
  "version": "1.0.0",
  "servers": {}
}
```

### 3. 초기화 완료 메시지 출력

```
✅ Claude Conductor 초기화 완료

생성된 구조:
.claude/
├── skills/          (7개 Skill 디렉토리)
├── commands/        (명령어 정의)
├── tasks/           (태스크 저장소)
└── servers/         (서버 정보)

사용 가능한 명령어:
- /project:task-create "제목" : 새 태스크 생성
- /project:task-list         : 태스크 목록 조회
- /project:task-start ID     : 태스크 시작
- /project:task-get ID       : 태스크 상세 조회
```

## 사용 예시

```
/project:conductor-init
```
```

---

## Step 7: 검증 테스트 시나리오

Phase 1 구현이 완료되면 다음 시나리오를 순서대로 실행하여 검증합니다.

### 테스트 1: 초기화

```
입력: /project:conductor-init
예상: 디렉토리 구조 생성, registry 파일 초기화
검증: .claude/ 하위 폴더 및 파일 존재 확인
```

### 테스트 2: 태스크 생성

```
입력: /project:task-create "로그인 API 구현" --priority high
예상: TASK-001 생성
검증:
  - .claude/tasks/registry.json에 TASK-001 존재
  - .claude/tasks/TASK-001/context.md 파일 존재
  - 출력에 "✅ 태스크 생성 완료" 포함
```

### 테스트 3: 태스크 목록 조회

```
입력: /project:task-list
예상: TASK-001이 "준비" 상태로 표시
검증: 출력에 "TASK-001 | 로그인 API 구현 | 🟠 high" 포함
```

### 테스트 4: 태스크 상세 조회

```
입력: /project:task-get TASK-001
예상: TASK-001 상세 정보 출력
검증: 출력에 제목, 상태, 우선순위, 컨텍스트 경로 포함
```

### 테스트 5: 태스크 시작

```
입력: /project:task-start TASK-001
예상: 상태가 IN_PROGRESS로 변경
검증:
  - registry.json의 status가 "IN_PROGRESS"
  - started_at 필드에 값 존재
  - branch 필드가 "feature/TASK-001"
  - context.md에 "태스크 시작됨" 기록
```

### 테스트 6: 중복 시작 방지

```
입력: /project:task-start TASK-001 (이미 시작된 태스크)
예상: 에러 메시지 출력
검증: "시작하려면 READY 상태여야 합니다" 메시지 포함
```

### 테스트 7: 존재하지 않는 태스크

```
입력: /project:task-get TASK-999
예상: 에러 메시지 출력
검증: "태스크를 찾을 수 없습니다" 메시지 포함
```

---

## 부록: 파일 체크섬

구현 완료 후 다음 파일들이 존재해야 합니다:

| 파일 경로 | 필수 |
|----------|:----:|
| .claude/CLAUDE.md | ✅ |
| .claude/skills/task-management/SKILL.md | ✅ |
| .claude/skills/orchestrator/SKILL.md | ✅ |
| .claude/commands/task-create.md | ✅ |
| .claude/commands/task-list.md | ✅ |
| .claude/commands/task-start.md | ✅ |
| .claude/commands/task-get.md | ✅ |
| .claude/commands/conductor-init.md | ✅ |
| .claude/tasks/registry.json | ✅ |
| .claude/servers/registry.json | ✅ |

---

*Phase 1 상세 스펙 문서 끝*
*다음: Phase 2 - Docker MCP 인프라 구축*
