// ── FIREBASE CONFIG ──
const FB_CFG={
  apiKey:"AIzaSyCbK26N5Nflnbm5266Ik3y5IWuYnlFlvig",
  authDomain:"watchtogether-c2963.firebaseapp.com",
  databaseURL:"https://watchtogether-c2963-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:"watchtogether-c2963",
  appId:"1:906945713812:web:91b37199b40280da160681"
};

function initFB(cfg){
  try{
    if(firebase.apps.length)firebase.apps.forEach(a=>a.delete());
    firebase.initializeApp(cfg);
    S.db=firebase.database();S.fbReady=true;
    toast('Firebase bağlandı ✓');return true;
  }catch(e){toast('Firebase hatası: '+e.message);return false;}
}
function saveFirebase(){
  const cfg={apiKey:v('fb-apikey'),authDomain:v('fb-authdomain'),databaseURL:v('fb-dburl'),projectId:v('fb-projectid')};
  if(!cfg.apiKey||!cfg.databaseURL){toast('API Key ve Database URL zorunlu!');return;}
  localStorage.setItem('wt_fb',JSON.stringify(cfg));
  if(initFB(cfg))document.getElementById('fb-modal').classList.add('hidden');
}
function skipFirebase(){document.getElementById('fb-modal').classList.add('hidden');toast('Demo modda çalışıyor');}
function tryInitFB(n){
  if(typeof firebase!=='undefined'&&firebase.initializeApp)initFB(FB_CFG);
  else if(n>0)setTimeout(()=>tryInitFB(n-1),500);
  else toast('Firebase SDK yüklenemedi');
}
window.addEventListener('load',()=>tryInitFB(10));

// ── FIREBASE ROOM ──
function fbJoin(){
  const ref=S.db.ref('rooms/'+S.room);
  ref.child('members/'+S.myId).set({name:S.user,host:S.isHost,color:COLORS[Object.keys(S.members).length%COLORS.length],ts:Date.now()});
  ref.child('members/'+S.myId).onDisconnect().remove();

  ref.child('members').on('value',snap=>{
    const d=snap.val()||{};
    const prevCount=Object.keys(S.members).length;
    S.members={};
    Object.entries(d).forEach(([id,m])=>addMember(id,m.name,m.host,m.color));
    renderMembers();
    document.getElementById('vcnt-txt').textContent=Object.keys(S.members).length+' kişi';
    const newCount=Object.keys(S.members).length;
    if(S.isHost&&newCount>prevCount&&prevCount>0){
      const vid=document.querySelector('#vcont video');
      if(vid&&vid.src){
        setTimeout(()=>{
          const newName=Object.values(d).slice(-1)[0]?.name||'Biri';
          toast(newName+' odaya katıldı — sync gönderiliyor...');
          fbSync({cmd:'seek',t:vid.currentTime});
        },2000);
      }
    }
  });

  ref.child('chat').limitToLast(50).on('child_added',snap=>{
    const d=snap.val();
    if(d.uid===S.myId)return;
    addMsgEl(d.name,d.text,false,d.sys,d.color);
  });
  ref.child('sync').on('value',snap=>{
    const d=snap.val();
    if(!d||d.uid===S.myId)return;
    applySyncCmd(d);
  });
  ref.child('react').limitToLast(10).on('child_added',snap=>{
    const d=snap.val();
    if(d.uid===S.myId)return;
    floatReact(d.emoji);
  });

  ref.child('webrtc/active').on('value',snap=>{
    if(typeof onWebRTCActive==='function')onWebRTCActive(snap.val());
  });

  ref.child('hostctrl').on('value',snap=>{
    const d=snap.val();
    if(!d)return;
    S.hostCtrlLocked=d.locked||false;
    S.allowedIds=d.allowed||{};
    updateCtrlLock();
  });

  ref.child('state').once('value',snap=>{
    if(S._hasAutoload)return;
    const d=snap.val();
    if(!d||!d.url)return;
    if(d.audioUrl)S._audioUrl=d.audioUrl;
    S._directLoad=false;
    loadVideoUrl(d.url,d.type||'url',false);
    S._pendingSeek={time:d.currentTime||0,playing:d.playing};
  });

  S.db.ref('.info/connected').on('value',snap=>{
    if(snap.val()===true){
      if(S._reconnectTimer){
        clearTimeout(S._reconnectTimer);
        S._reconnectTimer=null;
        const vid=document.querySelector('#vcont video');
        if(vid&&vid.src){
          ref.child('state').once('value',st=>{
            const d=st.val();
            if(d&&d.currentTime){
              vid.currentTime=d.currentTime;
              if(d.playing)vid.play().catch(()=>{});
              showSyncBar('Yeniden bağlandı — konum güncellendi');
              toast('Bağlantı yenilendi ✓');
            }
          });
        }
      }
    } else {
      S._reconnectTimer=setTimeout(()=>{toast('Bağlantı kesildi, yeniden bağlanıyor...');},2000);
    }
  });
}

function fbChat(text,sys=false){
  if(!S.fbReady)return;
  S.db.ref('rooms/'+S.room+'/chat').push({uid:S.myId,name:S.user,text,sys,color:memberColor(S.myId),ts:Date.now()});
}
function fbSync(cmd){
  if(!S.fbReady)return;
  S.db.ref('rooms/'+S.room+'/sync').set({uid:S.myId,...cmd,ts:Date.now()});
}
function fbReact(emoji){
  if(!S.fbReady)return;
  S.db.ref('rooms/'+S.room+'/react').push({uid:S.myId,emoji,ts:Date.now()});
}
function fbSaveState(url,type,audioUrl,currentTime,playing){
  if(!S.fbReady)return;
  S.db.ref('rooms/'+S.room+'/state').set({url,type:type||'url',audioUrl:audioUrl||null,currentTime:currentTime||0,playing:!!playing,ts:Date.now()});
}
