import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { packExtension } from '@anthropic-ai/mcpb/cli';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const plugin = JSON.parse(await readFile(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const { version } = manifest;
const base = 'https://github.com/BeehiveInnovations/2dowinapp-mcpb';
const filename = '2do-windows.' + version + '.mcpb';
const asset = base + '/releases/download/v' + version + '/' + filename;
if (version !== metadata.version || version !== plugin.version || asset !== plugin.mcpServers ||
    (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== 'v' + version)) {
  throw new Error('The release tag, package, manifest and plugin must describe the same release.');
}
const out = path.join(root, 'dist');
await mkdir(out, { recursive: true });
// Stage only public release files. Repeated builds never pick up a local config or unrelated repo file.
const temp = await mkdtemp(path.join(os.tmpdir(), '2do-windows-mcpb-'));
try {
  for (const file of ['manifest.json', 'LICENSE', 'README.md', 'assets/2do-icon.png']) {
    const dest = path.join(temp, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(path.join(root, file), dest);
  }
  const bundled = await build({ absWorkingDir: root, entryPoints: ['server/main.mjs'],
    outfile: path.join(temp, 'server/index.cjs'), bundle: true, platform: 'node', target: 'node22',
    format: 'cjs', minify: false, legalComments: 'eof', metafile: true });
  const notices = [];
  const packages = new Set();
  for (const input of Object.keys(bundled.metafile.inputs)) {
    const match = /^(.+?node_modules\/|node_modules\/)((?:@[^/]+\/)?[^/]+)/.exec(input);
    if (match) packages.add(match[0]);
  }
  for (const directory of [...packages].sort()) {
    const pathname = path.join(root, directory);
    const pkg = JSON.parse(await readFile(path.join(pathname, 'package.json'), 'utf8'));
    const licenses = (await readdir(pathname)).filter(name => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(name));
    if (!licenses.length) throw new Error('Missing distribution license for ' + pkg.name);
    notices.push(pkg.name + ' ' + pkg.version);
    for (const name of licenses) notices.push(await readFile(path.join(pathname, name), 'utf8'));
  }
  await writeFile(path.join(temp, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'));
  const artifact = path.join(out, filename);
  if (!await packExtension({ extensionPath: temp, outputPath: artifact })) throw new Error('MCPB packaging failed.');
  const hash = createHash('sha256').update(await readFile(artifact)).digest('hex');
  await writeFile(path.join(out, 'SHA256SUMS'), hash + '  ' + filename + '\n');
  await writeFile(path.join(out, 'server.json'), JSON.stringify({
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name: 'io.github.BeehiveInnovations/2dowinapp-mcpb', title: '2Do for Windows', version,
    description: manifest.description, repository: { url: base, source: 'github' },
    websiteUrl: manifest.documentation, packages: [{ registryType: 'mcpb', identifier: asset,
      fileSha256: hash, transport: { type: 'stdio' } }]
  }, null, 2) + '\n');
} finally {
  await rm(temp, { recursive: true, force: true });
}
