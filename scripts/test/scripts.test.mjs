import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBranchIndex, branchDir } from '../build-index.mjs';
import { findMissingChannels } from '../check-terminated.mjs';
import { parseBotFiles, validateEntry } from '../lib.mjs';

const ID_A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'UCbbbbbbbbbbbbbbbbbbbbbb';

function entry(id, extra = {}) {
  return {
    channelId: id,
    handle: '@bot',
    name: 'Bot',
    evidence: [{ text: 'buy crypto', url: 'https://www.youtube.com/watch?v=abc', seenAt: '2026-10-01T10:00:00Z' }],
    addedBy: 'someone',
    addedAt: '2026-10-01T10:00:00Z',
    ...extra,
  };
}

test('valid entry passes', () => {
  assert.deepEqual(validateEntry(entry(ID_A), `${ID_A}.json`), []);
});

test('file name must match channel ID', () => {
  const errors = validateEntry(entry(ID_A), `${ID_B}.json`);
  assert.match(errors.join(), /file name must be/);
});

test('rejects bad IDs, unknown fields, non-YouTube evidence', () => {
  const bad = entry('UCshort', { extra: 1 });
  bad.evidence[0].url = 'https://evil.example/';
  const errors = validateEntry(bad, 'UCshort.json').join('\n');
  assert.match(errors, /channelId/);
  assert.match(errors, /unknown field "extra"/);
  assert.match(errors, /youtube\.com URL/);
});

test('parseBotFiles skips broken JSON and sorts', () => {
  const { entries, errors } = parseBotFiles([
    { name: `${ID_B}.json`, content: JSON.stringify(entry(ID_B)) },
    { name: 'broken.json', content: '{' },
    { name: `${ID_A}.json`, content: JSON.stringify(entry(ID_A)) },
  ]);
  assert.deepEqual(entries.map((e) => e.channelId), [ID_A, ID_B]);
  assert.equal(errors.length, 1);
});

test('index excludes terminated from bots.json but keeps them in bots-all.json', () => {
  const { bots, botsAll } = buildBranchIndex('main', [entry(ID_A), entry(ID_B)], { [ID_B]: '2026-10-05T00:00:00Z' }, 'now');
  assert.deepEqual(bots.bots, [{ id: ID_A, handle: '@bot' }]);
  assert.equal(botsAll.count, 2);
  assert.equal(botsAll.bots[1].status, 'terminated');
  assert.equal(botsAll.bots[1].terminatedAt, '2026-10-05T00:00:00Z');
  assert.equal(branchDir('contrib/2026-10'), 'contrib-2026-10');
});

function fakeFetch(responder) {
  return async (url) => {
    const ids = new URL(url).searchParams.get('id').split(',');
    const { status = 200, body } = responder(ids);
    return { ok: status < 400, status, json: async () => body };
  };
}

test('missing channels are reported', async () => {
  const missing = await findMissingChannels(
    [ID_A, ID_B],
    'k',
    fakeFetch(() => ({ body: { items: [{ id: ID_A }] } })),
  );
  assert.deepEqual(missing, [ID_B]);
});

test('API errors throw instead of marking channels terminated', async () => {
  await assert.rejects(
    findMissingChannels([ID_A], 'bad', fakeFetch(() => ({ status: 400, body: { error: { message: 'API key not valid' } } }))),
    /API key not valid/,
  );
});

test('all-missing large batch is treated as an API problem', async () => {
  const ids = Array.from({ length: 25 }, (_, i) => `UC${String(i).padStart(22, '0')}`);
  await assert.rejects(findMissingChannels(ids, 'k', fakeFetch(() => ({ body: { items: [] } }))), /refusing/);
});

test('batches requests in groups of 50', async () => {
  const ids = Array.from({ length: 120 }, (_, i) => `UC${String(i).padStart(22, '0')}`);
  const sizes = [];
  await findMissingChannels(
    ids,
    'k',
    fakeFetch((batch) => {
      sizes.push(batch.length);
      return { body: { items: batch.map((id) => ({ id })) } };
    }),
  );
  assert.deepEqual(sizes, [50, 50, 20]);
});
