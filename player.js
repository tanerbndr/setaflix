// ── VIDEO SOURCE ──
function srcMode(m){
  S.mode=m;
  document.getElementById('t-yt').classList.toggle('on',m==='youtube');
  document.getElementById('t-url').classList.toggle('on',m==='url');
  document.getElementById('t-wrtc').classList.toggle('on',m==='webrtc');
  document.getElementById('vurl').placeholder=m==='youtube'?'YouTube linki veya video ID...':'m3u8 veya mp4 linki yapıştır...';
  document.getElementById('vinrow').style.display=m==='webrtc'?'none':'flex';
  document.getElementById('p-webrtc').style.display=m==='webrtc'?'flex':'none';
}
function loadVideo(){
  const raw=v('vurl');
  if(!raw){toast('URL gir!');return;}
  loadVideoUrl(raw,S.mode,true);
}

function destroyHls(){if(S.hls){S.hls.destroy();S.hls=null;}stopExtAudio();}
function stopExtAudio(){
  if(S._audioHls){S._audioHls.destroy();S._audioHls=null;}
  if(S._audioEl){S._audioEl.pause();S._audioEl.remove();S._audioEl=null;}
  if(S._audioSync){clearInterval(S._audioSync);S._audioSync=null;}
  S._hasExtAudio=false;
}

function startExtAudio(audioUrl,video,direct){
  stopExtAudio();
  const audio=document.createElement('audio');
  audio.style.display='none';
  document.body.appendChild(audio);
  S._audioEl=audio;
  const base=localStorage.getItem('sf_proxy_base')||'https://setaflix-proxy.onrender.com';
  const key=localStorage.getItem('sf_proxy_key')||'';
  const proxy=base+'/proxy?key='+encodeURIComponent(key)+'&url=';
  const finalUrl=(direct||audioUrl.includes('trycloudflare.com')||audioUrl.includes('onrender.com'))?audioUrl:proxy+encodeURIComponent(audioUrl);
  const ah=new Hls({maxBufferLength:30,enableWorker:true});
  ah.loadSource(finalUrl);ah.attachMedia(audio);
  ah.on(Hls.Events.MANIFEST_PARSED,()=>{
    audio.volume=parseFloat(document.getElementById('vol-sl').value);
    audio.currentTime=video.currentTime;
    if(!video.paused)audio.play().catch(()=>{});
  });
  S._audioHls=ah;S._hasExtAudio=true;
  video.muted=true;video.volume=0;
  video.addEventListener('play',()=>audio.play().catch(()=>{}));
  video.addEventListener('pause',()=>audio.pause());
  video.addEventListener('seeked',()=>{audio.currentTime=video.currentTime;});
  S._audioSync=setInterval(()=>{if(!video.paused&&Math.abs(audio.currentTime-video.currentTime)>0.5)audio.currentTime=video.currentTime;},3000);
}

function isM3u8(url){return url.includes('.m3u8')||url.includes('m3u8')||url.includes('master.txt')||url.includes('.txt');}

function loadVideoUrl(raw,mode,broadcast){
  const cont=document.getElementById('vcont');
  destroyHls();pReset();

  // YouTube
  if(mode==='youtube'||raw.includes('youtube.com')||raw.includes('youtu.be')){
    const vid=ytId(raw);if(!vid){toast('Geçerli YouTube linki gir');return;}
    cont.innerHTML=`<iframe src="https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0&modestbranding=1&origin=${encodeURIComponent(window.location.origin)}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture; fullscreen"></iframe>`;
    document.getElementById('player').style.display='none';
    if(broadcast){
      fbSync({cmd:'load',url:raw,type:'youtube',name:S.user});
      fbSaveState(raw,'youtube',null,0,true);
      fbChat(S.user+' bir YouTube videosu başlattı.',true);
      toast('YouTube video yüklendi!');
    }
    return;
  }

  // m3u8
  if(isM3u8(raw)){
    let isDir=S._directLoad;
    const pendAudio=S._audioUrl;
    S._audioUrl=null;
    cont.innerHTML=`<video id="hlsvid" playsinline style="background:#000;width:100%;height:100%"></video>`;
    const video=document.getElementById('hlsvid');
    pBind(video);
    document.getElementById('player').style.display='';
    if(Hls.isSupported()){
      const hls=new Hls({maxBufferLength:30,maxMaxBufferLength:60,enableWorker:true,lowLatencyMode:false});
      const cp=S.pendingCookies?'&cookies='+encodeURIComponent(S.pendingCookies):'';S.pendingCookies=null;
      const base=localStorage.getItem('sf_proxy_base')||'https://setaflix-proxy.onrender.com';
      const key=localStorage.getItem('sf_proxy_key')||'';
      const proxy=base+'/proxy?key='+encodeURIComponent(key)+cp+'&url=';
      const finalUrl=(raw.includes('trycloudflare.com')||raw.includes('onrender.com')||isDir)?raw:proxy+encodeURIComponent(raw);
      S._directLoad=false;
      hls.loadSource(finalUrl);hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED,function(){
        if(pendAudio&&hls.audioTracks.length>0){
          const idx=hls.audioTracks.findIndex(t=>t.url===pendAudio);
          if(idx!==-1)hls.audioTrack=idx;
          else startExtAudio(pendAudio,video,isDir);
        } else if(pendAudio){
          startExtAudio(pendAudio,video,isDir);
        }
        if(S._subtitleUrl){document.getElementById('suburl').value=S._subtitleUrl;loadSubtitle();S._subtitleUrl=null;}
        video.play().catch(()=>{});
      });
      let _proxyRetried=false,_netErrCnt=0;
      hls.on(Hls.Events.ERROR,function(e,data){
        if(data.fatal){
          if(data.type===Hls.ErrorTypes.NETWORK_ERROR){
            if(isDir&&!_proxyRetried&&key){
              _proxyRetried=true;isDir=false;
              hls.loadSource(proxy+encodeURIComponent(raw));
              hls.startLoad();
            } else if(_netErrCnt<3){
              _netErrCnt++;
              toast('m3u8 ağ hatası — yeniden deneniyor ('+_netErrCnt+'/3)...');
              setTimeout(()=>hls.startLoad(),_netErrCnt*3000);
            } else {toast('Video yüklenemedi — proxy kontrol et');}
          }
          else if(data.type===Hls.ErrorTypes.MEDIA_ERROR){toast('Medya hatası — kurtarılıyor...');hls.recoverMediaError();}
          else{toast('Video yüklenemedi');hls.destroy();}
        }
      });
      hls.on(Hls.Events.FRAG_BUFFERED,()=>{
        const v2=document.querySelector('#vcont video');
        if(!v2||!v2.duration)return;
        let buf=0;for(let i=0;i<v2.buffered.length;i++)buf=Math.max(buf,v2.buffered.end(i));
        document.getElementById('prog-buf').style.width=(buf/v2.duration*100)+'%';
      });
      S.hls=hls;
    } else if(video.canPlayType('application/vnd.apple.mpegurl')){
      video.src=raw;video.addEventListener('loadedmetadata',()=>video.play().catch(()=>{}));
    } else {
      cont.innerHTML=`<div class="vph" style="height:100%;padding:2rem"><div class="vph-icon">✕</div><p>Bu tarayıcı m3u8 desteklemiyor</p></div>`;return;
    }
    if(broadcast){
      fbSync({cmd:'load',url:raw,type:'url',name:S.user,audioUrl:pendAudio||null,direct:isDir});
      fbSaveState(raw,'url',pendAudio,0,true);
      fbChat(S.user+' bir dizi/film başlattı.',true);
      toast('m3u8 video yüklendi!');
    }
    return;
  }

  // mp4
  cont.innerHTML=`<video id="hlsvid" src="${esc(raw)}" playsinline style="background:#000;width:100%;height:100%" onerror="this.outerHTML='<div class=vph style=height:100%;padding:2rem><div class=vph-icon>✕</div><p>Video yüklenemedi</p></div>'"></video>`;
  const v2=document.getElementById('hlsvid');pBind(v2);
  document.getElementById('player').style.display='';
  v2.play().catch(()=>{});
  if(broadcast){
    fbSync({cmd:'load',url:raw,type:'url',name:S.user});
    fbSaveState(raw,'url',null,0,true);
    fbChat(S.user+' bir video başlattı.',true);
    toast('Video yüklendi!');
  }
}

// ── SUBTITLE ──
function loadSubtitle(broadcast=true){
  const url=v('suburl');if(!url){toast('Altyazı URL gir!');return;}
  const video=document.querySelector('#vcont video');if(!video){toast('Önce video yükle!');return;}
  video.querySelectorAll('track').forEach(t=>t.remove());
  const track=document.createElement('track');
  track.kind='subtitles';
  track.label=url.includes('tur')?'Türkçe':url.includes('eng')?'English':'Altyazı';
  track.srclang=url.includes('tur')?'tr':url.includes('eng')?'en':'tr';
  const savedBase=localStorage.getItem('sf_proxy_base')||'https://setaflix-proxy.onrender.com';
  const savedKey=localStorage.getItem('sf_proxy_key')||'';
  const proxyUrl=savedBase+'/proxy?key='+encodeURIComponent(savedKey)+'&url=';
  const isDirectSub=url.includes('trycloudflare.com')||url.includes('onrender.com');
  const fetchUrl=isDirectSub?url:proxyUrl+encodeURIComponent(url);
  track.default=true;
  fetch(fetchUrl)
    .then(r=>r.blob())
    .then(blob=>{track.src=URL.createObjectURL(blob);})
    .catch(()=>toast('Altyazı yüklenemedi'));
  video.appendChild(track);
  track.addEventListener('load',()=>{if(video.textTracks.length>0)video.textTracks[0].mode='showing';document.getElementById('sub-status').textContent='✓ Altyazı aktif';toast('Altyazı yüklendi!');});
  track.addEventListener('error',()=>{document.getElementById('sub-status').textContent='';toast('Altyazı yüklenemedi');});
  setTimeout(()=>{if(video.textTracks.length>0){video.textTracks[0].mode='showing';document.getElementById('sub-status').textContent='✓ Altyazı aktif';}},500);
  if(S.fbReady&&broadcast){fbSync({cmd:'subtitle',url,name:S.user});fbChat(S.user+' altyazı ekledi.',true);}
}
function removeSubtitle(){
  const video=document.querySelector('#vcont video');if(!video){toast('Video yok!');return;}
  video.querySelectorAll('track').forEach(t=>t.remove());
  for(let i=0;i<video.textTracks.length;i++)video.textTracks[i].mode='disabled';
  document.getElementById('sub-status').textContent='';document.getElementById('suburl').value='';toast('Altyazı kaldırıldı');
}

// ── CUSTOM PLAYER ──
let _raf=null,_tapCnt=0,_tapSide='',_tapTimer=null,_hideTimer=null;

function pReset(){
  document.getElementById('prog-fill').style.width='0%';
  document.getElementById('prog-buf').style.width='0%';
  document.getElementById('time-txt').textContent='0:00 / 0:00';
  document.getElementById('ico-play').style.display='';
  document.getElementById('ico-pause').style.display='none';
  _spdIdx=2;document.getElementById('spd-btn').textContent='1×';
  if(_raf){cancelAnimationFrame(_raf);_raf=null;}
  document.getElementById('player').classList.remove('visible','wrtc-mode');
}

function pBind(video){
  const vw=document.getElementById('vwrap');
  vw.addEventListener('mousemove',pShow);
  vw.addEventListener('touchstart',pTouchShow,{passive:true});

  const pw=document.getElementById('prog-wrap');
  pw.addEventListener('mousedown',e=>{e.stopPropagation();if(!canControl()){toast('Host kontrolü aktif');return;}pProgSeek(e,video,pw);});
  pw.addEventListener('touchstart',e=>{e.stopPropagation();if(!canControl()){toast('Host kontrolü aktif');return;}pProgSeekTouch(e,video,pw);},{passive:false});

  vw.addEventListener('click',e=>{
    if(e.target.closest('#player'))return;
    const rect=vw.getBoundingClientRect();
    const side=(e.clientX-rect.left)<rect.width/2?'left':'right';
    _tapCnt++;_tapSide=side;
    clearTimeout(_tapTimer);
    _tapTimer=setTimeout(()=>{
      if(_tapCnt>=2)pDoubleTap(_tapSide,_tapCnt);
      else pPlay();
      _tapCnt=0;
    },250);
  });

  function raf(){pUpdateTime(video);_raf=requestAnimationFrame(raf);}
  _raf=requestAnimationFrame(raf);

  let _seekSendTimer=null;
  video.addEventListener('play',()=>{
    document.getElementById('ico-play').style.display='none';
    document.getElementById('ico-pause').style.display='';
    pShow();
    fbSync({cmd:'play'});
    if(S.fbReady)S.db.ref('rooms/'+S.room+'/state').update({playing:true,currentTime:video.currentTime,ts:Date.now()});
  });
  video.addEventListener('pause',()=>{
    document.getElementById('ico-play').style.display='';
    document.getElementById('ico-pause').style.display='none';
    fbSync({cmd:'pause'});
    if(S.fbReady)S.db.ref('rooms/'+S.room+'/state').update({playing:false,currentTime:video.currentTime,ts:Date.now()});
  });
  video.addEventListener('seeked',()=>{
    if(S.fbReady&&S.isHost)S.db.ref('rooms/'+S.room+'/state').update({currentTime:video.currentTime,ts:Date.now()});
    clearTimeout(_seekSendTimer);
    _seekSendTimer=setTimeout(()=>{fbSync({cmd:'seek',t:video.currentTime});},500);
  });

  if(S._pendingSeek){
    const ps=S._pendingSeek;S._pendingSeek=null;
    const doSeek=()=>{
      if(ps.time>2)video.currentTime=ps.time;
      if(ps.playing)video.play().catch(()=>{});else video.pause();
      showSyncBar('Mevcut konuma atlandı: '+fmt(ps.time));
    };
    if(video.readyState>=2)doSeek();else video.addEventListener('canplay',doSeek,{once:true});
  }

  setInterval(()=>{
    if(S.isHost&&S.fbReady&&video&&!video.paused&&video.currentTime>0){
      S.db.ref('rooms/'+S.room+'/state').update({currentTime:video.currentTime,playing:!video.paused,ts:Date.now()});
    }
  },30000);
}

function pShow(){
  const p=document.getElementById('player');p.classList.add('visible');
  clearTimeout(_hideTimer);_hideTimer=setTimeout(()=>p.classList.remove('visible'),3000);
}
function pTouchShow(){
  const p=document.getElementById('player');
  if(p.classList.contains('visible'))p.classList.remove('visible');
  else pShow();
}
function pUpdateTime(video){
  if(!video||!video.duration)return;
  const pct=video.currentTime/video.duration*100;
  document.getElementById('prog-fill').style.width=pct+'%';
  document.getElementById('time-txt').textContent=fmt(video.currentTime)+' / '+fmt(video.duration);
}
function pProgSeek(e,video,pw){
  const go=x=>{const r=pw.getBoundingClientRect();video.currentTime=Math.max(0,Math.min(1,(x-r.left)/r.width))*video.duration;};
  go(e.clientX);
  const mm=ev=>go(ev.clientX);
  const mu=()=>{document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);};
  document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);
}
function pProgSeekTouch(e,video,pw){
  e.preventDefault();
  const go=t=>{const r=pw.getBoundingClientRect();video.currentTime=Math.max(0,Math.min(1,(t.clientX-r.left)/r.width))*video.duration;};
  go(e.touches[0]);
  const tm=ev=>go(ev.touches[0]);
  const te=()=>{pw.removeEventListener('touchmove',tm);pw.removeEventListener('touchend',te);};
  pw.addEventListener('touchmove',tm,{passive:false});pw.addEventListener('touchend',te);
}
function pPlay(){
  if(!canControl()){toast('Host kontrolü aktif');return;}
  const v=document.querySelector('#vcont video');if(!v)return;
  const cf=document.getElementById('cf-icon');
  function cfFlash(icon){
    if(!cf)return;
    cf.textContent=icon;
    cf.className='cf-icon show';
    clearTimeout(cf._t);
    cf._t=setTimeout(()=>{cf.classList.replace('show','fade');setTimeout(()=>{cf.className='cf-icon';},350);},600);
  }
  pShow();
  if(v.paused){
    if(S.hls){
      const lvl=S.hls.levels&&S.hls.levels[S.hls.currentLevel];
      if(lvl&&lvl.details&&lvl.details.live&&S.hls.liveSyncPosition)
        v.currentTime=S.hls.liveSyncPosition;
    }
    v.play().catch(()=>{});
    cfFlash('▶');
  } else {
    v.pause();
    cfFlash('⏸');
  }
}
function pSeek(s){
  if(!canControl()){toast('Host kontrolü aktif');return;}
  const v=document.querySelector('#vcont video');if(!v)return;
  v.currentTime=Math.max(0,Math.min(v.duration||0,v.currentTime+s));
}
function pDoubleTap(side,cnt){
  if(!canControl()){toast('Host kontrolü aktif');return;}
  const secs=Math.max(cnt-1,1)*10;
  pSeek(side==='right'?secs:-secs);
  const el=document.getElementById(side==='right'?'sf-right':'sf-left');
  const txt=document.getElementById(side==='right'?'sf-right-txt':'sf-left-txt');
  txt.textContent=(side==='right'?'':'◀◀ ')+secs+'s'+(side==='right'?' ▶▶':'');
  el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),700);
}
function pMute(){
  const ICO_MUTE='M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z';
  const ICO_VOL='M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z';
  const sl=document.getElementById('vol-sl');
  if(S._hasExtAudio&&S._audioEl){
    S._audioEl.muted=!S._audioEl.muted;
    document.getElementById('ico-vol').setAttribute('d',S._audioEl.muted?ICO_MUTE:ICO_VOL);
    if(sl)sl.style.opacity=S._audioEl.muted?'0.3':'1';
  } else {
    const v=document.querySelector('#vcont video');if(!v)return;
    v.muted=!v.muted;
    document.getElementById('ico-vol').setAttribute('d',v.muted?ICO_MUTE:ICO_VOL);
    if(sl)sl.style.opacity=v.muted?'0.3':'1';
  }
}
function pVol(val){
  val=parseFloat(val);
  if(S._hasExtAudio&&S._audioEl){S._audioEl.volume=val;S._audioEl.muted=val===0;}
  else{const v=document.querySelector('#vcont video');if(v){v.volume=val;v.muted=val===0;}}
}
function pSpeed(){
  if(!canControl()){toast('Host kontrolü aktif');return;}
  _spdIdx=(_spdIdx+1)%SPEEDS.length;
  const spd=SPEEDS[_spdIdx];
  const v=document.querySelector('#vcont video');if(v)v.playbackRate=spd;
  if(S._audioEl)S._audioEl.playbackRate=spd;
  document.getElementById('spd-btn').textContent=spd+'×';
  fbSync({cmd:'speed',spd});
}
function pFullscreen(){
  const vw=document.getElementById('vwrap');
  const vid=document.querySelector('#vcont video');
  const isFs=document.fullscreenElement||document.webkitFullscreenElement;
  if(!isFs){
    // Önce vwrap fullscreen dene (kendi butonlarımız görünsün)
    // iOS 16.4+ vwrap.requestFullscreen destekler; daha eski iOS'ta catch ile native'e düşer
    const fn=vw.requestFullscreen||vw.webkitRequestFullscreen;
    if(fn){
      fn.call(vw).catch(()=>{
        if(vid&&vid.webkitEnterFullscreen)vid.webkitEnterFullscreen();
      });
    } else if(vid&&vid.webkitEnterFullscreen){
      vid.webkitEnterFullscreen();
    }
    screen.orientation?.lock?.('landscape-primary').catch(()=>{});
    document.getElementById('ico-fs').setAttribute('d','M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z');
  } else {
    (document.exitFullscreen||document.webkitExitFullscreen).call(document);
    screen.orientation?.unlock?.();
  }
}
['fullscreenchange','webkitfullscreenchange'].forEach(ev=>{
  document.addEventListener(ev,()=>{
    const isFs=document.fullscreenElement||document.webkitFullscreenElement;
    const player=document.getElementById('player');
    if(isFs&&player.classList.contains('wrtc-mode'))player.classList.add('visible');
    if(!isFs)document.getElementById('ico-fs').setAttribute('d','M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z');
  });
});
