import { useEffect, useRef, useCallback } from 'react';

type MessageHandler = (data: Record<string, unknown>) => void;

const WS_BASE = import.meta.env['VITE_WS_URL'] ?? `ws://${window.location.host}/ws/cds`;

export class CDSWebSocket {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  connect(token: string) {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const channel = msg.channel as string;
        this.handlers.get(channel)?.forEach((h) => h(msg.data));
        this.handlers.get('*')?.forEach((h) => h(msg));
      } catch { /* ignore malformed messages */ }
    };

    this.ws.onclose = () => {
      this.scheduleReconnect(token);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(token: string) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect(token);
    }, this.reconnectDelay);
  }

  subscribe(channel: string, handler: MessageHandler) {
    if (!this.handlers.has(channel)) this.handlers.set(channel, new Set());
    this.handlers.get(channel)!.add(handler);
    return () => { this.handlers.get(channel)?.delete(handler); };
  }

  send(channel: string, data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ channel, data }));
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
  }
}

export const cdsSocket = new CDSWebSocket();

export function useWebSocketChannel(channel: string, handler: MessageHandler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const stableHandler = useCallback((data: Record<string, unknown>) => {
    handlerRef.current(data);
  }, []);

  useEffect(() => {
    return cdsSocket.subscribe(channel, stableHandler);
  }, [channel, stableHandler]);
}
