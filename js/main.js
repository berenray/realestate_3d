/* ============================================================
   Real Estate — інтерактив
   Секції: навігація, поява, слоти відео, scroll scrub,
           карусель відгуків, форма, путівник районами
   ============================================================ */
(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. Навігація ---------- */
  const nav = $('#nav');
  if (nav) {
    // поки видно hero-відео, шапка залишається прозорою
    const hero = $('.hero');
    const solidAt = () => (hero ? hero.offsetHeight - innerHeight * 0.35 : 40);
    const onScroll = () => nav.classList.toggle('is-solid', window.scrollY > solidAt());
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });

    const burger = $('#burger');
    burger?.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      nav.classList.add('is-solid');
      burger.setAttribute('aria-expanded', String(open));
    });
    $$('.nav__links a').forEach(a => a.addEventListener('click', () => {
      nav.classList.remove('is-open');
      burger?.setAttribute('aria-expanded', 'false');
    }));
  }

  /* ---------- 2. Поява секцій ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
  $$('.reveal').forEach(el => io.observe(el));

  /* ---------- 3. Слоти відео ----------
     Cloudflare Workers Assets не віддає Range-запити (на `Range:` повертає 200 і
     файл цілком, без 206). Safari без 206 не програє <video>, а scroll scrub без
     діапазонів не може перемотуватись. Тому тягнемо файл одним запитом і віддаємо
     через blob: URL — перемотування стає миттєвим, бо файл уже в пам'яті.
     Заглушка лежить під відео і зникає лише коли кадр справді готовий. */
  $$('[data-video-slot]').forEach(slot => {
    const video = $('video', slot);
    const fallback = $('[data-slot-fallback]', slot);
    if (!video || !fallback) return;

    const source = $('source', video);
    const src = source ? source.getAttribute('src') : video.getAttribute('src');
    let settled = false;

    const ready = () => {
      if (settled) return;
      settled = true;
      fallback.remove();
      slot.classList.add('has-video');
    };
    const missing = () => {
      if (settled) return;
      settled = true;
      video.hidden = true;
      slot.classList.add('no-video');
    };

    ['loadedmetadata', 'loadeddata', 'canplay'].forEach(e => video.addEventListener(e, ready, { once: true }));
    video.addEventListener('error', missing);

    if (!src) { missing(); return; }

    // знімаємо нативне джерело до того, як браузер його потягне:
    // інакше файл качається двічі, а в Safari невдала нативна спроба
    // ховає відео ще до того, як приїде blob
    if (source) source.remove();
    video.removeAttribute('src');
    video.load();

    const load = () => {
      slot.classList.add('is-loading');
      fetch(src)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
        .then(blob => {
          if (source) source.remove();
          video.src = URL.createObjectURL(blob);
          video.load();
          slot.classList.remove('is-loading');
        })
        .catch(() => { slot.classList.remove('is-loading'); missing(); });
    };

    // качаємо, лише коли секція близько до екрана — щоб не тягнути всі відео одразу.
    // Перевіряємо позицію самі, а не через IntersectionObserver: його виклики
    // браузер може відкладати, і тоді відео не завантажилось би зовсім.
    let requested = false;
    const maybeLoad = () => {
      if (requested) return;
      const r = slot.getBoundingClientRect();
      if (r.top > innerHeight * 2.5 || r.bottom < -innerHeight) return;
      requested = true;
      removeEventListener('scroll', maybeLoad);
      removeEventListener('resize', maybeLoad);
      load();
    };
    addEventListener('scroll', maybeLoad, { passive: true });
    addEventListener('resize', maybeLoad);
    maybeLoad();
  });

  /* ---------- 4. Заглушки фото ---------- */
  $$('.ph > img').forEach(img => {
    const fail = () => img.parentElement.classList.add('is-empty');
    img.addEventListener('error', fail);
    if (img.complete && img.naturalWidth === 0) fail();
  });

  /* ---------- 5. Scroll scrub: відео прив'язане до скролу ---------- */
  $$('[data-scrub]').forEach(section => {
    const video = $('[data-scrub-video]', section);
    const bar = $('[data-scrub-progress]', section);
    const stages = $$('[data-stage]', section);

    let target = 0, current = 0, duration = 0, raf = null;

    const progress = () => {
      const r = section.getBoundingClientRect();
      const total = r.height - innerHeight;
      return total <= 0 ? 0 : clamp(-r.top / total, 0, 1);
    };

    // плавне наздоганяння цільового кадру — без ривків при різкому скролі
    const paint = () => {
      raf = null;
      current += (target - current) * (reduced ? 1 : 0.12);
      if (video && duration) {
        const t = current * (duration - 0.05);
        if (Math.abs(video.currentTime - t) > 0.01) {
          try { video.currentTime = t; } catch (_) {}
        }
      }
      if (Math.abs(target - current) > 0.0005) raf = requestAnimationFrame(paint);
    };

    const tick = () => {
      target = progress();
      // індикатор і текстові блоки оновлюються одразу — без залежності від rAF
      if (bar) bar.style.width = (target * 100).toFixed(2) + '%';
      stages.forEach(el => {
        const from = parseFloat(el.dataset.from || 0);
        const to = parseFloat(el.dataset.to || 1);
        el.classList.toggle('is-on', target >= from && target <= to);
      });
      if (video && duration && raf === null) raf = requestAnimationFrame(paint);
    };

    if (video) {
      video.pause();
      const meta = () => {
        duration = video.duration || 0;
        video.pause();
        tick();
      };
      if (video.readyState >= 1) meta();
      else video.addEventListener('loadedmetadata', meta, { once: true });
    }

    addEventListener('scroll', tick, { passive: true });
    addEventListener('resize', tick);
    tick();
  });

  /* ---------- 5b. Порівняння «до / після»: межу веде курсор, палець або клавіші ---------- */
  $$('[data-wipe]').forEach(el => {
    const handle = $('[data-wipe-handle]', el);
    let value = 50;

    const apply = (v) => {
      value = clamp(v, 0, 100);
      el.style.setProperty('--w', value.toFixed(2));
      if (handle) {
        handle.setAttribute('aria-valuenow', Math.round(value));
        handle.setAttribute('aria-valuetext', Math.round(value) + '% — частка кадру «до»');
      }
    };
    const fromPointer = (e) => {
      const r = el.getBoundingClientRect();
      apply(((e.clientX - r.left) / r.width) * 100);
    };

    apply(value);

    // миша: межа просто йде за курсором, без затискання
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && !el.classList.contains('is-dragging')) fromPointer(e);
    });

    // палець / перо / затиснута миша: перетягування
    el.addEventListener('pointerdown', (e) => {
      el.classList.add('is-dragging');
      el.setPointerCapture?.(e.pointerId);
      fromPointer(e);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (el.classList.contains('is-dragging')) { fromPointer(e); e.preventDefault(); }
    });
    const stop = (e) => {
      if (!el.classList.contains('is-dragging')) return;
      el.classList.remove('is-dragging');
      el.releasePointerCapture?.(e.pointerId);
    };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);

    // клавіатура
    handle?.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 3;
      const map = { ArrowLeft: -step, ArrowRight: step, Home: -100, End: 100 };
      if (!(e.key in map)) return;
      apply(e.key === 'Home' ? 0 : e.key === 'End' ? 100 : value + map[e.key]);
      e.preventDefault();
    });
  });

  /* ---------- 6. Карусель відгуків ---------- */
  const track = $('#tstTrack');
  if (track) {
    const step = () => {
      const card = $('.tst__card', track);
      const gap = parseFloat(getComputedStyle(track).gap) || 28;
      return card ? card.getBoundingClientRect().width + gap : 380;
    };
    const prev = $('[data-tst="prev"]'), next = $('[data-tst="next"]');
    const sync = () => {
      const max = track.scrollWidth - track.clientWidth - 2;
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= max;
    };
    prev?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    next?.addEventListener('click', () => track.scrollBy({ left:  step(), behavior: 'smooth' }));
    track.addEventListener('scroll', sync, { passive: true });
    addEventListener('resize', sync);
    sync();
  }

  /* ---------- 7. Форма (заглушка сабміту) ---------- */
  const form = $('#contactForm');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    // TODO: підключити реальний обробник — Formspree / Telegram-бот / власний бекенд
    if (!form.reportValidity()) return;
    $('#formOk')?.classList.add('is-visible');
    form.reset();
  });

  /* ---------- 8. Календар (плейсхолдер Calendly) ---------- */
  $$('[data-calendly]').forEach(btn => btn.addEventListener('click', (e) => {
    e.preventDefault();
    // TODO: замінити href на реальне посилання Calendly / Google Calendar
    alert('Тут відкриється календар бронювання (Calendly). Замініть посилання у кнопці data-calendly.');
  }));

  /* ---------- 9. Путівник районами: розкриття панелі ---------- */
  $$('[data-hood]').forEach(card => card.addEventListener('click', () => {
    const hood = card.closest('.hood');
    const panel = $('#' + card.getAttribute('aria-controls'));
    const open = panel.classList.contains('is-open');
    $$('.hood__panel').forEach(p => p.classList.remove('is-open'));
    $$('.hood').forEach(h => h.classList.remove('is-open'));
    $$('[data-hood]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    if (!open) {
      panel.classList.add('is-open');
      hood.classList.add('is-open');
      card.setAttribute('aria-expanded', 'true');
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }));

  /* ---------- 10. Рік у футері ---------- */
  const y = $('#year');
  if (y) y.textContent = new Date().getFullYear();
})();
