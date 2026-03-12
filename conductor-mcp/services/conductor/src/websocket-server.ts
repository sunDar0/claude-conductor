import { WebSocketServer, WebSocket } from 'ws';
import { Redis } from 'ioredis';
import { wsLogger as log } from './utils/logger.js';

const HEARTBEAT_INTERVAL = 30000;
const clients: Set<WebSocket> = new Set();

interface HeartbeatWebSocket extends WebSocket {
  isAlive: boolean;
}

export function startWebSocketServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const hws = ws as HeartbeatWebSocket;
      if (!hws.isAlive) {
        hws.terminate();
        return;
      }
      hws.isAlive = false;
      hws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => clearInterval(interval));

  wss.on('connection', (ws: WebSocket) => {
    const hws = ws as HeartbeatWebSocket;
    hws.isAlive = true;
    hws.on('pong', () => { hws.isAlive = true; });

    log.info('Client connected');
    clients.add(ws);

    ws.on('close', () => {
      log.info('Client disconnected');
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      log.error({ error }, 'Client error');
      clients.delete(ws);
    });

    // Send initial connection confirmation
    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
  });

  wss.on('error', (error) => {
    log.error({ error }, 'Server error');
  });

  log.info({ port }, 'Server listening');

  return wss;
}

export function broadcast(message: unknown): void {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Redis Pub/Sub to WebSocket bridge
export async function startRedisBridge(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.warn('Redis URL not configured, skipping bridge');
    return;
  }

  try {
    const subscriber = new Redis(redisUrl);
    await subscriber.subscribe('conductor:events');

    subscriber.on('message', (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message);
        broadcast({ type: 'event', ...event });
      } catch (error) {
        log.error({ error }, 'Failed to parse Redis message');
      }
    });

    log.info('Redis bridge started');
  } catch (error) {
    log.error({ error }, 'Failed to start Redis bridge');
  }
}

export { clients };
