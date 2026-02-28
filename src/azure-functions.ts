/**
 * Entry point for running the MCP server on Azure Functions (Custom Handler).
 * Run with: node dist/azure-functions.js
 */

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import { createVercelStore } from "./checkpoint-store.js";
import { createServer } from "./server.js";

// Use createVercelStore() which auto-selects Redis (if Upstash env vars present) or Memory
const store = createVercelStore();
const factory = () => createServer(store);

const port = parseInt(process.env.PORT ?? "3000", 10);
const app = createMcpExpressApp({ host: "0.0.0.0" });
app.use(cors());

app.all("/mcp", async (req: Request, res: Response) => {
  const server = factory();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const httpServer = app.listen(port, () => {
  console.log(`Excalidraw MCP server (Azure Functions) listening on port ${port} at /mcp`);
});

const shutdown = () => {
  console.log("\nShutting down...");
  httpServer.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
