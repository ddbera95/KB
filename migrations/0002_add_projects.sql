-- 0002_add_projects.sql
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#6366f1',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO projects (id, name, slug, description, color, created_at, updated_at)
VALUES ('default', 'Default Project', 'default', 'Auto-created for existing data', '#6366f1',
        CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER));

ALTER TABLE collections ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE documents   ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';

UPDATE collections SET project_id = 'default';
UPDATE documents   SET project_id = 'default';

CREATE INDEX IF NOT EXISTS idx_collections_project ON collections(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_project   ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_project_collection ON documents(project_id, collection_id);
