// Convoy risk tool (spec §10, §20-22).
//
// Exposes the deterministic risk engine to the AI plane. The division of
// labour matters: this tool RETURNS a score with its contributing factors,
// and the model's job is to explain that score in operational language —
// never to produce or adjust the number itself (§20).

import { z } from 'zod';

import { scoreConvoyRisk } from '../../risk/convoy-risk.js';
import { Signal, type Signal as SignalType } from '../../watchtower/types.js';
import { registerTool } from '../registry.js';

interface SignalRow {
  signal_id: string;
  org_id: string;
  type: string;
  severity: string;
  entity_type: string;
  entity_id: string;
  convoy_id: string | null;
  observed_at: Date;
  ingested_at: Date;
  payload: Record<string, unknown>;
  source: string;
}

registerTool({
  name: 'assess_convoy_risk',
  description:
    'Compute the current operational risk score for a convoy from its recent signals, ' +
    'schedule position and route exposure. Returns the score with the factors that ' +
    'produced it. Use this instead of estimating risk yourself: the score is ' +
    'deterministic and reproducible, and your role is to explain it.',
  action_level: 'read',
  required_role: 'analyst',
  source: 'computed',
  input_schema: z.object({
    convoy_id: z.string().min(1).max(100).describe('The convoy to assess'),
    lookback_minutes: z
      .number()
      .optional()
      .describe('How far back to gather signals (default 120, max 1440)'),
  }),
  // The score already knows how old its newest input was; surfacing it
  // lets Commander qualify the answer rather than implying it is current.
  freshness: (data) => (data as { data_age_seconds: number | null }).data_age_seconds,
  warnings: (data) => (data as { warnings: string[] }).warnings,
  handler: async (args, ctx, client) => {
    const lookback = Math.min(Math.max(args.lookback_minutes ?? 120, 1), 1440);

    const signals = await client.query<SignalRow>(
      `SELECT signal_id, org_id, type, severity, entity_type, entity_id, convoy_id,
              observed_at, ingested_at, payload, source
         FROM ai_signals
        WHERE convoy_id = $1
          AND observed_at > NOW() - ($2 || ' minutes')::INTERVAL
        ORDER BY observed_at DESC
        LIMIT 500`,
      [args.convoy_id, String(lookback)],
    );

    // Rows are re-validated rather than cast: a signal type this build does
    // not know about would otherwise be scored with an undefined weight.
    const parsed: SignalType[] = [];
    for (const row of signals.rows) {
      const result = Signal.safeParse(row);
      if (result.success) parsed.push(result.data);
    }

    // Schedule context is a BONUS input, not a precondition. If the convoys
    // table is unreachable the signal-based score is still valid and still
    // worth returning — failing the whole assessment would leave an
    // operator with nothing during exactly the kind of partial outage this
    // score exists to help with (Rule 3). The gap is reported, not hidden.
    let row:
      | { estimated_arrival: Date | null; arrival_time: Date | null; status: string }
      | undefined;
    let convoyLookupError: string | null = null;
    try {
      const convoy = await client.query<{
        estimated_arrival: Date | null;
        arrival_time: Date | null;
        status: string;
      }>(
        `SELECT estimated_arrival, arrival_time, status
           FROM convoys WHERE id = $1 AND deleted_at IS NULL`,
        [args.convoy_id],
      );
      row = convoy.rows[0];
    } catch (err) {
      convoyLookupError = err instanceof Error ? err.message : String(err);
    }

    // Delay is only meaningful for a convoy still under way and with a
    // planned arrival. Absent either, it stays null and the score records
    // that schedule risk is unrepresented, rather than assuming on-time.
    let etaDelayMinutes: number | null = null;
    if (row?.estimated_arrival && row.arrival_time === null && row.status === 'active') {
      const delta = (Date.now() - row.estimated_arrival.getTime()) / 60_000;
      etaDelayMinutes = delta > 0 ? Math.round(delta) : 0;
    }

    const prediction = scoreConvoyRisk({
      org_id: ctx.org_id,
      convoy_id: args.convoy_id,
      signals: parsed,
      eta_delay_minutes: etaDelayMinutes,
    });

    if (convoyLookupError !== null) {
      prediction.warnings.push(
        `Convoy record could not be read (${convoyLookupError}), so schedule context is ` +
          'missing. This score reflects observed signals only.',
      );
    } else if (!row) {
      prediction.warnings.push(
        `Convoy '${args.convoy_id}' was not found, so schedule and route context are ` +
          'missing from this assessment.',
      );
    }

    return {
      score: prediction.value,
      band: prediction.band,
      // Null while the model is uncalibrated. Do not present the score as a
      // percentage or a likelihood (§21).
      probability: prediction.probability,
      calibration_status: prediction.calibration_status,
      model_version: prediction.model_version,
      horizon_minutes: prediction.horizon_minutes,
      data_age_seconds: prediction.data_age_seconds,
      contributing_factors: prediction.contributing_signals,
      feature_snapshot: prediction.feature_snapshot,
      warnings: prediction.warnings,
    };
  },
});
