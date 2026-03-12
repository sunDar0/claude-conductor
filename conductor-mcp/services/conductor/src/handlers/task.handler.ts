import * as fs from 'fs/promises';
import type { Task, TaskStatus, TaskPriority } from '../types/index.js';
import { VALID_TRANSITIONS, STATUS_EMOJI, PRIORITY_EMOJI } from '../types/task.types.js';
import { readTaskRegistry, writeTaskRegistry, getTaskContextPath, getTaskDirPath, getCurrentProjectId } from '../utils/registry.js';
import { nowISO, formatKorean, formatDateOnly } from '../utils/date.js';
import { ensureDir } from '../utils/file.js';
import { taskHandlerLogger as log } from '../utils/logger.js';
import { createActivity } from '../utils/activity.js';
import { handleChangelogGenerate } from './changelog.handler.js';

export type EventPublisher = (event: string, data: unknown) => Promise<void>;

function generateTaskId(counter: number): string {
  return `TASK-${String(counter).padStart(3, '0')}`;
}

function extractRequirements(description: string): string[] {
  const requirements: string[] = [];
  const lines = description.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Match bullet points, numbered lists, checkbox items
    const match = trimmed.match(/^(?:[-*•]|\d+[.)]\s*|\[[ x]\])\s*(.+)/i);
    if (match) {
      requirements.push(match[1].trim());
    }
  }

  // If no list items found, split by sentences that look like requirements
  if (requirements.length === 0 && description.trim().length > 0) {
    // Split by Korean/English sentence endings
    const sentences = description
      .split(/[.。]\s*|\n/)
      .map(s => s.trim())
      .filter(s => s.length > 5 && s.length < 200);

    if (sentences.length > 1) {
      for (const s of sentences) {
        requirements.push(s);
      }
    } else if (sentences.length === 1) {
      requirements.push(sentences[0]);
    }
  }

  return requirements;
}

function createContextTemplate(task: Task): string {
  const requirements = extractRequirements(task.description || '');
  const requirementsList = requirements.length > 0
    ? requirements.map(r => `- [ ] ${r}`).join('\n')
    : '(No requirements specified)';

  return `# ${task.id}: ${task.title}

## Goal

${task.description || 'Please describe the goal.'}

## Requirements

${requirementsList}

## Progress Notes

### ${formatDateOnly(task.created_at)}
- Task created
`;
}

export async function handleTaskCreate(
  input: { title: string; description?: string; priority?: TaskPriority; project_id?: string },
  publish: EventPublisher
) {
  const registry = await readTaskRegistry();
  registry.counter += 1;
  const taskId = generateTaskId(registry.counter);
  const now = nowISO();

  // title 자동 생성: description에서 추출
  if (!input.title || !input.title.trim()) {
    const desc = input.description || '';
    const firstLine = desc.split('\n')[0].trim();
    input.title = firstLine.length > 50
      ? firstLine.substring(0, 50) + '...'
      : firstLine || 'Untitled Task';
  }

  // project_id가 없으면 현재 선택된 프로젝트 사용
  const projectId = input.project_id || await getCurrentProjectId() || 'default';

  // Resolve project path for fallback
  let projectPath: string | undefined;
  if (projectId && projectId !== 'default') {
    const { getProjectById } = await import('../utils/project-manager.js');
    const project = await getProjectById(projectId);
    if (project) {
      projectPath = project.path;
    }
  }

  const task: Task = {
    id: taskId,
    project_id: projectId,
    project_path: projectPath,
    title: input.title,
    description: input.description || '',
    status: 'READY',
    priority: input.priority || 'medium',
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: null,
    branch: null,
    context_file: `.claude/tasks/${taskId}/context.md`,
    changelog_versions: [],
    feedback_history: [],
    session_id: null,
    last_error: null,
    base_commit: null,
    hidden: false,
  };

  registry.tasks[taskId] = task;
  await writeTaskRegistry(registry);
  await ensureDir(getTaskDirPath(taskId));
  await fs.writeFile(getTaskContextPath(taskId), createContextTemplate(task), 'utf-8');
  await publish('task.created', { task });
  // Publish activity event for dashboard
  await publish('activity', createActivity('task.created', taskId, `Task created: ${task.title}`));

  return {
    content: [{
      type: 'text',
      text: `Task created successfully

| Field | Value |
|-------|-------|
| ID | ${task.id} |
| Title | ${task.title} |
| Priority | ${PRIORITY_EMOJI[task.priority]} ${task.priority} |
| Status | ${STATUS_EMOJI[task.status]} ${task.status} |

To start: /project:task-start ${task.id}`,
    }],
  };
}

export async function handleTaskList(input: {
  status?: TaskStatus;
  priority?: TaskPriority;
  project_id?: string;
  all_projects?: boolean;
}) {
  const registry = await readTaskRegistry();
  let tasks = Object.values(registry.tasks);

  // 프로젝트 필터링 (all_projects가 아니면 현재 프로젝트만)
  if (!input.all_projects) {
    const projectId = input.project_id || await getCurrentProjectId();
    if (projectId) {
      tasks = tasks.filter(t => t.project_id === projectId);
    }
  }

  if (input.status) tasks = tasks.filter(t => t.status === input.status);
  if (input.priority) tasks = tasks.filter(t => t.priority === input.priority);

  const groups: Record<TaskStatus, Task[]> = {
    BACKLOG: [], READY: [], IN_PROGRESS: [], REVIEW: [], DONE: [], CLOSED: [],
  };
  for (const task of tasks) groups[task.status].push(task);

  const labels: Record<TaskStatus, string> = {
    BACKLOG: `${STATUS_EMOJI.BACKLOG} Backlog`,
    READY: `${STATUS_EMOJI.READY} Ready`,
    IN_PROGRESS: `${STATUS_EMOJI.IN_PROGRESS} In Progress`,
    REVIEW: `${STATUS_EMOJI.REVIEW} Review`,
    DONE: `${STATUS_EMOJI.DONE} Done`,
    CLOSED: `${STATUS_EMOJI.CLOSED} Closed`,
  };

  let response = 'Task List\n\n';
  for (const [status, label] of Object.entries(labels)) {
    const statusTasks = groups[status as TaskStatus];
    response += `## ${label}\n`;
    if (statusTasks.length === 0) {
      response += '(No tasks)\n\n';
    } else {
      response += '| ID | Title | Priority | Created |\n|----|-------|----------|--------|\n';
      for (const t of statusTasks) {
        response += `| ${t.id} | ${t.title} | ${PRIORITY_EMOJI[t.priority]} ${t.priority} | ${formatDateOnly(t.created_at)} |\n`;
      }
      response += '\n';
    }
  }
  response += `---\nTotal: ${tasks.length} tasks`;
  return { content: [{ type: 'text', text: response }] };
}

export async function handleTaskGet(input: { task_id: string }) {
  const registry = await readTaskRegistry();
  const task = registry.tasks[input.task_id];
  if (!task) {
    return {
      content: [{ type: 'text', text: `Task not found: ${input.task_id}` }],
      isError: true,
    };
  }

  return {
    content: [{
      type: 'text',
      text: `## ${task.id}: ${task.title}

| Field | Value |
|-------|-------|
| Status | ${STATUS_EMOJI[task.status]} ${task.status} |
| Priority | ${PRIORITY_EMOJI[task.priority]} ${task.priority} |
| Created | ${formatKorean(task.created_at)} |
| Context | ${task.context_file} |
${task.branch ? `| Branch | ${task.branch} |` : ''}
${task.started_at ? `| Started | ${formatKorean(task.started_at)} |` : ''}
${task.completed_at ? `| Completed | ${formatKorean(task.completed_at)} |` : ''}`,
    }],
  };
}

export async function handleTaskStart(input: { task_id: string }, publish: EventPublisher) {
  const registry = await readTaskRegistry();
  const task = registry.tasks[input.task_id];
  if (!task) {
    return {
      content: [{ type: 'text', text: `Task not found: ${input.task_id}` }],
      isError: true,
    };
  }
  if (task.status !== 'READY') {
    return {
      content: [{ type: 'text', text: `Cannot start task. Current status: ${task.status}. Must be READY.` }],
      isError: true,
    };
  }

  const now = nowISO();
  task.status = 'IN_PROGRESS';
  task.started_at = now;
  task.updated_at = now;
  task.branch = `feature/${task.id}`;
  await writeTaskRegistry(registry);
  await fs.appendFile(getTaskContextPath(task.id), `\n### ${formatDateOnly(now)}\n- Task started\n`, 'utf-8');
  await publish('task.started', { task });
  // Publish activity event for dashboard
  await publish('activity', createActivity('task.started', task.id, `Task started: ${task.title}`));

  return {
    content: [{
      type: 'text',
      text: `Task started: ${task.id} - ${task.title}

Branch: ${task.branch}
Context: ${task.context_file}

Starting work.`,
    }],
  };
}

export async function handleTaskDelete(
  input: { task_id: string },
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

  // Only allow deletion of READY or BACKLOG tasks
  if (task.status !== 'READY' && task.status !== 'BACKLOG') {
    return {
      content: [{
        type: 'text',
        text: `삭제 불가: ${input.task_id}는 ${task.status} 상태입니다. READY 또는 BACKLOG 상태만 삭제 가능합니다.`,
      }],
      isError: true,
    };
  }

  delete registry.tasks[input.task_id];
  await writeTaskRegistry(registry);
  await publish('task.deleted', { task_id: input.task_id, title: task.title });
  await publish('activity', createActivity('task.deleted', input.task_id, `Task deleted: ${task.title}`));

  log.info({ taskId: input.task_id, title: task.title }, 'Task deleted');

  return {
    content: [{
      type: 'text',
      text: `🗑️ 태스크 삭제됨: ${input.task_id} (${task.title})`,
    }],
  };
}

export async function handleTaskTransition(
  input: { task_id: string; target_state: TaskStatus; feedback?: string },
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

  if (!VALID_TRANSITIONS[task.status].includes(input.target_state)) {
    return {
      content: [{
        type: 'text',
        text: `State transition failed

Current: ${task.status}
Requested: ${input.target_state}
Allowed: ${VALID_TRANSITIONS[task.status].join(', ') || 'none'}`,
      }],
      isError: true,
    };
  }

  if (task.status === 'REVIEW' && input.target_state === 'IN_PROGRESS' && !input.feedback?.trim()) {
    return {
      content: [{ type: 'text', text: 'Feedback is required when rejecting review.' }],
      isError: true,
    };
  }

  const now = nowISO();
  const prevStatus = task.status;
  task.status = input.target_state;
  task.updated_at = now;
  if (input.target_state === 'DONE') task.completed_at = now;
  if (input.target_state === 'DONE' || input.target_state === 'BACKLOG') task.session_id = null;
  if (input.feedback) {
    // 기존 미해결 피드백을 resolved 처리 (재실행 시 최신 피드백만 활성)
    for (const fb of task.feedback_history) {
      if (!fb.resolved) {
        fb.resolved = true;
        fb.resolved_at = now;
      }
    }
    const feedbackEntry = {
      id: `FB-${Date.now()}`,
      content: input.feedback,
      created_at: now,
      resolved: false,
      resolved_at: null,
    };
    task.feedback_history.push(feedbackEntry);
    log.info({
      taskId: task.id,
      feedback: input.feedback,
      feedbackId: feedbackEntry.id,
      totalFeedback: task.feedback_history.length
    }, 'Feedback added to task (previous unresolved marked as resolved)');
  }

  await writeTaskRegistry(registry);
  await publish('task.transitioned', { task, from: prevStatus, to: input.target_state });
  // Publish activity event for dashboard
  const message = input.feedback
    ? `Task ${task.id}: ${prevStatus} → ${input.target_state} (feedback: ${input.feedback.substring(0, 50)}...)`
    : `Task ${task.id}: ${prevStatus} → ${input.target_state}`;
  await publish('activity', createActivity('task.transitioned', task.id, message));

  // REVIEW → DONE 전환 시 CHANGELOG 자동 생성
  if (prevStatus === 'REVIEW' && input.target_state === 'DONE') {
    try {
      const changelogResult = await handleChangelogGenerate(
        { task_id: task.id, from_ref: task.base_commit || undefined },
        publish,
      );
      if (!changelogResult.isError) {
        log.info({ taskId: task.id }, 'CHANGELOG generated on DONE transition');
      }
    } catch (err) {
      log.warn({ taskId: task.id, error: err }, 'CHANGELOG generation failed (non-blocking)');
    }
  }

  return {
    content: [{
      type: 'text',
      text: `${STATUS_EMOJI[input.target_state]} Status changed: ${task.id}

${prevStatus} -> ${input.target_state}`,
    }],
  };
}

export async function handleTaskHide(
  input: { task_id: string; hidden: boolean },
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

  task.hidden = input.hidden;
  task.updated_at = nowISO();
  await writeTaskRegistry(registry);
  await publish('task.updated', { task });

  return {
    content: [{
      type: 'text',
      text: input.hidden
        ? `Task hidden: ${task.id}`
        : `Task unhidden: ${task.id}`,
    }],
  };
}
