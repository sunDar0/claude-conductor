import * as pinoModule from 'pino';
const pino = pinoModule.default || pinoModule;

// Create base logger with pino-pretty for development
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname',
      messageFormat: '[{module}] {msg}',
    },
  },
});

// Create child loggers for different modules
export const createLogger = (module: string) => {
  return logger.child({ module });
};

// Pre-configured loggers for common modules
export const autoPipelineLogger = createLogger('AutoPipeline');
export const httpLogger = createLogger('HTTP');
export const mcpLogger = createLogger('MCP');
export const wsLogger = createLogger('WebSocket');
export const taskLogger = createLogger('Task');
export const taskHandlerLogger = createLogger('TaskHandler');
export const serverLogger = createLogger('Server');
export const registryLogger = createLogger('Registry');

export default logger;
