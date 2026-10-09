'use strict';

const REQUIRED_TABLES = [
  'intel_observations',
  'intel_events',
  'intel_sources',
  'intel_publications',
  'intel_gaps',
  'intel_storylines',
  'intel_storyline_events',
  'intel_forecasts',
  'intel_publication_reviews',
];

const REQUIRED_COLUMNS = {
  intel_events: ['id', 'org_id', 'country_code', 'severity', 'confidence', 'last_seen_at'],
  intel_observations: ['id', 'org_id', 'source_id', 'observed_at', 'credibility', 'manipulation_score'],
  intel_publications: ['id'],
  intel_gaps: ['id', 'org_id', 'gap_type', 'status', 'priority'],
  intel_storylines: ['id', 'org_id', 'reference', 'status', 'severity', 'confidence'],
  intel_storyline_events: ['storyline_id', 'event_id', 'sequence_no', 'relationship'],
  intel_forecasts: ['id', 'org_id', 'scope_type', 'horizon', 'probability', 'confidence', 'status'],
  intel_publication_reviews: ['id', 'org_id', 'publication_id', 'action', 'created_at'],
};

const REQUIRED_INDEXES = [
  'intel_events_org_time',
  'intel_observations_org_time',
  'intel_gaps_queue',
  'intel_storylines_active',
  'intel_forecasts_scope',
  'intel_publication_reviews_pub',
];

// Inspect PostgreSQL catalogs rather than inferring readiness from the migration
// ledger. A restored/imported database can have a complete ledger but an
// incomplete physical schema. All lookups are explicitly scoped to public.
async function checkIntelligenceSchema(dbQuery) {
  const tableResult = await dbQuery(`
    SELECT c.relname AS table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1::text[])
      AND c.relkind IN ('r','p','f')
  `, [REQUIRED_TABLES]);
  const presentTables = new Set(tableResult.rows.map(r => r.table_name));
  const missingTables = REQUIRED_TABLES.filter(t => !presentTables.has(t));

  const pairs = Object.entries(REQUIRED_COLUMNS)
    .flatMap(([table, columns]) => columns.map(column => ({ table, column })));
  const columnResult = await dbQuery(`
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1::text[])
      AND c.relkind IN ('r','p','f')
      AND a.attnum > 0
      AND NOT a.attisdropped
  `, [REQUIRED_TABLES]);
  const presentColumns = new Set(columnResult.rows.map(r => `${r.table_name}.${r.column_name}`));
  const missingColumns = pairs
    .filter(({ table, column }) => !presentColumns.has(`${table}.${column}`))
    .map(({ table, column }) => `${table}.${column}`);

  const indexResult = await dbQuery(`
    SELECT c.relname AS index_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1::text[])
      AND c.relkind IN ('i','I')
  `, [REQUIRED_INDEXES]);
  const presentIndexes = new Set(indexResult.rows.map(r => r.index_name));
  const missingIndexes = REQUIRED_INDEXES.filter(index => !presentIndexes.has(index));

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0 && missingIndexes.length === 0,
    required_tables: REQUIRED_TABLES.length,
    missing_tables: missingTables,
    required_columns: pairs.length,
    missing_columns: missingColumns,
    required_indexes: REQUIRED_INDEXES.length,
    missing_indexes: missingIndexes,
  };
}

module.exports = {
  checkIntelligenceSchema,
  REQUIRED_TABLES,
  REQUIRED_COLUMNS,
  REQUIRED_INDEXES,
};
