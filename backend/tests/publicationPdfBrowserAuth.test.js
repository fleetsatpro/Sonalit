const fs = require('fs');
const path = require('path');

describe('browser-native publication PDF compatibility', () => {
  test('publication ledger mints a narrowly scoped PDF capability cookie', () => {
    const s = fs.readFileSync(path.join(__dirname, '../src/routes/communicationsControl.js'), 'utf8');
    expect(s).toContain('issuePublicationPdfCapability(res, req.user)');
  });

  test('PDF capability middleware is isolated to publication PDF access', () => {
    const s = fs.readFileSync(path.join(__dirname, '../src/middleware/publicationPdfCapability.js'), 'utf8');
    expect(s).toContain("sonalit_pdf_capability");
    expect(s).toContain("/api/v1/admin/communications/publications");
    expect(s).toContain("aud: 'publication-pdf'");
    expect(s).toContain("expiresIn: '10m'");
    expect(s).toContain("httpOnly: true");
    expect(s).toContain("sameSite: 'strict'");
    expect(s).toContain("role === 'admin'");
    expect(s).toContain("role === 'super_admin'");
    expect(s).toContain("u.org_id = $2");
  });

  test('admin compatibility route runs before the global bearer-only admin gate', () => {
    const s = fs.readFileSync(path.join(__dirname, '../src/routes/admin.js'), 'utf8');
    const route = s.indexOf("router.get('/communications/publications/:id/pdf'");
    const gate = s.indexOf("router.use(authenticate, authorize('admin', 'super_admin'), attachOrgDb)");
    expect(route).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(route);
    expect(s).toContain('authenticatePublicationPdfCapability');
    expect(s).toContain('streamPublicationPdf');
  });

  test('publication PDF transport remains tenant-scoped and does not expose an R2 redirect', () => {
    const s = fs.readFileSync(path.join(__dirname, '../src/services/intelligencePublicationPdf.js'), 'utf8');
    expect(s).toContain('SELECT pdf_key FROM intel_publications WHERE id=$1 AND org_id=$2');
    expect(s).toContain('streamPublicationPdf');
    expect(s).toContain("Content-Disposition");
    expect(s).not.toContain('res.redirect(302');
  });
});
