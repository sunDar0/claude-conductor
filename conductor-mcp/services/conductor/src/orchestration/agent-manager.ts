import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import type {
  AgentInstance,
  AgentRole,
  AgentContext,
  AgentResult,
} from '../types/agent.types.js';
import { AgentRegistry } from './agent-registry.js';
import { SkillLoader } from './skill-loader.js';
import type { Redis } from 'ioredis';

export class AgentManager extends EventEmitter {
  private instances: Map<string, AgentInstance> = new Map();
  private registry: AgentRegistry;
  private skillLoader: SkillLoader;
  private redis: Redis;

  constructor(
    registry: AgentRegistry,
    skillLoader: SkillLoader,
    redis: Redis
  ) {
    super();
    this.registry = registry;
    this.skillLoader = skillLoader;
    this.redis = redis;
  }

  async spawn(
    role: AgentRole,
    taskId: string,
    options?: {
      skills?: string[];
      context?: Partial<AgentContext>;
    }
  ): Promise<AgentInstance> {
    const definition = this.registry.getDefinition(role);
    if (!definition) {
      throw new Error(`Unknown agent role: ${role}`);
    }

    const skillsToLoad = options?.skills || [
      ...definition.skills.required,
      ...definition.skills.optional,
    ];

    let loadedSkills: Record<string, string> = {};
    try {
      loadedSkills = await this.skillLoader.loadSkillsForAgent({
        ...definition,
        skills: {
          required: definition.skills.required.filter(s => skillsToLoad.includes(s)),
          optional: definition.skills.optional.filter(s => skillsToLoad.includes(s)),
        },
      });
    } catch (err) {
      console.warn(`[AgentManager] Failed to load some skills:`, err);
    }

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

    this.instances.set(agentId, instance);
    await this.persistInstance(instance);

    this.emit('agent:spawned', { agentId, role, taskId });
    await this.redis.publish('conductor:events', JSON.stringify({
      type: 'agent.spawned',
      payload: { agentId, role, taskId },
      timestamp: new Date().toISOString(),
    }));

    console.error(`[AgentManager] Spawned ${role} agent: ${agentId}`);
    return instance;
  }

  async startAgent(agentId: string): Promise<AgentInstance> {
    const instance = this.instances.get(agentId);
    if (!instance) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    instance.status = 'running';
    instance.started_at = new Date().toISOString();
    await this.persistInstance(instance);

    this.emit('agent:started', { agentId });
    await this.redis.publish('conductor:events', JSON.stringify({
      type: 'agent.started',
      payload: { agentId },
      timestamp: new Date().toISOString(),
    }));

    return instance;
  }

  async collect(agentId: string): Promise<AgentResult | null> {
    const instance = this.instances.get(agentId);
    if (!instance) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (instance.status === 'running') {
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
    await this.redis.publish('conductor:events', JSON.stringify({
      type: 'agent.completed',
      payload: { agentId, result },
      timestamp: new Date().toISOString(),
    }));

    console.error(`[AgentManager] Agent completed: ${agentId}`);
  }

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
    await this.redis.publish('conductor:events', JSON.stringify({
      type: 'agent.error',
      payload: { agentId, error },
      timestamp: new Date().toISOString(),
    }));

    console.error(`[AgentManager] Agent failed: ${agentId} - ${error}`);
  }

  async terminate(agentId: string): Promise<void> {
    const instance = this.instances.get(agentId);
    if (!instance) {
      return;
    }

    instance.status = 'terminated';
    instance.completed_at = new Date().toISOString();
    await this.persistInstance(instance);

    this.emit('agent:terminated', { agentId });
    await this.redis.publish('conductor:events', JSON.stringify({
      type: 'agent.terminated',
      payload: { agentId },
      timestamp: new Date().toISOString(),
    }));

    setTimeout(() => {
      this.instances.delete(agentId);
    }, 60000);

    console.error(`[AgentManager] Agent terminated: ${agentId}`);
  }

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

  getAllInstances(): AgentInstance[] {
    return Array.from(this.instances.values());
  }

  getRegistry(): AgentRegistry {
    return this.registry;
  }

  private async persistInstance(instance: AgentInstance): Promise<void> {
    const key = `agent:instance:${instance.id}`;
    await this.redis.set(key, JSON.stringify(instance), 'EX', 3600);
  }

  async restoreInstances(): Promise<void> {
    const keys = await this.redis.keys('agent:instance:*');
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const instance = JSON.parse(data) as AgentInstance;
        if (instance.status === 'running') {
          instance.status = 'error';
          instance.error = 'Server restarted during execution';
        }
        this.instances.set(instance.id, instance);
      }
    }
    console.error(`[AgentManager] Restored ${this.instances.size} agent instances`);
  }
}
