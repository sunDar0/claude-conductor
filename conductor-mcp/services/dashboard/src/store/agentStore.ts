import { create } from 'zustand';
import { api } from '../lib/api';

export type AgentRole = 'code' | 'test' | 'review' | 'docs' | 'security' | 'performance';
export type AgentStatus = 'idle' | 'ready' | 'running' | 'completed' | 'error' | 'terminated';

export interface AgentInstance {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  task_id: string | null;
  skills_loaded: string[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface AgentRoleDefinition {
  role: string;
  name: string;
  description: string;
  skills: {
    required: string[];
    optional: string[];
  };
}

interface AgentState {
  agents: Record<string, AgentInstance>;
  roles: AgentRoleDefinition[];
  loading: boolean;
  error: string | null;

  fetchAgents: () => Promise<void>;
  fetchRoles: () => Promise<void>;
  updateAgent: (agent: AgentInstance) => void;
  removeAgent: (agentId: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: {},
  roles: [],
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true });
    try {
      const response = await api.get<{ success: boolean; agents: AgentInstance[] }>('/agents');
      const agentsMap: Record<string, AgentInstance> = {};
      if (response.agents) {
        response.agents.forEach((a) => {
          agentsMap[a.id] = a;
        });
      }
      set({ agents: agentsMap, loading: false, error: null });
    } catch {
      set({ error: 'Failed to fetch agents', loading: false });
    }
  },

  fetchRoles: async () => {
    try {
      const response = await api.get<{ success: boolean; roles: AgentRoleDefinition[] }>('/agents/roles');
      if (response.roles) {
        set({ roles: response.roles });
      }
    } catch {
      // Silently fail if roles API not available
    }
  },

  updateAgent: (agent) => {
    set((state) => ({
      agents: { ...state.agents, [agent.id]: agent },
    }));
  },

  removeAgent: (agentId) => {
    set((state) => {
      const { [agentId]: _, ...rest } = state.agents;
      return { agents: rest };
    });
  },
}));
