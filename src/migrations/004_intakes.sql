CREATE TABLE factory.project_assets (
  id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES factory.projects(id),
  name text NOT NULL,media_type text NOT NULL,bytes integer NOT NULL,sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE factory.intakes (
  id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES factory.projects(id),revision integer NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','cancelling','completed','cancelled','needs_review')),
  brief jsonb NOT NULL,brief_sha256 text NOT NULL,baseline_sha256 text NOT NULL,
  attempt_id uuid,lease_expires_at timestamptz,deadline_at timestamptz,browser_id uuid,
  reason text,spec_artifact_id uuid,acceptance_sha256 text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz,
  UNIQUE(project_id,revision)
);
CREATE UNIQUE INDEX one_active_intake_per_project ON factory.intakes(project_id) WHERE status IN ('queued','running','cancelling');
CREATE TABLE factory.intake_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,intake_id uuid NOT NULL REFERENCES factory.intakes(id),
  type text NOT NULL,data jsonb NOT NULL DEFAULT '{}',at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE factory.intake_artifacts (
  id uuid PRIMARY KEY,intake_id uuid NOT NULL REFERENCES factory.intakes(id),kind text NOT NULL,
  sha256 text NOT NULL,media_type text NOT NULL,bytes integer NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
