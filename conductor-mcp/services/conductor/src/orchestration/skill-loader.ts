import { readFile, access } from 'fs/promises';
import { join } from 'path';
import type { AgentDefinition } from '../types/agent.types.js';

export class SkillLoader {
  private skillsDir: string;
  private cache: Map<string, string> = new Map();

  constructor(workspaceDir: string) {
    this.skillsDir = join(workspaceDir, '.claude', 'skills');
  }

  async loadSkill(skillName: string): Promise<string> {
    if (this.cache.has(skillName)) {
      return this.cache.get(skillName)!;
    }

    const skillPath = join(this.skillsDir, skillName, 'SKILL.md');

    try {
      await access(skillPath);
      const content = await readFile(skillPath, 'utf-8');
      this.cache.set(skillName, content);
      return content;
    } catch {
      throw new Error(`Skill not found: ${skillName}`);
    }
  }

  async loadSkillsForAgent(definition: AgentDefinition): Promise<Record<string, string>> {
    const skills: Record<string, string> = {};
    const allSkills = [
      ...definition.skills.required,
      ...definition.skills.optional,
    ];

    for (const skillName of allSkills) {
      try {
        skills[skillName] = await this.loadSkill(skillName);
      } catch (error) {
        if (definition.skills.required.includes(skillName)) {
          throw error;
        }
        console.warn(`[SkillLoader] Optional skill not found: ${skillName}`);
      }
    }

    return skills;
  }

  buildSystemPrompt(definition: AgentDefinition, skills: Record<string, string>): string {
    let prompt = definition.system_prompt;

    const skillsSection = Object.entries(skills)
      .map(([name, content]) => `### Skill: ${name}\n\n${content}`)
      .join('\n\n---\n\n');

    prompt = prompt.replace('{{skills}}', skillsSection);
    prompt = prompt.replace('{{role}}', definition.role);
    prompt = prompt.replace('{{name}}', definition.name);

    const constraintsSection = definition.constraints
      .map(c => `- ${c}`)
      .join('\n');
    prompt = prompt.replace('{{constraints}}', constraintsSection);

    return prompt;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
