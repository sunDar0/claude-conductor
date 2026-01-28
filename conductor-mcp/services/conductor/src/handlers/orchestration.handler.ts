import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OrchestrationPlan, ExecutionStrategy, AgentRole } from '../types/agent.types.js';
import { ParallelEngine } from '../orchestration/parallel-engine.js';

const AGENT_ROLES = ['code', 'test', 'review', 'docs', 'security', 'performance'] as const;

export function registerOrchestrationHandlers(server: McpServer, engine: ParallelEngine): void {

  // orchestrate - 오케스트레이션 플랜 실행
  server.tool(
    'orchestrate',
    '여러 Agent를 조합하여 복잡한 태스크를 실행합니다. 병렬/순차 실행을 지원합니다.',
    {
      task_id: z.string().describe('대상 태스크 ID'),
      strategy: z.enum(['parallel', 'sequential', 'pipeline']).describe('실행 전략'),
      agents: z.array(z.object({
        role: z.enum(AGENT_ROLES),
        skills: z.array(z.string()).optional(),
        stage: z.number().optional().describe('파이프라인 스테이지 번호'),
      })).describe('실행할 Agent 목록'),
      options: z.object({
        timeout_ms: z.number().optional().default(600000),
        stop_on_error: z.boolean().optional().default(false),
      }).optional(),
    },
    async ({ task_id, strategy, agents }) => {
      try {
        const plan: OrchestrationPlan = {
          id: `plan-${Date.now()}-${uuid().slice(0, 8)}`,
          task_id,
          strategy,
          stages: buildStages(strategy, agents),
          created_at: new Date().toISOString(),
          status: 'pending',
        };

        const result = await engine.execute(plan);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              plan_id: plan.id,
              strategy,
              agents_executed: result.agents.length,
              conflicts: result.conflicts.length,
              summary: result.summary,
              merged_output: result.merged_output,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
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

  // orchestrate_review - 코드 리뷰 오케스트레이션
  server.tool(
    'orchestrate_review',
    '여러 관점의 Agent로 코드 리뷰를 병렬 실행합니다.',
    {
      task_id: z.string().describe('리뷰할 태스크 ID'),
      perspectives: z.array(z.enum(['code-review', 'security', 'performance']))
        .default(['code-review', 'security'])
        .describe('리뷰 관점'),
    },
    async ({ task_id, perspectives }) => {
      try {
        const agents = perspectives.map(p => ({
          role: (p === 'code-review' ? 'review' : p) as AgentRole,
          skills: [p],
        }));

        const plan: OrchestrationPlan = {
          id: `review-${Date.now()}`,
          task_id,
          strategy: 'parallel',
          stages: [{
            stage_id: 'review',
            name: 'Multi-perspective Review',
            agents,
            parallel: true,
            timeout_ms: 300000,
          }],
          created_at: new Date().toISOString(),
          status: 'pending',
        };

        const result = await engine.execute(plan);

        const allIssues = result.agents
          .flatMap(a => (a.output as Record<string, unknown>)?.issues as unknown[] || [])
          .sort((a: unknown, b: unknown) => {
            const severity: Record<string, number> = { critical: 0, warning: 1, info: 2 };
            const aObj = a as Record<string, string>;
            const bObj = b as Record<string, string>;
            return (severity[aObj.severity] || 2) - (severity[bObj.severity] || 2);
          });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              task_id,
              perspectives_reviewed: perspectives,
              total_issues: allIssues.length,
              issues_by_severity: {
                critical: allIssues.filter((i: unknown) => (i as Record<string, string>).severity === 'critical').length,
                warning: allIssues.filter((i: unknown) => (i as Record<string, string>).severity === 'warning').length,
                info: allIssues.filter((i: unknown) => (i as Record<string, string>).severity === 'info').length,
              },
              issues: allIssues,
              summary: result.summary,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
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

  // orchestrate_implement - 구현 오케스트레이션
  server.tool(
    'orchestrate_implement',
    '코드 구현 → 테스트 작성 → 리뷰 파이프라인을 실행합니다.',
    {
      task_id: z.string().describe('구현할 태스크 ID'),
      include_docs: z.boolean().default(false).describe('문서화 포함 여부'),
    },
    async ({ task_id, include_docs }) => {
      try {
        const stages = [
          {
            stage_id: 'implement',
            name: 'Code Implementation',
            agents: [{ role: 'code' as AgentRole, skills: ['coding'] }],
            parallel: false,
            timeout_ms: 300000,
          },
          {
            stage_id: 'test',
            name: 'Test Writing',
            agents: [{ role: 'test' as AgentRole, skills: ['testing'] }],
            parallel: false,
            timeout_ms: 180000,
          },
          {
            stage_id: 'review',
            name: 'Code Review',
            agents: [
              { role: 'review' as AgentRole, skills: ['code-review'] },
              { role: 'security' as AgentRole, skills: ['security'] },
            ],
            parallel: true,
            timeout_ms: 180000,
          },
        ];

        if (include_docs) {
          stages.push({
            stage_id: 'docs',
            name: 'Documentation',
            agents: [{ role: 'docs' as AgentRole, skills: ['api-docs', 'changelog'] }],
            parallel: false,
            timeout_ms: 120000,
          });
        }

        const plan: OrchestrationPlan = {
          id: `impl-${Date.now()}`,
          task_id,
          strategy: 'pipeline',
          stages,
          created_at: new Date().toISOString(),
          status: 'pending',
        };

        const result = await engine.execute(plan);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              task_id,
              stages_completed: plan.stages.length,
              pipeline: plan.stages.map(s => s.name),
              summary: result.summary,
              artifacts: result.agents.flatMap(a => a.artifacts),
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
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
}

function buildStages(
  strategy: ExecutionStrategy,
  agents: { role: AgentRole; skills?: string[]; stage?: number }[]
): OrchestrationPlan['stages'] {
  switch (strategy) {
    case 'parallel':
      return [{
        stage_id: 'parallel-all',
        name: 'Parallel Execution',
        agents: agents.map(a => ({ role: a.role, skills: a.skills })),
        parallel: true,
        timeout_ms: 300000,
      }];

    case 'sequential':
      return agents.map((a, i) => ({
        stage_id: `seq-${i}`,
        name: `Step ${i + 1}: ${a.role}`,
        agents: [{ role: a.role, skills: a.skills }],
        parallel: false,
        timeout_ms: 180000,
      }));

    case 'pipeline':
      const stageMap = new Map<number, typeof agents>();
      agents.forEach(a => {
        const stageNum = a.stage || 0;
        if (!stageMap.has(stageNum)) stageMap.set(stageNum, []);
        stageMap.get(stageNum)!.push(a);
      });

      return Array.from(stageMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([num, stageAgents]) => ({
          stage_id: `stage-${num}`,
          name: `Stage ${num}`,
          agents: stageAgents.map(a => ({ role: a.role, skills: a.skills })),
          parallel: stageAgents.length > 1,
          timeout_ms: 300000,
        }));

    default:
      return [];
  }
}
