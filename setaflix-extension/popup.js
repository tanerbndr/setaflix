const SETAFLIX = 'https://setaflix.vercel.app';

// Seçim durumu
let state = {
  captures: [],
  selectedId:       null,   // seçili ana capture
  selectedVideoUri: null,   // seçili video kalitesi URI
  selectedAudioUri: null,   // seçili ses URI
  selectedSubUri:   null,   // seçili altyazı URI
  proxyBase: ''
};

const TYPE_LABELS = {
  playlist: '📋 Playlist',
  video:    '🎬 Video',
  audio:    '🎵 Ses',
  subtitle: '📝 Altyazı',
  unknown:  '❓ Bilinmiyor'
};

const LANG_NAMES = {
  tur: 'Türkçe', tr: 'Türkçe',
  eng: 'İngilizce', en: 'İngilizce',
  deu: 'Almanca', de: 'Almanca',
  fra: 'Fransızca', fr: 'Fransızca',
  spa: 'İspanyolca', es: 'İspanyolca',
  ara: 'Arapça', ar: 'Arapça',
};
function langName(code) {
  return LANG_NAMES[code?.toLowerCase()] || code?.toUpperCase() || '?';
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const r = await chrome.storage.local.get(['captures', 'proxyBase', 'proxyKey']);
  state.proxyBase  = r.proxyBase || '';
  state.proxyKey   = r.proxyKey  || '';
  state.captures   = r.captures  || [];

  if (state.captures.length === 0) {
    show('sec-waiting');
    startNoStreamTimer();
    return;
  }

  show('sec-main');
  renderCaptures();

  // Pending varsa 1 saniye sonra yenile
  const hasPending = state.captures.some(c => c.proxyStatus === 'pending');
  if (hasPending) setTimeout(refreshCaptures, 1200);
}

async function refreshCaptures() {
  const r = await chrome.storage.local.get('captures');
  state.captures = r.captures || [];
  renderCaptures();
  if (state.captures.some(c => c.proxyStatus === 'pending')) {
    setTimeout(refreshCaptures, 1200);
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderCaptures() {
  const list = document.getElementById('capture-list');
  list.innerHTML = '';

  // Öncelik sırası: playlist > video > subtitle > audio > unknown
  const order = { playlist: 0, video: 1, subtitle: 2, audio: 3, unknown: 4 };
  const sorted = [...state.captures].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));

  // İlk playlist veya video otomatik seçili gelsin
  if (!state.selectedId) {
    const first = sorted.find(c => c.type === 'playlist' || c.type === 'video');
    if (first) autoSelect(first);
  }

  sorted.forEach(c => {
    const card = buildCard(c);
    list.appendChild(card);
  });

  updateStatusBar();
  updateButtons();
}

function buildCard(c) {
  const card = document.createElement('div');
  card.className = 'capture-card' + (c.id === state.selectedId ? ' selected' : '');
  card.dataset.id = c.id;

  // Üst satır: tip etiketi + kısa URL
  const top = document.createElement('div');
  top.className = 'card-top';

  const typeEl = document.createElement('span');
  typeEl.className = 'card-type';
  typeEl.textContent = TYPE_LABELS[c.type] || '❓';

  const urlEl = document.createElement('span');
  urlEl.className = 'card-url';
  urlEl.textContent = shortUrl(c.url);
  urlEl.title = c.url;

  top.appendChild(typeEl);
  top.appendChild(urlEl);
  card.appendChild(top);

  // Parse edilmiş detaylar (sadece playlist/video için)
  if (c.parsed && (c.type === 'playlist' || c.type === 'video')) {
    const details = document.createElement('div');
    details.className = 'card-details';

    // Video kaliteleri
    if (c.parsed.videos.length > 0) {
      const row = document.createElement('div');
      row.className = 'detail-row';
      const lbl = document.createElement('span');
      lbl.className = 'detail-label';
      lbl.textContent = '🎬 Kalite';
      row.appendChild(lbl);

      c.parsed.videos.forEach((v, i) => {
        const pill = document.createElement('span');
        pill.className = 'pill' + (i === 0 && c.id === state.selectedId ? ' selected' : '');
        pill.textContent = v.label;
        pill.title = v.uri;
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          selectCapture(c);
          state.selectedVideoUri = v.uri;
          // Pill seçimini güncelle
          card.querySelectorAll('.detail-row .pill').forEach(p => {
            if (p.closest('.detail-row') === row) p.classList.remove('selected');
          });
          pill.classList.add('selected');
          updateButtons();
        });
        row.appendChild(pill);
      });
      details.appendChild(row);
    }

    // Ses parçaları — sadece ayrı track varsa göster
    if (c.parsed.audios.length > 0) {
      const row = document.createElement('div');
      row.className = 'detail-row';
      const lbl = document.createElement('span');
      lbl.className = 'detail-label';
      lbl.textContent = '🎵 Ses';
      row.appendChild(lbl);
      c.parsed.audios.forEach((a, i) => {
        const isSelected = state.selectedAudioUri === a.uri ||
          (!state.selectedAudioUri && a.isDefault) ||
          (!state.selectedAudioUri && i === 0);
        const pill = document.createElement('span');
        pill.className = 'pill' + (isSelected && c.id === state.selectedId ? ' selected' : '');
        pill.textContent = a.name || langName(a.language);
        pill.title = a.uri;
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          selectCapture(c);
          state.selectedAudioUri = a.uri;
          row.querySelectorAll('.pill').forEach(p => p.classList.remove('selected'));
          pill.classList.add('selected');
          updateButtons();
        });
        row.appendChild(pill);
      });
      details.appendChild(row);
    }
// Altyazı kartları — playlist/video ise tüm capture'lardan altyazıları getir
    if (c.type === 'playlist' || c.type === 'video') {
      const subCaptures = state.captures.filter(x => x.type === 'subtitle');
      if (subCaptures.length > 0) {
        const row = document.createElement('div');
        row.className = 'detail-row';
        const lbl = document.createElement('span');
        lbl.className = 'detail-label';
        lbl.textContent = '📝 Altyazı';
        row.appendChild(lbl);

        const noPill = document.createElement('span');
        noPill.className = 'pill' + (!state.selectedSubUri ? ' selected' : '');
        noPill.textContent = 'Yok';
        noPill.addEventListener('click', e => {
          e.stopPropagation();
          state.selectedSubUri = null;
          row.querySelectorAll('.pill').forEach(p => p.classList.remove('selected'));
          noPill.classList.add('selected');
          updateButtons();
        });
        row.appendChild(noPill);

        subCaptures.forEach(s => {
          const pill = document.createElement('span');
          pill.className = 'pill' + (state.selectedSubUri === s.url ? ' selected' : '');
          pill.textContent = s.url.includes('tur') ? 'Türkçe' :
                   s.url.includes('eng') ? 'İngilizce' : s.url.split('/').pop();
          pill.title = s.url;
          pill.addEventListener('click', e => {
            e.stopPropagation();
            state.selectedSubUri = s.url;
            row.querySelectorAll('.pill').forEach(p => p.classList.remove('selected'));
            pill.classList.add('selected');
            updateButtons();
          });
          row.appendChild(pill);
        });
        details.appendChild(row);
      }
    }
    // Altyazılar
    if (c.parsed.subtitles.length > 0) {
      const row = document.createElement('div');
      row.className = 'detail-row';
      const lbl = document.createElement('span');
      lbl.className = 'detail-label';
      lbl.textContent = '📝 Altyazı';
      row.appendChild(lbl);

      // "Yok" seçeneği
      const noPill = document.createElement('span');
      noPill.className = 'pill' + (!state.selectedSubUri && c.id === state.selectedId ? ' selected' : '');
      noPill.textContent = 'Yok';
      noPill.addEventListener('click', (e) => {
        e.stopPropagation();
        selectCapture(c);
        state.selectedSubUri = null;
        row.querySelectorAll('.pill').forEach(p => p.classList.remove('selected'));
        noPill.classList.add('selected');
        updateButtons();
      });
      row.appendChild(noPill);

      c.parsed.subtitles.forEach((s, i) => {
        const pill = document.createElement('span');
        pill.className = 'pill' + (i === 0 && c.id === state.selectedId && state.selectedSubUri ? ' selected' : '');
        pill.textContent = s.name || langName(s.language);
        pill.title = s.uri;
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          selectCapture(c);
          state.selectedSubUri = s.uri;
          row.querySelectorAll('.pill').forEach(p => p.classList.remove('selected'));
          pill.classList.add('selected');
          updateButtons();
        });
        row.appendChild(pill);
      });
      details.appendChild(row);
    }

    card.appendChild(details);
  }

  // Pending göstergesi
  if (c.proxyStatus === 'pending') {
    const pending = document.createElement('div');
    pending.style.cssText = 'font-size:10px;color:#a78bfa;margin-top:4px';
    pending.textContent = '⏳ Analiz ediliyor...';
    card.appendChild(pending);
  }

  // Fetch başarısız → URL'den tahmin notu
  if (c.proxyStatus === 'failed') {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10px;color:#fbbf24;margin-top:4px';
    note.textContent = '⚠️ İçerik okunamadı, URL\'den tahmin edildi';
    card.appendChild(note);
  }

  card.addEventListener('click', () => {
    if(c.type === 'subtitle'){
        state.selectedSubUri = state.selectedSubUri === c.url ? null : c.url;
        renderCaptures();
    } else if(c.type === 'audio'){
        state.selectedAudioUri = state.selectedAudioUri === c.url ? null : c.url;
        renderCaptures();
    } else {
        selectCapture(c);
        renderCaptures();
    }
});

  return card;
}

function autoSelect(c) {
  state.selectedId = c.id;
  if (c.parsed?.videos.length > 0) {
    state.selectedVideoUri = c.parsed.videos[0].uri;
  }
  // Ses: DEFAULT olanı seç, yoksa ilkini seç
  if (c.parsed?.audios.length > 0) {
    const defAudio = c.parsed.audios.find(a => a.isDefault) || c.parsed.audios[0];
    state.selectedAudioUri = defAudio.uri;
  }
  // Altyazı: varsayılan olarak yok
  state.selectedSubUri = null;
}

function selectCapture(c) {
  if (state.selectedId === c.id) return;
  state.selectedId       = c.id;
  state.selectedVideoUri = c.parsed?.videos[0]?.uri || null;
  const defAudio = c.parsed?.audios?.find(a => a.isDefault) || c.parsed?.audios?.[0];
  state.selectedAudioUri = defAudio?.uri || null;
  state.selectedSubUri   = null;
  updateButtons();
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

function updateStatusBar() {
  const bar = document.getElementById('status-bar');
  const sel = state.captures.find(c => c.id === state.selectedId);
  if (!sel) {
    bar.className = 'status-bar s-waiting';
    bar.textContent = `⏳ ${state.captures.length} stream yakalandı, seç`;
    return;
  }
  if (sel.proxyStatus === 'pending') {
    bar.className = 'status-bar s-pending';
    bar.textContent = '⏳ Analiz ediliyor...';
  } else if (sel.proxyStatus === 'direct') {
    bar.className = 'status-bar s-direct';
    bar.textContent = '✅ Direkt bağlantı — proxy gerekmez';
  } else if (sel.proxyStatus === 'proxy') {
    bar.className = 'status-bar s-proxy';
    bar.textContent = '🔄 Proxy üzerinden bağlanıyor';
  } else if (sel.proxyStatus === 'failed') {
    bar.className = 'status-bar s-failed';
    bar.textContent = '⚠️ İçerik okunamadı — URL\'den tahmin';
  } else {
    bar.className = 'status-bar s-waiting';
    bar.textContent = `📡 ${state.captures.length} stream yakalandı`;
  }
}

// ─── Butonlar ─────────────────────────────────────────────────────────────────

function updateButtons() {
  const hasSelected = !!state.selectedId;
  document.getElementById('btn-open').disabled  = !hasSelected;
  document.getElementById('btn-copy').disabled  = !hasSelected;
}

function getVideoUrl() {
  const sel = state.captures.find(c => c.id === state.selectedId);
  if (!sel) return null;

  // Seçili kalite varsa onu kullan, yoksa ana URL
  const videoUri = state.selectedVideoUri || sel.url;

  // Proxy durumuna göre URL seç
  if (sel.proxyStatus === 'proxy' && sel.proxyUrl) {
    // Proxy URL içinde orijinal URL encode edilmiş, video URI ile değiştir
    const base = new URL(sel.proxyUrl);
    base.searchParams.set('url', videoUri);
    return base.toString();
  }
  return videoUri;
}

// ─── Buton Event'leri ─────────────────────────────────────────────────────────

document.getElementById('btn-open').addEventListener('click', () => {
  const videoUrl = getVideoUrl();
  if (!videoUrl) return;
  const sel = state.captures.find(c => c.id === state.selectedId);
  const subParam   = state.selectedSubUri   ? '&subtitle=' + encodeURIComponent(state.selectedSubUri)   : '';
  const audioParam = state.selectedAudioUri ? '&audio='    + encodeURIComponent(state.selectedAudioUri) : '';
  const directFlag = (sel && sel.proxyStatus === 'direct') ? '&direct=1' : '';
 const cookieParam = sel.cookies ? '&cookies=' + encodeURIComponent(sel.cookies) : '';
const url = `${SETAFLIX}?autoload=${encodeURIComponent(videoUrl)}${audioParam}${subParam}${directFlag}${cookieParam}`;
  chrome.tabs.create({ url });
});

document.getElementById('btn-copy').addEventListener('click', async () => {
  const videoUrl = getVideoUrl();
  if (!videoUrl) return;
  await navigator.clipboard.writeText(videoUrl);
  showToast('Kopyalandı!');
});

document.getElementById('btn-clear').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR' });
  state.captures = [];
  state.selectedId = null;
  state.selectedVideoUri = null;
  state.selectedAudioUri = null;
  state.selectedSubUri = null;
  show('sec-waiting');
});

document.getElementById('btn-tunnel-waiting').addEventListener('click', showTunnel);
document.getElementById('btn-tunnel-main').addEventListener('click', showTunnel);

document.getElementById('btn-save-tunnel').addEventListener('click', async () => {
  const url = document.getElementById('tunnel-input').value.trim().replace(/\/$/, '');
  const key = document.getElementById('key-input').value.trim();
  if (!url) { showToastTunnel('Proxy URL gir!'); return; }
  if (!key) { showToastTunnel('Secret Key gir!'); return; }
  await chrome.storage.local.set({ proxyBase: url, proxyKey: key });
  state.proxyBase = url;
  state.proxyKey  = key;
  showToastTunnel('Kaydedildi ✓');
  setTimeout(init, 800);
});

// ─── Ekran Geçişleri ──────────────────────────────────────────────────────────

function show(id) {
  ['sec-waiting', 'sec-main', 'sec-tunnel'].forEach(s => {
    document.getElementById(s).style.display = s === id ? 'block' : 'none';
  });
}

function showTunnel() {
  show('sec-tunnel');
  if (state.proxyBase) document.getElementById('tunnel-input').value = state.proxyBase;
  if (state.proxyKey)  document.getElementById('key-input').value    = state.proxyKey;
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function shortUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.split('/').slice(-2).join('/');
    return u.hostname.split('.').slice(-2).join('.') + '/…/' + path;
  } catch(e) { return url.slice(0, 50); }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  setTimeout(() => t.textContent = '', 2000);
}
function showToastTunnel(msg) {
  const t = document.getElementById('toast-tunnel');
  t.textContent = msg;
  setTimeout(() => t.textContent = '', 2000);
}


// ─── Site Uyarı Timer'ı ──────────────────────────────────────────────────────

let noStreamTimer = null;

function startNoStreamTimer() {
  if (noStreamTimer) clearTimeout(noStreamTimer);
  noStreamTimer = setTimeout(async () => {
    // 10 saniye geçti, hâlâ stream yok
    const r = await chrome.storage.local.get('captures');
    const caps = r.captures || [];
    if (caps.length === 0) {
      const bar = document.getElementById('warn-bar');
      if (bar) bar.style.display = 'flex';
    }
  }, 10000);
}

function stopNoStreamTimer() {
  if (noStreamTimer) { clearTimeout(noStreamTimer); noStreamTimer = null; }
}

init();
