// Generates word packs with an LLM and writes them to packs/.
// usage: node tools/generate-pack.mjs [--topic talk|tech|news|build|all] [--level B1|B2|auto] [--count 20] [--date YYYY-MM-DD] [--root DIR]
// env: LLM_PROVIDER (gigachat | gemini | mock), provider keys (see tools/providers/*.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectItems, levelFor, packId, packTitle, addToIndex, makePack, knownWordsOf } from './pack-core.mjs';
import { normW } from './validate.mjs';

const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeJSON = (f, v, pretty) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, pretty ? 2 : 0) + '\n'); };

export async function loadProvider(name) {
  const n = (name || 'gigachat').trim().toLowerCase();
  if (!['gigachat', 'gemini', 'mock'].includes(n)) throw new Error(`неизвестный LLM_PROVIDER "${name}" (нужно gigachat или gemini)`);
  return import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'providers', n + '.mjs')).href);
}

/** Returns {created: [ids], skipped: [ids], failed: [{topic, error}]} */
export async function run({ root, date, topic = 'all', level = 'auto', count, provider, log = console.log }) {
  const toolsDir = path.join(root, 'tools');
  const topics = readJSON(path.join(toolsDir, 'topics.json'), null);
  if (!topics) throw new Error('нет tools/topics.json');
  const knownFile = path.join(toolsDir, 'known-words.json');
  const known = readJSON(knownFile, {});
  const indexFile = path.join(root, 'packs', 'index.json');
  const index = readJSON(indexFile, { v: 1, updated: date, packs: [] });
  const ids = topic === 'all' ? Object.keys(topics.topics) : [topic];
  const res = { created: [], skipped: [], failed: [] };

  for (const t of ids) {
    const cfg = topics.topics[t];
    if (!cfg) { res.failed.push({ topic: t, error: 'нет такой темы в topics.json' }); continue; }
    const lv = level && level !== 'auto' ? level : levelFor(date, cfg.levels || topics.levels);
    const n = +count || cfg.count || topics.count || 20;
    const id = packId(date, t, lv);
    if (index.packs && index.packs.some(p => p.id === id)) { log(`${id}: уже есть, пропускаю`); res.skipped.push(id); continue; }
    log(`${id}: запрашиваю ${n} слов у ${provider.name} (${provider.model})`);
    // every topic's words count as known, so packs do not repeat words across topics either;
    // this topic's words go last because the prompt shows only the last 300
    const allKnown = Object.values(known).flat();
    const kTopic = knownWordsOf(known, t);
    const r = await collectItems({
      generate: p => provider.generate(p), n, description: cfg.description, level: lv,
      known: allKnown.filter(w => !kTopic.includes(w)).concat(kTopic), log
    });
    const why = Object.entries(r.reasons).map(([k, v]) => `${k}: ${v}`).join('; ') || 'нет';
    log(`${id}: получено ${r.requested}, прошло проверку ${r.items.length}, отбраковано: ${why}`);
    if (r.error) { res.failed.push({ topic: t, error: `${id}: ${r.error}` }); continue; }
    const pack = makePack({ id, title: packTitle(cfg.label, lv, date), topic: t, level: lv, date, provider: provider.name, items: r.items });
    writeJSON(path.join(root, 'packs', id + '.json'), pack, true);
    addToIndex(index, { id, file: `packs/${id}.json`, title: pack.title, topic: t, level: lv, count: r.items.length, created: date, provider: provider.name }, date);
    known[t] = [...new Set((known[t] || []).concat(r.items.map(x => normW(x.w))))];
    res.created.push(id);
  }
  if (res.created.length) { writeJSON(indexFile, index, true); writeJSON(knownFile, known, true); }
  return res;
}

// command line
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  const root = path.resolve(args.root || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const date = args.date || new Date().toISOString().slice(0, 10);
  try {
    const provider = await loadProvider(process.env.LLM_PROVIDER);
    const r = await run({ root, date, topic: args.topic || 'all', level: args.level || 'auto', count: args.count, provider });
    console.log(`\nИтог: создано ${r.created.length} (${r.created.join(', ') || '—'}), уже были ${r.skipped.length}, ошибок ${r.failed.length}`);
    r.failed.forEach(f => console.log(`::error::${f.error}`));
    if (r.failed.length) process.exitCode = 1;
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exitCode = 1;
  }
}
