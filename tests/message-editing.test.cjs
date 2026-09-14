const test = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../lib/wukongimjssdk.cjs.js');
const { Channel, Message, MessageText, Conversation, SyncOptions, Provider,
  MessageUpdateManager, WKEventManager, EventPacket, WKEvent, ConnectStatus,
  MessageUpdateError, messageFromHTTP, installMessageEditing, compareDecimal } = sdk;

// The existing SDK owns a receipt interval; it must not keep this test process alive.
sdk.WKSDK.shared().receiptManager.timer.unref();
const channel = new Channel('group-with-hyphens', 2);
const response = (data, contentEpoch = '7') => ({ data, contentEpoch });
function message(version = '0', text = 'original', seq = 100) {
  return Object.assign(new Message(), { messageID: String(seq), messageSeq: seq,
    channel, content: new MessageText(text), contentVersion: version, timestamp: 123,
    fromUID: 'alice', clientMsgNo: `client-${seq}` });
}
function page(cursor, updates = [], more = false, resetRequired = false) {
  return response({ nextUpdateCursor: cursor, updates, more, resetRequired });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
async function tick(t, ms = 100) { t.mock.timers.tick(ms); await settle(); }
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [], changes = [], errors = [], packets = [], notifications = [];
  const conversations = {
    conversations: [], openConversation: undefined,
    findConversation(c) { return this.conversations.find(x => x.channel.isEqual(c)); },
    notifyConversationListeners(c) { notifications.push(c); },
    removeConversation(c) { this.conversations = this.conversations.filter(x => !x.channel.isEqual(c)); },
  };
  const connectManager = { status: ConnectStatus.Disconnect, listeners: [],
    addConnectStatusListener(l) { this.listeners.push(l); },
    removeConnectStatusListener(l) { this.listeners = this.listeners.filter(x => x !== l); },
    sendPacket(p) { packets.push(p); },
  };
  const provider = new Provider();
  provider.syncMessagesCallback = async () => { calls.push('history'); return response([message()]); };
  provider.syncConversationsCallback = async () => { calls.push('conversations'); return response([]); };
  provider.syncMessageUpdatesCallback = async (_, opts) => {
    calls.push(`updates:${opts.updateCursor}`);
    return opts.updateCursor ? page('C1') : page('C0', [], false, true);
  };
  provider.updateMessageCallback = async (request) => response({ messageID: request.messageID,
    messageSeq: 100, version: '1', updatedAtMs: 1000 });
  const owner = { config: { uid: 'alice', token: 'private', addr: 'wss://example.test', provider },
    conversationManager: conversations, connectManager, eventManager: new WKEventManager() };
  const manager = new MessageUpdateManager(owner);
  owner.messageUpdateManager = manager;
  manager.enable({ onError: e => errors.push(e) });
  manager.addListener(m => changes.push(m));
  manager.setActive(channel);
  const hint = (id = '100', c = channel) => {
    owner.eventManager.notifyEventListeners({ type: 'message_updates.ready', dataJson: { enabled: true } });
    owner.eventManager.notifyEventListeners({ type: 'message_updated', dataJson: {
      channel_id: c.channelID, channel_type: c.channelType, message_id: id, version: '999' } });
  };
  t.after(() => manager.disable());
  return { manager, owner, provider, calls, changes, errors, packets, notifications, conversations, hint };
}

test('bootstrap reads a baseline before history and catches edits made during history', async t => {
  const f = fixture(t);
  f.provider.syncMessageUpdatesCallback = async (_, opts) => {
    f.calls.push(`updates:${opts.updateCursor}`);
    return opts.updateCursor ? page('C1', [message('1', 'edited')]) : page('C0', [], false, true);
  };
  const initial = await f.manager.syncMessages(channel, new SyncOptions());
  assert.deepEqual(f.calls, ['updates:', 'history']);
  assert.equal(initial[0].content.text, 'original');
  await tick(t);
  assert.equal(f.changes.at(-1)[0].content.text, 'edited');
  assert.equal(f.manager.active.cursor, 'C1');
});

test('failed history never commits the baseline cursor', async t => {
  const f = fixture(t);
  f.provider.syncMessagesCallback = async () => { throw new MessageUpdateError('forbidden', '', 403); };
  await assert.rejects(f.manager.syncMessages(channel, new SyncOptions()), { code: 'forbidden' });
  assert.equal(f.manager.active.cursor, undefined);
  assert.equal(f.changes.length, 0);
});

test('bootstrap restarts when history crosses into a higher restore epoch', async t => {
  const f = fixture(t);
  let heads = 0;
  f.provider.syncMessageUpdatesCallback = async () => response(page('C0', [], false, true).data, ++heads === 1 ? '7' : '8');
  f.provider.syncMessagesCallback = async () => response([message()], '8');
  const result = await f.manager.syncMessages(channel, new SyncOptions());
  assert.equal(heads, 2);
  assert.equal(result[0].contentEpoch, '8');
});

test('an empty more=true page advances and keeps pulling', async t => {
  const f = fixture(t);
  await f.manager.syncMessages(channel, new SyncOptions());
  f.provider.syncMessageUpdatesCallback = async (_, opts) => {
    f.calls.push(opts.updateCursor);
    return opts.updateCursor === 'C0' ? page('C1', [], true) : page('C2', [message('2', 'latest')]);
  };
  await tick(t);
  assert.deepEqual(f.calls.slice(-2), ['C0', 'C1']);
  assert.equal(f.manager.active.cursor, 'C2');
});

test('a hint received during an in-flight sync is not lost', async t => {
  const f = fixture(t), first = deferred();
  await f.manager.syncMessages(channel, new SyncOptions());
  let reads = 0;
  f.provider.syncMessageUpdatesCallback = async () => ++reads === 1 ? first.promise : page('C2', [message('2', 'second')]);
  await tick(t);
  for (let i = 0; i < 100; i++) f.hint();
  assert.equal(reads, 1);
  first.resolve(page('C1', [message('1', 'first')]));
  await settle(); await tick(t);
  assert.equal(reads, 2);
  assert.equal(f.changes.at(-1)[0].contentVersion, '2');
});

test('leaving a channel discards a late history response', async t => {
  const f = fixture(t), history = deferred();
  f.provider.syncMessagesCallback = () => history.promise;
  const loading = f.manager.syncMessages(channel, new SyncOptions());
  await settle();
  f.manager.setActive(new Channel('other', 2));
  history.resolve(response([message()]));
  await assert.rejects(loading, { code: 'cancelled' });
  assert.equal(f.changes.length, 0);
});

test('account changes reject late responses and clear old conversation state', async t => {
  const f = fixture(t), history = deferred();
  f.provider.syncMessagesCallback = () => history.promise;
  const loading = f.manager.syncMessages(channel, new SyncOptions());
  await settle(); f.owner.config.uid = 'carol'; history.resolve(response([message()]));
  await assert.rejects(loading, { code: 'cancelled' });
  assert.equal(f.manager.cache.size, 0);
});

test('new epoch permits lower versions, old epoch responses cannot overwrite it', async t => {
  const f = fixture(t);
  f.provider.syncMessagesCallback = async () => response([message('9', 'old generation')]);
  await f.manager.syncMessages(channel, new SyncOptions());
  f.provider.syncMessageUpdatesCallback = async () => response(page('NEW', [], false, true).data, '8');
  f.provider.syncMessagesCallback = async () => response([message('1', 'restored')], '8');
  await tick(t);
  assert.equal(f.changes.at(-1)[0].content.text, 'restored');
  assert.equal(f.changes.at(-1)[0].contentVersion, '1');
  f.provider.syncMessagesCallback = async () => response([message('99', 'stale')], '7');
  await assert.rejects(f.manager.syncMessages(channel, new SyncOptions()), { code: 'stale_response' });
});

test('a stale original history row cannot replace an edited payload', async t => {
  const f = fixture(t);
  f.provider.syncMessagesCallback = async () => response([message('3', 'new')]);
  await f.manager.syncMessages(channel, new SyncOptions());
  f.provider.syncMessagesCallback = async () => response([message()]);
  const rows = await f.manager.syncMessages(channel, new SyncOptions());
  assert.equal(rows[0].content.text, 'new');
  assert.equal(f.manager.observeMessage(message()).content.text, 'new');
});

test('edits update only a matching preview, preserving unread and ordering', async t => {
  const f = fixture(t);
  const conversation = Object.assign(new Conversation(), { channel, unread: 9, timestamp: 123, lastMessage: message() });
  f.conversations.conversations.push(conversation);
  await f.manager.syncMessages(channel, new SyncOptions());
  f.provider.syncMessageUpdatesCallback = async () => page('C1', [message('1', 'edited')]);
  await tick(t);
  assert.equal(conversation.lastMessage.content.text, 'edited');
  assert.equal(conversation.unread, 9); assert.equal(conversation.timestamp, 123);
  conversation.lastMessage = message('0', 'new tail', 101);
  f.provider.syncMessageUpdatesCallback = async () => page('C2', [message('2', 'older edit')]);
  f.hint(); await tick(t);
  assert.equal(conversation.lastMessage.messageID, '101');
});

test('1000 inactive-channel hints coalesce into a conversation refresh, never 1000 feeds', async t => {
  const f = fixture(t);
  await f.manager.syncMessages(channel, new SyncOptions()); await tick(t);
  f.calls.length = 0;
  for (let i = 0; i < 1000; i++) {
    const c = new Channel(`inactive-${i}`, 2);
    f.conversations.conversations.push(Object.assign(new Conversation(), { channel: c, lastMessage: message() }));
    f.hint('100', c);
  }
  await tick(t);
  assert.deepEqual(f.calls, ['conversations']);
});

test('unknown feed messages never create new chat rows', async t => {
  const f = fixture(t);
  await f.manager.syncMessages(channel, new SyncOptions());
  f.changes.length = 0;
  f.provider.syncMessageUpdatesCallback = async () => page('C1', [message('1', 'not loaded', 90)]);
  await tick(t);
  assert.equal(f.changes.length, 0); assert.equal(f.manager.active.cursor, 'C1');
});

test('uncertain writes retry an identical frozen request and never blindly rebase', async t => {
  const f = fixture(t), seen = [];
  const [original] = await f.manager.syncMessages(channel, new SyncOptions());
  f.provider.updateMessageCallback = async req => {
    seen.push(JSON.stringify(req));
    if (seen.length < 3) throw new MessageUpdateError('unavailable', '', 503);
    return response({ messageID: '100', messageSeq: 100, version: '1', updatedAtMs: 10 });
  };
  const edit = f.manager.updateMessage(original, new MessageText('edited'));
  await settle(); await tick(t, 1000); await tick(t, 1000);
  assert.equal((await edit).content.text, 'edited');
  assert.equal(seen.length, 3); assert.equal(new Set(seen).size, 1);
});

test('historical idempotency acknowledgement cannot overwrite a newer observed edit', async t => {
  const f = fixture(t), ack = deferred();
  const [original] = await f.manager.syncMessages(channel, new SyncOptions());
  f.provider.updateMessageCallback = () => ack.promise;
  const editing = f.manager.updateMessage(original, new MessageText('first edit'));
  f.provider.syncMessageUpdatesCallback = async () => page('C2', [message('2', 'second edit')]);
  await tick(t);
  ack.resolve(response({ messageID: '100', messageSeq: 100, version: '1', updatedAtMs: 10 }));
  assert.equal((await editing).content.text, 'second edit');
});

test('missing metadata is calibrated but a different displayed payload causes conflict', async t => {
  const f = fixture(t);
  f.provider.syncMessagesCallback = async () => response([message('1', 'someone edited')]);
  let writes = 0; f.provider.updateMessageCallback = async () => { writes++; };
  await assert.rejects(f.manager.updateMessage(message(), new MessageText('draft')), { code: 'version_conflict' });
  assert.equal(writes, 0);
});

test('editing a live message calibrates its exact inclusive range in the newer direction', async t => {
  const f = fixture(t);
  f.provider.syncMessagesCallback = async (_, opts) => {
    assert.equal(opts.startMessageSeq, 100);
    assert.equal(opts.endMessageSeq, 101);
    assert.equal(opts.pullMode, sdk.PullMode.Up);
    assert.equal(opts.limit, 1);
    return response([message()]);
  };
  const edited = await f.manager.updateMessage(message(), new MessageText('live edit'));
  assert.equal(edited.content.text, 'live edit');
  assert.equal(edited.contentVersion, '1');
});

test('CMD, SyncOnce, nonpersistent and stream messages are rejected before transport', async t => {
  const f = fixture(t);
  for (const header of [{ syncOnce: true }, { noPersist: true }]) {
    const m = message(); Object.assign(m.header, header);
    await assert.rejects(f.manager.updateMessage(m, new MessageText('draft')), { code: 'message_not_updatable' });
  }
  const m = message(); m.content = { contentType: sdk.MessageContentType.cmd };
  await assert.rejects(f.manager.updateMessage(m, new MessageText('draft')), { code: 'message_not_updatable' });
});

test('listener failures cannot prevent committing a cursor', async t => {
  const f = fixture(t);
  await f.manager.syncMessages(channel, new SyncOptions());
  f.manager.addListener(() => { throw new Error('UI failed'); });
  f.provider.syncMessageUpdatesCallback = async () => page('C1', [message('1', 'new')]);
  await tick(t);
  assert.equal(f.manager.active.cursor, 'C1');
  assert.equal(f.errors[0].message, 'UI failed');
});

test('legacy provider arrays are rejected only in enabled edit mode', async t => {
  const f = fixture(t);
  f.provider.syncMessagesCallback = async () => [message()];
  await assert.rejects(f.manager.syncMessages(channel, new SyncOptions()), { code: 'content_epoch_missing' });
});

test('EVENT opt-in encodes and decodes, renegotiating on every connection', t => {
  const f = fixture(t);
  for (const l of f.owner.connectManager.listeners) { l(ConnectStatus.Connected); l(ConnectStatus.Connected); }
  assert.equal(f.packets.length, 2);
  const proto = f.owner.config.proto = sdk.WKSDK.shared().config.proto;
  const event = new WKEvent(proto.decode(proto.encode(f.packets[0])));
  assert.equal(event.type, 'message_updates.enable');
  assert.deepEqual(event.dataJson, { enabled: true });
  const bad = new EventPacket(); bad.data = Buffer.from('not json');
  assert.doesNotThrow(() => new WKEvent(bad));
});

test('HTTP conversion preserves uint64 strings, rejects rounded identities and decodes large content', () => {
  const payload = Buffer.from(JSON.stringify({ type: 1, content: '中'.repeat(100000) })).toString('base64');
  const row = { message_idstr: '18446744073709551615', message_seq: '100', channel_id: 'G', channel_type: 2,
    version: '9007199254740993', payload };
  const m = messageFromHTTP(row);
  assert.equal(m.messageID, row.message_idstr); assert.equal(m.contentVersion, row.version);
  assert.equal(m.content.text.length, 100000);
  assert.throws(() => messageFromHTTP({ ...row, message_idstr: undefined, message_id: 9007199254740993 }), { code: 'invalid_response' });
  assert.equal(compareDecimal('9007199254740993', '9007199254740992'), 1);
});

for (const route of ['/conversation/list', '/conversation/sync']) {
  test(`HTTP adapter maps latest preview and epoch from ${route}`, async t => {
    const f = fixture(t); f.manager.disable();
    const row = { message_idstr: '100', message_seq: 100, payload: Buffer.from('{"type":1,"content":"edited"}').toString('base64'), version: '2' };
    const conversation = { channel_id: channel.channelID, channel_type: 2, unread: 3,
      ...(route.endsWith('/list') ? { last_message: row } : { recents: [row] }) };
    const cleanup = installMessageEditing(f.owner, { conversationRoute: route, transport: async (path, body) => {
      assert.equal(path, route); assert.equal(body.uid, undefined);
      return { status: 200, contentEpoch: '7', body: route.endsWith('/list') ? { conversations: [conversation], deletes: [] } : [conversation] };
    } });
    t.after(cleanup);
    const [c] = await f.manager.syncConversations();
    assert.equal(c.lastMessage.content.text, 'edited'); assert.equal(c.lastMessage.contentEpoch, '7');
  });
}

test('a new conversation with an empty baseline does not spin on reset responses', async t => {
  const f = fixture(t); let reads = 0;
  f.provider.syncMessagesCallback = async () => response([]);
  f.provider.syncMessageUpdatesCallback = async () => { reads++; return page('', [], false, true); };
  await f.manager.syncMessages(channel, new SyncOptions());
  await tick(t); await tick(t, 10000);
  assert.equal(reads, 2);
});

test('a malformed page fails before changing any cached message or cursor', async t => {
  const f = fixture(t);
  await f.manager.syncMessages(channel, new SyncOptions());
  const invalid = message('1', 'bad', 101); invalid.contentVersion = 'not-a-version';
  f.provider.syncMessageUpdatesCallback = async () => page('C1', [message('1', 'would be changed'), invalid]);
  await tick(t);
  assert.equal(f.manager.active.cursor, 'C0');
  assert.equal([...f.manager.cache.values()][0].message.content.text, 'original');
  assert.equal(f.errors[0].code, 'invalid_response');
});

test('disconnect suspends proactive sync and reconnect replaces aborted history signals', async t => {
  const f = fixture(t);
  await f.manager.syncMessages(channel, new SyncOptions());
  const oldSignal = f.manager.active.controller.signal;
  f.manager.connectionClosed();
  assert.equal(oldSignal.aborted, true);
  assert.equal(f.manager.active.history.signal.aborted, false);
  f.hint(); await tick(t, 1000);
  assert.deepEqual(f.calls, ['updates:', 'history']);
  f.owner.connectManager.listeners[0](ConnectStatus.Connected);
  await tick(t);
  assert.ok(f.calls.includes('updates:C0'));
});

test('failed writes retain the request ID for an explicit identical retry', async t => {
  const f = fixture(t), attempts = [];
  const [m] = await f.manager.syncMessages(channel, new SyncOptions());
  f.provider.updateMessageCallback = async req => { attempts.push(req.requestID); throw new MessageUpdateError('network_error'); };
  const failed = assert.rejects(f.manager.updateMessage(m, new MessageText('draft')), { code: 'network_error' });
  await settle(); await tick(t, 1000); await tick(t, 1000); await failed;
  await assert.rejects(f.manager.updateMessage(m, new MessageText('different draft')), { code: 'outcome_unknown' });
  f.provider.updateMessageCallback = async req => {
    attempts.push(req.requestID); return response({ messageID: '100', messageSeq: 100, version: '1', updatedAtMs: 10 });
  };
  await f.manager.updateMessage(m, new MessageText('draft'));
  assert.equal(attempts.length, 4); assert.equal(new Set(attempts).size, 1);
});

test('cache has count and byte bounds even when many history pages are visited', async t => {
  const f = fixture(t);
  f.manager.options.maxCachedMessages = 2;
  f.manager.options.maxCachedBytes = 4096;
  for (let i = 0; i < 20; i++) {
    f.provider.syncMessagesCallback = async () => response([message('0', 'body', 100 + i)]);
    await f.manager.syncMessages(channel, new SyncOptions());
  }
  assert.equal(f.manager.cache.size, 2);
  assert.ok(f.manager.cacheBytes <= 4096);
});

test('canonical preview timestamps convert milliseconds and nanoseconds to SDK seconds', () => {
  const c = sdk.conversationFromHTTP({ channel_id: 'G', channel_type: 2, active_at: 1789300800000000000,
    last_message: { message_idstr: '100', message_seq: 1, server_timestamp_ms: 1789300800123,
      payload: Buffer.from('{"type":1,"content":"hi"}').toString('base64') } });
  assert.equal(c.timestamp, 1789300800); assert.equal(c.lastMessage.timestamp, 1789300800);
});

test('a list response cannot replace a newer live tail lacking an HTTP epoch', async t => {
  const f = fixture(t);
  const c = Object.assign(new Conversation(), { channel, unread: 3, timestamp: 20, lastMessage: message('0', 'live', 101) });
  f.conversations.conversations.push(c);
  f.provider.syncConversationsCallback = async () => response([Object.assign(new Conversation(), { channel, unread: 1, timestamp: 10, lastMessage: message() })]);
  const [result] = await f.manager.syncConversations();
  assert.equal(result.lastMessage.messageID, '101'); assert.equal(result.unread, 3);
});

test('hint versions are never committed as message versions', async t => {
  const f = fixture(t);
  await f.manager.syncMessages(channel, new SyncOptions());
  f.hint();
  assert.equal([...f.manager.cache.values()][0].message.contentVersion, '0');
  assert.equal(f.manager.active.cursor, 'C0');
});

test('a deleted conversation is removed without interpreting empty pages as deletions', async t => {
  const f = fixture(t);
  f.conversations.conversations.push(Object.assign(new Conversation(), { channel, lastMessage: message() }));
  await f.manager.syncConversations();
  assert.equal(f.conversations.conversations.length, 1);
  f.provider.syncConversationsCallback = async () => ({ ...response([]), removedChannels: [channel] });
  await f.manager.syncConversations();
  assert.equal(f.conversations.conversations.length, 0);
});

test('edit-triggered preview refresh does not change unread counts or order metadata', async t => {
  const f = fixture(t);
  const c = Object.assign(new Conversation(), { channel, unread: 3, timestamp: 20, lastMessage: message() });
  f.conversations.conversations.push(c);
  f.provider.syncConversationsCallback = async () => response([Object.assign(new Conversation(), {
    channel, unread: 99, timestamp: 40, lastMessage: message('1', 'edited preview') })]);
  f.hint(); await tick(t);
  assert.equal(c.lastMessage.content.text, 'edited preview');
  assert.equal(c.unread, 3); assert.equal(c.timestamp, 20);
});

test('re-enabling after cancelling a pending preview refresh schedules again', async t => {
  const f = fixture(t);
  f.conversations.conversations.push(Object.assign(new Conversation(), { channel, lastMessage: message() }));
  f.hint();
  f.manager.disable();
  f.manager.enable();
  f.hint(); await tick(t);
  assert.equal(f.calls.filter(c => c === 'conversations').length, 1);
});

test('conversation callback failures do not retain notifications or fail the read', async t => {
  const f = fixture(t);
  f.conversations.conversations.push(Object.assign(new Conversation(), { channel, lastMessage: message() }));
  f.provider.syncConversationsCallback = async () => response([Object.assign(new Conversation(), { channel, lastMessage: message('1', 'edited') })]);
  f.conversations.notifyConversationListeners = () => { throw new Error('application callback'); };
  const result = await f.manager.syncConversations();
  assert.equal(result[0].lastMessage.content.text, 'edited');
  assert.equal(f.errors.length, 1);
  assert.equal(f.manager.changedConversations.size, 0);
});
