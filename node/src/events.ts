import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { Server } from 'node:http';
import type { ZodType } from 'zod';
import { LogEvent, ModelStatusEvent, DiagnosticsEvent, TrainingProgressEvent, CommandEvent } from '../../common/contracts/events.ts';
import { TaskEvent } from '../../common/contracts/tasks.ts';
import { NotificationEvent } from '../../common/contracts/notifications.ts';
import { HubStreamEvent } from '../../common/contracts/modelhub.ts';
import { AgentStreamEvent } from '../../common/contracts/agent.ts';
import { IndexStreamEvent } from '../../common/contracts/index.ts';
import { DapEvent } from '../../common/contracts/dap.ts';
import { LspStatusEvent } from '../../common/contracts/lsp.ts';
import type { Logger } from './services/logger.ts';

export type ChannelName = 'log' | 'model' | 'diagnostics' | 'training' | 'debug' | 'lsp-status' | 'command' | 'tasks' | 'notifications' | 'modelhub' | 'agent' | 'index';

const SCHEMAS: Record<ChannelName, ZodType> = {
  log: LogEvent,
  model: ModelStatusEvent,
  diagnostics: DiagnosticsEvent,
  training: TrainingProgressEvent,
  debug: DapEvent,
  'lsp-status': LspStatusEvent,
  command: CommandEvent,
  tasks: TaskEvent,
  notifications: NotificationEvent,
  modelhub: HubStreamEvent,
  agent: AgentStreamEvent,
  index: IndexStreamEvent
};

export const CHANNELS = Object.keys(SCHEMAS) as ChannelName[];

interface WsClient {
  socket: WebSocket;
  channels: Set<ChannelName>;
}

export interface WsSubscribeMessage {
  type?: string;
  channels?: unknown;
}

export class EventHub {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WsClient>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', socket => {
      const client: WsClient = { socket, channels: new Set() };
      this.clients.add(client);
      socket.on('message', (raw: RawData) => this.onMessage(client, raw));
      socket.on('close', () => {
        this.clients.delete(client);
      });
      socket.on('error', () => {
        this.clients.delete(client);
      });
    });
  }

  publish(channel: ChannelName, data: unknown): void {
    const schema = SCHEMAS[channel];
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      this.logger.error('event payload violates the contract; event not sent', { channel, issues: parsed.error.issues });
      return;
    }
    const payload = JSON.stringify({ channel, ts: Date.now(), data: parsed.data });
    for (const client of this.clients) {
      if (client.channels.has(channel) && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(payload);
      }
    }
  }

  clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    for (const client of this.clients) {
      client.socket.close();
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }

  private onMessage(client: WsClient, raw: RawData): void {
    const text = Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : raw.toString('utf8');
    let message: WsSubscribeMessage;
    try {
      message = JSON.parse(text) as WsSubscribeMessage;
    } catch {
      return;
    }
    if (message.type === 'subscribe' && Array.isArray(message.channels)) {
      const channels = message.channels.filter((name: unknown): name is ChannelName => typeof name === 'string' && name in SCHEMAS);
      client.channels = new Set(channels);
    }
  }
}
