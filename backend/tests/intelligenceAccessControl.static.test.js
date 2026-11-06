'use strict';
const fs = require('fs');
const path = require('path');

describe('Intelligence Centre access boundary', () => {
  test('both intelligence API routers require exact admin or super_admin roles', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/routes/risk.js'), 'utf8');
    expect(source).toContain("const { authenticate } = require('../middleware/auth')");
    expect(source).toContain("!['admin', 'super_admin'].includes(String(req.user?.role || ''))");
    expect(source).toContain("router.use('/intelligence/alerts', intelligenceAdminAccess, intelligenceAlertsRouter)");
    expect(source).toContain("router.use('/intelligence', intelligenceAdminAccess, intelligenceRouter)");
    expect(source).not.toContain("authorize('admin', 'super_admin')");
  });
});
