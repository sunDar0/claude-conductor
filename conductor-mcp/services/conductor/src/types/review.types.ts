/**
 * 코드 리뷰 관련 타입
 */

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface ReviewPoint {
  file: string;
  line?: number;
  severity: 'info' | 'suggestion' | 'warning' | 'critical';
  category: ReviewCategory;
  message: string;
  suggestion?: string;
}

export type ReviewCategory =
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'style'
  | 'testing'
  | 'documentation';

export interface ReviewResult {
  task_id: string;
  branch: string;
  base_branch: string;
  files_changed: number;
  total_additions: number;
  total_deletions: number;
  changes: FileChange[];
  points: ReviewPoint[];
  summary: string;
  reviewed_at: string;
}

export interface ReviewInput {
  task_id: string;
  base_branch?: string;
}
