import * as fs from 'fs/promises';
import type { Task, TaskStatus, TaskPriority } from '../types/index.js';
import { VALID_TRANSITIONS, STATUS_EMOJI, PRIORITY_EMOJI } from '../types/task.types.js';
import { readTaskRegistry, writeTaskRegistry, getTaskContextPath, getTaskDirPath, getCurrentProjectId } from '../utils/registry.js';
import { nowISO, formatKorean, formatDateOnly, calculateDuration } from '../utils/date.js';
import { ensureDir } from '../utils/file.js';

export type EventPublisher = (event: string, data: unknown) => Promise<void>;

// Activity event helper
function createActivity(type: string, taskId: string, message: string) {
  return {
    id: `ACT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    task_id: taskId,
    message,
    timestamp: nowISO(),
  };
}

function generateTaskId(counter: number): string {
  return `TASK-${String(counter).padStart(3, '0')}`;
}

function createContextTemplate(task: Task): string {
  return `# ${task.id}: ${task.title}

## Goal

${task.description || 'Please describe the goal.'}

## Requirements

- [ ] Requirement 1

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

  // project_id가 없으면 현재 선택된 프로젝트 사용
  const projectId = input.project_id || await getCurrentProjectId() || 'default';

  const task: Task = {
    id: taskId,
    project_id: projectId,
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
  if (input.feedback) {
    task.feedback_history.push({
      id: `FB-${Date.now()}`,
      content: input.feedback,
      created_at: now,
      resolved: false,
      resolved_at: null,
    });
  }

  await writeTaskRegistry(registry);
  await publish('task.transitioned', { task, from: prevStatus, to: input.target_state });
  // Publish activity event for dashboard
  const message = input.feedback
    ? `Task ${task.id}: ${prevStatus} → ${input.target_state} (feedback: ${input.feedback.substring(0, 50)}...)`
    : `Task ${task.id}: ${prevStatus} → ${input.target_state}`;
  await publish('activity', createActivity('task.transitioned', task.id, message));

  return {
    content: [{
      type: 'text',
      text: `${STATUS_EMOJI[input.target_state]} Status changed: ${task.id}

${prevStatus} -> ${input.target_state}`,
    }],
  };
}
