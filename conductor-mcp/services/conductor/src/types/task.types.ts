// Corrected 6-state machine with BACKLOG
export type TaskStatus = 'BACKLOG' | 'READY' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CLOSED';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Feedback {
  id: string;
  content: string;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
}

export interface Task {
  id: string;
  project_id: string;              // 프로젝트 ID (멀티 프로젝트 지원)
  project_path?: string;           // 프로젝트 경로 (project_id 조회 실패 시 fallback)
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  branch: string | null;
  context_file: string;
  changelog_versions: number[];
  feedback_history: Feedback[];
  session_id: string | null;
  last_error: string | null;
  base_commit: string | null;
  hidden: boolean;                 // 숨김 여부 (칸반 보드에서 숨김 처리)
}

// 프로젝트 관련 타입
export interface Project {
  id: string;                       // "PRJ-001" 형식
  name: string;                     // 프로젝트 이름
  path: string;                     // 프로젝트 경로
  created_at: string;               // ISO8601 형식
  updated_at: string;               // ISO8601 형식
  active: boolean;                  // 활성화 여부
}

export interface ProjectRegistry {
  version: string;                  // "1.0.0"
  counter: number;                  // 마지막 사용된 번호
  current_project_id: string | null; // 현재 선택된 프로젝트
  projects: Record<string, Project>;
}

export interface TaskRegistry {
  version: string;
  counter: number;
  tasks: Record<string, Task>;
}

// Corrected valid transitions with BACKLOG state
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  BACKLOG: ['READY', 'DONE', 'CLOSED'],
  READY: ['IN_PROGRESS', 'BACKLOG', 'DONE', 'CLOSED'],
  IN_PROGRESS: ['REVIEW', 'READY', 'CLOSED'],
  REVIEW: ['DONE', 'IN_PROGRESS', 'READY', 'BACKLOG'],
  DONE: ['BACKLOG', 'READY', 'CLOSED'],
  CLOSED: [],
};

export const STATUS_EMOJI: Record<TaskStatus, string> = {
  BACKLOG: '📦',
  READY: '📋',
  IN_PROGRESS: '🔄',
  REVIEW: '👀',
  DONE: '✅',
  CLOSED: '🏁',
};

export const PRIORITY_EMOJI: Record<TaskPriority, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
};
