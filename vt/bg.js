// Переводчик видео — фоновая часть (подключается через importScripts). Команды с префиксом vt.*
try { importScripts('/vt/common.js'); } catch (e) {}
const VTB = {tabs: {}, queue: 0};
async function vtOffscreen() {
  const has = (await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']})).length;
  if (!has) await chrome.offscreen.createDocument({url: 'vt/offscreen.html', reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'], justification: 'Распознавание и перевод звука вкладки'}).catch(e => { if (!/single|only one/i.test(e.message)) throw e; });
}
const vtTab = (id, m) => chrome.tabs.sendMessage(id, m).catch(() => {});
async function vtInject(tabId) { try { await chrome.tabs.sendMessage(tabId, {cmd: 'vt.ping'}); } catch { await chrome.scripting.executeScript({target: {tabId, allFrames: false}, files: ['vt/common.js', 'vt/content.js']}); } }
function vtDuck(tabId, on) { if (VTB.tabs[tabId] === 'audio') chrome.runtime.sendMessage({cmd: 'vt.off.duck', on}).catch(() => {}); else vtTab(tabId, {cmd: 'vt.duck', on}); } // при захвате глушим только выход, чтобы распознавание не теряло громкость
async function vtSpeak(tabId, text) {
  const c = await VTC.cfg(); if (!text || c.mode === 'subs') return;
  VTB.queue++; const rate = Math.min(2.5, c.rate * (VTB.queue > 2 ? 1.35 : VTB.queue > 1 ? 1.15 : 1)); // догоняем видео, если очередь растёт
  const o = {lang: VTC.BCP[c.tgt] || c.tgt, rate, enqueue: true, onEvent: e => {
    if (e.type === 'start') vtDuck(tabId, true);
    if (/end|interrupted|cancelled|error/.test(e.type)) { VTB.queue = Math.max(0, VTB.queue - 1); if (!VTB.queue) vtDuck(tabId, false); }
    if (e.type === 'error') vtTab(tabId, {cmd: 'vt.status', text: 'Озвучка: ' + (e.errorMessage || 'в системе нет голоса для этого языка')}); }};
  if (c.ttsVoice) o.voiceName = c.ttsVoice;
  chrome.tts.speak(text.replace(/⚠/g, ''), o);
}
async function vtStartCapture(tabId, streamId) {
  const c = await VTC.cfg(); await vtInject(tabId); await vtOffscreen();
  streamId ??= await chrome.tabCapture.getMediaStreamId({targetTabId: tabId});
  const r = await chrome.runtime.sendMessage({cmd: 'vt.off.start', streamId, tabId, cfg: c});
  if (!r?.ok) throw new Error(r?.error || 'offscreen не ответил');
  VTB.tabs[tabId] = 'audio'; vtTab(tabId, {cmd: 'vt.show', source: 'audio', cfg: c}); return r;
}
async function vtStop(tabId) { chrome.tts.stop(); VTB.queue = 0; if (VTB.tabs[tabId] === 'audio') await chrome.runtime.sendMessage({cmd: 'vt.off.stop'}).catch(() => {});
  delete VTB.tabs[tabId]; vtTab(tabId, {cmd: 'vt.hide'}); vtDuck(tabId, false); }
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (!m || typeof m.cmd !== 'string' || !m.cmd.startsWith('vt.') || m.cmd.startsWith('vt.off.')) return;
  const tabId = m.tabId ?? s.tab?.id, done = p => { p.then(reply, e => reply({ok: false, error: e.message})); return true; };
  switch (m.cmd) {
    case 'vt.startCaptions': return done((async () => { await vtInject(tabId); const c = await VTC.cfg(); VTB.tabs[tabId] = 'captions';
      const r = await chrome.tabs.sendMessage(tabId, {cmd: 'vt.captions', cfg: c}); return r; })());
    case 'vt.startAudio': return done(vtStartCapture(tabId, m.streamId).then(() => ({ok: true})));
    case 'vt.auto': return done((async () => { await vtInject(tabId); const c = await VTC.cfg(); // сначала готовые субтитры, иначе — звук
      const r = c.captionsFirst ? await chrome.tabs.sendMessage(tabId, {cmd: 'vt.captions', cfg: c, probe: true}) : null;
      if (r?.ok) { VTB.tabs[tabId] = 'captions'; return {ok: true, source: r.source}; }
      await vtStartCapture(tabId, m.streamId); return {ok: true, source: 'audio'}; })());
    case 'vt.stop': return done(vtStop(tabId).then(() => ({ok: true})));
    case 'vt.state': reply({mode: VTB.tabs[tabId] || null}); return;
    case 'vt.translate': return done((async () => { await vtOffscreen(); const c = await VTC.cfg(); const r = await chrome.runtime.sendMessage({cmd: 'vt.off.translate', text: m.text, ctx: m.ctx, cfg: c}); if (r?.error) throw new Error(r.error); return r; })());
    case 'vt.speak': vtSpeak(tabId, m.text); reply({ok: true}); return;
    case 'vt.out': vtTab(m.tabId, {cmd: 'vt.sub', orig: m.orig, text: m.text, latency: m.latency, final: m.final, engine: m.engine}); if (m.final) vtSpeak(m.tabId, m.text);
      chrome.runtime.sendMessage({cmd: 'vt.panel', latency: m.latency, text: m.text}).catch(() => {}); return;
    case 'vt.status': for (const id in VTB.tabs) vtTab(+id, {cmd: 'vt.status', text: m.text}); return;
    case 'vt.voices': chrome.tts.getVoices(v => reply(v.map(x => ({name: x.voiceName, lang: x.lang, remote: x.remote})))); return true;
    case 'vt.testSpeak': chrome.tts.speak(m.text, {lang: m.lang, voiceName: m.voice || undefined, rate: m.rate || 1, onEvent: e => { if (/end|error|interrupted/.test(e.type)) reply({event: e.type, error: e.errorMessage}); }}); return true;
  }
});
chrome.tabs.onRemoved.addListener(id => { if (VTB.tabs[id]) vtStop(id); });
chrome.storage.onChanged.addListener(ch => { if (ch.vt) for (const id in VTB.tabs) vtTab(+id, {cmd: 'vt.cfg', cfg: {...VTC.DEF, ...ch.vt.newValue}}); if (ch.vt) chrome.runtime.sendMessage({cmd: 'vt.off.cfg', cfg: ch.vt.newValue}).catch(() => {}); });
