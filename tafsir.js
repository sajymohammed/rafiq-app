/* Rafiqi tafsir screen. Texts are fetched on demand and cached separately from the app.
 * Sources: QuranEnc official API (Muyassar), spa5k/tafsir_api (MIT data service).
 * https://quranenc.com/ar/home/api
 * https://github.com/spa5k/tafsir_api
 */
(() => {
  'use strict';
  const sources = [
    {id:'muyassar', name:'التفسير الميسر', edition:'arabic_moyassar', website:'https://quranenc.com/ar/browse/arabic_moyassar'},
    {id:'ibnkathir', name:'تفسير ابن كثير', edition:'ar-tafsir-ibn-kathir', website:'https://qul.tarteel.ai/resources/tafsir/22'},
    {id:'tabari', name:'تفسير الطبري', edition:'ar-tafsir-al-tabari', website:'https://qul.tarteel.ai/resources/tafsir/37'},
    {id:'saadi', name:'تفسير السعدي', edition:'ar-tafseer-al-saddi', website:'https://qul.tarteel.ai/resources/tafsir/24'}
  ];
  const cacheName = 'rafiqi-tafsir-v1';
  const pending = new Map();
  let screen, host, generation = 0, opened = false;

  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function plainText(value) {
    return String(value || '').replace(/<br\s*\/?\s*>/gi,'\n')
      .replace(/<\/(?:p|div|h[1-6]|li)>/gi,'\n\n').replace(/<[^>]*>/g,'')
      .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  }

  function textFrom(data, source, surah, ayah) {
    if (source.id === 'muyassar') {
      if (!data.result?.translation || +data.result.sura !== surah || +data.result.aya !== ayah) throw new Error('missing tafsir');
      return plainText(data.result.translation) + (data.result.footnotes ? '\n\n' + plainText(data.result.footnotes) : '');
    }
    if (!data.text || +data.surah !== surah || +data.ayah !== ayah) throw new Error('missing tafsir');
    return plainText(data.text);
  }

  function loadText(source, surah, ayah) {
    const path = `tafsir/${source.edition}/${surah}/${ayah}.json`;
    const url = source.id === 'muyassar'
      ? `https://quranenc.com/api/v1/translation/aya/${source.edition}/${surah}/${ayah}`
      : `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/${path}`;
    if (pending.has(url)) return pending.get(url);

    const request = (async () => {
      let cache;
      try {
        cache = await caches.open(cacheName);
        const saved = await cache.match(url);
        if (saved) {
          try { return textFrom(await saved.json(), source, surah, ayah); }
          catch { await cache.delete(url); }
        }
      } catch {}

      const urls = source.id === 'muyassar' ? [url] : [url,`https://raw.githubusercontent.com/spa5k/tafsir_api/main/${path}`];
      for (const endpoint of urls) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetch(endpoint, {signal:controller.signal});
          if (!response.ok) continue;
          const copy = response.clone();
          const text = textFrom(await response.json(),source,surah,ayah);
          if (cache) { try { await cache.put(url,copy); } catch {} }
          return text;
        } catch {}
        finally { clearTimeout(timer); }
      }
      throw new Error('tafsir unavailable');
    })().finally(() => pending.delete(url));

    pending.set(url, request);
    return request;
  }

  function createScreen() {
    screen = node('section','q-inner-screen');
    screen.id = 'qTafsirScreen';
    screen.setAttribute('aria-label','التفسير');
    screen.hidden = true;

    const header = node('header','q-inner-head');
    const back = node('button','mini-btn','‹ رجوع للمصحف');
    back.type = 'button';
    back.onclick = close;
    header.append(back,node('h2','','التفسير'));

    const sourceRow = node('div','q-tafsir-source');
    const select = node('select','sel');
    select.id = 'qTafsirBook';
    select.setAttribute('aria-label','اختيار كتاب التفسير');
    sources.forEach(source => {
      const option = node('option','',source.name);
      option.value = source.id;
      select.append(option);
    });
    const saved = localStorage.getItem('qTafsirBook');
    select.value = sources.some(source => source.id === saved) ? saved : 'muyassar';
    select.onchange = () => {
      localStorage.setItem('qTafsirBook',select.value);
      render();
    };
    sourceRow.append(select);

    const status = node('p','q-tafsir-status');
    status.id = 'qTafsirStatus';
    status.setAttribute('aria-live','polite');
    const body = node('div','q-inner-body');
    body.id = 'qTafsirBody';
    screen.append(header,sourceRow,status,body);
    document.getElementById('qReader').append(screen);
  }

  async function render() {
    const version = ++generation;
    const source = sources.find(item => item.id === document.getElementById('qTafsirBook').value);
    const body = document.getElementById('qTafsirBody');
    const status = document.getElementById('qTafsirStatus');
    const options = host;
    body.replaceChildren();
    body.scrollTop = 0;
    status.textContent = options.indices.length === 1 ? 'تفسير الآية المحددة' : 'تفسير آيات الصفحة كاملة';

    const entries = options.indices.map(index => {
      const entry = node('article','q-tafsir-entry');
      entry.append(node('h3','',options.reference(index)));
      const text = node('div','q-tafsir-text','جاري تحميل التفسير…');
      const attribution = node('a','','المصدر · ' + source.name);
      attribution.href = source.website;
      attribution.target = '_blank';
      attribution.rel = 'noopener noreferrer';
      entry.append(text,attribution);
      body.append(entry);
      return {index,text};
    });

    let cursor = 0, loaded = 0, failed = 0;
    async function worker() {
      while (cursor < entries.length && opened && version === generation) {
        const {index,text} = entries[cursor++];
        const verse = options.verse(index);
        try {
          const result = await loadText(source,verse[0],verse[1]);
          if (!opened || version !== generation) return;
          text.textContent = result;
          loaded++;
        } catch {
          if (!opened || version !== generation) return;
          failed++;
          text.textContent = 'تعذّر تحميل هذا التفسير. اتأكد من النت وجرب تاني.';
          const retry = node('button','xb','إعادة المحاولة');
          retry.type = 'button';
          retry.onclick = render;
          text.append(document.createElement('br'),retry);
        }
        status.textContent = `تم عرض ${loaded} من ${entries.length}` + (failed ? ` · تعذّر تحميل ${failed}` : '');
      }
    }
    await Promise.all(Array.from({length:Math.min(3,entries.length)},worker));
  }

  function open(options) {
    if (!screen) createScreen();
    host = options;
    opened = true;
    screen.hidden = false;
    render();
  }

  function close() {
    opened = false;
    generation++;
    if (screen) screen.hidden = true;
  }

  window.RafiqTafsir = {open,close};
})();
