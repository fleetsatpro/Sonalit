process.env.NODE_ENV = 'test';
delete process.env.SONALIT_STANDBY;

const { shouldTakeOver, classifyFenceStart } = require('../../src/utils/runtimeFenceBootstrap');

describe('runtime fence deployment handover policy', () => {
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