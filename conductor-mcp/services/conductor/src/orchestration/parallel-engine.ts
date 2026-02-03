import { EventEmitter } from 'events';
import type {
  OrchestrationPlan,
  OrchestrationStage,
  AgentResult,
  CollectionResult,
  ConflictItem,
  AgentInstance,
} from '../types/agent.types.js';
import { AgentManager } from './agent-manager.js';
import { AgentExecutor } from './agent-executor.js';

export class ParallelEngine extends EventEmitter {
  private manager: AgentManager;
  private executor: AgentExecutor;
  private activePlans: Map<string, OrchestrationPlan> = new Map();
  private currentWorkDir?: string;
  private currentTaskContext: { title: string; description: string; related_files?: string[] } | null = null;
  private publishEvent?: (event: string, data: unknown) => Promise<void>;

  constructor(manager: AgentManager, executor: AgentExecutor) {
    super();
    this.manager = manager;
    this.executor = executor;
  }

  setEventPublisher(fn: (event: string, data: unknown) => Promise<void>): void {
    this.publishEvent = fn;
  }

  async execute(plan: OrchestrationPlan, workDir?: string): Promise<CollectionResult> {
    this.currentWorkDir = workDir;
    this.currentTaskContext = plan.task_context || null;
    this.activePlans.set(plan.id, plan);
    plan.status = 'running';

    const allResults: AgentResult[] = [];
    // Stage 간 공유 컨텍스트: initial_shared로 시작하여 각 stage 결과를 누적
    const stageShared: Record<string, unknown> = { ...(plan.initial_shared || {}) };

    try {
      for (const stage of plan.stages) {
        console.error(`[ParallelEngine] Executing stage: ${stage.name} (shared keys: ${Object.keys(stageShared).join(', ')})`);

        const stageResults = stage.parallel
          ? await this.executeParallel(plan.task_id, stage, stageShared)
          : await this.executeSequential(plan.task_id, stage, stageShared);

        allResults.push(...stageResults);

        // 이전 stage 결과를 shared에 누적
        const stageOutput = stageResults
          .filter(r => r.status === 'success')
          .map(r => ({ role: r.role, output: r.output }));
        if (stageOutput.length > 0) {
          stageShared.previous_stage_results = stageOutput;
        }

        const hasError = stageResults.some(r => r.status === 'failed');
        if (hasError) {
          console.warn(`[ParallelEngine] Stage ${stage.name} has failures`);
        }
      }

      plan.status = 'completed';

      const merged = this.mergeResults(plan, allResults);

      this.emit('plan:completed', { planId: plan.id, result: merged });
      return merged;

    } catch (error) {
      plan.status = 'failed';
      console.error('[ParallelEngine] Plan execution failed:', error instanceof Error ? error.stack : error);
      this.emit('plan:failed', { planId: plan.id, error });
      throw error;
    } finally {
      this.activePlans.delete(plan.id);
    }
  }

  private async executeParallel(
    taskId: string,
    stage: OrchestrationStage,
    stageShared: Record<string, unknown>,
  ): Promise<AgentResult[]> {
    console.error(`[ParallelEngine] Running ${stage.agents.length} agents in parallel`);

    const promises = stage.agents.map(async (agentConfig) => {
      const taskCtx = this.currentTaskContext || { title: '', description: '', related_files: [] };
      const instance = await this.manager.spawn(
        agentConfig.role,
        taskId,
        {
          skills: agentConfig.skills,
          context: {
            task: {
              id: taskId,
              title: taskCtx.title,
              description: taskCtx.description,
              related_files: taskCtx.related_files || [],
            },
            skills: {},
            shared: { ...stageShared },
            parent_agent_id: null,
          },
        }
      );

      await this.manager.startAgent(instance.id);

      const result = await this.executeAgent(instance.id, stage.timeout_ms);
      return result;
    });

    const results = await Promise.allSettled(promises);

    return results.map((r, i) => {
      if (r.status === 'fulfilled') {
        return r.value;
      } else {
        console.error(`[ParallelEngine] Agent ${stage.agents[i].role} failed:`, r.reason);
        return {
          agent_id: `failed-${i}`,
          role: stage.agents[i].role,
          task_id: taskId,
          status: 'failed' as const,
          output: { message: `Agent execution failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}` },
          artifacts: [],
          metrics: { duration_ms: 0, tool_calls: 0, tokens_used: 0 },
          timestamp: new Date().toISOString(),
        };
      }
    });
  }

  private async executeSequential(
    taskId: string,
    stage: OrchestrationStage,
    stageShared: Record<string, unknown>,
  ): Promise<AgentResult[]> {
    console.error(`[ParallelEngine] Running ${stage.agents.length} agents sequentially`);

    const results: AgentResult[] = [];
    let previousResult: AgentResult | null = null;

    for (const agentConfig of stage.agents) {
      const taskCtx = this.currentTaskContext || { title: '', description: '', related_files: [] };
      const instance = await this.manager.spawn(
        agentConfig.role,
        taskId,
        {
          skills: agentConfig.skills,
          context: {
            task: {
              id: taskId,
              title: taskCtx.title,
              description: taskCtx.description,
              related_files: taskCtx.related_files || [],
            },
            skills: {},
            shared: {
              ...stageShared,
              ...(previousResult ? { previous_result: previousResult } : {}),
            },
            parent_agent_id: null,
          },
        }
      );

      await this.manager.startAgent(instance.id);

      const result = await this.executeAgent(instance.id, stage.timeout_ms);
      results.push(result);
      previousResult = result;

      if (result.status === 'failed') {
        console.warn(`[ParallelEngine] Agent ${instance.id} failed, stopping sequence`);
        break;
      }
    }

    return results;
  }

  private async executeAgent(agentId: string, timeoutMs: number): Promise<AgentResult> {
    const instance = this.manager.getInstance(agentId);
    if (!instance) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const startTime = Date.now();

    try {
      // Build prompt from agent context
      const prompt = this.buildAgentPrompt(instance);

      const taskId = instance.task_id || '';

      // Execute via Claude CLI with progress streaming
      const result = await this.executor.execute(agentId, instance.role, prompt, {
        timeoutMs,
        workDir: this.currentWorkDir,
        onProgress: (event) => {
          if (this.publishEvent) {
            this.publishEvent('pipeline:output', {
              task_id: taskId,
              event_type: event.type,
              output: `[${instance.role}] ${event.content}`,
              agent_id: agentId,
              timestamp: new Date().toISOString(),
            }).catch(() => {});
          }
        },
      });

      // Update result with correct task_id
      result.task_id = taskId;

      // Update agent status in manager based on result
      if (result.status === 'failed') {
        const errorMsg = (result.output as Record<string, unknown>)?.error as string || 'Agent execution failed';
        await this.manager.fail(agentId, errorMsg);
      } else {
        await this.manager.complete(agentId, result);
      }
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.manager.fail(agentId, errorMessage);

      return {
        agent_id: agentId,
        role: instance.role,
        task_id: instance.task_id || '',
        status: 'failed',
        output: { message: errorMessage, recommendations: [], tools_used: [] },
        artifacts: [],
        metrics: { duration_ms: Date.now() - startTime, tool_calls: 0, tokens_used: 0 },
        timestamp: new Date().toISOString(),
      };
    }
  }

  private buildAgentPrompt(instance: AgentInstance): string {
    const parts: string[] = [];
    const role = instance.role;
    const shared = instance.context.shared;

    // Role header
    parts.push(`# ${role.toUpperCase()} Agent Execution`);

    // Task context
    if (instance.context.task.title || instance.context.task.description) {
      parts.push(`\n## 태스크 정보`);
      parts.push(`- **ID**: ${instance.context.task.id}`);
      if (instance.context.task.title) parts.push(`- **제목**: ${instance.context.task.title}`);
      if (instance.context.task.description) parts.push(`- **설명**: ${instance.context.task.description}`);
      if (instance.context.task.related_files.length > 0) {
        parts.push(`- **관련 파일**: ${instance.context.task.related_files.join(', ')}`);
      }
    }

    // Loaded skills
    if (Object.keys(instance.context.skills).length > 0) {
      parts.push(`\n## 스킬 참조`);
      for (const [name, content] of Object.entries(instance.context.skills)) {
        parts.push(`\n### ${name}\n${content}`);
      }
    }

    // Shared context from previous stages
    if (shared.previous_stage_results) {
      const prevResults = shared.previous_stage_results as Array<{ role: string; output: Record<string, unknown> }>;
      parts.push(`\n## 이전 Stage 결과`);
      for (const prev of prevResults) {
        parts.push(`\n### ${prev.role} Agent 결과`);
        parts.push(`${prev.output?.message || JSON.stringify(prev.output)}`);
      }
    }

    // Shared context from previous agent in same stage (sequential)
    if (shared.previous_result) {
      const prev = shared.previous_result as Record<string, unknown>;
      if (prev.output) {
        const output = prev.output as Record<string, unknown>;
        parts.push(`\n## 이전 에이전트 결과`);
        parts.push(`${output.message || JSON.stringify(output)}`);
      }
    }

    // Role-specific instructions
    parts.push(`\n## 지침`);

    if (role === 'review' && shared.baseCommit) {
      parts.push(this.buildReviewInstructions(shared.baseCommit as string));
    } else if (role === 'security' && shared.baseCommit) {
      parts.push(this.buildSecurityInstructions(shared.baseCommit as string));
    } else if (role === 'test' && shared.baseCommit) {
      parts.push(this.buildTestInstructions(shared.baseCommit as string));
    } else {
      parts.push(`- 역할에 맞는 작업만 수행하세요`);
      parts.push(`- 완료 후 변경 사항을 요약하세요`);
    }

    parts.push(`- **모든 출력은 한글로 작성**`);
    parts.push(`\n지금 실행을 시작하세요.`);

    return parts.join('\n');
  }

  private buildReviewInstructions(baseCommit: string): string {
    return `당신은 코드 리뷰 전문가입니다. 다음 단계를 수행하세요:

1. \`git diff ${baseCommit}..HEAD\`를 실행하여 변경사항을 확인하세요
2. 변경된 파일들을 읽고 분석하세요
3. 다음 관점에서 리뷰하세요:
   - **코드 품질**: 가독성, 유지보수성, 중복 코드
   - **버그**: 잠재적 런타임 오류, 엣지 케이스
   - **패턴**: 프로젝트 기존 패턴과의 일관성
   - **성능**: 불필요한 연산, N+1 쿼리 등
4. 이슈를 심각도별(Critical, High, Medium, Low)로 분류하세요
5. 각 이슈에 구체적인 파일명, 라인, 수정 제안을 포함하세요
6. **파일을 수정하지 마세요** — 읽기 전용 분석만 수행`;
  }

  private buildSecurityInstructions(baseCommit: string): string {
    return `당신은 보안 전문가입니다. 다음 단계를 수행하세요:

1. \`git diff ${baseCommit}..HEAD\`를 실행하여 변경사항을 확인하세요
2. 변경된 파일들을 읽고 보안 관점에서 분석하세요
3. 다음 취약점을 점검하세요:
   - **인젝션**: SQL, 커맨드, XSS, 경로 순회
   - **인증/인가**: 인증 우회, 권한 상승
   - **민감 데이터**: 하드코딩된 비밀, 키, 토큰
   - **SSRF/CSRF**: 서버 사이드 요청 위조
   - **에러 처리**: 정보 누출, 스택 트레이스 노출
   - **의존성**: 알려진 취약한 라이브러리
4. 이슈를 심각도별(Critical, High, Medium, Low)로 분류하세요
5. 각 이슈에 CWE ID, 파일명, 라인, 수정 방법을 포함하세요
6. **파일을 수정하지 마세요** — 읽기 전용 분석만 수행`;
  }

  private buildTestInstructions(baseCommit: string): string {
    return `당신은 테스트 전문가입니다. 다음 단계를 수행하세요:

1. \`git diff ${baseCommit}..HEAD --name-only\`를 실행하여 변경된 파일을 확인하세요
2. 변경된 소스 파일에 대응하는 테스트 파일이 있는지 확인하세요
3. 기존 테스트가 있다면 실행하여 통과 여부를 확인하세요
4. 변경된 코드에 대해 다음을 점검하세요:
   - **기존 테스트 통과 여부**: 변경으로 인해 깨진 테스트가 없는지
   - **테스트 커버리지**: 새 코드에 대한 테스트가 충분한지
   - **엣지 케이스**: 경계값, null/undefined, 에러 케이스 테스트
5. 테스트 결과를 요약하세요 (통과/실패/누락)
6. **테스트 파일은 수정하지 마세요** — 분석과 실행만 수행`;
  }

  private mergeResults(
    plan: OrchestrationPlan,
    results: AgentResult[]
  ): CollectionResult {
    const conflicts: ConflictItem[] = [];

    // Detect file change conflicts
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

    for (const [path, agents] of fileChanges) {
      if (agents.length > 1) {
        conflicts.push({
          type: 'file_change',
          source_agents: agents.map(a => a.agent_id),
          description: `Multiple agents modified: ${path}`,
        });
      }
    }

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

  private mergeOutputs(results: AgentResult[]): Record<string, unknown> {
    const merged: Record<string, unknown[]> = {
      files_created: [],
      files_modified: [],
      tests_added: [],
      issues_found: [],
      recommendations: [],
    };

    for (const result of results) {
      if (!result.output) continue;

      for (const key of Object.keys(merged)) {
        const value = (result.output as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          (merged[key] as unknown[]).push(...value);
        }
      }
    }

    for (const key of Object.keys(merged)) {
      const arr = merged[key] as unknown[];
      merged[key] = [...new Set(arr.map(item =>
        typeof item === 'string' ? item : JSON.stringify(item)
      ))].map(item => {
        try { return JSON.parse(item as string); } catch { return item; }
      });
    }

    return merged;
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
