const test = require('node:test');
const assert = require('node:assert/strict');

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];
  constructor(addr) {
    this.addr = addr;
    this.readyState = 0;
    this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
    FakeWebSocket.instances.push(this);
  }
  send() {}
  close() { this.readyState = 3; }
  fail() { this.onerror?.(new Error('connect failed')); }
}
globalThis.WebSocket = FakeWebSocket;

const sdk = require('../lib/wukongimjssdk.cjs.js');
const { WKSDK, ConnectStatus } = sdk;

// The existing SDK owns a receipt interval; it must not keep this test process alive.
WKSDK.shared().receiptManager.timer.unref();
const manager = WKSDK.shared().connectManager;
const RECONNECT_DELAY = 3000;

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.mock.method(console, 'log', () => {});
  WKSDK.shared().config.addr = 'wss://example.test';
  FakeWebSocket.instances = [];
  // ConnectManager is a singleton: start each case from a clean state rather than
  // relying on the previous case's cleanup, which goes through the code under test.
  Object.assign(manager, { lockReconnect: false, reConnectTimeout: null, ws: undefined,
    status: ConnectStatus.Disconnect });
  t.after(() => manager.disconnect());
  return FakeWebSocket.instances;
}

test('reconnects after onlyDisconnect cancels a pending reconnect', (t) => {
  const sockets = fixture(t);
  manager.connect();
  sockets[0].fail(); // schedules reConnect and takes the lock

  // Ping timeout path: onlyDisconnect() clears the pending timer, then connect() again.
  manager.onlyDisconnect();
  manager.connect();
  assert.equal(sockets.length, 2);
  sockets[1].fail();

  t.mock.timers.tick(RECONNECT_DELAY);
  assert.equal(sockets.length, 3, 'the failed connection must schedule another reconnect');
  assert.equal(manager.status, ConnectStatus.Connecting);
});

test('keeps retrying after each failed reconnect', (t) => {
  const sockets = fixture(t);
  manager.connect();
  for (let i = 0; i < 3; i++) {
    sockets[sockets.length - 1].fail();
    t.mock.timers.tick(RECONNECT_DELAY);
  }
  assert.equal(sockets.length, 4);
  assert.equal(manager.reConnectTimeout, null, 'a fired reconnect timer must not be left behind');
});

test('disconnect() stops reconnecting and releases the lock', (t) => {
  const sockets = fixture(t);
  manager.connect();
  sockets[0].fail();
  manager.disconnect();

  t.mock.timers.tick(RECONNECT_DELAY);
  assert.equal(sockets.length, 1);
  assert.equal(manager.lockReconnect, false);
});
