import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentManager } from '../orchestration/agent-manager.js';

const AGENT_ROLES = ['code', 'test', 'review', 'docs', 'security', 'performance'] as const;

export function registerAgentHandlers(server: McpServer, manager: AgentManager): void {

  // agent_spawn - Agent 생성
  server.tool(
    'agent_spawn',
    'Sub Agent를 생성합니다. 특정 역할과 Skill을 가진 전문 Agent를 생성합니다.',
    {
      role: z.enum(AGENT_ROLES).describe('Agent 역할'),
      task_id: z.string().describe('담당할 태스크 ID'),
      skills: z.array(z.string()).optional().describe('로드할 Skill 목록'),
      context: z.object({
        task_title: z.string().optional(),
        task_description: z.string().optional(),
        related_files: z.array(z.string()).optional(),
        shared_data: z.record(z.unknown()).optional(),
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
            type: 'text' as const,
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

  // agent_delegate - 태스크 위임
  server.tool(
    'agent_delegate',
    '생성된 Agent에게 태스크를 위임합니다. Agent가 즉시 실행을 시작합니다.',
    {
      agent_id: z.string().describe('Agent ID'),
      instructions: z.string().describe('Agent에게 전달할 구체적인 지시사항'),
      timeout_ms: z.number().optional().default(300000).describe('타임아웃 (기본 5분)'),
    },
    async ({ agent_id, instructions }) => {
      try {
        const instance = manager.getInstance(agent_id);
        if (!instance) {
          throw new Error(`Agent not found: ${agent_id}`);
        }

        await manager.startAgent(agent_id);

        return {
          content: [{
            type: 'text' as const,
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

  // agent_status - 상태 조회
  server.tool(
    'agent_status',
    'Agent의 현재 상태를 조회합니다.',
    {
      agent_id: z.string().optional().describe('특정 Agent ID'),
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
          instances = manager.getAllInstances();
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
            type: 'text' as const,
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

  // agent_collect - 결과 수집
  server.tool(
    'agent_collect',
    'Agent의 실행 결과를 수집합니다.',
    {
      agent_id: z.string().describe('결과를 수집할 Agent ID'),
      timeout_ms: z.number().optional().default(60000).describe('대기 타임아웃'),
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
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: 'No result available',
              }, null, 2),
            }],
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              result,
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

  // agent_terminate - Agent 종료
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
            type: 'text' as const,
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

  // agent_list_roles - 사용 가능한 역할 조회
  server.tool(
    'agent_list_roles',
    '사용 가능한 Agent 역할 목록을 조회합니다.',
    {},
    async () => {
      const registry = manager.getRegistry();
      const definitions = registry.getAllDefinitions();

      const roles = definitions.map(d => ({
        role: d.role,
        name: d.name,
        description: d.description,
        required_skills: d.skills.required,
        optional_skills: d.skills.optional,
        tools: d.tools,
      }));

      return {
        content: [{
          type: 'text' as const,
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
