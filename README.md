<div align="center">
  <img src="assets/mimix-logo-horizontal.svg" alt="Mimix" height="60" />
  <br/>
  <br/>
  <p><strong>Knowledge, without the noise.</strong></p>
  <p>A self-hosted, local-first knowledge management system built for developers and teams who want full control over their data.</p>
  <br/>

  [![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
  [![Built with Rust](https://img.shields.io/badge/backend-Rust-orange.svg)](https://www.rust-lang.org)
  [![React](https://img.shields.io/badge/frontend-React-61dafb.svg)](https://react.dev)
  [![BlockNote](https://img.shields.io/badge/editor-BlockNote-purple.svg)](https://www.blocknotejs.org)

</div>

---

## What is Mimix?

Mimix is a **local-first personal knowledge base** — think Notion, but self-hosted, offline-capable, and built on open standards. Your data lives on your machine as SQLite and files. No subscriptions. No vendor lock-in. No cloud dependency.

It is designed for:
- **Developers** who want a technical wiki with code blocks, syntax highlighting, and wiki-style cross-linking
- **Researchers** who need nested pages, backlinks, and a visual knowledge graph
- **Teams** using Claude Code or other AI assistants — Mimix ships with a first-class MCP server so AI agents can read and write your knowledge base directly

---

## Features

### Editor
- **Notion-style block editor** powered by [BlockNote](https://www.blocknotejs.org) — type `/` for a rich slash command menu
- **Syntax-highlighted code blocks** via Shiki (50+ languages)
- **Wiki links** — `[[Page Title]]` creates cross-references with automatic backlink tracking
- **Callout blocks** — ℹ️ Info · ⚠️ Warning · 💡 Tip · 🚨 Danger · 📝 Note
- **Tables**, task lists, toggles, images, file attachments

### Organisation
- **Projects** — isolated workspaces; delete a project removes all its data instantly
- **Collections** — group pages into named namespaces per project
- **Hierarchical pages** — unlimited nesting with breadcrumbs and parent/child navigation
- **Tags** — tag pages and filter by tag across the knowledge base
- **Document versioning** — every save is snapshotted; restore any previous version

### Search & Discovery
- **Full-text search** powered by [Tantivy](https://github.com/quickwit-oss/tantivy) (BM25 ranking, real-time index updates)
- **Knowledge graph** — interactive Cytoscape.js visualisation of pages, collections, and wiki-link connections
- **Backlinks** — see every page that links to the current page

### AI Integration
- **MCP server** — exposes Mimix as tools to [Claude Code](https://claude.ai/code) and any MCP-compatible AI client
- **Project-scoped** — switch projects at runtime; AI agents operate within the correct context
- Built-in tools: `search`, `read_page`, `create_page`, `update_page`, `list_collections`, `create_collection`, and more

### Data & Privacy
- **100% local** — all data stored as SQLite + files on your machine
- **No cloud required** — works fully offline
- **Backup** — one-click backup copies the entire data folder to any location
- **Open formats** — SQLite database is directly queryable; attachments are plain files

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | [Rust](https://www.rust-lang.org) + [Axum](https://github.com/tokio-rs/axum) |
| Database | [SQLite](https://www.sqlite.org) via [sqlx](https://github.com/launchbadge/sqlx) (WAL mode) |
| Search | [Tantivy](https://github.com/quickwit-oss/tantivy) (BM25 full-text) |
| Frontend | [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org) |
| Editor | [BlockNote](https://www.blocknotejs.org) + [Shiki](https://shiki.style) |
| Graph | [Cytoscape.js](https://js.cytoscape.org) + cose-bilkent layout |
| MCP Server | [Node.js](https://nodejs.org) + [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) |

---

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs) (stable toolchain)
- [Node.js](https://nodejs.org) v18+

### 1. Clone

```bash
git clone https://github.com/your-username/mimix.git
cd mimix
```

### 2. First-time setup

```bash
./setup.sh
```

This will:
- Create `.env` from `.env.example`
- Build the Rust backend (`cargo build --release`)
- Install frontend dependencies
- Install the MCP server globally (`mimix-mcp`)
- Register Mimix with Claude Code automatically (if `claude` CLI is present)

### 3. Start

```bash
./start.sh
```

| Service | URL |
|---|---|
| Backend API | http://localhost:3000 |
| Frontend UI | http://localhost:5173 |

Or use Make:

```bash
make setup   # first-time install
make start   # start both servers
make build   # production build
```

---

## Project Structure

```
mimix/
├── src/                    # Rust backend
│   ├── api/                # Axum route handlers
│   │   ├── projects.rs     # Project CRUD + delete cascade
│   │   ├── collections.rs  # Collection management
│   │   ├── documents.rs    # Pages with versioning + wiki links
│   │   ├── search.rs       # Tantivy full-text search
│   │   ├── graph.rs        # Knowledge graph API
│   │   ├── attachments.rs  # File upload/serve
│   │   └── backup.rs       # Data backup endpoint
│   ├── models/             # SQLx data types
│   ├── search/             # Tantivy index wrapper
│   ├── state.rs            # Shared application state
│   └── main.rs
│
├── migrations/
│   ├── 0001_initial.sql    # Base schema
│   └── 0002_add_projects.sql
│
├── frontend-react/         # React + TypeScript frontend
│   └── src/
│       ├── api/            # REST API client
│       ├── components/     # Layout, Sidebar, project switcher
│       ├── context/        # Project context (localStorage persistence)
│       └── pages/          # Document, Collection, Search, Graph, Home
│
├── mcp-server/
│   └── index.js            # MCP stdio server for Claude Code
│
├── assets/                 # Brand assets (logo, favicon)
├── setup.sh                # One-command install
├── start.sh                # One-command start
└── Makefile
```

---

## MCP Tools

After running `./setup.sh`, the following tools are available in Claude Code (backend must be running):

| Tool | Description |
|---|---|
| `kb_search` | Full-text search across pages in the active project |
| `kb_read_page` | Read full page content, tags, breadcrumb, and children |
| `kb_create_page` | Create a page with Markdown content |
| `kb_update_page` | Update title, content, tags |
| `kb_append_to_page` | Append content without overwriting |
| `kb_list_pages` | List pages with optional filters |
| `kb_list_collections` | List all collections in the active project |
| `kb_create_collection` | Create a new collection |
| `kb_delete_collection` | Delete a collection (pages are preserved) |
| `kb_get_children` | Get sub-pages of a page |
| `kb_get_backlinks` | Get pages that link to a given page |
| `kb_list_projects` | List all projects |
| `kb_current_project` | Show the active project |
| `kb_switch_project` | Switch active project for the session |
| `kb_create_project` | Create a new project and switch to it |
| `kb_delete_project` | Delete a project and all its data |

---

## Environment

Copy `.env.example` to `.env`:

```env
DATABASE_URL=sqlite://./data/sqlite/knowledge.db
DATA_DIR=./data
PORT=3000
RUST_LOG=info
```

> **Tip:** Set `DATA_DIR` to an absolute path if you run the server from different directories. Using a relative path creates separate databases per working directory.

---

## REST API

<details>
<summary>Show full API reference</summary>

```
# Projects
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PUT    /api/projects/:id
DELETE /api/projects/:id          ← deletes all data + files

# Collections
GET    /api/collections?project_id=
POST   /api/collections?project_id=
GET    /api/collections/:id
PUT    /api/collections/:id
DELETE /api/collections/:id

# Documents
GET    /api/documents?project_id=
POST   /api/documents
GET    /api/documents/:id
PUT    /api/documents/:id
DELETE /api/documents/:id
POST   /api/documents/:id/append
GET    /api/documents/:id/versions
GET    /api/documents/:id/backlinks
GET    /api/documents/:id/children
GET    /api/documents/:id/attachments

# Search
GET    /api/search?q=&project_id=

# Graph
GET    /api/graph?project_id=

# Attachments
POST   /api/attachments
GET    /api/attachments/:id

# Backup
POST   /api/backup              { destination: "/path/to/backup/dir" }
GET    /api/backup/browse?path= ← filesystem browser for UI
```

</details>

---

## Data Storage

```
data/
├── sqlite/
│   └── knowledge.db        # All metadata — projects, pages, tags, relations
├── tantivy/                # Full-text search index (auto-rebuilt on schema change)
└── projects/
    └── {project-id}/
        └── attachments/    # Files per project — delete folder = all files gone
```

The SQLite database is the source of truth. The Tantivy index is a pure cache and can be safely deleted — it rebuilds on the next write operation.

---

## License

Copyright 2026 Mimix Contributors

Licensed under the **Apache License, Version 2.0**. See [LICENSE](LICENSE) for the full text.

---

<div align="center">
  <sub>Built with ❤️ · <a href="https://github.com/your-username/mimix">GitHub</a></sub>
</div>
