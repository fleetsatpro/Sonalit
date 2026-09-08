const REQUIRED_TABLES = [
  'intel_observations',
  'intel_events',
  'intel_sources',
  'intel_gaps',
  'intel_storylines',
  'intel_storyline_events',
  'intel_forecasts',
  'intel_publication_reviews',
];

const REQUIRED_COLUMNS = {
  intel_events: ['id', 'org_id', 'country_code', 'severity', 'confidence', 'last_seen_at'],
  intel_observations: ['id', 'source_id', 'observed_at', 'credibility', 'manipulation_score'],
  intel_gaps: ['id', 'org_id', 'gap_type', 'status', 'priority'],
  intel_storylines: ['id', 'org_id', 'reference', 'status', 'severity', 'confidence'],
  intel_storyline_events: ['storyline_id', 'event_id', 'sequence_no', 'relationship'],
  intel_forecasts: ['id', 'org_id', 'scope_type', 'horizon', 'probability', 'confidence', 'status'],
  intel_publication_reviews: ['id', 'org_id', 'publication_id', 'action', 'created_at'],
};

async function checkIntelligenceSchema(dbQuery) {
  const tableResult = await dbQuery(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY($1::text[])
  `, [REQUIRED_TABLES]);
  const presentTables = new Set(tableResult.rows.map(r => r.table_name));
  const missingTables = REQUIRED_TABLES.filter(t => !presentTables.has(t));

  const pairs = Object.entries(REQUIRED_COLUMNS)
    .flatMap(([table, columns]) => columns.map(column => ({ table, column })));
  const columnResult = await dbQuery(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND (table_name, column_name) IN (
        SELECT x.table_name, x.column_name
        FROM jsonb_to_recordset($1::jsonb) AS x(table_name text, column_name text)
      )
  `, [JSON.stringify(pairs)]);
  const presentColumns = new Set(columnResult.rows.map(r => `${r.table_name}.${r.column_name}`));
  const missingColumns = pairs
    .filter(({ table, column }) => !presentColumns.has(`${table}.${column}`))
    .map(({ table, column }) => `${table}.${column}`);

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    required_tables: REQUIRED_TABLES.length,
    missing_tables: missingTables,
    required_columns: pairs.length,
    missing_columns: missingColumns,
  };
}

module.exports = { checkIntelligenceSchema };
