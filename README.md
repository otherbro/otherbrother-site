# Other Brother — website

The site builds itself from the folders in this repo. Every time something is saved to the `main` branch, GitHub rebuilds it and publishes it (takes about a minute).

Live site: https://otherbro.github.io/otherbrother-site

## Where things live

| What | Where |
| --- | --- |
| Projects (one folder each) | `projects/` |
| About text and photo | `content/about.md`, `content/directors.jpg` |
| Contact text | `content/contact.md` |
| Site name, email, social links, old-page redirects | `site.json` |
| Colors, sizes, fonts | `assets/site.css` (the variables at the top) |

## Add a project

1. Make a new folder in `projects/` named with its position and a short web name, e.g. `08-new-thing`. The number sets the order on the homepage and in the menu; the name becomes the address (`/work/new-thing/`).
2. Put these files in it (all optional except `info.md`):
   - `info.md`: the text (see below)
   - `poster.jpg`: still frame, 1920×1080
   - `loop.mp4`: homepage loop for desktop (1920×1080, H.264, no audio, 3–5 MB)
   - `loop-mobile.mp4`: homepage loop for phones (1280×720, about 1–2 MB)
   - any images used on the page
3. Save. The site rebuilds.

### info.md

```
---
title: New Thing
tech: Short film · stop motion
vimeo: 123456789            # add /hash for unlisted videos: 123456789/abc123def0
ratio: 2.39/1                # optional; the film's shape is read from Vimeo, use this only to override it
description: One or two sentences for Google and link previews.
---

Body text. Blank lines start new paragraphs.

### Production art          ← a section label

::: images 16/9
art-1.jpg | Caption
art-2.jpg | Caption
:::

::: video
355406531/e229452c7d | Caption under the video
:::

::: videos 1/1             ← optional shape; leave off for 16/9
111111111 | First clip
222222222 | Second clip
:::
```

Add `draft: true` to hide a project without deleting it.

## Reorder projects

Rename the folders' numbers (`03-` ↔ `04-`).

## Move to otherbrother.com

In `site.json` set `"url": "https://otherbrother.com"`, `"basePath": ""`, and add `"domain": "otherbrother.com"`. Then point the domain's DNS at GitHub Pages (keep the email MX records as they are).

## Build locally (optional)

`node build.mjs` writes the site to `_site/`. No other installs needed.
