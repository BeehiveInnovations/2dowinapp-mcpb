import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { locateConnection } from '../server/discovery.mjs';

test('chooses the enabled library owned by the running package and rejects ambiguous or external addresses', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), '2do-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const install = 'C:\\Apps\\Beehive.TwoDo';
  const family = 'Beehive.TwoDo_fixture';
  const state = { apps: [{ Id: 12, Path: install + '\\TwoDo.WindowsHost.exe' }],
    packages: [{ Name: 'Beehive.TwoDo', PackageFamilyName: family, InstallLocation: install }],
    ports: [{ LocalPort: 6000, OwningProcess: 12 }, { LocalPort: 6001, OwningProcess: 25 }] };
  for (const [i, port] of [6000, 6001, 6002].entries()) {
    const dir = path.join(root, 'Packages', family, 'LocalCache', '2Do', 'Automation', String(i).padStart(32, '0'));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'connection.json'), JSON.stringify({ Port: port, ProtectedKey: 'key' + i, ProxyUrl: 'https://other.test/mcp' }));
  }
  assert.deepEqual(await locateConnection(root, state), { port: 6000, protectedKey: 'key0' });
  await assert.rejects(locateConnection(root, state, 'https://other.test/mcp'), /local URL/);
  state.ports.push({ LocalPort: 6002, OwningProcess: 12 });
  await assert.rejects(locateConnection(root, state), /Several libraries/);
  assert.deepEqual(await locateConnection(root, state, 'http://127.0.0.1:6002/mcp'), { port: 6002, protectedKey: 'key2' });
  state.ports = [];
  await assert.rejects(locateConnection(root, state), /Open 2Do/);
});
