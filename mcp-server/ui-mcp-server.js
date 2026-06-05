#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API = process.env.KB_API_URL ?? "http://localhost:3000";

// ── HTTP helper (per-connection credentials) ──────────────────────────────────
async function api(path, opts = {}, apiKey = "") {
  const res = await fetch(`${API}/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-Api-Key": apiKey } : {}),
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error ?? res.statusText ?? `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "kb_current_project",
    description: "Show which KB project is currently active.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "kb_list_projects",
    description: "List all KB projects with their IDs and names.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "kb_search",
    description: "Full-text search across pages in the current project. Returns matching pages with title, snippet, and breadcrumb.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default 10)" },
        collection_id: { type: "string", description: "Restrict to a specific collection ID" },
      },
      required: ["query"],
    },
  },
  {
    name: "kb_read_page",
    description: "Read the full content of a KB page by its ID. Returns title, content, tags, breadcrumb, and child pages.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "kb_list_pages",
    description: "List KB pages. Optionally filter by collection or list only standalone pages.",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", description: "Filter by collection ID" },
        standalone: { type: "boolean", description: "Only return pages not in any collection" },
        page: { type: "number", description: "Page number (default 1)" },
        per_page: { type: "number", description: "Results per page (default 20, max 50)" },
      },
    },
  },
  {
    name: "kb_list_collections",
    description: "List all collections in the current project.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "kb_create_collection",
    description: "Create a new collection in the current project. Returns existing collection if name already exists.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Collection name" },
        description: { type: "string", description: "Optional description" },
      },
      required: ["name"],
    },
  },
  {
    name: "kb_delete_collection",
    description: "Delete a collection by ID. This does NOT delete its pages — they lose their collection but remain accessible.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Collection ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "kb_get_children",
    description: "Get child pages of a given page.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Parent document ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "kb_get_backlinks",
    description: "Get all pages that link to a given page via [[wiki links]].",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "kb_create_page",
    description: "Create a new KB page. Write content as Markdown — headings (# ## ###), code blocks (```lang), lists, bold/italic, blockquotes, tables, wiki-links ([[Page Title]]). For callout blocks prefix lines with emoji: ℹ️ info, ⚠️ warning, 💡 tip, 🚨 danger, 📝 note. Always add meaningful tags.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Page title" },
        content: { type: "string", description: "Page content (plain text or markdown)" },
        brief: { type: "string", description: "Short description" },
        collection_id: { type: "string", description: "Collection to add the page to" },
        parent_id: { type: "string", description: "Parent page ID for nested pages" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for the page",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "kb_update_page",
    description: "Update an existing KB page. Content is Markdown — same format as kb_create_page. Only supplied fields are changed.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document ID" },
        title: { type: "string", description: "New title" },
        content: { type: "string", description: "New content" },
        brief: { type: "string", description: "New brief description" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "New tags (replaces existing tags)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "kb_append_to_page",
    description: "Append Markdown text to an existing KB page without overwriting existing content. Use for adding new sections, updates, or notes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document ID" },
        content: { type: "string", description: "Content to append" },
      },
      required: ["id", "content"],
    },
  },
  {
    name: "kb_delete_page",
    description: "Permanently delete a KB page by ID. This also deletes all child pages. Use kb_read_page first to confirm the right page.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document ID to delete" },
      },
      required: ["id"],
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────
async function callTool(name, args, apiKey, projectId) {
  const a = (path, opts = {}) => api(path, opts, apiKey);

  switch (name) {
    case "kb_current_project": {
      const proj = await a(`/projects/${projectId}`).catch(() => null);
      if (!proj) return `Active project ID: \`${projectId}\` (could not fetch details — is the backend running?)`;
      return `Active project: **${proj.name}** (ID: \`${proj.id}\`)\n${proj.description ? `Description: ${proj.description}` : ""}\nCollections: ${proj.collections_count ?? "?"} · Pages: ${proj.documents_count ?? "?"}`;
    }

    case "kb_list_projects": {
      const projects = await a("/projects");
      if (!projects.length) return "No projects found.";
      return projects.map(p =>
        `- **${p.name}** (ID: \`${p.id}\`)${p.id === projectId ? " ← active" : ""}${p.description ? `\n  ${p.description}` : ""}`
      ).join("\n");
    }

    case "kb_search": {
      const params = new URLSearchParams({ q: args.query, project_id: projectId });
      if (args.limit) params.set("limit", String(args.limit));
      if (args.collection_id) params.set("collection_id", args.collection_id);
      const res = await a(`/search?${params}`);
      if (res.total === 0) return "No results found.";
      return res.results.map(r => {
        const crumb = r.breadcrumb?.map(b => b.title).join(" › ") ?? "";
        return [
          `## ${r.title}`,
          crumb ? `Path: ${crumb}` : "",
          r.snippet ? `Snippet: ${r.snippet}` : "",
          `ID: ${r.id}`,
          `Score: ${r.score.toFixed(3)}`,
        ].filter(Boolean).join("\n");
      }).join("\n\n---\n\n");
    }

    case "kb_read_page": {
      const res = await a(`/documents/${args.id}`);
      const { document: doc, tags, children, breadcrumb } = res;
      const crumb = breadcrumb?.map(b => b.title).join(" › ") ?? "";
      return [
        `# ${doc.title}`,
        crumb ? `Path: ${crumb} › ${doc.title}` : "",
        doc.brief ? `Brief: ${doc.brief}` : "",
        tags?.length ? `Tags: ${tags.join(", ")}` : "",
        "",
        doc.content || "(empty)",
        "",
        children?.length
          ? `### Sub-pages (${children.length})\n${children.map(c => `- ${c.title} (${c.id})`).join("\n")}`
          : "",
      ].filter(s => s !== undefined).join("\n").trim();
    }

    case "kb_list_pages": {
      const params = { project_id: projectId };
      if (args.collection_id) params.collection_id = args.collection_id;
      if (args.standalone) params.standalone = "true";
      if (args.page) params.page = String(args.page);
      if (args.per_page) params.per_page = String(Math.min(args.per_page, 50));
      const qs = new URLSearchParams(params).toString();
      const res = await a(`/documents${qs ? "?" + qs : ""}`);
      if (!res.data?.length) return "No pages found.";
      const lines = res.data.map(d =>
        `- **${d.title}** (${d.id})${d.brief ? ` — ${d.brief}` : ""}`
      );
      return `Found ${res.total} page(s) (showing ${res.data.length}):\n\n${lines.join("\n")}`;
    }

    case "kb_list_collections": {
      const cols = await a(`/collections?project_id=${projectId}`);
      if (!cols.length) return "No collections found.";
      return cols.map(c =>
        `- **${c.name}** (${c.id})${c.description ? ` — ${c.description}` : ""}`
      ).join("\n");
    }

    case "kb_create_collection": {
      try {
        const col = await a(`/collections?project_id=${projectId}`, {
          method: "POST",
          body: JSON.stringify({ name: args.name, description: args.description }),
        });
        return `Created collection **${col.name}** (ID: \`${col.id}\`) in project \`${projectId}\`.`;
      } catch (err) {
        if (err.status === 409) {
          const cols = await a(`/collections?project_id=${projectId}`);
          const existing = cols.find(c =>
            c.name.toLowerCase() === args.name.toLowerCase()
          );
          if (existing) {
            return `Collection **${existing.name}** already exists (ID: \`${existing.id}\`). Using existing collection.`;
          }
        }
        throw err;
      }
    }

    case "kb_delete_collection": {
      await a(`/collections/${args.id}`, { method: "DELETE" });
      return `Collection \`${args.id}\` deleted. Its pages are still accessible but no longer grouped in this collection.`;
    }

    case "kb_get_children": {
      const children = await a(`/documents/${args.id}/children`);
      if (!children.length) return "No child pages found.";
      return children.map(c =>
        `- **${c.title}** (${c.id})${c.brief ? ` — ${c.brief}` : ""}`
      ).join("\n");
    }

    case "kb_get_backlinks": {
      const links = await a(`/documents/${args.id}/backlinks`);
      if (!links.length) return "No pages link to this page.";
      return `Pages linking here:\n${links.map(d => `- **${d.title}** (${d.id})`).join("\n")}`;
    }

    case "kb_create_page": {
      const body = {
        title: args.title,
        content: args.content ?? "",
        project_id: projectId,
        ...(args.brief && { brief: args.brief }),
        ...(args.collection_id && { collection_id: args.collection_id }),
        ...(args.parent_id && { parent_id: args.parent_id }),
        ...(args.tags && { tags: args.tags }),
      };
      const doc = await a("/documents", { method: "POST", body: JSON.stringify(body) });
      return `Created page **${doc.title}** with ID \`${doc.id}\`.`;
    }

    case "kb_update_page": {
      const { id, ...rest } = args;
      const doc = await a(`/documents/${id}`, { method: "PUT", body: JSON.stringify(rest) });
      return `Updated page **${doc.title}** (${doc.id}).`;
    }

    case "kb_append_to_page": {
      const doc = await a(`/documents/${args.id}/append`, {
        method: "POST",
        body: JSON.stringify({ content: args.content }),
      });
      return `Appended to **${doc.title}**. Content is now ${doc.content.length} characters.`;
    }

    case "kb_delete_page": {
      await a(`/documents/${args.id}`, { method: "DELETE" });
      return `Page \`${args.id}\` deleted.`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Combined UI + MCP server on a single port ─────────────────────────────────
// UI served from ../frontend/build, MCP on /mcp/sse
// Anyone who knows the IP can connect — no separate port needed.
//
//   UI:   http://<ip>:8080/
//   MCP:  http://<ip>:8080/mcp/sse
//   Info: http://<ip>:8080/mcp   (returns claude mcp add command)

import http from "http";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.UI_PORT ?? "8080");
const BUILD_DIR = path.join(__dirname, "../frontend/build");

const MIME_TYPES = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png",
  ".json": "application/json", ".woff2": "font/woff2", ".webp": "image/webp",
};

function serveFile(res, filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  fs.createReadStream(filePath).pipe(res);
}

// ── Per-session server factory ────────────────────────────────────────────────
// Each MCP session gets its own Server instance with its own credentials.
function createMCPServer(apiKey, projectId) {
  const srv = new Server({ name: "mimix", version: "1.0.0" }, { capabilities: { tools: {} } });
  srv.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  srv.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const text = await callTool(name, args ?? {}, apiKey, projectId);
      return { content: [{ type: "text", text: String(text) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  });
  return srv;
}

// sessionId → { transport, server }
const sessions = {};

// ── HTTP server ───────────────────────────────────────────────────────────────
const httpServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const url = req.url ?? "/";
  const parsed = new URL(url, "http://x");
  const pathname = parsed.pathname;

  // ── /mcp/info — human-readable connection info ──────────────────────────────
  if (pathname === "/mcp/info" || pathname === "/mcp/info/") {
    const host = req.headers.host ?? `<ip>:${PORT}`;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      name: "Mimix MCP",
      transport: "streamable-http",
      endpoint: `http://${host}/mcp?api_key=mmx_...&project_id=...`,
      how_to_add_in_claude_code: `claude mcp add mimix --transport http "http://${host}/mcp?api_key=mmx_YOUR_KEY&project_id=YOUR_PROJECT_ID"`,
      api: API,
    }, null, 2));
    return;
  }

  // ── /mcp/health ─────────────────────────────────────────────────────────────
  if (pathname === "/mcp/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", api: API }));
    return;
  }

  // ── /mcp — Streamable HTTP transport ─────────────────────────────────────────
  if (pathname === "/mcp") {
    const sessionId = req.headers["mcp-session-id"];

    if (sessionId) {
      // Existing session — route to its transport
      const session = sessions[sessionId];
      if (!session) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found or expired" }));
        return;
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    // New session — credentials must be in query params
    const apiKey = parsed.searchParams.get("api_key") ?? "";
    const projectId = parsed.searchParams.get("project_id") ?? "";

    if (!apiKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing api_key. Connect with /mcp?api_key=mmx_...&project_id=..." }));
      return;
    }
    if (!projectId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing project_id. Connect with /mcp?api_key=mmx_...&project_id=..." }));
      return;
    }

    const newSessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
    });
    const srv = createMCPServer(apiKey, projectId);
    sessions[newSessionId] = { transport, server: srv };
    transport.onclose = () => delete sessions[newSessionId];

    await srv.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  // ── /api/* → proxy to Rust backend ─────────────────────────────────────────
  if (pathname.startsWith("/api/") || pathname === "/api") {
    const target = new URL(API);
    const options = {
      hostname: target.hostname,
      port: target.port || 3000,
      path: url,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    };
    const proxy = http.request(options, (backRes) => {
      res.writeHead(backRes.statusCode, backRes.headers);
      backRes.pipe(res, { end: true });
    });
    proxy.on("error", (e) => {
      res.writeHead(502); res.end(`Backend error: ${e.message}`);
    });
    req.pipe(proxy, { end: true });
    return;
  }

  // ── Everything else → serve React UI (SPA fallback to index.html) ──────────
  try {
    const reqPath = pathname;
    let filePath = path.join(BUILD_DIR, reqPath === "/" ? "index.html" : reqPath);
    if (!fs.existsSync(filePath)) filePath = path.join(BUILD_DIR, "index.html");
    serveFile(res, filePath);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\nMimix — combined UI + MCP server`);
  console.log(`  UI:    http://0.0.0.0:${PORT}/`);
  console.log(`  MCP:   http://0.0.0.0:${PORT}/mcp  (Streamable HTTP)`);
  console.log(`  Info:  http://0.0.0.0:${PORT}/mcp/info`);
  console.log(`\nTo connect from Claude Code:`);
  console.log(`  claude mcp add mimix --transport http "http://<ip>:${PORT}/mcp?api_key=mmx_YOUR_KEY&project_id=YOUR_PROJECT_ID"`);
  console.log(`  (replace <ip>, api_key, and project_id with your actual values)\n`);
});
