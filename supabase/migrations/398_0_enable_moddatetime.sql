-- Contrib trigger helper: extensions.moddatetime(column) sets updated_at on UPDATE.
-- Required before migrations that use EXECUTE FUNCTION extensions.moddatetime('updated_at').
CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;
