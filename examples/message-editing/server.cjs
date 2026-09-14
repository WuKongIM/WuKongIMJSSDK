// Loopback-only development BFF. Credentials come from the operator, never the browser UID alone.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');

function createEditingDemo({ productURL, users }) {
  if (!users || Object.keys(users).length < 2 || Object.values(users).some(v => typeof v !== 'string' || v.length < 12)) {
    throw new Error('Configure at least two demo users with credentials of at least 12 characters');
  }
  const upstream = async (route, body) => {
    const result = await fetch(new URL(route, productURL), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return { status: result.status, body: await result.text(), epoch: result.headers.get('x-wk-content-epoch') };
  };
  return http.createServer(async (req, res) => {
    const reply = (status, value, epoch) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
        ...(epoch ? { 'x-wk-content-epoch': epoch } : {}) });
      res.end(typeof value === 'string' ? value : JSON.stringify(value));
    };
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/sdk.js')) {
        const file = req.url === '/' ? path.join(__dirname, 'index.html') : path.join(__dirname, '../../lib/wukongimjssdk.umd.js');
        res.writeHead(200, { 'content-type': req.url === '/' ? 'text/html; charset=utf-8' : 'application/javascript', 'cache-control': 'no-store' });
        res.end(await fs.readFile(file)); return;
      }
      const auth = /^Bearer ([^:]+):(.+)$/.exec(req.headers.authorization || '');
      const expected = auth && users[auth[1]];
      if (!expected || Buffer.byteLength(auth[2]) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(auth[2]), Buffer.from(expected))) {
        reply(401, { code: 'unauthorized' }); return;
      }
      const uid = auth[1];
      if (req.method !== 'POST') { reply(405, { code: 'method_not_allowed' }); return; }
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { reply(413, { code: 'body_too_large' }); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (req.url === '/session') {
        const registered = await upstream('/user/token', { uid, token: expected, device_flag: 1, device_level: 1 });
        if (registered.status !== 200) { reply(registered.status, registered.body); return; }
        const route = await upstream('/route');
        if (route.status !== 200) { reply(route.status, route.body); return; }
        const addresses = JSON.parse(route.body);
        reply(200, { uid, token: expected, websocket: addresses.wss_addr || addresses.ws_addr }); return;
      }
      const allowed = ['/message/update', '/channel/messageupdates', '/channel/messagesync', '/conversation/list', '/conversation/sync'];
      if (!allowed.includes(req.url)) { reply(404, { code: 'not_found' }); return; }
      if (req.url.startsWith('/channel/') || req.url === '/message/update') {
        // This example intentionally implements only person chats between configured demo accounts.
        if (body.channel_type !== 1 || !users[body.channel_id] || body.channel_id === uid) {
          reply(403, { code: 'channel_not_accessible' }); return;
        }
      }
      if (req.url === '/message/update') {
        const id = body.message_id;
        if (typeof id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(id) || BigInt(id) > 18446744073709551615n) {
          reply(400, { code: 'invalid_request' }); return;
        }
        // Product /messages expects JSON uint64 values. Keep the validated decimal exact.
        const base = JSON.stringify({ login_uid: uid, channel_id: body.channel_id, channel_type: 1 });
        const current = await upstream('/messages', base.slice(0, -1) + ',"message_ids":[' + id + ']}');
        if (current.status !== 200) { reply(current.status, current.body); return; }
        const message = JSON.parse(current.body).messages?.find(m => m.message_idstr === id);
        if (!message) { reply(404, { code: 'message_not_found' }); return; }
        // Author and send timestamp are immutable; an idempotent retry uses the same policy.
        if (message.from_uid !== uid || Date.now() / 1000 - message.timestamp > 600) {
          reply(403, { code: 'edit_not_allowed', msg: 'Only your own messages from the last ten minutes can be edited' }); return;
        }
      }
      const result = await upstream(req.url, { ...body, login_uid: uid, uid });
      reply(result.status, result.body, result.epoch);
    } catch (error) {
      reply(error instanceof SyntaxError ? 400 : 503, { code: error instanceof SyntaxError ? 'invalid_request' : 'unavailable' });
    }
  });
}

if (require.main === module) {
  const server = createEditingDemo({ productURL: process.env.WK_EDIT_PRODUCT_URL || 'http://127.0.0.1:5001',
    users: JSON.parse(process.env.WK_EDIT_USERS || '{}') });
  server.listen(Number(process.env.WK_EDIT_PORT || 5178), '127.0.0.1', () => {
    console.log(`Message editing demo: http://127.0.0.1:${server.address().port}`);
  });
}
module.exports = { createEditingDemo };
