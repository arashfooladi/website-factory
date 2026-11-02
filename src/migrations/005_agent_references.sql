ALTER TABLE factory.agent_runs ADD COLUMN intake_id uuid REFERENCES factory.intakes(id);
