ALTER TABLE factory.agent_runs ADD COLUMN build_id uuid REFERENCES factory.build_runs(id);
ALTER TABLE factory.agent_runs ADD COLUMN build_step text CHECK(build_step IN ('design','builder'));
CREATE UNIQUE INDEX one_agent_per_build_step ON factory.agent_runs(build_id,build_step) WHERE build_id IS NOT NULL;
