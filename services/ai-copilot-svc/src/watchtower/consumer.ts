// Watchtower NATS consumer (spec §28, §29).
//
// This is what makes Watchtower live rather than a library: it subscribes
// to the platform's existing event subjects, normalises what arrives,
// correlates over a rolling window and persists both the raw signals and
// the findings built from them.
//
// Design points that matter operationally:
//
//  * Correlation needs a WINDOW, but events arrive one at a time. Signals
//    are therefore buffered per tenant and correlated on a timer, not on
//    each message — otherwise the first event of a situation would always
//    correlate against nothing and fire alone.
//  * A message is ACKed once its signal is durably stored, not once it is
//    correlated. Redelivering an already-stored signal would double-count
//    evidence; losing one because correlation failed would lose it entirely.
//  * Watchtower is strictly additive. If NATS is unreachable the service
//    still serves Commander and RAG (Rule 3), so connection failure is
//    logged and retried, never fatal.

import type { JetStreamClient, JsMsg } from 'nats';
import { AckPolicy, DeliverPolicy } from 'nats';
import { withOrgContext } from '../db.js';
import { correlate, type CorrelationRule } from './correlate.js';
import { normalise, UnnormalisableEventError } from './normalize.js';
import type { Correlation, Signal } from './types.js';

export const WATCHTOWER_STREAM = 'WATCHTOWER';
export const WATCHTOWER_SUBJECTS = ['events.panic.>', 'events.alert.>', 'events.geofence.breach.>'];

/**
 * Only what the consumer actually calls. Structural rather than pino's
 * `Logger`, so a Fastify request logger — which is what index.ts has —
 * satisfies it without a cast.
 */
export interface ConsumerLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface ConsumerOptions {
  js: JetStreamClient;
  logger: ConsumerLogger;
  /** How often buffered signals are correlated. */
  flushIntervalMs?: number;
  /**
   * How far back a flush looks. Must exceed the widest correlation rule
   * window, or a slow-developing situation would never assemble.
   */
  windowMs?: number;
  rules?: CorrelationRule[];
}

/** Buffered signals awaiting correlation, keyed by tenant. */
type Buffer = Map<string, Signal[]>;

export class WatchtowerConsumer {
  private readonly buffer: Buffer = new Map();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly options: ConsumerOptions) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const { js, logger } = this.options;

    // Explicit ack: a signal must be stored before its message is
    // acknowledged, so a crash mid-write redelivers rather than drops.
    const consumer = await js.consumers.get(WATCHTOWER_STREAM, {
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      durable_name: 'watchtower',
    } as never);

    const messages = await consumer.consume();

    void (async (): Promise<void> => {
      for await (const msg of messages) {
        await this.handle(msg);
        if (!this.running) break;
      }
    })().catch((err: unknown) => {
      logger.error({ err }, 'Watchtower consumer loop ended unexpectedly');
    });

    const interval = this.options.flushIntervalMs ?? 30_000;
    this.timer = setInterval(() => {
      void this.flush().catch((err: unknown) => {
        logger.error({ err }, 'Watchtower correlation flush failed');
      });
    }, interval);
    // Do not hold the process open purely for the flush timer.
    this.timer.unref();

    logger.info({ subjects: WATCHTOWER_SUBJECTS }, 'Watchtower consumer started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Correlate whatever is buffered rather than discarding it on shutdown.
    await this.flush();
  }

  private async handle(msg: JsMsg): Promise<void> {
    const { logger } = this.options;
    let signal: Signal;

    try {
      signal = normalise({
        subject: msg.subject,
        payload: msg.json<Record<string, unknown>>(),
        received_at: new Date(),
      });
    } catch (err) {
      if (err instanceof UnnormalisableEventError) {
        // A malformed or unmapped event is not retryable — redelivering it
        // forever would block the consumer. It is acked and recorded so the
        // gap is visible rather than silent.
        logger.warn({ subject: msg.subject, reason: err.message }, 'Watchtower dropped event');
        msg.ack();
        return;
      }
      // An unexpected error might be transient, so leave it for redelivery.
      logger.error({ err, subject: msg.subject }, 'Watchtower normalisation error');
      msg.nak();
      return;
    }

    try {
      await this.persistSignal(signal);
      // Acked only once durably stored.
      msg.ack();
    } catch (err) {
      logger.error({ err, subject: msg.subject }, 'Watchtower failed to persist signal');
      msg.nak();
      return;
    }

    const bucket = this.buffer.get(signal.org_id);
    if (bucket) bucket.push(signal);
    else this.buffer.set(signal.org_id, [signal]);
  }

  private async persistSignal(signal: Signal): Promise<void> {
    await withOrgContext(signal.org_id, async (client) => {
      await client.query(
        `INSERT INTO ai_signals (
           signal_id, org_id, type, severity, entity_type, entity_id,
           convoy_id, observed_at, ingested_at, payload, source
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (signal_id) DO NOTHING`,
        [
          signal.signal_id,
          signal.org_id,
          signal.type,
          signal.severity,
          signal.entity_type,
          signal.entity_id,
          signal.convoy_id,
          signal.observed_at,
          signal.ingested_at,
          JSON.stringify(signal.payload),
          signal.source,
        ],
      );
    });
  }

  /**
   * Correlates buffered signals and persists the findings.
   *
   * Signals older than the window are dropped from the buffer, not deleted:
   * the rows remain in `ai_signals` as evidence and remain queryable. Only
   * their candidacy for NEW correlations expires.
   */
  async flush(): Promise<Correlation[]> {
    const windowMs = this.options.windowMs ?? 45 * 60_000;
    const cutoff = Date.now() - windowMs;
    const produced: Correlation[] = [];

    for (const [orgId, signals] of this.buffer) {
      const fresh = signals.filter((s) => s.observed_at.getTime() >= cutoff);
      if (fresh.length === 0) {
        this.buffer.delete(orgId);
        continue;
      }

      const { correlations, uncorrelated } = correlate(fresh, {
        ...(this.options.rules ? { rules: this.options.rules } : {}),
      });

      for (const correlation of correlations) {
        try {
          await this.persistCorrelation(correlation);
          produced.push(correlation);
        } catch (err) {
          this.options.logger.error(
            { err, rule: correlation.rule_id },
            'Watchtower failed to persist correlation',
          );
        }
      }

      // Signals that correlated are done. Those that did not stay in the
      // buffer while still inside the window, so a situation that develops
      // over several minutes can still assemble on a later flush.
      this.buffer.set(orgId, uncorrelated);
    }

    return produced;
  }

  private async persistCorrelation(correlation: Correlation): Promise<void> {
    await withOrgContext(correlation.org_id, async (client) => {
      await client.query(
        `INSERT INTO ai_correlations (
           correlation_id, org_id, entity_type, entity_id, convoy_id,
           finding, severity, state, rule_id, window_start, window_end
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (correlation_id) DO NOTHING`,
        [
          correlation.correlation_id,
          correlation.org_id,
          correlation.entity_type,
          correlation.entity_id,
          correlation.convoy_id,
          correlation.finding,
          correlation.severity,
          correlation.state,
          correlation.rule_id,
          correlation.window_start,
          correlation.window_end,
        ],
      );

      // The evidence link. Written in the same transaction as the finding so
      // a correlation can never exist without the signals that justify it.
      for (const signal of correlation.signals) {
        await client.query(
          `INSERT INTO ai_correlation_signals (correlation_id, signal_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [correlation.correlation_id, signal.signal_id],
        );
      }
    });
  }
}
