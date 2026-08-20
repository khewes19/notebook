var FK='pyed:proj:v2', NK='pyed:notes:v1';
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

function mark(ok){
  if(!dot)return;
  dot.className=ok?'ok':'';
  dot.textContent=ok?'•':'○';
  dot.title=SMODE==='none'?'not saving — memory only':'saving via '+SMODE;
}
if(dot)dot.addEventListener('click',function(){
  var w=document.getElementById('warn');
  if(w)w.textContent=SMODE==='none'
    ? '⚠ no storage backend — copy your work out before closing'
    : 'saving via '+SMODE+' · '+Object.keys(FILES).length+' files';
});
function persist(){
  if(!STORE){mark(false);return;}
  try{
    if(cur&&!stack.length)FILES[cur]=ed.value;
    Promise.resolve()
      .then(function(){return STORE.set(FK,JSON.stringify({v:2,files:FILES,notes:NOTES,cur:cur}));})
      .then(function(){mark(true);})
      .catch(function(){mark(false);});
  }catch(e){mark(false);}
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
    mark(true);
  }).catch(function(){mark(false);});
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
