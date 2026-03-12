import type { WSMessage } from '../types';

type Handler = (msg: WSMessage) => void;

class WSClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private reconnectAttempts = 0;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    // In development, connect directly to WebSocket server to avoid Vite proxy EPIPE errors
    const wsUrl = import.meta.env.VITE_WS_URL || `ws://${location.hostname}:3101`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      const isReconnect = this.reconnectAttempts > 0;
      this.reconnectAttempts = 0;
      this.notify({ type: 'connection', payload: { connected: true, reconnect: isReconnect }, timestamp: new Date().toISOString() });
    };

    this.ws.onmessage = (e) => {
      try {
        this.notify(JSON.parse(e.data));
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      this.notify({ type: 'connection', payload: { connected: false }, timestamp: new Date().toISOString() });
      this.attemptReconnect();
    };

    this.ws.onerror = () => {
      // Will trigger onclose
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe(handler: Handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private notify(msg: WSMessage) {
    this.handlers.forEach((h) => h(msg));
  }

  private attemptReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    setTimeout(() => this.connect(), delay);
  }
}

export const wsClient = new WSClient();
