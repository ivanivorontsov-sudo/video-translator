// Переводчик видео — оверлей субтитров и чтение готовых субтитров (YouTube, <track>).
(() => { if (window.__vtLoaded) return; window.__vtLoaded = true;
let cfg = null, box, timer, watch = null, ducked = new Map(), lastOrig = '', ctxPrev = '';
const send = m => chrome.runtime.sendMessage(m).catch(e => ({error: e.message}));
const bigVideo = () => [...document.querySelectorAll('video')].filter(v => v.offsetWidth > 100).sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0];
function ui() {
  if (!box) { box = document.createElement('div'); box.id = 'vt-overlay'; box.innerHTML = '<div class="vt-o"></div><div class="vt-t"></div><div class="vt-l"></div>';
    const st = document.createElement('style'); st.textContent = `#vt-overlay{position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);max-width:90vw;text-align:center;pointer-events:none;font-family:system-ui,Arial,sans-serif}
      #vt-overlay .vt-t,#vt-overlay .vt-o{display:table;margin:0 auto;padding:.15em .5em;border-radius:6px;line-height:1.3;white-space:pre-wrap}#vt-overlay .vt-o{opacity:.8;font-size:.7em;margin-bottom:.2em}
      #vt-overlay .vt-l{font-size:11px;opacity:.7;margin-top:2px}#vt-overlay .vt-o:empty,#vt-overlay .vt-t:empty{display:none}
      html.vt-hide-native .ytp-caption-window-container{opacity:0!important}`;
    document.documentElement.append(st); }
  const host = document.fullscreenElement || document.documentElement; if (box.parentNode !== host) host.append(box);
  const c = cfg || {}, v = bigVideo(), r = v?.getBoundingClientRect();
  box.style.bottom = r && r.height ? Math.max(8, innerHeight - r.bottom + r.height * (c.pos ?? 12) / 100) + 'px' : '10%';
  box.style.fontSize = (c.font || 26) + 'px'; box.style.color = c.color || '#fff';
  for (const el of box.querySelectorAll('.vt-t,.vt-o')) { el.style.background = `rgba(0,0,0,${c.bgA ?? .65})`; el.style.textShadow = '0 0 3px #000'; }
  box.style.display = ''; return box;
}
function show(orig, text, latency, final, engine) { const b = ui();
  b.querySelector('.vt-o').textContent = cfg?.showOrig ? orig : ''; b.querySelector('.vt-t').textContent = text;
  b.querySelector('.vt-l').textContent = latency != null ? `задержка ${(latency / 1000).toFixed(1)} с · ${engine || ''}${final ? '' : ' · черновик'}` : '';
  clearTimeout(timer); timer = setTimeout(() => { if (box) { box.querySelector('.vt-t').textContent = ''; box.querySelector('.vt-o').textContent = ''; box.querySelector('.vt-l').textContent = ''; } }, 7000); }
function duck(on) { for (const m of document.querySelectorAll('video,audio')) { if (on) { if (!ducked.has(m)) { ducked.set(m, m.volume); m.volume = m.volume * (cfg?.duck ?? .2); } } else if (ducked.has(m)) { m.volume = ducked.get(m); ducked.delete(m); } } }
async function handleCaption(orig, t0) { orig = orig.replace(/\s+/g, ' ').trim(); if (!orig || orig === lastOrig) return; lastOrig = orig;
  if (cfg.prof) orig = VTC.mask(orig);
  const r = await send({cmd: 'vt.translate', text: orig, ctx: ctxPrev}); ctxPrev = orig; if (!r || r.error) return show(orig, '⚠ ' + (r?.error || 'нет ответа'), null);
  show(orig, r.text, performance.now() - t0, true, 'субтитры→' + cfg.tr); if (cfg.mode !== 'subs') send({cmd: 'vt.speak', text: r.text}); }
// ---- YouTube: читаем отрисованные субтитры; автосубтитры приходят по словам, поэтому ждём законченную фразу ----
function youtube() { const btn = document.querySelector('.ytp-subtitles-button'); if (!btn || btn.style.display === 'none' || btn.getAttribute('aria-disabled') === 'true') return false;
  if (btn.getAttribute('aria-pressed') !== 'true') btn.click();
  document.documentElement.classList.add('vt-hide-native');
  // автосубтитры YouTube — «скользящее окно» слов: склеиваем окна по перекрытию и режем на предложения
  let acc = [], sentN = 0, t0 = 0, deb, last = '';
  const read = () => [...document.querySelectorAll('.ytp-caption-segment')].map(e => e.textContent).join(' ').replace(/\s+/g, ' ').trim();
  const norm = w => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  const merge = W => { const max = Math.min(acc.length, W.length); let k = 0;
    for (let n = max; n > 0; n--) { let okk = true; for (let j = 0; j < n; j++) if (norm(acc[acc.length - n + j]) !== norm(W[j])) { okk = false; break; } if (okk) { k = n; break; } }
    if (!k && acc.length && acc.slice(-40).map(norm).join(' ').includes(W.map(norm).join(' '))) return; acc.push(...W.slice(k)); };
  const emit = all => { let end = acc.length; if (!all) { end = -1; for (let i = acc.length - 1; i >= sentN; i--) if (/[.!?…]["»)]?$/.test(acc[i])) { end = i + 1; break; } if (end < 0) return; }
    if (end <= sentN) return; const piece = acc.slice(sentN, end).join(' '); sentN = end; if (acc.length > 400) { acc = acc.slice(sentN); sentN = 0; } handleCaption(piece, t0); t0 = performance.now(); };
  const mo = new MutationObserver(() => { const t = read(); if (!t || t === last) return; if (sentN >= acc.length) t0 = performance.now(); last = t; merge(t.split(' '));
    clearTimeout(deb); emit(false); if (acc.length - sentN > 16) emit(true); else deb = setTimeout(() => emit(true), 1000); });
  mo.observe(document.querySelector('#movie_player') || document.body, {subtree: true, childList: true, characterData: true});
  watch = () => { mo.disconnect(); document.documentElement.classList.remove('vt-hide-native'); }; return true; }
// ---- Любые <video>/<audio> с <track> / textTracks ----
function tracks() { const media = [...document.querySelectorAll('video,audio')].filter(m => m.textTracks?.length); if (!media.length) return false;
  const offs = []; for (const m of media) { const tr = [...m.textTracks].find(t => /subtitles|captions/.test(t.kind)) || m.textTracks[0]; tr.mode = 'hidden';
    const on = () => { const t = [...(tr.activeCues || [])].map(c => c.text.replace(/<[^>]+>/g, '')).join(' '); if (t) handleCaption(t, performance.now()); };
    tr.addEventListener('cuechange', on); offs.push(() => tr.removeEventListener('cuechange', on)); }
  watch = () => offs.forEach(f => f()); return true; }
function stopWatch() { watch?.(); watch = null; lastOrig = ''; }
chrome.runtime.onMessage.addListener((m, s, reply) => {
  switch (m.cmd) {
    case 'vt.ping': reply({ok: true}); return;
    case 'vt.captions': { cfg = m.cfg; stopWatch(); const yt = /(^|\.)youtube\.com$/.test(location.hostname) && youtube(); const src = yt ? 'youtube' : tracks() ? 'track' : null;
      if (src) { ui(); show('', 'Перевод субтитров включён (' + (yt ? 'YouTube' : 'дорожка <track>') + ')', null); }
      else if (!m.probe) show('', 'На странице нет субтитров — включите «Перевод звука»', null);
      reply({ok: !!src, source: src}); return; }
    case 'vt.show': cfg = m.cfg; show('', 'Слушаю звук вкладки…', null); reply?.({ok: true}); return;
    case 'vt.hide': stopWatch(); duck(false); if (box) box.style.display = 'none'; return;
    case 'vt.sub': show(m.orig, m.text, m.latency, m.final, m.engine); return;
    case 'vt.status': if (box && box.style.display !== 'none') { box.querySelector('.vt-l').textContent = m.text; } return;
    case 'vt.duck': duck(m.on); return;
    case 'vt.cfg': cfg = m.cfg; if (box && box.style.display !== 'none') ui(); return;
  }
});
document.addEventListener('fullscreenchange', () => box && box.style.display !== 'none' && ui());
addEventListener('resize', () => box && box.style.display !== 'none' && ui());
window.__vtTest = {handleCaption, show, VTC}; })();
