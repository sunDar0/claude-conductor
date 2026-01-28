import { create } from 'zustand';
import type { RunningServer } from '../types';
import { api } from '../lib/api';

interface ServerState {
  servers: Record<string, RunningServer>;
  logs: Record<string, string[]>;
  selectedId: string | null;
  loading: boolean;

  fetchServers: () => Promise<void>;
  updateServer: (server: RunningServer) => void;
  removeServer: (taskId: string) => void;
  fetchLogs: (taskId: string) => Promise<void>;
  appendLog: (taskId: string, line: string) => void;
  selectServer: (taskId: string | null) => void;
}

export const useServerStore = create<ServerState>((set) => ({
  servers: {},
  logs: {},
  selectedId: null,
  loading: false,

  fetchServers: async () => {
    set({ loading: true });
    try {
      const response = await api.get<{ success: boolean; data: Record<string, RunningServer> }>('/servers');
      set({ servers: response.data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  updateServer: (server) => {
    set((s) => ({ servers: { ...s.servers, [server.task_id]: server } }));
  },

  removeServer: (taskId) => {
    set((s) => {
      const { [taskId]: _, ...rest } = s.servers;
      return { servers: rest };
    });
  },

  fetchLogs: async (taskId) => {
    try {
      const response = await api.get<{ success: boolean; logs: string[] }>(`/servers/${taskId}/logs`);
      set((s) => ({ logs: { ...s.logs, [taskId]: response.logs } }));
    } catch {
      // ignore
    }
  },

  appendLog: (taskId, line) => {
    set((s) => {
      const existing = s.logs[taskId] || [];
      return { logs: { ...s.logs, [taskId]: [...existing, line].slice(-500) } };
    });
  },

  selectServer: (taskId) => set({ selectedId: taskId }),
}));
