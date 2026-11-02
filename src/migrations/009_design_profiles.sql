CREATE TABLE factory.design_profiles (
  id uuid PRIMARY KEY,owner_id uuid NOT NULL,provider text NOT NULL,model text NOT NULL,domain text NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','completed','cancelling','cancelled','needs_review')),
  input jsonb NOT NULL,profile jsonb,artifacts jsonb NOT NULL DEFAULT '[]',usage jsonb,
  attempt_id uuid,lease_expires_at timestamptz,deadline_at timestamptz,browser_id uuid,active_task_id uuid,
  reason text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz
);
CREATE TABLE factory.design_profile_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,profile_id uuid NOT NULL REFERENCES factory.design_profiles(id),
  type text NOT NULL,data jsonb NOT NULL DEFAULT '{}',at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE factory.agent_runs ADD COLUMN design_profile_id uuid REFERENCES factory.design_profiles(id);
