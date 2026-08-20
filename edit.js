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

// Base URL for every model call. It must be a proxy that holds the API key —
// worker/worker.js is one, ready to paste into Cloudflare. Pointing this
// straight at api.anthropic.com cannot work: the browser has no key to send,
// and run.js says so rather than letting the request fail as a bare 401.
var API='';

var KW='return|yield|if|elif|else|for|while|break|continue|pass|'
     +'import|from|as|with|try|except|finally|raise|lambda|and|or|not|in|is|'
     +'assert|global|nonlocal|del|async|await';
var BI='abs|all|any|bool|bytes|callable|chr|dict|dir|divmod|enumerate|filter|'
     +'float|format|frozenset|getattr|hasattr|hash|hex|id|input|int|isinstance|'
     +'issubclass|iter|len|list|map|max|min|next|object|open|ord|pow|print|'
     +'range|repr|reversed|round|set|setattr|sorted|str|sum|super|tuple|type|'
     +'vars|zip';
// One branch for every identifier, and the word decides its own class from a
// hash. Spelling the keywords and the fifty builtins out as regex alternatives
// made the engine try eighty literals at every word boundary in the file, three
// times the cost for the same output, on a pass that runs every frame you type.
var KWSET={},BISET={},CONSET={'None':1,'True':1,'False':1},
    SELFSET={'self':1,'cls':1};
(KW+'|def|class').split('|').forEach(function(w){KWSET[w]=1;});
BI.split('|').forEach(function(w){BISET[w]=1;});

// Order still matters. Strings and comments come first so nothing inside them
// is tokenised, and the number branch precedes the word branch so 1e5 is one
// number rather than a 1 and an e5.
// The subject has already been through esc(), so < > & arrive as entities —
// the operator branch matches those forms and never a bare &, which would
// otherwise chop an entity in half.
// Order still matters. Strings and comments come first so nothing inside them
// is tokenised, and the number branch precedes the word branch so 1e5 is one
// number rather than a 1 and an e5.
// A branch matching runs of whitespace was tried here, on the theory that
// failing every branch at every space of a four-space indent is wasteful. It
// measured 40% slower: one callback per run costs more than the failed matches
// it saves, and python on a phone has a great many short runs.
// This runs over the raw buffer, not an escaped copy. esc() was three more
// regex passes and three more strings the size of the file, every frame, to
// protect three characters — and < > & are all operators, so the only branch
// that can produce them escapes its own token. Anything the regex does not
// match is a dot, a comma, a colon, a backslash or whitespace, none of which
// need escaping. It also retires the entity-splitting hazard the operator
// branch used to carry.
// Line at a time, so a keystroke can repaint one line instead of the document.
// Nothing here crosses a newline: a triple-quoted string that opens and does
// not close becomes an opener, and the state is carried into the next line.
// The three string forms are separate branches, and in this order, because an
// unterminated """ has to be recognised before the ordinary quote alternative
// gets to it — that one happily matches the first two quotes as an empty
// string and leaves the third behind.
var PFX='[rbfuRBFU]{0,2}';
var LRE=new RegExp(
   '(#.*)'                                          // 1 comment
 +'|('+PFX+'(?:"""(?:[^\\\\]|\\\\.)*?"""'           // 2 triple, closed here
       +'|\'\'\'(?:[^\\\\]|\\\\.)*?\'\'\'))'
 +'|('+PFX+'(?:"""|\'\'\'))'                        // 3 triple, left open
 +'|('+PFX+'(?:"(?:[^"\\\\]|\\\\.)*"'               // 4 quoted, closed here
       +'|\'(?:[^\'\\\\]|\\\\.)*\'))'
 +'|(@[A-Za-z_][\\w.]*)'                            // 5 decorator
 +'|(\\d+\\.?\\d*(?:[eE][-+]?\\d+)?)'               // 6 number
 +'|([A-Za-z_]\\w*)'                                // 7 word
 +'|([\\[\\](){}])'                                 // 8 bracket
 +'|(->|<=|>=|==|!=|\\*\\*|//|[-+*/%=|^~<>&])'
 ,'g');                                             // 9 operator

function sp(c,t){return '<span class="'+c+'">'+t+'</span>';}

// The operator set is small and known, so the three that need escaping are
// looked up rather than sent through esc(). esc() is three regexes, and paying
// that per operator token is worse than the whole-buffer pass it replaced.
var OPESC={'<':'&lt;','>':'&gt;','&':'&amp;',
           '<=':'&lt;=','>=':'&gt;=','->':'-&gt;'};

// is the next thing after this word an open paren, making it a call? scanned
// rather than sliced — this is asked once per identifier in the buffer.
function callsAhead(s,i){
  while(i<s.length){
    var c=s.charAt(i);
    if(c!==' '&&c!=='\t')return c==='(';
    i++;
  }
  return false;
}

// set by def and class so the name that follows is painted as a declaration
var pendDfn=false;
function word(w,whole,after){
  if(pendDfn){pendDfn=false;return sp('dfn',w);}
  if(KWSET[w]){pendDfn=(w==='def'||w==='class');return sp('kw',w);}
  if(SELFSET[w])return sp('slf',w);
  if(CONSET[w])return sp('con',w);
  if(BISET[w])return sp('bi',w);
  if(callsAhead(whole,after))return sp('fn',w);
  return w;                       // a plain name costs no span at all
}
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

// the line the caret sits on is still being written; a half-typed line is
// always wrong, and squiggling it while you are on it is just noise. it gets
// judged when you leave. counted rather than sliced — this runs on every
// selection change.
function caretLine(){
  if(document.activeElement!==ed)return -1;
  var p=ed.selectionStart||0,v=ed.value,n=0;
  for(var i=0;i<p&&i<v.length;i++)if(v.charAt(i)==='\n')n++;
  return n;
}

// the full result of the last lint, before the caret's line is taken out of it
var ALLERRS=[], lintPending=false;

// draw wavy underlines on a transparent copy of the text, layered under the
// caret. same font and wrapping as #hl, so the lines land in the right place.
function showErrs(ls){
  var here=caretLine(),keep=[];
  for(var q=0;q<ALLERRS.length;q++)if(ALLERRS[q].line!==here)keep.push(ALLERRS[q]);
  ERRS=keep;
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
    er.style.visibility='';
    erShown=ERRS.length>0;
  }
  if(!warn)return;
  // a correction owns the bar until it times out, so the undo stays reachable
  if(fixNote)return;
  if(ERRS.length){
    warn.className='';
    warn.textContent='⚠ '+(ERRS[0].line+1)+':'+(ERRS[0].col+1)+' — '+ERRS[0].msg
      +(ERRS[0].fix?'  tap to fix':'')
      +(ERRS.length>1?'  (+'+(ERRS.length-1)+')':'');
  }else{
    var ov=0;
    for(var i=0;i<ls.length;i++)if(ls[i].length>44)ov++;
    warn.className='';
    warn.textContent=ov?ov+' over 44':'';
  }
}

var lastLinted=null;
function redline(ls){
  if(typeof lintPy!=='function')return;
  if(ed.value!==lastLinted){          // blur and focus do not change the text
    ALLERRS=lintPy(ed.value,siblingNames());
    lastLinted=ed.value;
  }
  lintPending=false;
  showErrs(ls);
}
// Replace the typo with the suggestion. Checks that the characters it is about
// to replace are still the ones it was told about — the buffer may have moved
// since the lint ran — and puts the caret after the correction so the next
// keystroke carries on rather than landing somewhere surprising.
function applyFix(e){
  if(!e||!e.fix)return false;
  var ls=ed.value.split('\n');
  if(e.line>=ls.length)return false;
  var line=ls[e.line];
  if(line.substr(e.col,e.len)!==e.fix.from)return false;
  ls[e.line]=line.slice(0,e.col)+e.fix.to+line.slice(e.col+e.len);
  var head=0;
  for(var i=0;i<e.line;i++)head+=ls[i].length+1;
  ed.value=ls.join('\n');
  var p=head+e.col+e.fix.to.length;
  ed.selectionStart=ed.selectionEnd=Math.min(p,ed.value.length);
  refocus(ed);
  paint();
  try{if(typeof queue==='function')queue();}catch(_){}
  return true;
}

// Tapping the bar fixes the first error when there is a correction for it, and
// jumps to it otherwise. Correction is never automatic: a wrong squiggle costs
// the reader a moment, a wrong edit costs them their code.
if(warn)warn.addEventListener('click',function(){
  if(undoFix())return;              // a correction just happened: take it back
  if(!ERRS.length)return;
  if(applyFix(ERRS[0]))return;
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
// Worst recent repaint, in ms, decayed so a one-off spike fades instead of
// sticking. Shown in the counter only when it is bad enough to feel, so that
// "typing is laggy" can be answered with a number instead of a theory — and if
// this stays small while typing still drags, the cost is not in here.
var slowMs=0, keyMs=0, keyT0=0;
var now=(window.performance&&performance.now)
  ? function(){return performance.now();} : function(){return 0;};

// One line's markup, given what the line above left open. Returns the state
// the next line inherits: whether a triple quote is still open, and how deep
// the brackets are, which is what decides a bracket's colour.
function renderLine(text,tri,depth){
  var out='',m,last=0,s=text;
  if(tri){
    var e=text.indexOf(tri);
    if(e<0)return {html:sp('str',esc(text)),tri:tri,depth:depth};
    out+=sp('str',esc(text.slice(0,e+3)));
    s=text.slice(e+3);
    tri=null;
  }
  bdepth=depth; pendDfn=false;
  LRE.lastIndex=0;
  while((m=LRE.exec(s))!==null){
    // the gaps are dots, commas, colons and whitespace — never < > or &,
    // which are all operators — so they pass through unescaped, and they
    // must not clear pendDfn: "def" and its name are separated by one.
    if(m.index>last)out+=s.slice(last,m.index);
    last=m.index+m[0].length;
    if(m[7]){out+=word(m[7],s,last);continue;}
    pendDfn=false;
    if(m[1]){out+=sp('com',esc(m[1]));continue;}
    if(m[2]||m[4]){out+=sp('str',esc(m[2]||m[4]));continue;}
    if(m[3]){                       // opens here, closes on some later line
      out+=sp('str',esc(s.slice(m.index)));
      return {html:out,tri:m[3].slice(-3),depth:bdepth};
    }
    if(m[5]){out+=sp('dec',m[5]);continue;}
    if(m[6]){out+=sp('num',m[6]);continue;}
    if(m[8]){out+=brk(m[8]);continue;}
    if(m[9]){out+=sp('op',OPESC[m[9]]||m[9]);continue;}
  }
  out+=s.slice(last);
  return {html:out,tri:null,depth:bdepth};
}

// Each line's markup lives in an inline span, and the newlines between them
// are real newline characters exactly as before — an inline box does not
// create a line box of its own, so #hl wraps identically to #ed and identically
// to how it did when this was one string. That is the whole reason for doing it
// this way rather than a block per line.
var LTEXT=[], LOUT=[];

function fullPaint(ls){
  var html=[],tri=null,depth=0,i,r;
  LTEXT=ls.slice(); LOUT=new Array(ls.length);
  for(i=0;i<ls.length;i++){
    r=renderLine(ls[i],tri,depth);
    LOUT[i]={inTri:tri,inDepth:depth,tri:r.tri,depth:r.depth};
    html.push('<span>'+r.html+'</span>');
    tri=r.tri; depth=r.depth;
  }
  hl.innerHTML=html.join('\n')+'\n\n';
}

// Repaint from the first changed line, and keep going only while the state
// handed to a line differs from the state it was last drawn with. Typing in
// the middle of a file stops after one line; opening a bracket or a docstring
// carries on down, because those genuinely change what follows.
function linePaint(ls){
  var n=ls.length,i=0,kids=hl.children;
  while(i<n&&ls[i]===LTEXT[i])i++;
  if(i>=n)return;
  var tri=i?LOUT[i-1].tri:null, depth=i?LOUT[i-1].depth:0;
  for(var j=i;j<n;j++){
    if(j>i&&ls[j]===LTEXT[j]&&LOUT[j].inTri===tri&&LOUT[j].inDepth===depth)break;
    var r=renderLine(ls[j],tri,depth);
    if(kids[j])kids[j].innerHTML=r.html;
    LTEXT[j]=ls[j];
    LOUT[j]={inTri:tri,inDepth:depth,tri:r.tri,depth:r.depth};
    tri=r.tri; depth=r.depth;
  }
}

function paintNow(){
  var t0=now();
  // one read of .value for the whole pass — it is a getter on a form control,
  // not a plain property, and this used to touch it four times per frame
  var v=ed.value;
  var ls=v.split('\n');
  // adding or removing a line moves every span after it, so that case rebuilds
  if(ls.length!==LTEXT.length||hl.children.length!==ls.length)fullPaint(ls);
  else linePaint(ls);
  hl.scrollTop=ed.scrollTop;
  var mx=0;
  for(var i=0;i<ls.length;i++)if(ls[i].length>mx)mx=ls[i].length;
  // the key figure is key-down to painted, which includes the wait for the
  // frame; the repaint on its own is in the dot's tap message.
  ct.textContent=ls.length+' ln · max '+mx
    +(keyMs>16?' · '+Math.round(keyMs)+'ms':'');
  // the old squiggles describe text that has since moved, so they go away —
  // but hide the layer rather than clearing it. innerHTML='' tears down a
  // whole document's worth of nodes, and the next lint rebuilds it anyway.
  if(erShown&&er){er.style.visibility='hidden';erShown=false;}
  lintPending=true;
  try{clearTimeout(lintT);}catch(e){}
  lintT=setTimeout(function(){redline(ed.value.split('\n'));},220);
  // The pad writes ed.value directly and #ed is inputmode="none", so the
  // 'input' event store.js listens on never fires for a typed character. Every
  // mutation repaints, so the save has to be triggered from here instead.
  if(lastVal!==null&&lastVal!==v&&typeof queue==='function'){
    try{queue();}catch(e){}
  }
  lastVal=v;
  if(t0){
    var t1=now();
    slowMs=Math.max(t1-t0,slowMs*0.85);
    if(keyT0){keyMs=Math.max(t1-keyT0,keyMs*0.85);keyT0=0;}
  }
}
var T=null;
function tgt(){return T||ed;}
// focus() on an element that already has it is not free on iOS — it can still
// go through scroll-into-view. Every key press was calling it.
function refocus(x){if(document.activeElement!==x)x.focus();}
function ins(t,back){
  var x=tgt(),s=x.selectionStart,e=x.selectionEnd,v=x.value;
  x.value=v.slice(0,s)+t+v.slice(e);
  x.selectionStart=x.selectionEnd=s+t.length-(back||0);
  refocus(x);
  if(x===ed){autoCorrect();paint();}
}

// ---- autocorrect ------------------------------------------------------------
// The keyboard's version of this, not the linter's: a word is fixed the moment
// you finish it, and undone with one tap. The linter's "did you mean" still
// exists for what this will not touch, but waiting for a lint to fix a typo you
// already know you made is too slow to be worth having.

var AUTOIGNORE={};        // words you have told it to leave alone, this session
var fixNote=null, fixT=null;

// Words already in the file are part of the dictionary — your own names are
// not typos — and a word used more than once here is certainly deliberate.
function bufferWords(){
  var set={},m,re=/[A-Za-z_]\w*/g,v=ed.value;
  while((m=re.exec(v))!==null)set[m[0]]=(set[m[0]]||0)+1;
  return set;
}

// Prose in a comment is fair game; the contents of a string are data, and
// silently editing someone's data is not a thing a keyboard should do.
function inQuotes(line,at){
  var q=null;
  for(var i=0;i<at&&i<line.length;i++){
    var c=line.charAt(i);
    if(q){ if(c==='\\')i++; else if(c===q)q=null; continue; }
    if(c==='"'||c==="'")q=c;
  }
  return !!q;
}

function autoCorrect(){
  if(typeof osa!=='function')return false;
  var v=ed.value,p=ed.selectionStart||0;
  if(p<2||/\w/.test(v.charAt(p-1)))return false;   // still inside a word

  var e=p-1;
  while(e>0&&!/\w/.test(v.charAt(e-1)))e--;
  if(e<=0)return false;
  var s=e;
  while(s>0&&/\w/.test(v.charAt(s-1)))s--;
  var w=v.slice(s,e);

  // four characters and up. three-letter words are one edit from far too much
  // — "foo" would become "for" every time you typed it.
  if(w.length<4||!/^[A-Za-z_]/.test(w))return false;
  if(AUTOIGNORE[w]||v.charAt(s-1)==='.')return false;
  if(KWSET[w]||BISET[w]||CONSET[w]||SELFSET[w])return false;

  var ls=v.slice(0,s).split('\n'),li=ls.length-1;
  if(inQuotes(ls[li],ls[li].length))return false;
  // a docstring is a string too; the paint already knows which lines are inside
  if(li>0&&LOUT[li-1]&&LOUT[li-1].tri)return false;

  var seen=bufferWords();
  if(seen[w]>1)return false;         // written twice: you meant it

  var pool={},k;
  for(k in KWSET)pool[k]=1;
  for(k in BISET)pool[k]=1;
  for(k in seen)if(seen.hasOwnProperty(k)&&k!==w)pool[k]=1;
  delete pool[w];

  var best='',ties=0;
  for(k in pool){
    if(!pool.hasOwnProperty(k)||k.length<3)continue;
    if(osa(w,k,1)===1){ if(!ties)best=k; ties++; }
  }
  if(ties!==1)return false;          // a tie is a guess, and this one is silent

  ed.value=v.slice(0,s)+best+v.slice(e);
  ed.selectionStart=ed.selectionEnd=p+(best.length-w.length);
  noteFix(s,w,best);
  try{if(typeof queue==='function')queue();}catch(_){}
  return true;
}

function noteFix(at,from,to){
  fixNote={at:at,from:from,to:to};
  if(warn){warn.className='hint';warn.textContent=from+' → '+to+'  ·  tap to undo';}
  try{clearTimeout(fixT);}catch(_){}
  fixT=setTimeout(function(){
    fixNote=null;
    if(warn&&warn.className==='hint'){warn.className='';warn.textContent='';}
    showErrs(ed.value.split('\n'));
  },5000);
}

// Put the word back and stop correcting it. Both halves matter: undoing a
// correction you did not want, and not having to undo it again.
function undoFix(){
  if(!fixNote)return false;
  var f=fixNote,v=ed.value;
  fixNote=null;
  try{clearTimeout(fixT);}catch(_){}
  if(v.substr(f.at,f.to.length)===f.to){
    ed.value=v.slice(0,f.at)+f.from+v.slice(f.at+f.to.length);
    ed.selectionStart=ed.selectionEnd=f.at+f.from.length;
    refocus(ed); paint();
    try{if(typeof queue==='function')queue();}catch(_){}
  }
  AUTOIGNORE[f.from]=1;
  if(warn){warn.className='';warn.textContent='';}
  showErrs(ed.value.split('\n'));
  return true;
}
function dedent(){
  var v=ed.value,s=ed.selectionStart,ls=v.lastIndexOf('\n',s-1)+1,
      m=v.slice(ls).match(/^ {1,4}/);
  if(!m)return;
  ed.value=v.slice(0,ls)+v.slice(ls+m[0].length);
  ed.selectionStart=ed.selectionEnd=Math.max(ls,s-m[0].length);
  refocus(ed); paint();
}
function back(){
  var x=tgt(),s=x.selectionStart,e=x.selectionEnd,v=x.value;
  var ed=x;
  if(s!==e){ed.value=v.slice(0,s)+v.slice(e);
    ed.selectionStart=ed.selectionEnd=s; refocus(ed); paint(); return;}
  if(s===0)return;
  var ls=v.lastIndexOf('\n',s-1)+1, pre=v.slice(ls,s), n=1;
  if(pre.length&&pre.length%4===0&&/^ +$/.test(pre))n=4;
  ed.value=v.slice(0,s-n)+v.slice(s);
  ed.selectionStart=ed.selectionEnd=s-n;
  refocus(ed); paint();
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
    keyT0=now();          // stopped when the repaint that shows it finishes
    b.classList.add('hit');
    fn();
    // ios safari does not implement this, so the tick the pad was written for
    // has never fired on the device it was written for.
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

// crossing into another line judges the one just left and quiets the one just
// entered, so the lint has to run on caret movement and not only on edits.
// leaving the editor entirely counts as leaving the line, and everything is
// judged again.
var lastLine=-1;
function caretWatch(){
  var l=caretLine();
  if(l===lastLine)return;
  lastLine=l;
  // moving the caret cannot change what is wrong, only which line is exempt,
  // so this re-renders the last result instead of linting again. if an edit is
  // still waiting to be linted, that pass will do it and this would only paint
  // stale marks against text that has already moved.
  if(!lintPending)showErrs(ed.value.split('\n'));
}
document.addEventListener('selectionchange',caretWatch);
ed.addEventListener('click',caretWatch);
ed.addEventListener('keyup',caretWatch);
ed.addEventListener('blur',caretWatch);
ed.addEventListener('focus',caretWatch);
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
