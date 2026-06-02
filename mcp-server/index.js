#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API = process.env.KB_API_URL ?? "http://localhost:3000";

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${API}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "kb_search",
    description: "Full-text search across all KB pages. Returns matching pages with title, snippet, and breadcrumb.",
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
    description: "List all collections in the KB.",
    inputSchema: {
      type: "object",
      properties: {},
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
    description: "Create a new KB page.",
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
    description: "Update an existing KB page. Only the fields you supply are changed.",
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
    description: "Append text to an existing KB page without overwriting existing content.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document ID" },
        content: { type: "string", description: "Content to append" },
      },
      required: ["id", "content"],
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────
async function callTool(name, args) {
  switch (name) {
    case "kb_search": {
      const params = new URLSearchParams({ q: args.query });
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
      const params = {};
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
      const cols = await api("/collections");
      if (!cols.length) return "No collections found.";
      return cols.map(c =>
        `- **${c.name}** (${c.id})${c.description ? ` — ${c.description}` : ""}`
      ).join("\n");
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

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP Server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "kb", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const text = await callTool(name, args ?? {});
    return { content: [{ type: "text", text: String(text) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
