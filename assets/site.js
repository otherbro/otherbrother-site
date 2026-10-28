// Other Brother — homepage slideshow, film player and pop-up sheets.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isPhone = () => window.matchMedia('(max-width: 820px)').matches;

  // ------------------------------------------------------------ sheets
  let openSheetEl = null;
  let lastFocus = null;
  const listeners = [];
  const onSheetChange = fn => listeners.push(fn);

  function openSheet(name, { updateHash = true } = {}) {
    const el = document.getElementById('sheet-' + name);
    if (!el) return;
    if (openSheetEl && openSheetEl !== el) openSheetEl.classList.remove('is-open');
    lastFocus = document.activeElement;
    openSheetEl = el;
    $$('iframe[data-src]', el).forEach(f => { f.src = f.dataset.src; f.removeAttribute('data-src'); });
    el.classList.add('is-open');
    document.body.classList.add('sheet-open');
    if (updateHash) history.replaceState(null, '', '#' + name);
    // phones hide the Close button (swipe down instead), so focus the sheet itself there
    setTimeout(() => { const c = $('.sheet-close', el); (c && c.offsetParent ? c : el).focus({ preventScroll: true }); }, 50);
    listeners.forEach(fn => fn(name));
  }
  function closeSheet() {
    if (!openSheetEl) return;
    openSheetEl.classList.remove('is-open');
    // stop any video still playing inside the sheet
    $$('iframe', openSheetEl).forEach(f => { try { f.contentWindow.postMessage('{"method":"pause"}', '*'); } catch (e) {} });
    document.body.classList.remove('sheet-open');
    openSheetEl = null;
    history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    listeners.forEach(fn => fn(null));
  }

  document.addEventListener('click', e => {
    const opener = e.target.closest('[data-sheet]');
    if (opener) { e.preventDefault(); openSheet(opener.dataset.sheet); return; }
    if (e.target.closest('[data-close]')) { e.preventDefault(); closeSheet(); }
  });

  // Swipe an open sheet down to close it. The drag only starts when the sheet is scrolled
  // to the top, so swiping down inside a long sheet still scrolls it first.
  let drag = null;
  document.addEventListener('touchstart', e => {
    const sheet = e.target.closest('.sheet.is-open');
    drag = sheet && sheet.scrollTop <= 0 ? { sheet, x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dy: 0, active: false } : null;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!drag) return;
    const dx = e.touches[0].clientX - drag.x;
    const dy = e.touches[0].clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (dy <= Math.abs(dx) || drag.sheet.scrollTop > 0) { drag = null; return; }
      drag.active = true;
      drag.sheet.style.transition = 'none';
    }
    e.preventDefault();
    drag.dy = Math.max(0, dy);
    drag.sheet.style.transform = `translateY(${drag.dy}px)`;
  }, { passive: false });
  const endDrag = () => {
    if (!drag) return;
    const { sheet, dy, t, active } = drag;
    drag = null;
    if (!active) return;
    sheet.style.transition = '';
    sheet.style.transform = '';
    const fast = dy / Math.max(1, Date.now() - t) > 0.5;
    if (dy > 100 || (fast && dy > 30)) closeSheet();
  };
  document.addEventListener('touchend', endDrag);
  document.addEventListener('touchcancel', endDrag);

  // ------------------------------------------------------------ photo viewer
  // Photos in write-ups open over the page instead of navigating to the bare image file.
  let lightbox = null;
  let lightboxReturn = null;
  function openLightbox(link) {
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.className = 'lightbox';
      lightbox.setAttribute('role', 'dialog');
      lightbox.setAttribute('aria-modal', 'true');
      lightbox.setAttribute('aria-label', 'Photo');
      lightbox.hidden = true;
      lightbox.innerHTML = '<button type="button" class="lightbox-close">Close <span aria-hidden="true">✕</span></button><img alt="">';
      lightbox.addEventListener('click', e => { if (e.target.tagName !== 'IMG') closeLightbox(); });
      document.body.appendChild(lightbox);
    }
    const img = $('img', link);
    $('img', lightbox).src = link.href;
    $('img', lightbox).alt = img ? img.alt : '';
    lightboxReturn = link;
    lightbox.hidden = false;
    $('.lightbox-close', lightbox).focus({ preventScroll: true });
  }
  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return false;
    lightbox.hidden = true;
    $('img', lightbox).removeAttribute('src');
    if (lightboxReturn) lightboxReturn.focus({ preventScroll: true });
    return true;
  }
  document.addEventListener('click', e => {
    const link = e.target.closest('.still a');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    openLightbox(link);
  });

  // ------------------------------------------------------------ project page film
  const film = $('.film[data-film]');
  if (film) {
    $('[data-film-play]', film).addEventListener('click', () => {
      const f = document.createElement('iframe');
      f.src = film.dataset.film;
      f.allow = 'autoplay; fullscreen; picture-in-picture';
      f.allowFullscreen = true;
      f.title = document.title;
      film.innerHTML = '';
      film.appendChild(f);
    });
  }

  // ------------------------------------------------------------ homepage
  const dataEl = $('#slides-data');
  let player = null;
  let closePlayer = () => {};
  if (dataEl) {
    const slides = JSON.parse(dataEl.textContent);
    const slideEls = $$('.slide');
    const counterEl = $('[data-counter]');
    const titleEl = $('[data-title]');
    const pageLink = $('[data-page]');
    const playButtons = $$('[data-play]');
    const workItems = $$('.work-item');
    player = $('.player');
    const playerFrame = $('.player-frame');
    const playerTitle = $('[data-player-title]');
    const durations = {};
    const pad = n => String(n).padStart(2, '0');
    let i = 0;
    let timer = null;

    const paused = () => !!openSheetEl || !player.hidden || document.hidden || reduceMotion;
    const slideMs = k => (durations[k] && isFinite(durations[k]) && durations[k] > 1 ? durations[k] * 2000 : 6000); // each loop plays twice

    function restartTimer() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!paused()) show((i + 1) % slides.length);
        else restartTimer();
      }, slideMs(i));
    }

    function setLoop(k) {
      slideEls.forEach((el, n) => { if (n !== k) { const v = $('video', el); if (v) v.remove(); } });
      const s = slides[k];
      const src = isPhone() ? (s.loopMobile || s.loop) : (s.loop || s.loopMobile);
      if (!src || reduceMotion) return;
      const el = slideEls[k];
      const v = document.createElement('video');
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = true; v.autoplay = true;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('autoplay', ''); v.setAttribute('aria-hidden', 'true');
      v.preload = 'auto';
      if (s.poster) v.poster = s.poster;
      v.addEventListener('loadedmetadata', () => { durations[k] = v.duration; if (k === i) restartTimer(); });
      v.src = src;
      el.appendChild(v);
      v.play().catch(() => {});
    }

    function show(k) {
      i = (k + slides.length) % slides.length;
      const s = slides[i];
      slideEls.forEach((el, n) => el.classList.toggle('is-active', n === i));
      counterEl.textContent = pad(i + 1);
      titleEl.textContent = s.title;
      pageLink.href = s.page;
      pageLink.dataset.sheet = 'info-' + s.slug;
      playButtons.forEach(b => b.setAttribute('aria-label', (s.film ? 'Play ' : 'Open ') + s.title));
      workItems.forEach((a, n) => a.setAttribute('aria-current', n === i ? 'true' : 'false'));
      setLoop(i);
      restartTimer();
    }

    function openPlayer() {
      const s = slides[i];
      if (!s.film) { location.href = s.page; return; }
      playerFrame.innerHTML = '';
      const f = document.createElement('iframe');
      f.src = s.film; f.allow = 'autoplay; fullscreen; picture-in-picture'; f.allowFullscreen = true; f.title = s.title;
      playerFrame.appendChild(f);
      playerTitle.textContent = s.title;
      playerFrame.style.setProperty('--ratio', s.ratio || '16 / 9');
      player.style.setProperty('--player-bg', s.poster ? `url("${s.poster}")` : 'none');
      player.hidden = false;
      const v = $('video', slideEls[i]); if (v) v.pause();
      $('[data-close-player]').focus();
    }
    closePlayer = () => {
      if (player.hidden) return;
      player.hidden = true;
      playerFrame.innerHTML = '';
      const v = $('video', slideEls[i]); if (v) v.play().catch(() => {});
      restartTimer();
    };

    // iPhones in Low Power Mode (and some data-saving settings) refuse muted autoplay
    // but allow playback after a touch, so the first tap or swipe starts the loop.
    const resumeLoop = () => {
      if (openSheetEl || !player.hidden || reduceMotion) return;
      const v = $('video', slideEls[i]);
      if (v && v.paused) v.play().catch(() => {});
    };
    document.addEventListener('touchend', resumeLoop, { passive: true });
    document.addEventListener('click', resumeLoop);

    playButtons.forEach(b => b.addEventListener('click', openPlayer));
    $('[data-close-player]').addEventListener('click', closePlayer);
    $$('[data-go]').forEach(b => b.addEventListener('click', () => show(i + (b.dataset.go === 'next' ? 1 : -1))));
    workItems.forEach(a => a.addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      closeSheet();
      show(Number(a.dataset.index));
    }));

    // swipe left / right on phones
    let touchX = null, touchY = null;
    const stage = $('#stage');
    stage.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', e => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      const dy = e.changedTouches[0].clientY - touchY;
      touchX = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(i + (dx < 0 ? 1 : -1));
    });

    document.addEventListener('keydown', e => {
      if (openSheetEl || !player.hidden) return;
      if (e.key === 'ArrowRight') show(i + 1);
      if (e.key === 'ArrowLeft') show(i - 1);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) restartTimer(); });
    onSheetChange(name => { if (!name) restartTimer(); });

    // deep link like /#info-catcher starts on that project
    const startSlug = location.hash.startsWith('#info-') ? location.hash.slice(6) : '';
    show(Math.max(0, slides.findIndex(s => s.slug === startSlug)));
  }

  // ------------------------------------------------------------ keyboard + deep links
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (closeLightbox()) return;
    if (player && !player.hidden) closePlayer();
    else closeSheet();
  });
  const fromHash = location.hash.replace('#', '');
  if (fromHash && document.getElementById('sheet-' + fromHash)) openSheet(fromHash, { updateHash: false });
})();
