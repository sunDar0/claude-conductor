# Claude Conductor - Phase 7 상세 구현 스펙 (Part A)

> **목표**: 고도화 및 폴리싱 - 멀티 프로젝트, 메트릭스, 프로덕션 최적화, 문서화
> **예상 소요**: 2-3주
> **선행 조건**: Phase 6 완료
> **최종 Phase**
> **범위**: Step 1-6 (기본 인프라)

---

## 📋 구현 체크리스트

- [ ] 멀티 프로젝트 지원
- [ ] 메트릭스 수집 및 분석
- [ ] 대시보드 통계 차트
- [ ] 프로덕션 최적화
- [ ] 구조화 로깅
- [ ] 백업/복원
- [ ] API 문서 사이트
- [ ] 사용자 가이드

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Claude Conductor - Production                       │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Multi-Project Manager                          │  │
│  │                                                                    │  │
│  │   Project A          Project B          Project C                 │  │
│  │   ┌──────────┐      ┌──────────┐      ┌──────────┐              │  │
│  │   │ Tasks    │      │ Tasks    │      │ Tasks    │              │  │
│  │   │ Agents   │      │ Agents   │      │ Agents   │              │  │
│  │   │ Servers  │      │ Servers  │      │ Servers  │              │  │
│  │   └──────────┘      └──────────┘      └──────────┘              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Metrics & Analytics                            │  │
│  │                                                                    │  │
│  │   ┌────────────┐  ┌────────────┐  ┌────────────┐                │  │
│  │   │ Collector  │  │ Aggregator │  │ Dashboard  │                │  │
│  │   │ (수집)     │  │ (집계)     │  │ (시각화)   │                │  │
│  │   └────────────┘  └────────────┘  └────────────┘                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Production Infrastructure                      │  │
│  │                                                                    │  │
│  │   ┌────────────┐  ┌────────────┐  ┌────────────┐                │  │
│  │   │ Logging    │  │ Health     │  │ Backup     │                │  │
│  │   │ (구조화)   │  │ Check      │  │ /Restore   │                │  │
│  │   └────────────┘  └────────────┘  └────────────┘                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Step 1: 디렉토리 구조 확장

```
conductor-mcp/
├── services/conductor/src/
│   ├── projects/                   # 멀티 프로젝트
│   │   ├── index.ts
│   │   ├── manager.ts
│   │   └── context.ts
│   │
│   ├── metrics/                    # 메트릭스
│   │   ├── index.ts
│   │   ├── collector.ts
│   │   ├── aggregator.ts
│   │   └── types.ts
│   │
│   ├── logging/                    # 구조화 로깅
│   │   ├── index.ts
│   │   ├── logger.ts
│   │   └── transports/
│   │       ├── console.ts
│   │       ├── file.ts
│   │       └── json.ts
│   │
│   ├── backup/                     # 백업/복원
│   │   ├── index.ts
│   │   ├── exporter.ts
│   │   └── importer.ts
│   │
│   └── handlers/
│       ├── project.handlers.ts
│       ├── metrics.handlers.ts
│       └── backup.handlers.ts
│
├── dashboard/src/
│   ├── components/
│   │   ├── charts/                 # 차트 컴포넌트
│   │   │   ├── TaskChart.tsx
│   │   │   ├── AgentChart.tsx
│   │   │   └── TimelineChart.tsx
│   │   └── projects/
│   │       ├── ProjectSelector.tsx
│   │       └── ProjectSettings.tsx
│   └── pages/
│       ├── Analytics.tsx
│       └── Settings.tsx
│
├── docs/                           # 문서 사이트
│   ├── docusaurus.config.js
│   ├── docs/
│   │   ├── getting-started.md
│   │   ├── installation.md
│   │   ├── configuration.md
│   │   ├── tools/
│   │   │   ├── task-tools.md
│   │   │   ├── server-tools.md
│   │   │   └── ...
│   │   └── api/
│   │       └── reference.md
│   └── static/
│
└── docker/
    ├── docker-compose.prod.yml
    ├── nginx/
    │   └── nginx.conf
    └── scripts/
        ├── backup.sh
        └── restore.sh
```

---

## Step 2: 타입 정의

### 파일: `src/types/project.types.ts`

```typescript
// ===========================================
// 프로젝트 관련 타입
// ===========================================

export interface Project {
  id: string;
  name: string;
  description?: string;
  root_path: string;
  created_at: string;
  updated_at: string;
  settings: ProjectSettings;
  stats: ProjectStats;
}

export interface ProjectSettings {
  // Git 설정
  git: {
    default_branch: string;
    remote?: string;
  };
  // 서버 설정
  servers: {
    auto_start: string[];         // 프로젝트 전환 시 자동 시작할 서버
  };
  // 알림 설정
  notifications: {
    enabled: boolean;
    channels?: string[];
  };
  // Agent 설정
  agents: {
    default_roles?: string[];
    max_concurrent?: number;
  };
}

export interface ProjectStats {
  total_tasks: number;
  completed_tasks: number;
  active_servers: number;
  last_activity: string;
}

export interface ProjectContext {
  project_id: string;
  project: Project;
  active: boolean;
}

// ===========================================
// 메트릭스 관련 타입
// ===========================================

export type MetricType =
  | 'counter'      // 누적 카운터
  | 'gauge'        // 현재 값
  | 'histogram'    // 분포
  | 'summary';     // 요약 통계

export interface Metric {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: string;
}

export interface MetricDefinition {
  name: string;
  type: MetricType;
  description: string;
  labels: string[];
}

export interface TaskMetrics {
  total: number;
  by_status: Record<string, number>;
  avg_completion_time_ms: number;
  completion_rate: number;
}

export interface AgentMetrics {
  total_spawned: number;
  total_completed: number;
  total_failed: number;
  success_rate: number;
  avg_duration_ms: number;
  by_role: Record<string, {
    count: number;
    success_rate: number;
    avg_duration_ms: number;
  }>;
}

export interface ServerMetrics {
  total: number;
  running: number;
  avg_uptime_ms: number;
  restarts: number;
}

export interface ReviewMetrics {
  total: number;
  approved: number;
  rejected: number;
  avg_review_time_ms: number;
  issues_found: number;
}

export interface AggregatedMetrics {
  period: 'hour' | 'day' | 'week' | 'month';
  start: string;
  end: string;
  tasks: TaskMetrics;
  agents: AgentMetrics;
  servers: ServerMetrics;
  reviews: ReviewMetrics;
}

// ===========================================
// 로깅 관련 타입
// ===========================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: {
    project_id?: string;
    task_id?: string;
    agent_id?: string;
    server_id?: string;
  };
  data?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface LoggerConfig {
  level: LogLevel;
  format: 'json' | 'pretty';
  outputs: LogOutput[];
}

export interface LogOutput {
  type: 'console' | 'file' | 'remote';
  level?: LogLevel;
  options?: Record<string, any>;
}

// ===========================================
// 백업 관련 타입
// ===========================================

export interface BackupManifest {
  version: string;
  created_at: string;
  conductor_version: string;
  includes: BackupIncludes;
  checksums: Record<string, string>;
}

export interface BackupIncludes {
  projects: boolean;
  tasks: boolean;
  servers: boolean;
  agents: boolean;
  metrics: boolean;
  settings: boolean;
}

export interface BackupOptions {
  includes?: Partial<BackupIncludes>;
  project_id?: string;            // 특정 프로젝트만
  compress?: boolean;
  encrypt?: boolean;
  encryption_key?: string;
}

export interface RestoreOptions {
  includes?: Partial<BackupIncludes>;
  overwrite?: boolean;
  decrypt?: boolean;
  decryption_key?: string;
}
```

---

## Step 3: 멀티 프로젝트 매니저

### 파일: `src/projects/manager.ts`

```typescript
import { v4 as uuid } from 'uuid';
import type { Project, ProjectSettings, ProjectContext } from '../types/project.types';
import { RedisClient } from '../redis';
import { EventEmitter } from 'events';

const DEFAULT_SETTINGS: ProjectSettings = {
  git: { default_branch: 'main' },
  servers: { auto_start: [] },
  notifications: { enabled: true },
  agents: { max_concurrent: 5 },
};

export class ProjectManager extends EventEmitter {
  private redis: RedisClient;
  private currentProject: ProjectContext | null = null;
  private keyPrefix = 'project:';

  constructor(redis: RedisClient) {
    super();
    this.redis = redis;
  }

  // ===========================================
  // 프로젝트 CRUD
  // ===========================================
  async create(params: {
    name: string;
    root_path: string;
    description?: string;
    settings?: Partial<ProjectSettings>;
  }): Promise<Project> {
    const id = `proj-${uuid().slice(0, 8)}`;
    const now = new Date().toISOString();

    const project: Project = {
      id,
      name: params.name,
      description: params.description,
      root_path: params.root_path,
      created_at: now,
      updated_at: now,
      settings: { ...DEFAULT_SETTINGS, ...params.settings },
      stats: {
        total_tasks: 0,
        completed_tasks: 0,
        active_servers: 0,
        last_activity: now,
      },
    };

    await this.redis.set(`${this.keyPrefix}${id}`, JSON.stringify(project));
    await this.redis.sAdd('projects:all', id);

    this.emit('project:created', project);
    return project;
  }

  async get(id: string): Promise<Project | null> {
    const data = await this.redis.get(`${this.keyPrefix}${id}`);
    return data ? JSON.parse(data) : null;
  }

  async list(): Promise<Project[]> {
    const ids = await this.redis.sMembers('projects:all');
    const projects: Project[] = [];

    for (const id of ids) {
      const project = await this.get(id);
      if (project) projects.push(project);
    }

    return projects.sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  async update(id: string, updates: Partial<Project>): Promise<Project | null> {
    const project = await this.get(id);
    if (!project) return null;

    const updated: Project = {
      ...project,
      ...updates,
      id, // ID는 변경 불가
      updated_at: new Date().toISOString(),
    };

    await this.redis.set(`${this.keyPrefix}${id}`, JSON.stringify(updated));
    this.emit('project:updated', updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const project = await this.get(id);
    if (!project) return false;

    // 현재 활성 프로젝트면 해제
    if (this.currentProject?.project_id === id) {
      this.currentProject = null;
    }

    await this.redis.del(`${this.keyPrefix}${id}`);
    await this.redis.sRem('projects:all', id);

    // 관련 데이터 정리 (tasks, servers 등은 프로젝트 prefix로 관리)
    const relatedKeys = await this.redis.keys(`*:${id}:*`);
    for (const key of relatedKeys) {
      await this.redis.del(key);
    }

    this.emit('project:deleted', { id });
    return true;
  }

  // ===========================================
  // 프로젝트 전환
  // ===========================================
  async switch(id: string): Promise<ProjectContext> {
    const project = await this.get(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }

    // 이전 프로젝트 비활성화
    if (this.currentProject) {
      this.emit('project:deactivated', this.currentProject);
    }

    // 새 프로젝트 활성화
    this.currentProject = {
      project_id: id,
      project,
      active: true,
    };

    // 마지막 활동 시간 업데이트
    await this.update(id, {
      stats: { ...project.stats, last_activity: new Date().toISOString() },
    });

    this.emit('project:activated', this.currentProject);

    // 자동 시작 서버 처리
    if (project.settings.servers.auto_start.length > 0) {
      this.emit('project:autostart', {
        project_id: id,
        servers: project.settings.servers.auto_start,
      });
    }

    return this.currentProject;
  }

  getCurrentProject(): ProjectContext | null {
    return this.currentProject;
  }

  // ===========================================
  // 통계 업데이트
  // ===========================================
  async incrementTaskCount(id: string, completed: boolean = false): Promise<void> {
    const project = await this.get(id);
    if (!project) return;

    project.stats.total_tasks++;
    if (completed) project.stats.completed_tasks++;
    project.stats.last_activity = new Date().toISOString();

    await this.update(id, { stats: project.stats });
  }

  async updateServerCount(id: string, count: number): Promise<void> {
    const project = await this.get(id);
    if (!project) return;

    project.stats.active_servers = count;
    await this.update(id, { stats: project.stats });
  }
}
```

---

## Step 4: 메트릭스 수집기

### 파일: `src/metrics/collector.ts`

```typescript
import type { Metric, MetricType } from '../types/project.types';
import { RedisClient } from '../redis';

export class MetricsCollector {
  private redis: RedisClient;
  private keyPrefix = 'metrics:';
  private buffer: Metric[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(redis: RedisClient) {
    this.redis = redis;
    this.startAutoFlush();
  }

  // ===========================================
  // 메트릭 기록
  // ===========================================
  record(
    name: string,
    type: MetricType,
    value: number,
    labels: Record<string, string> = {}
  ): void {
    const metric: Metric = {
      name,
      type,
      value,
      labels,
      timestamp: new Date().toISOString(),
    };

    this.buffer.push(metric);

    // 버퍼가 크면 즉시 플러시
    if (this.buffer.length >= 100) {
      this.flush();
    }
  }

  // 편의 메서드
  increment(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    this.record(name, 'counter', value, labels);
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.record(name, 'gauge', value, labels);
  }

  histogram(name: string, value: number, labels: Record<string, string> = {}): void {
    this.record(name, 'histogram', value, labels);
  }

  // ===========================================
  // 태스크 메트릭
  // ===========================================
  recordTaskCreated(projectId: string): void {
    this.increment('task_created_total', { project_id: projectId });
  }

  recordTaskCompleted(projectId: string, durationMs: number): void {
    this.increment('task_completed_total', { project_id: projectId });
    this.histogram('task_duration_ms', durationMs, { project_id: projectId });
  }

  recordTaskTransition(projectId: string, from: string, to: string): void {
    this.increment('task_transition_total', {
      project_id: projectId,
      from_status: from,
      to_status: to
    });
  }

  // ===========================================
  // Agent 메트릭
  // ===========================================
  recordAgentSpawned(projectId: string, role: string): void {
    this.increment('agent_spawned_total', { project_id: projectId, role });
  }

  recordAgentCompleted(projectId: string, role: string, durationMs: number, success: boolean): void {
    const status = success ? 'success' : 'failure';
    this.increment('agent_completed_total', { project_id: projectId, role, status });
    this.histogram('agent_duration_ms', durationMs, { project_id: projectId, role });
  }

  // ===========================================
  // 서버 메트릭
  // ===========================================
  recordServerStarted(projectId: string, serverId: string): void {
    this.increment('server_started_total', { project_id: projectId, server_id: serverId });
    this.gauge('server_running', 1, { project_id: projectId, server_id: serverId });
  }

  recordServerStopped(projectId: string, serverId: string, uptimeMs: number): void {
    this.gauge('server_running', 0, { project_id: projectId, server_id: serverId });
    this.histogram('server_uptime_ms', uptimeMs, { project_id: projectId, server_id: serverId });
  }

  // ===========================================
  // 리뷰 메트릭
  // ===========================================
  recordReviewCompleted(
    projectId: string,
    result: 'approved' | 'rejected',
    durationMs: number,
    issuesCount: number
  ): void {
    this.increment('review_completed_total', { project_id: projectId, result });
    this.histogram('review_duration_ms', durationMs, { project_id: projectId });
    this.histogram('review_issues_count', issuesCount, { project_id: projectId });
  }

  // ===========================================
  // 저장 및 플러시
  // ===========================================
  private startAutoFlush(): void {
    this.flushInterval = setInterval(() => this.flush(), 10000); // 10초마다
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const toFlush = [...this.buffer];
    this.buffer = [];

    const pipeline = this.redis.multi();
    const now = Date.now();
    const hourKey = Math.floor(now / 3600000); // 시간 단위 키

    for (const metric of toFlush) {
      const key = `${this.keyPrefix}${metric.name}:${hourKey}`;
      const labelKey = Object.entries(metric.labels).sort().map(([k, v]) => `${k}=${v}`).join(',');
      const field = labelKey || '_default';

      if (metric.type === 'counter') {
        pipeline.hIncrByFloat(key, field, metric.value);
      } else if (metric.type === 'gauge') {
        pipeline.hSet(key, field, String(metric.value));
      } else if (metric.type === 'histogram') {
        // 히스토그램은 리스트로 저장
        pipeline.rPush(`${key}:${field}:values`, String(metric.value));
      }

      // TTL 설정 (7일)
      pipeline.expire(key, 604800);
    }

    await pipeline.exec();
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}
```

### 파일: `src/metrics/aggregator.ts`

```typescript
import type {
  AggregatedMetrics,
  TaskMetrics,
  AgentMetrics,
  ServerMetrics,
  ReviewMetrics
} from '../types/project.types';
import { RedisClient } from '../redis';

export class MetricsAggregator {
  private redis: RedisClient;
  private keyPrefix = 'metrics:';

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  // ===========================================
  // 기간별 집계
  // ===========================================
  async aggregate(
    projectId: string,
    period: 'hour' | 'day' | 'week' | 'month'
  ): Promise<AggregatedMetrics> {
    const now = Date.now();
    const periodMs = this.getPeriodMs(period);
    const start = new Date(now - periodMs).toISOString();
    const end = new Date(now).toISOString();

    const [tasks, agents, servers, reviews] = await Promise.all([
      this.aggregateTaskMetrics(projectId, now, periodMs),
      this.aggregateAgentMetrics(projectId, now, periodMs),
      this.aggregateServerMetrics(projectId, now, periodMs),
      this.aggregateReviewMetrics(projectId, now, periodMs),
    ]);

    return { period, start, end, tasks, agents, servers, reviews };
  }

  private getPeriodMs(period: string): number {
    const periods: Record<string, number> = {
      hour: 3600000,
      day: 86400000,
      week: 604800000,
      month: 2592000000,
    };
    return periods[period] || periods.day;
  }

  // ===========================================
  // 태스크 메트릭 집계
  // ===========================================
  private async aggregateTaskMetrics(
    projectId: string,
    now: number,
    periodMs: number
  ): Promise<TaskMetrics> {
    const hourKeys = this.getHourKeys(now, periodMs);

    let total = 0;
    let completed = 0;
    const durations: number[] = [];
    const byStatus: Record<string, number> = {};

    for (const hourKey of hourKeys) {
      // 생성된 태스크
      const createdKey = `${this.keyPrefix}task_created_total:${hourKey}`;
      const created = await this.redis.hGet(createdKey, `project_id=${projectId}`);
      if (created) total += parseFloat(created);

      // 완료된 태스크
      const completedKey = `${this.keyPrefix}task_completed_total:${hourKey}`;
      const comp = await this.redis.hGet(completedKey, `project_id=${projectId}`);
      if (comp) completed += parseFloat(comp);

      // 소요 시간
      const durationKey = `${this.keyPrefix}task_duration_ms:${hourKey}:project_id=${projectId}:values`;
      const durs = await this.redis.lRange(durationKey, 0, -1);
      durations.push(...durs.map(d => parseFloat(d)));

      // 상태별
      const transKey = `${this.keyPrefix}task_transition_total:${hourKey}`;
      const transitions = await this.redis.hGetAll(transKey);
      for (const [field, value] of Object.entries(transitions)) {
        if (field.includes(`project_id=${projectId}`)) {
          const toMatch = field.match(/to_status=(\w+)/);
          if (toMatch) {
            const status = toMatch[1];
            byStatus[status] = (byStatus[status] || 0) + parseFloat(value);
          }
        }
      }
    }

    return {
      total,
      by_status: byStatus,
      avg_completion_time_ms: durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0,
      completion_rate: total > 0 ? completed / total : 0,
    };
  }

  // ===========================================
  // Agent 메트릭 집계
  // ===========================================
  private async aggregateAgentMetrics(
    projectId: string,
    now: number,
    periodMs: number
  ): Promise<AgentMetrics> {
    const hourKeys = this.getHourKeys(now, periodMs);

    let totalSpawned = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    const durations: number[] = [];
    const byRole: Record<string, { count: number; success: number; durations: number[] }> = {};

    for (const hourKey of hourKeys) {
      // Spawned
      const spawnedKey = `${this.keyPrefix}agent_spawned_total:${hourKey}`;
      const spawned = await this.redis.hGetAll(spawnedKey);
      for (const [field, value] of Object.entries(spawned)) {
        if (field.includes(`project_id=${projectId}`)) {
          totalSpawned += parseFloat(value);
          const roleMatch = field.match(/role=(\w+)/);
          if (roleMatch) {
            const role = roleMatch[1];
            if (!byRole[role]) byRole[role] = { count: 0, success: 0, durations: [] };
            byRole[role].count += parseFloat(value);
          }
        }
      }

      // Completed
      const completedKey = `${this.keyPrefix}agent_completed_total:${hourKey}`;
      const completed = await this.redis.hGetAll(completedKey);
      for (const [field, value] of Object.entries(completed)) {
        if (field.includes(`project_id=${projectId}`)) {
          const v = parseFloat(value);
          if (field.includes('status=success')) {
            totalCompleted += v;
            const roleMatch = field.match(/role=(\w+)/);
            if (roleMatch && byRole[roleMatch[1]]) {
              byRole[roleMatch[1]].success += v;
            }
          } else {
            totalFailed += v;
          }
        }
      }
    }

    const totalFinished = totalCompleted + totalFailed;

    return {
      total_spawned: totalSpawned,
      total_completed: totalCompleted,
      total_failed: totalFailed,
      success_rate: totalFinished > 0 ? totalCompleted / totalFinished : 0,
      avg_duration_ms: durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0,
      by_role: Object.fromEntries(
        Object.entries(byRole).map(([role, data]) => [
          role,
          {
            count: data.count,
            success_rate: data.count > 0 ? data.success / data.count : 0,
            avg_duration_ms: data.durations.length > 0
              ? data.durations.reduce((a, b) => a + b, 0) / data.durations.length
              : 0,
          },
        ])
      ),
    };
  }

  // ===========================================
  // 서버 메트릭 집계
  // ===========================================
  private async aggregateServerMetrics(
    projectId: string,
    now: number,
    periodMs: number
  ): Promise<ServerMetrics> {
    const hourKeys = this.getHourKeys(now, periodMs);

    let total = 0;
    let running = 0;
    let restarts = 0;
    const uptimes: number[] = [];

    for (const hourKey of hourKeys) {
      const startedKey = `${this.keyPrefix}server_started_total:${hourKey}`;
      const started = await this.redis.hGetAll(startedKey);
      for (const [field, value] of Object.entries(started)) {
        if (field.includes(`project_id=${projectId}`)) {
          restarts += parseFloat(value);
        }
      }
    }

    // 현재 실행 중인 서버 수
    const runningKey = `${this.keyPrefix}server_running:*`;
    const runningKeys = await this.redis.keys(runningKey);
    for (const key of runningKeys) {
      const data = await this.redis.hGetAll(key);
      for (const [field, value] of Object.entries(data)) {
        if (field.includes(`project_id=${projectId}`) && value === '1') {
          running++;
        }
      }
    }

    return {
      total: restarts, // 시작된 총 횟수
      running,
      avg_uptime_ms: uptimes.length > 0
        ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length
        : 0,
      restarts,
    };
  }

  // ===========================================
  // 리뷰 메트릭 집계
  // ===========================================
  private async aggregateReviewMetrics(
    projectId: string,
    now: number,
    periodMs: number
  ): Promise<ReviewMetrics> {
    const hourKeys = this.getHourKeys(now, periodMs);

    let total = 0;
    let approved = 0;
    let rejected = 0;
    const durations: number[] = [];
    let issuesFound = 0;

    for (const hourKey of hourKeys) {
      const completedKey = `${this.keyPrefix}review_completed_total:${hourKey}`;
      const completed = await this.redis.hGetAll(completedKey);
      for (const [field, value] of Object.entries(completed)) {
        if (field.includes(`project_id=${projectId}`)) {
          const v = parseFloat(value);
          total += v;
          if (field.includes('result=approved')) approved += v;
          if (field.includes('result=rejected')) rejected += v;
        }
      }
    }

    return {
      total,
      approved,
      rejected,
      avg_review_time_ms: durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0,
      issues_found: issuesFound,
    };
  }

  // ===========================================
  // 유틸리티
  // ===========================================
  private getHourKeys(now: number, periodMs: number): number[] {
    const keys: number[] = [];
    const startHour = Math.floor((now - periodMs) / 3600000);
    const endHour = Math.floor(now / 3600000);

    for (let h = startHour; h <= endHour; h++) {
      keys.push(h);
    }
    return keys;
  }
}
```

## Step 5: 구조화 로깅

### 파일: `src/logging/logger.ts`

```typescript
import type { LogLevel, LogEntry, LoggerConfig, LogOutput } from '../types/project.types';

type LogHandler = (entry: LogEntry) => void;

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

export class Logger {
  private config: LoggerConfig;
  private handlers: LogHandler[] = [];
  private context: Record<string, any> = {};

  constructor(config: LoggerConfig) {
    this.config = config;
    this.initializeHandlers();
  }

  private initializeHandlers(): void {
    for (const output of this.config.outputs) {
      const minLevel = output.level || this.config.level;

      switch (output.type) {
        case 'console':
          this.handlers.push(this.createConsoleHandler(minLevel));
          break;
        case 'file':
          this.handlers.push(this.createFileHandler(minLevel, output.options));
          break;
        case 'remote':
          this.handlers.push(this.createRemoteHandler(minLevel, output.options));
          break;
      }
    }
  }

  // ===========================================
  // 로그 메서드
  // ===========================================
  debug(message: string, data?: Record<string, any>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, any>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, any>): void {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error, data?: Record<string, any>): void {
    this.log('error', message, data, error);
  }

  fatal(message: string, error?: Error, data?: Record<string, any>): void {
    this.log('fatal', message, data, error);
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, any>,
    error?: Error
  ): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.level]) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: { ...this.context },
      data,
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    for (const handler of this.handlers) {
      try {
        handler(entry);
      } catch (e) {
        console.error('Logger handler error:', e);
      }
    }
  }

  // ===========================================
  // 컨텍스트 관리
  // ===========================================
  setContext(context: Record<string, any>): void {
    this.context = { ...this.context, ...context };
  }

  clearContext(): void {
    this.context = {};
  }

  child(context: Record<string, any>): Logger {
    const child = new Logger(this.config);
    child.handlers = this.handlers;
    child.context = { ...this.context, ...context };
    return child;
  }

  // ===========================================
  // 핸들러 생성
  // ===========================================
  private createConsoleHandler(minLevel: LogLevel): LogHandler {
    return (entry: LogEntry) => {
      if (LOG_LEVELS[entry.level] < LOG_LEVELS[minLevel]) return;

      if (this.config.format === 'json') {
        console.log(JSON.stringify(entry));
      } else {
        const color = this.getLevelColor(entry.level);
        const prefix = `${color}[${entry.level.toUpperCase()}]\x1b[0m`;
        const time = entry.timestamp.split('T')[1].slice(0, 8);

        let line = `${time} ${prefix} ${entry.message}`;

        if (entry.context && Object.keys(entry.context).length > 0) {
          line += ` ${JSON.stringify(entry.context)}`;
        }
        if (entry.data) {
          line += ` ${JSON.stringify(entry.data)}`;
        }

        console.log(line);

        if (entry.error?.stack) {
          console.log(entry.error.stack);
        }
      }
    };
  }

  private createFileHandler(minLevel: LogLevel, options?: Record<string, any>): LogHandler {
    const fs = require('fs');
    const path = options?.path || 'logs/conductor.log';
    const dir = require('path').dirname(path);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return (entry: LogEntry) => {
      if (LOG_LEVELS[entry.level] < LOG_LEVELS[minLevel]) return;

      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(path, line);
    };
  }

  private createRemoteHandler(minLevel: LogLevel, options?: Record<string, any>): LogHandler {
    const url = options?.url;
    if (!url) return () => {};

    const buffer: LogEntry[] = [];
    let flushTimeout: NodeJS.Timeout | null = null;

    const flush = async () => {
      if (buffer.length === 0) return;

      const entries = [...buffer];
      buffer.length = 0;

      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries }),
        });
      } catch (e) {
        // 실패 시 버퍼에 다시 추가
        buffer.unshift(...entries);
      }
    };

    return (entry: LogEntry) => {
      if (LOG_LEVELS[entry.level] < LOG_LEVELS[minLevel]) return;

      buffer.push(entry);

      if (!flushTimeout) {
        flushTimeout = setTimeout(() => {
          flushTimeout = null;
          flush();
        }, 5000);
      }
    };
  }

  private getLevelColor(level: LogLevel): string {
    const colors: Record<LogLevel, string> = {
      debug: '\x1b[90m',  // gray
      info: '\x1b[36m',   // cyan
      warn: '\x1b[33m',   // yellow
      error: '\x1b[31m',  // red
      fatal: '\x1b[35m',  // magenta
    };
    return colors[level];
  }
}

// 전역 로거 인스턴스
let globalLogger: Logger | null = null;

export function initLogger(config: LoggerConfig): Logger {
  globalLogger = new Logger(config);
  return globalLogger;
}

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger({
      level: 'info',
      format: 'pretty',
      outputs: [{ type: 'console' }],
    });
  }
  return globalLogger;
}
```

---

## Step 6: 백업 및 복원

### 파일: `src/backup/exporter.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import type { BackupManifest, BackupOptions, BackupIncludes } from '../types/project.types';
import { RedisClient } from '../redis';

export class BackupExporter {
  private redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  async export(outputPath: string, options: BackupOptions = {}): Promise<BackupManifest> {
    const includes = this.resolveIncludes(options.includes);
    const timestamp = new Date().toISOString();
    const tempDir = path.join(path.dirname(outputPath), `.backup-${Date.now()}`);

    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const manifest: BackupManifest = {
        version: '1.0',
        created_at: timestamp,
        conductor_version: process.env.npm_package_version || '1.0.0',
        includes,
        checksums: {},
      };

      // 각 카테고리별 데이터 내보내기
      if (includes.projects) {
        manifest.checksums['projects.json'] = await this.exportCategory(
          tempDir, 'projects', options.project_id ? [`project:${options.project_id}`] : ['project:*']
        );
      }

      if (includes.tasks) {
        const pattern = options.project_id
          ? [`task:${options.project_id}:*`]
          : ['task:*'];
        manifest.checksums['tasks.json'] = await this.exportCategory(tempDir, 'tasks', pattern);
      }

      if (includes.servers) {
        manifest.checksums['servers.json'] = await this.exportCategory(
          tempDir, 'servers', ['server:*']
        );
      }

      if (includes.agents) {
        manifest.checksums['agents.json'] = await this.exportCategory(
          tempDir, 'agents', ['agent:*']
        );
      }

      if (includes.metrics) {
        manifest.checksums['metrics.json'] = await this.exportCategory(
          tempDir, 'metrics', ['metrics:*']
        );
      }

      if (includes.settings) {
        manifest.checksums['settings.json'] = await this.exportCategory(
          tempDir, 'settings', ['settings:*', 'config:*']
        );
      }

      // 매니페스트 저장
      fs.writeFileSync(
        path.join(tempDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );

      // 압축 (옵션)
      if (options.compress !== false) {
        await this.compressDirectory(tempDir, outputPath);
      } else {
        // 압축 안 하면 디렉토리 이동
        fs.renameSync(tempDir, outputPath);
      }

      // 암호화 (옵션)
      if (options.encrypt && options.encryption_key) {
        await this.encryptFile(outputPath, options.encryption_key);
      }

      return manifest;

    } finally {
      // 임시 디렉토리 정리
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    }
  }

  private resolveIncludes(partial?: Partial<BackupIncludes>): BackupIncludes {
    return {
      projects: partial?.projects ?? true,
      tasks: partial?.tasks ?? true,
      servers: partial?.servers ?? true,
      agents: partial?.agents ?? true,
      metrics: partial?.metrics ?? true,
      settings: partial?.settings ?? true,
    };
  }

  private async exportCategory(
    dir: string,
    name: string,
    patterns: string[]
  ): Promise<string> {
    const data: Record<string, any> = {};

    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      for (const key of keys) {
        const type = await this.redis.type(key);

        switch (type) {
          case 'string':
            data[key] = await this.redis.get(key);
            break;
          case 'hash':
            data[key] = await this.redis.hGetAll(key);
            break;
          case 'set':
            data[key] = await this.redis.sMembers(key);
            break;
          case 'list':
            data[key] = await this.redis.lRange(key, 0, -1);
            break;
          case 'zset':
            data[key] = await this.redis.zRange(key, 0, -1);
            break;
        }
      }
    }

    const content = JSON.stringify(data, null, 2);
    const filePath = path.join(dir, `${name}.json`);
    fs.writeFileSync(filePath, content);

    // 체크섬 계산
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private async compressDirectory(dir: string, outputPath: string): Promise<void> {
    const archiver = require('archiver');
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(dir, false);
      archive.finalize();
    });
  }

  private async encryptFile(filePath: string, key: string): Promise<void> {
    const content = fs.readFileSync(filePath);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc',
      crypto.createHash('sha256').update(key).digest(), iv);

    const encrypted = Buffer.concat([iv, cipher.update(content), cipher.final()]);
    fs.writeFileSync(filePath, encrypted);
  }
}
```

### 파일: `src/backup/importer.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { BackupManifest, RestoreOptions } from '../types/project.types';
import { RedisClient } from '../redis';

export class BackupImporter {
  private redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  async import(inputPath: string, options: RestoreOptions = {}): Promise<{
    success: boolean;
    manifest: BackupManifest;
    restored: string[];
    errors: string[];
  }> {
    const errors: string[] = [];
    const restored: string[] = [];

    // 복호화 (필요 시)
    let workPath = inputPath;
    if (options.decrypt && options.decryption_key) {
      workPath = await this.decryptFile(inputPath, options.decryption_key);
    }

    // 압축 해제
    const extractDir = path.join(path.dirname(workPath), `.restore-${Date.now()}`);
    await this.extractArchive(workPath, extractDir);

    try {
      // 매니페스트 로드
      const manifestPath = path.join(extractDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Invalid backup: manifest.json not found');
      }

      const manifest: BackupManifest = JSON.parse(
        fs.readFileSync(manifestPath, 'utf-8')
      );

      // 체크섬 검증
      for (const [file, expectedChecksum] of Object.entries(manifest.checksums)) {
        const filePath = path.join(extractDir, file);
        if (!fs.existsSync(filePath)) {
          errors.push(`Missing file: ${file}`);
          continue;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const actualChecksum = crypto.createHash('sha256').update(content).digest('hex');

        if (actualChecksum !== expectedChecksum) {
          errors.push(`Checksum mismatch: ${file}`);
          continue;
        }
      }

      // 카테고리별 복원
      const categories = ['projects', 'tasks', 'servers', 'agents', 'metrics', 'settings'];

      for (const category of categories) {
        if (options.includes && !options.includes[category as keyof typeof options.includes]) {
          continue;
        }

        const filePath = path.join(extractDir, `${category}.json`);
        if (!fs.existsSync(filePath)) continue;

        try {
          await this.restoreCategory(filePath, options.overwrite ?? false);
          restored.push(category);
        } catch (e) {
          errors.push(`Failed to restore ${category}: ${e}`);
        }
      }

      return {
        success: errors.length === 0,
        manifest,
        restored,
        errors,
      };

    } finally {
      // 정리
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true });
      }
      if (workPath !== inputPath && fs.existsSync(workPath)) {
        fs.unlinkSync(workPath);
      }
    }
  }

  private async restoreCategory(filePath: string, overwrite: boolean): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data: Record<string, any> = JSON.parse(content);

    for (const [key, value] of Object.entries(data)) {
      // 덮어쓰기 확인
      if (!overwrite) {
        const exists = await this.redis.exists(key);
        if (exists) continue;
      }

      // 타입에 따라 복원
      if (typeof value === 'string') {
        await this.redis.set(key, value);
      } else if (Array.isArray(value)) {
        await this.redis.del(key);
        if (value.length > 0) {
          // Set 또는 List 판단 (키 패턴으로)
          if (key.includes(':all') || key.includes(':members')) {
            await this.redis.sAdd(key, ...value);
          } else {
            await this.redis.rPush(key, ...value);
          }
        }
      } else if (typeof value === 'object') {
        await this.redis.del(key);
        for (const [field, fieldValue] of Object.entries(value)) {
          await this.redis.hSet(key, field, String(fieldValue));
        }
      }
    }
  }

  private async extractArchive(archivePath: string, outputDir: string): Promise<void> {
    const unzipper = require('unzipper');

    return new Promise((resolve, reject) => {
      fs.createReadStream(archivePath)
        .pipe(unzipper.Extract({ path: outputDir }))
        .on('close', resolve)
        .on('error', reject);
    });
  }

  private async decryptFile(filePath: string, key: string): Promise<string> {
    const content = fs.readFileSync(filePath);
    const iv = content.slice(0, 16);
    const encrypted = content.slice(16);

    const decipher = crypto.createDecipheriv('aes-256-cbc',
      crypto.createHash('sha256').update(key).digest(), iv);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    const outputPath = filePath + '.decrypted';
    fs.writeFileSync(outputPath, decrypted);
    return outputPath;
  }
}
```

---

*Phase 7 Part A 문서 끝*
*계속: Part B - Step 7-13 (MCP 도구 및 통합)*
