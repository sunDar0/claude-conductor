export type ServerStatus = 'running' | 'stopped' | 'error' | 'starting';
export type ServerType = 'nextjs' | 'vite' | 'express' | 'nestjs' | 'fastapi' | 'django' | 'flask' | 'spring' | 'go-gin' | 'unknown';

export interface ServerConfig {
  type: ServerType;
  port: number;
  command: string;
  healthCheck?: string;
  apiDocs?: { swagger?: string; redoc?: string; openapi_json?: string };
  env?: Record<string, string>;
}

export interface RunningServer {
  task_id: string;
  type: ServerType;
  port: number;
  pid: number | null;
  status: ServerStatus;
  started_at: string;
  url: string;
  api_docs?: { swagger?: string; redoc?: string; openapi_json?: string };
}

export interface ServerRegistry {
  version: string;
  servers: Record<string, RunningServer>;
}

export interface DetectionResult {
  detected: boolean;
  type: ServerType;
  config?: ServerConfig;
  confidence: number;
}
