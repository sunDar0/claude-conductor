import { create } from 'zustand';
import { api } from '../lib/api';

export interface Project {
  id: string;
  name: string;
  path: string;           // Host path (for display)
  containerPath?: string; // Container path (for operations)
  description?: string;
  isValid?: boolean;      // Whether the path is accessible
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
}

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  loading: boolean;
  error: string | null;
  projectValidity: Record<string, boolean>;

  fetchProjects: () => Promise<void>;
  setCurrentProject: (project: Project) => void;
  addProject: (project: Omit<Project, 'id'>) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  validateProject: (projectId: string) => Promise<boolean>;
  validateAllProjects: () => Promise<void>;
  getProjectFiles: (projectId: string, subPath?: string) => Promise<FileEntry[]>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  loading: false,
  error: null,
  projectValidity: {},

  fetchProjects: async () => {
    set({ loading: true });
    try {
      const response = await api.get<{ success: boolean; data: Project[] }>('/projects');
      const projects = response.data || [];
      set({ projects, loading: false, error: null });

      // Auto-select first project if none selected
      if (projects.length > 0 && !get().currentProject) {
        set({ currentProject: projects[0] });
      }

      // Validate all projects in background
      get().validateAllProjects();
    } catch {
      // If projects API doesn't exist, create a default project
      const defaultProject: Project = {
        id: 'default',
        name: 'Current Workspace',
        path: '/workspaces',
        containerPath: '/workspaces',
      };
      set({ projects: [defaultProject], currentProject: defaultProject, loading: false });
    }
  },

  setCurrentProject: (project) => {
    set({ currentProject: project });
  },

  addProject: async (project) => {
    try {
      const response = await api.post<{ success: boolean; data: Project }>('/projects', project);
      const newProject = response.data;
      set((state) => ({ projects: [...state.projects, newProject] }));
      // Validate the new project
      get().validateProject(newProject.id);
    } catch {
      set({ error: 'Failed to add project' });
    }
  },

  deleteProject: async (projectId: string) => {
    try {
      await api.delete(`/projects/${projectId}`);
      set((state) => {
        const projects = state.projects.filter((p) => p.id !== projectId);
        const currentProject = state.currentProject?.id === projectId ? null : state.currentProject;
        const { [projectId]: _, ...projectValidity } = state.projectValidity;
        return { projects, currentProject, projectValidity };
      });
    } catch {
      set({ error: 'Failed to delete project' });
    }
  },

  validateProject: async (projectId: string) => {
    try {
      const response = await api.get<{ success: boolean; valid: boolean }>(`/projects/${projectId}/validate`);
      set((state) => ({
        projectValidity: { ...state.projectValidity, [projectId]: response.valid },
      }));
      return response.valid;
    } catch {
      set((state) => ({
        projectValidity: { ...state.projectValidity, [projectId]: false },
      }));
      return false;
    }
  },

  validateAllProjects: async () => {
    const projects = get().projects;
    await Promise.all(projects.map((p) => get().validateProject(p.id)));
  },

  getProjectFiles: async (projectId: string, subPath?: string) => {
    try {
      const response = await api.get<{ success: boolean; files: FileEntry[] }>(
        `/projects/${projectId}/files`,
        subPath ? { path: subPath } : undefined
      );
      return response.files || [];
    } catch {
      return [];
    }
  },
}));
