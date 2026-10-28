// Переводчик видео — общие функции (настройки, цензура). Без телеметрии.
var VTC = globalThis.VTC || (globalThis.VTC = {
  DEF: {mode: 'subs', src: 'auto', tgt: 'ru', stt: 'webspeech', tr: 'google', ttsVoice: '', rate: 1.1, duck: 0.2, font: 26, color: '#ffffff', bgA: 0.65, pos: 12, showOrig: false,
    prof: true, captionsFirst: true, whisperModel: 'onnx-community/whisper-base', keys: {}, models: {openai: 'gpt-4o-transcribe', openaiTr: 'gpt-4o-mini', elevenlabs: 'scribe_v1', deepgram: 'nova-3'}, region: {azure: 'westeurope'}},
  async cfg() { const r = (await chrome.storage.local.get('vt')).vt || {}; return {...VTC.DEF, ...r, keys: {...r.keys}, models: {...VTC.DEF.models, ...r.models}, region: {...VTC.DEF.region, ...r.region}}; },
  save(c) { return chrome.storage.local.set({vt: c}); },
  LANGS: {auto: 'Автоопределение', ru: 'Русский', en: 'Английский', de: 'Немецкий', fr: 'Французский', es: 'Испанский', it: 'Итальянский', pt: 'Португальский', uk: 'Украинский', tr: 'Турецкий', pl: 'Польский', zh: 'Китайский', ja: 'Японский', ko: 'Корейский', ar: 'Арабский', hi: 'Хинди', kk: 'Казахский'},
  BCP: {ru: 'ru-RU', en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-BR', uk: 'uk-UA', tr: 'tr-TR', pl: 'pl-PL', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', ar: 'ar-SA', hi: 'hi-IN', kk: 'kk-KZ'},
  // Собственная маска мата (рус/англ корни). Первая буква остаётся, остальное — звёздочки.
  BAD: /(?<![а-яёa-z])(?:х[уy][йяиеёю]|п[иеё]зд|[её]б[аеиуыёлнт]|(?:за|на|от|у|вы|до|по|раз|съ|вз|под|при)[её]б[аеиуыёлнт]|бля|х[еe]р(?:н|ов|ач)|су[кч][аиуеок]|муд[аои][кч]|пид[оа]?р|гандон|залуп|шлюх|fuck|shit|bitch|cunt|asshole|motherf|dickhead|wh[o0]re)[а-яёa-z]*/giu,
  mask(s) { return String(s || '').replace(VTC.BAD, w => w[0] + '*'.repeat(Math.max(2, w.length - 1))); },
});
