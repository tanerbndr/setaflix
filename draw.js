// ── DRAW SYSTEM ──
// Permission: host can always draw; viewers need S.drawAllowed
// Strokes synced via Firebase (normalized coords)

const Draw = (function(){
  let _canvas, _ctx;
  let _active = false;   // drawing mode on/off
  let _eraser = false;
  let _color = '#FFFFFF';
  let _sizes = [3, 6, 12];
  let _sizeIdx = 0;
  let _drawing = false;
  let _cur = [];         // current stroke points

  function init(){
    _canvas = document.getElementById('draw-canvas');
    if(!_canvas) return;
    _ctx = _canvas.getContext('2d');
    _resize();
    window.addEventListener('resize', _resize);

    _canvas.addEventListener('mousedown', _onDown);
    _canvas.addEventListener('mousemove', _onMove);
    _canvas.addEventListener('mouseup', _onUp);
    _canvas.addEventListener('mouseleave', _onUp);
    _canvas.addEventListener('touchstart', _onTouchDown, {passive:false});
    _canvas.addEventListener('touchmove', _onTouchMove, {passive:false});
    _canvas.addEventListener('touchend', _onUp);
  }

  function _resize(){
    if(!_canvas) return;
    const w = _canvas.offsetWidth, h = _canvas.offsetHeight;
    // preserve existing drawing
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    if(_ctx) tmp.getContext('2d').drawImage(_canvas,0,0);
    _canvas.width = w;
    _canvas.height = h;
    if(_ctx) _ctx.drawImage(tmp,0,0);
  }

  function _pos(e){
    const r = _canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function _posT(e){
    const t = e.touches[0], r = _canvas.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  function _norm(p){
    return { x: p.x / _canvas.width, y: p.y / _canvas.height };
  }
  function _denorm(p){
    return { x: p.x * _canvas.width, y: p.y * _canvas.height };
  }

  function _onDown(e){
    if(!_active) return;
    _drawing = true;
    const p = _pos(e);
    _cur = [_norm(p)];
    _ctx.beginPath();
    _ctx.moveTo(p.x, p.y);
  }
  function _onMove(e){
    if(!_active || !_drawing) return;
    const p = _pos(e);
    _cur.push(_norm(p));
    _drawPoint(p);
  }
  function _onUp(){
    if(!_drawing) return;
    _drawing = false;
    if(_cur.length > 1) _pushStroke();
    _cur = [];
  }
  function _onTouchDown(e){
    e.preventDefault();
    if(!_active) return;
    _drawing = true;
    const p = _posT(e);
    _cur = [_norm(p)];
    _ctx.beginPath();
    _ctx.moveTo(p.x, p.y);
  }
  function _onTouchMove(e){
    e.preventDefault();
    if(!_active || !_drawing) return;
    const p = _posT(e);
    _cur.push(_norm(p));
    _drawPoint(p);
  }

  function _drawPoint(p){
    _ctx.lineWidth = _eraser ? _sizes[_sizeIdx] * 4 : _sizes[_sizeIdx];
    _ctx.strokeStyle = _eraser ? 'rgba(0,0,0,1)' : _color;
    _ctx.lineCap = 'round';
    _ctx.lineJoin = 'round';
    _ctx.globalCompositeOperation = _eraser ? 'destination-out' : 'source-over';
    _ctx.lineTo(p.x, p.y);
    _ctx.stroke();
    _ctx.beginPath();
    _ctx.moveTo(p.x, p.y);
  }

  function _pushStroke(){
    if(!S.fbReady) return;
    const stroke = {
      uid: S.myId,
      color: _eraser ? 'eraser' : _color,
      size: _sizeIdx,
      pts: _cur.slice(0, 200),  // max 200 points per stroke
      ts: Date.now()
    };
    S.db.ref('rooms/'+S.room+'/draw/strokes').push(stroke);
  }

  function drawRemoteStroke(stroke){
    if(!_ctx) return;
    const pts = stroke.pts;
    if(!pts || pts.length < 2) return;
    const isEraser = stroke.color === 'eraser';
    _ctx.beginPath();
    const p0 = _denorm(pts[0]);
    _ctx.moveTo(p0.x, p0.y);
    for(let i=1;i<pts.length;i++){
      const p = _denorm(pts[i]);
      _ctx.lineTo(p.x, p.y);
    }
    _ctx.lineWidth = isEraser ? _sizes[stroke.size||0] * 4 : _sizes[stroke.size||0];
    _ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : stroke.color;
    _ctx.lineCap = 'round';
    _ctx.lineJoin = 'round';
    _ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
    _ctx.stroke();
    _ctx.globalCompositeOperation = 'source-over';
  }

  function clearCanvas(){
    if(!_ctx) return;
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    if(S.fbReady) S.db.ref('rooms/'+S.room+'/draw/strokes').remove();
  }

  function setActive(on){
    _active = on;
    if(_canvas) _canvas.classList.toggle('active', on);
    document.getElementById('draw-toggle').classList.toggle('active', on);
    const tb = document.getElementById('draw-toolbar');
    if(tb) tb.classList.toggle('visible', on);
  }

  function setColor(c){ _color = c; _eraser = false; document.getElementById('draw-eraser-btn').classList.remove('active'); }
  function toggleEraser(){
    _eraser = !_eraser;
    document.getElementById('draw-eraser-btn').classList.toggle('active', _eraser);
  }
  function cycleSize(){
    _sizeIdx = (_sizeIdx+1) % _sizes.length;
    const icons = ['●','⬤','⬤'];
    const btn = document.getElementById('draw-size-btn');
    if(btn) btn.style.fontSize = ['0.5rem','0.7rem','0.9rem'][_sizeIdx];
  }

  return { init, setActive, setColor, toggleEraser, cycleSize, clearCanvas, drawRemoteStroke };
})();

// ── PUBLIC API ──
S.drawAllowed = false;

function toggleDraw(){
  if(!S.isHost && !S.drawAllowed){
    toast('Host çizim iznini açmamış');
    return;
  }
  const isOn = !document.getElementById('draw-toggle').classList.contains('active');
  Draw.setActive(isOn);
}

function setDrawColor(color, btn){
  Draw.setColor(color);
  document.querySelectorAll('.draw-swatch').forEach(s=>s.classList.remove('active'));
  if(btn) btn.classList.add('active');
}

function toggleEraser(){ Draw.toggleEraser(); }
function cycleDrawSize(){ Draw.cycleSize(); }

function clearDraw(){
  Draw.clearCanvas();
}

// Host: toggle draw permission for all viewers
function toggleDrawAllow(){
  if(!S.isHost) return;
  S.drawEnabled = !S.drawEnabled;
  const btn = document.getElementById('btn-draw-allow');
  btn.textContent = S.drawEnabled ? '✏️ Çizim Aç' : '✏️ Çizim Kapat';
  btn.classList.toggle('on', S.drawEnabled);
  if(S.fbReady) S.db.ref('rooms/'+S.room+'/draw/enabled').set(S.drawEnabled);
  toast(S.drawEnabled ? 'Çizim izni verildi' : 'Çizim kapatıldı');
}

// called from firebase.js when draw/enabled changes
function onDrawEnabled(val){
  S.drawAllowed = !!val;
  if(!S.isHost){
    const tog = document.getElementById('draw-toggle');
    if(tog) tog.style.opacity = val ? '1' : '0.4';
    if(!val && document.getElementById('draw-toggle').classList.contains('active')){
      Draw.setActive(false);
    }
  }
  if(S.isHost){
    const btn = document.getElementById('btn-draw-allow');
    if(btn) btn.style.display = '';
  }
}

// called from firebase.js on new remote stroke
function onRemoteStroke(stroke){
  if(stroke.uid === S.myId) return;
  Draw.drawRemoteStroke(stroke);
}

// called from firebase.js on clear event
function onDrawClear(){
  Draw.clearCanvas();
}

window.addEventListener('load', () => {
  Draw.init();
  // Show draw-allow button for host
  if(S.isHost){
    const btn = document.getElementById('btn-draw-allow');
    if(btn) btn.style.display = '';
  }
});
