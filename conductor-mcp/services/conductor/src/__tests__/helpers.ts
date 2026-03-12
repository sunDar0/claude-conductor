import type { Task, TaskRegistry } from '../types/task.types.js';

export function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK-001',
    project_id: 'PRJ-001',
    title: 'Test task',
    description: 'A test task',
    status: 'READY',
    priority: 'medium',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    started_at: null,
    completed_at: null,
    branch: null,
    context_file: '',
    changelog_versions: [],
    feedback_history: [],
    session_id: null,
    last_error: null,
    base_commit: null,
    hidden: false,
    ...overrides,
  };
}

export function createMockRegistry(tasks: Record<string, Task> = {}): TaskRegistry {
  return { version: '1.0.0', counter: Object.keys(tasks).length, tasks };
}

export function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => createMockLogger(),
  };
}
