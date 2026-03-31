-- service_jobs: title + description (required by service workspace projects UI; missing from initial 314/321 schema)

ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE service_jobs ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN service_jobs.title IS 'Project / engagement display name';
COMMENT ON COLUMN service_jobs.description IS 'Optional project notes';
