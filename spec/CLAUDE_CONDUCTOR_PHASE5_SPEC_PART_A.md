# Claude Conductor - Phase 5 상세 구현 스펙 (Part A)

> **목표**: Sub Agent 오케스트레이션 - Agent 프레임워크, Skill 연동, 병렬 실행
> **예상 소요**: 2-3주
> **선행 조건**: Phase 4 완료
> **범위**: Step 1-6 (기본 인프라)

---

## 📋 구현 체크리스트

- [ ] Agent Registry 시스템
- [ ] Agent Lifecycle 관리 (spawn/terminate)
- [ ] Skill 로딩 메커니즘
- [ ] Task Delegation 시스템
- [ ] 병렬 실행 엔진
- [ ] 결과 수집 및 병합
- [ ] 컨텍스트 공유 메커니즘
- [ ] 기본 Agent 역할 정의 (Code, Test, Review, Docs)

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Main Conductor Agent                             │
│                        (오케스트레이터 / 지휘자)                          │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Agent     │  │   Skill     │  │  Parallel   │  │   Result    │    │
│  │  Registry   │  │   Loader    │  │   Engine    │  │  Collector  │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                    ┌────────────┼────────────┬────────────┐
                    │            │            │            │
                    ▼            ▼            ▼            ▼
             ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
             │   Code    │ │   Test    │ │  Review   │ │   Docs    │
             │   Agent   │ │   Agent   │ │   Agent   │ │   Agent   │
             │           │ │           │ │           │ │           │
             │ Skills:   │ │ Skills:   │ │ Skills:   │ │ Skills:   │
             │ - coding  │ │ - testing │ │ - review  │ │ - api-docs│
             │ - refactor│ │ - coverage│ │ - security│ │ - changelog│
             └───────────┘ └───────────┘ └───────────┘ └───────────┘
                    │            │            │            │
                    └────────────┴────────────┴────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  Shared Context │
                              │     (Redis)     │
                              └─────────────────┘
```

---

## 핵심 개념 정의

### Skill vs Agent

| 개념 | 역할 | 비유 | 저장 위치 |
|------|------|------|----------|
| **Skill** | 지식/방법론/워크플로우 | 매뉴얼, 교과서 | `.claude/skills/*/SKILL.md` |
| **Agent** | 실행 주체 | 전문가 | `.claude/agents/*.yaml` |
| **관계** | Agent가 Skill을 장착 | 전문가가 매뉴얼 참조 | Agent 설정에서 참조 |

### Agent 상태

```
┌─────────┐     spawn      ┌─────────┐    delegate    ┌─────────┐
│  IDLE   │ ──────────────▶│ READY   │ ──────────────▶│ RUNNING │
└─────────┘                └─────────┘                └─────────┘
                                                           │
                           ┌───────────────────────────────┤
                           │                               │
                           ▼                               ▼
                    ┌─────────────┐                 ┌─────────────┐
                    │  COMPLETED  │                 │   ERROR     │
                    └─────────────┘                 └─────────────┘
                           │                               │
                           └───────────────┬───────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │ TERMINATED  │
                                    └─────────────┘
```

---

## Step 1: 디렉토리 구조 확장

### 추가되는 구조

```
.claude/
├── skills/                      # 기존 (Phase 1-3)
│   ├── coding/
│   │   └── SKILL.md
│   ├── testing/
│   │   └── SKILL.md
│   ├── code-review/
│   │   └── SKILL.md
│   ├── security/
│   │   └── SKILL.md
│   ├── performance/
│   │   └── SKILL.md
│   ├── changelog/
│   │   └── SKILL.md
│   └── api-docs/
│       └── SKILL.md
│
├── agents/                      # NEW: Agent 정의
│   ├── _template.yaml           # Agent 템플릿
│   ├── code-agent.yaml
│   ├── test-agent.yaml
│   ├── review-agent.yaml
│   ├── docs-agent.yaml
│   └── security-agent.yaml
│
├── orchestration/               # NEW: 오케스트레이션 설정
│   ├── strategies/
│   │   ├── parallel.yaml        # 병렬 실행 전략
│   │   ├── sequential.yaml      # 순차 실행 전략
│   │   └── pipeline.yaml        # 파이프라인 전략
│   └── workflows/
│       ├── implement.yaml       # 구현 워크플로우
│       ├── review.yaml          # 리뷰 워크플로우
│       └── full-cycle.yaml      # 전체 사이클
│
└── runtime/                     # NEW: 런타임 데이터
    └── agents/
        └── {agent-id}/
            ├── state.json       # Agent 상태
            ├── context.json     # 주입된 컨텍스트
            └── output.json      # 실행 결과
```

---

## Step 2: 타입 정의

### 파일: `src/types/agent.types.ts`

```typescript
// ===========================================
// Agent 관련 타입 정의
// ===========================================

export type AgentRole =
  | 'code'
  | 'test'
  | 'review'
  | 'docs'
  | 'security'
  | 'performance'
  | 'frontend'
  | 'backend'
  | 'custom';

export type AgentStatus =
  | 'idle'
  | 'ready'
  | 'running'
  | 'completed'
  | 'error'
  | 'terminated';

export interface AgentDefinition {
  role: AgentRole;
  name: string;
  description: string;
  skills: {
    required: string[];
    optional: string[];
  };
  system_prompt: string;
  tools: string[];
  constraints: string[];
  output_format: {
    type: string;
    schema: Record<string, any>;
  };
  config: {
    timeout_ms: number;
    max_retries: number;
    parallel_allowed: boolean;
  };
}

export interface AgentInstance {
  id: string;                    // agent-{role}-{timestamp}
  role: AgentRole;
  status: AgentStatus;
  task_id: string | null;
  skills_loaded: string[];
  context: AgentContext;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: AgentResult | null;
  error: string | null;
}

export interface AgentContext {
  task: {
    id: string;
    title: string;
    description: string;
    related_files: string[];
  };
  skills: Record<string, string>;  // skill_name -> SKILL.md content
  shared: Record<string, any>;     // 다른 Agent로부터 공유된 데이터
  parent_agent_id: string | null;
}

export interface AgentResult {
  agent_id: string;
  role: AgentRole;
  task_id: string;
  status: 'success' | 'partial' | 'failed';
  output: any;
  artifacts: AgentArtifact[];
  metrics: {
    duration_ms: number;
    tool_calls: number;
    tokens_used: number;
  };
  timestamp: string;
}

export interface AgentArtifact {
  type: 'file' | 'diff' | 'report' | 'data';
  name: string;
  path?: string;
  content: string;
}

// ===========================================
// 오케스트레이션 관련 타입
// ===========================================

export type ExecutionStrategy = 'parallel' | 'sequential' | 'pipeline';

export interface OrchestrationPlan {
  id: string;
  task_id: string;
  strategy: ExecutionStrategy;
  stages: OrchestrationStage[];
  created_at: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface OrchestrationStage {
  stage_id: string;
  name: string;
  agents: {
    role: AgentRole;
    skills?: string[];
    depends_on?: string[];  // 이전 stage 또는 agent id
  }[];
  parallel: boolean;
  timeout_ms: number;
}

export interface DelegationRequest {
  task_id: string;
  agent_role: AgentRole;
  skills?: string[];
  context?: Partial<AgentContext>;
  priority?: 'low' | 'normal' | 'high';
  timeout_ms?: number;
}

export interface CollectionResult {
  plan_id: string;
  task_id: string;
  agents: AgentResult[];
  merged_output: any;
  conflicts: ConflictItem[];
  summary: string;
}

export interface ConflictItem {
  type: 'file_change' | 'recommendation' | 'data';
  source_agents: string[];
  description: string;
  resolution?: string;
}
```

---

## Step 3: Agent Registry

### 파일: `src/orchestration/agent-registry.ts`

```typescript
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentDefinition, AgentRole } from '../types/agent.types';

export class AgentRegistry {
  private definitions: Map<AgentRole, AgentDefinition> = new Map();
  private agentsDir: string;

  constructor(workspaceDir: string) {
    this.agentsDir = join(workspaceDir, '.claude', 'agents');
  }

  async initialize(): Promise<void> {
    const files = await readdir(this.agentsDir);
    const yamlFiles = files.filter(f => f.endsWith('.yaml') && !f.startsWith('_'));

    for (const file of yamlFiles) {
      const content = await readFile(join(this.agentsDir, file), 'utf-8');
      const definition = parseYaml(content) as AgentDefinition;
      this.definitions.set(definition.role, definition);
    }

    console.log(`[AgentRegistry] Loaded ${this.definitions.size} agent definitions`);
  }

  getDefinition(role: AgentRole): AgentDefinition | undefined {
    return this.definitions.get(role);
  }

  getAllDefinitions(): AgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  listRoles(): AgentRole[] {
    return Array.from(this.definitions.keys());
  }

  hasRole(role: AgentRole): boolean {
    return this.definitions.has(role);
  }

  // 동적으로 Agent 정의 추가 (런타임)
  registerCustomAgent(definition: AgentDefinition): void {
    if (definition.role !== 'custom') {
      throw new Error('Dynamic registration only allowed for custom role');
    }
    this.definitions.set(definition.role, definition);
  }
}
```

---

## Step 4: Skill Loader

### 파일: `src/orchestration/skill-loader.ts`

```typescript
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import type { AgentDefinition } from '../types/agent.types';

export class SkillLoader {
  private skillsDir: string;
  private cache: Map<string, string> = new Map();

  constructor(workspaceDir: string) {
    this.skillsDir = join(workspaceDir, '.claude', 'skills');
  }

  async loadSkill(skillName: string): Promise<string> {
    // 캐시 확인
    if (this.cache.has(skillName)) {
      return this.cache.get(skillName)!;
    }

    const skillPath = join(this.skillsDir, skillName, 'SKILL.md');

    try {
      await access(skillPath);
      const content = await readFile(skillPath, 'utf-8');
      this.cache.set(skillName, content);
      return content;
    } catch {
      throw new Error(`Skill not found: ${skillName}`);
    }
  }

  async loadSkillsForAgent(definition: AgentDefinition): Promise<Record<string, string>> {
    const skills: Record<string, string> = {};
    const allSkills = [
      ...definition.skills.required,
      ...definition.skills.optional,
    ];

    for (const skillName of allSkills) {
      try {
        skills[skillName] = await this.loadSkill(skillName);
      } catch (error) {
        // required skill이 없으면 에러
        if (definition.skills.required.includes(skillName)) {
          throw error;
        }
        // optional skill은 무시
        console.warn(`[SkillLoader] Optional skill not found: ${skillName}`);
      }
    }

    return skills;
  }

  buildSystemPrompt(definition: AgentDefinition, skills: Record<string, string>): string {
    // 템플릿 변수 치환
    let prompt = definition.system_prompt;

    // {{skills}} 섹션 생성
    const skillsSection = Object.entries(skills)
      .map(([name, content]) => `### Skill: ${name}\n\n${content}`)
      .join('\n\n---\n\n');

    prompt = prompt.replace('{{skills}}', skillsSection);
    prompt = prompt.replace('{{role}}', definition.role);
    prompt = prompt.replace('{{name}}', definition.name);

    // constraints 추가
    const constraintsSection = definition.constraints
      .map(c => `- ${c}`)
      .join('\n');
    prompt = prompt.replace('{{constraints}}', constraintsSection);

    return prompt;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
```

---

## Step 5: Agent Lifecycle Manager

### 파일: `src/orchestration/agent-manager.ts`

```typescript
import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import type {
  AgentInstance,
  AgentRole,
  AgentStatus,
  AgentContext,
  AgentResult,
  DelegationRequest
} from '../types/agent.types';
import { AgentRegistry } from './agent-registry';
import { SkillLoader } from './skill-loader';
import { RedisClient } from '../redis';

export class AgentManager extends EventEmitter {
  private instances: Map<string, AgentInstance> = new Map();
  private registry: AgentRegistry;
  private skillLoader: SkillLoader;
  private redis: RedisClient;

  constructor(
    registry: AgentRegistry,
    skillLoader: SkillLoader,
    redis: RedisClient
  ) {
    super();
    this.registry = registry;
    this.skillLoader = skillLoader;
    this.redis = redis;
  }

  // ===========================================
  // Agent 생성
  // ===========================================
  async spawn(
    role: AgentRole,
    taskId: string,
    options?: {
      skills?: string[];
      context?: Partial<AgentContext>;
    }
  ): Promise<AgentInstance> {
    // 1. Agent 정의 조회
    const definition = this.registry.getDefinition(role);
    if (!definition) {
      throw new Error(`Unknown agent role: ${role}`);
    }

    // 2. Skill 로드
    const skillsToLoad = options?.skills || [
      ...definition.skills.required,
      ...definition.skills.optional,
    ];

    const loadedSkills = await this.skillLoader.loadSkillsForAgent({
      ...definition,
      skills: {
        required: definition.skills.required.filter(s => skillsToLoad.includes(s)),
        optional: definition.skills.optional.filter(s => skillsToLoad.includes(s)),
      },
    });

    // 3. 시스템 프롬프트 빌드
    const systemPrompt = this.skillLoader.buildSystemPrompt(definition, loadedSkills);

    // 4. Agent 인스턴스 생성
    const agentId = `agent-${role}-${Date.now()}-${uuid().slice(0, 8)}`;

    const instance: AgentInstance = {
      id: agentId,
      role,
      status: 'ready',
      task_id: taskId,
      skills_loaded: Object.keys(loadedSkills),
      context: {
        task: options?.context?.task || {
          id: taskId,
          title: '',
          description: '',
          related_files: [],
        },
        skills: loadedSkills,
        shared: options?.context?.shared || {},
        parent_agent_id: options?.context?.parent_agent_id || null,
      },
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      result: null,
      error: null,
    };

    // 5. 저장 및 이벤트 발행
    this.instances.set(agentId, instance);
    await this.persistInstance(instance);

    this.emit('agent:spawned', { agentId, role, taskId });
    await this.redis.publish('agent:spawned', { agentId, role, taskId });

    console.log(`[AgentManager] Spawned ${role} agent: ${agentId}`);
    return instance;
  }

  // ===========================================
  // Agent 실행 위임
  // ===========================================
  async delegate(request: DelegationRequest): Promise<AgentInstance> {
    // 1. Agent spawn (없으면 생성)
    const instance = await this.spawn(
      request.agent_role,
      request.task_id,
      {
        skills: request.skills,
        context: request.context,
      }
    );

    // 2. 상태 변경
    instance.status = 'running';
    instance.started_at = new Date().toISOString();
    await this.persistInstance(instance);

    this.emit('agent:started', { agentId: instance.id });
    await this.redis.publish('agent:started', { agentId: instance.id });

    // 3. 실제 실행은 executor에서 처리 (비동기)
    // 여기서는 인스턴스만 반환
    return instance;
  }

  // ===========================================
  // Agent 결과 수집
  // ===========================================
  async collect(agentId: string): Promise<AgentResult | null> {
    const instance = this.instances.get(agentId);
    if (!instance) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (instance.status === 'running') {
      // 아직 실행 중이면 대기
      return new Promise((resolve) => {
        const handler = (data: { agentId: string; result: AgentResult }) => {
          if (data.agentId === agentId) {
            this.off('agent:completed', handler);
            resolve(data.result);
          }
        };
        this.on('agent:completed', handler);
      });
    }

    return instance.result;
  }

  // ===========================================
  // Agent 완료 처리
  // ===========================================
  async complete(agentId: string, result: AgentResult): Promise<void> {
    const instance = this.instances.get(agentId);
    if (!instance) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    instance.status = 'completed';
    instance.completed_at = new Date().toISOString();
    instance.result = result;
    await this.persistInstance(instance);

    this.emit('agent:completed', { agentId, result });
    await this.redis.publish('agent:completed', { agentId, result });

    console.log(`[AgentManager] Agent completed: ${agentId}`);
  }

  // ===========================================
  // Agent 에러 처리
  // ===========================================
  async fail(agentId: string, error: string): Promise<void> {
    const instance = this.instances.get(agentId);
    if (!instance) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    instance.status = 'error';
    instance.completed_at = new Date().toISOString();
    instance.error = error;
    await this.persistInstance(instance);

    this.emit('agent:error', { agentId, error });
    await this.redis.publish('agent:error', { agentId, error });

    console.error(`[AgentManager] Agent failed: ${agentId} - ${error}`);
  }

  // ===========================================
  // Agent 종료
  // ===========================================
  async terminate(agentId: string): Promise<void> {
    const instance = this.instances.get(agentId);
    if (!instance) {
      return; // 이미 없음
    }

    instance.status = 'terminated';
    instance.completed_at = new Date().toISOString();
    await this.persistInstance(instance);

    this.emit('agent:terminated', { agentId });
    await this.redis.publish('agent:terminated', { agentId });

    // 메모리에서 제거 (일정 시간 후)
    setTimeout(() => {
      this.instances.delete(agentId);
    }, 60000); // 1분 후 제거

    console.log(`[AgentManager] Agent terminated: ${agentId}`);
  }

  // ===========================================
  // 조회 메서드
  // ===========================================
  getInstance(agentId: string): AgentInstance | undefined {
    return this.instances.get(agentId);
  }

  getInstancesByTask(taskId: string): AgentInstance[] {
    return Array.from(this.instances.values())
      .filter(i => i.task_id === taskId);
  }

  getInstancesByRole(role: AgentRole): AgentInstance[] {
    return Array.from(this.instances.values())
      .filter(i => i.role === role);
  }

  getRunningInstances(): AgentInstance[] {
    return Array.from(this.instances.values())
      .filter(i => i.status === 'running');
  }

  // ===========================================
  // 영속성
  // ===========================================
  private async persistInstance(instance: AgentInstance): Promise<void> {
    const key = `agent:instance:${instance.id}`;
    await this.redis.set(key, JSON.stringify(instance), 3600); // 1시간 TTL
  }

  async restoreInstances(): Promise<void> {
    const keys = await this.redis.keys('agent:instance:*');
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const instance = JSON.parse(data) as AgentInstance;
        // 실행 중이던 것은 error로 변경
        if (instance.status === 'running') {
          instance.status = 'error';
          instance.error = 'Server restarted during execution';
        }
        this.instances.set(instance.id, instance);
      }
    }
    console.log(`[AgentManager] Restored ${this.instances.size} agent instances`);
  }
}
```

---

## Step 6: MCP 도구 정의

### 파일: `src/handlers/agent.handlers.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@anthropic/mcp-server';
import { AgentManager } from '../orchestration/agent-manager';

export function registerAgentHandlers(server: McpServer, manager: AgentManager) {

  // ===========================================
  // agent_spawn - Agent 생성
  // ===========================================
  server.tool(
    'agent_spawn',
    'Sub Agent를 생성합니다. 특정 역할과 Skill을 가진 전문 Agent를 생성합니다.',
    {
      role: z.enum(['code', 'test', 'review', 'docs', 'security', 'performance'])
        .describe('Agent 역할'),
      task_id: z.string().describe('담당할 태스크 ID'),
      skills: z.array(z.string()).optional()
        .describe('로드할 Skill 목록 (생략 시 기본 Skill 사용)'),
      context: z.object({
        task_title: z.string().optional(),
        task_description: z.string().optional(),
        related_files: z.array(z.string()).optional(),
        shared_data: z.record(z.any()).optional(),
      }).optional().describe('Agent에 전달할 컨텍스트'),
    },
    async ({ role, task_id, skills, context }) => {
      try {
        const instance = await manager.spawn(role, task_id, {
          skills,
          context: context ? {
            task: {
              id: task_id,
              title: context.task_title || '',
              description: context.task_description || '',
              related_files: context.related_files || [],
            },
            skills: {},
            shared: context.shared_data || {},
            parent_agent_id: null,
          } : undefined,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              agent_id: instance.id,
              role: instance.role,
              status: instance.status,
              skills_loaded: instance.skills_loaded,
              message: `${role} Agent가 생성되었습니다.`,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // agent_delegate - 태스크 위임
  // ===========================================
  server.tool(
    'agent_delegate',
    '생성된 Agent에게 태스크를 위임합니다. Agent가 즉시 실행을 시작합니다.',
    {
      agent_id: z.string().describe('Agent ID'),
      instructions: z.string().describe('Agent에게 전달할 구체적인 지시사항'),
      timeout_ms: z.number().optional().default(300000)
        .describe('타임아웃 (기본 5분)'),
    },
    async ({ agent_id, instructions, timeout_ms }) => {
      try {
        const instance = manager.getInstance(agent_id);
        if (!instance) {
          throw new Error(`Agent not found: ${agent_id}`);
        }

        // 실행 시작 (실제 실행은 executor에서 비동기 처리)
        // 여기서는 상태만 업데이트
        instance.status = 'running';
        instance.started_at = new Date().toISOString();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              agent_id,
              status: 'running',
              message: `${instance.role} Agent에게 태스크가 위임되었습니다.`,
              instructions_received: instructions.substring(0, 100) + '...',
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // agent_status - 상태 조회
  // ===========================================
  server.tool(
    'agent_status',
    'Agent의 현재 상태를 조회합니다.',
    {
      agent_id: z.string().optional().describe('특정 Agent ID (생략 시 전체 조회)'),
      task_id: z.string().optional().describe('특정 태스크의 Agent들만 조회'),
    },
    async ({ agent_id, task_id }) => {
      try {
        let instances;

        if (agent_id) {
          const instance = manager.getInstance(agent_id);
          instances = instance ? [instance] : [];
        } else if (task_id) {
          instances = manager.getInstancesByTask(task_id);
        } else {
          instances = manager.getRunningInstances();
        }

        const summary = instances.map(i => ({
          agent_id: i.id,
          role: i.role,
          status: i.status,
          task_id: i.task_id,
          skills: i.skills_loaded,
          created_at: i.created_at,
          started_at: i.started_at,
          completed_at: i.completed_at,
          has_result: !!i.result,
          error: i.error,
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: instances.length,
              agents: summary,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // agent_collect - 결과 수집
  // ===========================================
  server.tool(
    'agent_collect',
    'Agent의 실행 결과를 수집합니다. 실행 중이면 완료까지 대기합니다.',
    {
      agent_id: z.string().describe('결과를 수집할 Agent ID'),
      timeout_ms: z.number().optional().default(60000)
        .describe('대기 타임아웃 (기본 1분)'),
    },
    async ({ agent_id, timeout_ms }) => {
      try {
        const result = await Promise.race([
          manager.collect(agent_id),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Collection timeout')), timeout_ms)
          ),
        ]);

        if (!result) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'No result available',
              }, null, 2),
            }],
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              result,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // agent_terminate - Agent 종료
  // ===========================================
  server.tool(
    'agent_terminate',
    'Agent를 강제 종료합니다.',
    {
      agent_id: z.string().describe('종료할 Agent ID'),
    },
    async ({ agent_id }) => {
      try {
        await manager.terminate(agent_id);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              agent_id,
              message: 'Agent가 종료되었습니다.',
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // agent_list_roles - 사용 가능한 역할 조회
  // ===========================================
  server.tool(
    'agent_list_roles',
    '사용 가능한 Agent 역할 목록을 조회합니다.',
    {},
    async () => {
      const registry = manager['registry'] as any;
      const definitions = registry.getAllDefinitions();

      const roles = definitions.map((d: any) => ({
        role: d.role,
        name: d.name,
        description: d.description,
        required_skills: d.skills.required,
        optional_skills: d.skills.optional,
        tools: d.tools,
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: roles.length,
            roles,
          }, null, 2),
        }],
      };
    }
  );
}
```

---

## Step 7: 병렬 실행 엔진

### 파일: `src/orchestration/parallel-engine.ts`

```typescript
import { EventEmitter } from 'events';
import type {
  OrchestrationPlan,
  OrchestrationStage,
  AgentRole,
  AgentResult,
  CollectionResult,
  ConflictItem,
} from '../types/agent.types';
import { AgentManager } from './agent-manager';

export class ParallelEngine extends EventEmitter {
  private manager: AgentManager;
  private activePlans: Map<string, OrchestrationPlan> = new Map();

  constructor(manager: AgentManager) {
    super();
    this.manager = manager;
  }

  // ===========================================
  // 오케스트레이션 플랜 실행
  // ===========================================
  async execute(plan: OrchestrationPlan): Promise<CollectionResult> {
    this.activePlans.set(plan.id, plan);
    plan.status = 'running';

    const allResults: AgentResult[] = [];

    try {
      for (const stage of plan.stages) {
        console.log(`[ParallelEngine] Executing stage: ${stage.name}`);

        const stageResults = stage.parallel
          ? await this.executeParallel(plan.task_id, stage)
          : await this.executeSequential(plan.task_id, stage);

        allResults.push(...stageResults);

        // 실패한 Agent가 있으면 중단 (옵션에 따라)
        const hasError = stageResults.some(r => r.status === 'failed');
        if (hasError) {
          console.warn(`[ParallelEngine] Stage ${stage.name} has failures`);
          // continue anyway or break based on config
        }
      }

      plan.status = 'completed';

      // 결과 병합
      const merged = await this.mergeResults(plan, allResults);

      this.emit('plan:completed', { planId: plan.id, result: merged });
      return merged;

    } catch (error) {
      plan.status = 'failed';
      this.emit('plan:failed', { planId: plan.id, error });
      throw error;
    } finally {
      this.activePlans.delete(plan.id);
    }
  }

  // ===========================================
  // 병렬 실행
  // ===========================================
  private async executeParallel(
    taskId: string,
    stage: OrchestrationStage
  ): Promise<AgentResult[]> {
    console.log(`[ParallelEngine] Running ${stage.agents.length} agents in parallel`);

    // 모든 Agent 동시 생성 및 실행
    const promises = stage.agents.map(async (agentConfig) => {
      const instance = await this.manager.spawn(
        agentConfig.role,
        taskId,
        { skills: agentConfig.skills }
      );

      // 실행 시작
      instance.status = 'running';
      instance.started_at = new Date().toISOString();

      // 실제 실행 시뮬레이션 (실제로는 executor에서 처리)
      // 여기서는 결과 대기
      const result = await this.waitForResult(instance.id, stage.timeout_ms);
      return result;
    });

    // 모든 Agent 완료 대기
    const results = await Promise.allSettled(promises);

    return results.map((r, i) => {
      if (r.status === 'fulfilled') {
        return r.value;
      } else {
        // 실패 시 빈 결과
        return {
          agent_id: `failed-${i}`,
          role: stage.agents[i].role,
          task_id: taskId,
          status: 'failed' as const,
          output: null,
          artifacts: [],
          metrics: { duration_ms: 0, tool_calls: 0, tokens_used: 0 },
          timestamp: new Date().toISOString(),
        };
      }
    });
  }

  // ===========================================
  // 순차 실행
  // ===========================================
  private async executeSequential(
    taskId: string,
    stage: OrchestrationStage
  ): Promise<AgentResult[]> {
    console.log(`[ParallelEngine] Running ${stage.agents.length} agents sequentially`);

    const results: AgentResult[] = [];
    let previousResult: AgentResult | null = null;

    for (const agentConfig of stage.agents) {
      // 이전 Agent의 결과를 컨텍스트로 전달
      const instance = await this.manager.spawn(
        agentConfig.role,
        taskId,
        {
          skills: agentConfig.skills,
          context: previousResult ? {
            task: { id: taskId, title: '', description: '', related_files: [] },
            skills: {},
            shared: { previous_result: previousResult },
            parent_agent_id: null,
          } : undefined,
        }
      );

      instance.status = 'running';
      instance.started_at = new Date().toISOString();

      const result = await this.waitForResult(instance.id, stage.timeout_ms);
      results.push(result);
      previousResult = result;

      // 실패 시 중단 옵션
      if (result.status === 'failed') {
        console.warn(`[ParallelEngine] Agent ${instance.id} failed, stopping sequence`);
        break;
      }
    }

    return results;
  }

  // ===========================================
  // 결과 대기
  // ===========================================
  private async waitForResult(agentId: string, timeoutMs: number): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Agent ${agentId} timed out`));
      }, timeoutMs);

      const handler = (data: { agentId: string; result: AgentResult }) => {
        if (data.agentId === agentId) {
          clearTimeout(timeout);
          this.manager.off('agent:completed', handler);
          this.manager.off('agent:error', errorHandler);
          resolve(data.result);
        }
      };

      const errorHandler = (data: { agentId: string; error: string }) => {
        if (data.agentId === agentId) {
          clearTimeout(timeout);
          this.manager.off('agent:completed', handler);
          this.manager.off('agent:error', errorHandler);
          reject(new Error(data.error));
        }
      };

      this.manager.on('agent:completed', handler);
      this.manager.on('agent:error', errorHandler);
    });
  }

  // ===========================================
  // 결과 병합
  // ===========================================
  private async mergeResults(
    plan: OrchestrationPlan,
    results: AgentResult[]
  ): Promise<CollectionResult> {
    const conflicts: ConflictItem[] = [];

    // 파일 변경 충돌 감지
    const fileChanges = new Map<string, AgentResult[]>();

    for (const result of results) {
      for (const artifact of result.artifacts) {
        if (artifact.type === 'file' && artifact.path) {
          if (!fileChanges.has(artifact.path)) {
            fileChanges.set(artifact.path, []);
          }
          fileChanges.get(artifact.path)!.push(result);
        }
      }
    }

    // 같은 파일을 여러 Agent가 수정한 경우 충돌
    for (const [path, agents] of fileChanges) {
      if (agents.length > 1) {
        conflicts.push({
          type: 'file_change',
          source_agents: agents.map(a => a.agent_id),
          description: `Multiple agents modified: ${path}`,
        });
      }
    }

    // 권장사항 충돌 감지
    const recommendations = results
      .filter(r => r.output?.recommendations)
      .flatMap(r => r.output.recommendations);

    // 상충되는 권장사항 찾기 (간단한 구현)
    const contradictions = this.findContradictions(recommendations);
    conflicts.push(...contradictions);

    // 요약 생성
    const summary = this.generateSummary(results, conflicts);

    return {
      plan_id: plan.id,
      task_id: plan.task_id,
      agents: results,
      merged_output: this.mergeOutputs(results),
      conflicts,
      summary,
    };
  }

  private mergeOutputs(results: AgentResult[]): any {
    const merged: any = {
      files_created: [],
      files_modified: [],
      tests_added: [],
      issues_found: [],
      recommendations: [],
    };

    for (const result of results) {
      if (!result.output) continue;

      // 배열 필드 병합
      for (const key of Object.keys(merged)) {
        if (Array.isArray(result.output[key])) {
          merged[key].push(...result.output[key]);
        }
      }
    }

    // 중복 제거
    for (const key of Object.keys(merged)) {
      if (Array.isArray(merged[key])) {
        merged[key] = [...new Set(merged[key])];
      }
    }

    return merged;
  }

  private findContradictions(recommendations: any[]): ConflictItem[] {
    // 간단한 구현: 같은 대상에 대한 상반된 권장사항 찾기
    const conflicts: ConflictItem[] = [];

    // 실제로는 더 정교한 로직 필요
    // 예: "함수 A를 분리하라" vs "함수 A를 유지하라"

    return conflicts;
  }

  private generateSummary(results: AgentResult[], conflicts: ConflictItem[]): string {
    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const roles = [...new Set(results.map(r => r.role))];

    let summary = `## 실행 요약\n\n`;
    summary += `- **총 Agent**: ${results.length}개\n`;
    summary += `- **성공**: ${successful}개\n`;
    summary += `- **실패**: ${failed}개\n`;
    summary += `- **역할**: ${roles.join(', ')}\n`;

    if (conflicts.length > 0) {
      summary += `\n### ⚠️ 충돌 감지: ${conflicts.length}건\n`;
      for (const c of conflicts) {
        summary += `- ${c.description}\n`;
      }
    }

    return summary;
  }

  // ===========================================
  // 유틸리티
  // ===========================================
  getActivePlan(planId: string): OrchestrationPlan | undefined {
    return this.activePlans.get(planId);
  }

  cancelPlan(planId: string): void {
    const plan = this.activePlans.get(planId);
    if (plan) {
      plan.status = 'failed';
      this.activePlans.delete(planId);
      this.emit('plan:cancelled', { planId });
    }
  }
}
```
---

*Phase 5 Part A 문서 끝*
*계속: Part B - Step 8-13 (실행 엔진 및 통합)*
