var FILES={
'strategies/vwap.py':ed.value,
'engine/backtest.py':'from engine.stats import sharpe\n\n\ndef run(strat, data, bps=2.0):\n    eq, tr = [], []\n    for s in strat.sig(data):\n        fill = data[s].c * (1 + bps/1e4)\n        tr.append(fill)\n    return eq, sharpe(eq)\n\n\ndef mark(tr, bar):\n    return sum(tr) - bar.c * len(tr)\n',
'engine/stats.py':'import numpy as np\n\n\ndef csum(x):\n    return np.cumsum(x)\n\n\ndef sharpe(r, n=252):\n    if r.std() == 0:\n        return 0.0\n    return r.mean() / r.std() * np.sqrt(n)\n\n\ndef boot(r, k=1000):\n    out = []\n    for i in range(k):\n        out.append(sharpe(r.sample(len(r), replace=True)))\n    return np.array(out)\n'
};
var cur='strategies/vwap.py';
var stack=[];
var crumb=document.getElementById('crumb'),list=document.getElementById('list');

function blocks(src){
  var ls=src.split('\n'),out=[];
  for(var i=0;i<ls.length;i++){
    var m=ls[i].match(/^(\s*)(def|class)\s+([A-Za-z_]\w*)/);
    if(!m)continue;
    var ind=m[1].length,j=i+1;
    while(j<ls.length){
      var l=ls[j];
      if(l.trim()!==''&&l.match(/^\s*/)[0].length<=ind)break;
      j++;
    }
    while(j>i+1&&ls[j-1].trim()==='')j--;
    out.push({s:i,e:j-1,n:m[3],k:m[2],ind:ind});
  }
  return out;
}
function caretLine(){
  return ed.value.slice(0,ed.selectionStart).split('\n').length-1;
}
function push(b){
  var pad=new Array(b.ind+1).join(' ');
  stack.push({full:ed.value,s:b.s,e:b.e,pad:pad,name:b.n,kind:b.k});
  ed.value=ed.value.split('\n').slice(b.s,b.e+1).map(function(l){
    return l.slice(0,b.ind).trim()===''?l.slice(b.ind):l;}).join('\n');
  ed.selectionStart=ed.selectionEnd=0;
  draw();
}
function pop(){
  if(!stack.length)return;
  var f=stack.pop();
  var ls=f.full.split('\n');
  var body=ed.value.split('\n').map(function(l){
    return l.trim()===''?'':f.pad+l;});
  ed.value=ls.slice(0,f.s).concat(body,ls.slice(f.e+1)).join('\n');
  draw();
}
function popTo(d){ while(stack.length>d)pop(); }
function draw(){
  var bb=document.getElementById('back');
  try{
  if(bb){
    bb.style.opacity=hist.length?'1':'0.3';
    bb.textContent=hist.length?'↩ '+hist[hist.length-1].file.split('/').pop().replace(/\.py$/,''):'↩';
  }
  crumb.innerHTML='';
  var mk2=function(txt,fn,cls){
    var s=document.createElement('span');
    s.textContent=txt; s.className=cls||'c';
    if(fn)s.addEventListener('click',fn);
    crumb.appendChild(s);};
  var A=document.getElementById('app');
  if(A&&A.classList.contains('fs'))mk2('⤡',function(){A.classList.remove('fs');draw();},'rs');
  mk2(cur?cur.split('/').pop():'no files — 🗂 to add',function(){popTo(0);});
  stack.forEach(function(f,i){
    mk2(' › ',null,'sep');
    mk2(f.name,function(){popTo(i+1);});
  });
  crumb.style.display='flex';
  }catch(err){}
  paint();
}
var hist=[];
function wordAt(){
  var v=ed.value,p=ed.selectionStart,a=p,b=p;
  while(a>0&&/[A-Za-z0-9_]/.test(v.charAt(a-1)))a--;
  while(b<v.length&&/[A-Za-z0-9_]/.test(v.charAt(b)))b++;
  return v.slice(a,b);
}
function restorePath(names){
  names.forEach(function(nm){
    var bs=blocks(ed.value);
    for(var i=0;i<bs.length;i++){
      if(bs[i].n===nm){push(bs[i]);return;}
    }
  });
}
function findIn(src,name){
  var bs=blocks(src);
  for(var i=0;i<bs.length;i++)if(bs[i].n===name)return bs[i];
  return null;
}
function gotoDef(name){
  if(!name)return false;
  if(stack.length&&stack[stack.length-1].name===name)return false;
  var from={file:cur,path:stack.map(function(f){return f.name;})};
  save();
  var b=findIn(ed.value,name);
  if(b){hist.push(from);push(b);return true;}
  var ks=Object.keys(FILES);
  for(var i=0;i<ks.length;i++){
    if(ks[i]===cur)continue;
    if(findIn(FILES[ks[i]],name)){
      hist.push(from);
      openFile(ks[i]);
      var b2=findIn(ed.value,name);
      if(b2)push(b2);
      return true;
    }
  }
  restorePath(from.path);
  return false;
}
function goBack(){
  if(!hist.length)return;
  var f=hist.pop();
  save();
  if(f.file!==cur){cur=f.file;ed.value=FILES[cur];stack=[];}
  else popTo(0);
  restorePath(f.path);
  draw();
}
function flash(msg){
  var w=document.getElementById('warn');
  if(!w)return;
  w.className='hint'; w.textContent=msg;
  setTimeout(function(){
    if(w.className==='hint'){w.className='';w.textContent='';paint();}
  },1600);
}
function onDouble(){
  var w=wordAt();
  if(!w){flash('· no word under the caret');return;}
  var line=caretLine();
  if(stack.length&&stack[stack.length-1].name===w){pop();return;}
  var bs=blocks(ed.value);
  for(var i=0;i<bs.length;i++){
    if(bs[i].n===w&&bs[i].s===line){push(bs[i]);return;}
  }
  if(!gotoDef(w))flash('· no def for "'+w+'"');
}
function save(){ popTo(0); if(cur)FILES[cur]=ed.value; try{if(typeof queue==='function')queue();}catch(e){} }
function openFile(p){
  save();
  // the file being left is finished as far as the repo is concerned, so this
  // is where its commit belongs — not on a timer while it is still being typed
  try{if(window.ghFlush)ghFlush();}catch(e){}
  cur=p; ed.value=FILES[p]||''; stack=[];
  ed.selectionStart=ed.selectionEnd=0; draw();
  try{queue();}catch(e){}
}

var lastTap=0, lastX=0, lastY=0;
function near(a,b){return Math.abs(a-b)<34;}
ed.addEventListener('touchend',function(e){
  var t=Date.now();
  var c=e.changedTouches&&e.changedTouches[0];
  var x=c?c.clientX:0, y=c?c.clientY:0;
  if(t-lastTap<420&&near(x,lastX)&&near(y,lastY)){
    lastTap=0;
    e.preventDefault();
    setTimeout(onDouble,0);     // let the caret land first
    return;
  }
  lastTap=t; lastX=x; lastY=y;
},{passive:false});
// desktop / trackpad
ed.addEventListener('dblclick',function(e){e.preventDefault();onDouble();});
document.addEventListener('touchmove',function(e){
  if(e.touches.length>1)e.preventDefault();
},{passive:false});
document.addEventListener('dblclick',function(e){e.preventDefault();});
