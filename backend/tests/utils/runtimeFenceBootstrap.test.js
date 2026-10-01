process.env.NODE_ENV = 'test';
delete process.env.SONALIT_STANDBY;

const { shouldTakeOver } = require('../../src/utils/runtimeFenceBootstrap');

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

  test('preserves explicit manual takeover', () => {
    expect(shouldTakeOver({
      takeoverRequested: true,
      incomingDeploymentId: null,
      currentDeploymentId: 'existing-owner',
    })).toBe(true);
  });
});