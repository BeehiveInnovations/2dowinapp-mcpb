import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// Keep PowerShell limited to the OS APIs for process registration, TCP ownership and DPAPI.
// The commands are constant. User settings and credentials never appear in a command line.
const enumerate = `
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$apps = @(Get-Process -Name 'TwoDo.WindowsHost' -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object Id,Path)
$ports = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $apps.Id } | Select-Object LocalPort,OwningProcess)
$packages = @(Get-AppxPackage -Name 'Beehive.TwoDo*' | Select-Object Name,PackageFamilyName,InstallLocation)
@{apps=$apps; ports=$ports; packages=$packages} | ConvertTo-Json -Depth 4 -Compress`;

const unprotect = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([Console]::In.ReadToEnd()), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))`;

function windowsQuery(command, input = '') {
  return new Promise((resolve, reject) => {
    const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = execFile(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, encoding: 'utf8', timeout: 20000 }, (error, stdout) => {
        if (error) reject(new Error('Windows could not read the local 2Do connection.'));
        else resolve(stdout);
      });
    child.stdin.on('error', () => {}); // A failed PowerShell launch also reports through the callback.
    child.stdin.end(input);
  });
}

async function optional(pathname, read) {
  try { return await read(pathname); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
    throw error;
  }
}

/** Find enabled libraries whose listener belongs to the running app that owns the settings. */
export async function locateConnection(localData, { apps, ports, packages }, requestedUrl = '') {
  let port;
  if (requestedUrl) {
    const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/mcp$/.exec(requestedUrl);
    if (!match || Number(match[1]) > 65535) throw new Error('Choose the local URL shown in 2Do Settings > Automation.');
    port = Number(match[1]);
  }
  const matches = [];
  for (const app of apps) {
    const appPath = app.Path.toLowerCase();
    const owner = packages.find(pkg => pkg.InstallLocation && appPath.startsWith(pkg.InstallLocation.toLowerCase() + '\\'));
    if (owner && owner.Name !== 'Beehive.TwoDo' && !owner.Name.startsWith('Beehive.TwoDo.')) continue;
    const base = owner ? path.join(localData, 'Packages', owner.PackageFamilyName, 'LocalCache') : localData;
    const root = path.join(base, '2Do', 'Automation');
    const libraries = await optional(root, pathname => readdir(pathname, { withFileTypes: true }));
    for (const library of libraries ?? []) {
      if (!library.isDirectory() || !/^[a-f0-9]{32}$/i.test(library.name)) continue;
      const content = await optional(path.join(root, library.name, 'connection.json'), pathname => readFile(pathname, 'utf8'));
      if (!content) continue;
      const saved = JSON.parse(content);
      if (!Number.isInteger(saved.Port) || saved.Port < 1 || saved.Port > 65535 || !saved.ProtectedKey || (port && saved.Port !== port)) continue;
      if (ports.some(tcp => tcp.OwningProcess === app.Id && tcp.LocalPort === saved.Port)) {
        matches.push({ port: saved.Port, protectedKey: saved.ProtectedKey });
      }
    }
  }
  if (!matches.length) throw new Error('Open 2Do, turn on Settings > Automation and use its current local URL.');
  if (matches.length > 1) throw new Error('Several libraries are open. Choose the local URL of the library you want.');
  return matches[0];
}

/** Read the shared key only after choosing exactly one running library. */
export async function discover() {
  if (process.platform !== 'win32') throw new Error('This connector runs on the Windows PC where 2Do is open.');
  const state = JSON.parse(await windowsQuery(enumerate));
  const found = await locateConnection(process.env.LOCALAPPDATA, state, process.env.TWODO_MCP_URL);
  const key = await windowsQuery(unprotect, found.protectedKey);
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Windows could not read the 2Do access key.');
  return { port: found.port, key };
}
