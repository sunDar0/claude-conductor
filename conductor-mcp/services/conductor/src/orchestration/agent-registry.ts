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

      // Try YAML files first
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

      // If no YAML, try Markdown with frontmatter
      if (this.definitions.size === 0) {
        const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('_'));
        for (const file of mdFiles) {
          try {
            await this.loadMarkdownAgent(file);
          } catch (err) {
            console.error(`[AgentRegistry] Failed to load ${file}:`, err);
          }
        }
      }

      // If still nothing, use defaults
      if (this.definitions.size === 0) {
        console.error('[AgentRegistry] No agent definitions found, using defaults');
        this.loadDefaultDefinitions();
      }

      console.error(`[AgentRegistry] Loaded ${this.definitions.size} agent definitions`);
    } catch (err) {
      console.error('[AgentRegistry] Agents directory not found, using defaults');
      this.loadDefaultDefinitions();
    }
  }

  private async loadMarkdownAgent(filename: string): Promise<void> {
    const content = await readFile(join(this.agentsDir, filename), 'utf-8');

    // Parse frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      console.error(`[AgentRegistry] No frontmatter in ${filename}`);
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
    console.error(`[AgentRegistry] Loaded ${role} agent from ${filename}`);
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

## Guidelines
- Be constructive in feedback
- Prioritize issues by severity (Critical, High, Medium, Low)
- Reference specific files and line numbers
- Suggest concrete solutions for each issue

## Output Format
Provide your review in this structure:
1. **Summary**: Brief overview of changes
2. **Issues Found**: List issues with severity, file, line, description
3. **Recommendations**: Improvement suggestions

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

## Guidelines
- Use clear, concise language
- Include code examples where helpful
- Keep documentation in sync with code
- Follow existing documentation style

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

## Guidelines
- Check for injection vulnerabilities (SQL, Command, XSS)
- Review input validation and sanitization
- Check for hardcoded secrets and credentials
- Verify secure communication (HTTPS, encryption)
- Review error handling for information leakage

## Output Format
Provide your security review in this structure:
1. **Summary**: Overall security posture
2. **Vulnerabilities Found**: List with severity, CWE ID if applicable, file, description
3. **Remediation**: Specific fix recommendations for each issue

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
}
