import { vi, describe, it, expect } from 'vitest';

vi.mock('../../utils/registry.js');
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  autoPipelineLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../utils/git.js');
vi.mock('../../utils/project-manager.js');
vi.mock('../../utils/stream-parser.js');
vi.mock('simple-git');
vi.mock('ioredis');
vi.mock('../../http-server.js', () => ({
  addPipelineAgent: vi.fn(),
  updatePipelineAgent: vi.fn(),
  removePipelineAgent: vi.fn(),
}));
vi.mock('../../server.js', () => ({
  getAgentRegistry: vi.fn(),
}));
vi.mock('./review.handler.js', () => ({
  runCodeReview: vi.fn(),
  runSecurityReview: vi.fn(),
}));
vi.mock('../../orchestration/parallel-engine.js', () => ({
  ParallelEngine: vi.fn(),
}));
vi.mock('../../orchestration/agent-executor.js', () => ({
  AgentExecutor: vi.fn(),
}));
vi.mock('../../orchestration/agent-manager.js', () => ({
  AgentManager: vi.fn(),
}));
vi.mock('../../utils/activity.js', () => ({
  createActivity: vi.fn(),
}));
vi.mock('../../utils/date.js', () => ({
  nowISO: vi.fn(() => '2026-03-12T00:00:00.000Z'),
}));
vi.mock('child_process');

import { formatGitChanges, shouldUseOrchestration, GitChangeInfo } from '../auto-pipeline.js';
import { createMockTask } from '../../__tests__/helpers.js';

describe('formatGitChanges', () => {
  it('returns empty string when files array is empty', () => {
    const changes: GitChangeInfo = {
      baseCommit: 'abc123',
      files: [],
      diff: '',
    };
    expect(formatGitChanges(changes)).toBe('');
  });

  it('returns markdown table with +N -N for files with additions and deletions', () => {
    const changes: GitChangeInfo = {
      baseCommit: 'abc123',
      files: [
        { path: 'src/foo.ts', status: 'M', additions: 10, deletions: 3 },
        { path: 'src/bar.ts', status: 'A', additions: 5, deletions: 0 },
      ],
      diff: '',
    };
    const result = formatGitChanges(changes);
    expect(result).toContain('src/foo.ts');
    expect(result).toContain('+10 -3');
    expect(result).toContain('src/bar.ts');
    expect(result).toContain('+5 -0');
    expect(result).toContain('|');
  });

  it('includes fenced diff block when diff content is present', () => {
    const changes: GitChangeInfo = {
      baseCommit: 'abc123',
      files: [{ path: 'src/foo.ts', status: 'M', additions: 2, deletions: 1 }],
      diff: 'diff --git a/src/foo.ts b/src/foo.ts\n+added line',
    };
    const result = formatGitChanges(changes);
    expect(result).toContain('```');
    expect(result).toContain('diff --git');
    expect(result).toContain('+added line');
  });
});

describe('shouldUseOrchestration', () => {
  it('returns true when engine exists and task has no session_id or unresolved feedback', () => {
    const task = createMockTask({
      session_id: null,
      feedback_history: [],
    });
    const mockEngine = { run: vi.fn() };
    expect(shouldUseOrchestration(task, mockEngine)).toBe(true);
  });

  it('returns false when task has a session_id (resume mode)', () => {
    const task = createMockTask({
      session_id: 'existing-session',
      feedback_history: [],
    });
    const mockEngine = { run: vi.fn() };
    expect(shouldUseOrchestration(task, mockEngine)).toBe(false);
  });

  it('returns false when task has unresolved feedback', () => {
    const task = createMockTask({
      session_id: null,
      feedback_history: [{ resolved: false, comment: 'needs fix', created_at: '2026-01-01T00:00:00Z' }],
    });
    const mockEngine = { run: vi.fn() };
    expect(shouldUseOrchestration(task, mockEngine)).toBe(false);
  });

  it('returns false when engine is undefined', () => {
    const task = createMockTask({
      session_id: null,
      feedback_history: [],
    });
    expect(shouldUseOrchestration(task, undefined)).toBe(false);
  });
});
