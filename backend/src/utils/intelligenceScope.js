const REGIONS = {
  'east-africa': ['BI','DJ','ER','ET','KE','KM','MG','MU','MW','MZ','RW','SC','SO','SS','TZ','UG','ZM','ZW'],
  'west-africa': ['BJ','BF','CV','CI','GM','GH','GN','GW','LR','ML','MR','NE','NG','SH','SL','SN','TG'],
  'central-africa': ['AO','CF','CG','CD','CM','GA','GQ','ST','TD'],
  'north-africa': ['DZ','EG','LY','MA','SD','TN'],
  'southern-africa': ['BW','LS','NA','SZ','ZA'],
};

const AFRICA = [...new Set(Object.values(REGIONS).flat())];
const REGION_BY_COUNTRY = Object.fromEntries(
  Object.entries(REGIONS).flatMap(([region, countries]) => countries.map(country => [country, region]))
);

function normaliseScope(req) {
  const type = String(req.query.scope_type || 'global').toLowerCase();
  const key = String(req.query.scope_key || '').trim().toLowerCase();
  if (type === 'global') return { type: 'global', key: 'global' };
  if (!['country','region','continent'].includes(type)) {
    const err = new Error('Invalid intelligence scope_type');
    err.status = 400;
    throw err;
  }
  if (!key) {
    const err = new Error('scope_key is required for non-global intelligence scope');
    err.status = 400;
    throw err;
  }
  if (type === 'country') return { type, key: key.toUpperCase() };
  if (type === 'region' && !REGIONS[key]) {
    const err = new Error('Unknown intelligence region');
    err.status = 400;
    throw err;
  }
  if (type === 'continent' && key !== 'africa') {
    const err = new Error('Unsupported intelligence continent');
    err.status = 400;
    throw err;
  }
  return { type, key };
}

function countriesFor(scope) {
  if (scope.type === 'country') return [scope.key];
  if (scope.type === 'region') return REGIONS[scope.key] || [];
  if (scope.type === 'continent') return scope.key === 'africa' ? AFRICA : [];
  return [];
}

// Returns a SQL predicate and parameters. Non-global scopes are deliberately
// fail-closed: a row without defensible geographic attribution is excluded.
function countryClause(scope, alias, index) {
  if (scope.type === 'global') return { clause: 'TRUE', params: [] };
  const countries = countriesFor(scope);
  return {
    clause: `${alias}.country_code = ANY($${index}::text[])`,
    params: [countries],
  };
}

function scopedObjectClause(scope, alias, index) {
  if (scope.type === 'global') return { clause: 'TRUE', params: [] };
  return {
    clause: `((LOWER(${alias}.scope_type) = $${index} AND LOWER(${alias}.scope_key) = $${index + 1}) OR (LOWER(${alias}.scope_type) = 'country' AND UPPER(${alias}.scope_key) = ANY($${index + 2}::text[])))`,
    params: [scope.type, scope.key, countriesFor(scope)],
  };
}

function watchlistClause(scope, alias, index) {
  if (scope.type === 'global') return { clause: 'TRUE', params: [] };
  const countries = countriesFor(scope);
  return {
    clause: `(
      (${alias}.target->>'scope_type' = $${index} AND LOWER(${alias}.target->>'scope_key') = $${index + 1})
      OR LOWER(COALESCE(${alias}.target->>'region','')) = $${index + 1}
      OR UPPER(COALESCE(${alias}.target->>'country_code','')) = ANY($${index + 2}::text[])
      OR UPPER(COALESCE(${alias}.target->>'country','')) = ANY($${index + 2}::text[])
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${alias}.target->'country_codes')='array' THEN ${alias}.target->'country_codes' ELSE '[]'::jsonb END) c WHERE UPPER(c) = ANY($${index + 2}::text[]))
    )`,
    params: [scope.type, scope.key, countries],
  };
}

module.exports = {
  REGIONS,
  AFRICA,
  REGION_BY_COUNTRY,
  normaliseScope,
  countriesFor,
  countryClause,
  scopedObjectClause,
  watchlistClause,
};
