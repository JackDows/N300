import { EventEmitter } from 'node:events';

export class Cdp extends EventEmitter {
  pending = new Map(); sequence = 0;
  static async connect(endpoint, targetId) {
    const targets = await fetch(`${endpoint}/json/list`).then((r) => r.json());
    const target = targets.find((t) => targetId ? t.id === targetId : t.type === 'page');
    if (!target) throw new Error('Selected page is not available');
    const client = new Cdp(); client.target = target;
    client.socket = new WebSocket(target.webSocketDebuggerUrl);
    client.socket.addEventListener('close', () => client.rejectPending());
    client.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const entry = client.pending.get(message.id);
        if (entry) { client.pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
      } else client.emit(message.method, message.params);
    });
    await new Promise((resolve, reject) => { client.socket.addEventListener('open', resolve, { once: true }); client.socket.addEventListener('error', reject, { once: true }); });
    return client;
  }
  send(method, params = {}, timeout = 15000) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP is not connected'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  rejectPending() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP closed')); } this.pending.clear(); }
  close() { this.socket.close(); this.rejectPending(); }
}
