-- Drop global slug uniqueness on collections; replace with per-project uniqueness.
-- SQLite does not support DROP CONSTRAINT, so we recreate the table.
-- We MUST disable foreign keys during the swap to prevent ON DELETE SET NULL
-- from cascading to documents.collection_id.

PRAGMA foreign_keys = OFF;

CREATE TABLE collections_new (
    id          TEXT NOT NULL PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL,
    description TEXT,
    icon        TEXT,
    project_id  TEXT NOT NULL DEFAULT 'default',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    UNIQUE(slug, project_id)
);

INSERT INTO collections_new SELECT id, name, slug, description, icon, project_id, created_at, updated_at FROM collections;

DROP TABLE collections;
ALTER TABLE collections_new RENAME TO collections;

PRAGMA foreign_keys = ON;
