# Claude Conductor - Phase 2 상세 구현 스펙

> **목표**: Docker 기반 MCP 인프라 구축 - Conductor MCP 서버, Redis, 프로젝트 감지기
> **예상 소요**: 2주
> **선행 조건**: Phase 1 완료, Docker 및 Docker Compose 설치, Node.js 24+

---

## 📋 구현 체크리스트

- [ ] `docker-compose up -d` 실행 시 모든 컨테이너 정상 기동
- [ ] `docker-compose ps`에서 conductor-mcp, redis 상태 healthy
- [ ] `claude mcp list`에서 conductor 서버 등록 확인
- [ ] MCP를 통한 `task_create` 도구 호출 성공
- [ ] MCP를 통한 `task_list` 도구 호출 성공
- [ ] Redis에 이벤트 발행 확인
- [ ] Go-Gin 프로젝트 자동 감지 성공
- [ ] **멀티 프로젝트**: `project_create`, `project_list`, `project_select` 도구 동작
- [ ] **프로젝트 필터링**: `task_list`에서 `project_id` 필터 동작

---

## 멀티 프로젝트 관리 (신규)

### 개요

사용자가 여러 프로젝트를 관리하고 프로젝트별로 태스크를 필터링할 수 있도록 지원합니다.

### 데이터 저장소

```
.claude/
├── projects/
│   └── registry.json           # 프로젝트 레지스트리
└── tasks/
    └── registry.json           # 태스크 레지스트리 (project_id 포함)
```

### MCP 도구 정의

#### `project_create` - 프로젝트 생성

```typescript
{
  name: 'project_create',
  description: '새 프로젝트를 생성합니다',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '프로젝트 이름' },
      path: { type: 'string', description: '프로젝트 경로 (선택, 기본값: 현재 디렉토리)' }
    },
    required: ['name']
  }
}
```

**출력 형식**:
```
✅ 프로젝트 생성 완료

| 항목 | 값 |
|------|-----|
| ID | PRJ-001 |
| 이름 | my-api-server |
| 경로 | /workspace/my-api-server |

프로젝트 선택: project_select PRJ-001
```

#### `project_list` - 프로젝트 목록 조회

```typescript
{
  name: 'project_list',
  description: '등록된 프로젝트 목록을 조회합니다',
  inputSchema: {
    type: 'object',
    properties: {
      active_only: { type: 'boolean', default: true }
    }
  }
}
```

**출력 형식**:
```
📁 프로젝트 목록

| ID | 이름 | 경로 | 태스크 수 | 상태 |
|----|------|------|----------|------|
| PRJ-001 | my-api-server | /workspace/my-api | 5 | ✅ 선택됨 |
| PRJ-002 | frontend-app | /workspace/frontend | 3 | - |

총 2개 프로젝트
```

#### `project_select` - 프로젝트 선택

```typescript
{
  name: 'project_select',
  description: '작업할 프로젝트를 선택합니다. 이후 태스크 조회/생성은 해당 프로젝트 기준',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', description: '선택할 프로젝트 ID' }
    },
    required: ['project_id']
  }
}
```

**출력 형식**:
```
✅ 프로젝트 선택됨: PRJ-001 (my-api-server)

현재 프로젝트의 태스크를 보려면: task_list
```

### task_list 필터링 확장

```typescript
{
  name: 'task_list',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string' },
      priority: { type: 'string' },
      project_id: { type: 'string', description: '프로젝트 ID (생략 시 현재 선택된 프로젝트)' },
      all_projects: { type: 'boolean', default: false, description: '모든 프로젝트의 태스크 조회' }
    }
  }
}
```

### task_create 확장

```typescript
{
  name: 'task_create',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'string' },
      project_id: { type: 'string', description: '프로젝트 ID (생략 시 현재 선택된 프로젝트)' }
    },
    required: ['title']
  }
}
```

### 핸들러 구현

#### 파일: `src/handlers/project.handler.ts`

```typescript
import type { Project, ProjectRegistry } from '../types/index.js';
import { readProjectRegistry, writeProjectRegistry } from '../utils/registry.js';
import { nowISO } from '../utils/date.js';

type EventPublisher = (event: string, data: any) => Promise<void>;

function generateProjectId(counter: number): string {
  return `PRJ-${String(counter).padStart(3, '0')}`;
}

export async function handleProjectCreate(
  input: { name: string; path?: string },
  publish: EventPublisher
) {
  const registry = await readProjectRegistry();
  registry.counter += 1;
  const projectId = generateProjectId(registry.counter);
  const now = nowISO();

  const project: Project = {
    id: projectId,
    name: input.name,
    path: input.path || process.env.WORKSPACE_DIR || '/workspace',
    created_at: now,
    updated_at: now,
    active: true,
  };

  registry.projects[projectId] = project;

  // 첫 프로젝트면 자동 선택
  if (!registry.current_project_id) {
    registry.current_project_id = projectId;
  }

  await writeProjectRegistry(registry);
  await publish('project.created', { project });

  return {
    content: [{
      type: 'text',
      text: `✅ 프로젝트 생성 완료\n\n| 항목 | 값 |\n|------|-----|\n| ID | ${project.id} |\n| 이름 | ${project.name} |\n| 경로 | ${project.path} |\n\n프로젝트 선택: project_select ${project.id}`
    }]
  };
}

export async function handleProjectList(input: { active_only?: boolean }) {
  const registry = await readProjectRegistry();
  let projects = Object.values(registry.projects);

  if (input.active_only !== false) {
    projects = projects.filter(p => p.active);
  }

  if (projects.length === 0) {
    return {
      content: [{
        type: 'text',
        text: '📁 등록된 프로젝트가 없습니다.\n\n새 프로젝트 생성: project_create name="프로젝트명"'
      }]
    };
  }

  let response = '📁 프로젝트 목록\n\n| ID | 이름 | 경로 | 상태 |\n|----|------|------|------|\n';

  for (const p of projects) {
    const isSelected = p.id === registry.current_project_id;
    response += `| ${p.id} | ${p.name} | ${p.path} | ${isSelected ? '✅ 선택됨' : '-'} |\n`;
  }

  response += `\n총 ${projects.length}개 프로젝트`;

  return { content: [{ type: 'text', text: response }] };
}

export async function handleProjectSelect(input: { project_id: string }) {
  const registry = await readProjectRegistry();
  const project = registry.projects[input.project_id];

  if (!project) {
    return {
      content: [{
        type: 'text',
        text: `❌ 프로젝트를 찾을 수 없습니다: ${input.project_id}`
      }],
      isError: true
    };
  }

  registry.current_project_id = input.project_id;
  await writeProjectRegistry(registry);

  return {
    content: [{
      type: 'text',
      text: `✅ 프로젝트 선택됨: ${project.id} (${project.name})\n\n현재 프로젝트의 태스크를 보려면: task_list`
    }]
  };
}
```

---

## 기술 결정사항 (확정)

| 항목 | 선택 | 근거 |
|------|------|------|
| MCP 서버 런타임 | Node.js 24 + TypeScript | MCP SDK 공식 지원 |
| 패키지 매니저 | pnpm | 빠른 설치, 디스크 효율 |
| 빌드 도구 | tsup | 빠른 번들링, ESM 지원 |
| 이벤트 큐 | Redis 7 | 경량, Pub/Sub 지원 |
| MCP 전송 방식 | stdio | Claude Code 기본 지원 |

---

## Step 1: 디렉토리 구조 생성

```bash
mkdir -p conductor-mcp/{services/{conductor/{src/{handlers,detectors,utils,types},tests},dashboard,git,notification},scripts,data/conductor}
```

### 생성 구조

```
conductor-mcp/
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── .gitignore
├── scripts/
│   ├── register.sh
│   ├── start.sh
│   ├── stop.sh
│   └── logs.sh
├── data/
│   └── conductor/
└── services/
    └── conductor/
        ├── Dockerfile
        ├── Dockerfile.dev
        ├── package.json
        ├── tsconfig.json
        ├── tsup.config.ts
        └── src/
            ├── index.ts
            ├── server.ts
            ├── handlers/
            ├── detectors/
            ├── utils/
            └── types/
```

---

## Step 2: 환경 설정 파일

### 파일: `conductor-mcp/.env.example`

```bash
PROJECT_ROOT=..
REDIS_URL=redis://redis:6379
DATA_DIR=/data/conductor
WORKSPACE_DIR=/workspace
LOG_LEVEL=info
NODE_ENV=production
MCP_SERVER_NAME=claude-conductor
MCP_SERVER_VERSION=1.0.0
```

### 파일: `conductor-mcp/.gitignore`

```gitignore
.env
.env.local
node_modules/
dist/
*.log
.DS_Store
coverage/
```

---

## Step 3: Docker Compose 설정

> **아키텍처 변경 (2025-01-28)**
>
> 개발 편의성을 위해 conductor-mcp와 dashboard는 **로컬 Node.js로 실행**하고,
> **Redis만 Docker로 실행**하는 방식으로 변경되었습니다.
>
> 상세 내용은 `spec/SPEC_UPDATES_2025_01_28.md` 참조.

### 파일: `conductor-mcp/docker-compose.yml` (현재 사용 버전)

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: conductor-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
    restart: unless-stopped
    networks:
      - conductor-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  conductor-data:
    driver: local
  redis-data:
    driver: local

networks:
  conductor-network:
    driver: bridge
```

### 파일: `conductor-mcp/docker-compose.dev.yml`

```yaml
version: '3.8'

services:
  conductor-mcp:
    build:
      context: ./services/conductor
      dockerfile: Dockerfile.dev
    volumes:
      - ./services/conductor/src:/app/src:ro
      - ./services/conductor/package.json:/app/package.json:ro
      - conductor-data:/data/conductor
      - ${PROJECT_ROOT:-.}:/workspace:ro
      - ${PROJECT_ROOT:-.}/.claude:/workspace/.claude:rw
    environment:
      - NODE_ENV=development
      - LOG_LEVEL=debug
    command: pnpm dev
```

---

## Step 4: Conductor MCP 서버 - 기본 설정

### 파일: `conductor-mcp/services/conductor/package.json`

```json
{
  "name": "@conductor/mcp-server",
  "version": "1.0.0",
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
    "glob": "^10.3.10"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
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

### 파일: `conductor-mcp/services/conductor/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 파일: `conductor-mcp/services/conductor/tsup.config.ts`

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node24',
});
```

### 파일: `conductor-mcp/services/conductor/Dockerfile`

```dockerfile
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src/ ./src/
RUN pnpm build

FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
RUN mkdir -p /data/conductor
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

### 파일: `conductor-mcp/services/conductor/Dockerfile.dev`

```dockerfile
FROM node:24-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install
COPY tsconfig.json tsup.config.ts ./
RUN mkdir -p /data/conductor
ENV NODE_ENV=development
CMD ["pnpm", "dev"]
```

---

## Step 5: 타입 정의

### 파일: `conductor-mcp/services/conductor/src/types/index.ts`

```typescript
export * from './task.types.js';
export * from './server.types.js';
```

### 파일: `conductor-mcp/services/conductor/src/types/task.types.ts`

```typescript
// BACKLOG 상태 추가 (2025-01-28 업데이트)
export type TaskStatus = 'BACKLOG' | 'READY' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CLOSED';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Feedback {
  id: string;
  content: string;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  branch: string | null;
  context_file: string;
  changelog_versions: number[];
  feedback_history: Feedback[];
}

export interface TaskRegistry {
  version: string;
  counter: number;
  tasks: Record<string, Task>;
}

// 상태 전이 규칙 (2025-01-28 업데이트: BACKLOG 추가, CANCELLED 제거)
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  BACKLOG: ['READY'],
  READY: ['IN_PROGRESS', 'BACKLOG'],
  IN_PROGRESS: ['REVIEW', 'BACKLOG'],
  REVIEW: ['DONE', 'IN_PROGRESS', 'BACKLOG'],
  DONE: ['CLOSED'],
  CLOSED: [],
};

export const STATUS_EMOJI: Record<TaskStatus, string> = {
  BACKLOG: '📦', READY: '📋', IN_PROGRESS: '🔄', REVIEW: '👀',
  DONE: '✅', CLOSED: '🏁',
};

export const PRIORITY_EMOJI: Record<TaskPriority, string> = {
  critical: '🔴', high: '🟠', medium: '🟡', low: '🟢',
};
```

### 파일: `conductor-mcp/services/conductor/src/types/server.types.ts`

```typescript
export type ServerStatus = 'running' | 'stopped' | 'error' | 'starting';
export type ServerType = 'nextjs' | 'vite' | 'express' | 'nestjs' | 'fastapi' | 'django' | 'flask' | 'spring' | 'go-gin' | 'unknown';

export interface ServerConfig {
  type: ServerType;
  port: number;
  command: string;
  healthCheck?: string;
  apiDocs?: { swagger?: string; redoc?: string; openapi_json?: string };
  env?: Record<string, string>;
}

export interface RunningServer {
  task_id: string;
  type: ServerType;
  port: number;
  pid: number | null;
  status: ServerStatus;
  started_at: string;
  url: string;
  api_docs?: { swagger?: string; redoc?: string; openapi_json?: string };
}

export interface ServerRegistry {
  version: string;
  servers: Record<string, RunningServer>;
}

export interface DetectionResult {
  detected: boolean;
  type: ServerType;
  config?: ServerConfig;
  confidence: number;
}
```

---

*계속: Part 2에서 유틸리티, 감지기, 핸들러, 서버 구현*
# Claude Conductor - Phase 2 상세 구현 스펙 (Part 2)

> Part 1에서 이어집니다.

---

## Step 6: 유틸리티 함수

### 파일: `conductor-mcp/services/conductor/src/utils/index.ts`

```typescript
export * from './registry.js';
export * from './file.js';
export * from './date.js';
```

### 파일: `conductor-mcp/services/conductor/src/utils/registry.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import type { TaskRegistry, ServerRegistry } from '../types/index.js';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';

export function getTaskRegistryPath(): string {
  return path.join(WORKSPACE_DIR, '.claude', 'tasks', 'registry.json');
}

export function getServerRegistryPath(): string {
  return path.join(WORKSPACE_DIR, '.claude', 'servers', 'registry.json');
}

export function getTaskContextPath(taskId: string): string {
  return path.join(WORKSPACE_DIR, '.claude', 'tasks', taskId, 'context.md');
}

export function getTaskDirPath(taskId: string): string {
  return path.join(WORKSPACE_DIR, '.claude', 'tasks', taskId);
}

export async function readTaskRegistry(): Promise<TaskRegistry> {
  try {
    const content = await fs.readFile(getTaskRegistryPath(), 'utf-8');
    return JSON.parse(content) as TaskRegistry;
  } catch {
    return { version: '1.0.0', counter: 0, tasks: {} };
  }
}

export async function writeTaskRegistry(registry: TaskRegistry): Promise<void> {
  const registryPath = getTaskRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

export async function readServerRegistry(): Promise<ServerRegistry> {
  try {
    const content = await fs.readFile(getServerRegistryPath(), 'utf-8');
    return JSON.parse(content) as ServerRegistry;
  } catch {
    return { version: '1.0.0', servers: {} };
  }
}

export async function writeServerRegistry(registry: ServerRegistry): Promise<void> {
  const registryPath = getServerRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}
```

### 파일: `conductor-mcp/services/conductor/src/utils/file.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}
```

### 파일: `conductor-mcp/services/conductor/src/utils/date.ts`

```typescript
import { format, formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

export function nowISO(): string {
  return new Date().toISOString();
}

export function formatKorean(isoString: string): string {
  return format(new Date(isoString), 'yyyy-MM-dd HH:mm', { locale: ko });
}

export function formatDateOnly(isoString: string): string {
  return format(new Date(isoString), 'yyyy-MM-dd');
}

export function calculateDuration(startISO: string, endISO: string): string {
  const diffMs = new Date(endISO).getTime() - new Date(startISO).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}
```

---

## Step 7: 프로젝트 감지기

### 파일: `conductor-mcp/services/conductor/src/detectors/index.ts`

```typescript
import type { DetectionResult } from '../types/index.js';
import { detectNextjs } from './nextjs.detector.js';
import { detectVite } from './vite.detector.js';
import { detectExpress } from './express.detector.js';
import { detectFastAPI } from './fastapi.detector.js';
import { detectNestJS } from './nestjs.detector.js';
import { detectSpring } from './spring.detector.js';
import { detectGoGin } from './go-gin.detector.js';

export async function detectProject(workspacePath: string): Promise<DetectionResult> {
  const detectors = [
    detectNextjs, detectVite, detectExpress, detectNestJS,
    detectFastAPI, detectSpring, detectGoGin,
  ];

  let bestResult: DetectionResult = { detected: false, type: 'unknown', confidence: 0 };

  for (const detector of detectors) {
    try {
      const result = await detector(workspacePath);
      if (result.detected && result.confidence > bestResult.confidence) {
        bestResult = result;
      }
    } catch (error) {
      console.error(`Detector failed:`, error);
    }
  }

  return bestResult;
}

export { detectNextjs, detectVite, detectExpress, detectFastAPI, detectNestJS, detectSpring, detectGoGin };
```

### 파일: `conductor-mcp/services/conductor/src/detectors/base.detector.ts`

```typescript
import * as path from 'path';
import { readFileOrNull, fileExists } from '../utils/file.js';

export async function readPackageJson(workspacePath: string): Promise<any | null> {
  const content = await readFileOrNull(path.join(workspacePath, 'package.json'));
  if (!content) return null;
  try { return JSON.parse(content); } catch { return null; }
}

export async function hasDependency(workspacePath: string, depName: string): Promise<boolean> {
  const pkg = await readPackageJson(workspacePath);
  if (!pkg) return false;
  return depName in { ...pkg.dependencies, ...pkg.devDependencies };
}

export async function hasFilePattern(workspacePath: string, patterns: string[]): Promise<boolean> {
  for (const pattern of patterns) {
    if (await fileExists(path.join(workspacePath, pattern))) return true;
  }
  return false;
}

export async function hasGoModule(workspacePath: string, moduleName: string): Promise<boolean> {
  const content = await readFileOrNull(path.join(workspacePath, 'go.mod'));
  return content ? content.includes(moduleName) : false;
}

export async function hasPythonPackage(workspacePath: string, packageName: string): Promise<boolean> {
  const reqContent = await readFileOrNull(path.join(workspacePath, 'requirements.txt'));
  if (reqContent?.toLowerCase().includes(packageName.toLowerCase())) return true;
  const pyContent = await readFileOrNull(path.join(workspacePath, 'pyproject.toml'));
  return pyContent?.toLowerCase().includes(packageName.toLowerCase()) ?? false;
}
```

### 파일: `conductor-mcp/services/conductor/src/detectors/go-gin.detector.ts`

```typescript
import * as path from 'path';
import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasGoModule, hasFilePattern, readFileOrNull } from './base.detector.js';
import { fileExists } from '../utils/file.js';

export async function detectGoGin(workspacePath: string): Promise<DetectionResult> {
  const hasGoMod = await hasFilePattern(workspacePath, ['go.mod']);
  if (!hasGoMod) return { detected: false, type: 'go-gin', confidence: 0 };

  const hasGin = await hasGoModule(workspacePath, 'github.com/gin-gonic/gin');
  if (!hasGin) return { detected: false, type: 'go-gin', confidence: 0 };

  let confidence = 80;
  if (await hasFilePattern(workspacePath, ['main.go', 'cmd/main.go'])) confidence += 10;

  const hasAir = await fileExists(path.join(workspacePath, '.air.toml'));
  const hasSwag = await hasFilePattern(workspacePath, ['docs/swagger.json', 'docs/swagger.yaml']);

  const config: ServerConfig = {
    type: 'go-gin',
    port: 8080,
    command: hasAir ? 'air' : 'go run main.go',
    healthCheck: '/health',
    apiDocs: hasSwag ? { swagger: '/swagger/index.html', openapi_json: '/swagger/doc.json' } : undefined,
    env: { GIN_MODE: 'debug', PORT: '8080' },
  };

  return { detected: true, type: 'go-gin', config, confidence };
}
```

### 파일: `conductor-mcp/services/conductor/src/detectors/nextjs.detector.ts`

```typescript
import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasDependency, hasFilePattern, readPackageJson } from './base.detector.js';

export async function detectNextjs(workspacePath: string): Promise<DetectionResult> {
  if (!(await hasDependency(workspacePath, 'next'))) {
    return { detected: false, type: 'nextjs', confidence: 0 };
  }

  let confidence = 70;
  if (await hasFilePattern(workspacePath, ['next.config.js', 'next.config.mjs', 'next.config.ts'])) confidence += 20;
  if (await hasFilePattern(workspacePath, ['app', 'pages', 'src/app', 'src/pages'])) confidence += 10;

  const config: ServerConfig = {
    type: 'nextjs', port: 3000, command: 'npm run dev',
    healthCheck: '/', env: { NODE_ENV: 'development' },
  };

  return { detected: true, type: 'nextjs', config, confidence };
}
```

### 파일: `conductor-mcp/services/conductor/src/detectors/vite.detector.ts`

```typescript
import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasDependency, hasFilePattern } from './base.detector.js';

export async function detectVite(workspacePath: string): Promise<DetectionResult> {
  if (!(await hasDependency(workspacePath, 'vite'))) {
    return { detected: false, type: 'vite', confidence: 0 };
  }

  let confidence = 70;
  if (await hasFilePattern(workspacePath, ['vite.config.js', 'vite.config.ts'])) confidence += 20;

  const config: ServerConfig = {
    type: 'vite', port: 5173, command: 'npm run dev',
    healthCheck: '/', env: { NODE_ENV: 'development' },
  };

  return { detected: true, type: 'vite', config, confidence };
}
```

### 파일: `conductor-mcp/services/conductor/src/detectors/express.detector.ts`

```typescript
import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasDependency } from './base.detector.js';

export async function detectExpress(workspacePath: string): Promise<DetectionResult> {
  if (!(await hasDependency(workspacePath, 'express'))) {
    return { detected: false, type: 'express', confidence: 0 };
  }

  const hasSwagger = await hasDependency(workspacePath, 'swagger-ui-express');

  const config: ServerConfig = {
    type: 'express', port: 3000, command: 'npm run start:dev',
    healthCheck: '/health',
    apiDocs: hasSwagger ? { swagger: '/api-docs', redoc: '/redoc' } : undefined,
    env: { NODE_ENV: 'development' },
  };

  return { detected: true, type: 'express', config, confidence: 70 };
}
```

### 파일: `conductor-mcp/services/conductor/src/detectors/fastapi.detector.ts`

```typescript
import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasPythonPackage, hasFilePattern } from './base.detector.js';

export async function detectFastAPI(workspacePath: string): Promise<DetectionResult> {
  if (!(await hasPythonPackage(workspacePath, 'fastapi'))) {
    return { detected: false, type: 'fastapi', confidence: 0 };
  }

  let confidence = 80;
  if (await hasFilePattern(workspacePath, ['main.py', 'app/main.py'])) confidence += 10;

  const config: ServerConfig = {
    type: 'fastapi', port: 8000,
    command: 'uvicorn main:app --reload --host 0.0.0.0 --port 8000',
    healthCheck: '/health',
    apiDocs: { swagger: '/docs', redoc: '/redoc', openapi_json: '/openapi.json' },
    env: { PYTHONUNBUFFERED: '1' },
  };

  return { detected: true, type: 'fastapi', config, confidence };
}
```

### 파일: `conductor-mcp/services/conductor/src/detectors/nestjs.detector.ts`

```typescript
import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasDependency, hasFilePattern } from './base.detector.js';

export async function detectNestJS(workspacePath: string): Promise<DetectionResult> {
  if (!(await hasDependency(workspacePath, '@nestjs/core'))) {
    return { detected: false, type: 'nestjs', confidence: 0 };
  }

  let confidence = 85;
  if (await hasFilePattern(workspacePath, ['nest-cli.json'])) confidence += 10;
  const hasSwagger = await hasDependency(workspacePath, '@nestjs/swagger');

  const config: ServerConfig = {
    type: 'nestjs', port: 3000, command: 'npm run start:dev',
    healthCheck: '/health',
    apiDocs: hasSwagger ? { swagger: '/api', openapi_json: '/api-json' } : undefined,
    env: { NODE_ENV: 'development' },
  };

  return { detected: true, type: 'nestjs', config, confidence };
}
```

### 파일: `conductor-mcp/services/conductor/src/detectors/spring.detector.ts`

```typescript
import * as path from 'path';
import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasFilePattern, readFileOrNull } from './base.detector.js';

export async function detectSpring(workspacePath: string): Promise<DetectionResult> {
  const hasMaven = await hasFilePattern(workspacePath, ['pom.xml']);
  const hasGradle = await hasFilePattern(workspacePath, ['build.gradle', 'build.gradle.kts']);

  if (!hasMaven && !hasGradle) return { detected: false, type: 'spring', confidence: 0 };

  let hasSpringBoot = false;

  if (hasMaven) {
    const pom = await readFileOrNull(path.join(workspacePath, 'pom.xml'));
    if (pom?.includes('spring-boot')) hasSpringBoot = true;
  }
  if (hasGradle) {
    const gradle = await readFileOrNull(path.join(workspacePath, 'build.gradle')) ||
                   await readFileOrNull(path.join(workspacePath, 'build.gradle.kts'));
    if (gradle?.includes('spring-boot')) hasSpringBoot = true;
  }

  if (!hasSpringBoot) return { detected: false, type: 'spring', confidence: 0 };

  const config: ServerConfig = {
    type: 'spring', port: 8080,
    command: hasGradle ? './gradlew bootRun' : './mvnw spring-boot:run',
    healthCheck: '/actuator/health',
    apiDocs: { swagger: '/swagger-ui.html', openapi_json: '/v3/api-docs' },
    env: { SPRING_PROFILES_ACTIVE: 'dev' },
  };

  return { detected: true, type: 'spring', config, confidence: 85 };
}
```

---

## Step 8: MCP 서버 구현

### 파일: `conductor-mcp/services/conductor/src/index.ts`

```typescript
import { createServer } from './server.js';

async function main() {
  console.error('[Conductor MCP] Starting server...');
  try {
    await createServer();
    console.error('[Conductor MCP] Server started successfully');
  } catch (error) {
    console.error('[Conductor MCP] Failed to start:', error);
    process.exit(1);
  }
}

main();
```

### 파일: `conductor-mcp/services/conductor/src/server.ts`

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Redis } from 'ioredis';

import { handleTaskCreate, handleTaskList, handleTaskGet, handleTaskStart, handleTaskTransition } from './handlers/task.handler.js';
import { handleServerStart, handleServerStop, handleServerStatus } from './handlers/server.handler.js';
import { handleChangelogGenerate } from './handlers/changelog.handler.js';
import { readTaskRegistry, readServerRegistry } from './utils/registry.js';

let redis: Redis | null = null;

async function initRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      redis = new Redis(redisUrl);
      console.error('[Conductor MCP] Redis connected');
    } catch (error) {
      console.error('[Conductor MCP] Redis connection failed:', error);
    }
  }
}

export async function publishEvent(event: string, data: any): Promise<void> {
  if (redis) {
    await redis.publish('conductor:events', JSON.stringify({ event, data, timestamp: new Date().toISOString() }));
  }
}

export async function createServer(): Promise<Server> {
  await initRedis();

  const server = new Server(
    { name: process.env.MCP_SERVER_NAME || 'claude-conductor', version: process.env.MCP_SERVER_VERSION || '1.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  // Tools 정의
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'task_create', description: '새 태스크 생성', inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], default: 'medium' } }, required: ['title'] } },
      { name: 'task_list', description: '태스크 목록 조회', inputSchema: { type: 'object', properties: { status: { type: 'string' }, priority: { type: 'string' } } } },
      { name: 'task_get', description: '태스크 상세 조회', inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] } },
      { name: 'task_start', description: '태스크 시작', inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] } },
      { name: 'task_transition', description: '상태 전이', inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, target_state: { type: 'string' }, feedback: { type: 'string' } }, required: ['task_id', 'target_state'] } },
      { name: 'server_start', description: '개발 서버 시작', inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, port: { type: 'number' } }, required: ['task_id'] } },
      { name: 'server_stop', description: '개발 서버 종료', inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] } },
      { name: 'server_status', description: '서버 상태 조회', inputSchema: { type: 'object', properties: {} } },
      { name: 'changelog_generate', description: 'CHANGELOG 생성', inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, from_commit: { type: 'string' }, to_commit: { type: 'string' } }, required: ['task_id'] } },
    ],
  }));

  // Tool 실행
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'task_create': return await handleTaskCreate(args as any, publishEvent);
        case 'task_list': return await handleTaskList(args as any);
        case 'task_get': return await handleTaskGet(args as any);
        case 'task_start': return await handleTaskStart(args as any, publishEvent);
        case 'task_transition': return await handleTaskTransition(args as any, publishEvent);
        case 'server_start': return await handleServerStart(args as any, publishEvent);
        case 'server_stop': return await handleServerStop(args as any, publishEvent);
        case 'server_status': return await handleServerStatus();
        case 'changelog_generate': return await handleChangelogGenerate(args as any);
        default: return { content: [{ type: 'text', text: `알 수 없는 도구: ${name}` }], isError: true };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: `오류: ${error instanceof Error ? error.message : error}` }], isError: true };
    }
  });

  // Resources 정의
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: 'conductor://tasks', name: '전체 태스크', mimeType: 'application/json' },
      { uri: 'conductor://servers', name: '실행 중인 서버', mimeType: 'application/json' },
      { uri: 'conductor://changelog', name: '프로젝트 CHANGELOG', mimeType: 'text/markdown' },
    ],
  }));

  // Resource 읽기
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    switch (uri) {
      case 'conductor://tasks':
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify((await readTaskRegistry()).tasks, null, 2) }] };
      case 'conductor://servers':
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify((await readServerRegistry()).servers, null, 2) }] };
      default:
        throw new Error(`알 수 없는 리소스: ${uri}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
```

---

## Step 9: 핸들러 구현

### 파일: `conductor-mcp/services/conductor/src/handlers/index.ts`

```typescript
export * from './task.handler.js';
export * from './server.handler.js';
export * from './changelog.handler.js';
```

### 파일: `conductor-mcp/services/conductor/src/handlers/task.handler.ts`

```typescript
import * as fs from 'fs/promises';
import type { Task, TaskStatus, TaskPriority, VALID_TRANSITIONS, STATUS_EMOJI, PRIORITY_EMOJI } from '../types/index.js';
import { readTaskRegistry, writeTaskRegistry, getTaskContextPath, getTaskDirPath } from '../utils/registry.js';
import { nowISO, formatKorean, formatDateOnly, calculateDuration } from '../utils/date.js';
import { ensureDir } from '../utils/file.js';

type EventPublisher = (event: string, data: any) => Promise<void>;

const STATUS_EMOJI: Record<TaskStatus, string> = { READY: '📋', IN_PROGRESS: '🔄', REVIEW: '👀', DONE: '✅', CLOSED: '🏁', CANCELLED: '❌' };
const PRIORITY_EMOJI: Record<TaskPriority, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  READY: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['REVIEW', 'CANCELLED'],
  REVIEW: ['DONE', 'IN_PROGRESS'], DONE: ['CLOSED'], CLOSED: [], CANCELLED: [],
};

function generateTaskId(counter: number): string {
  return `TASK-${String(counter).padStart(3, '0')}`;
}

function createContextTemplate(task: Task): string {
  return `# ${task.id}: ${task.title}\n\n## 목표\n\n${task.description || '목표를 작성해주세요.'}\n\n## 요구사항\n\n- [ ] 요구사항 1\n\n## 진행 노트\n\n### ${formatDateOnly(task.created_at)}\n- 태스크 생성됨\n`;
}

export async function handleTaskCreate(input: { title: string; description?: string; priority?: TaskPriority }, publish: EventPublisher) {
  const registry = await readTaskRegistry();
  registry.counter += 1;
  const taskId = generateTaskId(registry.counter);
  const now = nowISO();

  const task: Task = {
    id: taskId, title: input.title, description: input.description || '',
    status: 'READY', priority: input.priority || 'medium',
    created_at: now, updated_at: now, started_at: null, completed_at: null,
    branch: null, context_file: `.claude/tasks/${taskId}/context.md`,
    changelog_versions: [], feedback_history: [],
  };

  registry.tasks[taskId] = task;
  await writeTaskRegistry(registry);
  await ensureDir(getTaskDirPath(taskId));
  await fs.writeFile(getTaskContextPath(taskId), createContextTemplate(task), 'utf-8');
  await publish('task.created', { task });

  return { content: [{ type: 'text', text: `✅ 태스크 생성 완료\n\n| 항목 | 값 |\n|------|-----|\n| ID | ${task.id} |\n| 제목 | ${task.title} |\n| 우선순위 | ${PRIORITY_EMOJI[task.priority]} ${task.priority} |\n| 상태 | 📋 준비 |\n\n시작하려면: /project:task-start ${task.id}` }] };
}

export async function handleTaskList(input: { status?: TaskStatus; priority?: TaskPriority }) {
  const registry = await readTaskRegistry();
  let tasks = Object.values(registry.tasks);
  if (input.status) tasks = tasks.filter(t => t.status === input.status);
  if (input.priority) tasks = tasks.filter(t => t.priority === input.priority);

  const groups: Record<TaskStatus, Task[]> = { READY: [], IN_PROGRESS: [], REVIEW: [], DONE: [], CLOSED: [], CANCELLED: [] };
  for (const task of tasks) groups[task.status].push(task);

  let response = '📋 태스크 목록\n\n';
  const labels: Record<TaskStatus, string> = { READY: '📋 준비', IN_PROGRESS: '🔄 진행 중', REVIEW: '👀 검수 대기', DONE: '✅ 완료', CLOSED: '🏁 종료', CANCELLED: '❌ 취소' };

  for (const [status, label] of Object.entries(labels)) {
    const statusTasks = groups[status as TaskStatus];
    response += `## ${label}\n`;
    if (statusTasks.length === 0) {
      response += '(해당 태스크 없음)\n\n';
    } else {
      response += '| ID | 제목 | 우선순위 | 생성일 |\n|----|------|----------|--------|\n';
      for (const t of statusTasks) response += `| ${t.id} | ${t.title} | ${PRIORITY_EMOJI[t.priority]} ${t.priority} | ${formatDateOnly(t.created_at)} |\n`;
      response += '\n';
    }
  }
  response += `---\n총 ${tasks.length}개 태스크`;
  return { content: [{ type: 'text', text: response }] };
}

export async function handleTaskGet(input: { task_id: string }) {
  const registry = await readTaskRegistry();
  const task = registry.tasks[input.task_id];
  if (!task) return { content: [{ type: 'text', text: `❌ 태스크를 찾을 수 없습니다: ${input.task_id}` }], isError: true };

  return { content: [{ type: 'text', text: `## ${task.id}: ${task.title}\n\n| 항목 | 값 |\n|------|-----|\n| 상태 | ${STATUS_EMOJI[task.status]} ${task.status} |\n| 우선순위 | ${PRIORITY_EMOJI[task.priority]} ${task.priority} |\n| 생성일 | ${formatKorean(task.created_at)} |\n| 컨텍스트 | ${task.context_file} |` }] };
}

export async function handleTaskStart(input: { task_id: string }, publish: EventPublisher) {
  const registry = await readTaskRegistry();
  const task = registry.tasks[input.task_id];
  if (!task) return { content: [{ type: 'text', text: `❌ 태스크를 찾을 수 없습니다: ${input.task_id}` }], isError: true };
  if (task.status !== 'READY') return { content: [{ type: 'text', text: `❌ 시작하려면 READY 상태여야 합니다. 현재: ${task.status}` }], isError: true };

  const now = nowISO();
  task.status = 'IN_PROGRESS';
  task.started_at = now;
  task.updated_at = now;
  task.branch = `feature/${task.id}`;
  await writeTaskRegistry(registry);
  await fs.appendFile(getTaskContextPath(task.id), `\n### ${formatDateOnly(now)}\n- 태스크 시작됨\n`, 'utf-8');
  await publish('task.started', { task });

  return { content: [{ type: 'text', text: `🚀 태스크 시작: ${task.id} - ${task.title}\n\n📁 브랜치: ${task.branch}\n📄 컨텍스트: ${task.context_file}` }] };
}

export async function handleTaskTransition(input: { task_id: string; target_state: TaskStatus; feedback?: string }, publish: EventPublisher) {
  const registry = await readTaskRegistry();
  const task = registry.tasks[input.task_id];
  if (!task) return { content: [{ type: 'text', text: `❌ 태스크를 찾을 수 없습니다: ${input.task_id}` }], isError: true };

  if (!VALID_TRANSITIONS[task.status].includes(input.target_state)) {
    return { content: [{ type: 'text', text: `❌ 상태 전이 실패\n\n현재: ${task.status}\n요청: ${input.target_state}\n허용: ${VALID_TRANSITIONS[task.status].join(', ') || '없음'}` }], isError: true };
  }

  if (task.status === 'REVIEW' && input.target_state === 'IN_PROGRESS' && !input.feedback?.trim()) {
    return { content: [{ type: 'text', text: '❌ 반려 시 피드백이 필요합니다.' }], isError: true };
  }

  const now = nowISO();
  const prevStatus = task.status;
  task.status = input.target_state;
  task.updated_at = now;
  if (input.target_state === 'DONE') task.completed_at = now;
  if (input.feedback) task.feedback_history.push({ id: `FB-${Date.now()}`, content: input.feedback, created_at: now, resolved: false, resolved_at: null });

  await writeTaskRegistry(registry);
  await publish('task.transitioned', { task, from: prevStatus, to: input.target_state });

  return { content: [{ type: 'text', text: `${STATUS_EMOJI[input.target_state]} 상태 변경: ${task.id}\n\n${prevStatus} → ${input.target_state}` }] };
}
```

### 파일: `conductor-mcp/services/conductor/src/handlers/server.handler.ts`

```typescript
import { detectProject } from '../detectors/index.js';
import { readServerRegistry, writeServerRegistry } from '../utils/registry.js';
import { nowISO } from '../utils/date.js';

type EventPublisher = (event: string, data: any) => Promise<void>;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';

export async function handleServerStart(input: { task_id: string; port?: number }, publish: EventPublisher) {
  const detection = await detectProject(WORKSPACE_DIR);
  if (!detection.detected || !detection.config) {
    return { content: [{ type: 'text', text: '❌ 프로젝트 유형을 감지할 수 없습니다.' }], isError: true };
  }

  const config = detection.config;
  const port = input.port || config.port;
  const registry = await readServerRegistry();
  registry.servers[input.task_id] = {
    task_id: input.task_id, type: config.type, port, pid: null,
    status: 'starting', started_at: nowISO(), url: `http://localhost:${port}`,
    api_docs: config.apiDocs,
  };
  await writeServerRegistry(registry);
  await publish('server.starting', { task_id: input.task_id, config, port });

  let response = `🖥️ 서버 시작 준비\n\n| 항목 | 값 |\n|------|-----|\n| 유형 | ${config.type} |\n| 포트 | ${port} |\n| 명령어 | \`${config.command}\` |`;
  if (config.apiDocs?.swagger) response += `\n\n📚 API 문서: http://localhost:${port}${config.apiDocs.swagger}`;
  return { content: [{ type: 'text', text: response }] };
}

export async function handleServerStop(input: { task_id: string }, publish: EventPublisher) {
  const registry = await readServerRegistry();
  if (!registry.servers[input.task_id]) return { content: [{ type: 'text', text: '❌ 서버를 찾을 수 없습니다.' }], isError: true };
  delete registry.servers[input.task_id];
  await writeServerRegistry(registry);
  await publish('server.stopped', { task_id: input.task_id });
  return { content: [{ type: 'text', text: `🛑 서버 중지: ${input.task_id}` }] };
}

export async function handleServerStatus() {
  const registry = await readServerRegistry();
  const servers = Object.values(registry.servers);
  if (servers.length === 0) return { content: [{ type: 'text', text: '🖥️ 실행 중인 서버 없음' }] };

  let response = '🖥️ 실행 중인 서버\n\n| 태스크 | 유형 | 포트 | URL |\n|--------|------|------|-----|\n';
  for (const s of servers) response += `| ${s.task_id} | ${s.type} | ${s.port} | ${s.url} |\n`;
  return { content: [{ type: 'text', text: response }] };
}
```

### 파일: `conductor-mcp/services/conductor/src/handlers/changelog.handler.ts`

```typescript
export async function handleChangelogGenerate(input: { task_id: string; from_commit?: string; to_commit?: string }) {
  return { content: [{ type: 'text', text: `📝 CHANGELOG 생성 (Phase 3에서 구현 예정)\n\n태스크: ${input.task_id}` }] };
}
```

---

## Step 10: 스크립트

### 파일: `conductor-mcp/scripts/start.sh`

```bash
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 Claude Conductor 시작"
[ ! -f "$PROJECT_DIR/.env" ] && cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
mkdir -p "$PROJECT_DIR/data/conductor"
docker-compose -f "$PROJECT_DIR/docker-compose.yml" up -d
sleep 5
docker-compose -f "$PROJECT_DIR/docker-compose.yml" ps
echo "✅ 시작 완료! 다음: ./scripts/register.sh"
```

### 파일: `conductor-mcp/scripts/stop.sh`

```bash
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker-compose -f "$(dirname "$SCRIPT_DIR")/docker-compose.yml" down
echo "✅ 종료 완료"
```

### 파일: `conductor-mcp/scripts/register.sh`

```bash
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 MCP 서버 등록"
docker-compose -f "$PROJECT_DIR/docker-compose.yml" ps | grep -q "conductor-mcp" || {
    echo "⚠️ 컨테이너 시작..."
    docker-compose -f "$PROJECT_DIR/docker-compose.yml" up -d
    sleep 5
}

claude mcp add conductor --scope project -- docker exec -i conductor-mcp node dist/index.js
echo "✅ 등록 완료!"
claude mcp list
```

### 파일: `conductor-mcp/scripts/logs.sh`

```bash
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker-compose -f "$(dirname "$SCRIPT_DIR")/docker-compose.yml" logs -f "${1:-conductor-mcp}"
```

### 실행 권한 부여

```bash
chmod +x conductor-mcp/scripts/*.sh
```

---

## Step 11: 검증 테스트

| # | 테스트 | 명령어 | 예상 결과 |
|---|--------|--------|----------|
| 1 | Docker 시작 | `./scripts/start.sh` | 모든 컨테이너 healthy |
| 2 | Redis 확인 | `docker exec conductor-redis redis-cli ping` | PONG |
| 3 | MCP 등록 | `./scripts/register.sh` | conductor 등록 |
| 4 | 태스크 생성 | `task_create { title: "테스트" }` | TASK-001 생성 |
| 5 | 태스크 목록 | `task_list {}` | TASK-001 표시 |
| 6 | 태스크 시작 | `task_start { task_id: "TASK-001" }` | IN_PROGRESS 전이 |
| 7 | 이벤트 확인 | `redis-cli SUBSCRIBE conductor:events` | 이벤트 수신 |

---

## 부록: 파일 체크리스트

| 파일 | 필수 |
|------|:----:|
| conductor-mcp/docker-compose.yml | ✅ |
| conductor-mcp/.env.example | ✅ |
| conductor-mcp/scripts/*.sh | ✅ |
| conductor-mcp/services/conductor/Dockerfile | ✅ |
| conductor-mcp/services/conductor/package.json | ✅ |
| conductor-mcp/services/conductor/src/index.ts | ✅ |
| conductor-mcp/services/conductor/src/server.ts | ✅ |
| conductor-mcp/services/conductor/src/types/*.ts | ✅ |
| conductor-mcp/services/conductor/src/utils/*.ts | ✅ |
| conductor-mcp/services/conductor/src/detectors/*.ts | ✅ |
| conductor-mcp/services/conductor/src/handlers/*.ts | ✅ |

---

*Phase 2 상세 스펙 문서 끝*
*다음: Phase 3 - 핵심 기능 (Code Review, Changelog, Dev Server, API Docs)*
