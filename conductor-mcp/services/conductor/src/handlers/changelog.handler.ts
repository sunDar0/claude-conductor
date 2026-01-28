import * as fs from 'fs/promises';
import * as path from 'path';
import type { ChangelogInput, ChangelogEntry, ChangelogVersion, ChangeType } from '../types/index.js';
import { readTaskRegistry, writeTaskRegistry, getTaskDirPath } from '../utils/registry.js';
import { getCommits, parseCommit } from '../utils/git.js';
import { nowISO, formatDateOnly } from '../utils/date.js';
import { fileExists } from '../utils/file.js';

const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace';
const CHANGELOG_FILE = path.join(WORKSPACE, 'CHANGELOG.md');

const COMMIT_TO_CHANGELOG: Record<string, ChangeType> = {
  feat: 'Added',
  fix: 'Fixed',
  docs: 'Changed',
  style: 'Changed',
  refactor: 'Changed',
  perf: 'Changed',
  test: 'Changed',
  chore: 'Changed',
  security: 'Security',
  deprecate: 'Deprecated',
  remove: 'Removed',
};

type EventPublisher = (event: string, data: unknown) => Promise<void>;

/**
 * Changelog 생성
 */
export async function handleChangelogGenerate(
  input: ChangelogInput,
  publish?: EventPublisher
) {
  const registry = await readTaskRegistry();
  const task = registry.tasks[input.task_id];

  if (!task) {
    return {
      content: [{ type: 'text', text: `Task not found: ${input.task_id}` }],
      isError: true,
    };
  }

  try {
    const commits = await getCommits(input.from_ref, input.to_ref);

    if (commits.length === 0) {
      return {
        content: [{ type: 'text', text: 'No commits to analyze.' }],
      };
    }

    // 커밋 분석
    const entries: ChangelogEntry[] = [];

    for (const commit of commits) {
      const parsed = parseCommit(commit.message);

      if (parsed) {
        const changeType = COMMIT_TO_CHANGELOG[parsed.type] || 'Changed';
        entries.push({
          type: changeType,
          description: parsed.description,
          scope: parsed.scope,
          breaking: parsed.breaking,
        });
      } else {
        entries.push({
          type: 'Changed',
          description: commit.message.split('\n')[0],
        });
      }
    }

    // 버전 결정
    const version = input.version || await nextVersion(entries);
    const today = formatDateOnly(nowISO());

    const changelogVersion: ChangelogVersion = {
      version,
      date: today,
      task_id: task.id,
      entries,
    };

    // 파일 업데이트
    await updateChangelogFile(changelogVersion);

    // 태스크별 changelog 저장
    const taskDir = getTaskDirPath(task.id);
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(
      path.join(taskDir, 'CHANGELOG.md'),
      formatVersion(changelogVersion),
      'utf-8'
    );

    // 레지스트리 업데이트
    const verNum = parseVersionNum(version);
    if (!task.changelog_versions.includes(verNum)) {
      task.changelog_versions.push(verNum);
      task.updated_at = nowISO();
      await writeTaskRegistry(registry);
    }

    if (publish) {
      await publish('changelog.generated', { task_id: task.id, version });
    }

    // 응답 생성
    const response = formatChangelogResponse(changelogVersion, commits.length);
    return { content: [{ type: 'text', text: response }] };

  } catch (error) {
    return {
      content: [{ type: 'text', text: `Changelog generation failed: ${error instanceof Error ? error.message : error}` }],
      isError: true,
    };
  }
}

/**
 * 다음 버전 결정
 */
async function nextVersion(entries: ChangelogEntry[]): Promise<string> {
  let major = 0, minor = 0, patch = 1;

  if (await fileExists(CHANGELOG_FILE)) {
    const content = await fs.readFile(CHANGELOG_FILE, 'utf-8');
    const match = content.match(/## \[(\d+)\.(\d+)\.(\d+)\]/);
    if (match) {
      major = parseInt(match[1], 10);
      minor = parseInt(match[2], 10);
      patch = parseInt(match[3], 10);
    }
  }

  const hasBreaking = entries.some(e => e.breaking);
  const hasFeature = entries.some(e => e.type === 'Added');

  if (hasBreaking) {
    return `${major + 1}.0.0`;
  } else if (hasFeature) {
    return `${major}.${minor + 1}.0`;
  } else {
    return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * CHANGELOG.md 파일 업데이트
 */
async function updateChangelogFile(version: ChangelogVersion): Promise<void> {
  const header = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

`;

  const versionSection = formatVersion(version);

  let content: string;

  if (await fileExists(CHANGELOG_FILE)) {
    const existing = await fs.readFile(CHANGELOG_FILE, 'utf-8');
    const insertPoint = existing.indexOf('\n## ');
    if (insertPoint === -1) {
      content = existing.trimEnd() + '\n\n' + versionSection;
    } else {
      content = existing.slice(0, insertPoint) + '\n' + versionSection + existing.slice(insertPoint);
    }
  } else {
    content = header + versionSection;
  }

  await fs.writeFile(CHANGELOG_FILE, content, 'utf-8');
}

/**
 * 버전 섹션 포맷
 */
function formatVersion(v: ChangelogVersion): string {
  const grouped = groupByType(v.entries);

  let section = `## [${v.version}] - ${v.date}\n`;

  const order: ChangeType[] = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

  for (const type of order) {
    const items = grouped[type];
    if (items && items.length > 0) {
      section += `\n### ${type}\n`;
      for (const e of items) {
        const scope = e.scope ? `**${e.scope}**: ` : '';
        const breaking = e.breaking ? '**BREAKING**: ' : '';
        section += `- ${breaking}${scope}${e.description}\n`;
      }
    }
  }

  return section + '\n';
}

function groupByType(entries: ChangelogEntry[]): Record<ChangeType, ChangelogEntry[]> {
  const groups: Record<ChangeType, ChangelogEntry[]> = {
    Added: [], Changed: [], Deprecated: [], Removed: [], Fixed: [], Security: [],
  };
  for (const e of entries) {
    groups[e.type].push(e);
  }
  return groups;
}

function parseVersionNum(v: string): number {
  const [major, minor, patch] = v.split('.').map(Number);
  return major * 10000 + minor * 100 + patch;
}

/**
 * 응답 포맷
 */
function formatChangelogResponse(v: ChangelogVersion, commitCount: number): string {
  const grouped = groupByType(v.entries);

  let output = `## CHANGELOG Generated

### Version Info
| Field | Value |
|-------|-------|
| Version | ${v.version} |
| Date | ${v.date} |
| Task | ${v.task_id} |
| Commits | ${commitCount} |
| Entries | ${v.entries.length} |

### Changes
`;

  const order: ChangeType[] = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

  for (const type of order) {
    const items = grouped[type];
    if (items && items.length > 0) {
      output += `\n#### ${type}\n`;
      for (const e of items) {
        const scope = e.scope ? `**${e.scope}**: ` : '';
        const breaking = e.breaking ? 'BREAKING: ' : '';
        output += `- ${breaking}${scope}${e.description}\n`;
      }
    }
  }

  output += `\n### Saved To
- Project: \`CHANGELOG.md\`
- Task: \`.claude/tasks/${v.task_id}/CHANGELOG.md\``;

  return output;
}
