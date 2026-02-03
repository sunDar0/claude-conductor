import * as fs from 'fs/promises';
import * as path from 'path';
import type { ChangelogInput, ChangelogEntry, ChangelogVersion, ChangeType } from '../types/index.js';
import { readTaskRegistry, writeTaskRegistry, getTaskDirPath } from '../utils/registry.js';
import { getCommits, getCommitsForProject, getChangesForProject, parseCommit } from '../utils/git.js';
import { nowISO, formatDateOnly } from '../utils/date.js';
import { fileExists } from '../utils/file.js';
import { resolveProjectDir } from '../utils/project-manager.js';

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

  // Determine project directory for git operations and changelog
  const projectDir = await resolveProjectDir(task);
  const changelogFile = path.join(projectDir, 'CHANGELOG.md');

  try {
    const commits = await getCommitsForProject(projectDir, input.from_ref, input.to_ref);
    const entries: ChangelogEntry[] = [];

    if (commits.length > 0) {
      // 커밋 기반 분석
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
    } else {
      // 커밋이 없으면 uncommitted 변경사항(git diff) 기반으로 생성
      const changes = await getChangesForProject(projectDir, input.from_ref);

      if (changes.length === 0) {
        return {
          content: [{ type: 'text', text: 'No changes to analyze.' }],
        };
      }

      // 변경된 파일 기준으로 엔트리 생성
      const added = changes.filter(c => c.status === 'added');
      const modified = changes.filter(c => c.status === 'modified');
      const deleted = changes.filter(c => c.status === 'deleted');

      if (added.length > 0) {
        entries.push({
          type: 'Added',
          description: added.map(f => f.path).join(', '),
        });
      }
      if (modified.length > 0) {
        entries.push({
          type: 'Changed',
          description: modified.map(f => f.path).join(', '),
        });
      }
      if (deleted.length > 0) {
        entries.push({
          type: 'Removed',
          description: deleted.map(f => f.path).join(', '),
        });
      }
    }

    // 버전 결정
    const version = input.version || await nextVersion(entries, changelogFile);
    const today = formatDateOnly(nowISO());

    const changelogVersion: ChangelogVersion = {
      version,
      date: today,
      task_id: task.id,
      entries,
    };

    // 파일 업데이트
    await updateChangelogFile(changelogVersion, changelogFile);

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
async function nextVersion(entries: ChangelogEntry[], changelogFile: string = CHANGELOG_FILE): Promise<string> {
  let major = 0, minor = 0, patch = 1;

  if (await fileExists(changelogFile)) {
    const content = await fs.readFile(changelogFile, 'utf-8');
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
async function updateChangelogFile(version: ChangelogVersion, changelogFile: string = CHANGELOG_FILE): Promise<void> {
  const header = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

`;

  const versionSection = formatVersion(version);

  let content: string;

  if (await fileExists(changelogFile)) {
    const existing = await fs.readFile(changelogFile, 'utf-8');
    const insertPoint = existing.indexOf('\n## ');
    if (insertPoint === -1) {
      content = existing.trimEnd() + '\n\n' + versionSection;
    } else {
      content = existing.slice(0, insertPoint) + '\n' + versionSection + existing.slice(insertPoint);
    }
  } else {
    content = header + versionSection;
  }

  await fs.writeFile(changelogFile, content, 'utf-8');
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

  let output = `## 변경 이력 생성 완료

### 버전 정보
| 항목 | 값 |
|------|-----|
| 버전 | ${v.version} |
| 날짜 | ${v.date} |
| 태스크 | ${v.task_id} |
| 커밋 수 | ${commitCount} |
| 항목 수 | ${v.entries.length} |

### 변경 내역
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

  output += `\n### 저장 위치
- 프로젝트: \`CHANGELOG.md\`
- 태스크: \`.claude/tasks/${v.task_id}/CHANGELOG.md\``;

  return output;
}
