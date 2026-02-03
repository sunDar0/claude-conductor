import type { ReviewInput, ReviewResult, ReviewPoint, FileChange } from '../types/index.js';
import { readTaskRegistry } from '../utils/registry.js';
import { nowISO } from '../utils/date.js';
import simpleGit from 'simple-git';
import { spawn } from 'child_process';
import { autoPipelineLogger as log } from '../utils/logger.js';

type EventPublisher = (event: string, data: unknown) => Promise<void>;

function getFileStatus(f: { insertions: number; deletions: number }): FileChange['status'] {
  if (f.insertions > 0 && f.deletions === 0) return 'added';
  if (f.insertions === 0 && f.deletions > 0) return 'deleted';
  return 'modified';
}

/**
 * 코드 리뷰 수행
 */
export async function handleReviewCode(
  input: ReviewInput,
  publish: EventPublisher
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
    const workDir = process.env.WORKSPACE_DIR || '/workspace';
    const git = simpleGit(workDir);

    // 기본 브랜치 결정
    let baseBranch = input.base_branch;
    if (!baseBranch) {
      const branches = await git.branch();
      if (branches.all.includes('main')) baseBranch = 'main';
      else if (branches.all.includes('master')) baseBranch = 'master';
      else baseBranch = branches.current || 'main';
    }

    // 현재 브랜치
    const status = await git.status();
    const currentBranch = status.current || 'HEAD';

    // 변경된 파일 목록
    const diff = await git.diffSummary([`${baseBranch}...${currentBranch}`]);
    const changes: FileChange[] = diff.files.map(f => ({
      path: f.file,
      status: 'insertions' in f ? getFileStatus(f) : 'modified',
      additions: 'insertions' in f ? f.insertions : 0,
      deletions: 'deletions' in f ? f.deletions : 0,
    }));

    if (changes.length === 0) {
      return {
        content: [{ type: 'text', text: `No changes found against ${baseBranch}` }],
      };
    }

    // 변경사항 분석
    const points = await analyzeChanges(changes, baseBranch, workDir);

    const totalAdd = changes.reduce((s, c) => s + c.additions, 0);
    const totalDel = changes.reduce((s, c) => s + c.deletions, 0);

    const result: ReviewResult = {
      task_id: task.id,
      branch: currentBranch,
      base_branch: baseBranch,
      files_changed: changes.length,
      total_additions: totalAdd,
      total_deletions: totalDel,
      changes,
      points,
      summary: getSummary(points, changes.length),
      reviewed_at: nowISO(),
    };

    await publish('review.completed', { task_id: task.id, points_count: points.length });

    // 응답 생성
    const response = formatReviewResponse(result);
    return { content: [{ type: 'text', text: response }] };

  } catch (error) {
    return {
      content: [{ type: 'text', text: `Review failed: ${error instanceof Error ? error.message : error}` }],
      isError: true,
    };
  }
}

/**
 * auto-pipeline에서 직접 호출할 수 있는 AI 코드 리뷰 함수
 * Claude CLI를 사용하여 변경사항을 분석하고 리뷰 결과를 반환
 */
export async function runCodeReview(
  taskId: string,
  workDir: string,
  baseRef?: string
): Promise<{ reviewMarkdown: string; hasCritical: boolean }> {
  try {
    const localGit = simpleGit(workDir);
    const branchInfo = await localGit.branch();
    const currentBranch = branchInfo.current;

    // baseRef 결정
    let resolvedBase = baseRef;
    if (!resolvedBase) {
      const branches = await localGit.branch();
      if (branches.all.includes('main')) resolvedBase = 'main';
      else if (branches.all.includes('master')) resolvedBase = 'master';
      else resolvedBase = 'main';
    }

    // diff 수집
    const isCommitHash = /^[0-9a-f]{7,40}$/.test(resolvedBase);
    const diffRange = isCommitHash ? [resolvedBase] : [`${resolvedBase}...${currentBranch}`];
    const diffSummary = await localGit.diffSummary(diffRange);

    if (diffSummary.files.length === 0) {
      return { reviewMarkdown: '', hasCritical: false };
    }

    // 변경 파일 목록
    const fileList = diffSummary.files.map(f => {
      const ins = 'insertions' in f ? (f as { insertions: number }).insertions : 0;
      const del = 'deletions' in f ? (f as { deletions: number }).deletions : 0;
      return `${f.file} (+${ins}/-${del})`;
    }).join('\n');

    // 상세 diff (최대 15000자)
    const rawDiff = await localGit.diff([...diffRange, '--']);
    const diff = rawDiff.length > 15000
      ? rawDiff.slice(0, 15000) + '\n... (truncated)'
      : rawDiff;

    // Claude CLI로 AI 코드 리뷰 수행
    log.info({ taskId, fileCount: diffSummary.files.length }, 'Starting AI code review via Claude CLI');
    const reviewMarkdown = await runReviewCLI(taskId, workDir, fileList, diff);

    // critical 여부 판단 (마크다운에서 키워드 검색)
    const hasCritical = /(?:치명적|critical|심각|보안\s*취약|security)/i.test(reviewMarkdown);

    return { reviewMarkdown, hasCritical };
  } catch (error) {
    log.warn({ taskId, error }, 'AI code review failed (non-blocking)');
    return {
      reviewMarkdown: `## 코드 리뷰: ${taskId}\n\n리뷰 실패: ${error instanceof Error ? error.message : String(error)}`,
      hasCritical: false,
    };
  }
}

/**
 * Claude CLI를 사용한 AI 코드 리뷰 실행
 */
function runReviewCLI(taskId: string, workDir: string, fileList: string, diff: string): Promise<string> {
  return new Promise((resolve) => {
    const prompt = `# 코드 리뷰 요청

## 태스크: ${taskId}

## 변경된 파일
${fileList}

## Diff
\`\`\`diff
${diff}
\`\`\`

## 리뷰 지침

위 변경사항에 대해 코드 리뷰를 수행하세요. **반드시 아래 마크다운 형식으로 출력하세요.**

\`\`\`
## 코드 리뷰: ${taskId}

### 요약
| 항목 | 값 |
|------|-----|
| 변경 파일 | N개 |
| 추가 | +N줄 |
| 삭제 | -N줄 |

### 리뷰 포인트

#### 치명적
- **파일명**: 설명 (있는 경우만)

#### 경고
- **파일명**: 설명 (있는 경우만)

#### 제안
- **파일명**: 설명 (있는 경우만)

### 결론
(전체 요약 한 줄)
\`\`\`

## 중요 규칙
- **한글로 작성**
- 코드 품질, 보안 취약점, 버그 가능성, 성능 이슈를 분석
- 이슈가 없는 심각도 섹션은 생략
- 칭찬이나 불필요한 설명 없이 핵심만 작성
- 파일을 직접 읽지 말고 제공된 diff만 분석하세요`;

    const claude = spawn('claude', ['-p', '--dangerously-skip-permissions', '--output-format', 'text'], {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        HOME: process.env.HOME,
        CLAUDE_CODE_ENTRYPOINT: 'cli',
      },
    });

    claude.stdin?.write(prompt);
    claude.stdin?.end();

    let output = '';
    claude.stdout?.on('data', (data) => { output += data.toString(); });
    claude.stderr?.on('data', () => {}); // ignore stderr

    // 5분 타임아웃
    const timeout = setTimeout(() => {
      claude.kill('SIGTERM');
      resolve(`## 코드 리뷰: ${taskId}\n\n리뷰 타임아웃 (5분 초과)`);
    }, 5 * 60 * 1000);

    claude.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && output.trim()) {
        resolve(output.trim());
      } else {
        resolve(`## 코드 리뷰: ${taskId}\n\nAI 리뷰 실패 (exit code: ${code})`);
      }
    });

    claude.on('error', (err) => {
      clearTimeout(timeout);
      resolve(`## 코드 리뷰: ${taskId}\n\nAI 리뷰 실행 오류: ${err.message}`);
    });
  });
}

/**
 * auto-pipeline에서 호출하는 AI 보안 취약점 점검
 * Claude CLI를 사용하여 보안 관점에서 변경사항을 분석
 */
export async function runSecurityReview(
  taskId: string,
  workDir: string,
  baseRef?: string
): Promise<{ securityMarkdown: string; hasCritical: boolean }> {
  try {
    const localGit = simpleGit(workDir);
    const branchInfo = await localGit.branch();
    const currentBranch = branchInfo.current;

    let resolvedBase = baseRef;
    if (!resolvedBase) {
      const branches = await localGit.branch();
      if (branches.all.includes('main')) resolvedBase = 'main';
      else if (branches.all.includes('master')) resolvedBase = 'master';
      else resolvedBase = 'main';
    }

    const isCommitHash = /^[0-9a-f]{7,40}$/.test(resolvedBase);
    const diffRange = isCommitHash ? [resolvedBase] : [`${resolvedBase}...${currentBranch}`];
    const diffSummary = await localGit.diffSummary(diffRange);

    if (diffSummary.files.length === 0) {
      return { securityMarkdown: '', hasCritical: false };
    }

    const fileList = diffSummary.files.map(f => {
      const ins = 'insertions' in f ? (f as { insertions: number }).insertions : 0;
      const del = 'deletions' in f ? (f as { deletions: number }).deletions : 0;
      return `${f.file} (+${ins}/-${del})`;
    }).join('\n');

    const rawDiff = await localGit.diff([...diffRange, '--']);
    const diff = rawDiff.length > 15000
      ? rawDiff.slice(0, 15000) + '\n... (truncated)'
      : rawDiff;

    log.info({ taskId, fileCount: diffSummary.files.length }, 'Starting AI security review via Claude CLI');
    const securityMarkdown = await runSecurityCLI(taskId, workDir, fileList, diff);
    const hasCritical = /(?:치명적|critical|심각|긴급)/i.test(securityMarkdown);

    return { securityMarkdown, hasCritical };
  } catch (error) {
    log.warn({ taskId, error }, 'AI security review failed (non-blocking)');
    return {
      securityMarkdown: `## 보안 점검: ${taskId}\n\n보안 점검 실패: ${error instanceof Error ? error.message : String(error)}`,
      hasCritical: false,
    };
  }
}

/**
 * Claude CLI를 사용한 AI 보안 취약점 점검 실행
 */
function runSecurityCLI(taskId: string, workDir: string, fileList: string, diff: string): Promise<string> {
  return new Promise((resolve) => {
    const prompt = `# 보안 취약점 점검 요청

## 태스크: ${taskId}

## 변경된 파일
${fileList}

## Diff
\`\`\`diff
${diff}
\`\`\`

## 점검 지침

위 변경사항에 대해 **보안 관점**에서만 점검하세요. **반드시 아래 마크다운 형식으로 출력하세요.**

\`\`\`
## 보안 점검: ${taskId}

### 점검 항목

#### 치명적
- **파일명**: 취약점 설명 및 공격 시나리오 (있는 경우만)

#### 경고
- **파일명**: 잠재적 보안 위험 설명 (있는 경우만)

#### 권고
- **파일명**: 보안 강화 제안 (있는 경우만)

### 결론
(전체 보안 상태 요약 한 줄)
\`\`\`

## 점검 범위 (OWASP Top 10 기반)
- 인증/인가 우회 가능성
- SQL Injection, XSS, Command Injection
- 하드코딩된 시크릿 (API Key, 비밀번호, 토큰)
- 민감 정보 노출 (로그, 응답, 에러 메시지)
- 안전하지 않은 역직렬화
- 경로 탐색 (Path Traversal)
- SSRF, CSRF 가능성
- 암호화 관련 이슈 (약한 알고리즘, 평문 전송)
- 의존성 보안 (알려진 취약 라이브러리)

## 중요 규칙
- **한글로 작성**
- 보안과 무관한 코드 품질 이슈는 무시
- 이슈가 없는 심각도 섹션은 생략
- 파일을 직접 읽지 말고 제공된 diff만 분석하세요
- 실제 취약점만 보고 (추측성 경고 최소화)`;

    const claude = spawn('claude', ['-p', '--dangerously-skip-permissions', '--output-format', 'text'], {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        HOME: process.env.HOME,
        CLAUDE_CODE_ENTRYPOINT: 'cli',
      },
    });

    claude.stdin?.write(prompt);
    claude.stdin?.end();

    let output = '';
    claude.stdout?.on('data', (data) => { output += data.toString(); });
    claude.stderr?.on('data', () => {});

    const timeout = setTimeout(() => {
      claude.kill('SIGTERM');
      resolve(`## 보안 점검: ${taskId}\n\n보안 점검 타임아웃 (5분 초과)`);
    }, 5 * 60 * 1000);

    claude.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && output.trim()) {
        resolve(output.trim());
      } else {
        resolve(`## 보안 점검: ${taskId}\n\nAI 보안 점검 실패 (exit code: ${code})`);
      }
    });

    claude.on('error', (err) => {
      clearTimeout(timeout);
      resolve(`## 보안 점검: ${taskId}\n\nAI 보안 점검 실행 오류: ${err.message}`);
    });
  });
}

/**
 * 변경사항 분석
 */
async function analyzeChanges(changes: FileChange[], baseBranch: string, workDir?: string): Promise<ReviewPoint[]> {
  const points: ReviewPoint[] = [];

  for (const change of changes) {
    // .env 파일 체크
    if (change.path.includes('.env')) {
      points.push({
        file: change.path,
        severity: 'critical',
        category: 'security',
        message: '환경 변수 파일이 변경되었습니다. 민감 정보 노출 여부를 확인하세요.',
      });
    }

    // 큰 파일 경고
    if (change.additions > 300) {
      points.push({
        file: change.path,
        severity: 'suggestion',
        category: 'maintainability',
        message: `대량 추가 (+${change.additions}줄). 파일 분리를 검토하세요.`,
      });
    }

    // package.json 변경
    if (change.path.endsWith('package.json')) {
      points.push({
        file: change.path,
        severity: 'info',
        category: 'documentation',
        message: '의존성이 변경되었습니다. lock 파일을 확인하세요.',
      });
    }

    // 테스트 파일 없이 소스 추가
    const isSource = /\.(ts|js|tsx|jsx|py|go)$/.test(change.path) &&
                     !change.path.includes('test') &&
                     !change.path.includes('spec');
    if (isSource && change.status === 'added') {
      const hasTest = changes.some(c => c.path.includes('test') || c.path.includes('spec'));
      if (!hasTest) {
        points.push({
          file: change.path,
          severity: 'suggestion',
          category: 'testing',
          message: '테스트 없이 새 파일이 추가되었습니다. 테스트 추가를 검토하세요.',
        });
      }
    }

    // JS/TS/Java 파일 상세 분석
    if (/\.(ts|js|tsx|jsx|java|py|go)$/.test(change.path) && change.status !== 'deleted') {
      try {
        // workDir가 제공되어야 함
        if (!workDir) {
          continue;
        }

        const localGit = simpleGit(workDir);
        const isHash = /^[0-9a-f]{7,40}$/.test(baseBranch);
        let diff: string;
        if (isHash) {
          diff = await localGit.diff([baseBranch, '--', change.path]);
        } else {
          const branch = (await localGit.branch()).current;
          diff = await localGit.diff([`${baseBranch}...${branch}`, '--', change.path]);
        }

        // console.log 체크
        if (/\+.*console\.(log|debug|info)/.test(diff)) {
          points.push({
            file: change.path,
            severity: 'suggestion',
            category: 'style',
            message: 'console 구문이 발견되었습니다. 운영 배포 전 제거하세요.',
          });
        }

        // TODO/FIXME 체크
        if (/\+.*(TODO|FIXME)/.test(diff)) {
          points.push({
            file: change.path,
            severity: 'info',
            category: 'documentation',
            message: 'TODO/FIXME 주석이 추가되었습니다.',
          });
        }

        // 하드코딩된 시크릿 체크
        if (/\+.*(password|secret|api_key|apikey)\s*[=:]\s*['"][^'"]+/i.test(diff)) {
          points.push({
            file: change.path,
            severity: 'critical',
            category: 'security',
            message: '하드코딩된 시크릿이 의심됩니다. 환경 변수를 사용하세요.',
          });
        }
      } catch {
        // diff 실패 시 무시
      }
    }
  }

  return points;
}

/**
 * 요약 생성
 */
function getSummary(points: ReviewPoint[], fileCount: number): string {
  const critical = points.filter(p => p.severity === 'critical').length;
  const warning = points.filter(p => p.severity === 'warning').length;

  if (critical > 0) {
    return `치명적 이슈 ${critical}건 발견. 머지 전 반드시 검토가 필요합니다.`;
  }
  if (warning > 0) {
    return `경고 ${warning}건 발견. 검토해주세요.`;
  }
  if (fileCount > 20) {
    return '변경 범위가 큽니다. 단계적 리뷰를 권장합니다.';
  }
  return '이슈 없음. 머지 가능합니다.';
}

/**
 * 응답 포맷팅
 */
function formatReviewResponse(result: ReviewResult): string {
  const statusEmoji = (s: FileChange['status']) => {
    switch (s) {
      case 'added': return '+';
      case 'modified': return 'M';
      case 'deleted': return '-';
      default: return '?';
    }
  };

  let output = `## 코드 리뷰: ${result.task_id}

### 요약
| 항목 | 값 |
|------|-----|
| 브랜치 | \`${result.branch}\` → \`${result.base_branch}\` |
| 변경 파일 | ${result.files_changed}개 |
| 추가 | +${result.total_additions}줄 |
| 삭제 | -${result.total_deletions}줄 |

### 변경 파일
`;

  for (const c of result.changes.slice(0, 15)) {
    output += `- [${statusEmoji(c.status)}] \`${c.path}\` (+${c.additions}/-${c.deletions})\n`;
  }
  if (result.changes.length > 15) {
    output += `- ... 외 ${result.changes.length - 15}개\n`;
  }

  output += `\n### 리뷰 포인트 (${result.points.length}건)\n`;

  if (result.points.length === 0) {
    output += '이슈가 발견되지 않았습니다.\n';
  } else {
    const grouped = {
      critical: result.points.filter(p => p.severity === 'critical'),
      warning: result.points.filter(p => p.severity === 'warning'),
      suggestion: result.points.filter(p => p.severity === 'suggestion'),
      info: result.points.filter(p => p.severity === 'info'),
    };

    if (grouped.critical.length > 0) {
      output += '\n#### 치명적\n';
      for (const p of grouped.critical) {
        output += `- **${p.file}**: ${p.message}\n`;
      }
    }
    if (grouped.warning.length > 0) {
      output += '\n#### 경고\n';
      for (const p of grouped.warning) {
        output += `- **${p.file}**: ${p.message}\n`;
      }
    }
    if (grouped.suggestion.length > 0) {
      output += '\n#### 제안\n';
      for (const p of grouped.suggestion.slice(0, 5)) {
        output += `- ${p.file}: ${p.message}\n`;
      }
      if (grouped.suggestion.length > 5) {
        output += `- ... 외 ${grouped.suggestion.length - 5}건\n`;
      }
    }
  }

  output += `\n### 결론\n${result.summary}`;

  return output;
}
