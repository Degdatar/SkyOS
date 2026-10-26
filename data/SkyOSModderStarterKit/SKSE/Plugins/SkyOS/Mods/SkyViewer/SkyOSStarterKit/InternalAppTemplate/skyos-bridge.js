/* SkyOS iframe bridge, version 1. Optional helper for internal apps. */
(() => {
  'use strict';
  const channel = 'skyos-app';
  const handlers = new Map();
  const emit = (type, payload = {}) => {
    for (const callback of handlers.get(type) || []) callback(payload);
  };
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.channel !== channel || message.version !== 1 || typeof message.type !== 'string') return;
    emit(message.type, message.payload && typeof message.payload === 'object' ? message.payload : {});
  });
  const post = (type, payload = {}) => window.parent.postMessage({ channel, version: 1, type, payload }, '*');
  window.SkyOSApp = Object.freeze({
    version: 1,
    on(type, callback) {
      if (typeof type !== 'string' || typeof callback !== 'function') return () => {};
      const list = handlers.get(type) || new Set();
      list.add(callback);
      handlers.set(type, list);
      return () => list.delete(callback);
    },
    ready() { post('ready'); },
    setTitle(value) { post('set-title', { value: String(value || '') }); },
    setDescription(value) { post('set-description', { value: String(value || '') }); },
    setStatus(value) { post('set-status', { value: String(value || '') }); },
    setActions(actions) { post('set-actions', { actions: Array.isArray(actions) ? actions : [] }); },
    close() { post('close'); }
  });
  post('ready');
})();
