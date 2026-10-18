import test from 'node:test';
import assert from 'node:assert/strict';
import { startAutoRefresh } from '../src/refresh.js';

test('refreshes automatically, on return, and after reconnect; stops after cleanup', () => {
  const windowTarget = new EventTarget(), documentTarget = new EventTarget();
  windowTarget.navigator = { onLine: true }; documentTarget.visibilityState = 'visible';
  let tick, calls = 0, cancelled;
  const stop = startAutoRefresh(() => calls++, { windowTarget, documentTarget, schedule(fn, ms) { tick = fn; assert.equal(ms, 15000); return 7; }, cancel(id) { cancelled = id; } });
  tick(); assert.equal(calls, 1);
  documentTarget.visibilityState = 'hidden'; tick(); assert.equal(calls, 1);
  windowTarget.dispatchEvent(new Event('focus')); assert.equal(calls, 1);
  documentTarget.visibilityState = 'visible'; documentTarget.dispatchEvent(new Event('visibilitychange')); assert.equal(calls, 2);
  windowTarget.navigator.onLine = false; tick(); assert.equal(calls, 2);
  windowTarget.navigator.onLine = true; windowTarget.dispatchEvent(new Event('online')); assert.equal(calls, 3);
  stop(); assert.equal(cancelled, 7);
  windowTarget.dispatchEvent(new Event('focus')); windowTarget.dispatchEvent(new Event('online')); documentTarget.dispatchEvent(new Event('visibilitychange')); assert.equal(calls, 3);
});
