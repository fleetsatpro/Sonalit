import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: mocks.connect,
    query: mocks.poolQuery,
    end: vi.fn(),
  })),
}));
vi.mock('../../src/config.js', () => ({
  config: { DATABASE_URL: 'postgresql://test:test@localhost/sonalit_test' },
}));

import { globalQuery, query, tenantContext, withOrgContext } from '../../src/db.js';

const orgA = '11111111-1111-4111-8111-111111111111';
const orgB = '22222222-2222-4222-8222-222222222222';

describe('telemetry database tenant context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientQuery.mockImplementation(async (sql: string) => ({
      rows: sql === 'SELECT value FROM protected_table' ? [{ value: 'scoped' }] : [],
      rowCount: 1,
    }));
    mocks.connect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.release,
    });
    mocks.poolQuery.mockResolvedValue({ rows: [{ id: 'global-candidate' }], rowCount: 1 });
  });

  it('fails closed when a tenant query has no tenant context', async () => {
    await expect(query('SELECT value FROM protected_table'))
      .rejects.toThrow('tenant_context_required_for_query');
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('sets the tenant role and org id before executing a scoped query', async () => {
    await expect(tenantContext.run(orgA, () => query<{ value: string }>('SELECT value FROM protected_table')))
      .resolves.toEqual([{ value: 'scoped' }]);

    expect(mocks.clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE sonalit_app',
      "SELECT set_config('app.current_org_id', $1, true)",
      'SELECT value FROM protected_table',
      'COMMIT',
    ]);
    expect(mocks.clientQuery.mock.calls[2]?.[1]).toEqual([orgA]);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('rejects nested tenant switches before acquiring a connection', async () => {
    await expect(tenantContext.run(orgA, () =>
      withOrgContext(orgB, async () => 'must not run')))
      .rejects.toThrow('tenant_context_switch_forbidden');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('allows an explicit global lookup only outside tenant context', async () => {
    await expect(globalQuery<{ id: string }>('SELECT id FROM device_lookup'))
      .resolves.toEqual([{ id: 'global-candidate' }]);
    expect(mocks.poolQuery).toHaveBeenCalledTimes(1);

    await expect(tenantContext.run(orgA, () =>
      globalQuery('SELECT id FROM device_lookup')))
      .rejects.toThrow('global_query_forbidden_inside_tenant_context');
    expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
  });
});
