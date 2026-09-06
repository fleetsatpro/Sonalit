const { listCustomerPulseTargets, generateAndQueueScopedClientPulse } = require('./scopedClientPulse.service');

/**
 * Canonical Client Pulse dispatcher. All scheduled/manual callers should use
 * this service so the scoped recipient + workbook + queue pipeline stays in
 * one place.
 */
async function dispatchClientPulse(orgId, { snapshotAt = new Date(), reason = 'scheduled' } = {}) {
  if (!orgId) throw new Error('orgId is required for Client Pulse dispatch');
  const snapshot = snapshotAt instanceof Date ? snapshotAt : new Date(snapshotAt);
  if (Number.isNaN(snapshot.getTime())) throw new Error('Invalid Client Pulse snapshot time');

  const customerIds = await listCustomerPulseTargets(orgId);
  const results = [];
  for (const customerId of customerIds) {
    try {
      results.push(await generateAndQueueScopedClientPulse(orgId, customerId, {
        snapshotAt: snapshot,
        reason,
      }));
    } catch (error) {
      results.push({
        customerId,
        skipped: true,
        reason: 'delivery_failed',
        error: String(error.message || error),
      });
    }
  }

  return {
    snapshotAt: snapshot.toISOString(),
    customers: results,
    queued: results.filter(r => r.queued).length,
    skipped: results.filter(r => r.skipped).length,
    failed: results.filter(r => r.reason === 'delivery_failed').length,
    customerCount: customerIds.length,
  };
}

module.exports = { dispatchClientPulse };
