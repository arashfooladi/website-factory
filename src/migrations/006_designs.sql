ALTER TABLE factory.agent_runs ALTER COLUMN environment_id DROP NOT NULL;
CREATE UNIQUE INDEX one_active_reference_agent_per_project ON factory.agent_runs(project_id)
  WHERE environment_id IS NULL AND status IN ('queued','running','cancelling');
CREATE TABLE factory.design_records (
  id uuid PRIMARY KEY,run_id uuid NOT NULL UNIQUE REFERENCES factory.agent_runs(id),
  project_id uuid NOT NULL REFERENCES factory.projects(id),intake_id uuid NOT NULL REFERENCES factory.intakes(id),
  acceptance_sha256 text NOT NULL,record_artifact_id uuid NOT NULL REFERENCES factory.agent_artifacts(id),
  markdown_artifact_id uuid NOT NULL REFERENCES factory.agent_artifacts(id),
  instructions_sha256 text NOT NULL,skill_versions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE factory.agent_runs ADD COLUMN input_design_id uuid REFERENCES factory.design_records(id);
ALTER TABLE factory.agent_runs ADD COLUMN design_record_id uuid REFERENCES factory.design_records(id);
