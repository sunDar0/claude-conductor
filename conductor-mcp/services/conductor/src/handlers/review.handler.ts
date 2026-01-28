import type { ReviewInput, ReviewResult, ReviewPoint, FileChange } from '../types/index.js';
import { readTaskRegistry } from '../utils/registry.js';
import { getChangedFiles, getDefaultBranch, getCurrentBranch, getFileDiff } from '../utils/git.js';
import { nowISO } from '../utils/date.js';

type EventPublisher = (event: string, data: unknown) => Promise<void>;

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
    const baseBranch = input.base_branch || await getDefaultBranch();
    const currentBranch = await getCurrentBranch();

    const changes = await getChangedFiles(baseBranch);

    if (changes.length === 0) {
      return {
        content: [{ type: 'text', text: `No changes found against ${baseBranch}` }],
      };
    }

    // 변경사항 분석
    const points = await analyzeChanges(changes, baseBranch);

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
 * 변경사항 분석
 */
async function analyzeChanges(changes: FileChange[], baseBranch: string): Promise<ReviewPoint[]> {
  const points: ReviewPoint[] = [];

  for (const change of changes) {
    // .env 파일 체크
    if (change.path.includes('.env')) {
      points.push({
        file: change.path,
        severity: 'critical',
        category: 'security',
        message: 'Environment file changed. Check for sensitive data.',
      });
    }

    // 큰 파일 경고
    if (change.additions > 300) {
      points.push({
        file: change.path,
        severity: 'suggestion',
        category: 'maintainability',
        message: `Large addition (+${change.additions} lines). Consider splitting.`,
      });
    }

    // package.json 변경
    if (change.path.endsWith('package.json')) {
      points.push({
        file: change.path,
        severity: 'info',
        category: 'documentation',
        message: 'Dependencies changed. Verify lock file.',
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
          message: 'New file without tests. Consider adding tests.',
        });
      }
    }

    // JS/TS 파일 상세 분석
    if (/\.(ts|js|tsx|jsx)$/.test(change.path) && change.status !== 'deleted') {
      try {
        const diff = await getFileDiff(baseBranch, change.path);

        // console.log 체크
        if (/\+.*console\.(log|debug|info)/.test(diff)) {
          points.push({
            file: change.path,
            severity: 'suggestion',
            category: 'style',
            message: 'Console statements found. Remove before production.',
          });
        }

        // TODO/FIXME 체크
        if (/\+.*(TODO|FIXME)/.test(diff)) {
          points.push({
            file: change.path,
            severity: 'info',
            category: 'documentation',
            message: 'TODO/FIXME comment added.',
          });
        }

        // 하드코딩된 시크릿 체크
        if (/\+.*(password|secret|api_key|apikey)\s*[=:]\s*['"][^'"]+/i.test(diff)) {
          points.push({
            file: change.path,
            severity: 'critical',
            category: 'security',
            message: 'Possible hardcoded secret. Use environment variables.',
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
    return `${critical} critical issue(s) found. Review required before merge.`;
  }
  if (warning > 0) {
    return `${warning} warning(s) found. Please review.`;
  }
  if (fileCount > 20) {
    return 'Large changeset. Consider incremental review.';
  }
  return 'Looks good. Ready to merge.';
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

  let output = `## Code Review: ${result.task_id}

### Summary
| Field | Value |
|-------|-------|
| Branch | \`${result.branch}\` -> \`${result.base_branch}\` |
| Files Changed | ${result.files_changed} |
| Additions | +${result.total_additions} lines |
| Deletions | -${result.total_deletions} lines |

### Changed Files
`;

  for (const c of result.changes.slice(0, 15)) {
    output += `- [${statusEmoji(c.status)}] \`${c.path}\` (+${c.additions}/-${c.deletions})\n`;
  }
  if (result.changes.length > 15) {
    output += `- ... and ${result.changes.length - 15} more\n`;
  }

  output += `\n### Review Points (${result.points.length})\n`;

  if (result.points.length === 0) {
    output += 'No issues found.\n';
  } else {
    const grouped = {
      critical: result.points.filter(p => p.severity === 'critical'),
      warning: result.points.filter(p => p.severity === 'warning'),
      suggestion: result.points.filter(p => p.severity === 'suggestion'),
      info: result.points.filter(p => p.severity === 'info'),
    };

    if (grouped.critical.length > 0) {
      output += '\n#### Critical\n';
      for (const p of grouped.critical) {
        output += `- **${p.file}**: ${p.message}\n`;
      }
    }
    if (grouped.warning.length > 0) {
      output += '\n#### Warning\n';
      for (const p of grouped.warning) {
        output += `- **${p.file}**: ${p.message}\n`;
      }
    }
    if (grouped.suggestion.length > 0) {
      output += '\n#### Suggestion\n';
      for (const p of grouped.suggestion.slice(0, 5)) {
        output += `- ${p.file}: ${p.message}\n`;
      }
      if (grouped.suggestion.length > 5) {
        output += `- ... and ${grouped.suggestion.length - 5} more\n`;
      }
    }
  }

  output += `\n### Conclusion\n${result.summary}`;

  return output;
}
