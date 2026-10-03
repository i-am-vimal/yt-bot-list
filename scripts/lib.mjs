// Shared helpers for the bot-list scripts. No dependencies: Node 20+ only.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{22}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const YT_URL_RE = /^https:\/\/(www\.|m\.)?youtube\.com\//;

const LIMITS = { text: 2000, note: 500, name: 200, handle: 100, evidence: 20 };

/**
 * Validates one bot entry. Returns a list of problems (empty when valid).
 * `fileName` is the bare file name, e.g. "UC....json".
 */
export function validateEntry(entry, fileName) {
  const errors = [];
  const err = (msg) => errors.push(`${fileName}: ${msg}`);

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    err('must be a JSON object');
    return errors;
  }
  const allowed = new Set(['channelId', 'handle', 'name', 'evidence', 'addedBy', 'addedAt', 'note']);
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) err(`unknown field "${key}"`);
  }

  if (typeof entry.channelId !== 'string' || !CHANNEL_ID_RE.test(entry.channelId)) {
    err('channelId must look like UC + 22 characters');
  } else if (fileName !== `${entry.channelId}.json`) {
    err(`file name must be ${entry.channelId}.json`);
  }

  if (entry.handle !== undefined) {
    if (typeof entry.handle !== 'string' || entry.handle.length > LIMITS.handle) err('handle must be a short string');
    else if (entry.handle !== '' && !entry.handle.startsWith('@')) err('handle must start with @');
  }
  if (entry.name !== undefined && (typeof entry.name !== 'string' || entry.name.length > LIMITS.name)) {
    err('name must be a short string');
  }
  if (entry.note !== undefined && (typeof entry.note !== 'string' || entry.note.length > LIMITS.note)) {
    err(`note must be a string up to ${LIMITS.note} characters`);
  }
  if (typeof entry.addedBy !== 'string' || entry.addedBy === '') err('addedBy is required');
  if (typeof entry.addedAt !== 'string' || !ISO_RE.test(entry.addedAt)) err('addedAt must be an ISO UTC timestamp');

  if (!Array.isArray(entry.evidence)) {
    err('evidence must be an array');
  } else {
    if (entry.evidence.length > LIMITS.evidence) err(`at most ${LIMITS.evidence} evidence items`);
    entry.evidence.forEach((ev, i) => {
      if (!ev || typeof ev !== 'object') return err(`evidence[${i}] must be an object`);
      if (typeof ev.text !== 'string' || ev.text.length > LIMITS.text) err(`evidence[${i}].text must be a string up to ${LIMITS.text} characters`);
      if (typeof ev.url !== 'string' || !YT_URL_RE.test(ev.url)) err(`evidence[${i}].url must be a youtube.com URL`);
      if (typeof ev.seenAt !== 'string' || !ISO_RE.test(ev.seenAt)) err(`evidence[${i}].seenAt must be an ISO UTC timestamp`);
    });
  }
  return errors;
}

/** Parses bot files given as [{ name, content }]. Returns { entries, errors }. */
export function parseBotFiles(files) {
  const entries = [];
  const errors = [];
  for (const { name, content } of files) {
    let entry;
    try {
      entry = JSON.parse(content);
    } catch (e) {
      errors.push(`${name}: invalid JSON (${e.message})`);
      continue;
    }
    const problems = validateEntry(entry, name);
    if (problems.length) errors.push(...problems);
    else entries.push(entry);
  }
  entries.sort((a, b) => a.channelId.localeCompare(b.channelId));
  return { entries, errors };
}

/** Reads bots/*.json from the working tree. */
export function readBotFilesFromDir(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((name) => ({ name, content: readFileSync(join(dir, name), 'utf8') }));
}

/** Reads bots/*.json at a git ref (e.g. origin/contrib/2026-10) without checking it out. */
export function readBotFilesFromRef(ref, cwd = process.cwd()) {
  const listing = execFileSync('git', ['ls-tree', ref, '--', 'bots/'], { cwd, encoding: 'utf8' });
  const blobs = listing
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      // "<mode> blob <sha>\tbots/<name>"
      const [meta, path] = line.split('\t');
      const [, type, sha] = meta.split(' ');
      return { type, sha, name: path.slice('bots/'.length) };
    })
    .filter((b) => b.type === 'blob' && b.name.endsWith('.json'));
  if (!blobs.length) return [];

  // One git process for all blobs instead of one per file.
  const out = spawnSync('git', ['cat-file', '--batch'], {
    cwd,
    input: blobs.map((b) => b.sha).join('\n') + '\n',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (out.status !== 0) throw new Error(`git cat-file failed: ${out.stderr}`);
  const buf = out.stdout;
  const files = [];
  let pos = 0;
  for (const blob of blobs) {
    const headerEnd = buf.indexOf(0x0a, pos);
    const header = buf.subarray(pos, headerEnd).toString('utf8'); // "<sha> blob <size>"
    const size = Number(header.split(' ')[2]);
    const start = headerEnd + 1;
    files.push({ name: blob.name, content: buf.subarray(start, start + size).toString('utf8') });
    pos = start + size + 1; // trailing newline after each object
  }
  return files;
}

/** Lists remote contrib branches, e.g. ["contrib/2026-09", "contrib/2026-10"]. */
export function listContribBranches(cwd = process.cwd()) {
  const out = execFileSync('git', ['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin/contrib/'], {
    cwd,
    encoding: 'utf8',
  });
  // strip=3 turns refs/remotes/origin/contrib/X into contrib/X
  return out.split('\n').filter(Boolean).sort();
}

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

/** Stable JSON with sorted keys at the top level, 2-space indent, trailing newline. */
export function sortedJson(obj) {
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted, null, 2) + '\n';
}
