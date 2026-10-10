import type { ClientMsg, ServerMsg } from '@shared/protocol';
import type { Handler, Transport } from './transport';

export class WsClient implements Transport {
  private ws: WebSocket | null = null;
  private readonly queue: ClientMsg[] = [];
  private closed = false;
  private isReconnecting = false;
  private lastJoinMsg: (ClientMsg & { t: 'join' }) | null = null;
  private sessionToken: string | null = null;
  private pingInterval: number | null = null;
  public rtt = 0;
  public rttMin = 0;
  private readonly rttWin: number[] = [];

  constructor(
    private readonly url: string,
    private readonly onMsg: Handler,
    private readonly onStatus?: (status: 'connecting' | 'open' | 'reconnected' | 'closed' | 'error') => void
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
      const wasReconnecting = this.isReconnecting;
      this.isReconnecting = false;
      this.onStatus?.(wasReconnecting ? 'reconnected' : 'open');

      // If reconnecting, re-send join message first with cached session token
      if (this.lastJoinMsg) {
        const joinMsg: ClientMsg = {
          ...this.lastJoinMsg,
          token: this.sessionToken || undefined,
        };
        this.send(joinMsg);
      }

      // Flush queued messages
      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        this.send(msg);
      }

      // Send immediate first ping to measure baseline RTT instantly
      const now = Math.round(performance.now());
      this.send({ t: 'ping', c: now });

      // Start ping loop (every 1.2s)
      this.startPing();
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        const msg = JSON.parse(raw) as ServerMsg;
        if (msg.t === 'pong') {
          const s = performance.now() - msg.c;
          if (s >= 0 && s < 3000) {
            this.rtt = this.rtt === 0 ? s : this.rtt + (s - this.rtt) * 0.25;
            this.rttWin.push(s);
            if (this.rttWin.length > 5) this.rttWin.shift();
            this.rttMin = Math.min(...this.rttWin);
          }
        } else {
          if (msg.t === 'joined' && msg.token) {
            this.sessionToken = msg.token;
            if (this.lastJoinMsg) {
              this.lastJoinMsg.token = msg.token;
            }
          }
          this.onMsg(msg);
        }
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    });

    this.ws.addEventListener('close', () => {
      this.stopPing();
      this.isReconnecting = true;
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
        this.send({ t: 'ping', c: now });
      }
    }, 1200);
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
    }, 800);
  }

  send(m: ClientMsg): void {
    if (m.t === 'join') {
      this.lastJoinMsg = { ...m, token: this.sessionToken || m.token };
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Keep last join or non-input messages queued
      if (m.t !== 'input') {
        this.queue.push(m);
      }
      return;
    }
    // Prevent bufferbloat on congested or jittery connections
    if (m.t === 'input' && this.ws.bufferedAmount > 65536) {
      return;
    }
    this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.closed = true;
    this.stopPing();
    this.lastJoinMsg = null;
    this.sessionToken = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
