CREATE TABLE factory.agent_runs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES factory.projects(id),
  environment_id uuid NOT NULL REFERENCES factory.environments(id),
  parent_run_id uuid REFERENCES factory.agent_runs(id),
  session_key uuid NOT NULL,
  provider text NOT NULL,model text NOT NULL,role text NOT NULL,prompt text NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','cancelling','cancelled','completed','failed','needs_review')),
  instructions_sha256 text NOT NULL,skill_versions jsonb NOT NULL,limits jsonb NOT NULL,
  attempt_id uuid,lease_expires_at timestamptz,deadline_at timestamptz,
  provider_session_id text,provider_turn_id text,browser_id uuid,
  usage jsonb NOT NULL DEFAULT '{}',reason text,summary text,candidate_revision text,source_digest text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),started_at timestamptz,finished_at timestamptz
);
CREATE UNIQUE INDEX one_active_agent_per_environment ON factory.agent_runs(environment_id)
  WHERE status IN ('queued','running','cancelling');
CREATE TABLE factory.agent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES factory.agent_runs(id),
  type text NOT NULL,data jsonb NOT NULL DEFAULT '{}',at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE factory.agent_artifacts (
  id uuid PRIMARY KEY,run_id uuid NOT NULL REFERENCES factory.agent_runs(id),
  kind text NOT NULL,sha256 text NOT NULL,media_type text NOT NULL,bytes bigint NOT NULL,
  candidate_revision text,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
