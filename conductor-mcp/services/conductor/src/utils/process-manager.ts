import { spawn, ChildProcess } from 'child_process';
import treeKill from 'tree-kill';
import detectPort from 'detect-port';
import type { ManagedProcess, HealthCheckResult } from '../types/index.js';
import { nowISO } from './date.js';

const MAX_LOG_LINES = 500;
const processes = new Map<string, ManagedProcess & { proc: ChildProcess }>();

/**
 * 사용 가능한 포트 찾기
 */
export async function findPort(preferred: number): Promise<number> {
  return detectPort(preferred);
}

/**
 * 프로세스 시작
 */
export async function startProcess(
  taskId: string,
  command: string,
  args: string[] = [],
  options: { cwd?: string; port?: number; env?: Record<string, string> } = {}
): Promise<ManagedProcess> {
  // 이미 실행 중인지 확인
  const existing = processes.get(taskId);
  if (existing && (existing.status === 'running' || existing.status === 'starting')) {
    throw new Error(`이미 실행 중: ${taskId}`);
  }

  const cwd = options.cwd || process.env.WORKSPACE_DIR || '/workspace';
  const port = options.port ? await findPort(options.port) : 0;

  const env = {
    ...process.env,
    ...options.env,
    PORT: String(port),
  };

  const proc = spawn(command, args, {
    cwd,
    env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const managed: ManagedProcess & { proc: ChildProcess } = {
    task_id: taskId,
    pid: proc.pid!,
    command,
    args,
    cwd,
    port,
    status: 'starting',
    started_at: nowISO(),
    stopped_at: null,
    exit_code: null,
    logs: [],
    proc,
  };

  // stdout 수집
  proc.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    managed.logs.push(...lines);
    if (managed.logs.length > MAX_LOG_LINES) {
      managed.logs = managed.logs.slice(-MAX_LOG_LINES);
    }

    // 시작 완료 감지
    if (managed.status === 'starting') {
      const text = data.toString().toLowerCase();
      if (text.includes('listening') || text.includes('ready') || text.includes('started')) {
        managed.status = 'running';
      }
    }
  });

  // stderr 수집
  proc.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    managed.logs.push(...lines.map(l => `[ERR] ${l}`));
    if (managed.logs.length > MAX_LOG_LINES) {
      managed.logs = managed.logs.slice(-MAX_LOG_LINES);
    }
  });

  // 종료 처리
  proc.on('exit', (code) => {
    managed.status = code === 0 ? 'stopped' : 'error';
    managed.stopped_at = nowISO();
    managed.exit_code = code;
  });

  proc.on('error', (err) => {
    managed.status = 'error';
    managed.logs.push(`[SYS] Error: ${err.message}`);
  });

  processes.set(taskId, managed);

  // 시작 대기 (최대 10초)
  await waitForRunning(taskId, 10000);

  return getProcessInfo(taskId)!;
}

/**
 * running 상태 대기
 */
async function waitForRunning(taskId: string, timeout: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const p = processes.get(taskId);
    if (!p) return;
    if (p.status === 'running' || p.status === 'error' || p.status === 'stopped') return;
    await new Promise(r => setTimeout(r, 200));
  }
  // 타임아웃 후에도 starting이면 running으로 간주
  const p = processes.get(taskId);
  if (p && p.status === 'starting') {
    p.status = 'running';
  }
}

/**
 * 프로세스 종료
 */
export async function stopProcess(taskId: string, force = false): Promise<void> {
  const managed = processes.get(taskId);
  if (!managed) {
    throw new Error(`프로세스 없음: ${taskId}`);
  }

  if (managed.status === 'stopped' || managed.status === 'error') {
    return;
  }

  managed.status = 'stopping';
  const signal = force ? 'SIGKILL' : 'SIGTERM';

  return new Promise((resolve, reject) => {
    treeKill(managed.pid, signal, (err) => {
      if (err) {
        managed.status = 'error';
        reject(err);
      } else {
        managed.status = 'stopped';
        managed.stopped_at = nowISO();
        resolve();
      }
    });

    // 5초 후 강제 종료
    setTimeout(() => {
      if (managed.status === 'stopping') {
        treeKill(managed.pid, 'SIGKILL');
      }
    }, 5000);
  });
}

/**
 * 프로세스 정보 조회 (ChildProcess 제외)
 */
export function getProcessInfo(taskId: string): ManagedProcess | null {
  const p = processes.get(taskId);
  if (!p) return null;

  const { proc, ...info } = p;
  return info;
}

/**
 * 모든 프로세스 목록
 */
export function getAllProcesses(): ManagedProcess[] {
  return Array.from(processes.values()).map(({ proc, ...info }) => info);
}

/**
 * 로그 조회
 */
export function getProcessLogs(taskId: string, lines = 50): string[] {
  const p = processes.get(taskId);
  if (!p) return [];
  return p.logs.slice(-lines);
}

/**
 * 헬스 체크
 */
export async function checkHealth(taskId: string): Promise<HealthCheckResult> {
  const p = processes.get(taskId);

  if (!p) {
    return {
      task_id: taskId,
      healthy: false,
      error: '프로세스 없음',
      checked_at: nowISO(),
    };
  }

  if (p.status !== 'running' || p.port === 0) {
    return {
      task_id: taskId,
      healthy: p.status === 'running',
      error: p.status !== 'running' ? `상태: ${p.status}` : undefined,
      checked_at: nowISO(),
    };
  }

  const start = Date.now();

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);

    // /health 먼저 시도
    let response = await fetch(`http://localhost:${p.port}/health`, {
      signal: controller.signal,
    }).catch(() => null);

    // 실패하면 / 시도
    if (!response || !response.ok) {
      response = await fetch(`http://localhost:${p.port}/`, {
        signal: controller.signal,
      });
    }

    return {
      task_id: taskId,
      healthy: response.ok,
      status_code: response.status,
      response_time_ms: Date.now() - start,
      checked_at: nowISO(),
    };
  } catch (err) {
    return {
      task_id: taskId,
      healthy: false,
      response_time_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      checked_at: nowISO(),
    };
  }
}

/**
 * 모든 프로세스 정리
 */
export async function cleanupAll(): Promise<void> {
  const tasks = Array.from(processes.keys());
  await Promise.all(tasks.map(t => stopProcess(t, true).catch(() => {})));
  processes.clear();
}

// 종료 시 정리
process.on('SIGINT', cleanupAll);
process.on('SIGTERM', cleanupAll);
