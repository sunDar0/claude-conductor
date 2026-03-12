import { EventEmitter } from 'events';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('child_process');
vi.mock('../../utils/logger.js', () => ({
  autoPipelineLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../utils/stream-parser.js');

import { spawn } from 'child_process';
import { AgentExecutor } from '../agent-executor.js';
import { parseStreamEvent } from '../../utils/stream-parser.js';

const mockSpawn = vi.mocked(spawn);
const mockParseStreamEvent = vi.mocked(parseStreamEvent);

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = vi.fn((signal?: string) => {
    if (signal === 'SIGKILL') proc.killed = true;
  });
  proc.pid = 12345;
  return proc;
}

describe('AgentExecutor', () => {
  let executor: AgentExecutor;
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    executor = new AgentExecutor('/tmp/test-workdir');
    mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as any);
    mockParseStreamEvent.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns status success when process exits with code 0', async () => {
    const resultPromise = executor.execute('agent-1', 'executor', 'do something');

    mockProc.stdout.emit('data', '{"type":"result","content":"done"}\n');
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.agent_id).toBe('agent-1');
    expect(result.role).toBe('executor');
  });

  it('returns status failed when process exits with non-zero code', async () => {
    const resultPromise = executor.execute('agent-2', 'executor', 'do something');

    mockProc.emit('close', 1);

    const result = await resultPromise;
    expect(result.status).toBe('failed');
  });

  it('includes --dangerously-skip-permissions when CLAUDE_SKIP_PERMISSIONS is not false', async () => {
    const saved = process.env.CLAUDE_SKIP_PERMISSIONS;
    delete process.env.CLAUDE_SKIP_PERMISSIONS;

    const resultPromise = executor.execute('agent-3', 'executor', 'prompt');
    mockProc.emit('close', 0);
    await resultPromise;

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('--dangerously-skip-permissions');

    process.env.CLAUDE_SKIP_PERMISSIONS = saved;
  });

  it('omits --dangerously-skip-permissions when CLAUDE_SKIP_PERMISSIONS is false', async () => {
    const saved = process.env.CLAUDE_SKIP_PERMISSIONS;
    process.env.CLAUDE_SKIP_PERMISSIONS = 'false';

    const resultPromise = executor.execute('agent-4', 'executor', 'prompt');
    mockProc.emit('close', 0);
    await resultPromise;

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain('--dangerously-skip-permissions');

    process.env.CLAUDE_SKIP_PERMISSIONS = saved;
  });

  it('includes --resume and sessionId when sessionId option is provided', async () => {
    const resultPromise = executor.execute('agent-5', 'executor', 'prompt', {
      sessionId: 'existing-session-id',
    });
    mockProc.emit('close', 0);
    await resultPromise;

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('--resume');
    expect(spawnArgs).toContain('existing-session-id');
    expect(spawnArgs).not.toContain('--session-id');
  });

  it('includes --session-id with new UUID when no sessionId is provided', async () => {
    const resultPromise = executor.execute('agent-6', 'executor', 'prompt');
    mockProc.emit('close', 0);
    await resultPromise;

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('--session-id');
    expect(spawnArgs).not.toContain('--resume');
  });

  it('sends SIGTERM then SIGKILL when timeout is exceeded', async () => {
    vi.useFakeTimers();

    const resultPromise = executor.execute('agent-7', 'executor', 'prompt', {
      timeoutMs: 1000,
    });

    // Advance past timeout → SIGTERM
    await vi.advanceTimersByTimeAsync(1001);
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');

    // Advance 5s more → SIGKILL
    await vi.advanceTimersByTimeAsync(5001);
    expect(mockProc.kill).toHaveBeenCalledWith('SIGKILL');

    // Resolve the promise
    mockProc.emit('close', null);
    await resultPromise;
  });

  it('cancel returns true and kills a running process', async () => {
    // Start execution but don't resolve yet
    const resultPromise = executor.execute('agent-8', 'executor', 'prompt');

    const cancelled = executor.cancel('agent-8');
    expect(cancelled).toBe(true);
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');

    mockProc.emit('close', 0);
    await resultPromise;
  });

  it('cancel returns false for an unknown agent id', () => {
    const cancelled = executor.cancel('unknown-agent');
    expect(cancelled).toBe(false);
  });
});
