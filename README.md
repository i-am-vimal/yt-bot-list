# yt-bot-list

Hand-curated list of YouTube comment bot channels, used by the **YT Bot Blocker** browser extension.

- `bots/<channelId>.json` — one file per bot channel
- `status/terminated.json` — channels YouTube has terminated (written by the weekly check)
- Website: `https://<owner>.github.io/yt-bot-list/` (read-only search)

## How changes flow

1. Contributors click **Bot** next to a comment on YouTube. The extension commits `bots/<id>.json` to `contrib/YYYY-MM` (created from `main` on first use each month).
2. On the 1st of every month, `monthly-pr.yml` opens a PR from last month's branch into `main`.
3. A reviewer checks it during the month and merges it, then deletes the branch.
4. `build-index.yml` rebuilds the published JSON on every change and force-pushes it to the `index` branch. The extension and website read only from there.
5. Every Monday, `check-terminated.yml` asks the YouTube Data API which channels still exist. Missing ones go into `status/terminated.json` on `main`. Users stop syncing them on their next daily sync. Terminated channels stay in the repo and are never re-checked.

Unmarking (removing a channel) deletes the file on the month branch, so it goes through the same review.

## Published files (`index` branch)

| File | Contents |
|---|---|
| `index.json` | Published branches and counts |
| `<branch>/bots.json` | Active channels only (`id`, `handle`), synced by the extension |
| `<branch>/bots-all.json` | Every entry with `status` (`active`/`terminated`), used by the list page and website |
| `terminated.json` | Copy of `status/terminated.json` |

`<branch>` is `main` or `contrib-YYYY-MM`. Don't edit the `index` branch by hand; it's rebuilt from scratch on every run.

## One-time setup

1. **Create this repo** on GitHub as **public**, named `yt-bot-list`, and push this folder to `main`.
2. **Actions permissions:** Settings → Actions → General:
   - Workflow permissions: **Read and write permissions**
   - Tick **Allow GitHub Actions to create and approve pull requests** (needed for the monthly PR)
3. **Contributors:** Settings → Collaborators → add each contributor with **Write** access. Write access is the allowlist; the extension checks it on sign-in.
4. **GitHub Pages:** Settings → Pages → Source: **GitHub Actions**. Then run the `pages` workflow once (Actions → pages → Run workflow).
5. **YouTube API key** (for the weekly termination check):
   1. Go to <https://console.cloud.google.com/> → project dropdown → **New Project**.
   2. ☰ → APIs & Services → Library → **YouTube Data API v3** → Enable.
   3. APIs & Services → Credentials → **Create credentials → API key**.
   4. Edit the key. Application restrictions: **None** (GitHub runner IPs change). API restrictions: **YouTube Data API v3** only. Save.
   5. Here: Settings → Secrets and variables → Actions → **New repository secret**, name `YOUTUBE_API_KEY`.

   The key lives only in that secret. Never commit it or put it in the extension. Quota: 10,000 units/day free, and the check uses 1 unit per 50 channels.
6. Run **build-index** once by hand (Actions → build-index → Run workflow) so the `index` branch exists before anyone installs the extension.

Optional: protect `main` (Settings → Branches) so changes only arrive through PRs. The `check-terminated` workflow pushes to `main` as `github-actions[bot]`; if you protect `main`, allow that bot to bypass.

## Reviewing the monthly PR

- Open a few `evidence[].url` links: does the comment look like bot spam?
- Open the channel link: is it the right account, and not a real person?
- `validate` must pass. It checks the file format, channel ID shape, and that evidence URLs point to youtube.com.
- Merge, then delete the `contrib/YYYY-MM` branch.

The PR is opened by `github-actions[bot]`, so GitHub doesn't start PR workflows for it. The `validate` results from the branch's own pushes show on the PR instead. To re-run it, push any commit or use **Re-run jobs**.

## Local commands

```sh
npm test                 # unit tests for the scripts
npm run validate         # check bots/ and status/
npm run build:local      # build indexes from the working tree into out/
YOUTUBE_API_KEY=... npm run check-terminated
```

Local site preview: `npx serve site`, then open `http://localhost:3000/?repo=<owner>/yt-bot-list`.
