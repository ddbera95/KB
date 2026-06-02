# KB — Personal Knowledge Base

A self-hosted, local-first knowledge management system — Notion-style editor, full-text search, knowledge graph, and Claude Code integration via MCP.

## Stack

| Layer | Technology |
|---|---|
| Backend | Rust + Axum |
| Database | SQLite (sqlx, WAL mode) |
| Search | Tantivy (BM25 full-text) |
| Frontend | React + BlockNote editor |
| MCP Server | Node.js (Claude Code integration) |

## Features

- **Projects** — isolated workspaces; delete a project wipes all its data and files
- **Collections** — group pages into named collections per project
- **Hierarchical pages** — unlimited nesting, breadcrumbs, parent/child navigation
- **BlockNote editor** — Notion-like `/` slash commands, drag-and-drop blocks
- **Full-text search** — Tantivy BM25 with real-time index updates
- **Wiki links** — `[[Page Name]]` cross-links with automatic backlink tracking
- **Document versioning** — every save stores a version, restore any time
- **Attachments** — file/image upload per page, project-scoped storage
- **Knowledge graph** — Cytoscape.js visualisation of pages and relations
- **MCP server** — expose KB as tools directly inside Claude Code

---

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) (v18+)

### 1. First-time setup

```bash
git clone https://github.com/your-username/KB.git
cd KB
./setup.sh
```

`setup.sh` will:
- Create `.env` from `.env.example`
- Build the Rust backend (`cargo build --release`)
- Install frontend dependencies (`npm install`)
- Install the MCP server globally (`kb-mcp`)
- Register the MCP server with Claude Code automatically

### 2. Start

```bash
./start.sh
```

Both servers start with coloured output. Press **Ctrl+C** to stop everything.

| Server | URL |
|---|---|
| Backend API | http://localhost:3000 |
| Frontend UI | http://localhost:5173 |

### Make commands

```bash
make setup   # first-time install (same as ./setup.sh)
make start   # start dev servers  (same as ./start.sh)
make build   # release build (Rust binary + frontend bundle)
make clean   # remove build artifacts
```

---

## Project Structure

```
KB/
├── src/                    # Rust backend
│   ├── api/                # Axum route handlers
│   │   ├── projects.rs
│   │   ├── collections.rs
│   │   ├── documents.rs
│   │   ├── search.rs
│   │   ├── graph.rs
│   │   └── attachments.rs
│   ├── models/             # SQLx model types
│   ├── search/             # Tantivy wrapper
│   ├── state.rs
│   └── main.rs
├── migrations/
│   ├── 0001_initial.sql    # Base schema
│   └── 0002_add_projects.sql
├── frontend-react/         # React + BlockNote frontend
│   └── src/
│       ├── api/            # REST API client
│       ├── components/     # Layout, Sidebar, project switcher
│       ├── context/        # Project context (persisted to localStorage)
│       └── pages/          # Home, Document, Collection, Search, Graph
├── mcp-server/
│   └── index.js            # MCP stdio server for Claude Code
├── setup.sh                # One-command install
├── start.sh                # One-command start
└── Makefile
```

---

## Environment

```env
DATABASE_URL=sqlite://./data/sqlite/knowledge.db
DATA_DIR=./data
PORT=3000
RUST_LOG=info
```

Copy `.env.example` to `.env` and adjust as needed. The `setup.sh` script does this automatically.

---

## API Reference

```
# Projects
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PUT    /api/projects/:id
DELETE /api/projects/:id        ← deletes all data + files

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
```

---

## MCP Tools (Claude Code)

After running `setup.sh`, the following tools are available in any Claude Code session (KB backend must be running):

| Tool | Description |
|---|---|
| `kb_search` | Full-text search across pages |
| `kb_read_page` | Read full page content + metadata |
| `kb_list_pages` | List pages with optional filters |
| `kb_list_collections` | List all collections |
| `kb_get_children` | Get sub-pages of a page |
| `kb_get_backlinks` | Get pages that link here |
| `kb_create_page` | Create a new page |
| `kb_update_page` | Update title/content/tags |
| `kb_append_to_page` | Append text without overwriting |

---

## Data Storage

```
data/
├── sqlite/knowledge.db     # All metadata (projects, docs, tags, relations)
├── tantivy/                # Full-text search index (auto-rebuilt on schema change)
└── projects/
    ├── default/
    │   └── attachments/    # Files for the default project
    └── {project-id}/
        └── attachments/    # Files per project — delete folder = all files gone
```

The SQLite database is the source of truth. The Tantivy index is a cache and can be safely deleted — it rebuilds automatically on next startup.
