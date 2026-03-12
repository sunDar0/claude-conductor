import { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

vi.mock("ioredis");
vi.mock("../utils/logger.js", () => ({
  wsLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { broadcast, clients, startWebSocketServer } from "../websocket-server.js";

/** Connect a client and return both the open + first message promises (listeners attached eagerly). */
function connectClient(port: number): {
  ws: WebSocket;
  opened: Promise<void>;
  firstMessage: Promise<unknown>;
} {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const opened = new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.OPEN) resolve();
    else ws.once("open", () => resolve());
  });
  const firstMessage = new Promise<unknown>((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
  return { ws, opened, firstMessage };
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

const openClients: WebSocket[] = [];
let activeServer: WebSocketServer | null = null;

afterEach(async () => {
  for (const ws of openClients) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
  openClients.length = 0;
  clients.clear();
  if (activeServer) {
    await new Promise<void>((r) => activeServer!.close(() => r()));
    activeServer = null;
  }
});

async function createServer(): Promise<{ wss: WebSocketServer; port: number }> {
  const wss = startWebSocketServer(0);
  await new Promise<void>((resolve) => {
    if (wss.address()) resolve();
    else wss.once("listening", () => resolve());
  });
  const port = (wss.address() as AddressInfo).port;
  return { wss, port };
}

describe("websocket-server", () => {
  it("connection sends connected message with timestamp", async () => {
    const { wss, port } = await createServer();
    activeServer = wss;

    const { ws, opened, firstMessage } = connectClient(port);
    openClients.push(ws);
    await opened;

    const msg = await firstMessage;
    expect(msg).toMatchObject({ type: "connected" });
    expect((msg as { timestamp: string }).timestamp).toBeDefined();
  });

  it("broadcast sends message to all connected clients", async () => {
    const { wss, port } = await createServer();
    activeServer = wss;

    const c1 = connectClient(port);
    const c2 = connectClient(port);
    openClients.push(c1.ws, c2.ws);

    // Wait for open + drain initial "connected" messages
    await Promise.all([c1.opened, c2.opened]);
    await Promise.all([c1.firstMessage, c2.firstMessage]);

    // Now set up listeners for broadcast BEFORE calling broadcast
    const recv1 = waitForMessage(c1.ws);
    const recv2 = waitForMessage(c2.ws);
    broadcast({ test: "data" });

    const [msg1, msg2] = await Promise.all([recv1, recv2]);
    expect(msg1).toEqual({ test: "data" });
    expect(msg2).toEqual({ test: "data" });
  });

  it("heartbeat terminates dead client", async () => {
    const { wss, port } = await createServer();
    activeServer = wss;

    const { ws, opened, firstMessage } = connectClient(port);
    openClients.push(ws);
    await opened;
    await firstMessage; // drain 'connected'

    const serverSocket = [...clients][0] as WebSocket & { isAlive: boolean };
    expect(serverSocket).toBeDefined();
    serverSocket.isAlive = false;

    const closePromise = new Promise<void>((resolve) => ws.once("close", resolve));
    serverSocket.terminate();

    await closePromise;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("client disconnect removes it from clients set", async () => {
    const { wss, port } = await createServer();
    activeServer = wss;

    const { ws, opened, firstMessage } = connectClient(port);
    openClients.push(ws);
    await opened;
    await firstMessage; // drain 'connected'

    expect(clients.size).toBe(1);

    const closeAck = new Promise<void>((resolve) => ws.once("close", resolve));
    ws.close();
    await closeAck;

    await new Promise((r) => setTimeout(r, 50));
    expect(clients.size).toBe(0);
  });
});
