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

  constructor(manager: AgentManager, executor: AgentExecutor) {
    super();
    this.manager = manager;
    this.executor = executor;
  }

  async execute(plan: OrchestrationPlan, workDir?: string): Promise<CollectionResult> {
    this.currentWorkDir = workDir;
    this.currentTaskContext = plan.task_context || null;
    this.activePlans.set(plan.id, plan);
    plan.status = 'running';

    const allResults: AgentResult[] = [];

    try {
      for (const stage of plan.stages) {
        console.error(`[ParallelEngine] Executing stage: ${stage.name}`);

        const stageResults = stage.parallel
          ? await this.executeParallel(plan.task_id, stage)
          : await this.executeSequential(plan.task_id, stage);

        allResults.push(...stageResults);

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
    stage: OrchestrationStage
  ): Promise<AgentResult[]> {
    console.error(`[ParallelEngine] Running ${stage.agents.length} agents in parallel`);

    const promises = stage.agents.map(async (agentConfig) => {
      const instance = await this.manager.spawn(
        agentConfig.role,
        taskId,
        {
          skills: agentConfig.skills,
          context: this.currentTaskContext ? {
            task: {
              id: taskId,
              title: this.currentTaskContext.title,
              description: this.currentTaskContext.description,
              related_files: this.currentTaskContext.related_files || [],
            },
            skills: {},
            shared: {},
            parent_agent_id: null,
          } : undefined,
        }
      );

      await this.manager.startAgent(instance.id);

      // Execute agent using Claude CLI
      const result = await this.executeAgent(instance.id, stage.timeout_ms);
      return result;
    });

    const results = await Promise.allSettled(promises);

    return results.map((r, i) => {
      if (r.status === 'fulfilled') {
        return r.value;
      } else {
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

  private async executeSequential(
    taskId: string,
    stage: OrchestrationStage
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
            shared: previousResult ? { previous_result: previousResult } : {},
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

      // Execute via Claude CLI
      const result = await this.executor.execute(agentId, instance.role, prompt, {
        timeoutMs,
        workDir: this.currentWorkDir,
      });

      // Update result with correct task_id
      result.task_id = instance.task_id || '';

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

    // Role header
    parts.push(`# ${instance.role.toUpperCase()} Agent Execution`);

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

    // Shared context from previous agents
    if (Object.keys(instance.context.shared).length > 0) {
      parts.push(`\n## 이전 에이전트 결과`);
      const shared = instance.context.shared;
      if (shared.previous_result) {
        const prev = shared.previous_result as Record<string, unknown>;
        if (prev.output) {
          const output = prev.output as Record<string, unknown>;
          parts.push(`\n이전 작업 결과:\n${output.message || JSON.stringify(output)}`);
        }
      }
    }

    // Instructions
    parts.push(`\n## 지침`);
    parts.push(`- 역할에 맞는 작업만 수행하세요`);
    parts.push(`- 완료 후 변경 사항을 요약하세요`);
    parts.push(`- **모든 출력은 한글로 작성**`);
    parts.push(`\n지금 실행을 시작하세요.`);

    return parts.join('\n');
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
