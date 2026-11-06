'use strict';
const fs = require('fs');
const path = require('path');

const read = relative => fs.readFileSync(path.join(__dirname, relative), 'utf8');

describe('Intelligence manual collection tenant boundary', () => {
  test('manual collection is bound to the authenticated tenant, never request input', () => {
    const route = read('../src/routes/intelligence.js');
    expect(route).toContain("if(!req.user.org_id)return res.status(403).json({error:'tenant_scope_required'})");
    expect(route).toContain('runCollection(req.user.org_id)');
    expect(route).not.toContain('runCollection(req.body');
    expect(route).not.toContain('runCollection()');
  });

  test('manual bootstrap requires an explicit tenant identifier', () => {
    const bootstrap = read('../src/utils/intelligenceCollectionBootstrap.js');
    expect(bootstrap).toContain("if (typeof orgId !== 'string' || !orgId.trim()) return { error: 'tenant_scope_required' }");
    expect(bootstrap).toContain('runCollectionFabric({ orgIds: [orgId.trim()] })');
  });

  test('an explicit tenant list cannot fall through to the platform-wide organization query', () => {
    const fabric = read('../src/utils/collectionFabric.js');
    expect(fabric).toContain('async function runCollectionFabric({ orgIds } = {})');
    expect(fabric).toContain('const scopedOrgIds = orgIds === undefined ? null');
    expect(fabric).toContain('const orgs = scopedOrgIds === null');
    expect(fabric).toContain('scopedOrgIds.map(org_id => ({ org_id }))');
    expect(fabric).toContain('SELECT DISTINCT org_id FROM users WHERE org_id IS NOT NULL AND deleted_at IS NULL');
  });

  test('the scheduled platform runner retains its explicit unscoped default invocation', () => {
    const app = read('../src/app.js');
    expect(app).toContain('runCollectionFabric().catch(err => logger.error("Intelligence Collection Fabric error: " + err.message))');
  });
});
