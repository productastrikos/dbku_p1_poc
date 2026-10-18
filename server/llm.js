/* ═══════════════════════════════════════════════════════════════════════
   GuardGrid LLM routes (Claude API). Mounted at /api/llm by
   src/setupProxy.js (npm start) and server/index.js (production), so the
   API key stays on the server and never reaches the browser bundle.

     GET  /api/llm/status          { enabled, model, reason? }
     POST /api/llm/classify-photo  { image, mediaType, declaredMaterial }
     POST /api/llm/report          { context, images: [{ data, mediaType, caption }] }

   Credentials: ANTHROPIC_API_KEY (or an `ant auth login` profile).
   ANTHROPIC_MODEL overrides the model; GUARDGRID_LLM=off forces offline mode.
   ═══════════════════════════════════════════════════════════════════════ */
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { z } = require('zod');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
// Server-side refusal fallback: a declined request is re-run on Anthropic's
// recommended fallback model inside the same call.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

const PHOTO_LABELS = [
  'cable/electrical part',
  'copper scrap (pipe/fittings/household wire)',
  'aluminium',
  'iron/steel',
  'brass',
  'household appliance / e-waste',
  'mixed / other',
];

const PhotoSchema = z.object({
  label: z.enum(PHOTO_LABELS),
  confidence: z.number().describe('0 to 1'),
  description: z.string().describe('One sentence describing what is visible.'),
  infrastructureIndicators: z.array(z.string()).describe('Visible signs of public-utility origin, e.g. armoured sheath, cut ends, streetlight fittings. Empty if none.'),
});

const ReportSchema = z.object({
  title: z.string(),
  summary: z.string().describe('2–3 sentences for a busy investigating officer.'),
  what: z.string(),
  where: z.string(),
  when: z.string(),
  sequenceOfEvents: z.array(z.object({ time: z.string(), event: z.string() })),
  evidence: z.array(z.object({ ref: z.string(), description: z.string() })),
  linkedScrapSales: z.array(z.object({ transactionId: z.string(), relevance: z.string() })),
  lossBasis: z.string().describe('One sentence explaining how the provided RM estimate was built.'),
  requestedPoliceActions: z.array(z.string()),
  dbkuActions: z.array(z.string()),
  ringkasanBM: z.string().describe('The summary in Bahasa Malaysia.'),
});

const REPORT_SYSTEM = `You draft incident briefs that Dewan Bandaraya Kuching Utara (DBKU) hands to the Royal Malaysia Police (PDRM) about theft and vandalism of public electrical assets (streetlights, distribution boxes, cables, main switchboards) in Kuching, Sarawak.

Write for an investigating officer: plain, factual, British English, short sentences.
Use only facts in the case file. Do not invent names, vehicle plates, IC numbers, witness statements, section numbers of laws, or figures. If something is not in the file, write "Not recorded".
Times in the file are Malaysia Time (MYT, UTC+8); keep them in MYT.
For linked scrap sales, explain why each sale is relevant (timing, distance, material, screening flags) and say that a link is an investigative lead, not proof.
Requested police actions should be specific and lawful, for example checking a dealer's register under the Second-Hand Dealers Act 1946, requesting CCTV footage, or tracing a seller through the dealer's records.`;

const PHOTO_SYSTEM = `You classify photos of scrap that sellers bring to licensed scrap dealers in Kuching, Sarawak. DBKU uses the label to spot stolen public electrical infrastructure.
Use "cable/electrical part" only for power cable (armoured or thick insulated multi-core, cut lengths, cable drums), streetlight or switchgear parts, busbars, or similar utility hardware. Thin household wire and copper pipe belong to "copper scrap (pipe/fittings/household wire)".`;

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

let statusCache = null;
async function status() {
  if (process.env.GUARDGRID_LLM === 'off') return { enabled: false, model: MODEL, reason: 'Disabled by GUARDGRID_LLM=off' };
  if (statusCache && Date.now() < statusCache.until) return statusCache.value;
  let value;
  let ttl = 10 * 60000;
  try {
    await getClient().models.retrieve(MODEL);
    value = { enabled: true, model: MODEL };
  } catch (err) {
    value = { enabled: false, model: MODEL, reason: describe(err) };
    ttl = 60000;
  }
  statusCache = { value, until: Date.now() + ttl };
  return value;
}

function describe(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic API key was rejected';
  if (err instanceof Anthropic.NotFoundError) return `Model ${MODEL} is not available to this key`;
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API';
  if (err instanceof Anthropic.APIConnectionError) return 'Cannot reach the Anthropic API';
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status}`;
  if (/api key|apiKey|credentials|authentication/i.test(err?.message || '')) return 'No Anthropic credentials found. Set ANTHROPIC_API_KEY in .env.local';
  return err?.message || 'Unknown error';
}

// Upstream API errors map to gateway codes so the browser never mistakes an
// Anthropic 401/404 for its own; errors raised here keep their own status.
function httpStatus(err) {
  if (err instanceof Anthropic.RateLimitError) return 429;
  if (err instanceof Anthropic.APIConnectionError) return 503;
  if (err instanceof Anthropic.APIError) return 502;
  return err?.status || 500;
}

const failure = (message, status) => Object.assign(new Error(message), { status });

// Parses with the schema and checks the stop reason before trusting the output.
async function structured({ system, content, schema, effort, maxTokens }) {
  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      ...FALLBACK,
      system,
      output_config: { effort, format: betaZodOutputFormat(schema) },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    // parse() validates the JSON before returning, so truncated or off-schema
    // output surfaces here as a plain AnthropicError rather than an APIError.
    if (err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError)) {
      throw failure('The model response was incomplete or did not match the report format', 502);
    }
    throw err;
  }
  if (response.stop_reason === 'refusal') throw failure('The model declined this request', 422);
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) throw failure('The model response was incomplete', 502);
  return { output: response.parsed_output, model: response.model };
}

function sendError(res, err) {
  if (err instanceof Anthropic.AuthenticationError) statusCache = null; // show offline mode on the next status check
  return res.status(httpStatus(err)).json({ error: describe(err) });
}

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const imageBlock = ({ data, mediaType }) => {
  if (!MEDIA_TYPES.includes(mediaType) || typeof data !== 'string') throw Object.assign(new Error('Unsupported image'), { status: 400 });
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
};

function createLlmRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '25mb' }));

  router.get('/status', async (req, res) => {
    res.json(await status());
  });

  router.post('/classify-photo', async (req, res) => {
    const s = await status();
    if (!s.enabled) return res.status(503).json({ error: s.reason });
    try {
      const { image, mediaType, declaredMaterial } = req.body || {};
      const { output, model } = await structured({
        system: PHOTO_SYSTEM,
        effort: 'low',
        maxTokens: 4000,
        schema: PhotoSchema,
        content: [
          imageBlock({ data: image, mediaType }),
          { type: 'text', text: `The seller declared this load as: ${String(declaredMaterial || 'not stated').slice(0, 60)}. Classify what the photo actually shows.` },
        ],
      });
      return res.json({ ...output, model });
    } catch (err) {
      return sendError(res, err);
    }
  });

  router.post('/report', async (req, res) => {
    const s = await status();
    if (!s.enabled) return res.status(503).json({ error: s.reason });
    try {
      const { context, images = [] } = req.body || {};
      const content = [];
      images.slice(0, 3).forEach((img, i) => {
        content.push({ type: 'text', text: `Evidence image E${i + 1}: ${String(img.caption || '').slice(0, 200)}` });
        content.push(imageBlock(img));
      });
      content.push({
        type: 'text',
        text: `Case file (JSON):\n${JSON.stringify(context, null, 1)}\n\nDraft the incident brief for PDRM. Refer to evidence images as E1, E2… and to scrap sales by their transaction IDs.`,
      });
      const { output, model } = await structured({ system: REPORT_SYSTEM, effort: 'medium', maxTokens: 16000, schema: ReportSchema, content });
      return res.json({ ...output, model });
    } catch (err) {
      return sendError(res, err);
    }
  });

  return router;
}

module.exports = { createLlmRouter, PHOTO_LABELS };
