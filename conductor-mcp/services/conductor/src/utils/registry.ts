import * as fs from 'fs/promises';
import * as path from 'path';
import type { TaskRegistry, ServerRegistry, ProjectRegistry } from '../types/index.js';
import { createLogger } from './logger.js';

const log = createLogger('registry');
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';

const SAFE_TASK_ID = /^[a-zA-Z0-9_\-]+$/;
function validateTaskId(taskId: string): void {
  if (!SAFE_TASK_ID.test(taskId)) throw new Error(`Invalid task ID: ${taskId}`);
}

// Async mutex for writeTaskRegistry
let writeLock: Promise<void> = Promise.resolve();

function getTaskRegistryPath(): string {
  return path.join(WORKSPACE_DIR, '.claude', 'tasks', 'registry.json');
}

function getServerRegistryPath(): string {
  return path.join(WORKSPACE_DIR, '.claude', 'servers', 'registry.json');
}

export function getTaskContextPath(taskId: string): string {
  validateTaskId(taskId);
  return path.join(WORKSPACE_DIR, '.claude', 'tasks', taskId, 'context.md');
}

export function getTaskPromptPath(taskId: string): string {
  validateTaskId(taskId);
  return path.join(WORKSPACE_DIR, '.claude', 'tasks', taskId, 'prompt.md');
}

export function getTaskDirPath(taskId: string): string {
  validateTaskId(taskId);
  return path.join(WORKSPACE_DIR, '.claude', 'tasks', taskId);
}

export async function readTaskRegistry(): Promise<TaskRegistry> {
  try {
    const content = await fs.readFile(getTaskRegistryPath(), 'utf-8');
    return JSON.parse(content) as TaskRegistry;
  } catch (err) {
    log.debug({ err }, 'readTaskRegistry: registry not found, returning default');
    return { version: '1.0.0', counter: 0, tasks: {} };
  }
}

export async function writeTaskRegistry(registry: TaskRegistry): Promise<void> {
  const prevLock = writeLock;
  let releaseLock: () => void;
  writeLock = new Promise(resolve => { releaseLock = resolve; });
  await prevLock;
  try {
    const registryPath = getTaskRegistryPath();
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
  } finally {
    releaseLock!();
  }
}

export async function readServerRegistry(): Promise<ServerRegistry> {
  try {
    const content = await fs.readFile(getServerRegistryPath(), 'utf-8');
    return JSON.parse(content) as ServerRegistry;
  } catch (err) {
    log.debug({ err }, 'readServerRegistry: registry not found, returning default');
    return { version: '1.0.0', servers: {} };
  }
}

export async function writeServerRegistry(registry: ServerRegistry): Promise<void> {
  const registryPath = getServerRegistryPath();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

// 프로젝트 레지스트리 함수
function getProjectRegistryPath(): string {
  return path.join(WORKSPACE_DIR, '.claude', 'projects', 'registry.json');
}

export async function readProjectRegistry(): Promise<ProjectRegistry> {
  try {
    const content = await fs.readFile(getProjectRegistryPath(), 'utf-8');
    return JSON.parse(content) as ProjectRegistry;
  } catch (err) {
    log.debug({ err }, 'readProjectRegistry: registry not found, returning default');
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
