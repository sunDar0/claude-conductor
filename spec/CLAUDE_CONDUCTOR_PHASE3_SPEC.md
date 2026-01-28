# Claude Conductor - Phase 3 상세 구현 스펙

> **목표**: 핵심 기능 구현 - Code Review, Changelog 자동 생성, Dev Server 관리, API Docs 통합
> **예상 소요**: 2주
> **선행 조건**: Phase 2 완료, Docker 스택 정상 동작

---

## 📋 구현 체크리스트

- [ ] Code Review: Git diff 기반 변경사항 분석 및 리뷰 포인트 제시
- [ ] Changelog: Conventional Commits 기반 CHANGELOG.md 자동 생성
- [ ] Dev Server: 실제 프로세스 시작/종료/로그/헬스체크
- [ ] API Docs: Swagger/OpenAPI 엔드포인트 자동 감지
- [ ] MCP 도구 6개 추가: `review_code`, `changelog_generate`, `server_logs`, `server_health`, `server_open`, `api_docs`

---

## 기술 결정사항

| 항목 | 선택 | 근거 |
|------|------|------|
| Git 연동 | simple-git | 경량, Promise 기반 |
| 프로세스 관리 | child_process + tree-kill | 크로스 플랫폼, 프로세스 트리 종료 |
| 포트 관리 | detect-port | 사용 가능한 포트 자동 탐지 |
| 템플릿 | **템플릿 리터럴** | 의존성 없음, 단순 |
| 브라우저 열기 | open | 크로스 플랫폼 |

---

## Step 1: 의존성 추가

### 파일: `conductor-mcp/services/conductor/package.json`

```json
{
  "name": "@conductor/mcp-server",
  "version": "1.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "test": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ioredis": "^5.3.2",
    "zod": "^3.22.4",
    "date-fns": "^3.3.1",
    "glob": "^10.3.10",
    "simple-git": "^3.22.0",
    "tree-kill": "^1.2.2",
    "detect-port": "^1.5.1",
    "open": "^10.0.3"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.3.3",
    "tsx": "^4.7.0",
    "tsup": "^8.0.1",
    "vitest": "^1.2.0"
  },
  "engines": {
    "node": ">=24.0.0"
  }
}
```

**추가된 의존성:**
- `simple-git`: Git 명령어 래퍼
- `tree-kill`: 프로세스 트리 종료
- `detect-port`: 포트 가용성 확인
- `open`: 브라우저 열기

---

## Step 2: 디렉토리 구조 확장

```
conductor-mcp/services/conductor/src/
├── index.ts
├── server.ts                    # MCP 서버 (도구 추가)
├── types/
│   ├── index.ts
│   ├── task.types.ts
│   ├── server.types.ts
│   ├── review.types.ts          # NEW
│   ├── changelog.types.ts       # NEW
│   └── process.types.ts         # NEW
├── utils/
│   ├── index.ts
│   ├── registry.ts
│   ├── file.ts
│   ├── date.ts
│   ├── git.ts                   # NEW
│   └── process-manager.ts       # NEW
├── detectors/
│   └── (기존 유지)
└── handlers/
    ├── index.ts
    ├── task.handler.ts
    ├── server.handler.ts        # 확장
    ├── changelog.handler.ts     # 확장
    └── review.handler.ts        # NEW
```

---

## Step 3: 타입 정의

### 파일: `src/types/review.types.ts`

```typescript
/**
 * 코드 리뷰 관련 타입
 */

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface ReviewPoint {
  file: string;
  line?: number;
  severity: 'info' | 'suggestion' | 'warning' | 'critical';
  category: ReviewCategory;
  message: string;
  suggestion?: string;
}

export type ReviewCategory =
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'style'
  | 'testing'
  | 'documentation';

export interface ReviewResult {
  task_id: string;
  branch: string;
  base_branch: string;
  files_changed: number;
  total_additions: number;
  total_deletions: number;
  changes: FileChange[];
  points: ReviewPoint[];
  summary: string;
  reviewed_at: string;
}

export interface ReviewInput {
  task_id: string;
  base_branch?: string;
}
```

### 파일: `src/types/changelog.types.ts`

```typescript
/**
 * Changelog 관련 타입
 */

export type ChangeType = 'Added' | 'Changed' | 'Deprecated' | 'Removed' | 'Fixed' | 'Security';

export interface ChangelogEntry {
  type: ChangeType;
  description: string;
  scope?: string;
  breaking?: boolean;
}

export interface ChangelogVersion {
  version: string;
  date: string;
  task_id: string;
  entries: ChangelogEntry[];
}

export interface ChangelogInput {
  task_id: string;
  version?: string;
  from_ref?: string;
  to_ref?: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface ParsedCommit {
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
}

/**
 * Conventional Commit → Changelog 타입 매핑
 */
export const COMMIT_TO_CHANGELOG: Record<string, ChangeType> = {
  feat: 'Added',
  fix: 'Fixed',
  docs: 'Changed',
  style: 'Changed',
  refactor: 'Changed',
  perf: 'Changed',
  test: 'Changed',
  chore: 'Changed',
  security: 'Security',
  deprecate: 'Deprecated',
  remove: 'Removed',
};
```

### 파일: `src/types/process.types.ts`

```typescript
/**
 * 프로세스 관리 관련 타입
 */

export type ProcessStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface ManagedProcess {
  task_id: string;
  pid: number;
  command: string;
  args: string[];
  cwd: string;
  port: number;
  status: ProcessStatus;
  started_at: string;
  stopped_at: string | null;
  exit_code: number | null;
  logs: string[];
}

export interface ProcessStartInput {
  task_id: string;
  command: string;
  args?: string[];
  cwd?: string;
  port?: number;
  env?: Record<string, string>;
}

export interface HealthCheckResult {
  task_id: string;
  healthy: boolean;
  status_code?: number;
  response_time_ms?: number;
  error?: string;
  checked_at: string;
}
```

### 파일: `src/types/index.ts` (수정)

```typescript
export * from './task.types.js';
export * from './server.types.js';
export * from './review.types.js';
export * from './changelog.types.js';
export * from './process.types.js';
```

---

## Step 4: Git 유틸리티

### 파일: `src/utils/git.ts`

```typescript
import simpleGit, { SimpleGit } from 'simple-git';
import type { FileChange, CommitInfo, ParsedCommit } from '../types/index.js';

const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace';

let git: SimpleGit | null = null;

/**
 * Git 인스턴스 가져오기
 */
export function getGit(): SimpleGit {
  if (!git) {
    git = simpleGit(WORKSPACE);
  }
  return git;
}

/**
 * 기본 브랜치 감지 (main 또는 master)
 */
export async function getDefaultBranch(): Promise<string> {
  const g = getGit();
  try {
    const branches = await g.branch();
    if (branches.all.includes('main')) return 'main';
    if (branches.all.includes('master')) return 'master';
    return branches.current || 'main';
  } catch {
    return 'main';
  }
}

/**
 * 현재 브랜치 가져오기
 */
export async function getCurrentBranch(): Promise<string> {
  const g = getGit();
  const status = await g.status();
  return status.current || 'HEAD';
}

/**
 * 브랜치 간 변경 파일 목록
 */
export async function getChangedFiles(base: string, target?: string): Promise<FileChange[]> {
  const g = getGit();
  const to = target || await getCurrentBranch();
  
  const diff = await g.diffSummary([`${base}...${to}`]);
  
  return diff.files.map(f => ({
    path: f.file,
    status: getFileStatus(f),
    additions: f.insertions,
    deletions: f.deletions,
  }));
}

function getFileStatus(f: any): FileChange['status'] {
  if (f.insertions > 0 && f.deletions === 0) return 'added';
  if (f.insertions === 0 && f.deletions > 0) return 'deleted';
  return 'modified';
}

/**
 * 커밋 목록 가져오기
 */
export async function getCommits(fromRef?: string, toRef?: string): Promise<CommitInfo[]> {
  const g = getGit();
  
  const options: any = { maxCount: 100 };
  if (fromRef) {
    options.from = fromRef;
    options.to = toRef || 'HEAD';
  }
  
  const log = await g.log(options);
  
  return log.all.map(c => ({
    hash: c.hash.substring(0, 7),
    message: c.message,
    author: c.author_name,
    date: c.date,
  }));
}

/**
 * Conventional Commit 파싱
 */
export function parseCommit(message: string): ParsedCommit | null {
  // 패턴: type(scope)!: description
  const match = message.match(/^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/);
  
  if (!match) return null;
  
  const [, type, scope, bang, description] = match;
  
  return {
    type: type.toLowerCase(),
    scope,
    breaking: !!bang || message.includes('BREAKING CHANGE'),
    description,
  };
}

/**
 * 브랜치 존재 여부
 */
export async function branchExists(name: string): Promise<boolean> {
  const g = getGit();
  const branches = await g.branch();
  return branches.all.includes(name);
}

/**
 * diff 상세 내용 가져오기 (특정 파일)
 */
export async function getFileDiff(base: string, filePath: string): Promise<string> {
  const g = getGit();
  const current = await getCurrentBranch();
  return g.diff([`${base}...${current}`, '--', filePath]);
}
```

---

## Step 5: 프로세스 관리자

### 파일: `src/utils/process-manager.ts`

```typescript
import { spawn, ChildProcess } from 'child_process';
import treeKill from 'tree-kill';
import detectPort from 'detect-port';
import type { ManagedProcess, ProcessStatus, HealthCheckResult } from '../types/index.js';
import { nowISO } from './date.js';

const MAX_LOG_LINES = 500;
const processes = new Map<string, ManagedProcess & { proc: ChildProcess }>();

/**
 * 사용 가능한 포트 찾기
 */
export async function findPort(preferred: number): Promise<number> {
  return detectPort(preferred);
}

/**
 * 프로세스 시작
 */
export async function startProcess(
  taskId: string,
  command: string,
  args: string[] = [],
  options: { cwd?: string; port?: number; env?: Record<string, string> } = {}
): Promise<ManagedProcess> {
  // 이미 실행 중인지 확인
  const existing = processes.get(taskId);
  if (existing && (existing.status === 'running' || existing.status === 'starting')) {
    throw new Error(`이미 실행 중: ${taskId}`);
  }

  const cwd = options.cwd || process.env.WORKSPACE_DIR || '/workspace';
  const port = options.port ? await findPort(options.port) : 0;
  
  const env = {
    ...process.env,
    ...options.env,
    PORT: String(port),
  };

  const proc = spawn(command, args, {
    cwd,
    env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const managed: ManagedProcess & { proc: ChildProcess } = {
    task_id: taskId,
    pid: proc.pid!,
    command,
    args,
    cwd,
    port,
    status: 'starting',
    started_at: nowISO(),
    stopped_at: null,
    exit_code: null,
    logs: [],
    proc,
  };

  // stdout 수집
  proc.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    managed.logs.push(...lines);
    if (managed.logs.length > MAX_LOG_LINES) {
      managed.logs = managed.logs.slice(-MAX_LOG_LINES);
    }
    
    // 시작 완료 감지
    if (managed.status === 'starting') {
      const text = data.toString().toLowerCase();
      if (text.includes('listening') || text.includes('ready') || text.includes('started')) {
        managed.status = 'running';
      }
    }
  });

  // stderr 수집
  proc.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    managed.logs.push(...lines.map(l => `[ERR] ${l}`));
    if (managed.logs.length > MAX_LOG_LINES) {
      managed.logs = managed.logs.slice(-MAX_LOG_LINES);
    }
  });

  // 종료 처리
  proc.on('exit', (code) => {
    managed.status = code === 0 ? 'stopped' : 'error';
    managed.stopped_at = nowISO();
    managed.exit_code = code;
  });

  proc.on('error', (err) => {
    managed.status = 'error';
    managed.logs.push(`[SYS] Error: ${err.message}`);
  });

  processes.set(taskId, managed);

  // 시작 대기 (최대 10초)
  await waitForRunning(taskId, 10000);

  return getProcessInfo(taskId)!;
}

/**
 * running 상태 대기
 */
async function waitForRunning(taskId: string, timeout: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const p = processes.get(taskId);
    if (!p) return;
    if (p.status === 'running' || p.status === 'error' || p.status === 'stopped') return;
    await new Promise(r => setTimeout(r, 200));
  }
  // 타임아웃 후에도 starting이면 running으로 간주
  const p = processes.get(taskId);
  if (p && p.status === 'starting') {
    p.status = 'running';
  }
}

/**
 * 프로세스 종료
 */
export async function stopProcess(taskId: string, force = false): Promise<void> {
  const managed = processes.get(taskId);
  if (!managed) {
    throw new Error(`프로세스 없음: ${taskId}`);
  }

  if (managed.status === 'stopped' || managed.status === 'error') {
    return;
  }

  managed.status = 'stopping';
  const signal = force ? 'SIGKILL' : 'SIGTERM';

  return new Promise((resolve, reject) => {
    treeKill(managed.pid, signal, (err) => {
      if (err) {
        managed.status = 'error';
        reject(err);
      } else {
        managed.status = 'stopped';
        managed.stopped_at = nowISO();
        resolve();
      }
    });

    // 5초 후 강제 종료
    setTimeout(() => {
      if (managed.status === 'stopping') {
        treeKill(managed.pid, 'SIGKILL');
      }
    }, 5000);
  });
}

/**
 * 프로세스 정보 조회 (ChildProcess 제외)
 */
export function getProcessInfo(taskId: string): ManagedProcess | null {
  const p = processes.get(taskId);
  if (!p) return null;
  
  const { proc, ...info } = p;
  return info;
}

/**
 * 모든 프로세스 목록
 */
export function getAllProcesses(): ManagedProcess[] {
  return Array.from(processes.values()).map(({ proc, ...info }) => info);
}

/**
 * 로그 조회
 */
export function getProcessLogs(taskId: string, lines = 50): string[] {
  const p = processes.get(taskId);
  if (!p) return [];
  return p.logs.slice(-lines);
}

/**
 * 헬스 체크
 */
export async function checkHealth(taskId: string): Promise<HealthCheckResult> {
  const p = processes.get(taskId);
  
  if (!p) {
    return {
      task_id: taskId,
      healthy: false,
      error: '프로세스 없음',
      checked_at: nowISO(),
    };
  }

  if (p.status !== 'running' || p.port === 0) {
    return {
      task_id: taskId,
      healthy: p.status === 'running',
      error: p.status !== 'running' ? `상태: ${p.status}` : undefined,
      checked_at: nowISO(),
    };
  }

  const start = Date.now();
  
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    
    // /health 먼저 시도
    let response = await fetch(`http://localhost:${p.port}/health`, {
      signal: controller.signal,
    }).catch(() => null);
    
    // 실패하면 / 시도
    if (!response || !response.ok) {
      response = await fetch(`http://localhost:${p.port}/`, {
        signal: controller.signal,
      });
    }
    
    return {
      task_id: taskId,
      healthy: response.ok,
      status_code: response.status,
      response_time_ms: Date.now() - start,
      checked_at: nowISO(),
    };
  } catch (err) {
    return {
      task_id: taskId,
      healthy: false,
      response_time_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      checked_at: nowISO(),
    };
  }
}

/**
 * 모든 프로세스 정리
 */
export async function cleanupAll(): Promise<void> {
  const tasks = Array.from(processes.keys());
  await Promise.all(tasks.map(t => stopProcess(t, true).catch(() => {})));
  processes.clear();
}

// 종료 시 정리
process.on('SIGINT', cleanupAll);
process.on('SIGTERM', cleanupAll);
```

---

## Step 6: 유틸리티 index 업데이트

### 파일: `src/utils/index.ts`

```typescript
export * from './registry.js';
export * from './file.js';
export * from './date.js';
export * from './git.js';
export * from './process-manager.js';
```

---

## Step 7: Code Review 핸들러

### 파일: `src/handlers/review.handler.ts`

```typescript
import type { ReviewInput, ReviewResult, ReviewPoint, FileChange } from '../types/index.js';
import { readTaskRegistry } from '../utils/registry.js';
import { getChangedFiles, getDefaultBranch, getCurrentBranch, getFileDiff } from '../utils/git.js';
import { nowISO } from '../utils/date.js';

type EventPublisher = (event: string, data: any) => Promise<void>;

/**
 * 코드 리뷰 수행
 */
export async function handleReviewCode(
  input: ReviewInput,
  publish: EventPublisher
) {
  const registry = await readTaskRegistry();
  const task = registry.tasks[input.task_id];

  if (!task) {
    return {
      content: [{ type: 'text', text: `❌ 태스크 없음: ${input.task_id}` }],
      isError: true,
    };
  }

  try {
    const baseBranch = input.base_branch || await getDefaultBranch();
    const currentBranch = await getCurrentBranch();
    
    const changes = await getChangedFiles(baseBranch);
    
    if (changes.length === 0) {
      return {
        content: [{ type: 'text', text: `ℹ️ ${baseBranch} 대비 변경사항 없음` }],
      };
    }

    // 변경사항 분석
    const points = await analyzeChanges(changes, baseBranch);
    
    const totalAdd = changes.reduce((s, c) => s + c.additions, 0);
    const totalDel = changes.reduce((s, c) => s + c.deletions, 0);

    const result: ReviewResult = {
      task_id: task.id,
      branch: currentBranch,
      base_branch: baseBranch,
      files_changed: changes.length,
      total_additions: totalAdd,
      total_deletions: totalDel,
      changes,
      points,
      summary: getSummary(points, changes.length),
      reviewed_at: nowISO(),
    };

    await publish('review.completed', { task_id: task.id, points_count: points.length });

    // 응답 생성
    const response = formatReviewResponse(result);
    return { content: [{ type: 'text', text: response }] };
    
  } catch (error) {
    return {
      content: [{ type: 'text', text: `❌ 리뷰 실패: ${error instanceof Error ? error.message : error}` }],
      isError: true,
    };
  }
}

/**
 * 변경사항 분석
 */
async function analyzeChanges(changes: FileChange[], baseBranch: string): Promise<ReviewPoint[]> {
  const points: ReviewPoint[] = [];

  for (const change of changes) {
    // .env 파일 체크
    if (change.path.includes('.env')) {
      points.push({
        file: change.path,
        severity: 'critical',
        category: 'security',
        message: '환경 변수 파일 변경됨. 민감 정보 확인 필요',
      });
    }

    // 큰 파일 경고
    if (change.additions > 300) {
      points.push({
        file: change.path,
        severity: 'suggestion',
        category: 'maintainability',
        message: `대규모 추가 (+${change.additions}줄). 파일 분할 고려`,
      });
    }

    // package.json 변경
    if (change.path.endsWith('package.json')) {
      points.push({
        file: change.path,
        severity: 'info',
        category: 'documentation',
        message: '의존성 변경됨. lock 파일도 확인',
      });
    }

    // 테스트 파일 없이 소스 추가
    const isSource = /\.(ts|js|tsx|jsx|py|go)$/.test(change.path) &&
                     !change.path.includes('test') &&
                     !change.path.includes('spec');
    if (isSource && change.status === 'added') {
      const hasTest = changes.some(c => c.path.includes('test') || c.path.includes('spec'));
      if (!hasTest) {
        points.push({
          file: change.path,
          severity: 'suggestion',
          category: 'testing',
          message: '새 파일에 테스트 추가 권장',
        });
      }
    }

    // JS/TS 파일 상세 분석
    if (/\.(ts|js|tsx|jsx)$/.test(change.path) && change.status !== 'deleted') {
      try {
        const diff = await getFileDiff(baseBranch, change.path);
        
        // console.log 체크
        if (/\+.*console\.(log|debug|info)/.test(diff)) {
          points.push({
            file: change.path,
            severity: 'suggestion',
            category: 'style',
            message: 'console 출력문 발견. 프로덕션 전 제거 권장',
          });
        }
        
        // TODO/FIXME 체크
        if (/\+.*(TODO|FIXME)/.test(diff)) {
          points.push({
            file: change.path,
            severity: 'info',
            category: 'documentation',
            message: 'TODO/FIXME 주석 추가됨',
          });
        }

        // 하드코딩된 시크릿 체크
        if (/\+.*(password|secret|api_key|apikey)\s*[=:]\s*['"][^'"]+/i.test(diff)) {
          points.push({
            file: change.path,
            severity: 'critical',
            category: 'security',
            message: '⚠️ 하드코딩된 시크릿 의심. 환경변수 사용 권장',
          });
        }
      } catch {
        // diff 실패 시 무시
      }
    }
  }

  return points;
}

/**
 * 요약 생성
 */
function getSummary(points: ReviewPoint[], fileCount: number): string {
  const critical = points.filter(p => p.severity === 'critical').length;
  const warning = points.filter(p => p.severity === 'warning').length;
  
  if (critical > 0) {
    return `⚠️ ${critical}개 중요 이슈 발견. 병합 전 반드시 확인 필요`;
  }
  if (warning > 0) {
    return `${warning}개 경고 발견. 검토 후 진행`;
  }
  if (fileCount > 20) {
    return '대규모 변경. 단계별 리뷰 권장';
  }
  return '✅ 전반적으로 양호. 병합 가능';
}

/**
 * 응답 포맷팅
 */
function formatReviewResponse(result: ReviewResult): string {
  const statusEmoji = (s: FileChange['status']) => {
    switch (s) {
      case 'added': return '✨';
      case 'modified': return '📝';
      case 'deleted': return '🗑️';
      default: return '📄';
    }
  };

  let output = `## 🔍 코드 리뷰: ${result.task_id}

### 변경 개요
| 항목 | 값 |
|------|-----|
| 브랜치 | \`${result.branch}\` → \`${result.base_branch}\` |
| 변경 파일 | ${result.files_changed}개 |
| 추가 | +${result.total_additions} 줄 |
| 삭제 | -${result.total_deletions} 줄 |

### 변경 파일
`;

  for (const c of result.changes.slice(0, 15)) {
    output += `- ${statusEmoji(c.status)} \`${c.path}\` (+${c.additions}/-${c.deletions})\n`;
  }
  if (result.changes.length > 15) {
    output += `- ... 외 ${result.changes.length - 15}개\n`;
  }

  output += `\n### 리뷰 포인트 (${result.points.length}개)\n`;

  if (result.points.length === 0) {
    output += '✅ 특별한 이슈 없음\n';
  } else {
    const grouped = {
      critical: result.points.filter(p => p.severity === 'critical'),
      warning: result.points.filter(p => p.severity === 'warning'),
      suggestion: result.points.filter(p => p.severity === 'suggestion'),
      info: result.points.filter(p => p.severity === 'info'),
    };

    if (grouped.critical.length > 0) {
      output += '\n#### 🔴 Critical\n';
      for (const p of grouped.critical) {
        output += `- **${p.file}**: ${p.message}\n`;
      }
    }
    if (grouped.warning.length > 0) {
      output += '\n#### 🟠 Warning\n';
      for (const p of grouped.warning) {
        output += `- **${p.file}**: ${p.message}\n`;
      }
    }
    if (grouped.suggestion.length > 0) {
      output += '\n#### 🟡 Suggestion\n';
      for (const p of grouped.suggestion.slice(0, 5)) {
        output += `- ${p.file}: ${p.message}\n`;
      }
      if (grouped.suggestion.length > 5) {
        output += `- ... 외 ${grouped.suggestion.length - 5}개\n`;
      }
    }
  }

  output += `\n### 요약\n${result.summary}`;

  return output;
}
```

---

## Step 8: Changelog 핸들러 (확장)

### 파일: `src/handlers/changelog.handler.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ChangelogInput, ChangelogEntry, ChangelogVersion, ChangeType } from '../types/index.js';
import { readTaskRegistry, writeTaskRegistry, getTaskDirPath } from '../utils/registry.js';
import { getCommits, parseCommit } from '../utils/git.js';
import { nowISO, formatDateOnly } from '../utils/date.js';
import { fileExists } from '../utils/file.js';

const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace';
const CHANGELOG_FILE = path.join(WORKSPACE, 'CHANGELOG.md');

const COMMIT_TO_CHANGELOG: Record<string, ChangeType> = {
  feat: 'Added',
  fix: 'Fixed',
  docs: 'Changed',
  style: 'Changed',
  refactor: 'Changed',
  perf: 'Changed',
  test: 'Changed',
  chore: 'Changed',
  security: 'Security',
  deprecate: 'Deprecated',
  remove: 'Removed',
};

type EventPublisher = (event: string, data: any) => Promise<void>;

/**
 * Changelog 생성
 */
export async function handleChangelogGenerate(
  input: ChangelogInput,
  publish?: EventPublisher
) {
  const registry = await readTaskRegistry();
  const task = registry.tasks[input.task_id];

  if (!task) {
    return {
      content: [{ type: 'text', text: `❌ 태스크 없음: ${input.task_id}` }],
      isError: true,
    };
  }

  try {
    const commits = await getCommits(input.from_ref, input.to_ref);
    
    if (commits.length === 0) {
      return {
        content: [{ type: 'text', text: 'ℹ️ 분석할 커밋 없음' }],
      };
    }

    // 커밋 분석
    const entries: ChangelogEntry[] = [];
    
    for (const commit of commits) {
      const parsed = parseCommit(commit.message);
      
      if (parsed) {
        const changeType = COMMIT_TO_CHANGELOG[parsed.type] || 'Changed';
        entries.push({
          type: changeType,
          description: parsed.description,
          scope: parsed.scope,
          breaking: parsed.breaking,
        });
      } else {
        entries.push({
          type: 'Changed',
          description: commit.message.split('\n')[0],
        });
      }
    }

    // 버전 결정
    const version = input.version || await nextVersion(entries);
    const today = formatDateOnly(nowISO());

    const changelogVersion: ChangelogVersion = {
      version,
      date: today,
      task_id: task.id,
      entries,
    };

    // 파일 업데이트
    await updateChangelogFile(changelogVersion);
    
    // 태스크별 changelog 저장
    const taskDir = getTaskDirPath(task.id);
    await fs.writeFile(
      path.join(taskDir, 'CHANGELOG.md'),
      formatVersion(changelogVersion),
      'utf-8'
    );

    // 레지스트리 업데이트
    const verNum = parseVersionNum(version);
    if (!task.changelog_versions.includes(verNum)) {
      task.changelog_versions.push(verNum);
      task.updated_at = nowISO();
      await writeTaskRegistry(registry);
    }

    if (publish) {
      await publish('changelog.generated', { task_id: task.id, version });
    }

    // 응답 생성
    const response = formatChangelogResponse(changelogVersion, commits.length);
    return { content: [{ type: 'text', text: response }] };

  } catch (error) {
    return {
      content: [{ type: 'text', text: `❌ Changelog 생성 실패: ${error instanceof Error ? error.message : error}` }],
      isError: true,
    };
  }
}

/**
 * 다음 버전 결정
 */
async function nextVersion(entries: ChangelogEntry[]): Promise<string> {
  let major = 0, minor = 0, patch = 1;

  if (await fileExists(CHANGELOG_FILE)) {
    const content = await fs.readFile(CHANGELOG_FILE, 'utf-8');
    const match = content.match(/## \[(\d+)\.(\d+)\.(\d+)\]/);
    if (match) {
      major = parseInt(match[1], 10);
      minor = parseInt(match[2], 10);
      patch = parseInt(match[3], 10);
    }
  }

  const hasBreaking = entries.some(e => e.breaking);
  const hasFeature = entries.some(e => e.type === 'Added');

  if (hasBreaking) {
    return `${major + 1}.0.0`;
  } else if (hasFeature) {
    return `${major}.${minor + 1}.0`;
  } else {
    return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * CHANGELOG.md 파일 업데이트
 */
async function updateChangelogFile(version: ChangelogVersion): Promise<void> {
  const header = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

`;

  const versionSection = formatVersion(version);
  
  let content: string;
  
  if (await fileExists(CHANGELOG_FILE)) {
    const existing = await fs.readFile(CHANGELOG_FILE, 'utf-8');
    const insertPoint = existing.indexOf('\n## ');
    if (insertPoint === -1) {
      content = existing.trimEnd() + '\n\n' + versionSection;
    } else {
      content = existing.slice(0, insertPoint) + '\n' + versionSection + existing.slice(insertPoint);
    }
  } else {
    content = header + versionSection;
  }

  await fs.writeFile(CHANGELOG_FILE, content, 'utf-8');
}

/**
 * 버전 섹션 포맷
 */
function formatVersion(v: ChangelogVersion): string {
  const grouped = groupByType(v.entries);
  
  let section = `## [${v.version}] - ${v.date}\n`;
  
  const order: ChangeType[] = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
  
  for (const type of order) {
    const items = grouped[type];
    if (items && items.length > 0) {
      section += `\n### ${type}\n`;
      for (const e of items) {
        const scope = e.scope ? `**${e.scope}**: ` : '';
        const breaking = e.breaking ? '**BREAKING**: ' : '';
        section += `- ${breaking}${scope}${e.description}\n`;
      }
    }
  }

  return section + '\n';
}

function groupByType(entries: ChangelogEntry[]): Record<ChangeType, ChangelogEntry[]> {
  const groups: Record<ChangeType, ChangelogEntry[]> = {
    Added: [], Changed: [], Deprecated: [], Removed: [], Fixed: [], Security: [],
  };
  for (const e of entries) {
    groups[e.type].push(e);
  }
  return groups;
}

function parseVersionNum(v: string): number {
  const [major, minor, patch] = v.split('.').map(Number);
  return major * 10000 + minor * 100 + patch;
}

/**
 * 응답 포맷
 */
function formatChangelogResponse(v: ChangelogVersion, commitCount: number): string {
  const grouped = groupByType(v.entries);
  
  let output = `## 📝 CHANGELOG 생성 완료

### 버전 정보
| 항목 | 값 |
|------|-----|
| 버전 | ${v.version} |
| 날짜 | ${v.date} |
| 태스크 | ${v.task_id} |
| 커밋 수 | ${commitCount}개 |
| 엔트리 수 | ${v.entries.length}개 |

### 변경 내용
`;

  const order: ChangeType[] = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
  
  for (const type of order) {
    const items = grouped[type];
    if (items && items.length > 0) {
      output += `\n#### ${type}\n`;
      for (const e of items) {
        const scope = e.scope ? `**${e.scope}**: ` : '';
        const breaking = e.breaking ? '⚠️ BREAKING: ' : '';
        output += `- ${breaking}${scope}${e.description}\n`;
      }
    }
  }

  output += `\n### 저장 위치
- 프로젝트: \`CHANGELOG.md\`
- 태스크: \`.claude/tasks/${v.task_id}/CHANGELOG.md\``;

  return output;
}
```

---

## Step 9: Server 핸들러 (확장)

### 파일: `src/handlers/server.handler.ts`

```typescript
import open from 'open';
import type { ServerStartInput, ServerStopInput } from '../types/index.js';
import { readTaskRegistry, readServerRegistry, writeServerRegistry } from '../utils/registry.js';
import { detectProject } from '../detectors/index.js';
import {
  startProcess,
  stopProcess,
  getProcessInfo,
  getAllProcesses,
  getProcessLogs,
  checkHealth,
  findPort,
} from '../utils/process-manager.js';
import { nowISO } from '../utils/date.js';

type EventPublisher = (event: string, data: any) => Promise<void>;
const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace';

/**
 * 서버 시작
 */
export async function handleServerStart(
  input: ServerStartInput,
  publish: EventPublisher
) {
  const taskRegistry = await readTaskRegistry();
  const task = taskRegistry.tasks[input.task_id];

  if (!task) {
    return {
      content: [{ type: 'text', text: `❌ 태스크 없음: ${input.task_id}` }],
      isError: true,
    };
  }

  const detection = await detectProject(WORKSPACE);
  if (!detection.detected || !detection.config) {
    return {
      content: [{ type: 'text', text: '❌ 프로젝트 유형 감지 불가' }],
      isError: true,
    };
  }

  const config = detection.config;
  const port = await findPort(input.port || config.port);

  try {
    const [cmd, ...args] = config.command.split(' ');
    const managed = await startProcess(input.task_id, cmd, args, {
      cwd: WORKSPACE,
      port,
      env: config.env,
    });

    // 레지스트리 업데이트
    const serverRegistry = await readServerRegistry();
    serverRegistry.servers[input.task_id] = {
      task_id: input.task_id,
      type: config.type,
      port,
      pid: managed.pid,
      status: managed.status === 'running' ? 'running' : 'starting',
      started_at: managed.started_at,
      url: `http://localhost:${port}`,
      api_docs: config.apiDocs,
    };
    await writeServerRegistry(serverRegistry);

    await publish('server.started', { task_id: input.task_id, port, pid: managed.pid });

    let response = `🚀 서버 시작됨

| 항목 | 값 |
|------|-----|
| 태스크 | ${input.task_id} |
| 유형 | ${config.type} |
| PID | ${managed.pid} |
| 포트 | ${port} |
| 상태 | ${managed.status} |
| URL | http://localhost:${port} |`;

    if (config.apiDocs) {
      response += '\n\n📚 **API 문서**:';
      if (config.apiDocs.swagger) {
        response += `\n- Swagger: http://localhost:${port}${config.apiDocs.swagger}`;
      }
      if (config.apiDocs.redoc) {
        response += `\n- Redoc: http://localhost:${port}${config.apiDocs.redoc}`;
      }
    }

    return { content: [{ type: 'text', text: response }] };

  } catch (error) {
    return {
      content: [{ type: 'text', text: `❌ 서버 시작 실패: ${error instanceof Error ? error.message : error}` }],
      isError: true,
    };
  }
}

/**
 * 서버 종료
 */
export async function handleServerStop(
  input: ServerStopInput,
  publish: EventPublisher
) {
  try {
    await stopProcess(input.task_id, input.force);

    const serverRegistry = await readServerRegistry();
    if (serverRegistry.servers[input.task_id]) {
      serverRegistry.servers[input.task_id].status = 'stopped';
    }
    await writeServerRegistry(serverRegistry);

    await publish('server.stopped', { task_id: input.task_id });

    return {
      content: [{ type: 'text', text: `🛑 서버 종료됨: ${input.task_id}` }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `❌ 종료 실패: ${error instanceof Error ? error.message : error}` }],
      isError: true,
    };
  }
}

/**
 * 서버 상태 목록
 */
export async function handleServerStatus() {
  const processes = getAllProcesses();

  if (processes.length === 0) {
    return { content: [{ type: 'text', text: '🖥️ 실행 중인 서버 없음' }] };
  }

  let response = '🖥️ **실행 중인 서버**\n\n';
  response += '| 태스크 | PID | 포트 | 상태 | URL |\n';
  response += '|--------|-----|------|------|-----|\n';

  for (const p of processes) {
    const emoji = p.status === 'running' ? '🟢' : p.status === 'starting' ? '🟡' : '🔴';
    response += `| ${p.task_id} | ${p.pid} | ${p.port} | ${emoji} ${p.status} | http://localhost:${p.port} |\n`;
  }

  return { content: [{ type: 'text', text: response }] };
}

/**
 * 서버 로그
 */
export async function handleServerLogs(input: { task_id: string; lines?: number }) {
  const logs = getProcessLogs(input.task_id, input.lines || 50);

  if (logs.length === 0) {
    return { content: [{ type: 'text', text: `ℹ️ ${input.task_id} 로그 없음` }] };
  }

  return {
    content: [{ type: 'text', text: `📋 **서버 로그: ${input.task_id}**\n\n\`\`\`\n${logs.join('\n')}\n\`\`\`` }],
  };
}

/**
 * 헬스 체크
 */
export async function handleServerHealth(input: { task_id: string }) {
  const result = await checkHealth(input.task_id);

  const emoji = result.healthy ? '✅' : '❌';
  let response = `${emoji} **헬스 체크: ${input.task_id}**\n\n`;
  response += `| 항목 | 값 |\n|------|-----|\n`;
  response += `| 상태 | ${result.healthy ? '정상' : '비정상'} |\n`;
  
  if (result.status_code) response += `| 응답 코드 | ${result.status_code} |\n`;
  if (result.response_time_ms) response += `| 응답 시간 | ${result.response_time_ms}ms |\n`;
  if (result.error) response += `| 오류 | ${result.error} |\n`;

  return { content: [{ type: 'text', text: response }] };
}

/**
 * 브라우저에서 열기
 */
export async function handleServerOpen(input: { task_id: string; path?: string }) {
  const proc = getProcessInfo(input.task_id);
  
  if (!proc || proc.status !== 'running') {
    return {
      content: [{ type: 'text', text: `❌ 실행 중인 서버 없음: ${input.task_id}` }],
      isError: true,
    };
  }

  const url = `http://localhost:${proc.port}${input.path || ''}`;
  await open(url);

  return { content: [{ type: 'text', text: `🌐 브라우저에서 열림: ${url}` }] };
}

/**
 * API 문서 URL 조회
 */
export async function handleApiDocs(input: { task_id?: string }) {
  const serverRegistry = await readServerRegistry();
  
  if (input.task_id) {
    const server = serverRegistry.servers[input.task_id];
    if (!server) {
      return {
        content: [{ type: 'text', text: `❌ 서버 없음: ${input.task_id}` }],
        isError: true,
      };
    }
    
    if (!server.api_docs) {
      return {
        content: [{ type: 'text', text: `ℹ️ ${input.task_id}: API 문서 미설정` }],
      };
    }
    
    let response = `📚 **API 문서: ${input.task_id}**\n\n`;
    if (server.api_docs.swagger) {
      response += `- Swagger: ${server.url}${server.api_docs.swagger}\n`;
    }
    if (server.api_docs.redoc) {
      response += `- Redoc: ${server.url}${server.api_docs.redoc}\n`;
    }
    if (server.api_docs.openapi_json) {
      response += `- OpenAPI JSON: ${server.url}${server.api_docs.openapi_json}\n`;
    }
    
    return { content: [{ type: 'text', text: response }] };
  }
  
  // 전체 목록
  const servers = Object.values(serverRegistry.servers);
  if (servers.length === 0) {
    return { content: [{ type: 'text', text: '🖥️ 실행 중인 서버 없음' }] };
  }
  
  let response = '📚 **API 문서 목록**\n\n';
  let hasAny = false;
  
  for (const s of servers) {
    if (s.api_docs) {
      hasAny = true;
      response += `### ${s.task_id} (${s.type})\n`;
      if (s.api_docs.swagger) response += `- Swagger: ${s.url}${s.api_docs.swagger}\n`;
      if (s.api_docs.redoc) response += `- Redoc: ${s.url}${s.api_docs.redoc}\n`;
      response += '\n';
    }
  }
  
  if (!hasAny) {
    response += '(API 문서 설정된 서버 없음)';
  }
  
  return { content: [{ type: 'text', text: response }] };
}
```

---

## Step 10: 핸들러 index 업데이트

### 파일: `src/handlers/index.ts`

```typescript
export * from './task.handler.js';
export * from './server.handler.js';
export * from './changelog.handler.js';
export * from './review.handler.js';
```

---

## Step 11: MCP 서버 업데이트

### 파일: `src/server.ts` (추가할 부분)

**import 추가:**

```typescript
import { handleReviewCode } from './handlers/review.handler.js';
import { handleChangelogGenerate } from './handlers/changelog.handler.js';
import {
  handleServerStart,
  handleServerStop,
  handleServerStatus,
  handleServerLogs,
  handleServerHealth,
  handleServerOpen,
  handleApiDocs,
} from './handlers/server.handler.js';
```

**tools 배열에 추가:**

```typescript
// === Phase 3 도구 추가 ===

// Code Review
{
  name: 'review_code',
  description: '코드 변경사항 분석 및 리뷰 포인트 제시',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: '태스크 ID' },
      base_branch: { type: 'string', description: '비교 대상 브랜치 (기본: main)' },
    },
    required: ['task_id'],
  },
},

// Changelog
{
  name: 'changelog_generate',
  description: 'Git 커밋 기반 CHANGELOG 자동 생성',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: '태스크 ID' },
      version: { type: 'string', description: '버전 (미지정 시 자동)' },
      from_ref: { type: 'string', description: '시작 커밋/태그' },
      to_ref: { type: 'string', description: '종료 커밋 (기본: HEAD)' },
    },
    required: ['task_id'],
  },
},

// Server Logs
{
  name: 'server_logs',
  description: '서버 로그 조회',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: '태스크 ID' },
      lines: { type: 'number', description: '줄 수 (기본: 50)' },
    },
    required: ['task_id'],
  },
},

// Server Health
{
  name: 'server_health',
  description: '서버 헬스 체크',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: '태스크 ID' },
    },
    required: ['task_id'],
  },
},

// Server Open
{
  name: 'server_open',
  description: '브라우저에서 서버 열기',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: '태스크 ID' },
      path: { type: 'string', description: '경로 (기본: /)' },
    },
    required: ['task_id'],
  },
},

// API Docs
{
  name: 'api_docs',
  description: 'API 문서 URL 조회',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: '태스크 ID (생략 시 전체)' },
    },
  },
},
```

**CallToolRequestSchema 핸들러에 추가:**

```typescript
// === Phase 3 케이스 추가 ===

case 'review_code':
  return await handleReviewCode(args as any, publishEvent);

case 'changelog_generate':
  return await handleChangelogGenerate(args as any, publishEvent);

case 'server_logs':
  return await handleServerLogs(args as any);

case 'server_health':
  return await handleServerHealth(args as any);

case 'server_open':
  return await handleServerOpen(args as any);

case 'api_docs':
  return await handleApiDocs(args as any);
```

---

## Step 12: 검증 테스트

### 테스트 1: Code Review

```bash
# MCP 호출
review_code { task_id: "TASK-001" }

# 예상 출력
## 🔍 코드 리뷰: TASK-001
### 변경 개요
| 항목 | 값 |
|------|-----|
| 브랜치 | `feature/TASK-001` → `main` |
| 변경 파일 | 5개 |
...
```

### 테스트 2: Changelog 생성

```bash
# MCP 호출
changelog_generate { task_id: "TASK-001" }

# 예상 출력
## 📝 CHANGELOG 생성 완료
### 버전 정보
| 버전 | 0.2.0 |
...

# 파일 확인
cat CHANGELOG.md
```

### 테스트 3: 서버 시작/로그/헬스

```bash
# 시작
server_start { task_id: "TASK-001" }

# 로그
server_logs { task_id: "TASK-001", lines: 20 }

# 헬스
server_health { task_id: "TASK-001" }

# 브라우저
server_open { task_id: "TASK-001" }

# 종료
server_stop { task_id: "TASK-001" }
```

### 테스트 4: API Docs

```bash
api_docs { task_id: "TASK-001" }
api_docs {}
```

---

## 부록: 파일 체크리스트

| 파일 | 상태 |
|------|:----:|
| `src/types/review.types.ts` | NEW |
| `src/types/changelog.types.ts` | NEW |
| `src/types/process.types.ts` | NEW |
| `src/types/index.ts` | 수정 |
| `src/utils/git.ts` | NEW |
| `src/utils/process-manager.ts` | NEW |
| `src/utils/index.ts` | 수정 |
| `src/handlers/review.handler.ts` | NEW |
| `src/handlers/changelog.handler.ts` | 수정 |
| `src/handlers/server.handler.ts` | 수정 |
| `src/handlers/index.ts` | 수정 |
| `src/server.ts` | 수정 |
| `package.json` | 수정 |

---

## 부록: MCP 도구 목록 (Phase 3 완료 후)

| 도구 | 설명 | Phase |
|------|------|:-----:|
| task_create | 태스크 생성 | 2 |
| task_list | 태스크 목록 | 2 |
| task_get | 태스크 조회 | 2 |
| task_start | 태스크 시작 | 2 |
| task_transition | 상태 전이 | 2 |
| server_start | 서버 시작 | 2 |
| server_stop | 서버 종료 | 2 |
| server_status | 서버 상태 | 2 |
| **review_code** | 코드 리뷰 | **3** |
| **changelog_generate** | Changelog 생성 | **3** |
| **server_logs** | 서버 로그 | **3** |
| **server_health** | 헬스 체크 | **3** |
| **server_open** | 브라우저 열기 | **3** |
| **api_docs** | API 문서 URL | **3** |

**총 14개 도구**

---

*Phase 3 상세 스펙 문서 끝*
*이전: Phase 2 - Docker MCP 인프라*
*다음: Phase 4 - 실시간 대시보드 (React)*
