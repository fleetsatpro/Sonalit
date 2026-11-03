const { spawnSync } = require('child_process');
const path = require('path');

describe('db-migrate production environment guard', () => {
  test('fails closed when DATABASE_URL is missing in production', () => {
    const script = path.resolve(__dirname, '../../scripts/db-migrate.js');
    const result = spawnSync(process.execPath, [script], {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        RAILWAY_ENVIRONMENT_NAME: 'production',
        DATABASE_URL: '',
      },
    });

    expect(result.status).toBe(78);
    expect(`${result.stdout || ''}${result.stderr || ''}`).toContain(
      'DATABASE_URL is required in production'
    );
  });

  test('keeps the development/test skip behaviour when DATABASE_URL is missing', () => {
    const script = path.resolve(__dirname, '../../scripts/db-migrate.js');
    const result = spawnSync(process.execPath, [script], {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        RAILWAY_ENVIRONMENT_NAME: 'test',
        DATABASE_URL: '',
      },
    });

    expect(result.status).toBe(0);
    expect(`${result.stdout || ''}${result.stderr || ''}`).toContain(
      'DATABASE_URL not set — skipping outside production'
    );
  });
});