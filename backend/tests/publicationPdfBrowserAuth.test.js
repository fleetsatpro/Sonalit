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
    expect(s).toContain("['admin', 'super_admin'].includes(user.role)");
    expect(s).toContain("AND org_id = $2");
  });

  test('bearer-token PDF access enforces the admin role before the compatibility route can stream data', () => {
    const s = fs.readFileSync(path.join(__dirname, '../src/middleware/publicationPdfCapability.js'), 'utf8');
    expect(s).toContain("const { authenticate, authorize } = require('./auth');");
    expect(s).toContain("authorize('admin', 'super_admin')(req, res, next)");
    expect(s).not.toContain("if (authHeader) return authenticate(req, res, next);");
  });

  test('publication PDF images use the same bounded public-HTTPS fetch boundary', () => {
    const s = fs.readFileSync(path.join(__dirname, '../src/services/intelligencePublicationPdf.js'), 'utf8');
    expect(s).toContain("safeFetchPublicResearch(url,{timeoutMs:10000,maxBytes:MAX_PDF_IMAGE_BYTES})");
    expect(s).toContain("PDF_IMAGE_CONTENT_TYPES.has(contentType)");
    expect(s).toContain("limitInputPixels:30_000_000");
    expect(s).toContain("response.arrayBuffer()");
    expect(s).not.toContain("fetch(url,{redirect:'follow'");
  });

  test('Intelligence publication feed mints the PDF capability used by the legacy browser links', () => {
    const s = fs.readFileSync(path.join(__dirname, '../src/routes/intelligenceOperations.js'), 'utf8');
    expect(s).toContain("router.get('/publications'");
    expect(s).toContain('issuePublicationPdfCapability(res,req.user)');
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

  test('publication PDF stream handler is exported for both admin routes', () => {
    const service = require('../src/services/intelligencePublicationPdf');
    expect(typeof service.streamPublicationPdf).toBe('function');
    expect(typeof service.getPublicationPdfObject).toBe('function');
  });

  test('publication PDF transport remains tenant-scoped and does not expose an R2 redirect', () => {
    const s = fs.readFileSync(path.join(__dirname, '../src/services/intelligencePublicationPdf.js'), 'utf8');
    expect(s).toContain('SELECT pdf_key,body FROM intel_publications WHERE id=$1 AND org_id=$2');
    expect(s).toContain('streamPublicationPdf');
    expect(s).toContain("Content-Disposition");
    expect(s).not.toContain('res.redirect(302');
  });

  test('Intel Hub publication listing never returns raw PDF storage locators', () => {
    const s = fs.readFileSync(path.join(__dirname, '../src/routes/intelligenceOperations.js'), 'utf8');
    expect(s).toContain('const safeRows=rows.map(row=>{const item={...row,pdf_url:null};delete item.pdf_key;return item;});');
    expect(s).toContain('publications:safeRows');
  });

  test('new publication PDFs use opaque storage keys and do not return public R2 URLs', () => {
    const s = fs.readFileSync(path.join(__dirname, '../src/services/intelligencePublicationPdf.js'), 'utf8');
    expect(s).toContain('crypto.randomUUID()');
    expect(s).toContain('pdf_url:null');
    expect(s).not.toContain('R2_PUBLIC_URL');
  });
});
