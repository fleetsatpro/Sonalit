'use strict';

const fs = require('fs');
const path = require('path');

describe('production authentication configuration guard', () => {
  test('does not mint a process-local JWT signing key in production', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
    const missingSecretBlock = source.slice(
      source.indexOf("if (!process.env.JWT_SECRET)"),
      source.indexOf("\n}\n", source.indexOf("if (!process.env.JWT_SECRET)")) + 3,
    );
    expect(missingSecretBlock).toContain("NODE_ENV");
    expect(missingSecretBlock).toContain("RAILWAY_ENVIRONMENT_NAME");
    expect(missingSecretBlock).toContain("JWT_SECRET is required in production");
    expect(missingSecretBlock.indexOf('throw new Error')).toBeLessThan(missingSecretBlock.indexOf('randomBytes'));
  });
});
