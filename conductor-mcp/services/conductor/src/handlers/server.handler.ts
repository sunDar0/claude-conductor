import open from 'open';
import type { ServerStartInput, ServerStopInput } from '../types/index.js';
import { readTaskRegistry, readServerRegistry, writeServerRegistry } from '../utils/registry.js';
import { detectProject } from '../detectors/index.js';
import {
  startProcess,
  stopProcess,
  getProcessInfo,
  getAllProcesses,
  getProcessLogs,
  checkHealth,
  findPort,
} from '../utils/process-manager.js';
import { nowISO } from '../utils/date.js';

type EventPublisher = (event: string, data: unknown) => Promise<void>;
const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace';

/**
 * 서버 시작
 */
export async function handleServerStart(
  input: ServerStartInput,
  publish: EventPublisher
) {
  const taskRegistry = await readTaskRegistry();
  const task = taskRegistry.tasks[input.task_id];

  if (!task) {
    return {
      content: [{ type: 'text', text: `Task not found: ${input.task_id}` }],
      isError: true,
    };
  }

  const detection = await detectProject(WORKSPACE);
  if (!detection.detected || !detection.config) {
    return {
      content: [{ type: 'text', text: 'Could not detect project type.' }],
      isError: true,
    };
  }

  const config = detection.config;
  const port = await findPort(input.port || config.port);

  try {
    const [cmd, ...args] = config.command.split(' ');
    const managed = await startProcess(input.task_id, cmd, args, {
      cwd: WORKSPACE,
      port,
      env: config.env,
    });

    // 레지스트리 업데이트
    const serverRegistry = await readServerRegistry();
    serverRegistry.servers[input.task_id] = {
      task_id: input.task_id,
      type: config.type,
      port,
      pid: managed.pid,
      status: managed.status === 'running' ? 'running' : 'starting',
      started_at: managed.started_at,
      url: `http://localhost:${port}`,
      api_docs: config.apiDocs,
    };
    await writeServerRegistry(serverRegistry);

    await publish('server.started', { task_id: input.task_id, port, pid: managed.pid });

    let response = `Server Started

| Field | Value |
|-------|-------|
| Task | ${input.task_id} |
| Type | ${config.type} |
| PID | ${managed.pid} |
| Port | ${port} |
| Status | ${managed.status} |
| URL | http://localhost:${port} |`;

    if (config.apiDocs) {
      response += '\n\n**API Docs**:';
      if (config.apiDocs.swagger) {
        response += `\n- Swagger: http://localhost:${port}${config.apiDocs.swagger}`;
      }
      if (config.apiDocs.redoc) {
        response += `\n- Redoc: http://localhost:${port}${config.apiDocs.redoc}`;
      }
    }

    return { content: [{ type: 'text', text: response }] };

  } catch (error) {
    return {
      content: [{ type: 'text', text: `Server start failed: ${error instanceof Error ? error.message : error}` }],
      isError: true,
    };
  }
}

/**
 * 서버 종료
 */
export async function handleServerStop(
  input: ServerStopInput,
  publish: EventPublisher
) {
  try {
    await stopProcess(input.task_id, input.force);

    const serverRegistry = await readServerRegistry();
    if (serverRegistry.servers[input.task_id]) {
      serverRegistry.servers[input.task_id].status = 'stopped';
    }
    await writeServerRegistry(serverRegistry);

    await publish('server.stopped', { task_id: input.task_id });

    return {
      content: [{ type: 'text', text: `Server stopped: ${input.task_id}` }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Stop failed: ${error instanceof Error ? error.message : error}` }],
      isError: true,
    };
  }
}

/**
 * 서버 상태 목록
 */
export async function handleServerStatus() {
  const processes = getAllProcesses();

  if (processes.length === 0) {
    return { content: [{ type: 'text', text: 'No running servers.' }] };
  }

  let response = '**Running Servers**\n\n';
  response += '| Task | PID | Port | Status | URL |\n';
  response += '|------|-----|------|--------|-----|\n';

  for (const p of processes) {
    const statusIcon = p.status === 'running' ? 'OK' : p.status === 'starting' ? '...' : 'ERR';
    response += `| ${p.task_id} | ${p.pid} | ${p.port} | ${statusIcon} ${p.status} | http://localhost:${p.port} |\n`;
  }

  return { content: [{ type: 'text', text: response }] };
}

/**
 * 서버 로그
 */
export async function handleServerLogs(input: { task_id: string; lines?: number }) {
  const logs = getProcessLogs(input.task_id, input.lines || 50);

  if (logs.length === 0) {
    return { content: [{ type: 'text', text: `No logs for ${input.task_id}` }] };
  }

  return {
    content: [{ type: 'text', text: `**Server Logs: ${input.task_id}**\n\n\`\`\`\n${logs.join('\n')}\n\`\`\`` }],
  };
}

/**
 * 헬스 체크
 */
export async function handleServerHealth(input: { task_id: string }) {
  const result = await checkHealth(input.task_id);

  const status = result.healthy ? 'Healthy' : 'Unhealthy';
  let response = `**Health Check: ${input.task_id}**\n\n`;
  response += `| Field | Value |\n|-------|-------|\n`;
  response += `| Status | ${status} |\n`;

  if (result.status_code) response += `| Response Code | ${result.status_code} |\n`;
  if (result.response_time_ms) response += `| Response Time | ${result.response_time_ms}ms |\n`;
  if (result.error) response += `| Error | ${result.error} |\n`;

  return { content: [{ type: 'text', text: response }] };
}

/**
 * 브라우저에서 열기
 */
export async function handleServerOpen(input: { task_id: string; path?: string }) {
  const proc = getProcessInfo(input.task_id);

  if (!proc || proc.status !== 'running') {
    return {
      content: [{ type: 'text', text: `No running server: ${input.task_id}` }],
      isError: true,
    };
  }

  const url = `http://localhost:${proc.port}${input.path || ''}`;
  await open(url);

  return { content: [{ type: 'text', text: `Opened in browser: ${url}` }] };
}

/**
 * API 문서 URL 조회
 */
export async function handleApiDocs(input: { task_id?: string }) {
  const serverRegistry = await readServerRegistry();

  if (input.task_id) {
    const server = serverRegistry.servers[input.task_id];
    if (!server) {
      return {
        content: [{ type: 'text', text: `Server not found: ${input.task_id}` }],
        isError: true,
      };
    }

    if (!server.api_docs) {
      return {
        content: [{ type: 'text', text: `${input.task_id}: No API docs configured.` }],
      };
    }

    let response = `**API Docs: ${input.task_id}**\n\n`;
    if (server.api_docs.swagger) {
      response += `- Swagger: ${server.url}${server.api_docs.swagger}\n`;
    }
    if (server.api_docs.redoc) {
      response += `- Redoc: ${server.url}${server.api_docs.redoc}\n`;
    }
    if (server.api_docs.openapi_json) {
      response += `- OpenAPI JSON: ${server.url}${server.api_docs.openapi_json}\n`;
    }

    return { content: [{ type: 'text', text: response }] };
  }

  // 전체 목록
  const servers = Object.values(serverRegistry.servers);
  if (servers.length === 0) {
    return { content: [{ type: 'text', text: 'No running servers.' }] };
  }

  let response = '**API Docs**\n\n';
  let hasAny = false;

  for (const s of servers) {
    if (s.api_docs) {
      hasAny = true;
      response += `### ${s.task_id} (${s.type})\n`;
      if (s.api_docs.swagger) response += `- Swagger: ${s.url}${s.api_docs.swagger}\n`;
      if (s.api_docs.redoc) response += `- Redoc: ${s.url}${s.api_docs.redoc}\n`;
      response += '\n';
    }
  }

  if (!hasAny) {
    response += '(No servers with API docs configured)';
  }

  return { content: [{ type: 'text', text: response }] };
}
