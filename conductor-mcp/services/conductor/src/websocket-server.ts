import { WebSocketServer, WebSocket } from 'ws';
import { Redis } from 'ioredis';
import { wsLogger as log } from './utils/logger.js';

const clients: Set<WebSocket> = new Set();

export function startWebSocketServer(port: number): void {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws: WebSocket) => {
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
