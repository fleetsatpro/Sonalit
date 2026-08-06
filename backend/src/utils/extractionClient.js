// 4-tier document extraction for booking data.
// T1: pdf-parse (PDFs) or Groq Llama Vision (images) — open-source Llama models, free
// T2: Tesseract.js local OCR → Groq text model
// T3: Mistral Pixtral (if MISTRAL_API_KEY is set)
// T4: Anthropic Claude Haiku — last resort only
const OpenAI = require('openai');
const logger = require('./logger');
const { hasAnthropic, hasGroqFallback, getAnthropicClient } = require('./aiClient');

const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'llama-3.2-90b-vision-preview';

const PROMPT = 'Extract shipping/booking details from this document. Return ONLY a JSON object with these exact keys (null for missing): reference, pickup_location, delivery_location, commodity, weight_kg (number), container_type (e.g. "20GP"), container_size (number), shipping_line, vessel, voyage, seal_number, eta (ISO 8601 date string), notes. JSON only, no markdown or explanation.';

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
    max_completion_tokens: 1024,
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
    max_completion_tokens: 1024,
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
    max_tokens: 1024,
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
    max_tokens: 1024,
    messages: [{ role: 'user', content: [sourceBlock, { type: 'text', text: PROMPT }] }],
  });
  const result = parseJson(response.content[0]?.text || '');
  if (!result) throw new Error('json parse failed');
  return result;
}

const EXPECTED_KEYS = [
  'reference', 'pickup_location', 'delivery_location', 'commodity',
  'weight_kg', 'container_type', 'container_size', 'shipping_line',
  'vessel', 'voyage', 'seal_number', 'eta', 'notes',
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
      const extractedCount = EXPECTED_KEYS.filter(k => result[k] !== null && result[k] !== undefined).length;
      logger.info(`extraction: ${name} succeeded (${extractedCount}/${EXPECTED_KEYS.length} fields)`);
      return {
        data: result,
        partial: extractedCount < Math.ceil(EXPECTED_KEYS.length / 2),
        extracted_count: extractedCount,
        total_fields: EXPECTED_KEYS.length,
      };
    } catch (err) {
      logger.warn(`extraction: ${name} failed — ${err.message}`);
    }
  }
  throw new Error('all extraction tiers exhausted');
}

module.exports = { extractBookingData };
