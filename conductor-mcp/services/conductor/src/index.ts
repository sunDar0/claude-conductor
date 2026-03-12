import 'dotenv/config';
import { createMCPServer, startStdioTransport } from './server.js';
import { startHttpServer } from './http-server.js';
import { startWebSocketServer, startRedisBridge } from './websocket-server.js';
import detectPort from 'detect-port';
import { createLogger } from './utils/logger.js';

const log = createLogger('main');

async function findAvailablePort(preferredPort: number): Promise<number> {
  const availablePort = await detectPort(preferredPort);
  if (availablePort !== preferredPort) {
    log.warn({ preferredPort, availablePort }, 'Port in use, using alternate');
  }
  return availablePort;
}

async function main() {
  log.info('Starting services...');

  const preferredHttpPort = parseInt(process.env.HTTP_PORT || '3100', 10);
  const preferredWsPort = parseInt(process.env.WS_PORT || '3101', 10);
  const useStdio = process.env.USE_STDIO === 'true' || process.argv.includes('--stdio');
  const skipHttpWs = process.env.SKIP_HTTP_WS === 'true' || process.argv.includes('--stdio-only');

  try {
    let httpPort = preferredHttpPort;
    let wsPort = preferredWsPort;

    // Skip HTTP/WS servers if running as stdio-only MCP
    if (!skipHttpWs) {
      // Find available ports (auto-increment if in use)
      httpPort = await findAvailablePort(preferredHttpPort);
      wsPort = await findAvailablePort(preferredWsPort);

      // Ensure WS port doesn't conflict with HTTP port
      if (wsPort === httpPort) {
        wsPort = await findAvailablePort(httpPort + 1);
      }

      // Start HTTP server for REST API
      startHttpServer(httpPort);

      // Start WebSocket server for real-time events
      startWebSocketServer(wsPort);

      // Start Redis bridge for event forwarding
      await startRedisBridge();

      log.info({ httpPort, wsPort }, 'HTTP API and WebSocket started');
    } else {
      log.info('Running in stdio-only mode (HTTP/WS disabled)');
    }

    // Start MCP server (always for handling MCP requests)
    const server = await createMCPServer();

    // Connect stdio transport if requested
    if (useStdio || skipHttpWs) {
      await startStdioTransport(server);
      log.info('MCP stdio transport started');
    }

    log.info('All services started successfully');
  } catch (error) {
    log.error({ error }, 'Failed to start');
    process.exit(1);
  }
}

main();
