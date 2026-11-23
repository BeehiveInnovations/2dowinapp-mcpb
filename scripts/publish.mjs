import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

function create(tag, filename) {
  execFileSync('gh', ['release', 'create', tag, 'dist/' + filename, 'dist/SHA256SUMS', 'dist/server.json',
    '--verify-tag', '--generate-notes', '--title', '2Do for Windows MCP ' + tag], { stdio: 'inherit' });
}

/** Publish a new tag or verify its existing public downloads. Manual checks only read published releases. */
export async function publishRelease({ repository, tag, token, verifyOnly = false }, services = { request: fetch, create }) {
  if (!/^v\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(tag)) throw new Error('Enter a version tag such as v0.1.0.');
  const version = tag.slice(1);
  const filename = '2do-windows.' + version + '.mcpb';
  const api = 'https://api.github.com/repos/' + repository + '/releases/tags/' + encodeURIComponent(tag);
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  let response = await services.request(api, { headers });
  if (response.status === 404) {
    if (verifyOnly) throw new Error(tag + ' is not published.');
    await services.create(tag, filename);
    response = await services.request(api, { headers });
  }
  if (!response.ok) throw new Error('GitHub release lookup returned HTTP ' + response.status + '.');
  const release = await response.json();
  if (release.tag_name !== tag || release.draft) throw new Error('Expected a published release for ' + tag + '.');

  // Zip timestamps can differ between builds. Check the bytes people actually download against
  // both published checksum records. A repeated tag push must preserve those bytes and URLs.
  const base = 'https://github.com/' + repository + '/releases/download/' + tag + '/';
  async function download(name) {
    const asset = release.assets.find(item => item.name === name && item.state === 'uploaded');
    if (!asset) throw new Error('Missing published file: ' + name);
    const url = base + name;
    if (asset.browser_download_url !== url) throw new Error('Unexpected download URL for ' + name);
    const file = await services.request(url);
    if (!file.ok) throw new Error('Could not download ' + name + ': HTTP ' + file.status);
    return file;
  }
  const [bundle, sums, registry] = await Promise.all([download(filename), download('SHA256SUMS'), download('server.json')]);
  const digest = createHash('sha256').update(Buffer.from(await bundle.arrayBuffer())).digest('hex');
  const metadata = await registry.json();
  const entry = metadata.packages?.find(item => item.registryType === 'mcpb' && item.identifier === base + filename);
  if ((await sums.text()).trim() !== digest + '  ' + filename || metadata.version !== version || entry?.fileSha256 !== digest) {
    throw new Error('The published checksum or MCP Registry metadata does not match ' + filename + '.');
  }
  return digest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const verifyOnly = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const tag = verifyOnly ? process.env.VERIFY_TAG : process.env.GITHUB_REF_NAME;
  const digest = await publishRelease({ repository: process.env.GITHUB_REPOSITORY, tag, token: process.env.GH_TOKEN, verifyOnly });
  console.log('Verified the published bundle for ' + tag + ' (SHA-256 ' + digest + ').');
}
