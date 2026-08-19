import { EventEnvelope } from '../../../common/contracts/events.ts';

export interface EventBus {
  subscribe(channel: string, handler: (data: unknown) => void): () => void;
  connected(): boolean;
  dispose(): void;
}

interface EventBusOptions {
  onStatus?: (connected: boolean) => void;
}

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

export function connectEvents(wsUrl: string, opts: EventBusOptions = {}): EventBus {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  let socket: WebSocket | null = null;
  let disposed = false;
  let reconnectDelay = MIN_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connected = false;

  function setStatus(value: boolean): void {
    if (connected === value) return;
    connected = value;
    opts.onStatus?.(value);
  }

  function subscribeAll(): void {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'subscribe', channels: [...handlers.keys()] }));
  }

  function scheduleReconnect(): void {
    if (disposed) return;
    const delay = reconnectDelay + Math.random() * 1000;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(() => {
      open();
    }, delay);
  }

  function open(): void {
    if (disposed) return;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }
    socket.addEventListener('open', () => {
      reconnectDelay = MIN_BACKOFF_MS;
      setStatus(true);
      subscribeAll();
    });
    socket.addEventListener('message', (event: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const parsed = EventEnvelope.safeParse(raw);
      if (!parsed.success) return;
      const channelHandlers = handlers.get(parsed.data.channel);
      if (channelHandlers === undefined) return;
      for (const handler of channelHandlers) handler(parsed.data.data);
    });
    socket.addEventListener('close', () => {
      setStatus(false);
      socket = null;
      scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      socket?.close();
    });
  }

  function subscribe(channel: string, handler: (data: unknown) => void): () => void {
    let set = handlers.get(channel);
    if (set === undefined) {
      set = new Set();
      handlers.set(channel, set);
    }
    set.add(handler);
    subscribeAll();
    return () => {
      set?.delete(handler);
      if (set?.size === 0) handlers.delete(channel);
    };
  }

  open();

  return {
    subscribe,
    connected: () => connected,
    dispose: () => {
      disposed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      socket?.close();
      socket = null;
      handlers.clear();
    }
  };
}