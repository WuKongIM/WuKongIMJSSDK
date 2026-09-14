// Explicit opt-in: starts a real single-node cluster and two isolated SDK runtimes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { webcrypto } = require('node:crypto');
const { createEditingDemo } = require('../examples/message-editing/server.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await check()) return; await delay(30); }
  throw new Error(`Timed out: ${label}`);
}
async function port() {
  const s = net.createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p;
}

async function main() {
  const binary = process.env.WK_EDIT_SERVER_BIN;
  if (!binary) throw new Error('Set WK_EDIT_SERVER_BIN to a server binary containing WuKongIM PR #959');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wk-js-edit-'));
  const api = await port(), raft = await port(), ws = await port();
  const config = `
[node]
id = 1
data_dir = "${dir}/data"
[cluster]
id = "js-edit-validation"
listen_addr = "127.0.0.1:${raft}"
nodes = [{id = 1, addr = "127.0.0.1:${raft}"}]
initial_slot_count = 8
hash_slot_count = 256
slot_replica_n = 1
[api]
listen_addr = "127.0.0.1:${api}"
external_ws_addr = "ws://127.0.0.1:${ws}"
[manager]
listen_addr = "127.0.0.1:0"
[gateway]
token_auth_on = true
listeners = [{name = "ws", network = "websocket", address = "127.0.0.1:${ws}", transport = "gnet", protocol = "wsmux"}]
[log]
level = "warn"
dir = "${dir}/logs"
`;
  await fs.writeFile(path.join(dir, 'wukongim.toml'), config);
  const server = spawn(binary, ['-config', path.join(dir, 'wukongim.toml')], { cwd: dir, env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('WK_EDIT_'))), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', x => { log += x; }); server.stderr.on('data', x => { log += x; });
  let bff; const clients = [];
  const exit = new Promise(resolve => server.once('exit', resolve));
  try {
    const productURL = `http://127.0.0.1:${api}`;
    await until(async () => { try { return (await fetch(productURL + '/route')).ok; } catch { return false; } }, 'cluster readiness');
    const users = { alice: 'alice-demo-credential', bob: 'bob-demo-credential' };
    bff = createEditingDemo({ productURL, users });
    await new Promise(resolve => bff.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${bff.address().port}`;
    const library = await fs.readFile(path.join(__dirname, '../lib/wukongimjssdk.umd.js'), 'utf8');
    async function client(uid, peer) {
      const timers = new Set();
      const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, WebSocket, AbortController,
        Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, crypto: webcrypto, setTimeout, clearTimeout,
        setInterval: (...args) => { const timer = setInterval(...args); timer.unref(); timers.add(timer); return timer; }, clearInterval });
      vm.runInContext(library, context);
      const wk = context.wk, sdk = wk.WKSDK.shared(), rows = new Map(), calls = [];
      let dropAck = false;
      const events = [];
      sdk.eventManager.addEventListener(event => events.push({ type: event.type, data: event.dataJson }));
      const transport = async (route, body, signal) => {
        calls.push({ route, body: JSON.stringify(body) });
        const r = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${uid}:${users[uid]}` },
          body: JSON.stringify(body), signal: signal || AbortSignal.timeout(10000) });
        const data = await r.json();
        if (route === '/message/update' && dropAck && r.ok) { dropAck = false; throw new TypeError('simulated lost acknowledgement'); }
        return { status: r.status, body: data, contentEpoch: r.headers.get('x-wk-content-epoch') || undefined };
      };
      const session = (await transport('/session', {})).body;
      sdk.config.uid = uid; sdk.config.token = session.token; sdk.config.addr = session.websocket;
      const errors = [];
      const options = { transport, onError: e => errors.push(e.code || e.message) };
      const uninstall = wk.installMessageEditing(sdk, options);
      sdk.chatManager.addMessageUpdateListener(messages => messages.forEach(m => { if (rows.has(m.messageID)) rows.set(m.messageID, m); }));
      sdk.connect();
      const channel = new wk.Channel(peer, 1);
      sdk.conversationManager.openConversation = Object.assign(new wk.Conversation(), { channel });
      const result = { sdk, wk, channel, rows, calls, options, errors, events, dropNextAck() { dropAck = true; },
        async history() { const list = await sdk.chatManager.syncMessages(channel, Object.assign(new wk.SyncOptions(), { pullMode: wk.PullMode.Up }));
          list.forEach(m => rows.set(m.messageID, m)); return list; },
        close() { uninstall(); sdk.disconnect(); for (const timer of timers) clearInterval(timer); } };
      clients.push(result);
      await until(() => sdk.messageUpdateManager.hintsReady, `${uid} EVENT readiness`);
      return result;
    }
    const alice = await client('alice', 'bob'), bob = await client('bob', 'alice');
    const sent = await fetch(productURL + '/message/send', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from_uid: 'alice', channel_id: 'bob', channel_type: 1, header: { red_dot: 1 },
        payload: Buffer.from('{"type":1,"content":"original"}').toString('base64') }) });
    assert.equal(sent.status, 200, await sent.text());
    // Directory projection is asynchronous after durable SEND; only the harness waits for initial visibility.
    await until(async () => { try { return (await alice.history()).length > 0 && (await bob.history()).length > 0; } catch { return false; } }, 'person history projection');
    await bob.sdk.conversationManager.sync();
    const original = [...alice.rows.values()][0], id = original.messageID;
    const before = bob.sdk.conversationManager.findConversation(bob.channel);
    const unread = before.unread, timestamp = before.timestamp;
    const baselineCalls = bob.calls.filter(c => c.route === '/channel/messageupdates').length;
    alice.dropNextAck();
    const hintStarted = Date.now();
    const edited = await alice.sdk.chatManager.updateMessage(original, new alice.wk.MessageText('edited once'));
    assert.equal(edited.contentVersion, '1');
    const writes = alice.calls.filter(c => c.route === '/message/update');
    assert.equal(writes.length, 2); assert.equal(writes[0].body, writes[1].body);
    await until(() => bob.events.some(e => e.type === 'message_updated' && e.data.message_id === id && e.data.version === edited.contentVersion), 'actual server edit EVENT', 30000);
    await until(() => bob.rows.get(id)?.content.text === 'edited once', 'body-free hint to edit feed');
    const onlineHintLatencyMs = Date.now() - hintStarted;
    assert.ok(bob.calls.filter(c => c.route === '/channel/messageupdates').length > baselineCalls);
    assert.equal(before.lastMessage.content.text, 'edited once');
    assert.equal(before.unread, unread); assert.equal(before.timestamp, timestamp);
    await assert.rejects(bob.sdk.chatManager.updateMessage(bob.rows.get(id), new bob.wk.MessageText('not my message')), { code: 'edit_not_allowed' });
    await assert.rejects(alice.sdk.chatManager.updateMessage(original, new alice.wk.MessageText('stale draft')),
      error => ['version_conflict', 'content_epoch_conflict'].includes(error.code));
    const staleCAS = await alice.options.transport('/message/update', { channel_id: 'bob', channel_type: 1, message_id: id,
      expected_version: '0', expected_content_epoch: edited.contentEpoch, request_id: 'explicit-stale-cas',
      payload: Buffer.from('{"type":1,"content":"stale draft"}').toString('base64') });
    assert.equal(staleCAS.status, 409); assert.equal(staleCAS.body.code, 'version_conflict');
    bob.sdk.disconnect();
    await alice.sdk.chatManager.updateMessage(edited, new alice.wk.MessageText('edited while Bob was offline'));
    bob.sdk.connect();
    await until(() => bob.sdk.messageUpdateManager.hintsReady && bob.rows.get(id)?.contentVersion === '2', 'reconnect edit recovery');
    for (const route of ['/conversation/list', '/conversation/sync']) {
      bob.options.conversationRoute = route;
      const conversations = await bob.sdk.conversationManager.sync();
      assert.equal(conversations.find(c => c.channel.isEqual(bob.channel)).lastMessage.content.text, 'edited while Bob was offline');
    }
    assert.equal((await bob.history())[0].contentVersion, '2');
    let browserVerified = false, browserHintLatencyMs;
    if (process.env.WK_EDIT_PLAYWRIGHT) {
      for (const client of clients) client.close();
      const { chromium } = require(process.env.WK_EDIT_PLAYWRIGHT);
      const browser = await chromium.launch({ headless: true });
      const alicePage = await browser.newPage(), bobPage = await browser.newPage();
      try {
        const pageErrors = [];
        for (const [page, uid, peer] of [[alicePage, 'alice', 'bob'], [bobPage, 'bob', 'alice']]) {
          page.setDefaultTimeout(60000);
          page.on('pageerror', error => pageErrors.push(error.message));
          await page.goto(base);
          await page.evaluate(() => { window.editEvents = []; sdk.eventManager.addEventListener(e => window.editEvents.push({ type: e.type, data: e.dataJson })); });
          await page.locator('#uid').fill(uid);
          await page.locator('#secret').fill(users[uid]);
          await page.locator('#login button').click();
          await page.waitForFunction(() => document.querySelector('#status').textContent === '已连接');
          await page.locator('#peer').fill(peer);
          await page.locator('#open').click();
          await page.locator('#messages li').first().waitFor();
        }
        await alicePage.locator('#text').fill('browser original');
        await alicePage.locator('#compose button').click();
        await bobPage.getByText('browser original', { exact: true }).waitFor();
        const browserUnread = await bobPage.evaluate(() => sdk.conversationManager.findConversation(channel).unread);
        const browserHintStarted = Date.now();
        alicePage.once('dialog', dialog => dialog.accept('browser edited'));
        await alicePage.locator('#messages li').filter({ hasText: 'browser original' }).getByRole('button', { name: '编辑' }).click();
        await bobPage.getByText('browser edited', { exact: true }).waitFor();
        browserHintLatencyMs = Date.now() - browserHintStarted;
        assert.ok(await bobPage.evaluate(() => window.editEvents.some(e => e.type === 'message_updated')));
        assert.equal(await bobPage.evaluate(() => sdk.conversationManager.findConversation(channel).unread), browserUnread);
        await bobPage.waitForFunction(() => document.querySelector('#preview').textContent.includes('browser edited'));
        assert.deepEqual(pageErrors, []);
        await bobPage.screenshot({ path: path.join(dir, 'browser-example.png'), fullPage: true });
        browserVerified = true;
      } catch (error) {
        console.error('Browser state:', { alice: await alicePage.locator('body').innerText(), bob: await bobPage.locator('body').innerText(),
          debug: await bobPage.evaluate(() => ({ hidden: document.hidden, ready: sdk.messageUpdateManager.hintsReady,
            suspended: sdk.messageUpdateManager.suspended, foreground: sdk.messageUpdateManager.foreground,
            cursor: sdk.messageUpdateManager.active?.cursor, channel: sdk.messageUpdateManager.active?.channel,
            history: sdk.messageUpdateManager.active?.history, dirty: sdk.messageUpdateManager.active?.dirty,
            running: sdk.messageUpdateManager.active?.running, events: window.editEvents })) });
        throw error;
      } finally { await browser.close(); }
    }
    console.log(JSON.stringify({ result: 'passed', topology: 'single-node cluster', hashSlots: 256, browserVerified,
      clients: 2, onlineHintLatencyMs, browserHintLatencyMs, checks: ['EVENT opt-in', 'online edit feed', 'lost-ack idempotency', 'author policy',
        'CAS conflict', 'unread/order preservation', 'offline recovery', 'both conversation endpoints', 'history overlay'],
      backgroundErrors: clients.flatMap(c => c.errors), diagnostics: dir }, null, 2));
  } finally {
    for (const client of clients) client.close();
    if (bff) { bff.closeAllConnections(); await new Promise(resolve => bff.close(resolve)); }
    server.kill('SIGTERM');
    const kill = setTimeout(() => server.kill('SIGKILL'), 5000);
    await exit; clearTimeout(kill);
    await fs.writeFile(path.join(dir, 'server.log'), log);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
