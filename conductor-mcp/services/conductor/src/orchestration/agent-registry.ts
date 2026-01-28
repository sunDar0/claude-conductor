import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentDefinition, AgentRole } from '../types/agent.types.js';

export class AgentRegistry {
  private definitions: Map<AgentRole, AgentDefinition> = new Map();
  private agentsDir: string;

  constructor(workspaceDir: string) {
    this.agentsDir = join(workspaceDir, '.claude', 'agents');
  }

  async initialize(): Promise<void> {
    try {
      const files = await readdir(this.agentsDir);
      const yamlFiles = files.filter(f => f.endsWith('.yaml') && !f.startsWith('_'));

      for (const file of yamlFiles) {
        try {
          const content = await readFile(join(this.agentsDir, file), 'utf-8');
          const definition = parseYaml(content) as AgentDefinition;
          this.definitions.set(definition.role, definition);
        } catch (err) {
          console.error(`[AgentRegistry] Failed to load ${file}:`, err);
        }
      }

      console.error(`[AgentRegistry] Loaded ${this.definitions.size} agent definitions`);
    } catch (err) {
      console.error('[AgentRegistry] Agents directory not found, using defaults');
      this.loadDefaultDefinitions();
    }
  }

  private loadDefaultDefinitions(): void {
    const defaults: AgentDefinition[] = [
      {
        role: 'code',
        name: 'Code Implementation Agent',
        description: '코드 구현 전문 Agent',
        skills: { required: ['coding'], optional: ['refactor'] },
        system_prompt: 'You are a code implementation specialist.',
        tools: ['file_read', 'file_write', 'git_status'],
        constraints: ['Do not deploy directly'],
        output_format: { type: 'code_result', schema: {} },
        config: { timeout_ms: 300000, max_retries: 2, parallel_allowed: false },
      },
      {
        role: 'test',
        name: 'Test Writing Agent',
        description: '테스트 작성 전문 Agent',
        skills: { required: ['testing'], optional: ['coverage'] },
        system_prompt: 'You are a test writing specialist.',
        tools: ['file_read', 'file_write', 'test_run'],
        constraints: ['Use mocks for external services'],
        output_format: { type: 'test_result', schema: {} },
        config: { timeout_ms: 180000, max_retries: 2, parallel_allowed: true },
      },
      {
        role: 'review',
        name: 'Code Review Agent',
        description: '코드 리뷰 전문 Agent',
        skills: { required: ['code-review'], optional: ['security'] },
        system_prompt: 'You are a code review specialist.',
        tools: ['file_read', 'git_diff'],
        constraints: ['Do not modify files directly'],
        output_format: { type: 'review_result', schema: {} },
        config: { timeout_ms: 180000, max_retries: 1, parallel_allowed: true },
      },
      {
        role: 'docs',
        name: 'Documentation Agent',
        description: '문서화 전문 Agent',
        skills: { required: ['api-docs'], optional: ['changelog'] },
        system_prompt: 'You are a documentation specialist.',
        tools: ['file_read', 'file_write'],
        constraints: ['Maintain existing style'],
        output_format: { type: 'docs_result', schema: {} },
        config: { timeout_ms: 120000, max_retries: 2, parallel_allowed: true },
      },
      {
        role: 'security',
        name: 'Security Review Agent',
        description: '보안 검토 전문 Agent',
        skills: { required: ['security'], optional: [] },
        system_prompt: 'You are a security review specialist.',
        tools: ['file_read', 'git_diff'],
        constraints: ['Do not write exploit code'],
        output_format: { type: 'security_result', schema: {} },
        config: { timeout_ms: 180000, max_retries: 1, parallel_allowed: true },
      },
    ];

    for (const def of defaults) {
      this.definitions.set(def.role, def);
    }
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

  registerCustomAgent(definition: AgentDefinition): void {
    if (definition.role !== 'custom') {
      throw new Error('Dynamic registration only allowed for custom role');
    }
    this.definitions.set(definition.role, definition);
  }
}
