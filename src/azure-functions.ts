/**
 * Entry point for running the MCP server on Azure Functions (Custom Handler).
 * Run with: node dist/azure-functions.js
 */

import { createVercelStore } from "./checkpoint-store.js";
import { startStreamableHTTPServer } from "./main.js";
import { createServer } from "./server.js";

// Use createVercelStore() which auto-selects Redis (if Upstash env vars present) or Memory
const store = createVercelStore();
const factory = () => createServer(store);

// Azure Functions Custom Handler expects port 3000 by default
startStreamableHTTPServer(factory, { defaultPort: 3000 }).catch((e) => {
  console.error(e);
  process.exit(1);
});
