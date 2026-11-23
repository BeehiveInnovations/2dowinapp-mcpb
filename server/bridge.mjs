import http from 'node:http';
import { Readable } from 'node:stream';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/** Forward messages to the app without interpreting tool arguments, task data or media. */
export async function connect({ port, key }, input, output) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local 2Do port.');
  const endpoint = new URL('http://127.0.0.1:' + port + '/mcp');
  // Connect to the selected loopback socket directly. Ambient proxies, HTTP redirects and server
  // discovery URLs must never receive the library credential.
  const agent = new http.Agent({ keepAlive: true, proxyEnv: {} });
  const fetchLocal = (url, init = {}) => new Promise((resolve, reject) => {
    if (new URL(url).href !== endpoint.href) { reject(new Error('Unexpected 2Do endpoint.')); return; }
    const request = http.request(endpoint, {
      agent, method: init.method, headers: Object.fromEntries(new Headers(init.headers)),
      signal: init.method === 'DELETE' ? AbortSignal.timeout(1000) : init.signal
    }, response => {
      const status = response.statusCode;
      if (status >= 300 && status <= 399) {
        response.resume();
        reject(new Error('2Do returned a redirect.'));
        return;
      }
      const empty = [204, 205, 304].includes(status);
      if (empty) response.resume();
      resolve(new Response(empty ? null : Readable.toWeb(response), { status, headers: response.headers }));
    });
    request.on('error', reject);
    request.end(init.body);
  });
  const remote = new StreamableHTTPClientTransport(endpoint, {
    fetch: fetchLocal, requestInit: { headers: { Authorization: 'Bearer ' + key } }
  });
  const stdio = new StdioServerTransport(input, output, { maxBufferSize: 1024 * 1024 });
  let initializeId;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    // Give a live app the chance to drop its session before closing the process's streams.
    // A closing or already stopped app can no longer acknowledge that final DELETE.
    try { await remote.terminateSession(); } catch { /* The stdio client has closed. */ }
    try { await remote.close(); } finally { agent.destroy(); await stdio.close(); }
  }
  stdio.onmessage = message => {
    if (message.method === 'initialize') initializeId = message.id;
    remote.send(message).catch(() => {
      if (!closed && 'method' in message && 'id' in message) {
        stdio.send({ jsonrpc: '2.0', id: message.id, error: { code: -32000,
          message: '2Do could not return a response. Reconnect to 2Do and check the task before repeating a change.' } }).catch(close);
      }
    });
  };
  remote.onmessage = message => {
    if (initializeId !== undefined && message.id === initializeId && message.result?.protocolVersion) {
      remote.setProtocolVersion(message.result.protocolVersion);
      initializeId = undefined;
    }
    if (!closed) stdio.send(message).catch(close);
  };
  // Transport errors for individual POSTs return through send(). Keep a later GET disconnect
  // from leaking response content, credentials or Windows paths to the client logs.
  await remote.start();
  await stdio.start();
  input.once('end', close);
  output.once('error', close);
  return close;
}
