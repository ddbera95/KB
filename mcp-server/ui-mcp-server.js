#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API = process.env.KB_API_URL ?? "http://localhost:3000";

// Mutable — can be changed at runtime via kb_switch_project
let PROJECT_ID = process.env.KB_PROJECT_ID ?? "default";

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${API}/api${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
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
    name: "kb_switch_project",
    description: "Switch the active project for this session. All subsequent tool calls will use the new project. Use kb_list_projects to see available project IDs.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "ID of the project to switch to" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "kb_create_project",
    description: "Create a new KB project and immediately switch to it.",
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string", description: "Project name" },
        description: { type: "string", description: "Optional description" },
        color:       { type: "string", description: "Hex colour e.g. #6366f1 (optional)" },
      },
      required: ["name"],
    },
  },
  {
    name: "kb_delete_project",
    description: "Delete a project and ALL its data (collections, pages, attachments). Irreversible. Cannot delete the default project.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "ID of the project to delete" },
      },
      required: ["project_id"],
    },
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
async function callTool(name, args) {
  switch (name) {
    case "kb_switch_project": {
      const proj = await api(`/projects/${args.project_id}`);
      PROJECT_ID = args.project_id;
      return `Switched to project **${proj.name}** (\`${proj.id}\`). All KB tools now use this project.`;
    }

    case "kb_create_project": {
      const proj = await api("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: args.name,
          description: args.description,
          color: args.color ?? "#6366f1",
        }),
      });
      PROJECT_ID = proj.id;
      return `Created and switched to project **${proj.name}** (ID: \`${proj.id}\`). All KB tools now use this project.`;
    }

    case "kb_delete_project": {
      if (args.project_id === "default") {
        return "Error: the default project cannot be deleted.";
      }
      await api(`/projects/${args.project_id}`, { method: "DELETE" });
      // If we just deleted the active project, fall back to default
      if (PROJECT_ID === args.project_id) {
        PROJECT_ID = "default";
        return `Project \`${args.project_id}\` deleted. Switched back to the default project.`;
      }
      return `Project \`${args.project_id}\` and all its data have been permanently deleted.`;
    }

    case "kb_current_project": {
      const proj = await api(`/projects/${PROJECT_ID}`).catch(() => null);
      if (!proj) return `Active project ID: \`${PROJECT_ID}\` (could not fetch details — is the backend running?)`;
      return `Active project: **${proj.name}** (ID: \`${proj.id}\`)\n${proj.description ? `Description: ${proj.description}` : ""}\nCollections: ${proj.collections_count ?? "?"} · Pages: ${proj.documents_count ?? "?"}`;
    }

    case "kb_list_projects": {
      const projects = await api("/projects");
      if (!projects.length) return "No projects found.";
      return projects.map(p =>
        `- **${p.name}** (ID: \`${p.id}\`)${p.id === PROJECT_ID ? " ← active" : ""}${p.description ? `\n  ${p.description}` : ""}`
      ).join("\n");
    }

    case "kb_search": {
      const params = new URLSearchParams({ q: args.query, project_id: PROJECT_ID });
      if (args.limit) params.set("limit", String(args.limit));
      if (args.collection_id) params.set("collection_id", args.collection_id);
      const res = await api(`/search?${params}`);
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
      const res = await api(`/documents/${args.id}`);
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
      const params = { project_id: PROJECT_ID };
      if (args.collection_id) params.collection_id = args.collection_id;
      if (args.standalone) params.standalone = "true";
      if (args.page) params.page = String(args.page);
      if (args.per_page) params.per_page = String(Math.min(args.per_page, 50));
      const qs = new URLSearchParams(params).toString();
      const res = await api(`/documents${qs ? "?" + qs : ""}`);
      if (!res.data?.length) return "No pages found.";
      const lines = res.data.map(d =>
        `- **${d.title}** (${d.id})${d.brief ? ` — ${d.brief}` : ""}`
      );
      return `Found ${res.total} page(s) (showing ${res.data.length}):\n\n${lines.join("\n")}`;
    }

    case "kb_list_collections": {
      const cols = await api(`/collections?project_id=${PROJECT_ID}`);
      if (!cols.length) return "No collections found.";
      return cols.map(c =>
        `- **${c.name}** (${c.id})${c.description ? ` — ${c.description}` : ""}`
      ).join("\n");
    }

    case "kb_create_collection": {
      try {
        const col = await api(`/collections?project_id=${PROJECT_ID}`, {
          method: "POST",
          body: JSON.stringify({ name: args.name, description: args.description }),
        });
        return `Created collection **${col.name}** (ID: \`${col.id}\`) in project \`${PROJECT_ID}\`.`;
      } catch (err) {
        // Slug conflict (409) — collection already exists, return it instead of erroring
        if (err.status === 409) {
          const cols = await api(`/collections?project_id=${PROJECT_ID}`);
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
      await api(`/collections/${args.id}`, { method: "DELETE" });
      return `Collection \`${args.id}\` deleted. Its pages are still accessible but no longer grouped in this collection.`;
    }

    case "kb_get_children": {
      const children = await api(`/documents/${args.id}/children`);
      if (!children.length) return "No child pages found.";
      return children.map(c =>
        `- **${c.title}** (${c.id})${c.brief ? ` — ${c.brief}` : ""}`
      ).join("\n");
    }

    case "kb_get_backlinks": {
      const links = await api(`/documents/${args.id}/backlinks`);
      if (!links.length) return "No pages link to this page.";
      return `Pages linking here:\n${links.map(d => `- **${d.title}** (${d.id})`).join("\n")}`;
    }

    case "kb_create_page": {
      const body = {
        title: args.title,
        content: args.content ?? "",
        project_id: PROJECT_ID,
        ...(args.brief && { brief: args.brief }),
        ...(args.collection_id && { collection_id: args.collection_id }),
        ...(args.parent_id && { parent_id: args.parent_id }),
        ...(args.tags && { tags: args.tags }),
      };
      const doc = await api("/documents", { method: "POST", body: JSON.stringify(body) });
      return `Created page **${doc.title}** with ID \`${doc.id}\`.`;
    }

    case "kb_update_page": {
      const { id, ...rest } = args;
      const doc = await api(`/documents/${id}`, { method: "PUT", body: JSON.stringify(rest) });
      return `Updated page **${doc.title}** (${doc.id}).`;
    }

    case "kb_append_to_page": {
      const doc = await api(`/documents/${args.id}/append`, {
        method: "POST",
        body: JSON.stringify({ content: args.content }),
      });
      return `Appended to **${doc.title}**. Content is now ${doc.content.length} characters.`;
    }

    case "kb_delete_page": {
      await api(`/documents/${args.id}`, { method: "DELETE" });
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
import { fileURLToPath } from "url";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

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

// ── Per-connection server factory ─────────────────────────────────────────────
// MCP Server must be a fresh instance per SSE connection (SDK limitation)
function createMCPServer() {
  const srv = new Server({ name: "mimix", version: "1.0.0" }, { capabilities: { tools: {} } });
  srv.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  srv.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const text = await callTool(name, args ?? {});
      return { content: [{ type: "text", text: String(text) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  });
  return srv;
}

const transports = {};

// ── HTTP server ───────────────────────────────────────────────────────────────
const httpServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const url = req.url ?? "/";

  // ── /mcp  — info + how to connect ──────────────────────────────────────────
  if (url === "/mcp" || url === "/mcp/") {
    const host = req.headers.host ?? `<ip>:${PORT}`;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      name: "Mimix MCP",
      transport: "sse",
      endpoints: {
        sse:    `http://${host}/mcp/sse`,
        health: `http://${host}/mcp/health`,
      },
      how_to_add_in_claude_code: `claude mcp add mimix --transport sse http://${host}/mcp/sse`,
      active_project: PROJECT_ID,
      api: API,
    }, null, 2));
    return;
  }

  // ── /mcp/health ─────────────────────────────────────────────────────────────
  if (url === "/mcp/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", project: PROJECT_ID, api: API }));
    return;
  }

  // ── /mcp/sse  — SSE connection ──────────────────────────────────────────────
  if (req.method === "GET" && url === "/mcp/sse") {
    const t = new SSEServerTransport("/mcp/message", res);
    const srv = createMCPServer();
    transports[t.sessionId] = { transport: t, server: srv };
    res.on("close", () => delete transports[t.sessionId]);
    await srv.connect(t);
    return;
  }

  // ── /mcp/message  — tool call messages ─────────────────────────────────────
  if (req.method === "POST" && url.startsWith("/mcp/message")) {
    const sid = new URL(url, "http://x").searchParams.get("sessionId");
    const session = transports[sid];
    if (!session) { res.writeHead(404); res.end("Session not found"); return; }
    await session.transport.handlePostMessage(req, res);
    return;
  }

  // ── /api/* → proxy to Rust backend ─────────────────────────────────────────
  if (url.startsWith("/api/") || url === "/api") {
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
    const reqPath = url.split("?")[0];
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
  console.log(`  MCP:   http://0.0.0.0:${PORT}/mcp/sse`);
  console.log(`  Info:  http://0.0.0.0:${PORT}/mcp`);
  console.log(`\nTo connect from Claude Code:`);
  console.log(`  claude mcp add mimix --transport sse http://<ip>:${PORT}/mcp/sse`);
  console.log(`  (replace <ip> with this machine's IP address)\n`);
});
