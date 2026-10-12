import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./AIDecision.tsx', import.meta.url), 'utf8');
const parser = readFileSync(new URL('../../../../backend/src/utils/geofenceCommandIntent.js', import.meta.url), 'utf8');

describe('AIDecision operational dispatch contract', () => {
  it('does not send operational requests straight to the read/analysis endpoint', () => {
    expect(page).toContain("api.post<DispatchResponse>('/ai/dispatch'");
    expect(page).toContain('request_id: crypto.randomUUID()');
    expect(page).not.toContain("api.post<DispatchResponse>('/ai/decision'");
  });

  it('shows verified operation results and durable receipts rather than analysis-only metrics', () => {
    expect(page).toContain('Operational action completed');
    expect(page).toContain('Geometry provenance');
    expect(page).toContain('Source boundary vertices');
    expect(page).toContain('Simplification error budget');
    expect(page).toContain('Simplification method');
    expect(page).toContain('Durable action receipt');
    expect(page).toContain('response?.data?.message');
    expect(page).toContain('No operation is reported as completed');
    expect(page).toContain('Confirm and execute');
    expect(page).toContain("'/ai/dispatch/confirm'");
    expect(page).toContain("'/ai/dispatch/pending'");
  });

  it('supports the exact natural-language boundary request from the Copilot UI', () => {
    expect(parser).toContain('const possessiveBoundary');
    expect(parser).toContain('const boundaryOfPlace');
    expect(parser).toContain('const namedBoundary');
    expect(parser).toContain("shape: 'boundary'");
  });
});
