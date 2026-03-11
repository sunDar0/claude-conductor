import { create } from 'zustand';
import type { Task, TaskStatus } from '../types';
import { api } from '../lib/api';

interface TaskState {
  tasks: Record<string, Task>;
  loading: boolean;
  error: string | null;
  currentProjectId: string | null;
  // Real-time pipeline output
  pipelineOutput: Record<string, string[]>; // taskId -> output lines

  fetchTasks: (projectId?: string) => Promise<void>;
  setProjectFilter: (projectId: string | null) => void;
  updateTask: (task: Task) => void;
  moveTask: (taskId: string, newStatus: TaskStatus) => Promise<void>;
  appendPipelineOutput: (taskId: string, output: string) => void;
  clearPipelineOutput: (taskId: string) => void;
  hideTask: (taskId: string) => Promise<void>;
  unhideTask: (taskId: string) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: {},
  loading: false,
  error: null,
  currentProjectId: null,
  pipelineOutput: {},

  fetchTasks: async (projectId?: string) => {
    const pid = projectId ?? get().currentProjectId;
    set({ loading: true });
    try {
      const params = pid ? { project_id: pid } : undefined;
      const response = await api.get<{ success: boolean; data: Record<string, Task> }>('/tasks', params);
      set({ tasks: response.data, loading: false, error: null });
    } catch (err) {
      set({ error: 'Failed to fetch tasks', loading: false });
    }
  },

  setProjectFilter: (projectId) => {
    set({ currentProjectId: projectId });
    // Auto-fetch tasks when project changes
    get().fetchTasks(projectId ?? undefined);
  },

  updateTask: (task) => {
    set((state) => ({
      tasks: { ...state.tasks, [task.id]: task },
    }));
  },

  moveTask: async (taskId, newStatus) => {
    const task = get().tasks[taskId];
    if (!task) return;

    // Optimistic update
    const prevStatus = task.status;
    set((s) => ({
      tasks: { ...s.tasks, [taskId]: { ...task, status: newStatus } },
    }));

    try {
      await api.post(`/tasks/${taskId}/transition`, { target_state: newStatus });
    } catch {
      // Rollback
      set((s) => ({
        tasks: { ...s.tasks, [taskId]: { ...task, status: prevStatus } },
      }));
    }
  },

  appendPipelineOutput: (taskId, output) => {
    set((state) => {
      const existing = state.pipelineOutput[taskId] || [];
      // Split by newlines and filter empty lines
      const newLines = output.split('\n').filter(line => line.trim());
      return {
        pipelineOutput: {
          ...state.pipelineOutput,
          [taskId]: [...existing, ...newLines].slice(-100), // Keep last 100 lines
        },
      };
    });
  },

  clearPipelineOutput: (taskId) => {
    set((state) => {
      const { [taskId]: _, ...rest } = state.pipelineOutput;
      return { pipelineOutput: rest };
    });
  },

  hideTask: async (taskId) => {
    const task = get().tasks[taskId];
    if (!task) return;

    // Optimistic update
    set((s) => ({
      tasks: { ...s.tasks, [taskId]: { ...task, hidden: true } },
    }));

    try {
      await api.patch(`/tasks/${taskId}/hidden`, { hidden: true });
    } catch {
      // Rollback on error
      set((s) => ({
        tasks: { ...s.tasks, [taskId]: { ...task, hidden: false } },
      }));
    }
  },

  unhideTask: async (taskId) => {
    const task = get().tasks[taskId];
    if (!task) return;

    // Optimistic update
    set((s) => ({
      tasks: { ...s.tasks, [taskId]: { ...task, hidden: false } },
    }));

    try {
      await api.patch(`/tasks/${taskId}/hidden`, { hidden: false });
    } catch {
      // Rollback on error
      set((s) => ({
        tasks: { ...s.tasks, [taskId]: { ...task, hidden: true } },
      }));
    }
  },
}));
