// Predictive intelligence — contracts (spec §20-22).
//
// The division of labour §20 mandates: dedicated deterministic pipelines
// produce numbers; the LLM explains them. An LLM is never asked to be the
// predictor, because a language model cannot calibrate, cannot be
// back-tested, and cannot tell you which feature moved the score.
//
// Everything here is therefore computable without any model being
// available, and every score carries the features that produced it.

import { z } from 'zod';

export const PredictionType = z.enum([
  'convoy_risk',
  'eta_risk',
  'sla_breach',
  'vehicle_reliability',
]);
export type PredictionType = z.infer<typeof PredictionType>;

/**
 * Whether a score's probability is trustworthy as a probability.
 *
 * §21 is explicit: "Do not expose probability values unless the model is
 * appropriately calibrated." A heuristic score is a useful ORDERING but
 * saying "68% chance" from it is a fabricated statistic, so the field is
 * carried and consumers must respect it.
 */
export const CalibrationStatus = z.enum([
  'calibrated', // validated against outcomes; a probability may be shown
  'uncalibrated', // ordering is meaningful, the number is not a probability
  'unknown',
]);
export type CalibrationStatus = z.infer<typeof CalibrationStatus>;

/**
 * One input to a score, with its contribution.
 *
 * `direction` and `contribution` are what make a risk score explainable
 * (§22): they answer "what pushed this up, and by how much", which is the
 * only thing that lets an operator disagree with the number.
 */
export interface RiskFactor {
  name: string;
  /** Raw observed value, for the operator to check against reality. */
  value: number | string | null;
  /** Points this factor added (positive) or removed (negative). */
  contribution: number;
  direction: 'increases' | 'decreases' | 'neutral';
  /** Age of the observation. §22 requires recency in explanations. */
  observed_seconds_ago: number | null;
  /** Plain-language reason, written by the rule, not by a model. */
  explanation: string;
}

/** Matches the §21 prediction contract. */
export interface Prediction {
  prediction_id: string;
  org_id: string;
  entity_type: 'vehicle' | 'convoy';
  entity_id: string;
  prediction_type: PredictionType;
  /** 0-100. An ordering, not a percentage — see calibration_status. */
  value: number;
  band: 'low' | 'medium' | 'high' | 'critical';
  /**
   * Only populated when calibration_status is 'calibrated'. Null is the
   * honest answer for a heuristic model, and §21 requires it.
   */
  probability: number | null;
  /** How far ahead this looks. */
  horizon_minutes: number;
  generated_at: Date;
  model_version: string;
  /** Every input, so the score is reproducible from what it recorded. */
  feature_snapshot: Record<string, number | string | null>;
  contributing_signals: RiskFactor[];
  calibration_status: CalibrationStatus;
  /**
   * Freshness of the newest input (§48). A score built only from stale
   * telemetry is not a statement about the present.
   */
  data_age_seconds: number | null;
  warnings: string[];
}
