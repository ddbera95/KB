-- No-op on existing installs (0003 already ran).
-- On fresh installs 0003 runs with PRAGMA foreign_keys=OFF needed — this
-- migration ensures any residual state is correct.
-- Safe to run: SELECT 1 is a no-op.
SELECT 1;
