ALTER TABLE factory.agent_runs ADD COLUMN publish_source_sha256 text
  CHECK (publish_source_sha256 IS NULL OR publish_source_sha256 ~ '^[a-f0-9]{64}$');
