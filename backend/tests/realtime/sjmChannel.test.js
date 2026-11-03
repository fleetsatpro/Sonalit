'use strict';

const { sjmChannelName } = require('../../src/realtime/sjmChannel');

describe('SJM realtime channel generations', () => {
  test('preserves the legacy channel name for epoch zero', () => {
    expect(sjmChannelName('org-a', 'channel-1', 0)).toBe('org#org-a#comms#channel-1');
  });

  test('uses a distinct channel name for each positive epoch', () => {
    expect(sjmChannelName('org-a', 'channel-1', 7)).toBe('org#org-a#comms#channel-1#v7');
    expect(sjmChannelName('org-a', 'channel-1', 8)).not.toBe(sjmChannelName('org-a', 'channel-1', 7));
  });
});
