export type TaskStatus = 'BACKLOG' | 'READY' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type ServerStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  branch: string | null;
  context_file: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  changelog_versions: number[];
  feedback_history: Feedback[];
}

export interface Feedback {
  id: string;
  content: string;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
}

export interface RunningServer {
  task_id: string;
  type: string;
  port: number;
  pid: number | null;
  status: ServerStatus;
  started_at: string;
  url: string;
  api_docs?: { swagger?: string; redoc?: string; openapi_json?: string };
}

export interface Activity {
  id: string;
  type: string;
  task_id: string;
  message: string;
  timestamp: string;
}

export interface WSMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}
