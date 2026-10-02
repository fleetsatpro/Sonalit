-- Final tenant-RLS reconciliation for columns added by late migrations.
-- This deliberately runs after the 120/121/122 schema changes so any table that
-- becomes tenant-bearing later in the migration chain cannot be left unprotected.

DO $tenant$
DECLARE
  r RECORD;
  p RECORD;
  bootstrap CONSTANT TEXT[] := ARRAY[
    'users','guardian_devices','portal_tokens','cargo_clients','client_magic_links',
    'telemetry_ingest_keys','tracking_qr_codes','tracking_sessions','field_devices',
    'field_sessions','field_agent_pins','enrollment_codes','convoy_codes'
  ];
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public'
       AND c.relkind IN ('r','p')
       AND c.relname <> 'runtime_diagnostics'
       AND EXISTS (
         SELECT 1
           FROM pg_attribute a
          WHERE a.attrelid=c.oid
            AND a.attname='org_id'
            AND NOT a.attisdropped
       )
  LOOP
    FOR p IN
      SELECT policyname
        FROM pg_policies
       WHERE schemaname=r.schema_name
         AND tablename=r.table_name
         AND policyname IN (
           'tenant_isolation_hardening',
           'tenant_isolation_hardening_insert',
           'tenant_isolation_hardening_update',
           'tenant_isolation_hardening_delete',
           'tenant_global_risk_read'
         )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, r.schema_name, r.table_name);
    END LOOP;

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schema_name, r.table_name);

    IF NOT (r.table_name = ANY(bootstrap)) THEN
      EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.schema_name, r.table_name);
    END IF;

    IF r.table_name='risk_zones' THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation_hardening ON %I.%I AS RESTRICTIVE FOR SELECT USING (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),'''') OR org_id IS NULL)',
        r.schema_name, r.table_name
      );
      EXECUTE format(
        'CREATE POLICY tenant_isolation_hardening_insert ON %I.%I AS RESTRICTIVE FOR INSERT WITH CHECK (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),''''))',
        r.schema_name, r.table_name
      );
      EXECUTE format(
        'CREATE POLICY tenant_isolation_hardening_update ON %I.%I AS RESTRICTIVE FOR UPDATE USING (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),'''')) WITH CHECK (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),''''))',
        r.schema_name, r.table_name
      );
      EXECUTE format(
        'CREATE POLICY tenant_isolation_hardening_delete ON %I.%I AS RESTRICTIVE FOR DELETE USING (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),''''))',
        r.schema_name, r.table_name
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY tenant_isolation_hardening ON %I.%I AS RESTRICTIVE FOR ALL USING (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),'''')) WITH CHECK (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),''''))',
        r.schema_name, r.table_name
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_policies
       WHERE schemaname=r.schema_name
         AND tablename=r.table_name
         AND permissive='PERMISSIVE'
    ) THEN
      IF r.table_name='risk_zones' THEN
        EXECUTE format(
          'CREATE POLICY tenant_base_fallback ON %I.%I AS PERMISSIVE FOR ALL USING (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),'''') OR org_id IS NULL) WITH CHECK (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),''''))',
          r.schema_name, r.table_name
        );
      ELSE
        EXECUTE format(
          'CREATE POLICY tenant_base_fallback ON %I.%I AS PERMISSIVE FOR ALL USING (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),'''')) WITH CHECK (org_id::text=NULLIF(current_setting(''app.current_org_id'',true),''''))',
          r.schema_name, r.table_name
        );
      END IF;
    END IF;
  END LOOP;
END $tenant$;
