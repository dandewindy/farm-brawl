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
  public colo = '';
  public inGame = false;
  private autoSteerAttempts = 0;
  private reconnectTimer: number | null = null;
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
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.onStatus?.('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
      this.ws = socket;
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      this.onStatus?.('error');
      this.scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      if (this.ws !== socket) return; // Stale socket guard
      const wasReconnecting = this.isReconnecting;
      this.isReconnecting = false;
      this.onStatus?.(wasReconnecting ? 'reconnected' : 'open');

      if (this.lastJoinMsg) {
        this.send({
          ...this.lastJoinMsg,
          token: this.sessionToken || undefined,
        });
      }

      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        this.send(msg);
      }

      setTimeout(() => {
        if (!this.closed && this.ws === socket && socket.readyState === WebSocket.OPEN) {
          const now = Math.round(performance.now());
          this.send({ t: 'ping', c: now });
        }
      }, 300);

      this.startPing();
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        const msg = JSON.parse(raw) as ServerMsg;
        if (msg.t === 'pong') {
          if (msg.colo) this.colo = msg.colo;
          if (typeof document !== 'undefined' && document.hidden) return;
          const s = performance.now() - msg.c;
          if (s >= 0 && s < 2000) {
            this.rttWin.push(s);
            if (this.rttWin.length > 5) this.rttWin.shift();
            const sorted = [...this.rttWin].sort((a, b) => a - b);
            this.rttMin = sorted[0];
            this.rtt = sorted[Math.floor(sorted.length / 2)];
          }
        } else {
          if (msg.t === 'joined') {
            if (msg.colo) this.colo = msg.colo;
            if (msg.token) {
              this.sessionToken = msg.token;
              if (this.lastJoinMsg) {
                this.lastJoinMsg.token = msg.token;
              }
            }
            // Auto-steer away from high-latency edge nodes (NRT) in lobby:
            // SIN (~35ms) and HKG (~75ms) are both fast low-latency APAC routes for Vietnam.
            // Only NRT (~460ms cross-colo) causes high ping and should be steered away from.
            if (this.colo === 'NRT' && !this.inGame && this.autoSteerAttempts < 3) {
              this.autoSteerAttempts++;
              console.log(`[WS] High latency edge node detected (${this.colo}). Auto-steering to optimal APAC node (attempt ${this.autoSteerAttempts}/3)...`);
              setTimeout(() => {
                if (!this.closed && !this.inGame && this.ws === socket) {
                  this.forceReconnect();
                }
              }, 450);
            }
          }
          this.onMsg(msg);
        }
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    };

    socket.onclose = () => {
      if (this.ws !== socket) return; // Stale socket guard: IGNORE if closed intentionally by forceReconnect()
      this.stopPing();
      this.isReconnecting = true;
      this.onStatus?.('closed');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      this.onStatus?.('error');
    };
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const now = Math.round(performance.now());
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
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.connect();
    }, 800);
  }

  send(m: ClientMsg): void {
    if (m.t === 'join') {
      this.lastJoinMsg = { ...m, token: this.sessionToken || m.token };
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (m.t !== 'input') {
        this.queue.push(m);
      }
      return;
    }
    if (m.t === 'input' && this.ws.bufferedAmount > 65536) {
      return;
    }
    this.ws.send(JSON.stringify(m));
  }

  public forceReconnect(): void {
    if (this.closed) return;
    this.stopPing();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rttWin.length = 0;
    this.isReconnecting = true;
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try {
        oldWs.close();
      } catch (_) {}
    }
    setTimeout(() => {
      if (!this.closed) {
        this.connect();
      }
    }, 250);
  }

  close(): void {
    this.closed = true;
    this.stopPing();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.lastJoinMsg = null;
    this.sessionToken = null;
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try {
        oldWs.close();
      } catch (_) {}
    }
  }
}
