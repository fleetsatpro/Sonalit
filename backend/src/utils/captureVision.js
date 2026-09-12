// AI auto-tagging for covert captures. Runs a Guardian photo through Claude
// vision and returns a structured read of the scene — people, weapons, vehicles,
// licence plates, a one-line summary, and a threat level — which the Surveillance
// console then makes searchable and alerts on.
//
// Vision + a strict JSON schema require the Anthropic path specifically (the
// open-weight Groq fallback in aiClient is text-only and can't see the image),
// so every call sets allowFallback:false. If ANTHROPIC_API_KEY isn't configured,
// analysis is skipped and the capture stays untagged — the UI says so rather than
// silently showing nothing.
const aiClient = require('./aiClient');
const logger = require('./logger');
const { query } = require('../config/database');
const { publish } = require('../realtime/centrifugo');

// Structured-outputs models only (Opus 4.8 supports vision + json_schema; the
// codebase's 4.7 default does not guarantee structured outputs).
const VISION_MODEL = 'claude-opus-4-8';

const TAG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'One concise, factual sentence describing the scene.' },
    labels: { type: 'array', items: { type: 'string' }, description: 'Short lowercase scene/object tags, e.g. "roadblock", "crowd", "night".' },
    person_count: { type: 'integer', description: 'Number of people visible (0 if none).' },
    has_weapon: { type: 'boolean', description: 'True if any weapon (firearm, knife, machete, club) is visible.' },
    plates: { type: 'array', items: { type: 'string' }, description: 'Licence plate strings read from vehicles, uppercase, no spaces. Omit any that are unreadable.' },
    vehicles: { type: 'array', items: { type: 'string' }, description: 'Vehicle descriptions, e.g. "white toyota hilux".' },
    threat_level: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Overall threat level of the scene to a convoy.' },
  },
  required: ['summary', 'labels', 'person_count', 'has_weapon', 'plates', 'vehicles', 'threat_level'],
};

const PROMPT =
  'You are a surveillance analyst for a convoy-security operations centre. Analyse this covert photo ' +
  'taken from a field officer\'s device. Count people, flag any weapons, describe vehicles and read their ' +
  'licence plates exactly (omit any you cannot read with confidence), and summarise the scene in one sentence. ' +
  'Be precise and factual — this feeds a live security dashboard.';

function hasVision() {
  return aiClient.hasAnthropic();
}

// Keep only sane values so a hallucinated field can't poison the row/UI.
function normalize(raw) {
  const arr = (v) => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean).slice(0, 20) : [];
  const level = ['low', 'medium', 'high'].includes(raw?.threat_level) ? raw.threat_level : 'low';
  return {
    summary: typeof raw?.summary === 'string' ? raw.summary.trim().slice(0, 500) : null,
    labels: arr(raw?.labels).map(s => s.toLowerCase()),
    person_count: Number.isFinite(raw?.person_count) ? Math.max(0, Math.min(999, Math.trunc(raw.person_count))) : 0,
    has_weapon: raw?.has_weapon === true,
    plates: arr(raw?.plates).map(s => s.toUpperCase().replace(/\s+/g, '')),
    vehicles: arr(raw?.vehicles).map(s => s.toLowerCase()),
    threat_level: level,
  };
}

// Analyse one image URL. Returns the normalized tags, or null if vision is
// unconfigured or the model didn't return usable JSON.
async function analyzeCapture(url) {
  if (!hasVision() || !url) return null;
  const resp = await aiClient.createMessage({
    model: VISION_MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'url', url } },
        { type: 'text', text: PROMPT },
      ],
    }],
    output_config: { format: { type: 'json_schema', schema: TAG_SCHEMA } },
  }, { allowFallback: false });

  const textBlock = (resp.content || []).find(b => b.type === 'text');
  if (!textBlock?.text) return null;
  let parsed;
  try { parsed = JSON.parse(textBlock.text); } catch { return null; }
  return normalize(parsed);
}

// Analyse then persist onto the guardian_captures row (no RLS on that table —
// org scoping is explicit, same as everywhere else that touches it) and publish
// so the console refreshes. Fire-and-forget friendly: never throws.
async function analyzeCaptureAndStore(captureId, orgId, url) {
  try {
    const tags = await analyzeCapture(url);
    if (!tags) return null;
    await query(
      `UPDATE guardian_captures
          SET ai_summary = $2, ai_labels = $3, ai_person_count = $4, ai_has_weapon = $5,
              ai_plates = $6, ai_vehicles = $7, ai_threat_level = $8, ai_analyzed_at = NOW()
        WHERE id = $1`,
      [captureId, tags.summary, tags.labels, tags.person_count, tags.has_weapon,
        tags.plates, tags.vehicles, tags.threat_level]
    );
    if (orgId) {
      publish(`org#${orgId}`, {
        type: 'guardian_capture_analyzed',
        capture_id: captureId,
        ...tags,
      }).catch(() => {});
    }
    logger.info(`Capture analysed: id=${captureId} persons=${tags.person_count} weapon=${tags.has_weapon} plates=${tags.plates.length} threat=${tags.threat_level}`);
    return tags;
  } catch (e) {
    logger.warn(`analyzeCaptureAndStore failed: id=${captureId}: ${e.message}`);
    return null;
  }
}

module.exports = { hasVision, analyzeCapture, analyzeCaptureAndStore };
