// Validates every file in bots/ and status/terminated.json in the working tree.
// Exit code 1 when anything is wrong. Run on PRs and pushes.
import { CHANNEL_ID_RE, parseBotFiles, readBotFilesFromDir, readJson } from './lib.mjs';

const { entries, errors } = parseBotFiles(readBotFilesFromDir('bots'));

const terminated = readJson('status/terminated.json', {});
if (!terminated || typeof terminated !== 'object' || Array.isArray(terminated)) {
  errors.push('status/terminated.json: must be an object of { channelId: ISO date }');
} else {
  for (const [id, date] of Object.entries(terminated)) {
    if (!CHANNEL_ID_RE.test(id)) errors.push(`status/terminated.json: bad channel ID "${id}"`);
    if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) errors.push(`status/terminated.json: bad date for ${id}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`OK: ${entries.length} bot entries, ${Object.keys(terminated).length} terminated.`);
