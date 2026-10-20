// Pack building logic without file or network access, so it can be tested anywhere.
import { validateItems, normW } from './validate.mjs';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function buildPrompt({ n, description, level, knownSample }) {
  return `You are an experienced English teacher for Russian-speaking adults.
Create ${n} useful English words or multi-word expressions on the topic "${description}" for CEFR level ${level}.
Prefer natural collocations and phrasal verbs that people really use. Avoid very basic words (A1) and rare jargon.
Do NOT include any of these (already known): ${knownSample.length ? knownSample.join(', ') : '(none)'}.
For each item give: "w" (the English word or expression, lowercase unless a proper noun),
"tr" (Russian translation, 1–3 variants separated by "; "),
"pos" (one of n, v, adj, adv, phr),
"ex" (exactly 2 examples: objects {"en": natural English sentence of 6–16 words that contains "w" exactly or in an inflected form, "ru": its Russian translation}),
"note" (short Russian usage note, up to 12 words, or "").
Return only valid JSON, no markdown, no comments, no text before or after it. Use double quotes and no trailing commas.
Example of the exact format with one item:
{"items":[{"w":"meet a deadline","tr":"уложиться в срок","pos":"phr","ex":[{"en":"We worked all weekend to meet the deadline for the report.","ru":"Мы работали все выходные, чтобы сдать отчёт в срок."},{"en":"The team met every deadline this quarter.","ru":"В этом квартале команда уложилась во все сроки."}],"note":"часто с глаголами work hard, manage to"}]}`;
}

// JSON schema for providers that support structured output (GigaChat response_format, Gemini responseJsonSchema)
export const ITEMS_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          w: { type: 'string', description: 'English word or expression' },
          tr: { type: 'string', description: 'Russian translation, 1-3 variants separated by "; "' },
          pos: { type: 'string', description: 'one of: n, v, adj, adv, phr' },
          ex: {
            type: 'array',
            description: 'exactly 2 examples',
            items: {
              type: 'object',
              properties: {
                en: { type: 'string', description: 'English sentence of 6-16 words containing w' },
                ru: { type: 'string', description: 'Russian translation of the sentence' }
              },
              required: ['en', 'ru']
            }
          },
          note: { type: 'string', description: 'short Russian usage note or empty string' }
        },
        required: ['w', 'tr', 'pos', 'ex', 'note']
      }
    }
  },
  required: ['items']
};

// end index of the JSON value starting at s[i] ('{' or '['), honouring strings; -1 if it never closes
function matchEnd(s, i) {
  const open = s[i], close = open === '{' ? '}' : ']';
  let depth = 0, str = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (str) { if (c === '\\') j++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return j;
  }
  return -1;
}
// common model slips: trailing commas, typographic quotes around keys
const repair = s => s.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"');
const tryParse = s => { try { return JSON.parse(s); } catch { try { return JSON.parse(repair(s)); } catch { return undefined; } } };

/**
 * Pulls items out of a model answer. Whole JSON first; if it is broken (text after it, a cut-off answer,
 * a bad comma), every complete object that has a "w" field is salvaged on its own.
 */
export function extractJSON(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '{' && t[i] !== '[') continue;
    const end = matchEnd(t, i);
    if (end < 0) break;
    const v = tryParse(t.slice(i, end + 1));
    if (Array.isArray(v)) return { items: v };
    if (v && Array.isArray(v.items)) return v;
    break;
  }
  const items = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== '{') continue;
    const end = matchEnd(t, i);
    if (end < 0) continue;
    const v = tryParse(t.slice(i, end + 1));
    if (v && typeof v === 'object' && !Array.isArray(v) && (v.w || v.word)) { items.push(v); i = end; }
  }
  if (!items.length) throw new Error('в ответе нет разборчивого JSON');
  return { items, salvaged: true };
}

// ISO week number: levels alternate week by week
export function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
export const levelFor = (dateStr, levels) => levels[isoWeek(dateStr) % levels.length];
export const packId = (date, topic, level) => `${date}-${topic}-${level.toLowerCase()}`;
export function packTitle(label, level, date) {
  const [, m, d] = date.split('-').map(Number);
  return `${label} · ${level} · ${d} ${MONTHS[m - 1]}`;
}

// add a pack to packs/index.json data; returns false if it is already there (no duplicates)
export function addToIndex(index, meta, date) {
  index.v = 1;
  index.packs = Array.isArray(index.packs) ? index.packs : [];
  if (index.packs.some(p => p.id === meta.id)) return false;
  index.packs.push(meta);
  index.packs.sort((a, b) => (b.created || '').localeCompare(a.created || '') || a.id.localeCompare(b.id));
  index.updated = date;
  return true;
}

/**
 * Asks the model in batches of up to `batch` items until n items pass validation.
 * Request budget: the batches n needs, plus `retries` extra per batch (n=20, batch=10, retries=2 → 6 requests).
 * generate: async (prompt, {schema}) -> text. Returns {items, requested, reasons, attempts, error?}.
 */
export async function collectItems({ generate, n, description, level, known, retries = 2, batch = 10, log = () => {} }) {
  const knownSet = [...known];
  const target = Math.ceil(n * 0.7);
  const maxRequests = Math.ceil(n / batch) * (1 + retries);
  let items = [], requested = 0, attempts = 0;
  const reasons = {};
  const count = (k, v = 1) => { reasons[k] = (reasons[k] || 0) + v; };
  while (attempts < maxRequests && items.length < n) {
    attempts++;
    const have = items.map(x => x.w);
    // ask for a few extra: some answers repeat known words or fail the checks
    const ask = Math.min(batch, n - items.length) + 2;
    const prompt = buildPrompt({ n: ask, description, level, knownSample: have.concat(knownSet.slice(-300)).slice(0, 320) });
    let raw = [], salvaged = false;
    try {
      const data = extractJSON(await generate(prompt, { schema: ITEMS_SCHEMA }));
      raw = Array.isArray(data.items) ? data.items : [];
      salvaged = !!data.salvaged;
    } catch (e) {
      // a short label, not the whole parser message, so the summary groups similar failures
      count('ответ не разобран');
      log(`  запрос ${attempts}: ответ не разобран (${e.message})`);
      continue;
    }
    if (salvaged) count('ответ с ошибками JSON, слова извлечены по одному');
    requested += raw.length;
    const r = validateItems(raw, knownSet.concat(have));
    Object.entries(r.reasons).forEach(([k, v]) => count(k, v));
    items = items.concat(r.items);
    log(`  запрос ${attempts}: получено ${raw.length}${salvaged ? ' (JSON с ошибками)' : ''}, прошло проверку ${r.items.length}, всего ${items.length} из ${n}`);
  }
  items = items.slice(0, n);
  const out = { items, requested, reasons, attempts };
  if (items.length < target && items.length < 8) out.error = `прошло проверку только ${items.length} из ${n}`;
  return out;
}

export function makePack({ id, title, topic, level, date, provider, items }) {
  return { id, title, topic, level, created: date, provider, items };
}

export const knownWordsOf = (known, topic) => (known[topic] || []).map(normW);
