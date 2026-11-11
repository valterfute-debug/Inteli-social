ALTER TABLE public."ConviteEquipe" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."ConviteEquipe" FROM PUBLIC;
DO $$
DECLARE papel TEXT;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."ConviteEquipe" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
