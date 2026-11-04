CREATE TABLE factory.visual_reviews (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES factory.projects(id),
 candidate_run_id uuid NOT NULL REFERENCES factory.agent_runs(id),
 candidate_revision text NOT NULL, source_digest text NOT NULL, storage_key text NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','cancelling','cancelled','reviewed','needs_review')),
 input jsonb NOT NULL,input_sha256 text NOT NULL,provider text NOT NULL,model text NOT NULL,
 attempt_id uuid,lease_expires_at timestamptz,deadline_at timestamptz,
 active_task_id uuid,browser_id uuid,usage jsonb NOT NULL DEFAULT '{}',
 artifacts jsonb NOT NULL DEFAULT '[]',report jsonb,reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz
);
CREATE UNIQUE INDEX one_active_visual_review ON factory.visual_reviews(candidate_run_id)
 WHERE status IN ('queued','running','cancelling');
CREATE TABLE factory.visual_review_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 review_id uuid NOT NULL REFERENCES factory.visual_reviews(id),type text NOT NULL,data jsonb NOT NULL,
 at timestamptz NOT NULL DEFAULT clock_timestamp()
);
