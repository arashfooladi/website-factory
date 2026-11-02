CREATE TABLE factory.projects (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL, name text NOT NULL,
  site_type text NOT NULL CHECK (site_type IN ('wordpress','nextjs')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX projects_owner ON factory.projects(owner_id);
CREATE TABLE factory.jobs (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES factory.projects(id),
  pipeline text NOT NULL CHECK (pipeline = 'controller-smoke-v1'),
  status text NOT NULL CHECK (status IN ('queued','running','completed','cancelled','failed','needs_review')),
  input jsonb NOT NULL, limits jsonb NOT NULL,
  used_tokens integer NOT NULL DEFAULT 0 CHECK (used_tokens >= 0),
  used_cost_micros integer NOT NULL DEFAULT 0 CHECK (used_cost_micros >= 0),
  generation integer NOT NULL DEFAULT 0, current_attempt_id uuid,
  started_at timestamptz, deadline_at timestamptz, heartbeat_at timestamptz, lease_expires_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX jobs_recovery ON factory.jobs(status, lease_expires_at, available_at);
CREATE TABLE factory.stages (
  id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES factory.jobs(id),
  name text NOT NULL, ordinal integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
  output jsonb, UNIQUE(job_id, name), UNIQUE(job_id, ordinal)
);
CREATE TABLE factory.attempts (
  id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES factory.jobs(id),
  stage_id uuid NOT NULL REFERENCES factory.stages(id), generation integer NOT NULL,
  number integer NOT NULL, worker_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN ('running','completed','failed','interrupted','cancelled','timed_out')),
  reserved_tokens integer NOT NULL, reserved_cost_micros integer NOT NULL,
  usage_confirmed boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(), deadline_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz, error_code text,
  UNIQUE(stage_id, generation, number)
);
ALTER TABLE factory.jobs ADD CONSTRAINT current_attempt_fk FOREIGN KEY(current_attempt_id) REFERENCES factory.attempts(id);
CREATE TABLE factory.requirements (
  job_id uuid NOT NULL REFERENCES factory.jobs(id), key text NOT NULL, description text NOT NULL,
  required boolean NOT NULL, status text NOT NULL DEFAULT 'pending', PRIMARY KEY(job_id, key)
);
CREATE TABLE factory.artifacts (
  id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES factory.jobs(id),
  attempt_id uuid NOT NULL REFERENCES factory.attempts(id), stage_id uuid NOT NULL REFERENCES factory.stages(id),
  sha256 text NOT NULL, media_type text NOT NULL, bytes integer NOT NULL,
  storage_key text NOT NULL, candidate_revision text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(stage_id)
);
CREATE TABLE factory.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_id uuid NOT NULL REFERENCES factory.jobs(id),
  type text NOT NULL, data jsonb NOT NULL DEFAULT '{}', at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX events_job ON factory.events(job_id, id);
-- Demonstration effects commit in the same transaction as stage completion.
-- External tools must additionally honor idempotency keys in later parts.
CREATE TABLE factory.smoke_effects (
  job_id uuid NOT NULL REFERENCES factory.jobs(id), stage_name text NOT NULL,
  attempt_id uuid NOT NULL REFERENCES factory.attempts(id), PRIMARY KEY(job_id, stage_name)
);
