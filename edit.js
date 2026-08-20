window.addEventListener('error',function(e){
  try{
    var w=document.getElementById('warn');
    if(w)w.textContent='⚠ '+(e.message||'script error');
  }catch(_){}
});
window.addEventListener('unhandledrejection',function(e){
  try{e.preventDefault();}catch(_){}
});
var wrap=document.getElementById('wrap');
var ed=document.getElementById('ed'), hl=document.getElementById('hl'),
    ct=document.getElementById('ct'), warn=document.getElementById('warn');
var shift=false, page=0;

// every model call goes through here.
// point it at your own proxy (tailscale / worker) once the key lives there.
var API='https://api.anthropic.com';

var KW='return|yield|if|elif|else|for|while|break|continue|pass|'
     +'import|from|as|with|try|except|finally|raise|lambda|and|or|not|in|is|'
     +'assert|global|nonlocal|del|async|await';
var BI='abs|all|any|bool|bytes|callable|chr|dict|dir|divmod|enumerate|filter|'
     +'float|format|frozenset|getattr|hasattr|hash|hex|id|input|int|isinstance|'
     +'issubclass|iter|len|list|map|max|min|next|object|open|ord|pow|print|'
     +'range|repr|reversed|round|set|setattr|sorted|str|sum|super|tuple|type|'
     +'vars|zip';
var STR='"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\''
      +'|"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'';
// Order is the whole design here. Strings and comments come first so nothing
// inside them is tokenised; the two-part def/class match has to beat the bare
// keyword alternative; self and the constants have to beat it too.
// The subject string has already been through esc(), so < > & arrive as
// entities — the operator branch matches those forms and never a bare &,
// which would otherwise chop an entity in half.
var RE=new RegExp(
   '(#[^\\n]*)'                                     // 1  comment
 +'|([rbfuRBFU]{0,2}(?:'+STR+'))'                   // 2  string
 +'|(@[A-Za-z_][\\w.]*)'                            // 3  decorator
 +'|\\b(def|class)(\\s+)([A-Za-z_]\\w*)'            // 4,5,6  declaration
 +'|\\b(self|cls)\\b'                               // 7  receiver
 +'|\\b(None|True|False)\\b'                        // 8  constant
 +'|\\b('+KW+')\\b'                                 // 9  keyword
 +'|\\b('+BI+')\\b'                                 // 10 builtin
 +'|\\b(\\d+\\.?\\d*(?:[eE][-+]?\\d+)?)\\b'         // 11 number
 +'|([A-Za-z_]\\w*)(?=\\s*\\()'                     // 12 call
 +'|([\\[\\](){}])'                                 // 13 bracket
 +'|(-&gt;|&lt;=|&gt;=|==|!=|&lt;|&gt;|&amp;|\\*\\*|//|\\+|-|\\*|/|%|=|\\||\\^|~)'
 ,'g');                                             // 14 operator

function sp(c,t){return '<span class="'+c+'">'+t+'</span>';}
// three colours cycling by nesting depth. the whole reason this editor exists
// is that you cannot see where a bracket went missing on a phone; matching
// pairs sharing a colour is the cheapest fix for that.
var bdepth=0;
function brk(ch){
  var d=(ch==='('||ch==='['||ch==='{')?bdepth++:(bdepth=Math.max(0,bdepth-1));
  return sp('b'+(d%3),ch);
}

function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
var er=document.getElementById('er');
var ERRS=[];
// draw wavy underlines on a transparent copy of the text, layered under the
// caret. same font and wrapping as #hl, so the lines land in the right place.
// names bound in the other open files, plus the whole of the current file when
// we are zoomed into one of its blocks — the buffer is a dedented fragment
// then, and its parameters live on a def line that is not in it.
var knownCache=null, knownSig=null;
function siblingNames(){
  if(typeof lintNames!=='function'||typeof FILES==='undefined')return null;
  var zoom=(typeof stack!=='undefined'&&stack.length)?1:0,sig='',k;
  for(k in FILES)if(FILES.hasOwnProperty(k)&&k!==cur)sig+=k+':'+FILES[k].length+';';
  if(zoom)sig+='@'+cur+':'+((FILES[cur]||'').length);
  if(sig===knownSig)return knownCache;
  var o={};
  for(k in FILES)if(FILES.hasOwnProperty(k)&&k!==cur)lintNames(FILES[k],o);
  if(zoom)lintNames(FILES[cur]||'',o);
  knownSig=sig; knownCache=o;
  return o;
}

function redline(ls){
  if(typeof lintPy!=='function')return;
  ERRS=lintPy(ed.value,siblingNames());
  var bad={};
  ERRS.forEach(function(e){(bad[e.line]=bad[e.line]||[]).push(e);});
  if(er){
    er.innerHTML=ls.map(function(l,i){
      var marks=bad[i];
      if(!marks)return esc(l);
      // walk the line, wrapping only the marked spans. errors arrive sorted
      // and non-overlapping, so a single left-to-right pass is enough.
      var html='',pos=0;
      for(var k=0;k<marks.length;k++){
        var a=Math.min(marks[k].col,l.length);
        var b=Math.min(a+marks[k].len,l.length);
        if(a<pos)continue;
        html+=esc(l.slice(pos,a));
        html+='<span class="bad">'+(esc(l.slice(a,b))||' ')+'</span>';
        pos=b;
      }
      html+=esc(l.slice(pos));
      return html;
    }).join('\n')+'\n\n';
    er.scrollTop=ed.scrollTop;
    erShown=ERRS.length>0;
  }
  if(!warn)return;
  if(ERRS.length){
    warn.className='';
    warn.textContent='⚠ '+(ERRS[0].line+1)+':'+(ERRS[0].col+1)+' — '+ERRS[0].msg
      +(ERRS.length>1?'  (+'+(ERRS.length-1)+')':'');
  }else{
    var ov=0;
    for(var i=0;i<ls.length;i++)if(ls[i].length>44)ov++;
    warn.className='';
    warn.textContent=ov?ov+' over 44':'';
  }
}
// tap the warn bar to jump to the first error
if(warn)warn.addEventListener('click',function(){
  if(!ERRS.length)return;
  var head=ed.value.split('\n').slice(0,ERRS[0].line).join('\n').length;
  var p=(ERRS[0].line?head+1:0)+ERRS[0].col;
  ed.selectionStart=ed.selectionEnd=Math.min(p,ed.value.length);
  ed.focus();
});
// #ed is transparent — #hl is the text you actually see — so the highlight has
// to keep up with the caret and cannot be deferred. Everything else can. The
// lint is a second full pass over the buffer and a second innerHTML write, and
// mid-word it is reporting on a line you have not finished writing, so it runs
// when you pause instead. Two full document rewrites per keypress was the lag.
var praf=null, lintT=null, erShown=false, lastVal=null;
function paint(){
  if(praf!==null)return;         // one repaint per frame, not one per key
  praf=requestAnimationFrame(function(){praf=null;paintNow();});
}
function paintNow(){
  bdepth=0;
  hl.innerHTML=esc(ed.value).replace(RE,
    function(m,com,str,dec,dk,dgap,dnm,slf,con,kw,bi,num,fn,br,op){
      if(com)return sp('com',com);
      if(str)return sp('str',str);
      if(dec)return sp('dec',dec);
      if(dnm)return sp('kw',dk)+dgap+sp('dfn',dnm);
      if(slf)return sp('slf',slf);
      if(con)return sp('con',con);
      if(kw)return sp('kw',kw);
      if(bi)return sp('bi',bi);
      if(num)return sp('num',num);
      if(fn)return sp('fn',fn);
      if(br)return brk(br);
      if(op)return sp('op',op);
      return m;})+'\n\n';
  hl.scrollTop=ed.scrollTop;
  var ls=ed.value.split('\n'),mx=0;
  for(var i=0;i<ls.length;i++)if(ls[i].length>mx)mx=ls[i].length;
  ct.textContent=ls.length+' ln · max '+mx;
  // the old squiggles describe text that has since moved; drop them rather
  // than leave them underlining the wrong characters until the next lint
  if(erShown&&er){er.innerHTML='';erShown=false;}
  try{clearTimeout(lintT);}catch(e){}
  lintT=setTimeout(function(){redline(ed.value.split('\n'));},220);
  // The pad writes ed.value directly and #ed is inputmode="none", so the
  // 'input' event store.js listens on never fires for a typed character. Every
  // mutation repaints, so the save has to be triggered from here instead.
  if(lastVal!==null&&lastVal!==ed.value&&typeof queue==='function'){
    try{queue();}catch(e){}
  }
  lastVal=ed.value;
}
var T=null;
function tgt(){return T||ed;}
function ins(t,back){
  var x=tgt(),s=x.selectionStart,e=x.selectionEnd,v=x.value;
  x.value=v.slice(0,s)+t+v.slice(e);
  x.selectionStart=x.selectionEnd=s+t.length-(back||0);
  x.focus(); if(x===ed)paint();
}
function dedent(){
  var v=ed.value,s=ed.selectionStart,ls=v.lastIndexOf('\n',s-1)+1,
      m=v.slice(ls).match(/^ {1,4}/);
  if(!m)return;
  ed.value=v.slice(0,ls)+v.slice(ls+m[0].length);
  ed.selectionStart=ed.selectionEnd=Math.max(ls,s-m[0].length);
  ed.focus(); paint();
}
function back(){
  var x=tgt(),s=x.selectionStart,e=x.selectionEnd,v=x.value;
  var ed=x;
  if(s!==e){ed.value=v.slice(0,s)+v.slice(e);
    ed.selectionStart=ed.selectionEnd=s; ed.focus(); paint(); return;}
  if(s===0)return;
  var ls=v.lastIndexOf('\n',s-1)+1, pre=v.slice(ls,s), n=1;
  if(pre.length&&pre.length%4===0&&/^ +$/.test(pre))n=4;
  ed.value=v.slice(0,s-n)+v.slice(s);
  ed.selectionStart=ed.selectionEnd=s-n;
  ed.focus(); paint();
}
function enter(){
  var x=tgt(),v=x.value,s=x.selectionStart,ls=v.lastIndexOf('\n',s-1)+1,
      line=v.slice(ls,s), ind=(line.match(/^ */)||[''])[0];
  if(/:\s*$/.test(line))ind+='    ';
  ins('\n'+ind);
}
function mk(host,label,fn,cls){
  var b=document.createElement('button');
  b.textContent=label;
  if(cls)b.className=cls;
  b.addEventListener('pointerdown',function(e){
    e.preventDefault();
    b.classList.add('hit');
    fn();
    if(navigator.vibrate)navigator.vibrate(3);
  });
  b.addEventListener('pointerup',function(){b.classList.remove('hit');});
  b.addEventListener('pointercancel',function(){b.classList.remove('hit');});
  b.addEventListener('pointerleave',function(){b.classList.remove('hit');});
  host.appendChild(b);
  return b;
}
function fill(host,chars){
  host.innerHTML='';
  chars.split('').forEach(function(c){
    mk(host,shift?c.toUpperCase():c,function(){ins(shift?c.toUpperCase():c);});
  });
}

// two rows of nine. one row of seventeen scrolled, which meant the last
// eight keys — '#' included — were never on screen.
var CODE1=[['⇥',function(){ins('    ');}],['⇤',dedent],[':',function(){ins(':');}],
['(',function(){ins('()',1);}],[')',function(){ins(')');}],
['[',function(){ins('[]',1);}],[']',function(){ins(']');}],
['"',function(){ins('""',1);}],["'",function(){ins("''",1);}]];
var CODE2=[['_',function(){ins('_');}],['=',function(){ins(' = ');}],
['.',function(){ins('.');}],[',',function(){ins(', ');}],
['<',function(){ins(' < ');}],['>',function(){ins(' > ');}],
['#',function(){ins('# ');}],['self',function(){ins('self');}],
['def',function(){ins('def ');}]];
function fillCode(host,keys){
  keys.forEach(function(k){
    mk(host,k[0],k[1],k[0].length>1?'word':'');
  });
}
fillCode(document.getElementById('code'),CODE1);
fillCode(document.getElementById('code2'),CODE2);

var r1=document.getElementById('r1'),r2=document.getElementById('r2'),
    r3=document.getElementById('r3'),r4=document.getElementById('r4');

function render(){
  if(page===0){
    fill(r1,'qwertyuiop'); fill(r2,'asdfghjkl');
    r3.innerHTML='';
    mk(r3,shift?'⇧':'⇧',function(){shift=!shift;render();},'wide');
    'zxcvbnm'.split('').forEach(function(c){
      mk(r3,shift?c.toUpperCase():c,function(){ins(shift?c.toUpperCase():c);});});
    mk(r3,'⌫',back,'wide');
  }else{
    fill(r1,'1234567890'); 
    r2.innerHTML='';
    ['-','+','*','/','%','{','}','|','&','^'].forEach(function(c){
      mk(r2,c,function(){ins(c);});});
    r3.innerHTML='';
    ['!','?',';','@','$','~',"'",'\\'].forEach(function(c){
      mk(r3,c,function(){ins(c);});});
    mk(r3,'⌫',back,'wide');
  }
  r4.innerHTML='';
  mk(r4,page===0?'123':'abc',function(){page=1-page;shift=false;render();},'wide');
  var sb=mk(r4,'space',function(){ins(' ');},'sp'); sb.style.fontSize='15px';
  mk(r4,'⏎',enter,'wide');
}
render();

ed.addEventListener('input',paint);
ed.addEventListener('scroll',function(){
  hl.scrollTop=ed.scrollTop;
  if(er)er.scrollTop=ed.scrollTop;
});
ed.addEventListener('keydown',function(e){
  if(e.key==='Tab'){e.preventDefault();e.shiftKey?dedent():ins('    ');}
});

document.getElementById('copy').addEventListener('click',function(){
  ed.select(); document.execCommand('copy');
  ed.selectionStart=ed.selectionEnd=ed.value.length;
  var b=this; b.textContent='✓';
  setTimeout(function(){b.textContent='Copy';},1000);
});

var zoom=document.getElementById('zoom');
var K=0.8125, FS=13;
function setFs(v){
  K=Math.max(0.5,Math.min(1.6,v/16));
  FS=Math.round(16*K);
  zoom.style.transform='scale('+K+')';
  zoom.style.width=(100/K)+'%';
  zoom.style.height=(100/K)+'%';
}
setFs(13);

['gesturestart','gesturechange','gestureend'].forEach(function(t){
  document.addEventListener(t,function(e){e.preventDefault();},{passive:false});
});

function dist(e){
  var a=e.touches[0],b=e.touches[1];
  return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
}
var d0=0,f0=13;
wrap.addEventListener('touchstart',function(e){
  if(e.touches.length===2){d0=dist(e);f0=FS;}
},{passive:false});
wrap.addEventListener('touchmove',function(e){
  if(e.touches.length===2&&d0>0){
    e.preventDefault();
    setFs(f0*dist(e)/d0);
  }
},{passive:false});
wrap.addEventListener('touchend',function(){d0=0;});
wrap.addEventListener('touchcancel',function(){d0=0;});
