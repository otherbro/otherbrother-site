# Notes for Claude

- Static site for Other Brother (Isaiah Powers & Stuart Bury). `node build.mjs` → `_site/`; zero npm dependencies on purpose (npm may be unavailable). Deployed by `.github/workflows/deploy.yml` to GitHub Pages on push to `main`.
- Content: `projects/NN-slug/info.md` (front matter: title, tech, vimeo, ratio (optional; else read from Vimeo oEmbed at build, else 16:9), description, client, loop, loop_mobile, poster, draft, date) plus media auto-detected by name (`poster.jpg`, `loop.mp4`, `loop-mobile.mp4`). `:::` blocks: `video` (`video center` to center a narrow clip), `videos`, `images <ratio>`; `###` = bold uppercase section label, `####` = subhead.
- `content/about.md` text is the owner's exact copy: do not edit wording. Project write-ups are approved client copy: only fix typos when asked.
- Design rules: sheets slide up from bottom, light blue #EFF7FE, left-justified, one heading style for all sheets; navy #0A1236, royal #1A2C96; dark-purple text shadows rgba(34,12,64,…); no dark bar behind homepage controls; large glass chevron arrows with no circle; Project info pill bottom-center.
- Homepage slide stays for twice its loop's length, i.e. the loop plays twice (6 s without a loop); manual navigation resets the timer.
- `BASE_PATH` / `SITE_URL` env vars override `site.json` (basePath currently `/otherbrother-site`).
- Video hosting is Vimeo only; no medical claims beyond approved copy for pharma projects (VYVGART awaits a claims-free cut).
