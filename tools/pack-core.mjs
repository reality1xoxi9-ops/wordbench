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
"note" (optional short Russian usage note, up to 12 words).
Return only JSON, no markdown: {"items":[...]}`;
}

// models sometimes wrap JSON in ```json fences or add a sentence around it
export function extractJSON(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  const ar = t.indexOf('['), br = t.lastIndexOf(']');
  if (ar >= 0 && (a < 0 || ar < a) && br > ar) return { items: JSON.parse(t.slice(ar, br + 1)) };
  if (a < 0 || b < a) throw new Error('в ответе нет JSON');
  const obj = JSON.parse(t.slice(a, b + 1));
  return Array.isArray(obj) ? { items: obj } : obj;
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
 * Ask the model until enough items pass validation (first try + up to `retries` more).
 * generate: async prompt -> text. Returns {items, requested, reasons, attempts, error?}.
 */
export async function collectItems({ generate, n, description, level, known, retries = 2, log = () => {} }) {
  const knownSet = [...known];
  const target = Math.ceil(n * 0.7);
  let items = [], requested = 0, attempts = 0;
  const reasons = {};
  while (attempts <= retries && items.length < target) {
    attempts++;
    const have = items.map(x => x.w);
    const prompt = buildPrompt({ n: n - items.length + 4, description, level, knownSample: have.concat(knownSet.slice(-300)).slice(0, 320) });
    let raw = [];
    try {
      const data = extractJSON(await generate(prompt));
      raw = Array.isArray(data.items) ? data.items : [];
    } catch (e) {
      reasons['ошибка ответа: ' + e.message] = (reasons['ошибка ответа: ' + e.message] || 0) + 1;
      log(`  попытка ${attempts}: ${e.message}`);
      continue;
    }
    requested += raw.length;
    const r = validateItems(raw, knownSet.concat(have));
    Object.entries(r.reasons).forEach(([k, v]) => { reasons[k] = (reasons[k] || 0) + v; });
    items = items.concat(r.items);
    log(`  попытка ${attempts}: получено ${raw.length}, прошло проверку ${r.items.length}, всего ${items.length}`);
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
