// Other Brother site builder.
// Reads site.json, content/*.md and projects/NN-slug/info.md, writes the finished site to _site/.
// No outside packages: run with `node build.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(ROOT, '_site');
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.json'), 'utf8'));

// The site can live at a sub-path (otherbro.github.io/otherbrother-site) or at a domain root.
// BASE_PATH / SITE_URL env vars override site.json (the publishing workflow sets them).
const BASE = (process.env.BASE_PATH ?? site.basePath ?? '').replace(/\/+$/, '');
const SITE_URL = (process.env.SITE_URL ?? site.url).replace(/\/+$/, '');
const href = (p = '/') => BASE + (p.startsWith('/') ? p : '/' + p);
const abs = (p = '/') => SITE_URL + (p.startsWith('/') ? p : '/' + p);

// ---------------------------------------------------------------- helpers

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function smartQuotes(s) {
  return s
    .replace(/(^|[\s(\[{—–-])"/g, '$1“').replace(/"/g, '”')
    .replace(/(\w)'/g, '$1’').replace(/(^|[\s(\[{—–-])'/g, '$1‘').replace(/'/g, '’');
}

function inline(text) {
  let s = esc(smartQuotes(text));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s;
}

// Tiny front-matter reader: `key: value`, quoted values, and `- item` lists.
function readDoc(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const data = {};
  let body = raw;
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    body = raw.slice(m[0].length);
    let listKey = null;
    for (const line of m[1].split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const item = line.match(/^\s+-\s+(.*)$/);
      if (item && listKey) { data[listKey].push(unquote(item[1])); continue; }
      const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (!kv) continue;
      if (kv[2] === '') { data[kv[1]] = []; listKey = kv[1]; }
      else { data[kv[1]] = unquote(kv[2]); listKey = null; }
    }
  }
  return { data, body };
}
// A value may be quoted, and may end in a `# comment` (as the README examples do).
function unquote(v) {
  v = v.trim();
  const q = v.match(/^(["'])(.*)\1(\s+#.*)?$/);
  return q ? q[2] : v.replace(/\s+#.*$/, '');
}

// ---------------------------------------------------------------- vimeo

function vimeoParts(spec) {
  const [id, hash] = String(spec).trim().split('/');
  return { id, hash };
}
function vimeoSrc(spec, extra = {}) {
  const { id, hash } = vimeoParts(spec);
  const q = new URLSearchParams();
  if (hash) q.set('h', hash);
  q.set('title', '0'); q.set('byline', '0'); q.set('portrait', '0'); q.set('dnt', '1');
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `https://player.vimeo.com/video/${id}?${q}`;
}
function vimeoPage(spec) {
  const { id, hash } = vimeoParts(spec);
  return `https://vimeo.com/${id}${hash ? '/' + hash : ''}`;
}
// Film shape for the project page and player, e.g. "2.39 / 1". `ratio:` in info.md wins;
// otherwise Vimeo's oEmbed dimensions; otherwise 16:9 (e.g. building offline).
function parseRatio(v) {
  const m = String(v || '').match(/^\s*(\d+(?:\.\d+)?)\s*[/:x]\s*(\d+(?:\.\d+)?)\s*$/);
  return m && +m[1] > 0 && +m[2] > 0 ? `${m[1]} / ${m[2]}` : '';
}
async function vimeoRatio(spec) {
  try {
    const res = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(vimeoPage(spec))}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return '';
    const { width, height } = await res.json();
    return width && height ? `${width} / ${height}` : '';
  } catch { return ''; }
}
// Filled in at build start for every film and `::: video` / `::: row` clip (see clipSpecs below).
const filmRatios = new Map();
const IMAGE_FILE = /\.(jpe?g|png|webp|gif)$/i;
function embed(spec, title, ratio = '') {
  return `<figure class="embed"><div class="embed-frame"${ratio ? ` style="--video-ratio: ${esc(ratio)}"` : ''}><iframe src="${esc(vimeoSrc(spec))}" title="${esc(title || 'Video')}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>${title ? `<figcaption>${inline(title)}</figcaption>` : ''}</figure>`;
}

// ---------------------------------------------------------------- markdown

// Supports: paragraphs, ## / ### (section label) / #### (subhead), `- ` lists,
// **bold**, *italic*, [links](url), and media blocks:
//   ::: video            one full-width Vimeo video per line:  id[/hash] | title
//   ::: video center     same, centered (for clips narrower than the column)
//   ::: videos 1/1       a grid of Vimeo videos, same line format (ratio optional, default 16/9)
//   ::: images 16/9      a grid of images from the project folder:  file.jpg | alt text | optional caption
//   ::: row              videos and images side by side at equal height (Vimeo line or file.jpg | alt);
//                        a row with one item is capped to the screen height (for tall art); `::: row center` centers it
function markdown(md, ctx = {}) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list.length) { out.push(`<ul>${list.map(li => `<li>${inline(li)}</li>`).join('')}</ul>`); list = []; } };

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const fence = line.match(/^:::\s*(\w+)\s*(.*)$/);
    if (fence) {
      flushPara(); flushList();
      const kind = fence[1];
      const arg = fence[2].trim();
      const items = [];
      n++;
      while (n < lines.length && !/^:::\s*$/.test(lines[n])) {
        if (lines[n].trim()) {
          const [a, ...rest] = lines[n].split('|');
          items.push({ a: a.trim(), b: rest.join('|').trim() });
        }
        n++;
      }
      out.push(mediaBlock(kind, arg, items, ctx));
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const h = line.match(/^(#{2,4})\s+(.*)$/);
    if (h) {
      flushPara(); flushList();
      const cls = { 2: 'h-section', 3: 'h-label', 4: 'h-sub' }[h[1].length];
      const tag = 'h' + h[1].length;
      out.push(`<${tag} class="${cls}">${inline(h[2])}</${tag}>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { flushPara(); list.push(li[1]); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}

// Pixel size of a JPEG or PNG, for laying out `::: row` blocks; null if unreadable.
function imageSize(file) {
  try {
    const b = fs.readFileSync(file);
    if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  } catch {}
  return null;
}
const ratioNumber = r => { const [w, h] = String(r).split('/').map(Number); return w > 0 && h > 0 ? w / h : 16 / 9; };

function mediaBlock(kind, arg, items, ctx) {
  // Image lines are `file.jpg | alt text | optional visible caption`.
  const img = it => `<img src="${esc(ctx.mediaPath ? ctx.mediaPath(it.a) : it.a)}" alt="${esc(it.b.split('|')[0].trim())}" loading="lazy" decoding="async">`;
  const caption = it => { const c = it.b.split('|').slice(1).join('|').trim(); return c ? `<figcaption>${inline(c)}</figcaption>` : ''; };
  if (kind === 'video') return items.map(it => `<div class="media-wide${arg === 'center' ? ' is-centered' : ''}">${embed(it.a, it.b, filmRatios.get(it.a))}</div>`).join('\n');
  if (kind === 'videos') {
    const cols = items.length === 2 || items.length === 4 ? 2 : 3;
    const style = arg ? ` style="--video-ratio: ${esc(arg)}"` : '';
    return `<div class="media-grid cols-${cols}"${style}>${items.map(it => embed(it.a, it.b)).join('')}</div>`;
  }
  if (kind === 'images') {
    const ratio = arg || '4/3';
    const cols = items.length === 1 ? 1 : items.length === 2 || items.length === 4 ? 2 : 3;
    return `<div class="media-grid cols-${cols}" style="--ratio: ${esc(ratio)}">${items.map(it =>
      `<figure class="still"><a href="${esc(ctx.mediaPath ? ctx.mediaPath(it.a) : it.a)}">${img(it)}</a>${caption(it)}</figure>`).join('')}</div>`;
  }
  if (kind === 'row') {
    return `<div class="media-row${arg === 'center' ? ' is-centered' : ''}">${items.map(it => {
      if (IMAGE_FILE.test(it.a)) {
        const size = ctx.folder && imageSize(path.join(ctx.folder, it.a));
        const r = size ? size.w / size.h : 4 / 3;
        return `<div class="media-cell" style="--r: ${r.toFixed(4)}"><figure class="still" style="--ratio: ${r.toFixed(4)}">${img(it)}${caption(it)}</figure></div>`;
      }
      const ratio = filmRatios.get(it.a) || '16 / 9';
      return `<div class="media-cell" style="--r: ${ratioNumber(ratio).toFixed(4)}">${embed(it.a, it.b, ratio)}</div>`;
    }).join('')}</div>`;
  }
  return '';
}

// ---------------------------------------------------------------- content

function loadProjects() {
  const dir = path.join(ROOT, 'projects');
  return fs.readdirSync(dir)
    .filter(name => /^\d+-/.test(name) && fs.statSync(path.join(dir, name)).isDirectory())
    .sort()
    .map(name => {
      const folder = path.join(dir, name);
      const file = path.join(folder, 'info.md');
      if (!fs.existsSync(file)) return null;
      const { data, body } = readDoc(file);
      if (String(data.draft).toLowerCase() === 'true') return null;
      const slug = name.replace(/^\d+-/, '');
      const has = f => f && fs.existsSync(path.join(folder, f));
      const pick = (key, fallback) => (has(data[key]) ? data[key] : has(fallback) ? fallback : '');
      const url = `/work/${slug}/`;
      const media = f => href(url + f);
      return {
        slug, folder, url, data,
        title: data.title || slug,
        tech: data.tech || '',
        description: data.description || '',
        vimeo: data.vimeo || '',
        poster: pick('poster', 'poster.jpg'),
        loop: pick('loop', 'loop.mp4'),
        loopMobile: pick('loop_mobile', 'loop-mobile.mp4'),
        body, mediaPath: media,
      };
    })
    .filter(Boolean);
}

const projects = loadProjects();
// Look up every film's and `::: video` clip's shape before rendering, so wide or tall films aren't letterboxed.
const clipSpecs = p => [...p.body.matchAll(/^:::\s*(?:video|row)\b[^\n]*\n([\s\S]*?)^:::/gm)]
  .flatMap(m => m[1].split('\n').map(l => l.split('|')[0].trim()).filter(a => a && !IMAGE_FILE.test(a)));
await Promise.all([...new Set(projects.flatMap(p => [p.vimeo, ...clipSpecs(p)].filter(Boolean)))]
  .map(async spec => { const r = await vimeoRatio(spec); if (r) filmRatios.set(spec, r); }));
for (const p of projects) {
  p.ratio = parseRatio(p.data.ratio) || filmRatios.get(p.vimeo) || '16 / 9';
  p.bodyHtml = markdown(p.body, { mediaPath: p.mediaPath, folder: p.folder });
  console.log(`  ${p.slug}: ${p.ratio}${clipSpecs(p).map(c => `, ${c}: ${filmRatios.get(c) || '16 / 9'}`).join('')}`);
}
// Asset URLs carry a fingerprint of the file so browsers never run an old copy after an update.
const asset = rel => href(rel) + '?v=' + crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 8);
const YEAR = new Date().getFullYear();
const copyright = () => `<p class="copyright">© ${YEAR} ${esc(site.name)}</p>`;
const about = readDoc(path.join(ROOT, 'content/about.md'));
const contact = readDoc(path.join(ROOT, 'content/contact.md'));

// ---------------------------------------------------------------- layout pieces

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
const CHEVRON = {
  prev: { clip: '60% 10%, 72% 22%, 44% 50%, 72% 78%, 60% 90%, 20% 50%', pts: '60,10 72,22 44,50 72,78 60,90 20,50' },
  next: { clip: '40% 10%, 80% 50%, 40% 90%, 28% 78%, 56% 50%, 28% 22%', pts: '40,10 80,50 40,90 28,78 56,50 28,22' },
};
const arrow = (dir, label) => `<button type="button" class="arrow arrow-${dir}" data-go="${dir}" aria-label="${label}">
  <span class="glass-chevron" aria-hidden="true">
    <span class="glass-fill" style="clip-path: polygon(${CHEVRON[dir].clip})"></span>
    <svg viewBox="0 0 100 100"><polygon points="${CHEVRON[dir].pts}"></polygon></svg>
  </span>
</button>`;

function head({ title, description, url, image, jsonld = [] }) {
  const img = image ? abs(image) : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(abs(url))}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(abs(url))}">
${img ? `<meta property="og:image" content="${esc(img)}">\n<meta name="twitter:image" content="${esc(img)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0A1236">
<link rel="icon" href="${href('/assets/favicon.svg')}" type="image/svg+xml">
<link rel="preload" href="${href('/assets/fonts/inter-tight-latin.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset('/assets/site.css')}">
<link rel="preconnect" href="https://player.vimeo.com">
${jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>`;
}

const orgLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': abs('/#organization'),
  name: site.name,
  url: abs('/'),
  email: site.email,
  description: site.description,
  slogan: site.tagline,
  founder: site.founders.map(name => ({ '@type': 'Person', name })),
  sameAs: Object.values(site.social),
});

// Sheets are hidden until opened, and browsers still fetch "lazy" media sitting just off-screen,
// so their images and Vimeo players carry data-src and only load when the sheet opens (site.js).
const deferMedia = html => html.replace(/(<(?:img|iframe)\b[^>]*?)\ssrc=/g, '$1 data-src=');
const sheetShell = (id, label, inner) => `<section class="sheet" id="sheet-${id}" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">
  <button type="button" class="sheet-close" data-close>Close <span aria-hidden="true">↓</span></button>
  <div class="sheet-inner">
${deferMedia(inner)}
  </div>
</section>`;

const socialLinks = () => Object.entries(site.social)
  .map(([k, u]) => `<a href="${esc(u)}">${esc(k)}</a>`).join('');

// ---------------------------------------------------------------- pages

const infoSheet = (p, id) => sheetShell(id, `About ${p.title}`, `    <h2 class="sheet-title">${inline(p.title)}</h2>
    <div class="prose info-body">
${p.bodyHtml}
    </div>`);

function homePage() {
  const slides = projects.map(p => ({
    slug: p.slug,
    title: p.title,
    page: href(p.url),
    poster: p.poster ? href(p.url + p.poster) : '',
    loop: p.loop ? href(p.url + p.loop) : '',
    loopMobile: p.loopMobile ? href(p.url + p.loopMobile) : '',
    film: p.vimeo ? vimeoSrc(p.vimeo, { autoplay: '1' }) : '',
    ratio: p.ratio,
  }));
  const first = projects[0];

  const aboutBody = about.body.split(/\n(?=###\s)/);
  const intro = aboutBody[0];
  const bios = aboutBody.slice(1).map(b => {
    const [hl, ...rest] = b.split('\n');
    return `<div class="bio"><h3>${inline(hl.replace(/^###\s+/, ''))}</h3>${markdown(rest.join('\n'))}</div>`;
  }).join('');

  const contactHeading = (contact.data.heading_lines || [contact.data.heading || 'Contact']).map(inline).join('<br>');

  const workSheet = sheetShell('work', 'Featured work', `    <h2 class="sheet-title">Featured work</h2>
    <ol class="work-list">
${projects.map((p, k) => `      <li><a class="work-item" href="${href(p.url)}" data-index="${k}"><span class="wi-title">${inline(p.title)}</span><span class="wi-tech">${esc(p.tech)}</span></a></li>`).join('\n')}
    </ol>`);

  const aboutSheet = sheetShell('about', 'About', `    <h2 class="sheet-title">${inline(about.data.heading || 'About')}</h2>
    <div class="prose">${markdown(intro)}</div>
    ${about.data.photo ? `<img class="about-photo" src="${href('/content/' + about.data.photo)}" alt="${esc(about.data.photo_alt || '')}" loading="lazy" decoding="async">` : ''}
    <div class="bios">${bios}</div>
    <div class="link-row"><a class="strong" href="mailto:${esc(site.email)}">${esc(site.email)}</a>${socialLinks()}</div>
    ${copyright()}`);

  const contactSheet = sheetShell('contact', 'Contact', `    <h2 class="sheet-title">${contactHeading}</h2>
    <div class="prose">${markdown(contact.body)}</div>
    <a class="email-button" href="mailto:${esc(site.email)}">${esc(site.email)}</a>
    <div class="link-row">${socialLinks()}</div>
    ${copyright()}`);

  const jsonld = [
    orgLd(),
    { '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: abs('/'), publisher: { '@id': abs('/#organization') } },
    {
      '@context': 'https://schema.org', '@type': 'ItemList', name: 'Featured work',
      itemListElement: projects.map((p, k) => ({ '@type': 'ListItem', position: k + 1, url: abs(p.url), name: p.title })),
    },
  ];

  return `${head({ title: `${site.name} — ${site.tagline}`, description: site.description, url: '/', image: first && first.poster ? first.url + first.poster : '', jsonld })}
<body class="home">
<a class="skip" href="#sheet-work" data-sheet="work">Skip to the list of work</a>
<main class="stage" id="stage" aria-label="Featured work">
  <h1 class="visually-hidden">${esc(site.name)}: ${esc(site.tagline)}</h1>
  <div class="slides">
${slides.map((s, k) => `    <div class="slide${k === 0 ? ' is-active' : ''}" data-index="${k}">${s.poster ? `<img class="slide-poster" ${k === 0 ? 'src' : 'data-src'}="${s.poster}" alt=""${k === 0 ? ' fetchpriority="high"' : ''} decoding="async">` : ''}</div>`).join('\n')}
  </div>
  <button type="button" class="stage-hit" data-play aria-label="Play ${esc(first ? first.title : 'film')}"></button>
  <header class="topbar">
    <a class="logo" href="${href('/')}" aria-label="${esc(site.name)}, home"><span class="logo-mark" aria-hidden="true"></span><span class="visually-hidden">${esc(site.name)}</span></a>
    <nav class="top-nav" aria-label="Main">
      <a href="#work" data-sheet="work">Menu</a>
      <a href="#about" data-sheet="about">About</a>
      <a href="#contact" data-sheet="contact">Contact</a>
    </nav>
  </header>
  ${arrow('prev', 'Previous project')}
  ${arrow('next', 'Next project')}
  <footer class="bottombar">
    <div class="bb-left">
      <button type="button" class="glass-circle play-btn" data-play aria-label="Play film">${ICON_PLAY}</button>
      <span class="now-title" data-title aria-live="polite">${inline(first ? first.title : '')}</span>
    </div>
    <a class="glass-pill" href="${first ? href(first.url) : '#'}" data-page${first ? ` data-sheet="info-${first.slug}"` : ''}>Project info</a>
    <span class="counter" aria-hidden="true"><span data-counter>01</span> / ${String(projects.length).padStart(2, '0')}</span>
  </footer>
</main>

<div class="player" role="dialog" aria-modal="true" aria-label="Film player" hidden>
  <button type="button" class="overlay-close" data-close-player>Close <span aria-hidden="true">✕</span></button>
  <div class="player-frame"></div>
  <p class="player-title" data-player-title></p>
</div>

<div class="scrim" data-close></div>
${workSheet}
${aboutSheet}
${contactSheet}
${projects.map(p => infoSheet(p, 'info-' + p.slug)).join('\n')}

<script id="slides-data" type="application/json">${JSON.stringify(slides).replace(/</g, '\\u003c')}</script>
<script src="${asset('/assets/site.js')}" defer></script>
</body>
</html>
`;
}

function projectPage(p, k) {
  const next = projects[(k + 1) % projects.length];
  const prev = projects[(k - 1 + projects.length) % projects.length];
  const posterUrl = p.poster ? href(p.url + p.poster) : '';
  const jsonld = [orgLd()];
  if (p.vimeo) {
    jsonld.push({
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: p.title,
      description: p.description || p.title,
      thumbnailUrl: p.poster ? abs(p.url + p.poster) : undefined,
      embedUrl: vimeoSrc(p.vimeo),
      url: abs(p.url),
      ...(p.data.date ? { uploadDate: p.data.date } : {}),
      creator: { '@id': abs('/#organization') },
      publisher: { '@id': abs('/#organization') },
      ...(p.data.client ? { sourceOrganization: { '@type': 'Organization', name: p.data.client } } : {}),
    });
  }
  jsonld.push({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: site.name, item: abs('/') },
      { '@type': 'ListItem', position: 2, name: p.title, item: abs(p.url) },
    ],
  });

  return `${head({ title: `${p.title} — ${site.name}`, description: p.description || site.description, url: p.url, image: p.poster ? p.url + p.poster : '', jsonld })}
<body class="project">
<header class="page-header">
  <a class="logo" href="${href('/')}" aria-label="${esc(site.name)}, home"><span class="logo-mark" aria-hidden="true"></span><span class="visually-hidden">${esc(site.name)}</span></a>
  <nav aria-label="Main"><a href="${href('/')}">Work</a><a href="${href('/#about')}">About</a><a href="${href('/#contact')}">Contact</a></nav>
</header>
<main class="project-main">
  <div class="film" style="--ratio: ${p.ratio}"${p.vimeo ? ` data-film="${esc(vimeoSrc(p.vimeo, { autoplay: '1' }))}"` : ''}>
    ${posterUrl ? `<img class="film-poster" src="${posterUrl}" alt="${esc(p.title)}" fetchpriority="high" decoding="async">` : ''}
    ${p.vimeo
      ? `<button type="button" class="film-hit" data-film-play aria-label="Play ${esc(p.title)}"><span class="glass-circle big">${ICON_PLAY}</span></button>`
      : `<span class="film-soon">Film coming soon</span>`}
  </div>
  <div class="project-titlebar">
    <h1>${inline(p.title)}</h1>
    <button type="button" class="outline-pill" data-sheet="info" aria-controls="sheet-info">Project info <span aria-hidden="true">↑</span></button>
  </div>
  <nav class="project-nav" aria-label="More work">
    <a href="${href(prev.url)}" rel="prev">← ${inline(prev.title)}</a>
    <a href="${href(next.url)}" rel="next">${inline(next.title)} →</a>
  </nav>
  <footer class="page-footer">${copyright()}</footer>
</main>

<div class="scrim" data-close></div>
${infoSheet(p, 'info')}
<script src="${asset('/assets/site.js')}" defer></script>
</body>
</html>
`;
}

function redirectPage(to) {
  const target = href(to);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved</title>
<link rel="canonical" href="${esc(abs(to))}"><meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)})</script></head>
<body><p>This page moved to <a href="${esc(target)}">${esc(abs(to))}</a>.</p></body></html>
`;
}

function notFoundPage() {
  return `${head({ title: `Page not found — ${site.name}`, description: site.description, url: '/404.html' })}
<body class="plain">
<main class="plain-main">
  <p class="eyebrow">404</p>
  <h1>That page wandered off.</h1>
  <p>It may have moved when we rebuilt the site.</p>
  <p><a class="email-button" href="${href('/')}">See the work</a></p>
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------- write

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function copyDir(src, dest, filter = () => true) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dest, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d, filter);
    else if (filter(f)) fs.copyFileSync(s, d);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

write('index.html', homePage());
projects.forEach((p, k) => {
  write(`work/${p.slug}/index.html`, projectPage(p, k));
  copyDir(p.folder, path.join(OUT, 'work', p.slug), f => !f.endsWith('.md'));
});
copyDir(path.join(ROOT, 'assets'), path.join(OUT, 'assets'));
copyDir(path.join(ROOT, 'content'), path.join(OUT, 'content'), f => !f.endsWith('.md'));

for (const [from, to] of Object.entries(site.redirects || {})) {
  write(path.join(from.replace(/^\/+/, ''), 'index.html'), redirectPage(to));
}
write('404.html', notFoundPage());
write('.nojekyll', '');
if (site.domain) write('CNAME', site.domain + '\n');

const urls = ['/', ...projects.map(p => p.url)];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${esc(abs(u))}</loc></url>`).join('\n')}
</urlset>
`);
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
write('llms.txt', `# ${site.name}

> ${site.description}

- Directors: ${site.founders.join(' and ')}
- Contact: ${site.email}
- Tagline: ${site.tagline}

## Featured work

${projects.map(p => `- [${p.title}](${abs(p.url)}): ${p.description}`).join('\n')}

## About

- [About ${site.name}](${abs('/#about')})
- [Contact](${abs('/#contact')})
`);

console.log(`Built ${projects.length} projects into _site/ (base path "${BASE || '/'}").`);
