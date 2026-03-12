import { readFile, access } from 'fs/promises';
import { join } from 'path';
import type { AgentDefinition } from '../types/agent.types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SkillLoader');

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
        log.warn({ skillName }, 'Optional skill not found, skipping');
      }
    }

    return skills;
  }

}
