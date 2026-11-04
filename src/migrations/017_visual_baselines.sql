CREATE TABLE factory.visual_baselines (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES factory.projects(id),
 review_id uuid NOT NULL REFERENCES factory.visual_reviews(id),
 candidate_revision text NOT NULL, source_digest text NOT NULL,
 acceptance_sha256 text NOT NULL, manifest jsonb NOT NULL, artifacts jsonb NOT NULL,
 approved_by uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
