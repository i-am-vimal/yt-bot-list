// Weekly check: asks the YouTube Data API which listed channels still exist.
// Channels missing from the API response are recorded in status/terminated.json.
// Terminated channels are never re-checked.
//
//   YOUTUBE_API_KEY=... node scripts/check-terminated.mjs
//
// Reads bots/ from the working tree (main) plus every fetched origin/contrib/* branch,
// so unreviewed entries are checked too.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  CHANNEL_ID_RE,
  listContribBranches,
  parseBotFiles,
  readBotFilesFromDir,
  readBotFilesFromRef,
  readJson,
  sortedJson,
} from './lib.mjs';

const API = 'https://www.googleapis.com/youtube/v3/channels';
const BATCH = 50; // channels.list accepts up to 50 IDs per call (1 quota unit)
// If at least this many channels are checked and NONE come back, assume the API is
// misbehaving rather than every bot having been terminated at once.
const SANITY_MIN = 20;

/**
 * Returns the subset of `ids` that the API no longer knows about.
 * Throws on any HTTP/API error so the caller writes nothing.
 */
export async function findMissingChannels(ids, apiKey, fetchFn = fetch) {
  const found = new Set();
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const url = `${API}?part=id&maxResults=${BATCH}&id=${batch.join(',')}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetchFn(url);
    let body;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok || !body || body.error) {
      const reason = body?.error?.errors?.[0]?.reason || body?.error?.message || `HTTP ${res.status}`;
      throw new Error(`YouTube API error: ${reason}`);
    }
    for (const item of body.items || []) found.add(item.id);
  }
  if (ids.length >= SANITY_MIN && found.size === 0) {
    throw new Error(`API returned none of ${ids.length} channels; refusing to mark them all terminated.`);
  }
  return ids.filter((id) => !found.has(id));
}

function collectIds() {
  const ids = new Set();
  const sources = [readBotFilesFromDir('bots')];
  for (const branch of listContribBranches()) sources.push(readBotFilesFromRef(`origin/${branch}`));
  for (const files of sources) {
    for (const entry of parseBotFiles(files).entries) ids.add(entry.channelId);
  }
  return [...ids].filter((id) => CHANNEL_ID_RE.test(id)).sort();
}

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('YOUTUBE_API_KEY is not set. Add it as a repository secret.');
    process.exit(1);
  }
  const path = 'status/terminated.json';
  const terminated = readJson(path, {});
  const toCheck = collectIds().filter((id) => !terminated[id]);
  console.log(`Checking ${toCheck.length} channels (${Object.keys(terminated).length} already terminated).`);
  if (!toCheck.length) return;

  const missing = await findMissingChannels(toCheck, apiKey);
  if (!missing.length) {
    console.log('No newly terminated channels.');
    return;
  }
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  for (const id of missing) terminated[id] = now;
  const before = readFileSync(path, 'utf8');
  const after = sortedJson(terminated);
  if (before !== after) writeFileSync(path, after);
  console.log(`Marked ${missing.length} channel(s) terminated:\n  ${missing.join('\n  ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
