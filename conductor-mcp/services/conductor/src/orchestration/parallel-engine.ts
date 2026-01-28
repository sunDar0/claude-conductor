import { EventEmitter } from 'events';
import type {
  OrchestrationPlan,
  OrchestrationStage,
  AgentResult,
  CollectionResult,
  ConflictItem,
} from '../types/agent.types.js';
import { AgentManager } from './agent-manager.js';

export class ParallelEngine extends EventEmitter {
  private manager: AgentManager;
  private activePlans: Map<string, OrchestrationPlan> = new Map();

  constructor(manager: AgentManager) {
    super();
    this.manager = manager;
  }

  async execute(plan: OrchestrationPlan): Promise<CollectionResult> {
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
        { skills: agentConfig.skills }
      );

      await this.manager.startAgent(instance.id);

      // Simulate agent execution (in real implementation, this would delegate to actual agent)
      const result = await this.simulateAgentExecution(instance.id, stage.timeout_ms);
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

      await this.manager.startAgent(instance.id);

      const result = await this.simulateAgentExecution(instance.id, stage.timeout_ms);
      results.push(result);
      previousResult = result;

      if (result.status === 'failed') {
        console.warn(`[ParallelEngine] Agent ${instance.id} failed, stopping sequence`);
        break;
      }
    }

    return results;
  }

  private async simulateAgentExecution(agentId: string, _timeoutMs: number): Promise<AgentResult> {
    const instance = this.manager.getInstance(agentId);
    if (!instance) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Simulate work (in real implementation, this would be actual agent execution)
    const startTime = Date.now();

    // Create a simulated result
    const result: AgentResult = {
      agent_id: agentId,
      role: instance.role,
      task_id: instance.task_id || '',
      status: 'success',
      output: {
        message: `${instance.role} agent completed successfully`,
        recommendations: [],
      },
      artifacts: [],
      metrics: {
        duration_ms: Date.now() - startTime,
        tool_calls: 0,
        tokens_used: 0,
      },
      timestamp: new Date().toISOString(),
    };

    await this.manager.complete(agentId, result);
    return result;
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
