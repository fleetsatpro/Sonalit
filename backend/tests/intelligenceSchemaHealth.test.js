'use strict';

const {
  checkIntelligenceSchema,
  REQUIRED_TABLES,
  REQUIRED_COLUMNS,
  REQUIRED_INDEXES,
} = require('../src/utils/intelligenceSchemaHealth');

function catalogQuery({ missingTables = [], missingColumns = [], missingIndexes = [] } = {}) {
  const missingTableSet = new Set(missingTables);
  const missingColumnSet = new Set(missingColumns);
  const missingIndexSet = new Set(missingIndexes);
  return jest.fn(async (sql) => {
    if (sql.includes('pg_catalog.pg_attribute')) {
      const rows = [];
      for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
        for (const column of columns) {
          if (!missingColumnSet.has(`${table}.${column}`)) rows.push({ table_name: table, column_name: column });
        }
      }
      return { rows };
    }
    if (sql.includes("c.relkind IN ('i','I')")) {
      return { rows: REQUIRED_INDEXES.filter(name => !missingIndexSet.has(name)).map(index_name => ({ index_name })) };
    }
    if (sql.includes("c.relkind IN ('r','p','f')")) {
      return { rows: REQUIRED_TABLES.filter(name => !missingTableSet.has(name)).map(table_name => ({ table_name })) };
    }
    throw new Error('Unexpected schema inspection query: ' + sql);
  });
}

describe('intelligence public-schema health certification', () => {
  test('accepts a complete catalog with all required tables, columns and indexes', async () => {
    const dbQuery = catalogQuery();
    const result = await checkIntelligenceSchema(dbQuery);

    expect(result.ok).toBe(true);
    expect(result.missing_tables).toEqual([]);
    expect(result.missing_columns).toEqual([]);
    expect(result.missing_indexes).toEqual([]);
    expect(result.required_indexes).toBe(REQUIRED_INDEXES.length);
    expect(dbQuery).toHaveBeenCalledTimes(3);
  });

  test('identifies missing tables, columns and indexes independently', async () => {
    const dbQuery = catalogQuery({
      missingTables: ['intel_publications'],
      missingColumns: ['intel_observations.org_id'],
      missingIndexes: ['intel_events_org_time'],
    });
    const result = await checkIntelligenceSchema(dbQuery);

    expect(result.ok).toBe(false);
    expect(result.missing_tables).toContain('intel_publications');
    expect(result.missing_columns).toContain('intel_observations.org_id');
    expect(result.missing_indexes).toContain('intel_events_org_time');
  });

  test('certification explicitly includes tenancy-critical observation fields and query indexes', () => {
    expect(REQUIRED_COLUMNS.intel_observations).toContain('org_id');
    expect(REQUIRED_COLUMNS.intel_publications).toContain('id');
    expect(REQUIRED_INDEXES).toContain('intel_observations_org_time');
    expect(REQUIRED_TABLES).toContain('intel_publications');
  });

  test('startup hooks do not rerun migrations from npm prestart', async () => {
    const fs = require('fs');
    const path = require('path');
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    const migrateSource = fs.readFileSync(path.resolve(__dirname, '../scripts/db-migrate.js'), 'utf8');
    const gateSource = fs.readFileSync(path.resolve(__dirname, '../scripts/intelligence-schema-gate.js'), 'utf8');

    expect(pkg.scripts.prestart).toBe('node scripts/intelligence-schema-gate.js');
    expect(migrateSource).toContain('reconciliationAlreadySatisfied');
    expect(migrateSource).toContain("SET LOCAL lock_timeout = '8s'");
    expect(gateSource.indexOf('let result = await checkIntelligenceSchema'))
      .toBeLessThan(gateSource.indexOf('const reconciliationSql = fs.readFileSync'));
  });
});
