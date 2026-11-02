CREATE TABLE factory.build_runs (
  id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES factory.projects(id),intake_id uuid NOT NULL REFERENCES factory.intakes(id),
  design_id uuid REFERENCES factory.design_records(id),design_run_id uuid REFERENCES factory.agent_runs(id),
  environment_id uuid REFERENCES factory.environments(id),builder_run_id uuid REFERENCES factory.agent_runs(id),
  status text NOT NULL CHECK(status IN ('queued','designing','provisioning','preparing','building','verifying','prototype_ready','cancelling','cancelled','needs_review')),
  input jsonb NOT NULL,input_sha256 text NOT NULL,asset_manifest jsonb NOT NULL DEFAULT '[]',content_manifest jsonb,
  attempt_id uuid,lease_expires_at timestamptz,deadline_at timestamptz NOT NULL,available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  candidate_revision text,source_digest text,observed_tokens integer NOT NULL DEFAULT 0,usage_confirmed boolean NOT NULL DEFAULT true,
  reason text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX one_active_build_per_project ON factory.build_runs(project_id) WHERE status NOT IN ('prototype_ready','cancelled','needs_review');
CREATE TABLE factory.build_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,build_id uuid NOT NULL REFERENCES factory.build_runs(id),
  type text NOT NULL,data jsonb NOT NULL DEFAULT '{}',at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE factory.build_artifacts (
  id uuid PRIMARY KEY,build_id uuid NOT NULL REFERENCES factory.build_runs(id),kind text NOT NULL,sha256 text NOT NULL,
  media_type text NOT NULL,bytes integer NOT NULL,candidate_revision text,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
