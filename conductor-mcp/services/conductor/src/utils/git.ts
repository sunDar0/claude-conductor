import simpleGit, { SimpleGit } from 'simple-git';
import type { FileChange, CommitInfo, ParsedCommit } from '../types/index.js';

/**
 * Git 인스턴스 가져오기 (특정 디렉토리)
 */
export function getGitForDir(dir: string): SimpleGit {
  return simpleGit(dir);
}

function getFileStatus(f: { insertions: number; deletions: number }): FileChange['status'] {
  if (f.insertions > 0 && f.deletions === 0) return 'added';
  if (f.insertions === 0 && f.deletions > 0) return 'deleted';
  return 'modified';
}

/**
 * 커밋 목록 가져오기 (프로젝트별)
 */
export async function getCommitsForProject(projectDir: string, fromRef?: string, toRef?: string): Promise<CommitInfo[]> {
  const g = getGitForDir(projectDir);

  const options: { maxCount?: number; from?: string; to?: string } = { maxCount: 100 };
  if (fromRef) {
    options.from = fromRef;
    options.to = toRef || 'HEAD';
  }

  const log = await g.log(options);

  return log.all.map(c => ({
    hash: c.hash.substring(0, 7),
    message: c.message,
    author: c.author_name,
    date: c.date,
  }));
}

/**
 * 변경된 파일 목록 가져오기 (커밋 + uncommitted 포함, 프로젝트별)
 * baseRef가 있으면 해당 커밋 이후 변경사항, 없으면 전체 uncommitted
 */
export async function getChangesForProject(projectDir: string, baseRef?: string): Promise<FileChange[]> {
  const g = getGitForDir(projectDir);

  // 1. Committed changes since baseRef
  const committedFiles: FileChange[] = [];
  if (baseRef) {
    try {
      const diff = await g.diffSummary([`${baseRef}..HEAD`]);
      for (const f of diff.files) {
        committedFiles.push({
          path: f.file,
          status: 'insertions' in f ? getFileStatus(f as { insertions: number; deletions: number }) : 'modified',
          additions: 'insertions' in f ? (f as { insertions: number }).insertions : 0,
          deletions: 'deletions' in f ? (f as { deletions: number }).deletions : 0,
        });
      }
    } catch {
      // baseRef might not exist
    }
  }

  // 2. Uncommitted changes (staged + unstaged)
  const status = await g.status();
  const uncommittedPaths = new Set<string>();
  const uncommittedFiles: FileChange[] = [];

  for (const f of [...status.modified, ...status.renamed.map(r => r.to)]) {
    if (!uncommittedPaths.has(f)) {
      uncommittedPaths.add(f);
      uncommittedFiles.push({ path: f, status: 'modified', additions: 0, deletions: 0 });
    }
  }
  for (const f of [...status.created, ...status.not_added]) {
    if (!uncommittedPaths.has(f)) {
      uncommittedPaths.add(f);
      uncommittedFiles.push({ path: f, status: 'added', additions: 0, deletions: 0 });
    }
  }
  for (const f of status.deleted) {
    if (!uncommittedPaths.has(f)) {
      uncommittedPaths.add(f);
      uncommittedFiles.push({ path: f, status: 'deleted', additions: 0, deletions: 0 });
    }
  }

  // Merge: committed + uncommitted (dedupe by path)
  const seen = new Set(committedFiles.map(f => f.path));
  const merged = [...committedFiles];
  for (const f of uncommittedFiles) {
    if (!seen.has(f.path)) {
      merged.push(f);
    }
  }

  return merged;
}

/**
 * Conventional Commit 파싱
 */
export function parseCommit(message: string): ParsedCommit | null {
  // 패턴: type(scope)!: description
  const match = message.match(/^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/);

  if (!match) return null;

  const [, type, scope, bang, description] = match;

  return {
    type: type.toLowerCase(),
    scope,
    breaking: !!bang || message.includes('BREAKING CHANGE'),
    description,
  };
}

