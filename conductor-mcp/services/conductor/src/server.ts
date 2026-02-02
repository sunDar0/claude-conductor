import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Redis } from 'ioredis';
import { mcpLogger as log } from './utils/logger.js';

import {
  handleTaskCreate,
  handleTaskList,
  handleTaskGet,
  handleTaskStart,
  handleTaskTransition,
} from './handlers/task.handler.js';
import {
  handleProjectCreate,
  handleProjectList,
  handleProjectSelect,
  handleProjectGet,
  handleProjectDelete,
} from './handlers/project.handler.js';
import {
  handleServerStart,
  handleServerStop,
  handleServerStatus,
  handleServerLogs,
  handleServerHealth,
  handleServerOpen,
  handleApiDocs,
} from './handlers/server.handler.js';
import { handleChangelogGenerate } from './handlers/changelog.handler.js';
import { handleReviewCode } from './handlers/review.handler.js';
import { initAutoPipeline } from './handlers/auto-pipeline.js';
import { readTaskRegistry, readServerRegistry } from './utils/registry.js';
import { updateAgentCache, updateAgentRolesCache } from './http-server.js';

// Phase 5: Orchestration imports
import { AgentRegistry } from './orchestration/agent-registry.js';
import { SkillLoader } from './orchestration/skill-loader.js';
import { AgentManager } from './orchestration/agent-manager.js';
import { AgentExecutor } from './orchestration/agent-executor.js';
import { ParallelEngine } from './orchestration/parallel-engine.js';
import type { AgentRole, ExecutionStrategy, OrchestrationPlan } from './types/agent.types.js';
import { v4 as uuid } from 'uuid';

let redis: Redis | null = null;
let agentManager: AgentManager | null = null;
let parallelEngine: ParallelEngine | null = null;

async function initRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      redis = new Redis(redisUrl);
      log.info('Redis connected');
    } catch (error) {
      log.error({ error }, 'Redis connection failed');
    }
  }
}

async function initOrchestration(): Promise<void> {
  if (!redis) {
    log.warn('Redis not available, orchestration disabled');
    return;
  }

  const homeDir = process.env.HOME || '/root';
  const workspaceDir = process.env.WORKSPACE_DIR || '/workspace';

  try {
    // AgentRegistry and SkillLoader read from ~/.claude/ (global Claude config)
    const registry = new AgentRegistry(homeDir);
    await registry.initialize();

    const skillLoader = new SkillLoader(homeDir);

    agentManager = new AgentManager(registry, skillLoader, redis);
    await agentManager.restoreInstances();

    const agentExecutor = new AgentExecutor();
    parallelEngine = new ParallelEngine(agentManager, agentExecutor);

    // Sync agent state to HTTP API cache
    const syncAgentCache = () => {
      if (agentManager) {
        updateAgentCache(agentManager.getAllInstances());
      }
    };
    setInterval(syncAgentCache, 2000);

    // Update agent roles cache
    const roles = registry.getAllDefinitions().map(def => ({
      role: def.role,
      name: def.name,
      description: def.description,
      skills: def.skills,
    }));
    updateAgentRolesCache(roles);

    log.info({ roleCount: roles.length }, 'Orchestration initialized');
  } catch (error) {
    log.error({ error }, 'Orchestration initialization failed');
  }
}

export async function publishEvent(event: string, data: unknown): Promise<void> {
  if (redis) {
    await redis.publish('conductor:events', JSON.stringify({
      event,
      data,
      timestamp: new Date().toISOString(),
    }));
  }
}

export async function createMCPServer(): Promise<Server> {
  await initRedis();
  await initOrchestration();

  // Initialize auto pipeline (Claude CLI automation)
  initAutoPipeline(redis, publishEvent, parallelEngine, agentManager);
  log.info('Auto pipeline initialized');

  const server = new Server(
    {
      name: process.env.MCP_SERVER_NAME || 'claude-conductor',
      version: process.env.MCP_SERVER_VERSION || '1.1.0',
    },
    { capabilities: { tools: {}, resources: {} } }
  );

  // Tools definition
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // === Phase 2 Tools ===
      {
        name: 'task_create',
        description: 'Create a new task',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Task title' },
            description: { type: 'string', description: 'Task description' },
            priority: {
              type: 'string',
              enum: ['critical', 'high', 'medium', 'low'],
              default: 'medium',
            },
            project_id: { type: 'string', description: 'Project ID (defaults to current project)' },
          },
          required: ['description'],
        },
      },
      {
        name: 'task_list',
        description: 'List all tasks',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Filter by status' },
            priority: { type: 'string', description: 'Filter by priority' },
            project_id: { type: 'string', description: 'Filter by project ID' },
            all_projects: { type: 'boolean', description: 'Show tasks from all projects', default: false },
          },
        },
      },
      // === Project Management Tools ===
      {
        name: 'project_create',
        description: 'Create a new project',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name' },
            path: { type: 'string', description: 'Project path (defaults to current directory)' },
          },
          required: ['name'],
        },
      },
      {
        name: 'project_list',
        description: 'List all projects',
        inputSchema: {
          type: 'object',
          properties: {
            active_only: { type: 'boolean', description: 'Show only active projects', default: true },
          },
        },
      },
      {
        name: 'project_select',
        description: 'Select a project to work on',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: 'Project ID to select' },
          },
          required: ['project_id'],
        },
      },
      {
        name: 'project_get',
        description: 'Get project details',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: 'Project ID' },
          },
          required: ['project_id'],
        },
      },
      {
        name: 'project_delete',
        description: 'Delete (deactivate) a project',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: 'Project ID to delete' },
          },
          required: ['project_id'],
        },
      },
      {
        name: 'task_get',
        description: 'Get task details',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'task_start',
        description: 'Start a task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'task_transition',
        description: 'Transition task state',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            target_state: { type: 'string', description: 'Target status' },
            feedback: { type: 'string', description: 'Feedback (for rejection)' },
          },
          required: ['task_id', 'target_state'],
        },
      },
      {
        name: 'server_start',
        description: 'Start development server',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            port: { type: 'number', description: 'Port number' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'server_stop',
        description: 'Stop development server',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            force: { type: 'boolean', description: 'Force stop' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'server_status',
        description: 'Get server status',
        inputSchema: { type: 'object', properties: {} },
      },

      // === Phase 3 Tools ===
      {
        name: 'review_code',
        description: 'Analyze code changes and provide review points',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            base_branch: { type: 'string', description: 'Base branch to compare (default: main)' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'changelog_generate',
        description: 'Generate CHANGELOG from git commits',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            version: { type: 'string', description: 'Version (auto if not specified)' },
            from_ref: { type: 'string', description: 'Start commit/tag' },
            to_ref: { type: 'string', description: 'End commit (default: HEAD)' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'server_logs',
        description: 'Get server logs',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            lines: { type: 'number', description: 'Number of lines (default: 50)' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'server_health',
        description: 'Check server health',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'server_open',
        description: 'Open server in browser',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            path: { type: 'string', description: 'Path (default: /)' },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'api_docs',
        description: 'Get API documentation URLs',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID (all if omitted)' },
          },
        },
      },

      // === Phase 5 Tools: Agent Orchestration ===
      {
        name: 'agent_spawn',
        description: 'Create a Sub Agent with specific role and skills',
        inputSchema: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['code', 'test', 'review', 'docs', 'security', 'performance'], description: 'Agent role' },
            task_id: { type: 'string', description: 'Task ID to assign' },
            skills: { type: 'array', items: { type: 'string' }, description: 'Skills to load' },
            context: {
              type: 'object',
              properties: {
                task_title: { type: 'string' },
                task_description: { type: 'string' },
                related_files: { type: 'array', items: { type: 'string' } },
                shared_data: { type: 'object' },
              },
            },
          },
          required: ['role', 'task_id'],
        },
      },
      {
        name: 'agent_delegate',
        description: 'Delegate task to an agent',
        inputSchema: {
          type: 'object',
          properties: {
            agent_id: { type: 'string', description: 'Agent ID' },
            instructions: { type: 'string', description: 'Instructions for the agent' },
            timeout_ms: { type: 'number', description: 'Timeout in milliseconds' },
          },
          required: ['agent_id', 'instructions'],
        },
      },
      {
        name: 'agent_status',
        description: 'Get agent status',
        inputSchema: {
          type: 'object',
          properties: {
            agent_id: { type: 'string', description: 'Specific agent ID' },
            task_id: { type: 'string', description: 'Filter by task ID' },
          },
        },
      },
      {
        name: 'agent_collect',
        description: 'Collect agent execution results',
        inputSchema: {
          type: 'object',
          properties: {
            agent_id: { type: 'string', description: 'Agent ID' },
            timeout_ms: { type: 'number', description: 'Wait timeout' },
          },
          required: ['agent_id'],
        },
      },
      {
        name: 'agent_terminate',
        description: 'Terminate an agent',
        inputSchema: {
          type: 'object',
          properties: {
            agent_id: { type: 'string', description: 'Agent ID to terminate' },
          },
          required: ['agent_id'],
        },
      },
      {
        name: 'agent_list_roles',
        description: 'List available agent roles',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'orchestrate',
        description: 'Execute multiple agents with orchestration strategy',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            strategy: { type: 'string', enum: ['parallel', 'sequential', 'pipeline'], description: 'Execution strategy' },
            agents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['code', 'test', 'review', 'docs', 'security', 'performance'] },
                  skills: { type: 'array', items: { type: 'string' } },
                  stage: { type: 'number' },
                },
                required: ['role'],
              },
            },
          },
          required: ['task_id', 'strategy', 'agents'],
        },
      },
      {
        name: 'orchestrate_review',
        description: 'Run parallel code review from multiple perspectives',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID to review' },
            perspectives: { type: 'array', items: { type: 'string', enum: ['code-review', 'security', 'performance'] } },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'orchestrate_implement',
        description: 'Run implementation pipeline: code → test → review → docs',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            include_docs: { type: 'boolean', description: 'Include documentation stage' },
          },
          required: ['task_id'],
        },
      },

          ],
  }));

  // Tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        // Phase 2 Tools
        case 'task_create':
          return await handleTaskCreate(args as Parameters<typeof handleTaskCreate>[0], publishEvent);
        case 'task_list':
          return await handleTaskList(args as Parameters<typeof handleTaskList>[0]);
        case 'task_get':
          return await handleTaskGet(args as Parameters<typeof handleTaskGet>[0]);
        case 'task_start':
          return await handleTaskStart(args as Parameters<typeof handleTaskStart>[0], publishEvent);
        case 'task_transition':
          return await handleTaskTransition(args as Parameters<typeof handleTaskTransition>[0], publishEvent);
        case 'server_start':
          return await handleServerStart(args as Parameters<typeof handleServerStart>[0], publishEvent);
        case 'server_stop':
          return await handleServerStop(args as Parameters<typeof handleServerStop>[0], publishEvent);
        case 'server_status':
          return await handleServerStatus();

        // Project Tools
        case 'project_create':
          return await handleProjectCreate(args as Parameters<typeof handleProjectCreate>[0], publishEvent);
        case 'project_list':
          return await handleProjectList(args as Parameters<typeof handleProjectList>[0]);
        case 'project_select':
          return await handleProjectSelect(args as Parameters<typeof handleProjectSelect>[0], publishEvent);
        case 'project_get':
          return await handleProjectGet(args as Parameters<typeof handleProjectGet>[0]);
        case 'project_delete':
          return await handleProjectDelete(args as Parameters<typeof handleProjectDelete>[0], publishEvent);

        // Phase 3 Tools
        case 'review_code':
          return await handleReviewCode(args as Parameters<typeof handleReviewCode>[0], publishEvent);
        case 'changelog_generate':
          return await handleChangelogGenerate(args as Parameters<typeof handleChangelogGenerate>[0], publishEvent);
        case 'server_logs':
          return await handleServerLogs(args as Parameters<typeof handleServerLogs>[0]);
        case 'server_health':
          return await handleServerHealth(args as Parameters<typeof handleServerHealth>[0]);
        case 'server_open':
          return await handleServerOpen(args as Parameters<typeof handleServerOpen>[0]);
        case 'api_docs':
          return await handleApiDocs(args as Parameters<typeof handleApiDocs>[0]);

        // Phase 5 Tools: Agent Orchestration
        case 'agent_spawn':
          return await handleAgentSpawn(args as { role: string; task_id: string; skills?: string[]; context?: Record<string, unknown> });
        case 'agent_delegate':
          return await handleAgentDelegate(args as { agent_id: string; instructions: string; timeout_ms?: number });
        case 'agent_status':
          return await handleAgentStatus(args as { agent_id?: string; task_id?: string });
        case 'agent_collect':
          return await handleAgentCollect(args as { agent_id: string; timeout_ms?: number });
        case 'agent_terminate':
          return await handleAgentTerminate(args as { agent_id: string });
        case 'agent_list_roles':
          return await handleAgentListRoles();
        case 'orchestrate':
          return await handleOrchestrate(args as { task_id: string; strategy: string; agents: Array<{ role: string; skills?: string[]; stage?: number }> });
        case 'orchestrate_review':
          return await handleOrchestrateReview(args as { task_id: string; perspectives?: string[] });
        case 'orchestrate_implement':
          return await handleOrchestrateImplement(args as { task_id: string; include_docs?: boolean });

        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : error}` }],
        isError: true,
      };
    }
  });

  // Resources definition
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: 'conductor://tasks', name: 'All Tasks', mimeType: 'application/json' },
      { uri: 'conductor://servers', name: 'Running Servers', mimeType: 'application/json' },
      { uri: 'conductor://changelog', name: 'Project CHANGELOG', mimeType: 'text/markdown' },
    ],
  }));

  // Resource reading
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    switch (uri) {
      case 'conductor://tasks':
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify((await readTaskRegistry()).tasks, null, 2),
          }],
        };
      case 'conductor://servers':
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify((await readServerRegistry()).servers, null, 2),
          }],
        };
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });

  return server;
}

// === Phase 5 Handler Functions ===

async function handleAgentSpawn(args: { role: string; task_id: string; skills?: string[]; context?: Record<string, unknown> }) {
  if (!agentManager) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Orchestration not initialized' }) }], isError: true };
  }
  try {
    const instance = await agentManager.spawn(args.role as AgentRole, args.task_id, {
      skills: args.skills,
      context: args.context ? {
        task: {
          id: args.task_id,
          title: (args.context.task_title as string) || '',
          description: (args.context.task_description as string) || '',
          related_files: (args.context.related_files as string[]) || [],
        },
        skills: {},
        shared: (args.context.shared_data as Record<string, unknown>) || {},
        parent_agent_id: null,
      } : undefined,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, agent_id: instance.id, role: instance.role, status: instance.status, skills_loaded: instance.skills_loaded }, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) }], isError: true };
  }
}

async function handleAgentDelegate(args: { agent_id: string; instructions: string; timeout_ms?: number }) {
  if (!agentManager) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Orchestration not initialized' }) }], isError: true };
  }
  try {
    const instance = agentManager.getInstance(args.agent_id);
    if (!instance) throw new Error(`Agent not found: ${args.agent_id}`);
    await agentManager.startAgent(args.agent_id);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, agent_id: args.agent_id, status: 'running', message: `${instance.role} Agent에게 태스크가 위임되었습니다.` }, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) }], isError: true };
  }
}

async function handleAgentStatus(args: { agent_id?: string; task_id?: string }) {
  if (!agentManager) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Orchestration not initialized' }) }], isError: true };
  }
  try {
    let instances;
    if (args.agent_id) {
      const instance = agentManager.getInstance(args.agent_id);
      instances = instance ? [instance] : [];
    } else if (args.task_id) {
      instances = agentManager.getInstancesByTask(args.task_id);
    } else {
      instances = agentManager.getAllInstances();
    }
    const summary = instances.map(i => ({ agent_id: i.id, role: i.role, status: i.status, task_id: i.task_id, skills: i.skills_loaded, created_at: i.created_at, error: i.error }));
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, count: instances.length, agents: summary }, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) }], isError: true };
  }
}

async function handleAgentCollect(args: { agent_id: string; timeout_ms?: number }) {
  if (!agentManager) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Orchestration not initialized' }) }], isError: true };
  }
  try {
    const timeout = args.timeout_ms || 60000;
    const result = await Promise.race([
      agentManager.collect(args.agent_id),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Collection timeout')), timeout)),
    ]);
    if (!result) return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'No result available' }) }] };
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, result }, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) }], isError: true };
  }
}

async function handleAgentTerminate(args: { agent_id: string }) {
  if (!agentManager) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Orchestration not initialized' }) }], isError: true };
  }
  try {
    await agentManager.terminate(args.agent_id);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, agent_id: args.agent_id, message: 'Agent가 종료되었습니다.' }, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) }], isError: true };
  }
}

async function handleAgentListRoles() {
  if (!agentManager) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Orchestration not initialized' }) }], isError: true };
  }
  try {
    const registry = agentManager.getRegistry();
    const definitions = registry.getAllDefinitions();
    const roles = definitions.map(d => ({ role: d.role, name: d.name, description: d.description, required_skills: d.skills.required, optional_skills: d.skills.optional }));
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, count: roles.length, roles }, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) }], isError: true };
  }
}

async function handleOrchestrate(args: { task_id: string; strategy: string; agents: Array<{ role: string; skills?: string[]; stage?: number }> }) {
  if (!parallelEngine) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Orchestration not initialized' }) }], isError: true };
  }
  try {
    const plan: OrchestrationPlan = {
      id: `plan-${Date.now()}-${uuid().slice(0, 8)}`,
      task_id: args.task_id,
      strategy: args.strategy as ExecutionStrategy,
      stages: buildStages(args.strategy as ExecutionStrategy, args.agents as Array<{ role: AgentRole; skills?: string[]; stage?: number }>),
      created_at: new Date().toISOString(),
      status: 'pending',
    };
    const result = await parallelEngine.execute(plan);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, plan_id: plan.id, strategy: args.strategy, agents_executed: result.agents.length, conflicts: result.conflicts.length, summary: result.summary }, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) }], isError: true };
  }
}

async function handleOrchestrateReview(args: { task_id: string; perspectives?: string[] }) {
  if (!parallelEngine) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Orchestration not initialized' }) }], isError: true };
  }
  try {
    const perspectives = args.perspectives || ['code-review', 'security'];
    const agents = perspectives.map(p => ({ role: (p === 'code-review' ? 'review' : p) as AgentRole, skills: [p] }));
    const plan: OrchestrationPlan = {
      id: `review-${Date.now()}`,
      task_id: args.task_id,
      strategy: 'parallel',
      stages: [{ stage_id: 'review', name: 'Multi-perspective Review', agents, parallel: true, timeout_ms: 300000 }],
      created_at: new Date().toISOString(),
      status: 'pending',
    };
    const result = await parallelEngine.execute(plan);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, task_id: args.task_id, perspectives_reviewed: perspectives, summary: result.summary }, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) }], isError: true };
  }
}

async function handleOrchestrateImplement(args: { task_id: string; include_docs?: boolean }) {
  if (!parallelEngine) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'Orchestration not initialized' }) }], isError: true };
  }
  try {
    const stages = [
      { stage_id: 'implement', name: 'Code Implementation', agents: [{ role: 'code' as AgentRole, skills: ['coding'] }], parallel: false, timeout_ms: 300000 },
      { stage_id: 'test', name: 'Test Writing', agents: [{ role: 'test' as AgentRole, skills: ['testing'] }], parallel: false, timeout_ms: 180000 },
      { stage_id: 'review', name: 'Code Review', agents: [{ role: 'review' as AgentRole, skills: ['code-review'] }, { role: 'security' as AgentRole, skills: ['security'] }], parallel: true, timeout_ms: 180000 },
    ];
    if (args.include_docs) {
      stages.push({ stage_id: 'docs', name: 'Documentation', agents: [{ role: 'docs' as AgentRole, skills: ['api-docs', 'changelog'] }], parallel: false, timeout_ms: 120000 });
    }
    const plan: OrchestrationPlan = { id: `impl-${Date.now()}`, task_id: args.task_id, strategy: 'pipeline', stages, created_at: new Date().toISOString(), status: 'pending' };
    const result = await parallelEngine.execute(plan);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, task_id: args.task_id, stages_completed: stages.length, pipeline: stages.map(s => s.name), summary: result.summary }, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }) }], isError: true };
  }
}

function buildStages(strategy: ExecutionStrategy, agents: Array<{ role: AgentRole; skills?: string[]; stage?: number }>): OrchestrationPlan['stages'] {
  switch (strategy) {
    case 'parallel':
      return [{ stage_id: 'parallel-all', name: 'Parallel Execution', agents: agents.map(a => ({ role: a.role, skills: a.skills })), parallel: true, timeout_ms: 300000 }];
    case 'sequential':
      return agents.map((a, i) => ({ stage_id: `seq-${i}`, name: `Step ${i + 1}: ${a.role}`, agents: [{ role: a.role, skills: a.skills }], parallel: false, timeout_ms: 180000 }));
    case 'pipeline':
      const stageMap = new Map<number, typeof agents>();
      agents.forEach(a => { const n = a.stage || 0; if (!stageMap.has(n)) stageMap.set(n, []); stageMap.get(n)!.push(a); });
      return Array.from(stageMap.entries()).sort(([a], [b]) => a - b).map(([num, sa]) => ({ stage_id: `stage-${num}`, name: `Stage ${num}`, agents: sa.map(a => ({ role: a.role, skills: a.skills })), parallel: sa.length > 1, timeout_ms: 300000 }));
    default:
      return [];
  }
}

export async function startStdioTransport(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { redis };
