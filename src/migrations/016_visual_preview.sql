ALTER TABLE factory.visual_reviews ADD COLUMN qa_environment_id uuid REFERENCES factory.environments(id);
