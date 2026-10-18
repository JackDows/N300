/** UI-independent JSON-RPC client. No device protocol or reconnect policy lives here. */
export class DeskHubError extends Error {
  constructor(info = {}) { super(info.userMessage ?? info.message ?? '操作未完成。'); this.name = 'DeskHubError'; this.code = info.code ?? 'transport_error'; this.details = info.details ?? {}; this.technicalMessage = info.message; }
}
export function createClient(transport) {
  let sequence = 0, closed = false;
  const pending = new Map(), listeners = new Set();
  const release = transport.subscribe((message) => {
    if (message.jsonrpc !== '2.0') return;
    if (Object.hasOwn(message, 'id')) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      message.error ? item.reject(new DeskHubError(message.error.data ?? message.error)) : item.resolve(message.result);
    } else if (typeof message.method === 'string') {
      for (const listener of listeners) listener({ type: message.method, ...message.params });
    }
  });
  function close(reason = 'DeskHub connection closed') {
    if (closed) return;
    closed = true; release?.();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new DeskHubError({ code: 'transport_closed', message: reason, userMessage: 'DeskHub 后端连接已断开。' })); }
    pending.clear(); listeners.clear();
  }
  return {
    async request(method, params = {}) {
      if (closed) throw new DeskHubError({ code: 'transport_closed', userMessage: 'DeskHub 后端连接已断开。' });
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new DeskHubError({ code: 'transport_timeout', message: 'Frontend transport deadline exceeded; do not replay writes', userMessage: '暂时没有收到结果，请重新读取状态。' })); }, Math.max(65_000, (params.timeoutMs ?? 30_000) + 5_000));
        pending.set(id, { resolve, reject, timer });
        Promise.resolve().then(() => transport.send({ jsonrpc: '2.0', id, method, params })).catch((error) => {
          const item = pending.get(id); if (!item) return;
          pending.delete(id); clearTimeout(item.timer); item.reject(error);
        });
      });
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close,
  };
}
