const $ = id => document.getElementById(id);
const KEYS = [['openai', 'OpenAI API key'], ['groq', 'Groq API key'], ['elevenlabs', 'ElevenLabs API key'], ['deepgram', 'Deepgram API key'], ['assemblyai', 'AssemblyAI API key'],
  ['yandex', 'Yandex SpeechKit Api-Key'], ['yandexTr', 'Yandex Translate Api-Key'], ['yandexFolder', 'Yandex Cloud folderId (необязательно)'], ['azure', 'Azure Speech key'], ['deepl', 'DeepL key'], ['mstr', 'Microsoft Translator key']];
let c;
const tabId = async () => window.vtTabId ?? (await chrome.tabs.query({active: true, currentWindow: true}))[0]?.id;
const stat = t => $('stat').textContent = t;
async function save() { await VTC.save(c); }
(async () => {
  if (location.search.includes('from=app')) { $('back').hidden = false; $('back').href = '../' + (new URLSearchParams(location.search).get('back') || 'popup.html'); }
  c = await VTC.cfg();
  for (const [id, n] of Object.entries(VTC.LANGS)) { $('src').add(new Option(n, id)); if (id !== 'auto') $('tgt').add(new Option(n, id)); }
  $('keys').innerHTML = KEYS.map(([k, n]) => `<label>${n}<input type="password" data-k="${k}" autocomplete="off"></label>`).join('') + '<label>Регион Azure<input data-r="azure"></label><label>Регион Microsoft Translator<input data-r="mstr"></label>';
  for (const i of document.querySelectorAll('[data-k]')) { i.value = c.keys[i.dataset.k] || ''; i.onchange = () => { c.keys[i.dataset.k] = i.value.trim(); save(); }; }
  for (const i of document.querySelectorAll('[data-r]')) { i.value = c.region[i.dataset.r] || ''; i.onchange = () => { c.region[i.dataset.r] = i.value.trim(); save(); }; }
  for (const id of ['mode', 'src', 'tgt', 'stt', 'tr', 'whisperModel', 'ttsVoice', 'rate', 'duck', 'font', 'color', 'bgA', 'pos', 'prof', 'captionsFirst', 'showOrig']) {
    const el = $(id); if (el.type === 'checkbox') el.checked = !!c[id]; else el.value = c[id];
    el.oninput = () => { c[id] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value; labels(); save(); }; }
  labels();
  const voices = await chrome.runtime.sendMessage({cmd: 'vt.voices'}) || [];
  for (const v of voices) $('ttsVoice').add(new Option(`${v.name} (${v.lang || '?'})${v.remote ? ' ☁' : ''}`, v.name)); $('ttsVoice').value = c.ttsVoice;
  const st = await chrome.runtime.sendMessage({cmd: 'vt.state', tabId: await tabId()}); if (st?.mode) stat('Работает: ' + (st.mode === 'audio' ? 'перевод звука' : 'субтитры'));
})();
function labels() { $('rateV').textContent = (+c.rate).toFixed(2) + '×'; $('duckV').textContent = Math.round(c.duck * 100) + '%'; }
async function streamId(id) { try { return await chrome.tabCapture.getMediaStreamId({targetTabId: id}); } catch (e) { return undefined; } }
async function run(cmd) { const id = await tabId(); stat('Запуск…');
  const sid = cmd === 'vt.startCaptions' ? undefined : await streamId(id);
  const r = await chrome.runtime.sendMessage({cmd, tabId: id, streamId: sid});
  stat(r?.ok ? 'Работает: ' + ({youtube: 'субтитры YouTube', track: 'субтитры <track>', audio: 'перевод звука вкладки'}[r.source] || (cmd === 'vt.startAudio' ? 'перевод звука вкладки' : 'субтитры')) : 'Ошибка: ' + (r?.error || 'нет субтитров на странице')); }
$('auto').onclick = () => run('vt.auto'); $('caps').onclick = () => run('vt.startCaptions'); $('audio').onclick = () => run('vt.startAudio');
$('stop').onclick = async () => { await chrome.runtime.sendMessage({cmd: 'vt.stop', tabId: await tabId()}); stat('Остановлено.'); };
$('tryVoice').onclick = () => chrome.runtime.sendMessage({cmd: 'vt.testSpeak', text: 'Привет! Так звучит перевод.', lang: VTC.BCP[c.tgt], voice: c.ttsVoice, rate: c.rate});
chrome.runtime.onMessage.addListener(m => { if (m.cmd === 'vt.panel') $('lat').textContent = `Последняя задержка: ${(m.latency / 1000).toFixed(1)} с — «${m.text.slice(0, 60)}»`; if (m.cmd === 'vt.status') $('stat').textContent = m.text; });
