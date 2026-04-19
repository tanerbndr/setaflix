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
let _wRef = null;

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
  if (_localStream) { _localStream.getTracks().forEach(t => t.stop()); _localStream = null; }
  if (_pc) { _pc.close(); _pc = null; }
  if (_wRef) { _wRef.remove(); _wRef = null; }
  _hideWebRTC();
  const btn = document.getElementById('btn-webrtc-share');
  if (btn) { btn.textContent = '📺 Ekran Paylaşımı Başlat'; btn.classList.remove('active'); }
  toast('Ekran paylaşımı durduruldu');
}

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
  if (_pc) { _pc.close(); _pc = null; }
  if (_wRef) { _wRef.off(); _wRef = null; }
  _hideWebRTC();
}

function cleanupWebRTC() {
  if (_localStream) stopScreenShare();
  else _viewerLeaveWebRTC();
}

function onWebRTCActive(d) {
  if (!d) { _viewerLeaveWebRTC(); return; }
  if (d.hostId === S.myId) return;
  _viewerJoinWebRTC(d.hostName);
}

function _showWebRTCLocal(stream) {
  const vcont = document.getElementById('vcont');
  vcont.innerHTML = '';
  const vid = document.createElement('video');
  vid.autoplay = true; vid.playsInline = true; vid.muted = true;
  vid.srcObject = stream;
  vid.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
  vcont.appendChild(vid);
  document.getElementById('player').style.display = 'none';
  _showWebRTCBadge(null, true);
}

function _showWebRTCRemote(stream, hostName) {
  const vcont = document.getElementById('vcont');
  vcont.innerHTML = '';
  const vid = document.createElement('video');
  vid.autoplay = true; vid.playsInline = true; vid.muted = false;
  vid.srcObject = stream;
  vid.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
  vcont.appendChild(vid);
  document.getElementById('player').style.display = 'none';
  _showWebRTCBadge(hostName, false);
  showSyncBar(hostName + ' ekranı paylaşıyor');
}

function _hideWebRTC() {
  const vcont = document.getElementById('vcont');
  vcont.innerHTML = '<div class="vph" id="vph"><div class="vph-icon">▶</div><p>Video bekleniyor</p><small>Aşağıdan YouTube, m3u8 veya direkt URL ekle</small></div>';
  document.getElementById('player').style.display = '';
  _hideWebRTCBadge();
  pReset();
}

function _showWebRTCBadge(hostName, isSharing) {
  _hideWebRTCBadge();
  const badge = document.createElement('div');
  badge.id = 'webrtc-badge';
  if (isSharing) {
    badge.className = 'webrtc-badge sharing';
    badge.textContent = '📺 Ekran Paylaşılıyor';
  } else {
    badge.className = 'webrtc-badge viewing';
    badge.innerHTML = `📺 <strong>${esc(hostName)}</strong> Ekranı Paylaşıyor &nbsp;·&nbsp; Sadece İzleyici Modu`;
  }
  document.getElementById('vwrap').appendChild(badge);
}

function _hideWebRTCBadge() {
  const b = document.getElementById('webrtc-badge');
  if (b) b.remove();
}
