process.env.NODE_ENV = 'test';
delete process.env.SONALIT_STANDBY;

const { shouldTakeOver, classifyFenceStart, classifyFenceHeartbeat, shouldRefuseRetiredDeployment } = require('../../src/utils/runtimeFenceBootstrap');

describe('runtime fence deployment handover policy', () => {
  test('treats a successful heartbeat update as retained ownership', () => {
    expect(classifyFenceHeartbeat(1)).toBe('owned');
  });

  test('treats a zero-row heartbeat update as an expected handover, not a failed heartbeat', () => {
    expect(classifyFenceHeartbeat(0)).toBe('superseded');
  });

  test('refuses a retired deployment while the current lease is live', () => {
    expect(shouldRefuseRetiredDeployment({ candidateIsRetired: true, takeoverRequested: false, currentLeaseStale: false })).toBe(true);
    expect(shouldRefuseRetiredDeployment({ candidateIsRetired: false, takeoverRequested: false, currentLeaseStale: false })).toBe(false);
  });

  test('allows automatic recovery of a retired deployment only after the current lease is stale', () => {
    expect(shouldRefuseRetiredDeployment({ candidateIsRetired: true, takeoverRequested: false, currentLeaseStale: true })).toBe(false);
  });

  test('permits explicit retired-deployment recovery when takeover is requested', () => {
    expect(shouldRefuseRetiredDeployment({ candidateIsRetired: true, takeoverRequested: true, currentLeaseStale: false })).toBe(false);
  });

  test('allows a new Railway deployment to replace an older deployment', () => {
    expect(shouldTakeOver({
      takeoverRequested: false,
      incomingDeploymentId: 'new-deployment',
      currentDeploymentId: 'old-deployment',
    })).toBe(true);
  });

  test('does not allow a replica from the same Railway deployment to steal the lease', () => {
    expect(shouldTakeOver({
      takeoverRequested: false,
      incomingDeploymentId: 'same-deployment',
      currentDeploymentId: 'same-deployment',
    })).toBe(false);
  });


  test('does not auto-takeover a legacy lease with no deployment identity', () => {
    expect(shouldTakeOver({
      takeoverRequested: false,
      incomingDeploymentId: 'new-deployment',
      currentDeploymentId: null,
    })).toBe(false);
    expect(classifyFenceStart({
      production: true,
      standby: false,
      takeoverRequested: false,
      incomingDeploymentId: 'new-deployment',
      currentOwner: 'old-owner',
      currentDeploymentId: null,
      stale: false,
    })).toBe('refuse');
  });

  test('does not enable automatic takeover outside Railway', () => {
    expect(shouldTakeOver({
      takeoverRequested: false,
      incomingDeploymentId: null,
      currentDeploymentId: 'existing-owner',
    })).toBe(false);
  });

  test('classifies a newer Railway deployment as an active controlled replacement', () => {
    expect(classifyFenceStart({
      production: true,
      standby: false,
      takeoverRequested: false,
      incomingDeploymentId: 'new-deployment',
      currentOwner: 'old-owner',
      currentDeploymentId: 'old-deployment',
      stale: false,
    })).toBe('active');
  });

  test('refuses a second replica from the same deployment', () => {
    expect(classifyFenceStart({
      production: true,
      standby: false,
      takeoverRequested: false,
      incomingDeploymentId: 'same-deployment',
      currentOwner: 'old-owner',
      currentDeploymentId: 'same-deployment',
      stale: false,
    })).toBe('refuse');
  });

  test('takes over when the existing lease is stale', () => {
    expect(classifyFenceStart({
      production: true,
      standby: false,
      takeoverRequested: false,
      incomingDeploymentId: 'new-deployment',
      currentOwner: 'old-owner',
      currentDeploymentId: 'old-deployment',
      stale: true,
    })).toBe('active');
  });

  test('standby never claims the active fence', () => {
    expect(classifyFenceStart({
      production: true,
      standby: true,
      takeoverRequested: false,
      incomingDeploymentId: 'standby-deployment',
      currentOwner: 'active-owner',
      currentDeploymentId: 'active-deployment',
      stale: false,
    })).toBe('bypass');
  });

  test('preserves explicit manual takeover', () => {
    expect(shouldTakeOver({
      takeoverRequested: true,
      incomingDeploymentId: null,
      currentDeploymentId: 'existing-owner',
    })).toBe(true);
  });
});