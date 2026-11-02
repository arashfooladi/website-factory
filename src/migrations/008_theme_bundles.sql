CREATE TABLE factory.theme_bundles (
  id uuid PRIMARY KEY, manifest jsonb NOT NULL, source_digest text NOT NULL,
  status text NOT NULL CHECK(status IN ('imported','queued','certifying','certified','needs_review')),
  runtime_sha256 text, report jsonb, reason text,
  validation_project_id uuid REFERENCES factory.projects(id), environment_id uuid REFERENCES factory.environments(id),
  attempt_id uuid, lease_expires_at timestamptz, deadline_at timestamptz, browser_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE factory.theme_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), default_bundle_id uuid NOT NULL REFERENCES factory.theme_bundles(id)
);
CREATE TABLE factory.theme_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, bundle_id uuid NOT NULL REFERENCES factory.theme_bundles(id),
  type text NOT NULL, data jsonb NOT NULL DEFAULT '{}', at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE factory.environments ADD COLUMN theme_bundle_id uuid REFERENCES factory.theme_bundles(id);
ALTER TABLE factory.environments ADD COLUMN allocation_key text UNIQUE;
ALTER TABLE factory.intakes ADD COLUMN theme_bundle_id uuid REFERENCES factory.theme_bundles(id);
ALTER TABLE factory.build_runs ADD COLUMN theme_bundle_id uuid REFERENCES factory.theme_bundles(id);
