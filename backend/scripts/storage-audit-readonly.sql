-- Sonalit storage audit (read-only). Run against a recovered database, not during WAL recovery.
-- psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f backend/scripts/storage-audit-readonly.sql
-- Every query is enclosed in a READ ONLY transaction. No writes or schema changes occur.

BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS database_name,
       current_timestamp AS measured_at,
       pg_size_pretty(pg_database_size(current_database())) AS database_size,
       pg_database_size(current_database()) AS database_bytes;

-- Largest relations, including indexes and TOAST.
SELECT schemaname,
       relname AS relation_name,
       n_live_tup AS estimated_live_rows,
       n_dead_tup AS estimated_dead_rows,
       pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass)) AS total_size,
       pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) AS total_bytes,
       pg_size_pretty(pg_relation_size(format('%I.%I', schemaname, relname)::regclass)) AS heap_size,
       pg_size_pretty(pg_indexes_size(format('%I.%I', schemaname, relname)::regclass)) AS index_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) DESC
LIMIT 40;

-- Binary payload columns that can be candidates for R2 (catalog only; no payload scan).
SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.udt_name
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND (c.data_type = 'bytea' OR c.column_name ILIKE '%photo%' OR c.column_name ILIKE '%pdf%'
       OR c.column_name ILIKE '%audio%' OR c.column_name ILIKE '%file%'
       OR c.column_name ILIKE '%image%' OR c.column_name ILIKE '%attachment%'
       OR c.column_name ILIKE '%storage_key%' OR c.column_name ILIKE '%object_key%')
ORDER BY c.data_type, c.table_name, c.ordinal_position;

-- Partition inventory: compare actual children/limits against the intended retention policy.
SELECT parent_ns.nspname AS schema_name,
       parent.relname AS parent_table,
       child.relname AS partition_name,
       pg_get_expr(child.relpartbound, child.oid) AS partition_bound,
       pg_size_pretty(pg_total_relation_size(child.oid)) AS partition_size,
       pg_total_relation_size(child.oid) AS partition_bytes
FROM pg_inherits i
JOIN pg_class parent ON parent.oid = i.inhparent
JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
JOIN pg_class child ON child.oid = i.inhrelid
WHERE parent_ns.nspname = 'public'
ORDER BY parent.relname, child.relname;

-- Active retention configuration, if present.
SELECT to_regclass('public.partition_retention') AS partition_retention_table,
       to_regclass('public.guardian_config') AS guardian_config_table;

COMMIT;

-- OPTIONAL, potentially expensive payload measurement. Run individually only after reviewing
-- the table sizes above and during a safe period. These queries read payload rows:
--
-- SELECT COUNT(*) AS data_uri_rows,
--        COALESCE(SUM(pg_column_size(photo_url)), 0) AS stored_bytes
-- FROM public.field_reports WHERE photo_url LIKE 'data:%';
--
-- SELECT COUNT(*) AS data_uri_rows,
--        COALESCE(SUM(pg_column_size(photo_url)), 0) AS stored_bytes
-- FROM public.convoy_truck_photos WHERE photo_url LIKE 'data:%';
--
-- Only run if the column exists:
-- SELECT COUNT(*) FILTER (WHERE pdf_data IS NOT NULL) AS stored_pdfs,
--        COALESCE(SUM(octet_length(pdf_data)), 0) AS pdf_payload_bytes
-- FROM public.convoy_daily_reports;
--
-- Only run if the table/column exists:
-- SELECT COUNT(*) AS audio_clips,
--        COALESCE(SUM(octet_length(audio)), 0) AS audio_payload_bytes
-- FROM public.guardian_voice_messages;
