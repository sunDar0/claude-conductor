import * as fs from 'fs/promises';
import * as path from 'path';
import type { TaskRegistry, ServerRegistry, ProjectRegistry } from '../types/index.js';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';

export function getTaskRegistryPath(): string {
  return path.join(WORKSPACE_DIR, '.claude', 'tasks', 'registry.json');
}

export function getServerRegistryPath(): string {
  return path.join(WORKSPACE_DIR, '.claude', 'servers', 'registry.json');
}

export function getTaskContextPath(taskId: string): string {
  return path.join(WORKSPACE_DIR, '.claude', 'tasks', taskId, 'context.md');
}

export function getTaskDirPath(taskId: string): string {
  return path.join(WORKSPACE_DIR, '.claude', 'tasks', taskId);
}

export async function readTaskRegistry(): Promise<TaskRegistry> {
  try {
    const content = await fs.readFile(getTaskRegistryPath(), 'utf-8');
    return JSON.parse(content) as TaskRegistry;
  } catch {
    return { version: '1.0.0', counter: 0, tasks: {} };
  }
}

export async function writeTaskRegistry(registry: TaskRegistry): Promise<void> {
  const registryPath = getTaskRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

export async function readServerRegistry(): Promise<ServerRegistry> {
  try {
    const content = await fs.readFile(getServerRegistryPath(), 'utf-8');
    return JSON.parse(content) as ServerRegistry;
  } catch {
    return { version: '1.0.0', servers: {} };
  }
}

export async function writeServerRegistry(registry: ServerRegistry): Promise<void> {
  const registryPath = getServerRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

// 프로젝트 레지스트리 함수
export function getProjectRegistryPath(): string {
  return path.join(WORKSPACE_DIR, '.claude', 'projects', 'registry.json');
}

export async function readProjectRegistry(): Promise<ProjectRegistry> {
  try {
    const content = await fs.readFile(getProjectRegistryPath(), 'utf-8');
    return JSON.parse(content) as ProjectRegistry;
  } catch {
    return { version: '1.0.0', counter: 0, current_project_id: null, projects: {} };
  }
}

export async function writeProjectRegistry(registry: ProjectRegistry): Promise<void> {
  const registryPath = getProjectRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

export async function getCurrentProjectId(): Promise<string | null> {
  const registry = await readProjectRegistry();
  return registry.current_project_id;
}
