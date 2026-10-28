// Захват звука вкладки → (Web Speech | чанки по VAD → STT) → перевод → в фон (субтитры/озвучка). Звук вкладки продолжает играть через GainNode (приглушение).
const S = {on: false};
const send = m => chrome.runtime.sendMessage(m).catch(() => {});
const status = t => send({cmd: 'vt.status', text: t});
let prevText = '';
async function deliver(orig, t0, final = true) {
  const c = S.cfg; if (!orig.trim()) return;
  if (c.prof) orig = VTC.mask(orig);
  try { const text = await VTE.translate(orig, c, final ? prevText : ''); if (final) prevText = orig;
    send({cmd: 'vt.out', tabId: S.tabId, orig, text, final, latency: Math.round(performance.now() - t0), engine: c.stt + '→' + c.tr});
  } catch (e) { status('Ошибка перевода: ' + e.message); }
}
// --------- VAD по энергии: режем по паузам, чтобы фразы не рвались ---------
function makeChunker(onChunk) {
  const FR = 480; let buf = [], len = 0, speech = 0, sil = 0, floor = 0.005, acc = new Float32Array(0);
  return pcm => { const a = new Float32Array(acc.length + pcm.length); a.set(acc); a.set(pcm, acc.length); let i = 0;
    for (; i + FR <= a.length; i += FR) { const f = a.subarray(i, i + FR); let e = 0; for (const x of f) e += x * x; e = Math.sqrt(e / FR);
      const voiced = e > Math.max(0.008, floor * 3); if (!voiced) floor = floor * 0.98 + e * 0.02;
      if (voiced) { speech += 30; sil = 0; } else sil += 30;
      if (speech || voiced) { buf.push(f.slice()); len += FR; }
      const dur = len / 16;
      if ((speech >= 700 && sil >= 450) || dur >= 8000) { const out = new Float32Array(len); let o = 0; for (const b of buf) { out.set(b, o); o += b.length; } buf = []; len = 0; speech = 0; sil = 0; onChunk(out); }
      else if (speech < 700 && sil >= 1500 && len) { buf = []; len = 0; speech = 0; } }
    acc = a.slice(i); };
}
// Очередь распознавания, чтобы не было параллельных запросов и отставание видно честно
const q = []; let busy = false;
async function pump() { if (busy) return; busy = true;
  while (q.length && S.on !== false) { const {pcm, t0} = q.shift(); if (q.length > 3) q.splice(0, q.length - 2); // догоняем — старое выкидываем
    try { const txt = await VTE.stt[S.cfg.stt](pcm, S.cfg); await deliver(txt, t0); }
    catch (e) { status('Ошибка распознавания (' + S.cfg.stt + '): ' + e.message); if (S.cfg.stt !== 'whisper' && /ключ|401|403/.test(e.message)) { S.cfg.stt = 'whisper'; status('Переключаюсь на локальный Whisper'); } } }
  busy = false; }
VTE.feed = pcm => { q.push({pcm, t0: performance.now()}); pump(); }; // для тестов и для захвата
// --------- Web Speech API c дорожкой вкладки (Chrome 135+) ---------
function startWebSpeech(track) {
  const R = self.SpeechRecognition || self.webkitSpeechRecognition; if (!R) throw new Error('нет SpeechRecognition');
  const r = new R(); r.continuous = true; r.interimResults = true; r.lang = VTC.BCP[S.cfg.src] || 'en-US'; S.rec = r;
  let t0 = performance.now(), lastInterim = 0;
  r.onresult = e => { let fin = '', int = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) fin += res[0].transcript; else int += res[0].transcript; }
    clearTimeout(S.stale); fin = fin.trim(); int = int.trim();
    if (fin) { if (fin !== S.forced) deliver(fin, t0); S.forced = ''; t0 = performance.now(); }
    if (int) { if (performance.now() - lastInterim > 1200 && int.split(' ').length > 3) { lastInterim = performance.now(); deliver(int, t0, false); }
      // если Google долго не закрывает фразу — считаем её законченной сами (меньше задержка озвучки)
      S.stale = setTimeout(() => { S.forced = int; deliver(int, t0); t0 = performance.now(); }, 1500); } };
  r.onspeechstart = () => t0 = performance.now();
  r.onerror = e => { status('Web Speech: ' + e.error); if (/not-allowed|service-not-allowed|network|language-not-supported/.test(e.error)) { S.cfg.stt = 'whisper'; S.rec = null; status('Web Speech недоступен — переключаюсь на локальный Whisper'); startChunks(); } };
  r.onend = () => { if (S.on && S.rec === r) try { r.start(track); } catch {} };
  r.start(track);
}
function startChunks() { if (S.proc) return;
  const ctx16 = new AudioContext({sampleRate: 16000}); S.ctx16 = ctx16; const src = ctx16.createMediaStreamSource(S.stream), p = ctx16.createScriptProcessor(4096, 1, 1);
  const ch = makeChunker(VTE.feed); p.onaudioprocess = e => ch(e.inputBuffer.getChannelData(0)); src.connect(p); p.connect(ctx16.destination); S.proc = p; }
async function start(m) {
  await stop(); S.cfg = m.cfg; S.tabId = m.tabId; S.on = true; prevText = '';
  S.stream = m.testStream || await navigator.mediaDevices.getUserMedia({audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: m.streamId}}, video: false});
  S.ctx = new AudioContext(); S.gain = S.ctx.createGain(); S.ctx.createMediaStreamSource(S.stream).connect(S.gain).connect(S.ctx.destination);
  if (S.cfg.stt === 'webspeech') { try { startWebSpeech(S.stream.getAudioTracks()[0]); status('Распознавание: Google Web Speech'); return; } catch (e) { status('Web Speech: ' + e.message + ' — локальный Whisper'); S.cfg.stt = 'whisper'; } }
  startChunks(); status('Распознавание: ' + S.cfg.stt);
}
async function stop() { S.on = false; try { S.rec?.abort(); } catch {} S.rec = null; S.proc?.disconnect(); S.proc = null; S.stream?.getTracks().forEach(t => t.stop());
  await S.ctx?.close().catch(() => {}); await S.ctx16?.close().catch(() => {}); S.ctx = S.ctx16 = S.stream = null; q.length = 0; }
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m.cmd === 'vt.off.start') { start(m).then(() => reply({ok: true}), e => reply({ok: false, error: e.message})); return true; }
  if (m.cmd === 'vt.off.stop') { stop().then(() => reply({ok: true})); return true; }
  if (m.cmd === 'vt.off.duck') { if (S.gain) S.gain.gain.setTargetAtTime(m.on ? S.cfg.duck : 1, S.ctx.currentTime, 0.08); return; }
  if (m.cmd === 'vt.off.cfg') { if (S.cfg) Object.assign(S.cfg, m.cfg, {stt: S.cfg.stt}); return; }
  if (m.cmd === 'vt.off.translate') { VTE.translate(m.text, m.cfg, m.ctx).then(text => reply({text}), e => reply({error: e.message})); return true; }
  if (m.cmd === 'vt.off.ping') { reply({ok: true, on: S.on}); return; }
});
