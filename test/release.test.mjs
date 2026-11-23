import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { publishRelease } from '../scripts/publish.mjs';

const repository = 'BeehiveInnovations/2dowinapp-mcpb';
const tag = 'v0.1.0';
const filename = '2do-windows.0.1.0.mcpb';
const base = `https://github.com/${repository}/releases/download/${tag}/`;
const lookup = `https://api.github.com/repos/${repository}/releases/tags/${tag}`;

function github({ exists = true, corrupted = false, lookupStatus } = {}) {
  const bundle = Buffer.from('published bundle bytes');
  const checksum = createHash('sha256').update(bundle).digest('hex');
  const files = new Map([
    [filename, corrupted ? Buffer.from('different published bytes') : bundle],
    ['SHA256SUMS', `${checksum}  ${filename}\n`],
    ['server.json', JSON.stringify({ version: '0.1.0', packages: [
      { registryType: 'mcpb', identifier: base + filename, fileSha256: checksum }
    ] })]
  ]);
  const writes = [];
  const services = {
    async request(url, options) {
      if (url === lookup) {
        assert.equal(options.headers.Authorization, 'Bearer fixture');
        const assets = [...files.keys()].map(name => ({ name, state: 'uploaded', browser_download_url: base + name }));
        return Response.json({ tag_name: tag, draft: false, assets }, { status: lookupStatus ?? (exists ? 200 : 404) });
      }
      assert.ok(url.startsWith(base));
      assert.equal(options?.headers?.Authorization, undefined);
      return new Response(files.get(url.slice(base.length)));
    },
    create(releaseTag, name) {
      // GitHub refuses to create a second release under the same tag.
      if (exists) throw new Error('a release with the same tag name already exists');
      writes.push([releaseTag, name]);
      exists = true;
    }
  };
  return { services, writes };
}

test('a tag can be published twice without replacing the original downloads', async () => {
  const { services, writes } = github({ exists: false });
  const options = { repository, tag, token: 'fixture' };
  await publishRelease(options, services);
  await publishRelease(options, services);
  assert.deepEqual(writes, [[tag, filename]]);
});

test('an existing release must contain the bytes described by its two checksum records', async () => {
  const { services, writes } = github({ corrupted: true });
  await assert.rejects(publishRelease({ repository, tag, token: 'fixture' }, services), /checksum/);
  assert.deepEqual(writes, []);
});

test('verification and failed lookups cannot create a release', async () => {
  const options = { repository, tag, token: 'fixture' };
  const missing = github({ exists: false });
  await assert.rejects(publishRelease({ ...options, verifyOnly: true }, missing.services), /not published/);
  const denied = github({ lookupStatus: 403 });
  await assert.rejects(publishRelease(options, denied.services), /HTTP 403/);
  assert.deepEqual([...missing.writes, ...denied.writes], []);
});
