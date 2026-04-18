// ── CHAT ──
function sendMsg(){
  const inp=document.getElementById('ci');
  const txt=inp.value.trim();
  if(!txt)return;
  inp.value='';
  addMsgEl(S.user,txt,true);
  fbChat(txt);
}
function sysmsg(txt){addMsgEl('',txt,false,true);fbChat(txt,true);}
function addMsgEl(name,text,own=false,sys=false,color=''){
  const msgs=document.getElementById('msgs');
  const el=document.createElement('div');
  if(sys){
    el.className='msg sys';
    el.innerHTML=`<span class="mtxt">${esc(text)}</span>`;
  } else {
    el.className='msg'+(own?' own':'');
    const c=color||(own?memberColor(S.myId):'#a78bfa');
    el.innerHTML=`<span class="mauth" style="color:${c}">${esc(name)}</span><span class="mtxt">${esc(text)}</span>`;
  }
  msgs.appendChild(el);
  msgs.scrollTop=msgs.scrollHeight;
}

// ── REACTIONS ──
function react(emoji){floatReact(emoji);fbReact(emoji);}
function floatReact(emoji){
  const c=document.getElementById('frcts');
  const el=document.createElement('div');
  el.className='fr';el.textContent=emoji;
  el.style.left=(10+Math.random()*60)+'px';
  c.appendChild(el);
  setTimeout(()=>el.remove(),2100);
}

// ── MEMBERS ──
function addMember(id,name,isHost,color){
  if(!color)color=COLORS[Object.keys(S.members).length%COLORS.length];
  S.members[id]={name,isHost,color};
}
function memberColor(id){return S.members[id]?.color||'#a78bfa';}
function renderMembers(){
  const list=document.getElementById('mlist');
  list.innerHTML='';
  document.getElementById('vcnt-txt').textContent=Object.keys(S.members).length+' kişi';
  Object.entries(S.members).forEach(([id,m])=>{
    const ini=m.name.slice(0,2).toUpperCase();
    const isMe=id===S.myId;
    const permBtn=S.isHost&&!m.isHost&&!isMe
      ? `<button class="mperm${S.allowedIds[id]?' on':''}" onclick="toggleMemberPerm('${id}','${esc(m.name)}')">${S.allowedIds[id]?'✓ İzinli':'İzin ver'}</button>`
      : '';
    list.innerHTML+=`<div class="mi"><div class="av" style="background:${m.color}22;color:${m.color};border:1px solid ${m.color}44">${ini}</div><div><div class="mname">${esc(m.name)}</div><div class="mrole">${m.isHost?'Oda sahibi':'İzleyici'}</div></div><div class="oonline"></div>${m.isHost?'<span class="hbadge">HOST</span>':permBtn}</div>`;
  });
}
