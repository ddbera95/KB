# KB — Personal Knowledge Base

A self-hosted, local-first knowledge management system.

## Stack

| Layer | Technology |
|---|---|
| Backend | Rust + Axum |
| Database | SQLite (sqlx) |
| Search | Tantivy (BM25 full-text) |
| Frontend | React + BlockNote editor |
| MCP Server | Node.js (Claude Code integration) |

## Features

- **Projects** — isolated workspaces, delete a project removes all its data
- **Collections** — group pages into named collections per project
- **Hierarchical pages** — unlimited nesting, breadcrumbs, parent/child nav
- **BlockNote editor** — Notion-like editing with `/` slash commands
- **Full-text search** — Tantivy BM25, real-time index updates
- **Wiki links** — `[[Page Name]]` cross-links with backlink tracking
- **Document versioning** — every save stores a version, restore anytime
- **Attachments** — file/image upload per page
- **Knowledge graph** — Cytoscape.js visualisation of pages and relations
- **MCP server** — expose KB to Claude Code as a tool

## Quick Start

### 1. Backend

```bash
cargo run
# Listens on http://localhost:3000
```

### 2. Frontend

```bash
cd frontend-react
npm install
npm run dev
# Opens at http://localhost:5173
```

### 3. MCP Server (Claude Code integration)

```bash
cd mcp-server
npm install
# Already registered globally — restart Claude Code to activate
```

## Project Structure

```
KB/
├── src/                    # Rust backend
│   ├── api/                # Axum route handlers
│   ├── models/             # SQLx model types
│   ├── search/             # Tantivy search engine wrapper
│   ├── state.rs            # Shared app state
│   └── main.rs             # Server entry point
├── migrations/             # SQLite migration files
├── frontend-react/         # React frontend (BlockNote)
│   └── src/
│       ├── api/            # API client
│       ├── components/     # Layout, Sidebar
│       ├── context/        # Project context
│       └── pages/          # Route pages
└── mcp-server/             # MCP server for Claude Code
    └── index.js
```

## Environment

Copy `.env.example` to `.env` and adjust:

```env
DATABASE_URL=sqlite://./data/sqlite/knowledge.db
DATA_DIR=./data
PORT=3000
RUST_LOG=info
```

## API

```
GET/POST   /api/projects
GET/PUT/DELETE /api/projects/:id

GET/POST   /api/collections?project_id=
GET/PUT/DELETE /api/collections/:id

GET/POST   /api/documents?project_id=
GET/PUT/DELETE /api/documents/:id
POST       /api/documents/:id/append
GET        /api/documents/:id/versions
GET        /api/documents/:id/backlinks

GET        /api/search?q=&project_id=
GET        /api/graph?project_id=

POST       /api/attachments
GET        /api/attachments/:id
```
