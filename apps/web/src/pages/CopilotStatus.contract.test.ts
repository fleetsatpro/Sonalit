import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const copilot = read('./Copilot.tsx');

describe('Copilot operational-state honesty contract', () => {
  it('does not show evidence as live before evidence metadata is actually returned', () => {
    expect(copilot).toContain("telemetry.evidence ?? 'NOT REPORTED'");
    expect(copilot).not.toContain("telemetry.evidence ?? 'LIVE'");
    expect(copilot).not.toContain('LIVE EVIDENCE CHANNEL');
  });

  it('does not report the response channel online before a request completes', () => {
    expect(copilot).toContain("('NOT_CHECKED')");
    expect(copilot).toContain('COPILOT RESPONSE STATUS');
    expect(copilot).not.toContain('● ONLINE');
    expect(copilot).toContain('responseStatus.replaceAll');
  });

  it('distinguishes a returned result from degraded, failed, and completed workflows', () => {
    expect(copilot).toContain("setResponseStatus('RESPONDED')");
    expect(copilot).toContain("setResponseStatus('DEGRADED')");
    expect(copilot).toContain("setResponseStatus('FAILED')");
    expect(copilot).toContain("setResponseStatus(d.task.completed === true ? 'COMPLETED' : 'FAILED')");
  });

  it('does not imply a safety check is armed when no assurance metadata exists', () => {
    expect(copilot).toContain("telemetry.safety ?? 'NOT ASSESSED'");
    expect(copilot).not.toContain("telemetry.safety ?? 'ARMED'");
  });

  it('does not imply nominal risk or a ready swarm before a decision response exists', () => {
    expect(copilot).toContain("telemetry.risk || 'UNASSESSED'");
    expect(copilot).toContain("telemetry.agent_count ?? 'NOT CHECKED'");
    expect(copilot).not.toContain("telemetry.risk || 'NOMINAL'");
    expect(copilot).not.toContain("telemetry.agent_count ?? 'READY'");
  });
});
