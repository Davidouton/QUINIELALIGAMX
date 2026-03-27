-- Users table for the FastAPI auth/users flow.
-- Use this in Supabase SQL Editor if you want to bootstrap manually
-- instead of running Alembic against the project database.

CREATE TABLE IF NOT EXISTS public.lmx_users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_lmx_users_email
  ON public.lmx_users (email);

CREATE INDEX IF NOT EXISTS ix_lmx_users_id
  ON public.lmx_users (id);
