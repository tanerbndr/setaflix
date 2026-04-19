// ── STATE ──
const S={
  user:'',room:'',isHost:false,mode:'youtube',members:{},fbReady:false,
  myId:'u_'+Math.random().toString(36).substr(2,8),
  db:null,hls:null,pendingCookies:null,_autoloadPending:null,
  _directLoad:false,_audioUrl:null,_subtitleUrl:null,
  _audioHls:null,_audioEl:null,_audioSync:null,_hasExtAudio:false,
  hostCtrlLocked:false,
  allowedIds:{},
  _reconnectTimer:null,_pendingSeek:null
};
const SPEEDS=[0.5,0.75,1,1.25,1.5,2];
let _spdIdx=2;
const COLORS=['#6c47ff','#a78bfa','#38bdf8','#22d3a0','#fbbf24','#f87171','#fb923c','#e879f9'];
let _seekDebounce=null;

// ── AUTOLOAD ──
function checkAutoload(){
  const p=new URLSearchParams(window.location.search),al=p.get('autoload');
  if(!al)return;
  S._directLoad=p.get('direct')==='1';
  S._audioUrl=p.get('audio')?decodeURIComponent(p.get('audio')):null;
  S._subtitleUrl=p.get('subtitle')?decodeURIComponent(p.get('subtitle')):null;
  S.pendingCookies=p.get('cookies')?decodeURIComponent(p.get('cookies')):null;
  if(p.get('proxyBase'))localStorage.setItem('sf_proxy_base',decodeURIComponent(p.get('proxyBase')));
  if(p.get('proxyKey'))localStorage.setItem('sf_proxy_key',decodeURIComponent(p.get('proxyKey')));
  window.history.replaceState({},'',window.location.pathname);
  const doLoad=()=>{document.getElementById('vurl').value=decodeURIComponent(al);srcMode('url');loadVideo();};
  if(document.getElementById('room').classList.contains('on'))doLoad();
  else S._autoloadPending=doLoad;
}
window.addEventListener('load',checkAutoload);

// ── LOBBY ──
function ltab(t){
  document.querySelectorAll('.tab').forEach((b,i)=>b.classList.toggle('on',(i===0&&t==='create')||(i===1&&t==='join')));
  document.getElementById('p-create').classList.toggle('on',t==='create');
  document.getElementById('p-join').classList.toggle('on',t==='join');
}
function createRoom(){
  const name=v('cn')||'Misafir';
  S.user=name;S.room=genCode();S.isHost=true;
  enterRoom();
  if(S.fbReady)fbJoin();
  sysmsg('Oda oluşturuldu: '+S.room);
  sysmsg(name+' odaya katıldı.');
  toast('Oda hazır! Kodu paylaş: '+S.room);
}
function joinRoom(){
  const name=v('jn')||'Misafir';
  const code=v('rc').toUpperCase();
  if(!code){toast('Oda kodu gir!');return;}
  S.user=name;S.room=code;S.isHost=false;
  enterRoom();
  if(S.fbReady)fbJoin();
  sysmsg(name+' odaya katıldı.');
  toast('Odaya katıldın!');
}
function enterRoom(){
  show('room');hide('lobby');
  document.getElementById('dcode').textContent=S.room;
  addMember(S.myId,S.user,S.isHost);
  renderMembers();
  if(window.innerWidth<=640)document.getElementById('mob-tog').style.display='flex';
  if(S.isHost){document.getElementById('btn-hostctrl').style.display='';}

  if(S._autoloadPending){setTimeout(S._autoloadPending,400);S._autoloadPending=null;}
}

// ── HOST KONTROL ──
function toggleHostControl(){
  if(!S.isHost)return;
  S.hostCtrlLocked=!S.hostCtrlLocked;
  if(S.fbReady)S.db.ref('rooms/'+S.room+'/hostctrl').set({locked:S.hostCtrlLocked,allowed:S.allowedIds});
  updateCtrlLock();
  toast(S.hostCtrlLocked?'Kontrol kilitlendi — sadece sen yönetiyorsun':'Kontrol serbest bırakıldı');
}
function toggleMemberPerm(memberId,memberName){
  if(!S.isHost)return;
  if(S.allowedIds[memberId])delete S.allowedIds[memberId];
  else S.allowedIds[memberId]=true;
  if(S.fbReady)S.db.ref('rooms/'+S.room+'/hostctrl').set({locked:S.hostCtrlLocked,allowed:S.allowedIds});
  renderMembers();
  toast(S.allowedIds[memberId]?memberName+' kontrol yetkisi aldı':memberName+' yetkisi alındı');
}
function canControl(){
  if(S.isHost)return true;
  if(!S.hostCtrlLocked)return true;
  return !!S.allowedIds[S.myId];
}
function updateCtrlLock(){
  const btn=document.getElementById('btn-hostctrl');
  if(S.isHost){
    btn.textContent=S.hostCtrlLocked?'🔒 Kilitli':'🔓 Serbest';
    btn.classList.toggle('locked',S.hostCtrlLocked);
  }
  const player=document.getElementById('player');
  if(!canControl())player.classList.add('ctrl-locked');
  else player.classList.remove('ctrl-locked');
  renderMembers();
}

// ── SYNC ──
function applySyncCmd(d){
  const vid=document.querySelector('#vcont video');
  if(d.cmd==='load'){
    if(d.audioUrl)S._audioUrl=d.audioUrl;
    if(d.subtitleUrl)S._subtitleUrl=d.subtitleUrl;
    S._directLoad=false;
    loadVideoUrl(d.url,d.type,false);
    showSyncBar((d.name||'Birisi')+' video yükledi');
  }
  if(d.cmd==='play'&&vid){vid.play();showSyncBar('Oynatma sync edildi');}
  if(d.cmd==='pause'&&vid){vid.pause();showSyncBar('Durdurma sync edildi');}
  if(d.cmd==='seek'&&vid){
    clearTimeout(_seekDebounce);
    _seekDebounce=setTimeout(()=>{vid.currentTime=d.t;showSyncBar('Konum sync edildi → '+fmt(d.t));},300);
  }
  if(d.cmd==='subtitle'&&d.url){
    document.getElementById('suburl').value=d.url;
    setTimeout(()=>loadSubtitle(false),100);
    showSyncBar((d.name||'Birisi')+' altyazı ekledi');
  }
  if(d.cmd==='speed'&&vid){
    vid.playbackRate=d.spd;
    if(S._audioEl)S._audioEl.playbackRate=d.spd;
    document.getElementById('spd-btn').textContent=d.spd+'×';
    showSyncBar('Hız: '+d.spd+'×');
  }
}
function syncNow(){
  const vid=document.querySelector('#vcont video');
  if(vid){fbSync({cmd:'seek',t:vid.currentTime});toast('Sync gönderildi →');}
  else toast('Önce video yükle');
}
function showSyncBar(txt){
  const bar=document.getElementById('syncbar');
  bar.classList.remove('hidden');
  document.getElementById('sync-txt').textContent=txt;
  clearTimeout(bar._t);
  bar._t=setTimeout(()=>bar.classList.add('hidden'),3000);
}

// ── ODA KONTROL ──
function leaveRoom(){
  destroyHls();
  if(typeof cleanupWebRTC==='function')cleanupWebRTC();
  if(S.fbReady&&S.db)S.db.ref('rooms/'+S.room+'/members/'+S.myId).remove();
  hide('room');show('lobby');
  document.getElementById('vcont').innerHTML='<div class="vph" id="vph"><div class="vph-icon">▶</div><p>Video bekleniyor</p><small>Aşağıdan YouTube, m3u8 veya direkt URL ekle</small></div>';
  document.getElementById('msgs').innerHTML='';
  S.members={};S.hostCtrlLocked=false;S.allowedIds={};
  document.getElementById('mob-tog').style.display='none';
  document.getElementById('sidebar').classList.remove('mob-open');
  document.getElementById('btn-hostctrl').style.display='none';
}
function copyCode(){navigator.clipboard?.writeText(S.room).catch(()=>{});toast('Oda kodu kopyalandı: '+S.room+' 📋');}
function swtab(t){
  document.getElementById('st-chat').classList.toggle('on',t==='chat');
  document.getElementById('st-mem').classList.toggle('on',t==='members');
  document.getElementById('sp-chat').classList.toggle('on',t==='chat');
  document.getElementById('sp-mem').classList.toggle('on',t==='members');
}
function toggleMobSidebar(){document.getElementById('sidebar').classList.toggle('mob-open');}

// ── UTILS ──
function setProxyBase(){
  const cur=localStorage.getItem('sf_proxy_base')||'';
  const val=prompt('Tunnel URL gir:',cur);
  if(val!==null&&val.trim()){localStorage.setItem('sf_proxy_base',val.trim().replace(/\/$/,''));toast('Proxy URL kaydedildi ✓');}
}
function ytId(url){
  const pp=[/(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,/^([a-zA-Z0-9_-]{11})$/];
  for(const p of pp){const m=url.match(p);if(m)return m[1];}
  return null;
}
function v(id){return document.getElementById(id).value.trim();}
function show(id){document.getElementById(id).classList.add('on');}
function hide(id){document.getElementById(id).classList.remove('on');}
function genCode(){return Math.random().toString(36).substr(2,6).toUpperCase();}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function fmt(s){if(isNaN(s)||!s)return'0:00';const m=Math.floor(s/60),sc=Math.floor(s%60);return m+':'+(sc<10?'0':'')+sc;}
let _tt;
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('on');
  clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove('on'),2800);
}
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    const lob=document.getElementById('lobby');
    if(lob.classList.contains('on')){
      const cr=document.getElementById('p-create');
      if(cr.classList.contains('on'))createRoom();else joinRoom();
    }
  }
});
