// ── WEBRTC SCREEN SHARE ──
const ICE_CFG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ]
};

let _pc = null;
let _localStream = null;
let _liveStream = null;
let _wRef = null;

// DVR buffer
let _recorder = null;
let _recChunks = [];
let _recTimes = [];
let _recFirstChunk = null;
let _rewindUrl = null;
let _isViewerLive = true;

// ── HOST ──

async function startScreenShare() {
  if (!S.isHost) { toast('Sadece oda sahibi ekran paylaşabilir'); return; }
  if (!S.fbReady) { toast('Firebase bağlı değil'); return; }

  try {
    _localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true
    });
  } catch (e) {
    toast('Ekran erişimi reddedildi');
    return;
  }

  destroyHls();
  _wRef = S.db.ref('rooms/' + S.room + '/webrtc');
  await _wRef.remove();

  _pc = new RTCPeerConnection(ICE_CFG);
  _localStream.getTracks().forEach(t => _pc.addTrack(t, _localStream));

  _pc.onicecandidate = e => {
    if (e.candidate) _wRef.child('ice_host').push(e.candidate.toJSON());
  };

  const offer = await _pc.createOffer();
  await _pc.setLocalDescription(offer);
  await _wRef.child('offer').set({ sdp: offer.sdp, type: offer.type });
  await _wRef.child('active').set({ hostId: S.myId, hostName: S.user, ts: Date.now() });

  _wRef.child('answer').on('value', async snap => {
    const d = snap.val();
    if (!d || !_pc || _pc.remoteDescription) return;
    await _pc.setRemoteDescription(new RTCSessionDescription(d));
  });

  _wRef.child('ice_viewer').on('child_added', snap => {
    const d = snap.val();
    if (d && _pc) _pc.addIceCandidate(new RTCIceCandidate(d)).catch(() => {});
  });

  _localStream.getVideoTracks()[0].onended = () => stopScreenShare();

  _showWebRTCLocal(_localStream);
  const btn = document.getElementById('btn-webrtc-share');
  btn.textContent = '⏹ Paylaşımı Durdur';
  btn.classList.add('active');
  toast('Ekran paylaşımı başladı');
}

async function stopScreenShare() {
  if (!S.isHost) { toast('Sadece oda sahibi paylaşımı durdurabilir'); return; }
  if (_localStream) { _localStream.getTracks().forEach(t => t.stop()); _localStream = null; }
  if (_pc) { _pc.close(); _pc = null; }
  if (_wRef) { _wRef.remove(); _wRef = null; }
  _hideWebRTC();
  const btn = document.getElementById('btn-webrtc-share');
  if (btn) { btn.textContent = '📺 Ekran Paylaşımı Başlat'; btn.classList.remove('active'); }
  toast('Ekran paylaşımı durduruldu');
}

// ── VIEWER ──

async function _viewerJoinWebRTC(hostName) {
  if (_pc) return;
  _wRef = S.db.ref('rooms/' + S.room + '/webrtc');
  _pc = new RTCPeerConnection(ICE_CFG);

  _pc.ontrack = e => _showWebRTCRemote(e.streams[0], hostName);

  _pc.onicecandidate = e => {
    if (e.candidate) _wRef.child('ice_viewer').push(e.candidate.toJSON());
  };

  _pc.onconnectionstatechange = () => {
    if (_pc && (_pc.connectionState === 'disconnected' || _pc.connectionState === 'failed')) {
      _hideWebRTC();
    }
  };

  _wRef.child('offer').once('value', async snap => {
    const d = snap.val();
    if (!d || !_pc) return;
    await _pc.setRemoteDescription(new RTCSessionDescription(d));
    const answer = await _pc.createAnswer();
    await _pc.setLocalDescription(answer);
    await _wRef.child('answer').set({ sdp: answer.sdp, type: answer.type });
  });

  _wRef.child('ice_host').on('child_added', snap => {
    const d = snap.val();
    if (d && _pc) _pc.addIceCandidate(new RTCIceCandidate(d)).catch(() => {});
  });
}

function _viewerLeaveWebRTC() {
  _stopBuffer();
  if (_pc) { _pc.close(); _pc = null; }
  if (_wRef) { _wRef.off(); _wRef = null; }
  _hideWebRTC();
}

// ── GENEL ──

function cleanupWebRTC() {
  if (_localStream) stopScreenShare();
  else _viewerLeaveWebRTC();
}

function onWebRTCActive(d) {
  if (!d) { _viewerLeaveWebRTC(); return; }
  if (d.hostId === S.myId) return;
  _viewerJoinWebRTC(d.hostName);
}

// ── PLAYER GÖSTER / GİZLE ──

function _showWebRTCLocal(stream) {
  const vcont = document.getElementById('vcont');
  vcont.innerHTML = '';
  const vid = document.createElement('video');
  vid.autoplay = true; vid.playsInline = true; vid.muted = false;
  vid.srcObject = stream;
  vid.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
  vcont.appendChild(vid);
  document.getElementById('player').style.display = '';
  _lockPlayerForHost(vid);
  _showWebRTCBadge(null, true);
}

function _showWebRTCRemote(stream, hostName) {
  _liveStream = stream;
  _isViewerLive = true;
  const vcont = document.getElementById('vcont');
  vcont.innerHTML = '';
  const vid = document.createElement('video');
  vid.autoplay = true; vid.playsInline = true; vid.muted = false;
  vid.srcObject = stream;
  vid.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
  vcont.appendChild(vid);
  document.getElementById('player').style.display = '';
  _lockPlayerForViewer(vid);
  _showWebRTCBadge(hostName, false);
  _startBuffer(stream);
  showSyncBar(hostName + ' ekranı paylaşıyor');
}

function _hideWebRTC() {
  _stopBuffer();
  _unlockPlayer();
  _liveStream = null;
  _isViewerLive = true;
  if (_rewindUrl) { URL.revokeObjectURL(_rewindUrl); _rewindUrl = null; }
  const vcont = document.getElementById('vcont');
  vcont.innerHTML = '<div class="vph" id="vph"><div class="vph-icon">▶</div><p>Video bekleniyor</p><small>Aşağıdan YouTube, m3u8 veya direkt URL ekle</small></div>';
  document.getElementById('player').style.display = '';
  _hideWebRTCBadge();
  const vol = document.getElementById('webrtc-vol');
  if (vol) vol.remove();
  const glb = document.getElementById('webrtc-golive');
  if (glb) glb.remove();
  pReset();
}

// ── PLAYER KİLİT / AÇMA ──

function _lockPlayerForHost(vid) {
  const player = document.getElementById('player');
  player.classList.add('wrtc-mode');
  player.classList.add('visible');
  const vw = document.getElementById('vwrap');
  vw.addEventListener('mousemove', pShow);
  vw.addEventListener('touchstart', pTouchShow, {passive:true});
  document.getElementById('btn-pp').style.display = 'none';
  document.getElementById('btn-back10').style.display = 'none';
  document.getElementById('btn-fwd10').style.display = 'none';
  document.getElementById('spd-btn').style.display = 'none';
  document.getElementById('time-txt').innerHTML = '<span class="live-dot-txt">🔴 CANLI</span>';
  _appendVolControl(vid);
}

function _lockPlayerForViewer(vid) {
  const player = document.getElementById('player');
  player.classList.add('wrtc-mode');
  player.classList.add('visible');
  const vw = document.getElementById('vwrap');
  vw.addEventListener('mousemove', pShow);
  vw.addEventListener('touchstart', pTouchShow, {passive:true});
  document.getElementById('btn-pp').style.display = 'none';
  document.getElementById('btn-fwd10').style.display = 'none';
  document.getElementById('spd-btn').style.display = 'none';
  document.getElementById('time-txt').innerHTML = '<span class="live-dot-txt">🔴 CANLI</span>';
  // -10s butonu buffer'a geri sarar
  document.getElementById('btn-back10').onclick = () => rewindWebRTC(10);
  _appendVolControl(vid);
}

function _unlockPlayer() {
  const player = document.getElementById('player');
  player.classList.remove('wrtc-mode', 'visible');
  const vw = document.getElementById('vwrap');
  vw.removeEventListener('mousemove', pShow);
  vw.removeEventListener('touchstart', pTouchShow);
  document.getElementById('btn-pp').style.display = '';
  document.getElementById('btn-back10').style.display = '';
  document.getElementById('btn-fwd10').style.display = '';
  document.getElementById('spd-btn').style.display = '';
  document.getElementById('time-txt').textContent = '0:00 / 0:00';
  document.getElementById('btn-back10').onclick = () => pSeek(-10);
}

function _appendVolControl(vid) {
  const existing = document.getElementById('webrtc-vol');
  if (existing) existing.remove();
  const bar = document.createElement('div');
  bar.id = 'webrtc-vol';
  bar.className = 'webrtc-vol';
  bar.innerHTML = `
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
    <input type="range" min="0" max="1" step="0.05" value="${vid.volume}" oninput="document.querySelector('#vcont video').volume=parseFloat(this.value)">
  `;
  document.getElementById('player').querySelector('.ctrl-row').appendChild(bar);
}

// ── DVR BUFFER (Son 60sn) ──

function _startBuffer(stream) {
  _recChunks = []; _recTimes = []; _recFirstChunk = null;
  const mime = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
    .find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) return;
  try {
    _recorder = new MediaRecorder(stream, { mimeType: mime });
  } catch(e) { return; }

  _recorder.ondataavailable = e => {
    if (!e.data || e.data.size === 0) return;
    const now = Date.now();
    if (!_recFirstChunk) _recFirstChunk = e.data;
    _recChunks.push(e.data);
    _recTimes.push(now);
    const cutoff = now - 62000;
    while (_recTimes.length > 2 && _recTimes[1] < cutoff) {
      _recChunks.shift(); _recTimes.shift();
    }
  };
  _recorder.start(1000);
}

function _stopBuffer() {
  if (_recorder && _recorder.state !== 'inactive') _recorder.stop();
  _recorder = null;
  _recChunks = []; _recTimes = []; _recFirstChunk = null;
}

// ── DVR KONTROL ──

function rewindWebRTC(secs) {
  if (_recChunks.length < 3) { toast('Henüz yeterli buffer yok (birkaç sn bekle)'); return; }
  _isViewerLive = false;

  if (_rewindUrl) URL.revokeObjectURL(_rewindUrl);
  const chunks = _recFirstChunk && _recChunks[0] !== _recFirstChunk
    ? [_recFirstChunk, ..._recChunks]
    : [..._recChunks];
  _rewindUrl = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));

  const vcont = document.getElementById('vcont');
  vcont.innerHTML = '';
  const vid = document.createElement('video');
  vid.src = _rewindUrl;
  vid.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
  vcont.appendChild(vid);

  vid.addEventListener('loadedmetadata', () => {
    vid.currentTime = Math.max(0, vid.duration - secs);
    vid.play().catch(() => {});
    document.getElementById('time-txt').textContent = '';
  });

  // Player kontrollerini buffer modu için aç
  document.getElementById('btn-pp').style.display = '';
  document.getElementById('btn-back10').onclick = () => pSeek(-10);
  pBind(vid);

  _showGoLiveBtn();
  document.getElementById('webrtc-badge').innerHTML =
    `📺 Buffer modunda izliyorsun`;
}

function goLiveWebRTC() {
  if (!_liveStream) return;
  _isViewerLive = true;
  if (_rewindUrl) { URL.revokeObjectURL(_rewindUrl); _rewindUrl = null; }

  const vcont = document.getElementById('vcont');
  vcont.innerHTML = '';
  const vid = document.createElement('video');
  vid.autoplay = true; vid.playsInline = true; vid.muted = false;
  vid.srcObject = _liveStream;
  vid.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
  vcont.appendChild(vid);

  // Player'ı tekrar viewer moduna al
  document.getElementById('btn-pp').style.display = 'none';
  document.getElementById('btn-back10').onclick = () => rewindWebRTC(10);
  document.getElementById('time-txt').innerHTML = '<span class="live-dot-txt">🔴 CANLI</span>';
  _appendVolControl(vid);

  _hideGoLiveBtn();
  _showWebRTCBadge(null, false);
  const badge = document.getElementById('webrtc-badge');
  if (badge) badge.innerHTML = '📺 Canlıya döndün · İzleyici Modu';
  setTimeout(() => {
    const b = document.getElementById('webrtc-badge');
    if (b) b.innerHTML = `📺 Ekranı Paylaşıyor &nbsp;·&nbsp; Sadece İzleyici Modu`;
  }, 2000);
}

function _showGoLiveBtn() {
  let btn = document.getElementById('webrtc-golive');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'webrtc-golive';
    btn.className = 'webrtc-golive';
    btn.onclick = goLiveWebRTC;
    document.getElementById('vwrap').appendChild(btn);
  }
  btn.textContent = '🔴 Canlıya Dön';
}

function _hideGoLiveBtn() {
  const btn = document.getElementById('webrtc-golive');
  if (btn) btn.remove();
}

// ── BADGE ──

function _showWebRTCBadge(hostName, isSharing) {
  _hideWebRTCBadge();
  const badge = document.createElement('div');
  badge.id = 'webrtc-badge';
  if (isSharing) {
    badge.className = 'webrtc-badge sharing';
    badge.textContent = '📺 Ekran Paylaşılıyor';
  } else {
    badge.className = 'webrtc-badge viewing';
    badge.innerHTML = hostName
      ? `📺 <strong>${esc(hostName)}</strong> Ekranı Paylaşıyor &nbsp;·&nbsp; Sadece İzleyici Modu`
      : '📺 Sadece İzleyici Modu';
  }
  document.getElementById('vwrap').appendChild(badge);
}

function _hideWebRTCBadge() {
  const b = document.getElementById('webrtc-badge');
  if (b) b.remove();
}
