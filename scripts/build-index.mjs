// Builds the published indexes for main and every contrib/* branch.
//
//   node scripts/build-index.mjs <outDir>          # reads origin/main + origin/contrib/* (CI)
//   node scripts/build-index.mjs <outDir> --local  # reads ./bots and ./status from the working tree
//
// Output (pushed to the `index` branch by CI):
//   index.json                     list of published branches + counts
//   terminated.json                copy of main's status/terminated.json
//   <branch-dir>/bots.json         ACTIVE entries only, minimal fields (what the extension syncs)
//   <branch-dir>/bots-all.json     every entry with status (list page + website)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  listContribBranches,
  parseBotFiles,
  readBotFilesFromDir,
  readBotFilesFromRef,
  readJson,
} from './lib.mjs';

export function branchDir(branch) {
  return branch.replace(/\//g, '-');
}

/** Pure: entries + terminated map -> the two index payloads for one branch. */
export function buildBranchIndex(branch, entries, terminated, generatedAt) {
  const all = entries.map((e) =>
    terminated[e.channelId]
      ? { ...e, status: 'terminated', terminatedAt: terminated[e.channelId] }
      : { ...e, status: 'active' },
  );
  const active = all.filter((e) => e.status === 'active').map((e) => ({ id: e.channelId, handle: e.handle || '' }));
  return {
    bots: { generatedAt, branch, count: active.length, bots: active },
    botsAll: { generatedAt, branch, count: all.length, bots: all },
  };
}

function main() {
  const [outDir, flag] = process.argv.slice(2);
  if (!outDir) {
    console.error('usage: build-index.mjs <outDir> [--local]');
    process.exit(2);
  }
  const local = flag === '--local';
  const generatedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const terminated = local
    ? readJson('status/terminated.json', {})
    : JSON.parse(execFileSync('git', ['show', 'origin/main:status/terminated.json'], { encoding: 'utf8' }));

  const sources = local
    ? [{ branch: 'main', files: readBotFilesFromDir('bots') }]
    : ['main', ...listContribBranches()].map((branch) => ({
        branch,
        files: readBotFilesFromRef(`origin/${branch}`),
      }));

  mkdirSync(outDir, { recursive: true });
  const summary = [];
  let hadErrors = false;
  for (const { branch, files } of sources) {
    const { entries, errors } = parseBotFiles(files);
    if (errors.length) {
      hadErrors = true;
      // Bad files are skipped, not fatal: one typo must not stop the whole list publishing.
      console.error(`[${branch}] skipped invalid files:\n  ${errors.join('\n  ')}`);
    }
    const dir = branchDir(branch);
    const { bots, botsAll } = buildBranchIndex(branch, entries, terminated, generatedAt);
    mkdirSync(join(outDir, dir), { recursive: true });
    writeFileSync(join(outDir, dir, 'bots.json'), JSON.stringify(bots));
    writeFileSync(join(outDir, dir, 'bots-all.json'), JSON.stringify(botsAll));
    summary.push({ branch, dir, active: bots.count, total: botsAll.count });
    console.log(`[${branch}] ${bots.count} active / ${botsAll.count} total`);
  }

  writeFileSync(join(outDir, 'terminated.json'), JSON.stringify(terminated));
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ generatedAt, branches: summary }, null, 2));
  if (hadErrors) console.error('Some files were skipped; run scripts/validate.mjs on the affected branch.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
