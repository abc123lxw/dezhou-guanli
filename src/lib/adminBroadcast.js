import { EventEmitter } from 'events';

const bus = new EventEmitter();
bus.setMaxListeners(50);

/** @typedef {'order_new'|'order_paid'|'order_updated'|'stats_refresh'} AdminEventType */

/**
 * @param {AdminEventType} type
 * @param {Record<string, unknown>} [payload]
 */
export function broadcastAdmin(type, payload = {}) {
  bus.emit('event', { type, payload, at: new Date().toISOString() });
}

/** @param {(event: { type: string, payload: Record<string, unknown>, at: string }) => void} listener */
export function onAdminEvent(listener) {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
