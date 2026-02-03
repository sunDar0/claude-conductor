import { nowISO } from './date.js';

export function createActivity(type: string, taskId: string, message: string) {
  return {
    id: `ACT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    task_id: taskId,
    message,
    timestamp: nowISO(),
  };
}
