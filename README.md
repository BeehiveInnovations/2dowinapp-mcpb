# 2Do for Windows MCP

Connect your MCP client to 2Do to find and edit tasks, plan projects, organize sections, read attachments, and transcribe voice notes. The 35 tools run in the open 2Do app. Changes use the same library and Undo history as an edit in 2Do.

## Connect over HTTP

1. On your Windows PC, open a version of 2Do that includes **Settings > Automation**. Turn **Automation** on and keep the app open and unlocked.
2. For Codex or Claude Code, click **Copy command** next to the client name, paste it into PowerShell, and restart the client. For another Streamable HTTP client, choose **Copy URL** and **Copy access key** and set its `Authorization` header to `Bearer <access key>`.
3. Ask your assistant to list your 2Do lists. Then try “Create a packing checklist in my Travel list with tasks for my passport and charger.”

To connect from another device, use your own HTTPS reverse proxy. The [Windows automation guide](https://www.2doapp.com/docs/windows/mcp) explains how to configure the address, key and proxy.

## Install the desktop extension

If your client supports local MCP bundles, download **2do-windows.<version>.mcpb** from the [latest release](https://github.com/BeehiveInnovations/2dowinapp-mcpb/releases/latest) and install it in the client on the same PC as 2Do. In Claude Desktop, open **Settings > Extensions > Advanced settings > Install Extension**. Start a new chat after installation.

The bundle finds a running 2Do library with Automation enabled. If you run several enabled libraries, enter the library's local URL from Settings in the extension's optional **Local URL** field. The bundle reads the existing key using Windows data protection. Stdio clients and the Claude Code plugin use the same discovery. After replacing the key in 2Do, reconnect the client to pick up the new key automatically.

## Install the Claude Code plugin

Claude Code can also install the connector from Beehive's plugin marketplace. Enter these commands in Claude Code on the PC running 2Do.

```text
/plugin marketplace add BeehiveInnovations/2dowinapp-mcpb
/plugin install 2do-windows@beehive-2do-windows
```

Use one connection method per client to keep a single set of 2Do tools in that client.

## Connect a stdio client

Extract the release bundle as a ZIP archive into a folder of your choice. Configure the client to run Node.js 22 or newer with the absolute path to `server/index.cjs`. For example, a client using the common `mcpServers` configuration format accepts the following entry.

```json
{
  "mcpServers": {
    "2do-windows": {
      "command": "node",
      "args": ["C:/Tools/2do-windows/server/index.cjs"]
    }
  }
}
```

To choose a particular library, set `TWODO_MCP_URL` in the server's environment to the local URL shown in 2Do. The adapter talks to that library on IPv4 loopback. 2Do supplies the current tool list, permissions, data and results. Images and audio returned by a tool go to your chosen client. Voice transcription runs on the PC.

## Build and publish

Install Node.js 22 or newer, then run `npm ci --ignore-scripts`, `npm test` and `npm run build`. The build validates the desktop manifest, bundles the adapter and writes the MCPB, SHA-256 checksum and official MCP Registry metadata to `dist/`.

Update the matching versions in `package.json`, `package-lock.json`, `manifest.json`, and `.claude-plugin/plugin.json`, including the plugin's release URL. Push a matching `v<version>` tag to create a GitHub Release. That release serves the same versioned artifact to desktop extension hosts and the Claude Code plugin.

To list a published release in the [official MCP Registry](https://modelcontextprotocol.io/registry/quickstart), download the release's `server.json`, sign in with the organization's authorized `mcp-publisher` account and run `mcp-publisher publish` from the directory containing that file. The manifest identifies the GitHub release asset and its exact digest. Listing in third-party plugin directories is a separate submission.
