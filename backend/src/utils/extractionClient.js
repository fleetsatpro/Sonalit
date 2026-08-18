// 4-tier document extraction for booking data.
// T1: pdf-parse (PDFs) or Groq Llama Vision (images) — open-source Llama models, free
// T2: Tesseract.js local OCR → Groq text model
// T3: Mistral Pixtral (if MISTRAL_API_KEY is set)
// T4: Anthropic Claude Haiku — last resort only
const OpenAI = require('openai');
const logger = require('./logger');
const { hasAnthropic, hasGroqFallback, getAnthropicClient } = require('./aiClient');

// Vision model on Groq — try several known IDs in order.
// Override with GROQ_VISION_MODEL to pin a specific one.
const GROQ_VISION_CANDIDATES = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-vision-preview',
];
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL;

const PROMPT = `Extract ALL shipping/booking details from this document. Return ONLY a JSON object with these exact keys (null for missing):
{
  "booking_number": string|null,
  "carrier_reference": string|null,
  "customer_name": string|null,
  "reference": string|null,
  "pickup_location": string|null,
  "delivery_location": string|null,
  "commodity": string|null,
  "shipping_line": string|null,
  "vessel": string|null,
  "voyage": string|null,
  "eta": "ISO 8601 date string"|null,
  "notes": string|null,
  "containers": [
    {
      "container_number": string|null,
      "packing_list_no": string|null,
      "iso_type": "20GP|40GP|40HC|45HC etc"|null,
      "seal_number": string|null,
      "seal_number_2": string|null,
      "weight_kg": number|null
    }
  ]
}
IMPORTANT extraction rules:
- "booking_number": the booking's OWN reference, labelled "Booking Reference" or "Booking No"
  (e.g. TZ_26_08_OB_00123910). This is the primary identifier — capture it exactly as printed,
  keeping underscores and case. Do NOT confuse it with the carrier reference below.
- "carrier_reference": a SEPARATE reference labelled "Carrier Booking Reference" or "Carrier Ref"
  (e.g. 274570179) — the shipping line's own booking number, distinct from booking_number.
- "customer_name": the shipper, consignee, or customer company name
- "vessel": the vessel and voyage (e.g. "MAERSK PHUKET -635N")
- "containers" array MUST include ALL container rows in the document — there may be many
- "container_number": the box number, often in a column labelled "Conveyance No" or "Container No",
  ISO 6346 format (4 letters + 7 digits, e.g. UETU2951320)
- "packing_list_no": a per-row reference in a "Packing List No" column (e.g. TZ_DAR_01-PL-305984)
- A container often carries TWO seals in columns "Seal1"/"Seal2" (a line seal and a shipper/customs
  seal). Put the first in "seal_number" and the second in "seal_number_2"; leave seal_number_2 null
  if there is only one.
- "iso_type": the container size/type code (20GP, 40GP, 40HC, 45HC, 20RF, 40RF, 20OT, 40OT)
- "weight_kg": gross weight or VGM weight in kilograms
- "pickup_location" and "delivery_location": port/depot/yard names, include city
- If no containers are listed, use an empty array
- JSON only, no markdown fences or explanation.`;

function parseJson(text) {
  const match = (text || '').trim().match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function makeGroqClient() {
  return new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
}

async function groqText(text) {
  const res = await makeGroqClient().chat.completions.create({
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    max_completion_tokens: 4096,
    messages: [{ role: 'user', content: `${PROMPT}\n\nDocument text:\n${text}` }],
  });
  const result = parseJson(res.choices?.[0]?.message?.content || '');
  if (!result) throw new Error('json parse failed');
  return result;
}

// T1: pdf-parse for PDFs (embedded text → Groq text model)
//     Groq Vision for images — tries multiple model candidates
async function tier1(base64, mediaType) {
  if (!hasGroqFallback()) throw new Error('groq not configured');
  if (mediaType === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const { text } = await pdfParse(Buffer.from(base64, 'base64'));
    if (!text || text.trim().length < 20) throw new Error('pdf text too short');
    return groqText(text);
  }
  const models = GROQ_VISION_MODEL ? [GROQ_VISION_MODEL] : GROQ_VISION_CANDIDATES;
  let lastErr;
  for (const model of models) {
    try {
      const res = await makeGroqClient().chat.completions.create({
        model,
        max_completion_tokens: 4096,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
          { type: 'text', text: PROMPT },
        ]}],
      });
      const result = parseJson(res.choices?.[0]?.message?.content || '');
      if (!result) throw new Error('json parse failed');
      logger.info(`extraction: groq vision model ${model} worked`);
      return result;
    } catch (err) {
      lastErr = err;
      const isModelErr = err.status === 404 || /model.*not.*found|not.*available/i.test(err.message);
      if (!isModelErr) throw err;
      logger.warn(`extraction: groq vision model ${model} not available, trying next`);
    }
  }
  throw lastErr;
}

// T2: Tesseract.js local OCR → Groq text model
async function tier2(base64, mediaType) {
  const Tesseract = require('tesseract.js');
  const { data: { text } } = await Tesseract.recognize(
    Buffer.from(base64, 'base64'), 'eng', { logger: () => {} }
  );
  if (!text || text.trim().length < 20) throw new Error('ocr text too short');
  if (!hasGroqFallback()) throw new Error('groq not configured');
  return groqText(text);
}

// T3: Mistral Pixtral (open-weight vision model)
async function tier3(base64, mediaType) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key || key.length < 20) throw new Error('mistral not configured');
  const mistral = new OpenAI({ apiKey: key, baseURL: 'https://api.mistral.ai/v1' });
  const res = await mistral.chat.completions.create({
    model: 'pixtral-12b-2409',
    max_tokens: 4096,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
      { type: 'text', text: PROMPT },
    ]}],
  });
  const result = parseJson(res.choices?.[0]?.message?.content || '');
  if (!result) throw new Error('json parse failed');
  return result;
}

// T4: Anthropic — last resort
async function tier4(base64, mediaType) {
  if (!hasAnthropic()) throw new Error('anthropic not configured');
  const isPdf = mediaType === 'application/pdf';
  const sourceBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } };
  const response = await getAnthropicClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: [sourceBlock, { type: 'text', text: PROMPT }] }],
  });
  const result = parseJson(response.content[0]?.text || '');
  if (!result) throw new Error('json parse failed');
  return result;
}

const BOOKING_KEYS = [
  'customer_name', 'reference', 'pickup_location', 'delivery_location', 'commodity',
  'shipping_line', 'vessel', 'voyage', 'eta', 'notes',
];

async function extractBookingData(base64, mediaType) {
  const tiers = [
    ['pdf-parse+groq / groq-llama-vision', tier1],
    ['tesseract-ocr+groq', tier2],
    ['mistral-pixtral', tier3],
    ['anthropic-haiku', tier4],
  ];
  const failures = [];
  for (const [name, fn] of tiers) {
    try {
      const result = await fn(base64, mediaType);
      const containers = Array.isArray(result.containers) ? result.containers : [];
      const extractedCount = BOOKING_KEYS.filter(k => result[k] !== null && result[k] !== undefined).length;
      logger.info(`extraction: ${name} succeeded (${extractedCount}/${BOOKING_KEYS.length} booking fields, ${containers.length} containers)`);
      return {
        data: result,
        containers,
        partial: extractedCount < Math.ceil(BOOKING_KEYS.length / 2) && containers.length === 0,
        extracted_count: extractedCount,
        total_fields: BOOKING_KEYS.length,
      };
    } catch (err) {
      // err.status is set by the OpenAI/Anthropic SDKs; keep it, a 401 vs 404 vs
      // 429 is the difference between a bad key, a retired model, and a rate limit.
      // First line only — MODULE_NOT_FOUND appends a whole require stack.
      const firstLine = String(err.message || 'unknown error').split('\n')[0].trim();
      const reason = err.status ? `${err.status} ${firstLine}` : firstLine;
      logger.warn(`extraction: ${name} failed — ${reason}`);
      failures.push({ tier: name, reason });
    }
  }

  // Every tier is gated on a provider key, so "not configured" everywhere means
  // this is an ops problem, not an unreadable document. Say which it is —
  // otherwise both look identical to whoever is staring at the upload dialog.
  const unconfigured = failures.filter(f => /not configured/.test(f.reason));
  const err = new Error(
    unconfigured.length === failures.length
      ? `No extraction provider is configured (${failures.map(f => f.tier).join(', ')}). Set GROQ_API_KEY, MISTRAL_API_KEY or ANTHROPIC_API_KEY.`
      : `All extraction tiers failed — ${failures.map(f => `${f.tier}: ${f.reason}`).join(' | ')}`
  );
  err.failures = failures;
  err.allUnconfigured = unconfigured.length === failures.length;
  throw err;
}

module.exports = { extractBookingData };
