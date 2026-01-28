import simpleGit, { SimpleGit } from 'simple-git';
import type { FileChange, CommitInfo, ParsedCommit } from '../types/index.js';

const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace';

let git: SimpleGit | null = null;

/**
 * Git 인스턴스 가져오기
 */
export function getGit(): SimpleGit {
  if (!git) {
    git = simpleGit(WORKSPACE);
  }
  return git;
}

/**
 * 기본 브랜치 감지 (main 또는 master)
 */
export async function getDefaultBranch(): Promise<string> {
  const g = getGit();
  try {
    const branches = await g.branch();
    if (branches.all.includes('main')) return 'main';
    if (branches.all.includes('master')) return 'master';
    return branches.current || 'main';
  } catch {
    return 'main';
  }
}

/**
 * 현재 브랜치 가져오기
 */
export async function getCurrentBranch(): Promise<string> {
  const g = getGit();
  const status = await g.status();
  return status.current || 'HEAD';
}

/**
 * 브랜치 간 변경 파일 목록
 */
export async function getChangedFiles(base: string, target?: string): Promise<FileChange[]> {
  const g = getGit();
  const to = target || await getCurrentBranch();

  const diff = await g.diffSummary([`${base}...${to}`]);

  return diff.files.map(f => ({
    path: f.file,
    status: getFileStatus(f),
    additions: f.insertions,
    deletions: f.deletions,
  }));
}

function getFileStatus(f: { insertions: number; deletions: number }): FileChange['status'] {
  if (f.insertions > 0 && f.deletions === 0) return 'added';
  if (f.insertions === 0 && f.deletions > 0) return 'deleted';
  return 'modified';
}

/**
 * 커밋 목록 가져오기
 */
export async function getCommits(fromRef?: string, toRef?: string): Promise<CommitInfo[]> {
  const g = getGit();

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

/**
 * 브랜치 존재 여부
 */
export async function branchExists(name: string): Promise<boolean> {
  const g = getGit();
  const branches = await g.branch();
  return branches.all.includes(name);
}

/**
 * diff 상세 내용 가져오기 (특정 파일)
 */
export async function getFileDiff(base: string, filePath: string): Promise<string> {
  const g = getGit();
  const current = await getCurrentBranch();
  return g.diff([`${base}...${current}`, '--', filePath]);
}
