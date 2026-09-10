const {
  AFRICA,
  REGIONS,
  normaliseScope,
  countryClause,
  scopedObjectClause,
  watchlistClause,
} = require('../src/utils/intelligenceScope');

describe('intelligence geographic scope contract', () => {
  test('normalises country scope to uppercase and rejects missing keys', () => {
    expect(normaliseScope({ query: { scope_type: 'country', scope_key: 'ke' } })).toEqual({ type: 'country', key: 'KE' });
    expect(() => normaliseScope({ query: { scope_type: 'country' } })).toThrow('scope_key is required');
  });

  test('normalises supported regional and continental scopes', () => {
    expect(REGIONS['east-africa']).toContain('KE');
    expect(normaliseScope({ query: { scope_type: 'region', scope_key: 'east-africa' } })).toEqual({ type: 'region', key: 'east-africa' });
    expect(normaliseScope({ query: { scope_type: 'continent', scope_key: 'africa' } })).toEqual({ type: 'continent', key: 'africa' });
    expect(AFRICA).toContain('NG');
    expect(AFRICA).not.toContain('US');
  });

  test('fails closed for unsupported geography', () => {
    expect(() => normaliseScope({ query: { scope_type: 'region', scope_key: 'north-america' } })).toThrow('Unknown intelligence region');
    expect(() => normaliseScope({ query: { scope_type: 'continent', scope_key: 'europe' } })).toThrow('Unsupported intelligence continent');
  });

  test('country predicates cannot match an unscoped row', () => {
    const predicate = countryClause({ type: 'country', key: 'KE' }, 'e', 2);
    expect(predicate.clause).toContain('e.country_code = ANY($2::text[])');
    expect(predicate.params).toEqual([['KE']]);
  });

  test('region predicates allow explicit regional scope and member countries only', () => {
    const predicate = scopedObjectClause({ type: 'region', key: 'east-africa' }, 'g', 2);
    expect(predicate.clause).toContain("LOWER(g.scope_type) = $2");
    expect(predicate.clause).toContain("LOWER(g.scope_key) = $3");
    expect(predicate.params[0]).toBe('region');
    expect(predicate.params[1]).toBe('east-africa');
    expect(predicate.params[2]).toContain('KE');
    expect(predicate.params[2]).not.toContain('NG');
  });

  test('watchlists require defensible target geography', () => {
    const predicate = watchlistClause({ type: 'country', key: 'KE' }, 'w', 2);
    expect(predicate.clause).toContain("w.target->>'country_code'");
    expect(predicate.params[2]).toEqual(['KE']);
  });
});
