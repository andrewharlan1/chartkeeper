-- Add is_dummy flag to users table for testing-only accounts.
-- Dummy users show in team lists and can be assigned to instruments,
-- but cannot log in (no valid password).

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_dummy BOOLEAN NOT NULL DEFAULT false;
