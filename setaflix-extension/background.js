// Proxy key artık kaynak kodda değil — popup'tan chrome.storage.local'a kaydediliyor
async function getProxyKey() {
  try {
    const r = await chrome.storage.local.get('proxyKey');
    return r.proxyKey || '';
  } catch(e) { return ''; }
}

let captures = [];

chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    try {
      const url = details.url;
      if (!isStreamUrl(url)) return;

      const stored = await chrome.storage.local.get('captures');
      captures = stored.captures || [];
      if (captures.find(c => c.url === url)) return;

      let tabUrl = '';
      try {
        const tab = await chrome.tabs.get(details.tabId);
        tabUrl = tab.url || '';
      } catch(e) {}

      let cookieStr = '';
      try {
        const cookieUrl = tabUrl || new URL(url).origin;
        const cookies = await chrome.cookies.getAll({ url: cookieUrl });
        cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      } catch(e) {}

      const capture = {
        id: Date.now() + '_' + Math.random().toString(36).slice(2),
        url,
        type: classifyUrl(url),
        cookies: cookieStr,
        referer: tabUrl,
        capturedAt: Date.now(),
        parsed: null,
        proxyStatus: null,
        proxyUrl: null
      };

      captures.push(capture);
      await chrome.storage.local.set({ captures });
      setBadge(details.tabId, captures.length);

      if (isPlaylist(url)) {
        capture.proxyStatus = 'pending';
        captures[captures.length - 1] = capture;
        await chrome.storage.local.set({ captures });
        parseMasterPlaylist(capture);
      }
    } catch(e) {}
  },
  { urls: ['<all_urls>'] }
);

function setBadge(tabId, count) {
  const txt = count > 0 ? String(count) : '';
  if (tabId && Number.isInteger(tabId) && tabId > 0) {
    chrome.action.setBadgeText({ text: txt, tabId }).catch(() => {
      chrome.action.setBadgeText({ text: txt }).catch(() => {});
    });
  } else {
    chrome.action.setBadgeText({ text: txt }).catch(() => {});
  }
  chrome.action.setBadgeBackgroundColor({ color: '#6c47ff' }).catch(() => {});
}

async function parseMasterPlaylist(capture) {
  let text = null;

  try {
    const res = await fetch(capture.url, {
      headers: capture.referer ? { 'Referer': capture.referer } : {}
    });
    if (res.ok) {
      text = await res.text();
      capture.proxyStatus = 'direct';
    }
  } catch(e) {}

  if (!text) {
    try {
      const base = await getProxyBase();
      const key  = await getProxyKey();
      if (base && key) {
        const cookieParam  = capture.cookies ? '&cookies='  + encodeURIComponent(capture.cookies)  : '';
        const refererParam = capture.referer ? '&referer='  + encodeURIComponent(capture.referer)  : '';
        const pUrl = `${base}/proxy?key=${encodeURIComponent(key)}${cookieParam}${refererParam}&url=${encodeURIComponent(capture.url)}`;
        const res = await fetch(pUrl);
        if (res.ok) {
          text = await res.text();
          capture.proxyStatus = 'proxy';
          capture.proxyUrl = pUrl;
        }
      }
    } catch(e) {}
  }

  if (!text) {
    capture.proxyStatus = 'failed';
  } else {
    capture.parsed = parseM3U8(text, capture.url);
  }

  try {
    const r = await chrome.storage.local.get('captures');
    const list = r.captures || [];
    const idx = list.findIndex(c => c.id === capture.id);
    if (idx !== -1) list[idx] = capture;
    captures = list;
    await chrome.storage.local.set({ captures: list });
  } catch(e) {}
}

function parseM3U8(text, baseUrl) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const base  = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
  const result = { videos: [], audios: [], subtitles: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
      const a = parseAttr(line);
      if (a.URI) result.audios.push({
        language:  a.LANGUAGE || 'und',
        name:      fixEncoding(a.NAME || a.LANGUAGE || 'Ses'),
        uri:       resolveUrl(a.URI, base),
        isDefault: a.DEFAULT === 'YES'
      });
    }

    if (line.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES')) {
      const s = parseAttr(line);
      if (s.URI) result.subtitles.push({
        language: s.LANGUAGE || 'und',
        name:     fixEncoding(s.NAME || s.LANGUAGE || 'Altyazı'),
        uri:      resolveUrl(s.URI, base)
      });
    }

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const v   = parseAttr(line);
      const uri = lines[i + 1];
      if (uri && !uri.startsWith('#')) {
        const res = v.RESOLUTION || '';
        const bw  = parseInt(v.BANDWIDTH || '0');
        result.videos.push({
          resolution: res,
          label:      res ? res.split('x')[1] + 'p' : (bw ? Math.round(bw / 1000) + 'k' : 'Video'),
          bandwidth:  bw,
          uri:        resolveUrl(uri, base)
        });
      }
    }
  }

  result.videos.sort((a, b) => b.bandwidth - a.bandwidth);
  return result;
}

function isStreamUrl(url) {
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.m3u8') || clean.endsWith('.vtt') || clean.endsWith('.webvtt');
}

function isPlaylist(url) {
  return url.split('?')[0].toLowerCase().endsWith('.m3u8');
}

function classifyUrl(url) {
  const lower = url.toLowerCase();
  const clean = lower.split('?')[0];
  if (clean.endsWith('.vtt') || clean.endsWith('.webvtt'))                             return 'subtitle';
  if (lower.includes('subtitle') || lower.includes('caption') || lower.includes('sub')) return 'subtitle';
  if (lower.includes('audio') || lower.includes('ses') || lower.includes('sound'))      return 'audio';
  if (lower.includes('master') || lower.includes('playlist') || lower.includes('index')) return 'playlist';
  if (/[_\-\/](720|1080|480|360|2160|4k)/i.test(lower))                               return 'video';
  return 'unknown';
}

function parseAttr(line) {
  const result = {};
  const re = /([A-Z-]+)=(?:"([^"]*)"|([^,]*))/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    result[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return result;
}

function resolveUrl(uri, base) {
  if (!uri) return '';
  if (uri.startsWith('http')) return uri;
  if (uri.startsWith('//'))   return 'https:' + uri;
  return base + uri;
}

function fixEncoding(str) {
  try { return decodeURIComponent(escape(str)); } catch(e) { return str; }
}

async function getProxyBase() {
  try {
    const r = await chrome.storage.local.get('proxyBase');
    return r.proxyBase || '';
  } catch(e) { return ''; }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_CAPTURES') {
    chrome.storage.local.get('captures', r => {
      sendResponse({ captures: r.captures || [] });
    });
    return true;
  }
  if (msg.type === 'CLEAR') {
    captures = [];
    chrome.storage.local.remove('captures').catch(() => {});
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
});
