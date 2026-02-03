import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import type { AgentResult, AgentRole, AgentArtifact } from '../types/agent.types.js';
import { autoPipelineLogger as log } from '../utils/logger.js';

// Stream JSON event types (from Claude CLI output)
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

// Progress event callback type
export type ProgressCallback = (event: {
  type: 'init' | 'thinking' | 'tool' | 'complete' | 'error';
  content: string;
}) => void;

// Execution options
export interface ExecuteOptions {
  timeoutMs?: number;
  sessionId?: string | null;
  workDir?: string;
  onProgress?: ProgressCallback;
}

/**
 * AgentExecutor wraps Claude CLI spawning for use by ParallelEngine.
 * Extracts the core CLI execution logic from auto-pipeline into a reusable component.
 */
export class AgentExecutor {
  private defaultWorkDir: string;
  private onProgress?: ProgressCallback;
  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(defaultWorkDir?: string, onProgress?: ProgressCallback) {
    this.defaultWorkDir = defaultWorkDir || process.cwd();
    this.onProgress = onProgress;
  }

  /**
   * Execute a prompt using Claude CLI and return structured result.
   */
  async execute(
    agentId: string,
    role: AgentRole,
    prompt: string,
    options: ExecuteOptions = {}
  ): Promise<AgentResult> {
    const { timeoutMs = 5 * 60 * 1000, sessionId = null, workDir } = options;
    const cwd = workDir || this.defaultWorkDir;

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      log.info({ agentId, role, workDir: cwd }, 'Spawning Claude CLI');

      // Build CLI args with session support
      const cliArgs = ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
      let newSessionId: string | null = null;

      if (sessionId) {
        cliArgs.push('--resume', sessionId);
        log.info({ agentId, sessionId }, 'Resuming previous CLI session');
      } else {
        newSessionId = randomUUID();
        cliArgs.push('--session-id', newSessionId);
        log.info({ agentId, newSessionId }, 'Starting new CLI session');
      }

      // Spawn Claude CLI process
      const claude = spawn('claude', cliArgs, {
        cwd,
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

      // Track active process
      this.activeProcesses.set(agentId, claude);

      let output = '';
      let errorOutput = '';
      let lineBuffer = '';
      let timeoutId: NodeJS.Timeout | null = null;
      const toolCalls: string[] = [];
      const textResponses: string[] = [];
      let finalResult = '';
      let apiDuration = 0;

      // Setup timeout
      timeoutId = setTimeout(() => {
        log.warn({ agentId }, 'Timeout reached, killing process');
        claude.kill('SIGTERM');
      }, timeoutMs);

      // Process stdout (stream-json format)
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
          const parsed = this.parseStreamEvent(line);
          if (parsed) {
            // Track for building result
            if (parsed.type === 'tool' && parsed.toolName) {
              toolCalls.push(parsed.toolName);
            }
            if (parsed.type === 'thinking' && parsed.text) {
              textResponses.push(parsed.text);
            }
            if (parsed.type === 'complete' && parsed.result) {
              finalResult = parsed.result;
              apiDuration = parsed.duration_ms || 0;
            }

            // Call progress callback (per-call or instance-level)
            const progressFn = options.onProgress || this.onProgress;
            if (progressFn) {
              progressFn({
                type: parsed.type,
                content: parsed.content,
              });
            }
          }
        }
      });

      // Process stderr
      claude.stderr?.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;

        text.split('\n').filter((line: string) => line.trim()).forEach((line: string) => {
          log.debug({ agentId, stream: 'stderr' }, line);
        });
      });

      // Handle process close
      const cleanup = (code: number | null) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.activeProcesses.delete(agentId);

        const duration = Date.now() - startTime;
        log.info({ agentId, exitCode: code, duration }, 'Claude CLI exited');

        // Process any remaining data in line buffer
        if (lineBuffer.trim()) {
          output += lineBuffer + '\n';
          const parsed = this.parseStreamEvent(lineBuffer);
          const progressFn = options.onProgress || this.onProgress;
          if (parsed && progressFn) {
            progressFn({
              type: parsed.type,
              content: parsed.content,
            });
          }
        }

        // Build result
        const status = code === 0 ? 'success' : 'failed';
        const uniqueTools = [...new Set(toolCalls)];

        // Extract final message
        const message = finalResult || textResponses[textResponses.length - 1] || '(no output)';

        // Build output object
        const outputData = {
          message,
          recommendations: [] as string[],
          tools_used: uniqueTools,
        };

        const result: AgentResult = {
          agent_id: agentId,
          role,
          task_id: agentId, // Will be overridden by caller if needed
          status,
          output: outputData,
          artifacts: [] as AgentArtifact[], // Empty for now
          metrics: {
            duration_ms: duration,
            tool_calls: toolCalls.length,
            tokens_used: 0, // Not available from stream-json
          },
          timestamp: new Date().toISOString(),
        };

        // Always resolve — failed status is in the result, not a rejection
        if (code !== 0) {
          result.status = 'failed';
          result.output = {
            ...outputData,
            error: errorOutput || `Exit code: ${code}`,
          };
        }
        resolve(result);
      };

      claude.on('close', cleanup);

      claude.on('error', (error) => {
        this.activeProcesses.delete(agentId);
        log.error({ agentId, error }, 'Claude CLI error');

        const errorResult: AgentResult = {
          agent_id: agentId,
          role,
          task_id: agentId,
          status: 'failed',
          output: {
            message: error.message,
            recommendations: [],
            tools_used: [],
          },
          artifacts: [],
          metrics: {
            duration_ms: Date.now() - startTime,
            tool_calls: 0,
            tokens_used: 0,
          },
          timestamp: new Date().toISOString(),
        };

        resolve(errorResult);
      });
    });
  }

  /**
   * Cancel a running process.
   */
  cancel(agentId: string): boolean {
    const process = this.activeProcesses.get(agentId);
    if (!process) {
      return false;
    }

    log.info({ agentId }, 'Cancelling agent execution');
    process.kill('SIGTERM');
    this.activeProcesses.delete(agentId);
    return true;
  }

  /**
   * Get list of active agent IDs.
   */
  getActiveAgents(): string[] {
    return Array.from(this.activeProcesses.keys());
  }

  /**
   * Parse stream-json event and extract meaningful progress info.
   */
  private parseStreamEvent(line: string): {
    type: 'init' | 'thinking' | 'tool' | 'complete' | 'error';
    content: string;
    text?: string;
    toolName?: string;
    result?: string;
    duration_ms?: number;
  } | null {
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
                return {
                  type: 'thinking',
                  content: item.text,
                  text: item.text,
                };
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
                return {
                  type: 'tool',
                  content: `🔧 ${toolInfo}${detail}`,
                  toolName: item.name,
                };
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
              content: `✅ 작업 완료 ${duration ? `(${duration}` : ''}${cost ? `, ${cost})` : duration ? ')' : ''}\n\n${event.result || ''}`,
              result: event.result,
              duration_ms: event.duration_ms,
            };
          } else if (event.subtype === 'error') {
            return {
              type: 'error',
              content: `❌ 오류 발생: ${event.result || '알 수 없는 오류'}`,
            };
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
}
