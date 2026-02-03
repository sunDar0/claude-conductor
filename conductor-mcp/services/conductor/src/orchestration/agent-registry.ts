import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import type { AgentDefinition, AgentRole, AgentSourceType } from '../types/agent.types.js';

export class AgentRegistry {
  private definitions: Map<AgentRole, AgentDefinition> = new Map();
  private globalAgentsDir: string;
  private projectAgentsDir: string | null = null;
  private currentSource: AgentSourceType = 'default';
  // Maps canonical pipeline roles to source-specific role names
  private roleMapping: Map<string, string> = new Map();

  constructor(workspaceDir?: string) {
    this.globalAgentsDir = join(homedir(), '.claude', 'agents');
    if (workspaceDir) {
      this.projectAgentsDir = join(workspaceDir, '.claude', 'agents');
    }
  }

  async initialize(source?: AgentSourceType): Promise<void> {
    this.definitions.clear();
    this.currentSource = source || 'default';

    if (source === 'omc') {
      this.loadOmcDefinitions();
    } else if (source === 'global') {
      await this.loadFromDirectory(this.globalAgentsDir, 'global');
      if (this.definitions.size === 0) this.loadDefaultDefinitions();
    } else if (source === 'project') {
      if (this.projectAgentsDir) {
        await this.loadFromDirectory(this.projectAgentsDir, 'project');
      }
      if (this.definitions.size === 0) this.loadDefaultDefinitions();
    } else {
      // default: global → project → defaults
      await this.loadFromDirectory(this.globalAgentsDir, 'global');
      if (this.projectAgentsDir) {
        await this.loadFromDirectory(this.projectAgentsDir, 'project');
      }
      if (this.definitions.size === 0) this.loadDefaultDefinitions();
    }

    this.buildRoleMapping();

    console.error(`[AgentRegistry] Loaded ${this.definitions.size} agent definitions (source: ${this.currentSource})`);
  }

  private async loadFromDirectory(dir: string, source: string): Promise<void> {
    try {
      const files = await readdir(dir);

      // YAML 우선
      const yamlFiles = files.filter(f => f.endsWith('.yaml') && !f.startsWith('_'));
      for (const file of yamlFiles) {
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const definition = parseYaml(content) as AgentDefinition;
          this.definitions.set(definition.role, definition);
          console.error(`[AgentRegistry] Loaded ${definition.role} from ${source}:${file}`);
        } catch (err) {
          console.error(`[AgentRegistry] Failed to load ${source}:${file}:`, err);
        }
      }

      // Markdown (YAML에서 못 읽은 role만)
      const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('_'));
      for (const file of mdFiles) {
        try {
          await this.loadMarkdownAgent(dir, file, source);
        } catch (err) {
          console.error(`[AgentRegistry] Failed to load ${source}:${file}:`, err);
        }
      }
    } catch {
      // 디렉토리 없음 — 무시
    }
  }

  private async loadMarkdownAgent(dir: string, filename: string, source: string): Promise<void> {
    const content = await readFile(join(dir, filename), 'utf-8');

    // Parse frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      return;
    }

    const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
    const body = match[2].trim();
    const name = String(frontmatter.name || filename.replace('.md', ''));

    // Derive role from name: "code-agent" → "code"
    const roleName = name.replace(/-agent$/, '');
    const validRoles = ['code', 'test', 'review', 'docs', 'security', 'performance', 'frontend', 'backend', 'custom'];
    const role = (validRoles.includes(roleName) ? roleName : 'custom') as AgentRole;

    // Parse tools (comma-separated string or array)
    const toolsRaw = frontmatter.tools;
    const tools: string[] = typeof toolsRaw === 'string'
      ? toolsRaw.split(',').map(t => t.trim())
      : Array.isArray(toolsRaw) ? toolsRaw : [];

    const definition: AgentDefinition = {
      role,
      name,
      description: String(frontmatter.description || ''),
      skills: { required: [], optional: [] },
      system_prompt: body,
      tools,
      constraints: [],
      output_format: { type: `${role}_result`, schema: {} },
      config: {
        timeout_ms: role === 'code' ? 1800000 : 600000,
        max_retries: role === 'review' || role === 'security' ? 1 : 2,
        parallel_allowed: role !== 'code',
      },
    };

    this.definitions.set(role, definition);
    console.error(`[AgentRegistry] Loaded ${role} agent from ${source}:${filename}`);
  }

  private loadOmcDefinitions(): void {
    const omcAgents: { role: string; name: string; description: string; tier: string }[] = [
      { role: 'explore', name: 'Explore Agent', description: 'Fast codebase search specialist', tier: 'low' },
      { role: 'explore-medium', name: 'Explore Medium Agent', description: 'Thorough codebase search with reasoning', tier: 'medium' },
      { role: 'executor-low', name: 'Executor Low Agent', description: 'Simple single-file task executor', tier: 'low' },
      { role: 'executor', name: 'Executor Agent', description: 'Focused task executor for implementation', tier: 'medium' },
      { role: 'executor-high', name: 'Executor High Agent', description: 'Complex multi-file task executor', tier: 'high' },
      { role: 'architect-low', name: 'Architect Low Agent', description: 'Quick code questions & lookups', tier: 'low' },
      { role: 'architect-medium', name: 'Architect Medium Agent', description: 'Architecture & debugging advisor', tier: 'medium' },
      { role: 'architect', name: 'Architect Agent', description: 'Strategic architecture & debugging advisor', tier: 'high' },
      { role: 'designer-low', name: 'Designer Low Agent', description: 'Simple styling and minor UI tweaks', tier: 'low' },
      { role: 'designer', name: 'Designer Agent', description: 'UI/UX designer-developer', tier: 'medium' },
      { role: 'designer-high', name: 'Designer High Agent', description: 'Complex UI architecture and design systems', tier: 'high' },
      { role: 'writer', name: 'Writer Agent', description: 'Technical documentation writer', tier: 'low' },
      { role: 'researcher-low', name: 'Researcher Low Agent', description: 'Quick documentation lookups', tier: 'low' },
      { role: 'researcher', name: 'Researcher Agent', description: 'External documentation & reference researcher', tier: 'medium' },
      { role: 'vision', name: 'Vision Agent', description: 'Visual/media file analyzer', tier: 'medium' },
      { role: 'planner', name: 'Planner Agent', description: 'Strategic planning consultant', tier: 'high' },
      { role: 'critic', name: 'Critic Agent', description: 'Work plan review expert', tier: 'high' },
      { role: 'analyst', name: 'Analyst Agent', description: 'Pre-planning requirements analysis', tier: 'high' },
      { role: 'qa-tester', name: 'QA Tester Agent', description: 'Interactive CLI testing specialist', tier: 'medium' },
      { role: 'security-reviewer-low', name: 'Security Reviewer Low Agent', description: 'Quick security scan', tier: 'low' },
      { role: 'security-reviewer', name: 'Security Reviewer Agent', description: 'Security vulnerability detection', tier: 'high' },
      { role: 'build-fixer-low', name: 'Build Fixer Low Agent', description: 'Simple build error fixer', tier: 'low' },
      { role: 'build-fixer', name: 'Build Fixer Agent', description: 'Build and TypeScript error resolution', tier: 'medium' },
      { role: 'tdd-guide-low', name: 'TDD Guide Low Agent', description: 'Quick test suggestions', tier: 'low' },
      { role: 'tdd-guide', name: 'TDD Guide Agent', description: 'Test-driven development specialist', tier: 'medium' },
      { role: 'code-reviewer-low', name: 'Code Reviewer Low Agent', description: 'Quick code quality checker', tier: 'low' },
      { role: 'code-reviewer', name: 'Code Reviewer Agent', description: 'Expert code review specialist', tier: 'high' },
      { role: 'scientist-low', name: 'Scientist Low Agent', description: 'Quick data inspection', tier: 'low' },
      { role: 'scientist', name: 'Scientist Agent', description: 'Data analysis and research execution', tier: 'medium' },
      { role: 'scientist-high', name: 'Scientist High Agent', description: 'Complex research and ML specialist', tier: 'high' },
    ];

    const tierConfig: Record<string, { timeout_ms: number; max_retries: number }> = {
      low: { timeout_ms: 300000, max_retries: 1 },
      medium: { timeout_ms: 600000, max_retries: 2 },
      high: { timeout_ms: 1800000, max_retries: 2 },
    };

    for (const agent of omcAgents) {
      const config = tierConfig[agent.tier] || tierConfig.medium;
      const definition: AgentDefinition = {
        role: agent.role as AgentRole,
        name: agent.name,
        description: agent.description,
        skills: { required: [], optional: [] },
        system_prompt: '',
        tools: [],
        constraints: [],
        output_format: { type: `${agent.role}_result`, schema: {} },
        config: {
          timeout_ms: config.timeout_ms,
          max_retries: config.max_retries,
          parallel_allowed: !agent.role.includes('executor'),
        },
      };
      this.definitions.set(agent.role as AgentRole, definition);
    }
  }

  private loadDefaultDefinitions(): void {
    const defaults: AgentDefinition[] = [
      {
        role: 'code',
        name: 'Code Implementation Agent',
        description: '코드 구현 전문 Agent',
        skills: { required: [], optional: [] },
        system_prompt: `You are a Code Agent specialized in writing clean, maintainable code.

## Responsibilities
- Implement features based on task requirements
- Follow project coding standards and patterns
- Write self-documenting code with appropriate comments
- Ensure code is testable and modular

## Guidelines
- Always check existing code patterns before implementing
- Use TypeScript with strict typing
- Follow SOLID principles
- Keep functions small and focused
- 반드시 파일을 실제로 편집/작성해야 함
- 계획만 출력하지 말고 실행할 것

## Constraints
- Must not modify files outside the project scope
- Must not delete existing tests
- Must maintain backward compatibility unless explicitly requested
- **모든 출력은 한글로 작성**`,
        tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
        constraints: [
          'Do not modify files outside the project scope',
          'Do not delete existing tests',
          'Maintain backward compatibility',
        ],
        output_format: { type: 'code_result', schema: {} },
        config: { timeout_ms: 1800000, max_retries: 2, parallel_allowed: false },
      },
      {
        role: 'test',
        name: 'Test Writing Agent',
        description: '테스트 작성 전문 Agent',
        skills: { required: [], optional: [] },
        system_prompt: `You are a Test Agent specialized in writing comprehensive tests.

## Responsibilities
- Write unit tests for new code
- Write integration tests for APIs
- Ensure edge cases are covered
- Maintain test coverage standards

## Guidelines
- Use appropriate testing framework (Jest, Vitest, etc.)
- Write descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)
- Mock external dependencies appropriately

## Constraints
- Must not modify production code (only test files)
- Tests must be deterministic
- Must clean up test artifacts
- **모든 출력은 한글로 작성**`,
        tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
        constraints: [
          'Do not modify production code',
          'Tests must be deterministic',
          'Clean up test artifacts',
        ],
        output_format: { type: 'test_result', schema: {} },
        config: { timeout_ms: 600000, max_retries: 2, parallel_allowed: true },
      },
      {
        role: 'review',
        name: 'Code Review Agent',
        description: '코드 리뷰 전문 Agent',
        skills: { required: [], optional: [] },
        system_prompt: `You are a Review Agent specialized in code quality assessment.

## Responsibilities
- Review code changes for quality and correctness
- Identify potential bugs and issues
- Suggest improvements and best practices
- Check for common anti-patterns

## Constraints
- Must not modify any files (read-only analysis)
- Must provide actionable feedback
- Must categorize issues by severity
- **모든 출력은 한글로 작성**`,
        tools: ['Read', 'Glob', 'Grep'],
        constraints: [
          'Do not modify any files',
          'Provide actionable feedback',
          'Categorize issues by severity',
        ],
        output_format: { type: 'review_result', schema: {} },
        config: { timeout_ms: 600000, max_retries: 1, parallel_allowed: true },
      },
      {
        role: 'docs',
        name: 'Documentation Agent',
        description: '문서화 전문 Agent',
        skills: { required: [], optional: [] },
        system_prompt: `You are a Documentation Agent specialized in technical writing.

## Responsibilities
- Write clear API documentation
- Update README files
- Create usage examples
- Maintain changelog

## Constraints
- Must not modify source code
- Documentation must be accurate
- Must follow existing documentation style
- **모든 출력은 한글로 작성**`,
        tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
        constraints: [
          'Do not modify source code',
          'Documentation must be accurate',
          'Follow existing documentation style',
        ],
        output_format: { type: 'docs_result', schema: {} },
        config: { timeout_ms: 600000, max_retries: 2, parallel_allowed: true },
      },
      {
        role: 'security',
        name: 'Security Review Agent',
        description: '보안 검토 전문 Agent',
        skills: { required: [], optional: [] },
        system_prompt: `You are a Security Agent specialized in identifying vulnerabilities.

## Responsibilities
- Scan code for security vulnerabilities
- Check for common security issues (OWASP Top 10)
- Review authentication and authorization logic
- Identify sensitive data handling issues

## Constraints
- Must not modify any files (read-only analysis)
- Must report all findings regardless of severity
- Must provide remediation guidance
- **모든 출력은 한글로 작성**`,
        tools: ['Read', 'Glob', 'Grep'],
        constraints: [
          'Do not modify any files',
          'Report all findings regardless of severity',
          'Provide remediation guidance',
        ],
        output_format: { type: 'security_result', schema: {} },
        config: { timeout_ms: 600000, max_retries: 1, parallel_allowed: true },
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

  getCurrentSource(): AgentSourceType {
    return this.currentSource;
  }

  /**
   * Map a canonical pipeline role (code, review, security, test, docs)
   * to the actual role name for the current agent source.
   */
  mapRole(canonicalRole: string): string {
    return this.roleMapping.get(canonicalRole) || canonicalRole;
  }

  getRoleMappings(): Record<string, string> {
    return Object.fromEntries(this.roleMapping);
  }

  private buildRoleMapping(): void {
    this.roleMapping.clear();

    if (this.currentSource === 'omc') {
      // omc uses different naming conventions
      this.roleMapping.set('code', 'executor');
      this.roleMapping.set('review', 'code-reviewer');
      this.roleMapping.set('security', 'security-reviewer');
      this.roleMapping.set('test', 'qa-tester');
      this.roleMapping.set('docs', 'writer');
    }
    // For 'global', 'project', 'default' — roles match 1:1 (code→code, review→review, etc.)
    // so no mapping entries needed (mapRole returns input as-is)
  }

  static async detectAvailableSources(projectDir?: string): Promise<{ sources: AgentSourceType[]; hasOmc: boolean }> {
    const sources: AgentSourceType[] = ['default'];
    let hasOmc = false;

    // Check omc
    try {
      const settingsPath = join(homedir(), '.claude', 'settings.json');
      const content = await readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(content);
      const plugins = settings.enabledPlugins || settings.enabled_plugins || {};
      if (Object.keys(plugins).some(k => k.includes('oh-my-claudecode') || k.includes('omc'))) {
        sources.push('omc');
        hasOmc = true;
      }
    } catch {
      // no settings or parse error
    }

    // Check global agents
    try {
      const globalDir = join(homedir(), '.claude', 'agents');
      const files = await readdir(globalDir);
      if (files.some(f => f.endsWith('.md') || f.endsWith('.yaml'))) {
        sources.push('global');
      }
    } catch {
      // no global agents dir
    }

    // Check project agents
    if (projectDir) {
      try {
        const projectAgentsDir = join(projectDir, '.claude', 'agents');
        const files = await readdir(projectAgentsDir);
        if (files.some(f => f.endsWith('.md') || f.endsWith('.yaml'))) {
          sources.push('project');
        }
      } catch {
        // no project agents dir
      }
    }

    return { sources, hasOmc };
  }
}
