import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import simpleGit from 'simple-git';
import type { Task } from '../types/task.types.js';
import { readTaskRegistry, writeTaskRegistry, getTaskContextPath, getTaskPromptPath } from '../utils/registry.js';
import { getProjects, getProjectById } from '../utils/project-manager.js';
import { autoPipelineLogger as log } from '../utils/logger.js';
import { parseStreamEvent } from '../utils/stream-parser.js';
import * as fs from 'fs/promises';
import { nowISO } from '../utils/date.js';
import { createActivity } from '../utils/activity.js';
import { addPipelineAgent, updatePipelineAgent, removePipelineAgent } from '../http-server.js';
import { getAgentRegistry } from '../server.js';
import { runCodeReview, runSecurityReview } from './review.handler.js';
import { ParallelEngine } from '../orchestration/parallel-engine.js';
import { AgentExecutor } from '../orchestration/agent-executor.js';
import { AgentManager } from '../orchestration/agent-manager.js';
import type { OrchestrationPlan, OrchestrationStage, AgentRole } from '../types/agent.types.js';

// Git 변경사항 수집을 위한 인터페이스
export interface GitChangeInfo {
  baseCommit: string;
  files: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
  diff: string;
}

// 작업 전 Git 상태 캡처
async function captureBaseCommit(workDir: string): Promise<string | null> {
  try {
    const git = simpleGit(workDir);
    const result = await git.revparse(['HEAD']);
    return result.trim();
  } catch (error) {
    log.warn({ workDir, error }, 'Failed to capture base commit');
    return null;
  }
}

// Save base_commit to task registry
async function saveBaseCommit(taskId: string, baseCommit: string | null): Promise<void> {
  if (!baseCommit) return;
  const reg = await readTaskRegistry();
  if (reg.tasks[taskId]) {
    reg.tasks[taskId].base_commit = baseCommit;
    await writeTaskRegistry(reg);
  }
}

// 작업 후 Git 변경사항 수집
async function collectGitChanges(workDir: string, baseCommit: string): Promise<GitChangeInfo | null> {
  try {
    const git = simpleGit(workDir);

    // 변경된 파일 목록 (staged + unstaged)
    const diffSummary = await git.diffSummary([baseCommit]);
    const files = diffSummary.files.map(f => {
      // Binary 파일은 insertions/deletions가 없을 수 있음
      const additions = 'insertions' in f ? f.insertions : 0;
      const deletions = 'deletions' in f ? f.deletions : 0;
      return {
        path: f.file,
        status: additions > 0 && deletions === 0 ? '추가됨' :
                additions === 0 && deletions > 0 ? '삭제됨' : '수정됨',
        additions,
        deletions,
      };
    });

    // 상세 diff (최대 5000자)
    let diff = '';
    if (files.length > 0) {
      const rawDiff = await git.diff([baseCommit, '--', ...files.slice(0, 5).map(f => f.path)]);
      diff = rawDiff.slice(0, 5000);
      if (rawDiff.length > 5000) {
        diff += '\n... (truncated)';
      }
    }

    return { baseCommit, files, diff };
  } catch (error) {
    log.warn({ workDir, baseCommit, error }, 'Failed to collect git changes');
    return null;
  }
}

// Git 변경사항을 Markdown으로 포맷팅
export function formatGitChanges(changes: GitChangeInfo): string {
  if (changes.files.length === 0) {
    return '';
  }

  let md = `\n\n## Changes\n\n`;
  md += `### 변경된 파일 (${changes.files.length}개)\n\n`;
  md += `| 파일 | 상태 | 변경 |\n`;
  md += `|------|------|------|\n`;

  for (const file of changes.files) {
    const change = file.additions > 0 || file.deletions > 0
      ? `+${file.additions} -${file.deletions}`
      : '-';
    md += `| \`${file.path}\` | ${file.status} | ${change} |\n`;
  }

  if (changes.diff) {
    md += `\n### 상세 변경 내용\n\n`;
    md += '```diff\n';
    md += changes.diff;
    md += '\n```\n';
  }

  return md;
}

let redis: Redis | null = null;
let publishEventFn: ((event: string, data: unknown) => Promise<void>) | null = null;
const activePipelines: Map<string, ChildProcess> = new Map();
const cancelledPipelines: Set<string> = new Set();
let parallelEngine: ParallelEngine | null = null;
let agentManager: AgentManager | null = null;

// Determine if a task should use orchestrated (multi-agent) execution
export function shouldUseOrchestration(task: Task, engine?: unknown): boolean {
  const hasUnresolvedFeedback = task.feedback_history.some(fb => !fb.resolved);
  const isResume = !!task.session_id;
  const engineAvailable = engine !== undefined ? !!engine : !!parallelEngine;
  return engineAvailable && !isResume && !hasUnresolvedFeedback;
}

// Project-based queue: one task at a time per project
const projectQueues: Map<string, string[]> = new Map(); // projectId -> taskId[]
const runningProjects: Set<string> = new Set(); // projectIds currently running

export function initAutoPipeline(
  redisClient: Redis | null,
  publishEvent: (event: string, data: unknown) => Promise<void>,
  engine?: ParallelEngine | null,
  manager?: AgentManager | null,
): void {
  redis = redisClient;
  publishEventFn = publishEvent;
  parallelEngine = engine || null;
  agentManager = manager || null;

  log.info('Initialized - using Claude CLI');

  // Subscribe to task events (auto-start disabled by default for manual control)
  const autoStart = process.env.AUTO_START_PIPELINE === 'true';

  if (redis && autoStart) {
    const subscriber = redis.duplicate();
    subscriber.subscribe('conductor:events');
    subscriber.on('message', async (_channel, message) => {
      try {
        const event = JSON.parse(message);
        // Handle both task.created and task:created event names
        if ((event.event === 'task.created' || event.event === 'task:created') &&
            event.data?.task?.status === 'READY') {
          const taskId = event.data.task.id;
          log.info({ taskId }, 'New READY task detected');
          await runAutoPipeline(taskId);
        }
      } catch (error) {
        log.error({ error }, 'Event processing error');
      }
    });
    log.info('Auto-start enabled - subscribed to task events');
  } else {
    log.info('Auto-start disabled - use manual trigger (▶️ button)');
  }
}

// Queue a task for execution (project-based queue)
export async function runAutoPipeline(taskId: string): Promise<void> {
  if (!publishEventFn) {
    log.error('Not initialized');
    return;
  }

  try {
    // 1. Get task details
    const registry = await readTaskRegistry();
    const task = registry.tasks[taskId];
    if (!task) {
      log.error({ taskId }, 'Task not found');
      return;
    }

    if (task.status !== 'READY' && task.status !== 'IN_PROGRESS') {
      log.warn({ taskId, currentStatus: task.status }, 'Task is not READY or IN_PROGRESS');
      return;
    }

    // 2. Get project path
    let workDir = process.env.WORKSPACE_DIR || process.cwd();
    let projectId = task.project_id || 'default';

    if (task.project_id) {
      const project = await getProjectById(task.project_id);
      if (project) {
        workDir = project.path;
        projectId = project.id;
      } else if (task.project_path) {
        // Project ID not found but task has stored path - use it directly
        log.warn({ taskId, staleProjectId: task.project_id, projectPath: task.project_path }, 'Task references non-existent project, using stored project_path');
        workDir = task.project_path;
      } else {
        // No path stored either - try first project as last resort
        const projects = await getProjects();
        if (projects.length > 0) {
          log.warn({ taskId, staleProjectId: task.project_id }, 'Task references non-existent project and has no stored path, falling back to first project');
          workDir = projects[0].path;
          projectId = projects[0].id;
        }
      }
    } else {
      // Use first project if no project_id specified
      const projects = await getProjects();
      if (projects.length > 0) {
        workDir = projects[0].path;
        projectId = projects[0].id;
      }
    }

    log.info({ taskId, projectId, workDir }, 'Resolved working directory for task');

    // 3. Check if project is already running a task
    if (runningProjects.has(projectId)) {
      // Add to queue
      if (!projectQueues.has(projectId)) {
        projectQueues.set(projectId, []);
      }
      projectQueues.get(projectId)!.push(taskId);
      const queueSize = projectQueues.get(projectId)!.length;
      log.info({ taskId, projectId, queueSize }, 'Task queued for project');
      await publishEventFn('pipeline.queued', { task_id: taskId, project_id: projectId, queue_position: queueSize });
      return;
    }

    // Mark project as running
    runningProjects.add(projectId);
    log.info({ taskId, workDir }, 'Invoking Claude CLI');

    // Check for session resume capability
    const existingSessionId = task.session_id;
    const isResume = !!existingSessionId;

    // Read previous output only if no session_id (legacy fallback)
    let previousOutput: string | undefined;
    const unresolvedFeedback = task.feedback_history.filter(fb => !fb.resolved);
    if (unresolvedFeedback.length > 0 && !isResume) {
      try {
        const contextPath = getTaskContextPath(taskId);
        const contextContent = await fs.readFile(contextPath, 'utf-8');
        // Extract the LAST Final Result (use global flag to find all, then take last one)
        const finalResultMatches = contextContent.match(/### Final Result\s*\n([\s\S]*?)(?=\n---|$)/g);
        if (finalResultMatches && finalResultMatches.length > 0) {
          const lastFinalResult = finalResultMatches[finalResultMatches.length - 1];
          previousOutput = lastFinalResult.replace(/### Final Result\s*\n/, '').trim();
        } else {
          // Fallback: get last Pipeline Output section
          const pipelineMatches = contextContent.match(/## Pipeline Output[^\n]*\n\n([\s\S]*?)(?=\n## |$)/g);
          if (pipelineMatches && pipelineMatches.length > 0) {
            const lastMatch = pipelineMatches[pipelineMatches.length - 1];
            previousOutput = lastMatch.replace(/## Pipeline Output[^\n]*\n\n/, '').trim();
          }
        }
        log.info({ taskId, hasPreviousOutput: !!previousOutput, outputLength: previousOutput?.length }, 'Read previous output for feedback (legacy mode)');
      } catch (err) {
        log.warn({ taskId, error: err }, 'Could not read previous output');
      }
    }

    // Build prompt for Claude CLI
    const prompt = await buildPrompt(task, isResume, previousOutput);

    // Save prompt to prompt.md for debugging/visibility
    try {
      const promptPath = getTaskPromptPath(taskId);
      const runType = isResume ? '재실행 (Resume)' : (unresolvedFeedback.length > 0 ? '재실행 (Legacy)' : '초기 실행');
      const promptEntry = `\n\n---\n## ${runType} — ${new Date().toISOString()}\n\n### 사용자 요청\n- **제목**: ${task.title}\n- **설명**: ${task.description || '없음'}\n${unresolvedFeedback.length > 0 ? `\n### 피드백\n${unresolvedFeedback.map(fb => `- ${fb.content}`).join('\n')}\n` : ''}\n### 최종 프롬프트\n\`\`\`\n${prompt}\n\`\`\`\n`;
      let existing = '';
      try { existing = await fs.readFile(promptPath, 'utf-8'); } catch { /* first run */ }
      await fs.writeFile(promptPath, existing ? existing + promptEntry : `# Prompt History — ${taskId}\n${promptEntry}`, 'utf-8');
      log.info({ taskId }, 'Prompt saved to prompt.md');
    } catch (err) {
      log.warn({ taskId, error: err }, 'Failed to save prompt.md');
    }

    // Choose execution path: orchestrated vs direct CLI
    const useOrchestration = shouldUseOrchestration(task, parallelEngine);

    if (useOrchestration) {
      // Orchestrated execution: multi-agent pipeline
      log.info({ taskId }, 'Using orchestrated execution');
      await runOrchestrated(taskId, workDir, task, projectId);
    } else {
      // Direct CLI execution: feedback/resume or no engine available
      log.info({ taskId, reason: isResume ? 'resume' : unresolvedFeedback.length > 0 ? 'feedback' : 'no-engine' }, 'Using direct CLI execution');
      const feedbackInfo = unresolvedFeedback.map(fb => fb.content);
      await runClaudeCLI(taskId, workDir, prompt, projectId, existingSessionId, feedbackInfo.length > 0 ? feedbackInfo : undefined);
    }

  } catch (error) {
    log.error({ taskId, error }, 'Error processing task');
    await updateTaskError(taskId, error);
  }
}

// Process next task in project queue
async function processNextInQueue(projectId: string): Promise<void> {
  runningProjects.delete(projectId);

  const queue = projectQueues.get(projectId);
  if (queue && queue.length > 0) {
    const nextTaskId = queue.shift()!;
    log.info({ taskId: nextTaskId, projectId }, 'Processing next queued task');
    // Small delay to prevent rapid-fire execution
    setTimeout(() => runAutoPipeline(nextTaskId), 1000);
  } else {
    projectQueues.delete(projectId);
    log.debug({ projectId }, 'Queue empty');
  }
}

async function buildPrompt(task: Task, isResume: boolean, previousOutput?: string): Promise<string> {
  const description = task.description || 'No description provided';
  const taskType = detectTaskType(task);

  // Build feedback section if there's previous feedback
  let feedbackSection = '';
  const unresolvedFeedback = task.feedback_history.filter(fb => !fb.resolved);

  // Debug: Log feedback info
  log.info({
    taskId: task.id,
    totalFeedback: task.feedback_history.length,
    unresolvedCount: unresolvedFeedback.length,
    feedbackContents: unresolvedFeedback.map(fb => fb.content),
    hasPreviousOutput: !!previousOutput,
    isResume
  }, 'Building prompt with feedback');

  // Resume mode: CLI has full context, only send feedback
  if (isResume && unresolvedFeedback.length > 0) {
    return `# 피드백 반영 요청

## 태스크 정보
- **ID**: ${task.id}
- **제목**: ${task.title}

## 피드백 (반드시 반영해야 함)
${unresolvedFeedback.map(fb => `- ${fb.content}`).join('\n')}

## 지침
이전 대화 컨텍스트가 자동으로 유지됩니다.
피드백에서 요청한 사항만 수정하세요.
불필요한 변경 최소화.
**모든 출력과 문서는 한글로 작성**

지금 수정을 시작하세요.`;
  }

  // If there's feedback AND previous output, this is a revision request
  if (unresolvedFeedback.length > 0 && previousOutput) {
    feedbackSection = `
## 이전 작업 결과
\`\`\`
${previousOutput.substring(0, 5000)}${previousOutput.length > 5000 ? '\n... (truncated)' : ''}
\`\`\`

## 피드백 (반드시 반영해야 함)
${unresolvedFeedback.map(fb => `- ${fb.content}`).join('\n')}

**중요**: 위의 이전 작업 결과를 기반으로, 피드백을 반영하여 수정하세요.
처음부터 다시 작업하지 말고, 기존 결과물을 개선하세요.
`;

    return `# Conductor 태스크 수정 요청

## 태스크 정보
- **ID**: ${task.id}
- **제목**: ${task.title}
- **설명**: ${description}
${feedbackSection}
## 수정 지침

이전 작업이 완료되었으나 피드백이 있습니다. 다음을 수행하세요:

1. **피드백 분석** - 무엇을 수정해야 하는지 파악
2. **기존 결과물 기반으로 수정** - 처음부터 다시 하지 말 것
3. **수정 사항 적용** - 피드백에서 요청한 부분만 수정
4. **수정 내용 요약** - 무엇을 어떻게 수정했는지 설명

## 중요 규칙
- 피드백에서 언급하지 않은 부분은 그대로 유지
- 불필요한 변경 최소화
- **모든 출력과 문서는 한글로 작성**

지금 수정을 시작하세요.`;
  }

  // First run or no feedback - original prompt
  if (unresolvedFeedback.length > 0) {
    feedbackSection = `
## Previous Feedback (MUST ADDRESS)
${unresolvedFeedback.map(fb => `- ${fb.content} (${fb.created_at})`).join('\n')}

**Important**: This task was previously reviewed and rejected. You MUST address the feedback above.
`;
  }

  return `# Conductor 태스크 실행

## 태스크 정보
- **ID**: ${task.id}
- **제목**: ${task.title}
- **설명**: ${description}
- **감지된 유형**: ${taskType}
${feedbackSection}
## 실행 지침

**자동 파일럿 모드**로 작업합니다. 다음 단계를 따르세요:

1. **태스크 분석** - 무엇을 해야 하는지 파악
2. **적절한 전문 에이전트에 위임** (태스크 유형에 따라):
   - 코드 변경 → executor 에이전트 (oh-my-claudecode:executor)
   - 문서화 → writer 에이전트 (oh-my-claudecode:writer)
   - 코드 리뷰 → code-reviewer 에이전트 (oh-my-claudecode:code-reviewer)
   - UI/프론트엔드 → designer 에이전트 (oh-my-claudecode:designer)
   - 테스트 → test-agent
   - 보안 검토 → security-agent

3. **실제로 변경 사항을 구현** - 계획만 세우지 말고 실행
4. **변경 사항이 올바르게 작동하는지 확인**
5. **변경된 내용을 요약**

## 중요 규칙
- 반드시 파일을 실제로 편집/작성해야 함
- 적절한 경우 Task 도구를 사용하여 전문 에이전트에 위임
- 계획만 출력하지 말고 실행할 것
- 완료 후 변경 사항에 대한 명확한 요약 제공
- **모든 출력과 문서는 한글로 작성**

지금 실행을 시작하세요.`;
}

function detectTaskType(task: Task): string {
  const text = `${task.title} ${task.description || ''}`.toLowerCase();

  if (text.includes('readme') || text.includes('문서') || text.includes('doc')) {
    return 'documentation';
  }
  if (text.includes('test') || text.includes('테스트')) {
    return 'testing';
  }
  if (text.includes('review') || text.includes('리뷰') || text.includes('검토')) {
    return 'review';
  }
  if (text.includes('ui') || text.includes('frontend') || text.includes('화면') || text.includes('디자인')) {
    return 'frontend';
  }
  if (text.includes('security') || text.includes('보안')) {
    return 'security';
  }
  if (text.includes('backend') || text.includes('api') || text.includes('서버') || text.includes('endpoint')) {
    return 'backend';
  }
  if (text.includes('infra') || text.includes('deploy') || text.includes('ci/cd') || text.includes('docker') || text.includes('배포') || text.includes('인프라')) {
    return 'infra';
  }
  if (text.includes('refactor') || text.includes('리팩토링') || text.includes('개선')) {
    return 'refactoring';
  }
  if (text.includes('bug') || text.includes('fix') || text.includes('버그') || text.includes('수정')) {
    return 'bugfix';
  }

  return 'implementation';
}

function buildOrchestrationPlan(taskId: string, task: Task): OrchestrationPlan {
  const taskType = detectTaskType(task);
  const stages: OrchestrationStage[] = [];

  // Get role mapping function
  const registry = getAgentRegistry();
  const mapRole = (role: string): AgentRole => registry?.mapRole(role) ?? role;

  // Stage 1: Main execution (always sequential - one agent does the work)
  const mainRole: AgentRole = taskType === 'review' ? mapRole('review')
    : taskType === 'testing' ? mapRole('test')
    : taskType === 'documentation' ? mapRole('docs')
    : taskType === 'security' ? mapRole('security')
    : mapRole('code');

  stages.push({
    stage_id: `stage-main-${randomUUID().slice(0, 8)}`,
    name: '메인 작업',
    agents: [{
      role: mainRole,
      skills: [],
    }],
    parallel: false,
    timeout_ms: 30 * 60 * 1000, // 30 minutes
  });

  // Stage 2: Review (parallel - code review + security review)
  // baseCommit은 initial_shared로 전달되어 review/security agent가 git diff로 리뷰
  if (['implementation', 'bugfix', 'refactoring', 'frontend', 'backend', 'infra'].includes(taskType)) {
    stages.push({
      stage_id: `stage-review-${randomUUID().slice(0, 8)}`,
      name: '검증 (리뷰 & 보안 & 테스트)',
      agents: [
        { role: mapRole('review'), skills: [] },
        { role: mapRole('security'), skills: [] },
        { role: mapRole('test'), skills: [] },
      ],
      parallel: true,
      timeout_ms: 10 * 60 * 1000, // 10 minutes
    });
  } else if (taskType === 'documentation') {
    stages.push({
      stage_id: `stage-review-${randomUUID().slice(0, 8)}`,
      name: '문서 리뷰',
      agents: [
        { role: mapRole('review'), skills: [] },
      ],
      parallel: false,
      timeout_ms: 10 * 60 * 1000,
    });
  }

  return {
    id: `plan-${taskId}-${randomUUID().slice(0, 8)}`,
    task_id: taskId,
    strategy: stages.length > 1 ? 'pipeline' : 'sequential',
    stages,
    created_at: new Date().toISOString(),
    status: 'pending',
    task_context: {
      title: task.title,
      description: task.description || '',
    },
  };
}

async function runOrchestrated(taskId: string, workDir: string, task: Task, projectId: string): Promise<void> {
  if (!parallelEngine || !publishEventFn) {
    throw new Error('Orchestration engine not initialized');
  }

  const plan = buildOrchestrationPlan(taskId, task);

  log.info({ taskId, planId: plan.id, stages: plan.stages.length, strategy: plan.strategy }, 'Orchestration plan created');

  // Notify dashboard
  await publishEventFn('pipeline.output', {
    task_id: taskId,
    event_type: 'info',
    output: `🎭 오케스트레이션 시작 — ${plan.stages.length}단계, 전략: ${plan.strategy}`,
    timestamp: new Date().toISOString(),
  });

  // Update agent context with task info
  // The ParallelEngine will spawn agents via AgentManager which reads from AgentRegistry
  // We need to ensure task context is passed through
  if (agentManager) {
    // Provide task context to the manager for future spawns
    // This is done through the plan's agents in each stage
    for (const stage of plan.stages) {
      for (const agentConfig of stage.agents) {
        // Context will be set during spawn in ParallelEngine
        // We just log what's planned
        log.info({ taskId, role: agentConfig.role, stage: stage.name }, 'Planned agent');
      }
    }
  }

  // Capture base commit before execution — passed via initial_shared to review/security agents
  const baseCommit = await captureBaseCommit(workDir);
  log.info({ taskId, baseCommit }, 'Captured base commit before orchestration');
  plan.initial_shared = { baseCommit: baseCommit || '' };

  // Save base_commit to task for changelog generation
  await saveBaseCommit(taskId, baseCommit);

  try {
    // Execute the orchestration plan
    const result = await parallelEngine.execute(plan, workDir);

    log.info({ taskId, planId: plan.id, agentCount: result.agents.length }, 'Orchestration completed');

    // Build readable output from orchestration results
    let readableOutput = result.summary + '\n\n';

    for (const agentResult of result.agents) {
      readableOutput += `### ${agentResult.role} Agent (${agentResult.status})\n`;
      if (agentResult.output) {
        const output = agentResult.output as Record<string, unknown>;
        readableOutput += `${output.message || JSON.stringify(output)}\n\n`;
      }
      if (agentResult.metrics) {
        readableOutput += `> 소요: ${(agentResult.metrics.duration_ms / 1000).toFixed(1)}초, 도구 호출: ${agentResult.metrics.tool_calls}회\n\n`;
      }
    }

    if (result.conflicts.length > 0) {
      readableOutput += `\n### 충돌 사항\n`;
      for (const c of result.conflicts) {
        readableOutput += `- ${c.description}\n`;
      }
    }

    // Collect git changes (same as regular pipeline)
    let changesSection = '';
    if (baseCommit) {
      const gitChanges = await collectGitChanges(workDir, baseCommit);
      if (gitChanges && gitChanges.files.length > 0) {
        changesSection = formatGitChanges(gitChanges);
        log.info({ taskId, fileCount: gitChanges.files.length }, 'Git changes collected for orchestration');
      }
    }

    // Save to context file
    const contextPath = getTaskContextPath(taskId);
    let existingContext = '';
    try { existingContext = await fs.readFile(contextPath, 'utf-8'); } catch { /* first run */ }
    const runLabel = `## Orchestrated Pipeline Output (${new Date().toISOString()})`;
    const updatedContext = `${existingContext}\n\n${runLabel}\n\n${readableOutput}${changesSection}`;
    await fs.writeFile(contextPath, updatedContext, 'utf-8');

    // Check if any agent failed
    const allSuccess = result.agents.every(a => a.status === 'success');

    if (allSuccess) {
      // Transition to REVIEW
      const registry = await readTaskRegistry();
      const updatedTask = registry.tasks[taskId];
      if (updatedTask) {
        updatedTask.status = 'REVIEW';
        updatedTask.last_error = null;
        updatedTask.updated_at = new Date().toISOString();
        await writeTaskRegistry(registry);
        await publishEventFn('task.review', { id: taskId, status: 'REVIEW' });
        await publishEventFn('activity', createActivity('task.review', taskId, `Orchestration completed: ${updatedTask.title} - ready for review`));
        updatePipelineAgent(taskId, 'completed');
        await publishEventFn('agent.completed', { agentId: `pipeline-${taskId}` });
        setTimeout(() => removePipelineAgent(taskId), 60000);
        log.info({ taskId }, 'Orchestration completed, moved to REVIEW');
      }
    } else {
      // Some agents failed
      const failedAgents = result.agents.filter(a => a.status === 'failed');
      const errorMsg = `Orchestration partial failure: ${failedAgents.length} agent(s) failed`;
      log.warn({ taskId, failedCount: failedAgents.length }, errorMsg);
      await updateTaskError(taskId, new Error(errorMsg));

      // Still move to REVIEW if main stage succeeded
      const mainStageResult = result.agents[0]; // First agent is always main
      if (mainStageResult?.status === 'success') {
        const registry = await readTaskRegistry();
        const updatedTask = registry.tasks[taskId];
        if (updatedTask) {
          updatedTask.status = 'REVIEW';
          updatedTask.updated_at = new Date().toISOString();
          await writeTaskRegistry(registry);
          await publishEventFn('task.review', { id: taskId, status: 'REVIEW' });
          log.info({ taskId }, 'Main task succeeded despite review failures, moved to REVIEW');
        }
      }

      updatePipelineAgent(taskId, 'completed');
      setTimeout(() => removePipelineAgent(taskId), 60000);
    }

    await publishEventFn('pipeline.output', {
      task_id: taskId,
      event_type: allSuccess ? 'complete' : 'error',
      output: allSuccess
        ? `✅ 오케스트레이션 완료 — ${result.agents.length}개 에이전트 모두 성공`
        : `⚠️ 오케스트레이션 부분 완료 — 일부 에이전트 실패`,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    log.error({ taskId, error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error) }, 'Orchestration failed');
    await updateTaskError(taskId, error);
    // Transition task back to READY so user can retry
    try {
      const errRegistry = await readTaskRegistry();
      const errTask = errRegistry.tasks[taskId];
      if (errTask && errTask.status === 'IN_PROGRESS') {
        errTask.status = 'READY';
        errTask.updated_at = new Date().toISOString();
        await writeTaskRegistry(errRegistry);
        await publishEventFn('task.review', { id: taskId, status: 'READY' });
      }
    } catch (e) {
      log.error({ taskId, error: e }, 'Failed to transition task back to READY');
    }
    updatePipelineAgent(taskId, 'error', error instanceof Error ? error.message : String(error));
    await publishEventFn('agent.error', { agentId: `pipeline-${taskId}`, error: String(error) });
    setTimeout(() => removePipelineAgent(taskId), 60000);
  } finally {
    // Process next task in queue (same as runClaudeCLI cleanup)
    await processNextInQueue(projectId);
  }
}

// Stream JSON event types
interface StreamEvent {
  type: 'system' | 'assistant' | 'user' | 'result';
  subtype?: string;
  session_id?: string;
  message?: {
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: string;
    }>;
  };
  result?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
}

// Extract human-readable output from stream-json for context file
function extractReadableOutput(rawOutput: string): string {
  const lines = rawOutput.split('\n').filter(line => line.trim());
  const textResponses: string[] = [];
  const toolCalls: string[] = [];
  let finalResult = '';

  for (const line of lines) {
    try {
      const event: StreamEvent = JSON.parse(line);

      if (event.type === 'assistant' && event.message?.content) {
        for (const item of event.message.content) {
          if (item.type === 'text' && item.text) {
            // Keep all text responses
            textResponses.push(item.text);
          }
          if (item.type === 'tool_use' && item.name) {
            toolCalls.push(item.name);
          }
        }
      }

      if (event.type === 'result' && event.result) {
        finalResult = event.result;
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  // Build comprehensive output
  const parts: string[] = [];

  // Tools used summary
  if (toolCalls.length > 0) {
    const uniqueTools = [...new Set(toolCalls)];
    parts.push(`**사용된 도구**: ${uniqueTools.join(', ')}`);
  }

  // All text responses (Claude's explanations and summaries)
  if (textResponses.length > 0) {
    // Keep all responses, but limit total length to 10000 chars
    let totalLength = 0;
    const keptResponses: string[] = [];

    // Prioritize later responses (usually contain summary)
    for (let i = textResponses.length - 1; i >= 0 && totalLength < 10000; i--) {
      const resp = textResponses[i];
      if (totalLength + resp.length <= 10000) {
        keptResponses.unshift(resp);
        totalLength += resp.length;
      }
    }

    parts.push(keptResponses.join('\n\n'));
  }

  // Final result from Claude CLI
  if (finalResult) {
    parts.push(`---\n### Final Result\n${finalResult}`);
  } else if (textResponses.length > 0) {
    // If no explicit result, use last text response as final result
    const lastResponse = textResponses[textResponses.length - 1];
    parts.push(`---\n### Final Result\n${lastResponse}`);
  }

  return parts.join('\n\n') || '(no output)';
}

// 리뷰 이슈 자동 수정을 위한 Claude CLI 실행
async function runFixCLI(taskId: string, workDir: string, reviewMarkdown: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const prompt = `# 코드 리뷰 이슈 수정 요청

다음 코드 리뷰에서 발견된 Critical/Security 이슈를 수정하세요.

${reviewMarkdown}

## 지침
- Critical 및 Security 카테고리 이슈만 수정하세요
- 최소한의 변경으로 이슈를 해결하세요
- 수정한 내용을 간단히 요약하세요
- **한글로 작성**`;

    const claude = spawn('claude', ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'], {
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

    // 10분 타임아웃
    const timeout = setTimeout(() => {
      claude.kill('SIGTERM');
      resolve({ success: false, output: 'Fix timeout' });
    }, 10 * 60 * 1000);

    claude.on('close', (code) => {
      clearTimeout(timeout);
      const readable = extractReadableOutput(output);
      resolve({ success: code === 0, output: readable });
    });

    claude.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, output: err.message });
    });
  });
}

async function runClaudeCLI(taskId: string, workDir: string, prompt: string, projectId: string, sessionId: string | null, feedbackInfo?: string[]): Promise<void> {
  // 작업 전 Git 상태 캡처
  const baseCommit = await captureBaseCommit(workDir);
  log.info({ taskId, workDir, baseCommit }, 'Captured base commit before execution');

  // Save base_commit to task for changelog generation
  await saveBaseCommit(taskId, baseCommit);

  return new Promise((resolve, reject) => {
    log.info({ taskId, workDir }, 'Spawning Claude CLI');
    log.debug({ taskId, prompt: prompt.substring(0, 100) + '...' }, 'Prompt preview');

    // Build CLI args with session support
    const cliArgs = ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
    let newSessionId: string | null = null;
    if (sessionId) {
      cliArgs.push('--resume', sessionId);
      log.info({ taskId, sessionId }, 'Resuming previous CLI session');
    } else {
      newSessionId = randomUUID();
      cliArgs.push('--session-id', newSessionId);
      log.info({ taskId, newSessionId }, 'Starting new CLI session');
    }

    // Pass prompt via stdin to avoid shell escaping issues
    // Use stream-json format for structured progress tracking
    const claude = spawn('claude', cliArgs, {
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

    // Write prompt to stdin and close it
    claude.stdin?.write(prompt);
    claude.stdin?.end();

    log.debug({ taskId }, 'Command: echo "<prompt>" | claude -p --dangerously-skip-permissions --output-format stream-json --verbose');

    activePipelines.set(taskId, claude);

    let output = '';
    let errorOutput = '';
    let lineBuffer = '';
    let timeoutId: NodeJS.Timeout | null = null;

    // Timeout after 1 hour
    const TIMEOUT_MS = 60 * 60 * 1000;
    timeoutId = setTimeout(() => {
      log.warn({ taskId }, 'Timeout reached, killing process');
      claude.kill('SIGTERM');
      setTimeout(() => {
        if (!claude.killed) claude.kill('SIGKILL');
      }, 5000);
    }, TIMEOUT_MS);

    claude.stdout?.on('data', (data) => {
      const text = data.toString();
      lineBuffer += text;

      // Process complete lines (JSON Lines format)
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        output += line + '\n';

        // Parse and extract meaningful info
        const parsed = parseStreamEvent(line);
        if (parsed) {
          log.info({ taskId, eventType: parsed.type }, parsed.content.substring(0, 100));

          // Send structured progress to WebSocket
          publishEventFn?.('pipeline.output', {
            task_id: taskId,
            event_type: parsed.type,
            output: parsed.content,
            timestamp: new Date().toISOString(),
          });
        }
      }
    });

    claude.stderr?.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;

      text.split('\n').filter((line: string) => line.trim()).forEach((line: string) => {
        log.debug({ taskId, stream: 'stderr' }, line);
      });
    });

    const cleanup = async (code: number | null) => {
      if (timeoutId) clearTimeout(timeoutId);
      activePipelines.delete(taskId);
      log.info({ taskId, exitCode: code }, 'Claude CLI exited');

      // Process any remaining data in the line buffer
      if (lineBuffer.trim()) {
        output += lineBuffer + '\n';
        const parsed = parseStreamEvent(lineBuffer);
        if (parsed) {
          publishEventFn?.('pipeline.output', {
            task_id: taskId,
            event_type: parsed.type,
            output: parsed.content,
            timestamp: new Date().toISOString(),
          });
        }
      }

      try {
        // Save output to context (extract readable summary from stream-json)
        const contextPath = getTaskContextPath(taskId);
        let existingContext = '';
        try {
          existingContext = await fs.readFile(contextPath, 'utf-8');
        } catch {
          // No existing context
        }

        // Extract human-readable content from stream-json output
        const readableOutput = extractReadableOutput(output);

        // Git 변경사항 수집 (성공 시에만)
        let changesSection = '';
        if (code === 0 && baseCommit) {
          const gitChanges = await collectGitChanges(workDir, baseCommit);
          if (gitChanges && gitChanges.files.length > 0) {
            changesSection = formatGitChanges(gitChanges);
            log.info({ taskId, fileCount: gitChanges.files.length }, 'Git changes collected');
          }
        }

        // AI 코드 리뷰 & 보안 점검 (병렬 실행, 성공 시에만)
        let reviewSection = '';

        if (code === 0) {
          try {
            await publishEventFn?.('pipeline.output', {
              task_id: taskId,
              event_type: 'info',
              output: `🔍 AI 코드 리뷰 & 보안 점검 실행 중...`,
              timestamp: new Date().toISOString(),
            });

            // 코드 리뷰와 보안 점검을 병렬 실행
            const [reviewResult, securityResult] = await Promise.all([
              runCodeReview(taskId, workDir, baseCommit || undefined),
              runSecurityReview(taskId, workDir, baseCommit || undefined),
            ]);

            log.info({ taskId, reviewHasCritical: reviewResult.hasCritical, securityHasCritical: securityResult.hasCritical }, 'AI review & security check completed');

            const hasCritical = reviewResult.hasCritical || securityResult.hasCritical;

            // 코드 리뷰 결과
            if (reviewResult.reviewMarkdown) {
              reviewSection += `\n\n${reviewResult.reviewMarkdown}`;
            } else {
              reviewSection += `\n\n## 코드 리뷰: ${taskId}\n\n코드 리뷰 없음 — 변경된 파일이 없습니다.`;
            }

            // 보안 점검 결과
            if (securityResult.securityMarkdown) {
              reviewSection += `\n\n${securityResult.securityMarkdown}`;
            }

            await publishEventFn?.('pipeline.output', {
              task_id: taskId,
              event_type: hasCritical ? 'error' : 'complete',
              output: hasCritical
                ? `⚠️ AI 리뷰 완료 - 치명적 이슈 발견`
                : `✅ AI 코드 리뷰 & 보안 점검 완료`,
              timestamp: new Date().toISOString(),
            });
          } catch (reviewError) {
            log.warn({ taskId, error: reviewError }, 'AI review failed (non-blocking)');
          }
        }

        const runLabel = feedbackInfo && feedbackInfo.length > 0
          ? `## Pipeline Output — 재실행 (${new Date().toISOString()})\n\n> **피드백**: ${feedbackInfo.join(' / ')}\n`
          : `## Pipeline Output — 초기 실행 (${new Date().toISOString()})`;
        const updatedContext = `${existingContext}\n\n${runLabel}\n\n${readableOutput || errorOutput || '(no output)'}${changesSection}${reviewSection}`;
        await fs.writeFile(contextPath, updatedContext, 'utf-8');

        // Transition to REVIEW on success
        if (code === 0) {
          const registry = await readTaskRegistry();
          const task = registry.tasks[taskId];
          if (task) {
            task.status = 'REVIEW';
            task.last_error = null;
            // Save session_id for future resume
            if (newSessionId) {
              task.session_id = newSessionId;
              log.info({ taskId, sessionId: newSessionId }, 'Session ID saved to task');
            }
            task.updated_at = new Date().toISOString();
            await writeTaskRegistry(registry);
            await publishEventFn?.('task.review', { id: taskId, status: 'REVIEW' });
            // Publish activity event for dashboard
            await publishEventFn?.('activity', createActivity('task.review', taskId, `AI completed: ${task.title} - ready for review`));
            // Update pipeline agent status
            updatePipelineAgent(taskId, 'completed');
            await publishEventFn?.('agent.completed', { agentId: `pipeline-${taskId}` });
            // Remove after delay
            setTimeout(() => removePipelineAgent(taskId), 60000);
            log.info({ taskId }, 'Task completed, moved to REVIEW');
          }
        } else {
          // Skip error handling if pipeline was cancelled (user-initiated)
          if (!cancelledPipelines.has(taskId)) {
            await updateTaskError(taskId, new Error(`Claude CLI exited with code ${code}\n${errorOutput}`));
            // Transition task back to READY so user can retry
            try {
              const errRegistry = await readTaskRegistry();
              const errTask = errRegistry.tasks[taskId];
              if (errTask && errTask.status === 'IN_PROGRESS') {
                errTask.status = 'READY';
                errTask.updated_at = new Date().toISOString();
                await writeTaskRegistry(errRegistry);
                await publishEventFn?.('task.review', { id: taskId, status: 'READY' });
              }
            } catch (e) {
              log.error({ taskId, error: e }, 'Failed to transition task back to READY after error');
            }
          }
          cancelledPipelines.delete(taskId);
          // Update pipeline agent status on error
          updatePipelineAgent(taskId, 'error', `Exit code: ${code}`);
          await publishEventFn?.('agent.error', { agentId: `pipeline-${taskId}`, error: `Exit code: ${code}` });
          setTimeout(() => removePipelineAgent(taskId), 60000);
        }
      } catch (error) {
        log.error({ taskId, error }, 'Error in cleanup');
      }

      // Process next task in queue
      await processNextInQueue(projectId);

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Claude CLI failed with code ${code}`));
      }
    };

    claude.on('close', cleanup);

    claude.on('error', async (error) => {
      activePipelines.delete(taskId);
      log.error({ taskId, error }, 'Claude CLI error');
      await updateTaskError(taskId, error);
      reject(error);
    });
  });
}

async function updateTaskError(taskId: string, error: unknown): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  try {
    const registry = await readTaskRegistry();
    const task = registry.tasks[taskId];
    if (task) {
      task.updated_at = new Date().toISOString();
      // Store error separately — not in feedback_history
      task.last_error = `Pipeline Error: ${errorMessage}`;
      await writeTaskRegistry(registry);
    }
    await publishEventFn?.('pipeline.error', {
      task_id: taskId,
      error: errorMessage,
    });
    // Publish activity event for dashboard
    await publishEventFn?.('activity', createActivity('pipeline.error', taskId, `Pipeline error: ${errorMessage.substring(0, 100)}`));
  } catch (e) {
    log.error({ taskId, error: e }, 'Failed to update task with error');
  }
}

// Manual trigger - transitions to IN_PROGRESS immediately
export async function triggerPipeline(taskId: string): Promise<{ success: boolean; message: string }> {
  try {
    // Check if already running
    if (activePipelines.has(taskId)) {
      return { success: false, message: `Pipeline already running for ${taskId}` };
    }

    // Transition to IN_PROGRESS immediately when user clicks play
    const registry = await readTaskRegistry();
    const task = registry.tasks[taskId];

    // Debug: Log task state at trigger time
    log.info({
      taskId,
      status: task?.status,
      feedbackCount: task?.feedback_history?.length || 0,
      feedbackContents: task?.feedback_history?.map(fb => ({ content: fb.content, resolved: fb.resolved }))
    }, 'triggerPipeline: Task state at trigger');

    if (task && task.status === 'READY') {
      task.status = 'IN_PROGRESS';
      task.started_at = new Date().toISOString();
      task.updated_at = new Date().toISOString();
      await writeTaskRegistry(registry);
      await publishEventFn?.('task.started', { id: taskId, status: 'IN_PROGRESS' });
      // Publish activity event for dashboard
      await publishEventFn?.('activity', createActivity('task.started', taskId, `AI started working on: ${task.title}`));
      // Add virtual pipeline agent only for direct CLI path (orchestration manages its own agents)
      const isOrchestrated = shouldUseOrchestration(task, parallelEngine);
      if (!isOrchestrated) {
        addPipelineAgent(taskId, task.title);
        await publishEventFn?.('agent.spawned', { agentId: `pipeline-${taskId}`, role: 'code', taskId });
      }
      log.info({ taskId, orchestrated: isOrchestrated }, 'Task → IN_PROGRESS (manual trigger)');
    }

    await runAutoPipeline(taskId);
    return { success: true, message: `Pipeline started for ${taskId}` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

// Cancel running pipeline
export async function cancelPipeline(taskId: string): Promise<{ success: boolean; message: string }> {
  const process = activePipelines.get(taskId);
  if (!process) {
    return { success: false, message: `No running pipeline for ${taskId}` };
  }

  // Mark as cancelled so cleanup skips false error
  cancelledPipelines.add(taskId);
  process.kill('SIGTERM');
  activePipelines.delete(taskId);
  // Clear session_id so restart runs fresh (not resume)
  try {
    const registry = await readTaskRegistry();
    const task = registry.tasks[taskId];
    if (task) {
      task.session_id = null;
      task.updated_at = new Date().toISOString();
      await writeTaskRegistry(registry);
    }
  } catch (e) {
    log.error({ taskId, error: e }, 'Failed to clear session_id on cancel');
  }
  // Update and remove pipeline agent
  updatePipelineAgent(taskId, 'terminated');
  await publishEventFn?.('agent.terminated', { agentId: `pipeline-${taskId}` });
  setTimeout(() => removePipelineAgent(taskId), 5000);
  log.info({ taskId }, 'Pipeline cancelled');
  return { success: true, message: `Pipeline cancelled for ${taskId}` };
}

// Get active pipelines
export function getActivePipelines(): string[] {
  return Array.from(activePipelines.keys());
}
