'use strict';

// SJM roster changes advance the epoch. Tokens for an older channel name may
// remain cryptographically valid until expiry, but that channel receives no
// later mission publications and Centrifugo history is disabled by default.
function sjmChannelName(orgId, channelId, epoch = 0) {
  const value = Number(epoch);
  const suffix = Number.isSafeInteger(value) && value > 0 ? '#v' + value : '';
  return 'org#' + String(orgId) + '#comms#' + String(channelId) + suffix;
}

module.exports = { sjmChannelName };
