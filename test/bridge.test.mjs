import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { connect } from '../server/bridge.mjs';

async function listener(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return server.address().port;
}

async function bridge(t, port) {
  const input = new PassThrough();
  const output = new PassThrough();
  const close = await connect({ port, key: 'fixture' }, input, output);
  t.after(close);
  const lines = createInterface({ input: output })[Symbol.asyncIterator]();
  return { send(message) { input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'); },
    async receive() { return JSON.parse((await lines.next()).value); } };
}

test('forwards JSON and event streams, including the session, negotiated version, media and cancellations', { timeout: 10000 }, async t => {
  const audio = Buffer.alloc(8 * 1024 * 1024, 0xa9).toString('base64');
  let cancel;
  const cancelled = new Promise(resolve => { cancel = resolve; });
  const port = await listener(t, async (req, res) => {
    assert.equal(req.url, '/mcp');
    assert.equal(req.headers.authorization, 'Bearer fixture');
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    for await (const part of req) body += part;
    const msg = JSON.parse(body);
    if (msg.method === 'initialize') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'one' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-11-25' } }));
      return;
    }
    assert.equal(req.headers['mcp-session-id'], 'one');
    assert.equal(req.headers['mcp-protocol-version'], '2025-11-25');
    if (msg.method === 'notifications/cancelled') {
      cancel(msg.params.requestId);
      res.writeHead(202).end();
      return;
    }
    assert.deepEqual(msg.params, { name: 'read_attachment', arguments: { task_id: 'task', attachment_id: 'voice' } });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: msg.id,
      result: { content: [{ type: 'audio', mimeType: 'audio/x-caf', data: audio }] } }) + '\n\n');
  });
  const client = await bridge(t, port);
  client.send({ id: 5, method: 'initialize', params: {} });
  assert.equal((await client.receive()).result.protocolVersion, '2025-11-25');
  client.send({ id: 6, method: 'tools/call', params: { name: 'read_attachment', arguments: { task_id: 'task', attachment_id: 'voice' } } });
  const media = await client.receive();
  assert.equal(media.id, 6);
  assert.equal(media.result.content[0].data, audio);
  client.send({ method: 'notifications/cancelled', params: { requestId: 7 } });
  assert.equal(await cancelled, 7);
});

test('refuses redirects without forwarding the credential or replaying a write', { timeout: 5000 }, async t => {
  let redirected = false;
  const other = await listener(t, (_req, res) => { redirected = true; res.end(); });
  let attempts = 0;
  const local = await listener(t, (_req, res) => {
    attempts++;
    res.writeHead(307, { Location: 'http://127.0.0.1:' + other + '/mcp' }).end();
  });
  const client = await bridge(t, local);
  client.send({ id: 'write', method: 'tools/call', params: { name: 'create_task', arguments: { title: 'Example' } } });
  const reply = await client.receive();
  assert.equal(reply.id, 'write');
  assert.equal(reply.error.code, -32000);
  assert.equal(attempts, 1);
  assert.equal(redirected, false);
});
