// Pack item validation. Pure ES module (no Node APIs): used by generate-pack.mjs, the tests
// and the browser test page.

export const POS_LIST = ['n', 'v', 'adj', 'adv', 'phr'];
const CYR = /[а-яё]/i;
const MAX_W = 40;

// base -> irregular forms (past, participle, 3rd person where irregular)
const IRREG = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'], have: ['has', 'had', 'having'], do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone'], get: ['got', 'gotten'], give: ['gave', 'given'], take: ['took', 'taken'], make: ['made'],
  come: ['came'], see: ['saw', 'seen'], know: ['knew', 'known'], think: ['thought'], find: ['found'], tell: ['told'],
  say: ['said'], become: ['became'], leave: ['left'], feel: ['felt'], bring: ['brought'], begin: ['began', 'begun'],
  keep: ['kept'], hold: ['held'], write: ['wrote', 'written'], stand: ['stood'], hear: ['heard'], mean: ['meant'],
  meet: ['met'], run: ['ran'], pay: ['paid'], sit: ['sat'], speak: ['spoke', 'spoken'], lead: ['led'], grow: ['grew', 'grown'],
  lose: ['lost'], fall: ['fell', 'fallen'], send: ['sent'], build: ['built'], understand: ['understood'], draw: ['drew', 'drawn'],
  break: ['broke', 'broken'], spend: ['spent'], drive: ['drove', 'driven'], buy: ['bought'], teach: ['taught'], catch: ['caught'],
  fight: ['fought'], wear: ['wore', 'worn'], choose: ['chose', 'chosen'], eat: ['ate', 'eaten'], set: ['set'], put: ['put'],
  cut: ['cut'], let: ['let'], shut: ['shut'], hit: ['hit'], cost: ['cost'], lay: ['laid'], lie: ['lay', 'lain', 'lying'],
  rise: ['rose', 'risen'], ride: ['rode', 'ridden'], sell: ['sold'], show: ['shown'], sleep: ['slept'], win: ['won'],
  throw: ['threw', 'thrown'], fly: ['flew', 'flown', 'flies'], forget: ['forgot', 'forgotten'], hang: ['hung'],
  hide: ['hid', 'hidden'], light: ['lit'], read: ['read'], seek: ['sought'], shake: ['shook', 'shaken'], shoot: ['shot'],
  sing: ['sang', 'sung'], sink: ['sank', 'sunk'], swim: ['swam', 'swum'], tear: ['tore', 'torn'], wake: ['woke', 'woken'],
  bend: ['bent'], bind: ['bound'], bite: ['bit', 'bitten'], blow: ['blew', 'blown'], deal: ['dealt'], dig: ['dug'],
  feed: ['fed'], forbid: ['forbade', 'forbidden'], freeze: ['froze', 'frozen'], lend: ['lent'], ring: ['rang', 'rung'],
  spin: ['spun'], split: ['split'], spread: ['spread'], steal: ['stole', 'stolen'], stick: ['stuck'], strike: ['struck'],
  swear: ['swore', 'sworn'], undertake: ['undertook', 'undertaken'], withdraw: ['withdrew', 'withdrawn'], overcome: ['overcame']
};

export const normW = s => String(s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
const tokens = s => normW(s).match(/[a-z][a-z'-]*/g) || [];
const isVowel = c => 'aeiou'.includes(c);

// all surface forms of one English word that count as "the word is in the sentence"
export function wordForms(word) {
  const w = normW(word), out = new Set([w]);
  const add = x => x && out.add(x);
  (IRREG[w] || []).forEach(add);
  ['s', 'es', 'ed', 'd', 'ing', 'er', 'est', 'ers', "'s"].forEach(e => add(w + e));
  if (/[^aeiou]y$/.test(w)) { const b = w.slice(0, -1); ['ies', 'ied', 'ier', 'iest', 'ily'].forEach(e => add(b + e)); }
  if (w.endsWith('e')) { const b = w.slice(0, -1); ['ing', 'ed', 'er', 'est'].forEach(e => add(b + e)); }
  if (w.endsWith('ie')) add(w.slice(0, -2) + 'ying');
  if (w.endsWith('f')) add(w.slice(0, -1) + 'ves');
  if (w.endsWith('fe')) add(w.slice(0, -2) + 'ves');
  // short verb with consonant-vowel-consonant ending: stop -> stopped, stopping
  const L = w.length;
  if (L >= 3 && !isVowel(w[L - 1]) && !'wxy'.includes(w[L - 1]) && isVowel(w[L - 2]) && !isVowel(w[L - 3])) {
    const d = w + w[L - 1];
    ['ed', 'ing', 'er', 'est'].forEach(e => add(d + e));
  }
  return out;
}

// leading articles and "to" do not need to appear: "to build", "a deadline"
const stripLead = w => normW(w).replace(/^(to|a|an|the) /, '');

// is the item's word or expression in the sentence? (expressions are checked by their first word)
export function wordInSentence(w, sentence) {
  const parts = stripLead(w).split(/ +/);
  const toks = tokens(sentence);
  const first = parts[0];
  if (first.includes('-')) {
    // hyphenated words: match as a whole, with forms of the last part ("load-bearing", "check-ins")
    const pre = first.slice(0, first.lastIndexOf('-') + 1), last = first.slice(pre.length);
    const forms = [...wordForms(last)].map(f => pre + f);
    return toks.some(t => forms.includes(t));
  }
  const forms = wordForms(first);
  return toks.some(t => forms.has(t));
}

const wordCount = s => (String(s).trim().match(/\S+/g) || []).length;

// "reinforced concrete — железобетон", "plaster (n.)", "to tile: класть плитку" -> the English part only;
// left as is when no clean Latin part remains, so the item is still rejected with a clear reason
export function cleanWord(s) {
  const orig = String(s || '').trim();
  let w = orig.replace(/\s*\([^)]*\)/g, '').split(/\s+[—–-]\s+|\s*:\s+|\s*=\s*/)[0].replace(/[.,;!?]+$/, '').replace(/^["'«]+|["'»]+$/g, '').trim();
  return /^[A-Za-z][A-Za-z'’ -]*$/.test(w) ? w : orig;
}

// models name fields their own way: examples/example, english/russian, translation as an array, etc.
// first non-empty field among keys; an array of strings counts too ("tr": ["a", "b"] -> "a; b")
const pickStr = (o, keys) => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string')) return v.join('; ');
  }
  return '';
};
export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const it = Object.assign({}, raw);
  it.w = cleanWord(pickStr(raw, ['w', 'word', 'expression', 'phrase', 'term']));
  it.tr = pickStr(raw, ['tr', 'translation', 'ru', 'russian']);
  it.pos = pickStr(raw, ['pos', 'part_of_speech', 'partOfSpeech']);
  let ex = raw.ex ?? raw.examples ?? raw.example ?? [];
  if (!Array.isArray(ex)) ex = [ex];
  it.ex = ex.map(e => {
    if (typeof e === 'string') {
      // "English sentence — Русский перевод"
      const m = e.split(/\s+[—–-]\s+/);
      return m.length >= 2 ? { en: m[0], ru: m.slice(1).join(' — ') } : { en: e, ru: '' };
    }
    if (!e || typeof e !== 'object') return { en: '', ru: '' };
    return { en: pickStr(e, ['en', 'english', 'sentence', 'text', 'example']), ru: pickStr(e, ['ru', 'russian', 'translation']) };
  });
  return it;
}

// returns {item} with a cleaned copy, or {reason}
export function checkItem(raw, known) {
  if (!raw || typeof raw !== 'object') return { reason: 'не объект' };
  raw = normalizeItem(raw);
  const w = normW(raw.w);
  if (!w) return { reason: 'пустое слово' };
  if (w.length > MAX_W) return { reason: 'слово длиннее 40 символов' };
  if (!/^[a-z][a-z' -]*$/.test(w)) return { reason: 'в слове не только латиница' };
  if (known && known.has(w)) return { reason: 'уже известно' };
  const tr = String(raw.tr || '').trim();
  if (!CYR.test(tr)) return { reason: 'в переводе нет кириллицы' };
  const pos = normW(raw.pos);
  if (!POS_LIST.includes(pos)) return { reason: 'неизвестная часть речи' };
  const ex = Array.isArray(raw.ex) ? raw.ex : [];
  if (!ex.length) return { reason: 'нет примеров' };
  const clean = [];
  for (const e of ex.slice(0, 2)) {
    const en = String(e && e.en || '').trim(), ru = String(e && e.ru || '').trim();
    const n = wordCount(en);
    if (n < 4 || n > 25) return { reason: 'пример короче 4 или длиннее 25 слов' };
    if (!CYR.test(ru)) return { reason: 'в переводе примера нет кириллицы' };
    if (!wordInSentence(w, en)) return { reason: 'слова нет в примере' };
    clean.push({ en, ru });
  }
  const item = { w, tr, pos, ex: clean };
  const note = String(raw.note || '').trim();
  if (note && CYR.test(note)) item.note = note.slice(0, 120);
  return { item };
}

// validate a list of raw items: drops bad ones and duplicates, counts the reasons
// and keeps up to 4 rejected words per reason for the log
export function validateItems(rawItems, knownWords) {
  const known = new Set([...(knownWords || [])].map(normW));
  const seen = new Set(), items = [], reasons = {}, samples = {};
  const reject = (r, raw) => {
    reasons[r] = (reasons[r] || 0) + 1;
    const w = raw && typeof raw === 'object' ? String(raw.w ?? raw.word ?? '').slice(0, 60) : '';
    if (w && (samples[r] = samples[r] || []).length < 4) samples[r].push(w);
  };
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    const r = checkItem(raw, known);
    if (!r.item) { reject(r.reason, raw); continue; }
    if (seen.has(r.item.w)) { reject('дубль в пакете', raw); continue; }
    seen.add(r.item.w);
    items.push(r.item);
  }
  return { items, reasons, samples };
}
