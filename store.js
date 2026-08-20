var FK='pyed:proj:v2', NK='pyed:notes:v1';
var saveMs=0;
var dot=document.getElementById('dot'), tsave=null;
var STORE=null, SMODE='none';
try{
  if(window.storage&&typeof window.storage.get==='function'){
    STORE=window.storage; SMODE='storage';
  }
}catch(e){}
if(!STORE){
  try{
    var tk='__pyed_t';
    window.localStorage.setItem(tk,'1');
    window.localStorage.removeItem(tk);
    STORE={
      get:function(k){
        var v=window.localStorage.getItem(k);
        return Promise.resolve(v===null?null:{key:k,value:v});
      },
      set:function(k,v){
        window.localStorage.setItem(k,v);
        return Promise.resolve({key:k,value:v});
      }
    };
    SMODE='local';
  }catch(e){ SMODE='none'; }
}

var mstate=null;
function mark(ok){
  if(!dot||mstate===ok)return;   // queue() calls this on every keystroke
  mstate=ok;
  // className only. Writing textContent here changed the element's width and
  // relaid out the editor underneath it; the dot is drawn in css now.
  dot.className=ok?'ok':'';
  dot.title=SMODE==='none'?'not saving — memory only':'saving via '+SMODE;
}
if(dot)dot.addEventListener('click',function(){
  var w=document.getElementById('warn');
  if(w)w.textContent=SMODE==='none'
    ? '⚠ no storage backend — copy your work out before closing'
    : 'saving via '+SMODE+' · '+Object.keys(FILES).length+' files · write '
    +saveMs+'ms · repaint '+Math.round(window.slowMs||0)+'ms'
    +(window.ghNote?' · ⇅ '+ghNote():'');
});
// stringify walks every file and localStorage.setItem is synchronous, so on a
// 700 ms debounce the write lands squarely between two keystrokes of anyone
// who types in bursts. Hand it to the browser to run when the main thread is
// actually free; the timeout keeps it from being postponed forever.
var idle=window.requestIdleCallback
  ? function(fn){window.requestIdleCallback(fn,{timeout:2000});}
  : function(fn){setTimeout(fn,1);};
function persist(){
  if(!STORE){mark(false);return;}
  if(cur&&!stack.length)FILES[cur]=ed.value;
  idle(function(){
    // localStorage.setItem is synchronous disk work; time it so "it hitches
    // when it saves" can be checked rather than argued about. tap the dot.
    var t0=(window.performance&&performance.now)?performance.now():0;
    try{
      Promise.resolve()
        .then(function(){return STORE.set(FK,JSON.stringify({v:2,files:FILES,notes:NOTES,cur:cur}));})
        .then(function(){
          if(t0)saveMs=Math.round(performance.now()-t0);
          mark(true);
          if(window.ghQueue)ghQueue();
        })
        .catch(function(){mark(false);});
    }catch(e){mark(false);}
  });
}
function queue(){
  try{clearTimeout(tsave);}catch(e){}
  mark(false);
  tsave=setTimeout(persist,700);
}
ed.addEventListener('input',function(){
  if(!cur&&ed.value.length){cur='untitled.py';FILES[cur]='';draw();}
  queue();
});

function restore(){
  if(!STORE){mark(false);return;}
  var p;
  try{p=Promise.resolve(STORE.get(FK));}catch(e){mark(false);return;}
  p.then(function(f){
    if(f&&f.value){
      var obj=null;
      try{obj=JSON.parse(f.value);}catch(e){}
      if(obj&&obj.v===2&&obj.files&&typeof obj.files==='object'){
        FILES=obj.files;
        NOTES=obj.notes||{};
        var k=Object.keys(FILES);
        cur=(obj.cur&&FILES.hasOwnProperty(obj.cur))?obj.cur:(k.length?k[0]:'');
        stack=[]; hist=[]; ed.value=cur?FILES[cur]:'';
        draw();
      }
    }
    mark(true); window.RESTORED=1; if(window.ghBoot)ghBoot();
  }).catch(function(){mark(false);window.RESTORED=1;if(window.ghBoot)ghBoot();});
}
restore();

// iOS won't let a page hide safari's chrome — Add to Home Screen is the
// only route to fullscreen. nudge once, and only when not already there.
(function(){
  var standalone=window.navigator.standalone===true||
    (window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches);
  if(standalone)return;
  var w=document.getElementById('warn');
  if(!w||w.textContent)return;
  w.className='hint';
  w.textContent='↗ Share → Add to Home Screen for fullscreen';
  setTimeout(function(){
    if(w.className==='hint'){w.className='';w.textContent='';}
  },9000);
})();

document.getElementById('fs').addEventListener('click',function(){
  app.classList.add('fs'); draw();
});
