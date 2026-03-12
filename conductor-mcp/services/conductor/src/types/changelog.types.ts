/**
 * Changelog 관련 타입
 */

export type ChangeType = 'Added' | 'Changed' | 'Deprecated' | 'Removed' | 'Fixed' | 'Security';

export interface ChangelogEntry {
  type: ChangeType;
  description: string;
  scope?: string;
  breaking?: boolean;
}

export interface ChangelogVersion {
  version: string;
  date: string;
  task_id: string;
  entries: ChangelogEntry[];
}

export interface ChangelogInput {
  task_id: string;
  version?: string;
  from_ref?: string;
  to_ref?: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface ParsedCommit {
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
}

