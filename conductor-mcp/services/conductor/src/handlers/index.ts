// Re-export handlers with explicit exports to avoid EventPublisher conflict
export {
  handleTaskCreate,
  handleTaskList,
  handleTaskGet,
  handleTaskStart,
  handleTaskTransition,
  type EventPublisher
} from './task.handler.js';
export * from './server.handler.js';
export { handleChangelogGenerate } from './changelog.handler.js';
export * from './review.handler.js';
export * from './project.handler.js';
