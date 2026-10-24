/**
 * Browser side of the local AI bridge.
 * Only connects to 127.0.0.1; never sends the view to the host except through
 * the normal game WebSocket action.
 */
export class BridgeClient {
  constructor({ onStatus, onAction, onReady, onManual } = {}) {
    this.onStatus = onStatus ?? (() => {});
    this.onAction = onAction ?? (() => {});
    this.onReady = onReady ?? (() => {});
    this.onManual = onManual ?? (() => {});
    this.ws = null;
    this.enabled = false;
    this.token = '';
    this.room = '';
    this.player = '';
    this.status = 'off';
    this.channels = [];
    this.retry = null;
  }

  start({ token, room, player }) {
    this.enabled = true;
    this.token = token;
    this.room = room;
    this.player = player;
    this.open();
  }

  stop() {
    this.enabled = false;
    clearTimeout(this.retry);
    this.retry = null;
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.status = 'off';
    this.channels = [];
    this.onStatus({ status: 'off', channels: [] });
  }

  open() {
    if (!this.enabled || this.ws) return;
    this.status = 'connecting';
    this.onStatus({ status: this.status, channels: this.channels });
    let ws;
    try {
      ws = new WebSocket('ws://127.0.0.1:3210/control');
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({
        v: 1,
        type: 'hello',
        token: this.token,
        room: this.room,
        player: this.player,
      }));
    };
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.type === 'hello') {
        this.status = 'connected';
        this.onStatus({ status: this.status, channels: this.channels, hello: msg });
      } else if (msg.type === 'bridge_status') {
        this.channels = msg.channels ?? [];
        this.onStatus({ status: this.status, channels: this.channels, checking: Boolean(msg.checking) });
      } else if (msg.type === 'round_ready') {
        this.onReady(msg);
      } else if (msg.type === 'round_manual') {
        this.onManual(msg);
      } else if (msg.type === 'external_action') {
        this.onAction(msg);
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.status = 'disconnected';
      this.onStatus({ status: this.status, channels: [] });
      this.scheduleRetry();
    };
    ws.onerror = () => {};
  }

  scheduleRetry() {
    if (!this.enabled || this.retry) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.open();
    }, 1200);
  }

  send(payload) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  sendSnapshot(snapshot) {
    return this.send({ v: 1, type: 'snapshot', snapshot });
  }

  sendResultStart() {
    return this.send({ v: 1, type: 'result_start' });
  }

  sendRoundStart(snapshot) {
    return this.send({ v: 1, type: 'round_start', snapshot });
  }

  sendBroadcast() {
    return this.send({ v: 1, type: 'broadcast' });
  }
}
