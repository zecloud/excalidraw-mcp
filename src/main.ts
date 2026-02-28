/**
 * Entry point for running the MCP server.
 * Run with: npx @mcp-demos/excalidraw-server
 * Or: node dist/index.js [--stdio]
 */

import { FileCheckpointStore } from "./checkpoint-store.js";
import { startStdioServer, startStreamableHTTPServer } from "./http-server.js";
import { createServer } from "./server.js";

async function main() {
  const store = new FileCheckpointStore();
  const factory = () => createServer(store);
  if (process.argv.includes("--stdio")) {
    await startStdioServer(factory);
  } else {
    await startStreamableHTTPServer(factory);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
