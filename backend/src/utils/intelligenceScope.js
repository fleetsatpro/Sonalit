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

// Country evidence terms are intentionally conservative. A source's configured
// country is only a collection hint; content must also contain a defensible
// country/place signal before a country-scoped workspace can display it.
const COUNTRY_EVIDENCE = {
  BI:['burundi','bujumbura','gitega','ngozi','rumonge','muyinga','cibitoke'],
  CD:['drc','dr congo','democratic republic of the congo','kinshasa','goma','bukavu','beni','masisi','ituri','north kivu','south kivu','lubumbashi'],
  DJ:['djibouti','djibouti city','tadjoura','obock','ali sabieh'],
  ER:['eritrea','asmara','massawa','keren','assab'],
  ET:['ethiopia','addis ababa','dire dawa','mekelle','gondar','bahir dar','jijiga','adama','hawassa','tigray','amhara','oromia'],
  KE:['kenya','nairobi','mombasa','kisumu','nakuru','eldoret','garissa','mandera','lamu','isiolo','turkana','marsabit','kakamega','kitale','kericho','machakos','narok','naivasha','malindi','kilifi','kwale'],
  KM:['comoros','moroni','anjouan','mohéli','moheli'],
  MG:['madagascar','antananarivo','toamasina','mahajanga','toliara'],
  MU:['mauritius','port louis','curepipe','quatre bornes'],
  MW:['malawi','lilongwe','blantyre','mzuzu','mangochi'],
  MZ:['mozambique','maputo','beira','nampula','pemba','nacala','cabo delgado'],
  RW:['rwanda','kigali','rubavu','rusizi','musanze','gisenyi','huye','nyagatare','karongi'],
  SC:['seychelles','victoria seychelles','mahe'],
  SO:['somalia','mogadishu','hargeisa','kismayo','baidoa','garowe','bosaso','beledweyne','galkayo','puntland','somaliland'],
  SS:['south sudan','juba','bor','malakal','wau','nimule','yei','bentiu','renk'],
  TZ:['tanzania','dar es salaam','dodoma','arusha','mwanza','mbeya','zanzibar','tanga','morogoro','mtwara','kigoma','moshi'],
  UG:['uganda','kampala','entebbe','gulu','mbarara','jinja','fort portal','kasese','busia','mbale','lira','arua','masaka'],
  ZM:['zambia','lusaka','ndola','kitwe','livingstone','copperbelt'],
  ZW:['zimbabwe','harare','bulawayo','mutare','gweru','masvingo'],
  BF:['burkina faso','ouagadougou','bobo-dioulasso'],
  GH:['ghana','accra','kumasi','tamale'],
  ML:['mali','bamako','gao','timbuktu','mopti'],
  NG:['nigeria','abuja','lagos','kano','kaduna','maiduguri','port harcourt'],
  SN:['senegal','dakar','saint-louis'],
  ZA:['south africa','johannesburg','pretoria','cape town','durban'],
  SD:['sudan','khartoum','darfur','port sudan','el fasher','omdurman','gedaref','kassala','kordofan'],
};

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

function countryEvidencePatterns(scope) {
  if (scope.type !== 'country') return [];
  return (COUNTRY_EVIDENCE[scope.key] || [scope.key.toLowerCase()]).map(term => `%${term.replace(/[%_]/g,'')}%`);
}

function textProjection(alias) {
  // to_jsonb keeps this helper safe across intelligence object tables that do
  // not share identical schemas while still constraining country reads to text
  // evidence rather than trusting the country_code column alone.
  return `(LOWER(CONCAT_WS(' ',
    COALESCE(to_jsonb(${alias})->>'title',''),
    COALESCE(to_jsonb(${alias})->>'headline',''),
    COALESCE(to_jsonb(${alias})->>'summary',''),
    COALESCE(to_jsonb(${alias})->>'description',''),
    COALESCE(to_jsonb(${alias})->>'body',''),
    COALESCE(to_jsonb(${alias})->>'judgement',''),
    COALESCE(to_jsonb(${alias})->>'assessment',''),
    COALESCE(to_jsonb(${alias})->>'scenario',''),
    COALESCE(to_jsonb(${alias})->>'destination',''),
    COALESCE(to_jsonb(${alias})->>'reference',''),
    COALESCE(to_jsonb(${alias})->>'name','')
  )))`;
}

// Returns a SQL predicate and parameters. Non-global scopes are deliberately
// fail-closed: country-scoped rows must have both the expected country code and
// independent textual evidence for the requested country.
function countryClause(scope, alias, index) {
  if (scope.type === 'global') return { clause: 'TRUE', params: [] };
  const countries = countriesFor(scope);
  if (scope.type !== 'country') {
    return {
      clause: `UPPER(${alias}.country_code) = ANY($${index}::text[])`,
      params: [countries],
    };
  }
  const patterns = countryEvidencePatterns(scope);
  return {
    clause: `${alias}.country_code = $${index} AND ${textProjection(alias)} LIKE ANY($${index + 1}::text[])`,
    params: [scope.key, patterns],
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
