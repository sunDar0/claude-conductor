import express, { Application, Request, Response, NextFunction } from 'express';
import { httpLogger as log } from './utils/logger.js';
import { readTaskRegistry, readServerRegistry, getTaskContextPath, getTaskPromptPath } from './utils/registry.js';
import {
  getProjects,
  addProject,
  removeProject,
  updateProject,
  getProjectById,
  toContainerPath,
} from './utils/project-manager.js';
import { promises as fs } from 'fs';
import path from 'path';
import {
  handleTaskCreate,
  handleTaskGet,
  handleTaskStart,
  handleTaskTransition,
} from './handlers/task.handler.js';
import { handleServerStart, handleServerStop } from './handlers/server.handler.js';
import { publishEvent } from './server.js';

const app: Application = express();
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// REST API for Projects
app.get('/api/projects', async (_req: Request, res: Response) => {
  try {
    const projects = await getProjects();
    res.json({ success: true, data: projects });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/projects', async (req: Request, res: Response) => {
  try {
    const { name, path, description } = req.body;
    if (!name || !path) {
      res.status(400).json({ success: false, error: 'name and path are required' });
      return;
    }
    const project = await addProject({ name, path, description });
    res.json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.put('/api/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const project = await updateProject(req.params.projectId, req.body);
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }
    res.json({ success: true, data: project });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.delete('/api/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const deleted = await removeProject(req.params.projectId);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Validate project path is accessible
app.get('/api/projects/:projectId/validate', async (req: Request, res: Response) => {
  try {
    const project = await getProjectById(req.params.projectId);
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    const containerPath = project.containerPath || toContainerPath(project.path);

    try {
      const stats = await fs.stat(containerPath);
      res.json({
        success: true,
        valid: stats.isDirectory(),
        containerPath,
      });
    } catch {
      res.json({
        success: true,
        valid: false,
        containerPath,
        error: 'Path not accessible',
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// List files in project directory
app.get('/api/projects/:projectId/files', async (req: Request, res: Response) => {
  try {
    const project = await getProjectById(req.params.projectId);
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }

    const containerPath = project.containerPath || toContainerPath(project.path);
    const subPath = req.query.path as string || '';
    const targetPath = path.join(containerPath, subPath);

    // Security: ensure path is within project
    if (!targetPath.startsWith(containerPath)) {
      res.status(400).json({ success: false, error: 'Invalid path' });
      return;
    }

    try {
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const files = entries
        .filter(e => !e.name.startsWith('.') || e.name === '.claude')
        .map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          path: path.join(subPath, e.name),
        }))
        .sort((a, b) => {
          // Directories first, then files
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      res.json({ success: true, files, currentPath: subPath });
    } catch {
      res.status(400).json({ success: false, error: 'Cannot read directory' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// REST API for Tasks
app.get('/api/tasks', async (req: Request, res: Response) => {
  try {
    const registry = await readTaskRegistry();
    const projectId = req.query.project_id as string | undefined;

    // Filter by project_id if provided
    let tasks = registry.tasks;
    if (projectId) {
      tasks = Object.fromEntries(
        Object.entries(registry.tasks).filter(([_, task]) => task.project_id === projectId)
      );
    }

    res.json({ success: true, data: tasks });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/tasks', async (req: Request, res: Response) => {
  try {
    const result = await handleTaskCreate(req.body, publishEvent);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/api/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const result = await handleTaskGet({ task_id: req.params.taskId });
    if ('isError' in result && result.isError) {
      res.status(404).json({ success: false, error: result.content[0] });
    } else {
      const registry = await readTaskRegistry();
      res.json({ success: true, data: registry.tasks[req.params.taskId] });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/tasks/:taskId/start', async (req: Request, res: Response) => {
  try {
    const result = await handleTaskStart({ task_id: req.params.taskId }, publishEvent);
    if ('isError' in result && result.isError) {
      res.status(400).json({ success: false, error: result.content[0] });
    } else {
      res.json({ success: true, data: result });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/tasks/:taskId/transition', async (req: Request, res: Response) => {
  try {
    const result = await handleTaskTransition(
      { task_id: req.params.taskId, ...req.body },
      publishEvent
    );
    if ('isError' in result && result.isError) {
      res.status(400).json({ success: false, error: result.content[0] });
    } else {
      res.json({ success: true, data: result });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Manual pipeline trigger for existing READY tasks
app.post('/api/tasks/:taskId/run', async (req: Request, res: Response) => {
  try {
    const { triggerPipeline } = await import('./handlers/auto-pipeline.js');
    const result = await triggerPipeline(req.params.taskId);
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Get task context/output file
app.get('/api/tasks/:taskId/context', async (req: Request, res: Response) => {
  try {
    const contextPath = getTaskContextPath(req.params.taskId);
    const content = await fs.readFile(contextPath, 'utf-8');
    res.json({ success: true, content });
  } catch {
    res.json({ success: true, content: '(No context file found)' });
  }
});

// Get task prompt history
app.get('/api/tasks/:taskId/prompt', async (req: Request, res: Response) => {
  try {
    const promptPath = getTaskPromptPath(req.params.taskId);
    const content = await fs.readFile(promptPath, 'utf-8');
    res.json({ success: true, content });
  } catch {
    res.json({ success: true, content: null });
  }
});

// REST API for Servers
app.get('/api/servers', async (_req: Request, res: Response) => {
  try {
    const registry = await readServerRegistry();
    res.json({ success: true, data: registry.servers });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/servers/:taskId/start', async (req: Request, res: Response) => {
  try {
    const result = await handleServerStart(
      { task_id: req.params.taskId, ...req.body },
      publishEvent
    );
    if ('isError' in result && result.isError) {
      res.status(400).json({ success: false, error: result.content[0] });
    } else {
      res.json({ success: true, data: result });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/servers/:taskId/stop', async (req: Request, res: Response) => {
  try {
    const result = await handleServerStop({ task_id: req.params.taskId }, publishEvent);
    if ('isError' in result && result.isError) {
      res.status(400).json({ success: false, error: result.content[0] });
    } else {
      res.json({ success: true, data: result });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// REST API for Workers (Phase 5)
// Agent state is managed by the MCP server, so these endpoints return cached data
let agentCache: unknown[] = [];
let agentRolesCache: unknown[] = [];
// Workers (CLI processes executing tasks)
const pipelineAgents: Map<string, unknown> = new Map();

export function updateAgentCache(agents: unknown[]): void {
  agentCache = agents;
}

export function updateAgentRolesCache(roles: unknown[]): void {
  agentRolesCache = roles;
}

// Add worker when auto-pipeline starts
export function addPipelineAgent(taskId: string, taskTitle: string): void {
  const worker = {
    id: `worker-${taskId}`,
    role: 'code',
    status: 'running',
    task_id: taskId,
    skills_loaded: ['Claude CLI'],
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    completed_at: null,
    error: null,
    _isWorker: true,
    _taskTitle: taskTitle,
  };
  pipelineAgents.set(taskId, worker);
  log.info({ taskId }, 'Worker added');
}

// Update worker status
export function updatePipelineAgent(taskId: string, status: string, error?: string): void {
  const worker = pipelineAgents.get(taskId) as Record<string, unknown> | undefined;
  if (worker) {
    worker.status = status;
    if (status === 'completed' || status === 'error') {
      worker.completed_at = new Date().toISOString();
    }
    if (error) {
      worker.error = error;
    }
    log.info({ taskId, status }, 'Worker updated');
  }
}

// Remove worker
export function removePipelineAgent(taskId: string): void {
  pipelineAgents.delete(taskId);
  log.info({ taskId }, 'Worker removed');
}

app.get('/api/agents', (_req: Request, res: Response) => {
  // Combine real agents with pipeline agents
  const allAgents = [...agentCache, ...Array.from(pipelineAgents.values())];
  res.json({ success: true, agents: allAgents });
});

app.get('/api/agents/roles', (_req: Request, res: Response) => {
  res.json({ success: true, roles: agentRolesCache });
});

// Filesystem browser API for directory selection
app.get('/api/filesystem/browse', async (req: Request, res: Response) => {
  try {
    const requestedPath = (req.query.path as string) || process.env.HOME || '/';

    // Resolve to absolute path
    const targetPath = path.resolve(requestedPath);

    try {
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        res.status(400).json({ success: false, error: 'Path is not a directory' });
        return;
      }

      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const directories = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => ({
          name: e.name,
          path: path.join(targetPath, e.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      // Get parent directory
      const parentPath = path.dirname(targetPath);
      const hasParent = parentPath !== targetPath;

      res.json({
        success: true,
        currentPath: targetPath,
        parentPath: hasParent ? parentPath : null,
        directories,
      });
    } catch {
      res.status(400).json({ success: false, error: 'Cannot access directory' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log.error({ error: err }, 'Server error');
  res.status(500).json({ success: false, error: err.message });
});

export function startHttpServer(port: number): void {
  app.listen(port, () => {
    log.info({ port }, 'Server listening');
  });
}

export { app };
