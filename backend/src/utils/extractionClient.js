// 4-tier document extraction for booking data.
// T1: pdf-parse (PDFs) or Groq Llama Vision (images) — open-source Llama models, free
// T2: Tesseract.js local OCR → Groq text model
// T3: Mistral Pixtral (if MISTRAL_API_KEY is set)
// T4: Anthropic Claude Haiku — last resort only
const OpenAI = require('openai');
const logger = require('./logger');
const { hasAnthropic, hasGroqFallback, getAnthropicClient } = require('./aiClient');

const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'llama-3.2-90b-vision-preview';

const PROMPT = `Extract shipping/booking details from this document. Return ONLY a JSON object with these exact keys (null for missing):
{
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
      "iso_type": "20GP|40GP|40HC|45HC etc"|null,
      "seal_number": string|null,
      "weight_kg": number|null
    }
  ]
}
The "containers" array must include ALL containers listed in the document (there may be many). If no containers are listed, use an empty array. JSON only, no markdown or explanation.`;

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
//     Groq Vision for images (Llama 3.2 — open-source, free)
async function tier1(base64, mediaType) {
  if (!hasGroqFallback()) throw new Error('groq not configured');
  if (mediaType === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const { text } = await pdfParse(Buffer.from(base64, 'base64'));
    if (!text || text.trim().length < 20) throw new Error('pdf text too short');
    return groqText(text);
  }
  const res = await makeGroqClient().chat.completions.create({
    model: GROQ_VISION_MODEL,
    max_completion_tokens: 4096,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
      { type: 'text', text: PROMPT },
    ]}],
  });
  const result = parseJson(res.choices?.[0]?.message?.content || '');
  if (!result) throw new Error('json parse failed');
  return result;
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
  'reference', 'pickup_location', 'delivery_location', 'commodity',
  'shipping_line', 'vessel', 'voyage', 'eta', 'notes',
];

async function extractBookingData(base64, mediaType) {
  const tiers = [
    ['pdf-parse+groq / groq-llama-vision', tier1],
    ['tesseract-ocr+groq', tier2],
    ['mistral-pixtral', tier3],
    ['anthropic-haiku', tier4],
  ];
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
      logger.warn(`extraction: ${name} failed — ${err.message}`);
    }
  }
  throw new Error('all extraction tiers exhausted');
}

module.exports = { extractBookingData };
