CREATE TABLE "ConviteQr" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "criadoPorId" TEXT NOT NULL,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'DISPONIVEL',
  "emailReservado" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "utilizadoEm" TIMESTAMP(3),
  CONSTRAINT "ConviteQr_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConviteQr_tokenHash_key" ON "ConviteQr"("tokenHash");
CREATE INDEX "ConviteQr_expiraEm_idx" ON "ConviteQr"("expiraEm");
ALTER TABLE public."ConviteQr" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."ConviteQr" FROM PUBLIC;
DO $$ DECLARE papel TEXT; BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."ConviteQr" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
