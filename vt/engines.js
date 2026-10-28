// Переводчик видео — движки распознавания (STT) и перевода. Ключи берутся только из локальных настроек и уходят только выбранному сервису.
var VTE = globalThis.VTE || (globalThis.VTE = {});
VTE.wav = (pcm, rate = 16000) => { const b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true); return new Blob([b], {type: 'audio/wav'}); };
const need = (c, k, name) => { const v = c.keys[k]; if (!v) throw new Error(`Нужен API-ключ ${name} (настройки)`); return v; };
const ok = async r => { if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`); return r; };
// ---------- STT: (pcm Float32 16 кГц, cfg) -> текст ----------
VTE.stt = {
  async whisper(pcm, c) {
    if (!VTE._asr || VTE._asrModel !== c.whisperModel) {
      const T = await import(chrome.runtime.getURL('vt/lib/transformers.min.js'));
      T.env.allowLocalModels = false; T.env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vt/lib/'); T.env.backends.onnx.wasm.numThreads = 1;
      const device = navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null) ? 'webgpu' : 'wasm';
      VTE._asr = await T.pipeline('automatic-speech-recognition', c.whisperModel, {device, dtype: device === 'webgpu' ? {encoder_model: 'fp32', decoder_model_merged: 'q4'} : 'q8',
        progress_callback: p => p.status === 'progress' && chrome.runtime.sendMessage({cmd: 'vt.status', text: `Загрузка модели Whisper: ${p.file} ${Math.round(p.progress)}%`}).catch(() => {})});
      VTE._asrModel = c.whisperModel; VTE._asrDevice = device;
    }
    const o = {task: 'transcribe', chunk_length_s: 30}; if (c.src !== 'auto') o.language = c.src;
    return (await VTE._asr(pcm, o)).text.trim();
  },
  async openai(pcm, c, base = 'https://api.openai.com/v1', key = need(c, 'openai', 'OpenAI'), model = c.models.openai) {
    const f = new FormData(); f.append('file', VTE.wav(pcm), 'a.wav'); f.append('model', model); if (c.src !== 'auto') f.append('language', c.src);
    return (await (await ok(await fetch(base + '/audio/transcriptions', {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: f}))).json()).text.trim();
  },
  groq(pcm, c) { return VTE.stt.openai(pcm, c, 'https://api.groq.com/openai/v1', need(c, 'groq', 'Groq'), 'whisper-large-v3-turbo'); },
  async deepgram(pcm, c) {
    const q = new URLSearchParams({model: c.models.deepgram, smart_format: 'true', punctuate: 'true', profanity_filter: String(!!c.prof)}); q.set(c.src === 'auto' ? 'detect_language' : 'language', c.src === 'auto' ? 'true' : c.src);
    const j = await (await ok(await fetch('https://api.deepgram.com/v1/listen?' + q, {method: 'POST', headers: {Authorization: 'Token ' + need(c, 'deepgram', 'Deepgram'), 'Content-Type': 'audio/wav'}, body: VTE.wav(pcm)}))).json();
    return j.results.channels[0].alternatives[0].transcript;
  },
  async assemblyai(pcm, c) { const k = need(c, 'assemblyai', 'AssemblyAI'), H = {authorization: k};
    const up = await (await ok(await fetch('https://api.assemblyai.com/v2/upload', {method: 'POST', headers: H, body: VTE.wav(pcm)}))).json();
    const body = {audio_url: up.upload_url, filter_profanity: !!c.prof, punctuate: true}; if (c.src === 'auto') body.language_detection = true; else body.language_code = c.src;
    let t = await (await ok(await fetch('https://api.assemblyai.com/v2/transcript', {method: 'POST', headers: {...H, 'content-type': 'application/json'}, body: JSON.stringify(body)}))).json();
    while (!/completed|error/.test(t.status)) { await new Promise(r => setTimeout(r, 700)); t = await (await fetch('https://api.assemblyai.com/v2/transcript/' + t.id, {headers: H})).json(); }
    if (t.status === 'error') throw new Error(t.error); return t.text || ''; },
  async elevenlabs(pcm, c) { const f = new FormData(); f.append('file', VTE.wav(pcm), 'a.wav'); f.append('model_id', c.models.elevenlabs); if (c.src !== 'auto') f.append('language_code', c.src); f.append('tag_audio_events', 'false');
    return (await (await ok(await fetch('https://api.elevenlabs.io/v1/speech-to-text', {method: 'POST', headers: {'xi-api-key': need(c, 'elevenlabs', 'ElevenLabs')}, body: f}))).json()).text.trim(); },
  async yandex(pcm, c) { const i16 = new Int16Array(pcm.length); for (let i = 0; i < pcm.length; i++) i16[i] = Math.max(-1, Math.min(1, pcm[i])) * 0x7fff;
    const q = new URLSearchParams({lang: c.src === 'auto' ? 'auto' : (VTC.BCP[c.src] || 'ru-RU'), format: 'lpcm', sampleRateHertz: '16000', profanityFilter: String(!!c.prof)});
    if (c.keys.yandexFolder) q.set('folderId', c.keys.yandexFolder);
    return (await (await ok(await fetch('https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?' + q, {method: 'POST', headers: {Authorization: 'Api-Key ' + need(c, 'yandex', 'Yandex SpeechKit')}, body: i16.buffer}))).json()).result || ''; },
  async azure(pcm, c) { const q = new URLSearchParams({language: VTC.BCP[c.src] || 'en-US', profanity: c.prof ? 'masked' : 'raw', format: 'simple'});
    const j = await (await ok(await fetch(`https://${c.region.azure}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?` + q, {method: 'POST', headers: {'Ocp-Apim-Subscription-Key': need(c, 'azure', 'Microsoft Azure Speech'), 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000'}, body: VTE.wav(pcm)}))).json();
    return j.DisplayText || ''; },
};
// ---------- Перевод: (text, cfg, ctx) -> text ----------
const cache = new Map();
VTE.tr = {
  async google(t, c) { const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${c.src === 'auto' ? 'auto' : c.src}&tl=${c.tgt}&dt=t&q=` + encodeURIComponent(t);
    try { const j = await (await ok(await fetch(u))).json(); return j[0].map(x => x[0]).join(''); }
    catch (e) { // gtx при частых запросах отдаёт 429 — второй публичный эндпоинт Google
      const j = await (await ok(await fetch(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${c.src === 'auto' ? 'auto' : c.src}&tl=${c.tgt}&q=` + encodeURIComponent(t)))).json();
      return (Array.isArray(j[0]) ? j.map(x => x[0]) : j).join(' '); } },
  async deepl(t, c) { const k = need(c, 'deepl', 'DeepL'), host = k.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const body = {text: [t], target_lang: c.tgt.toUpperCase().replace('PT', 'PT-BR').replace('ZH', 'ZH-HANS')}; if (c.src !== 'auto') body.source_lang = c.src.toUpperCase();
    return (await (await ok(await fetch(`https://${host}/v2/translate`, {method: 'POST', headers: {Authorization: 'DeepL-Auth-Key ' + k, 'Content-Type': 'application/json'}, body: JSON.stringify(body)}))).json()).translations[0].text; },
  async yandex(t, c) { const body = {texts: [t], targetLanguageCode: c.tgt}; if (c.src !== 'auto') body.sourceLanguageCode = c.src; if (c.keys.yandexFolder) body.folderId = c.keys.yandexFolder;
    return (await (await ok(await fetch('https://translate.api.cloud.yandex.net/translate/v2/translate', {method: 'POST', headers: {Authorization: 'Api-Key ' + need(c, 'yandexTr', 'Yandex Translate'), 'Content-Type': 'application/json'}, body: JSON.stringify(body)}))).json()).translations[0].text; },
  async microsoft(t, c) { const q = new URLSearchParams({'api-version': '3.0', to: c.tgt, profanityAction: c.prof ? 'Marked' : 'NoAction', profanityMarker: 'Asterisk'}); if (c.src !== 'auto') q.set('from', c.src);
    const h = {'Ocp-Apim-Subscription-Key': need(c, 'mstr', 'Microsoft Translator'), 'Content-Type': 'application/json'}; if (c.region.mstr) h['Ocp-Apim-Subscription-Region'] = c.region.mstr;
    return (await (await ok(await fetch('https://api.cognitive.microsofttranslator.com/translate?' + q, {method: 'POST', headers: h, body: JSON.stringify([{Text: t}])}))).json())[0].translations[0].text; },
  async openai(t, c, ctx) { const lang = VTC.LANGS[c.tgt] || c.tgt;
    const msgs = [{role: 'system', content: `Ты синхронный переводчик видео. Переведи реплику на язык: ${lang}. Кратко и естественно, как субтитры. Верни только перевод.${c.prof ? ' Нецензурные слова замаскируй звёздочками.' : ''}`}];
    if (ctx) msgs.push({role: 'user', content: 'Контекст (не переводить): ' + ctx}); msgs.push({role: 'user', content: t});
    const j = await (await ok(await fetch('https://api.openai.com/v1/chat/completions', {method: 'POST', headers: {Authorization: 'Bearer ' + need(c, 'openai', 'OpenAI'), 'Content-Type': 'application/json'}, body: JSON.stringify({model: c.models.openaiTr, messages: msgs, temperature: 0.2})}))).json();
    return j.choices[0].message.content.trim(); },
  async chrome(t, c) { if (!('Translator' in self)) throw new Error('Встроенный переводчик Chrome недоступен (нужен Chrome 138+)');
    const src = c.src === 'auto' ? (await (await LanguageDetector.create()).detect(t))[0].detectedLanguage : c.src;
    VTE._ct ??= {}; const key = src + c.tgt; VTE._ct[key] ??= await Translator.create({sourceLanguage: src, targetLanguage: c.tgt}); return VTE._ct[key].translate(t); },
  async local(t, c) { const src = c.src === 'auto' ? 'en' : c.src, model = `Xenova/opus-mt-${src}-${c.tgt}`;
    if (VTE._mtModel !== model) { const T = await import(chrome.runtime.getURL('vt/lib/transformers.min.js')); T.env.allowLocalModels = false; T.env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vt/lib/'); T.env.backends.onnx.wasm.numThreads = 1;
      VTE._mt = await T.pipeline('translation', model, {dtype: 'q8'}); VTE._mtModel = model; }
    return (await VTE._mt(t))[0].translation_text; },
};
VTE.translate = async (t, c, ctx) => { if (!t.trim()) return ''; const k = [c.tr, c.src, c.tgt, !!c.prof, t].join('|'); if (cache.has(k)) return cache.get(k);
  let out, err; // резервная цепочка: выбранный → Google → встроенный Chrome → локальный Opus-MT
  for (const eng of [...new Set([c.tr, 'google', 'chrome', 'local'])]) { try { out = await VTE.tr[eng](t, c, ctx); if (eng !== c.tr) { out += ' ⚠'; console.warn('перевод: резервный движок ' + eng, err?.message); } break; } catch (e) { err ??= e; } }
  if (out == null) throw err;
  if (c.prof) out = VTC.mask(out); if (cache.size > 500) cache.clear(); cache.set(k, out); return out; };
