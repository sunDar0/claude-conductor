/**
 * 프로세스 관리 관련 타입
 */

export type ProcessStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface ManagedProcess {
  task_id: string;
  pid: number;
  command: string;
  args: string[];
  cwd: string;
  port: number;
  status: ProcessStatus;
  started_at: string;
  stopped_at: string | null;
  exit_code: number | null;
  logs: string[];
}

export interface ProcessStartInput {
  task_id: string;
  command: string;
  args?: string[];
  cwd?: string;
  port?: number;
  env?: Record<string, string>;
}

export interface HealthCheckResult {
  task_id: string;
  healthy: boolean;
  status_code?: number;
  response_time_ms?: number;
  error?: string;
  checked_at: string;
}

export interface ServerStartInput {
  task_id: string;
  port?: number;
}

export interface ServerStopInput {
  task_id: string;
  force?: boolean;
}
