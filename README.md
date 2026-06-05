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
- **Projects** — isolated workspaces; each project has its own collections, pages, and API keys
- **Collections** — group pages into named namespaces per project
- **Hierarchical pages** — unlimited nesting with breadcrumbs and parent/child navigation
- **Tags** — tag pages and filter by tag across the knowledge base
- **Document versioning** — every save is snapshotted; restore any previous version

### Search & Discovery
- **Full-text search** powered by [Tantivy](https://github.com/quickwit-oss/tantivy) (BM25 ranking, real-time index updates)
- **Knowledge graph** — interactive Cytoscape.js visualisation of pages, collections, and wiki-link connections
- **Backlinks** — see every page that links to the current page

### Authentication & Access Control
- **Login page** — username/password authentication; default credentials are `admin` / `admin` (change on first login)
- **Session auth** — browser sessions use a secure HttpOnly cookie; 24-hour expiry
- **API keys** — project-scoped keys (`mmx_...`) for MCP clients and direct API access
- **Admin controls** — only admins can create users and manage API keys (Settings → Users / API Keys)

### AI Integration
- **MCP server** — exposes Mimix as tools to [Claude Code](https://claude.ai/code) and any MCP-compatible AI client
- **Project-scoped** — each API key is tied to a specific project; the MCP client operates within that project
- **Secure** — all MCP/API access requires a valid `KB_API_KEY`; unauthenticated requests are rejected
- Built-in tools: `search`, `read_page`, `create_page`, `update_page`, `list_collections`, `create_collection`, and more

### Data & Privacy
- **100% local** — all data stored as SQLite + files on your machine
- **No cloud required** — works fully offline
- **Backup** — one-click backup in Settings copies the entire data folder to any location
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
| Frontend UI | http://localhost:5173 (dev) |

### 4. First login

Open the UI and log in with the default credentials:

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `admin` |

**Change your password immediately** — go to **Settings → Password**.

### 5. Create a project

After logging in you will be prompted to create a project. Projects are isolated workspaces — all pages, collections, and API keys belong to a specific project.

---

## Authentication

### UI (browser)

The UI uses session-based auth. Log in at `/login` with your username and password. Your session is stored in a secure HttpOnly cookie that expires after 24 hours.

### API & MCP (API keys)

All direct API calls and MCP tool calls require a **project-scoped API key**.

**Creating an API key:**

1. Open **Settings → API Keys**
2. Find your project in the list and expand it
3. Click **Add API Key**, enter a name (e.g. `MCP prod`), and click **Create**
4. Copy the generated key — it starts with `mmx_`

**Finding your Project ID:**

The Project ID is shown:
- In the sidebar below the project name (click the copy icon)
- In **Settings → API Keys** next to each project name (click the copy icon)

**Using the key:**

```
# Header
X-Api-Key: mmx_your_key_here

# Or Bearer token
Authorization: Bearer mmx_your_key_here
```

All API requests scoped to a project must include `?project_id=<your-project-id>` in the query string. The API key validates that the requested project matches the key's assigned project.

---

## MCP Setup

### Local (stdio)

For Claude Code running on the **same machine** as Mimix:

```bash
claude mcp add mimix \
  -e KB_API_URL=http://localhost:3000 \
  -e KB_PROJECT_ID=<your-project-id> \
  -e KB_API_KEY=mmx_<your-api-key> \
  -- node /path/to/mimix/mcp-server/index.js
```

Or if you installed globally via `./setup.sh`:

```bash
claude mcp add mimix \
  -e KB_API_URL=http://localhost:3000 \
  -e KB_PROJECT_ID=<your-project-id> \
  -e KB_API_KEY=mmx_<your-api-key> \
  -- mimix-mcp
```

### Remote (SSE over HTTP)

For Claude Code on a **different machine**, or to share with a team:

```bash
claude mcp add mimix --transport sse \
  "http://<server-ip>:8080/mcp/sse?api_key=mmx_<your-api-key>&project_id=<your-project-id>"
```

Or discover the endpoint automatically:

```bash
# The /mcp endpoint returns the exact claude mcp add command
curl http://<server-ip>:8080/mcp
```

### Required environment variables

| Variable | Required | Description |
|---|---|---|
| `KB_API_URL` | No | Mimix backend URL (default: `http://localhost:3000`) |
| `KB_PROJECT_ID` | **Yes** | Project ID to operate in (copy from sidebar or Settings) |
| `KB_API_KEY` | **Yes** | API key created in Settings → API Keys (starts with `mmx_`) |

> **Note:** Without `KB_API_KEY` the MCP server will log an error and all tool calls will be rejected with `401 Unauthorized`.

---

## Remote Deployment (shared server)

Deploy Mimix on a remote server so your whole team can use it.

### Ports

| Service | Port | Description |
|---|---|---|
| Backend API | 3000 | Rust server — handles all API requests |
| UI + MCP | 8080 | Combined Node server — serves the React UI **and** the MCP SSE endpoint |

### Deploy

```bash
# On the remote server
git clone https://github.com/your-username/mimix.git
cd mimix
./setup.sh

# Build frontend
cd frontend-react && npm run build && cd ..

# Start backend
nohup ./target/release/mimix > logs/backend.log 2>&1 &

# Start combined UI + MCP server
KB_API_URL=http://localhost:3000 UI_PORT=8080 \
  nohup node mcp-server/ui-mcp-server.js > logs/ui.log 2>&1 &
```

Open `http://<server-ip>:8080/` in your browser, log in as `admin` / `admin`, and change your password.

---

## Project Structure

```
mimix/
├── src/                    # Rust backend
│   ├── api/                # Axum route handlers
│   │   ├── auth.rs         # Login, logout, /me, change password
│   │   ├── projects.rs     # Project CRUD + delete cascade
│   │   ├── collections.rs  # Collection management
│   │   ├── documents.rs    # Pages with versioning + wiki links
│   │   ├── search.rs       # Tantivy full-text search
│   │   ├── graph.rs        # Knowledge graph API + path/neighbors
│   │   ├── attachments.rs  # File upload/serve
│   │   ├── backup.rs       # Data backup endpoint
│   │   ├── users.rs        # User management (admin only)
│   │   └── apikeys.rs      # API key management (admin only)
│   ├── auth.rs             # Session store, API key middleware, AuthUser
│   ├── models/             # SQLx data types
│   ├── search/             # Tantivy index wrapper
│   ├── state.rs            # Shared application state
│   └── main.rs             # Startup, migrations, admin seed
│
├── migrations/
│   ├── 0001_initial.sql
│   ├── 0002_add_projects.sql
│   ├── 0003_collections_slug_per_project.sql
│   ├── 0004_pages_section.sql
│   └── 0005_auth.sql       # users + api_keys tables
│
├── frontend-react/         # React + TypeScript frontend
│   └── src/
│       ├── api/            # REST API client
│       ├── components/     # Layout, Sidebar, project switcher
│       ├── context/        # Auth + Project context
│       └── pages/          # Document, Collection, Search, Graph, Home, Settings, Login
│
├── mcp-server/
│   ├── index.js            # MCP stdio server (local use)
│   └── ui-mcp-server.js    # Combined UI + MCP SSE server (remote use)
│
├── assets/                 # Brand assets (logo, favicon)
├── setup.sh                # One-command install
├── start.sh                # One-command start
└── Makefile
```

---

## MCP Tools

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
| `kb_get_subgraph` | Get graph nodes/edges around a page |
| `kb_find_path` | Find the shortest path between two pages |
| `kb_get_neighbors` | Get neighbors of a page up to N hops |

---

## Environment

Copy `.env.example` to `.env`:

```env
DATABASE_URL=sqlite://./data/sqlite/knowledge.db
DATA_DIR=./data
PORT=3000
RUST_LOG=info
```

> **Tip:** Set `DATA_DIR` to an absolute path if you run the server from different directories.

---

## REST API

All endpoints (except `POST /api/auth/login` and `POST /api/auth/logout`) require authentication:

- **Browser sessions:** send the `mimix_session` cookie automatically
- **API / MCP clients:** send `X-Api-Key: mmx_<key>` header (or `Authorization: Bearer mmx_<key>`)

<details>
<summary>Show full API reference</summary>

```
# Auth
POST   /api/auth/login              { username, password } → sets session cookie
POST   /api/auth/logout             → clears session cookie
GET    /api/auth/me                 → current user info
PUT    /api/auth/password           { current_password, new_password }

# Users (admin only)
GET    /api/users
POST   /api/users                   { username, password }
DELETE /api/users/:id

# API Keys (admin only)
GET    /api/api-keys
POST   /api/api-keys                { name, project_id }
DELETE /api/api-keys/:id

# Projects
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PUT    /api/projects/:id
DELETE /api/projects/:id            ← deletes all data + files

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
GET    /api/documents/:id/versions
GET    /api/documents/:id/backlinks
GET    /api/documents/:id/children
GET    /api/documents/:id/attachments

# Search
GET    /api/search?q=&project_id=

# Graph
GET    /api/graph?project_id=
GET    /api/graph/path?project_id=&from=&to=
GET    /api/graph/neighbors?project_id=&node_id=&hops=

# Attachments
POST   /api/attachments
GET    /api/attachments/:id

# Backup
POST   /api/backup                  { destination: "/path/to/dir" }
GET    /api/backup/browse?path=

# Settings
GET    /api/settings
PUT    /api/settings
```

</details>

---

## Data Storage

```
data/
├── sqlite/
│   └── knowledge.db        # All metadata — projects, pages, tags, relations, users, API keys
├── tantivy/                # Full-text search index (auto-rebuilt on schema change)
└── projects/
    └── {project-id}/
        └── attachments/    # Files per project
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
