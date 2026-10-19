// Generator with a mocked provider: creates a pack, updates index.json, and a second run creates no duplicates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../generate-pack.mjs';
import { good } from './cases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-packs-'));
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(here, '..', 'topics.json'), path.join(root, 'tools', 'topics.json'));
  fs.writeFileSync(path.join(root, 'tools', 'known-words.json'), JSON.stringify({ build: ['scaffolding'] }));
  return root;
}
// 10 valid items whose words differ: "pour concrete 1".."10" would fail the latin check, so vary the verb instead
const VERBS = ['pour', 'lay', 'build', 'paint', 'cut', 'mix', 'lift', 'drill', 'level', 'weld'];
const items = VERBS.map(v => good(v, {
  pos: 'v', tr: 'делать что-то',
  ex: [{ en: `The workers will ${v} it before the inspection tomorrow.`, ru: 'Рабочие сделают это до проверки завтра.' }]
}));
const mock = { name: 'mock', model: 'mock', generate: async () => JSON.stringify({ items }) };

test('генератор создаёт пакет и обновляет index.json, повтор не создаёт дублей', async () => {
  const root = tempRepo(), quiet = () => {};
  const r1 = await run({ root, date: '2026-10-19', topic: 'build', level: 'B1', count: 10, provider: mock, log: quiet });
  assert.deepEqual(r1.created, ['2026-10-19-build-b1']);
  const index = JSON.parse(fs.readFileSync(path.join(root, 'packs', 'index.json'), 'utf8'));
  assert.equal(index.packs.length, 1);
  assert.equal(index.packs[0].title, 'Строительство · B1 · 19 окт');
  assert.equal(index.packs[0].count, 10);
  const pack = JSON.parse(fs.readFileSync(path.join(root, 'packs', '2026-10-19-build-b1.json'), 'utf8'));
  assert.equal(pack.items.length, 10);
  assert.equal(pack.provider, 'mock');
  const known = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'known-words.json'), 'utf8'));
  assert.ok(known.build.includes('weld') && known.build.includes('scaffolding'));

  const r2 = await run({ root, date: '2026-10-19', topic: 'build', level: 'B1', count: 10, provider: mock, log: quiet });
  assert.deepEqual(r2.created, []);
  assert.deepEqual(r2.skipped, ['2026-10-19-build-b1']);
  const index2 = JSON.parse(fs.readFileSync(path.join(root, 'packs', 'index.json'), 'utf8'));
  assert.equal(index2.packs.length, 1);
});

test('слишком мало годных слов — пакет не создаётся', async () => {
  const root = tempRepo();
  const bad = { name: 'mock', model: 'mock', generate: async () => '{"items":[{"w":"scaffolding","tr":"леса","pos":"n","ex":[]}]}' };
  const r = await run({ root, date: '2026-10-19', topic: 'build', level: 'B1', count: 20, provider: bad, log: () => {} });
  assert.equal(r.created.length, 0);
  assert.equal(r.failed.length, 1);
  assert.ok(!fs.existsSync(path.join(root, 'packs', 'index.json')));
});
