import { spawn, ChildProcess } from 'child_process';
import { Redis } from 'ioredis';
import type { Task } from '../types/task.types.js';
import { readTaskRegistry, writeTaskRegistry, getTaskContextPath } from '../utils/registry.js';
import { getProjects, getProjectById } from '../utils/project-manager.js';
import { autoPipelineLogger as log } from '../utils/logger.js';
import * as fs from 'fs/promises';
import { nowISO } from '../utils/date.js';
import { addPipelineAgent, updatePipelineAgent, removePipelineAgent } from '../http-server.js';

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

let redis: Redis | null = null;
let publishEventFn: ((event: string, data: unknown) => Promise<void>) | null = null;
const activePipelines: Map<string, ChildProcess> = new Map();

// Project-based queue: one task at a time per project
const projectQueues: Map<string, string[]> = new Map(); // projectId -> taskId[]
const runningProjects: Set<string> = new Set(); // projectIds currently running

export function initAutoPipeline(
  redisClient: Redis | null,
  publishEvent: (event: string, data: unknown) => Promise<void>
): void {
  redis = redisClient;
  publishEventFn = publishEvent;

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
      }
    } else {
      // Use first project if no project_id specified
      const projects = await getProjects();
      if (projects.length > 0) {
        workDir = projects[0].path;
        projectId = projects[0].id;
      }
    }

    // 3. Check if project is already running a task
    if (runningProjects.has(projectId)) {
      // Add to queue
      if (!projectQueues.has(projectId)) {
        projectQueues.set(projectId, []);
      }
      projectQueues.get(projectId)!.push(taskId);
      const queueSize = projectQueues.get(projectId)!.length;
      log.info({ taskId, projectId, queueSize }, 'Task queued for project');
      await publishEventFn('pipeline:queued', { task_id: taskId, project_id: projectId, queue_position: queueSize });
      return;
    }

    // Mark project as running
    runningProjects.add(projectId);
    log.info({ taskId, workDir }, 'Invoking Claude CLI');

    // Build prompt for Claude CLI
    const prompt = buildPrompt(task);

    // Run Claude CLI - will transition to IN_PROGRESS when first output received
    await runClaudeCLI(taskId, workDir, prompt, projectId);

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

function buildPrompt(task: Task): string {
  const description = task.description || 'No description provided';
  const taskType = detectTaskType(task);

  // Build feedback section if there's previous feedback
  let feedbackSection = '';
  const unresolvedFeedback = task.feedback_history.filter(fb => !fb.resolved);
  if (unresolvedFeedback.length > 0) {
    feedbackSection = `
## Previous Feedback (MUST ADDRESS)
${unresolvedFeedback.map(fb => `- ${fb.content} (${fb.created_at})`).join('\n')}

**Important**: This task was previously reviewed and rejected. You MUST address the feedback above.
`;
  }

  return `# Conductor Task Execution

## Task Information
- **ID**: ${task.id}
- **Title**: ${task.title}
- **Description**: ${description}
- **Detected Type**: ${taskType}
${feedbackSection}
## Execution Instructions

You are operating in **autopilot mode**. Follow these steps:

1. **Analyze the task** and determine what needs to be done
2. **Delegate to appropriate specialist agents** based on task type:
   - Code changes → use executor agent (oh-my-claudecode:executor)
   - Documentation → use writer agent (oh-my-claudecode:writer)
   - Code review → use code-reviewer agent (oh-my-claudecode:code-reviewer)
   - UI/Frontend → use designer agent (oh-my-claudecode:designer)
   - Testing → use test-agent
   - Security review → use security-agent

3. **Actually implement the changes** - do not just describe them
4. **Verify the changes** work correctly
5. **Summarize** what was changed

## Important Rules
- You MUST actually edit/write files to complete this task
- Use the Task tool to delegate to specialized agents when appropriate
- Do NOT just output a plan - execute it
- After completion, provide a clear summary of changes made

Begin execution now.`;
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
  if (text.includes('refactor') || text.includes('리팩토링') || text.includes('개선')) {
    return 'refactoring';
  }
  if (text.includes('bug') || text.includes('fix') || text.includes('버그') || text.includes('수정')) {
    return 'bugfix';
  }

  return 'implementation';
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

// Parse stream-json output and extract meaningful progress info
function parseStreamEvent(line: string): { type: string; content: string } | null {
  try {
    const event: StreamEvent = JSON.parse(line);

    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          return { type: 'init', content: '🚀 Claude CLI 세션 시작' };
        }
        return null;

      case 'assistant':
        if (event.message?.content) {
          for (const item of event.message.content) {
            if (item.type === 'text' && item.text) {
              // Return AI's thinking/response text
              return { type: 'thinking', content: item.text };
            }
            if (item.type === 'tool_use' && item.name) {
              // Return tool being used
              const toolInfo = item.name;
              let detail = '';
              if (item.input && typeof item.input === 'object') {
                const input = item.input as Record<string, unknown>;
                if (input.pattern) detail = ` "${input.pattern}"`;
                else if (input.file_path) detail = ` "${input.file_path}"`;
                else if (input.command) detail = ` "${String(input.command).substring(0, 50)}..."`;
              }
              return { type: 'tool', content: `🔧 ${toolInfo}${detail}` };
            }
          }
        }
        return null;

      case 'user':
        // Tool results - usually not needed to show
        return null;

      case 'result':
        if (event.subtype === 'success') {
          const duration = event.duration_ms ? `${(event.duration_ms / 1000).toFixed(1)}초` : '';
          const cost = event.total_cost_usd ? `$${event.total_cost_usd.toFixed(4)}` : '';
          return {
            type: 'complete',
            content: `✅ 작업 완료 ${duration ? `(${duration}` : ''}${cost ? `, ${cost})` : duration ? ')' : ''}\n\n${event.result || ''}`
          };
        } else if (event.subtype === 'error') {
          return { type: 'error', content: `❌ 오류 발생: ${event.result || '알 수 없는 오류'}` };
        }
        return null;

      default:
        return null;
    }
  } catch {
    // Not valid JSON, might be partial line
    return null;
  }
}

// Extract human-readable output from stream-json for context file
function extractReadableOutput(rawOutput: string): string {
  const lines = rawOutput.split('\n').filter(line => line.trim());
  const readable: string[] = [];
  let finalResult = '';

  for (const line of lines) {
    try {
      const event: StreamEvent = JSON.parse(line);

      if (event.type === 'assistant' && event.message?.content) {
        for (const item of event.message.content) {
          if (item.type === 'text' && item.text) {
            readable.push(item.text);
          }
          if (item.type === 'tool_use' && item.name) {
            readable.push(`[Tool: ${item.name}]`);
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

  // Combine AI responses and final result
  const summary = readable.slice(-10).join('\n\n'); // Keep last 10 entries to avoid huge files
  return finalResult ? `${summary}\n\n---\n### Final Result\n${finalResult}` : summary;
}

async function runClaudeCLI(taskId: string, workDir: string, prompt: string, projectId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    log.info({ taskId, workDir }, 'Spawning Claude CLI');
    log.debug({ taskId, prompt: prompt.substring(0, 100) + '...' }, 'Prompt preview');

    // Pass prompt via stdin to avoid shell escaping issues
    // Use stream-json format for structured progress tracking
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

    // Write prompt to stdin and close it
    claude.stdin?.write(prompt);
    claude.stdin?.end();

    log.debug({ taskId }, 'Command: echo "<prompt>" | claude -p --dangerously-skip-permissions --output-format stream-json --verbose');

    activePipelines.set(taskId, claude);

    let output = '';
    let errorOutput = '';
    let lineBuffer = '';
    let timeoutId: NodeJS.Timeout | null = null;

    // Timeout after 5 minutes
    const TIMEOUT_MS = 5 * 60 * 1000;
    timeoutId = setTimeout(() => {
      log.warn({ taskId }, 'Timeout reached, killing process');
      claude.kill('SIGTERM');
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
          publishEventFn?.('pipeline:output', {
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
          publishEventFn?.('pipeline:output', {
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
        const updatedContext = `${existingContext}\n\n## Pipeline Output (${new Date().toISOString()})\n\n${readableOutput || errorOutput || '(no output)'}`;
        await fs.writeFile(contextPath, updatedContext, 'utf-8');

        // Transition to REVIEW on success
        if (code === 0) {
          const registry = await readTaskRegistry();
          const task = registry.tasks[taskId];
          if (task) {
            task.status = 'REVIEW';
            task.updated_at = new Date().toISOString();
            await writeTaskRegistry(registry);
            await publishEventFn?.('task:review', { id: taskId, status: 'REVIEW' });
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
          await updateTaskError(taskId, new Error(`Claude CLI exited with code ${code}\n${errorOutput}`));
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
      // Append error to feedback_history
      task.feedback_history.push({
        id: `ERR-${Date.now()}`,
        content: `Pipeline Error: ${errorMessage}`,
        created_at: new Date().toISOString(),
        resolved: false,
        resolved_at: null,
      });
      await writeTaskRegistry(registry);
    }
    await publishEventFn?.('pipeline:error', {
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
    if (task && task.status === 'READY') {
      task.status = 'IN_PROGRESS';
      task.started_at = new Date().toISOString();
      task.updated_at = new Date().toISOString();
      await writeTaskRegistry(registry);
      await publishEventFn?.('task:started', { id: taskId, status: 'IN_PROGRESS' });
      // Publish activity event for dashboard
      await publishEventFn?.('activity', createActivity('task.started', taskId, `AI started working on: ${task.title}`));
      // Add virtual pipeline agent for dashboard display
      addPipelineAgent(taskId, task.title);
      // Notify dashboard about agent change
      await publishEventFn?.('agent.spawned', { agentId: `pipeline-${taskId}`, role: 'code', taskId });
      log.info({ taskId }, 'Task → IN_PROGRESS (manual trigger)');
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

  process.kill('SIGTERM');
  activePipelines.delete(taskId);
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
