'use strict';

describe('GDELT collection provider health', () => {
  let fetchGdelt;
  let fetchMock;
  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
    ({ fetchGdelt } = require('../src/utils/collectionFabric'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  test('an upstream 429 fails the collection run instead of being recorded as a successful empty run', async () => {
    fetchMock.mockResolvedValue({ status: 429, ok: false });
    await expect(fetchGdelt('security events')).rejects.toThrow('GDELT rate limited; circuit opened');
    await expect(fetchGdelt('security events')).rejects.toThrow('GDELT cooldown active after a previous provider failure');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test('an upstream HTTP error propagates to the collection-run failure handler', async () => {
    fetchMock.mockResolvedValue({ status: 503, ok: false });
    await expect(fetchGdelt('security events')).rejects.toThrow('GDELT HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
