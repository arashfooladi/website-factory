CREATE TABLE factory.environments (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES factory.projects(id),
  status text NOT NULL CHECK(status IN ('creating','stopped','starting','running','stopping','snapshotting','restoring','deleting','deleted','expired','failed','disk_limit')),
  limits jsonb NOT NULL, preview_port integer NOT NULL, current_operation_id uuid,
  expires_at timestamptz, retain_until timestamptz, reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX environment_ports ON factory.environments(preview_port) WHERE status <> 'deleted';
CREATE TABLE factory.environment_operations (
  id uuid PRIMARY KEY, environment_id uuid NOT NULL REFERENCES factory.environments(id),
  action text NOT NULL, input jsonb NOT NULL DEFAULT '{}', status text NOT NULL,
  attempt_id uuid, lease_expires_at timestamptz, error_code text, result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE factory.environment_snapshots (
  id uuid PRIMARY KEY, environment_id uuid NOT NULL REFERENCES factory.environments(id),
  sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE factory.environment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, environment_id uuid NOT NULL REFERENCES factory.environments(id),
  type text NOT NULL, data jsonb NOT NULL DEFAULT '{}', at timestamptz NOT NULL DEFAULT clock_timestamp()
);
