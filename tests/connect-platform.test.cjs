const test = require('node:test');
const assert = require('node:assert/strict');

// uni-app / mini-program socket task. WKWebsocket picks the platform API once per
// process, so this lives in its own file, apart from the native WebSocket tests.
const sockets = [];
globalThis.uni = {
  connectSocket(options) {
    const handlers = {};
    const task = {
      url: options.url,
      onOpen(cb) { handlers.open = cb; },
      onMessage(cb) { handlers.message = cb; },
      onClose(cb) { handlers.close = cb; },
      onError(cb) { handlers.error = cb; },
      send() {},
      close() {},
      fail() { handlers.error?.({ errMsg: 'connect failed' }); },
    };
    sockets.push(task);
    return task;
  },
};

const sdk = require('../lib/wukongimjssdk.cjs.js');
const { WKSDK, ConnectStatus } = sdk;

// The existing SDK owns a receipt interval; it must not keep this test process alive.
WKSDK.shared().receiptManager.timer.unref();
const manager = WKSDK.shared().connectManager;

test('a closed platform socket cannot report errors for the new connection', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.mock.method(console, 'log', () => {});
  WKSDK.shared().config.addr = 'wss://example.test';
  t.after(() => manager.disconnect());

  manager.connect();
  manager.onlyDisconnect(); // closes sockets[0]
  manager.connect();
  assert.equal(sockets.length, 2);

  sockets[0].fail(); // late error from the socket that was already closed
  assert.equal(manager.status, ConnectStatus.Connecting);

  t.mock.timers.tick(3000);
  assert.equal(sockets.length, 2, 'the live connection must not be replaced');
});
