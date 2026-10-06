import type { ClientMsg, ServerMsg } from '@shared/protocol';
import type { Handler, Transport } from './transport';

export class WsClient implements Transport {
  private ws: WebSocket | null = null;
  private readonly queue: ClientMsg[] = [];
  private closed = false;
  private pingInterval: number | null = null;
  public rtt = 0;
  private lastPingSent = 0;

  constructor(
    private readonly url: string,
    private readonly onMsg: Handler,
    private readonly onStatus?: (status: 'connecting' | 'open' | 'closed' | 'error') => void
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    this.onStatus?.('connecting');

    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      this.onStatus?.('error');
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      this.onStatus?.('open');
      // Flush queued messages
      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        this.send(msg);
      }
      // Start ping loop (every 1s)
      this.startPing();
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        const msg = JSON.parse(raw) as ServerMsg;
        if (msg.t === 'pong') {
          this.rtt = Math.max(1, Math.round(performance.now() - msg.c));
        } else {
          this.onMsg(msg);
        }
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    });

    this.ws.addEventListener('close', () => {
      this.stopPing();
      this.onStatus?.('closed');
      this.scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      this.onStatus?.('error');
    });
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const now = Math.round(performance.now());
        this.lastPingSent = now;
        this.send({ t: 'ping', c: now });
      }
    }, 1000);
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    setTimeout(() => {
      if (!this.closed) this.connect();
    }, 1500);
  }

  send(m: ClientMsg): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Keep last join or non-input messages queued
      if (m.t !== 'input') {
        this.queue.push(m);
      }
      return;
    }
    this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.closed = true;
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
