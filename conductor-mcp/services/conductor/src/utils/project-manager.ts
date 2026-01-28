import { Redis } from 'ioredis';

export interface Project {
  id: string;
  name: string;
  path: string;           // Host path (for display)
  containerPath: string;  // Container path (for operations)
  description?: string;
  created_at: string;
}

const PROJECTS_KEY = 'conductor:projects';

// Running locally - no path conversion needed
// Path conversion was only needed for Docker environment

/**
 * Convert host path to container path (no-op in local mode)
 */
export function toContainerPath(hostPath: string): string {
  return hostPath;
}

/**
 * Convert container path to host path (no-op in local mode)
 */
export function toHostPath(containerPath: string): string {
  return containerPath;
}

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = new Redis(redisUrl);
  }
  return redis;
}

export async function getProjects(): Promise<Project[]> {
  try {
    const data = await getRedis().get(PROJECTS_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch (error) {
    console.error('[ProjectManager] Failed to get projects:', error);
    return [];
  }
}

export async function addProject(project: Omit<Project, 'id' | 'created_at' | 'containerPath'>): Promise<Project> {
  const projects = await getProjects();

  // Check for duplicate path
  if (projects.some(p => p.path === project.path)) {
    throw new Error(`Project with path "${project.path}" already exists`);
  }

  const newProject: Project = {
    id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: project.name,
    path: project.path,
    containerPath: toContainerPath(project.path),
    description: project.description,
    created_at: new Date().toISOString(),
  };

  projects.push(newProject);
  await getRedis().set(PROJECTS_KEY, JSON.stringify(projects));

  return newProject;
}

export async function removeProject(projectId: string): Promise<boolean> {
  const projects = await getProjects();
  const index = projects.findIndex(p => p.id === projectId);

  if (index === -1) return false;

  projects.splice(index, 1);
  await getRedis().set(PROJECTS_KEY, JSON.stringify(projects));

  return true;
}

export async function updateProject(projectId: string, updates: Partial<Omit<Project, 'id' | 'created_at' | 'containerPath'>>): Promise<Project | null> {
  const projects = await getProjects();
  const index = projects.findIndex(p => p.id === projectId);

  if (index === -1) return null;

  // If path is being updated, also update containerPath
  const updatedProject: Project = {
    ...projects[index],
    ...updates,
  };

  if (updates.path) {
    updatedProject.containerPath = toContainerPath(updates.path);
  }

  projects[index] = updatedProject;

  await getRedis().set(PROJECTS_KEY, JSON.stringify(projects));
  return projects[index];
}

export async function getProjectById(projectId: string): Promise<Project | null> {
  const projects = await getProjects();
  return projects.find(p => p.id === projectId) || null;
}
