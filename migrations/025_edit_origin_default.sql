-- Fix: add SQL-level DEFAULT for edit_origin so inserts that don't
-- explicitly set it (standard upload path) succeed.
ALTER TABLE versions ALTER COLUMN edit_origin SET DEFAULT 'upload';
