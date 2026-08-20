// lint.js — python syntax checks with character positions.
// one pass strips strings and comments and tracks bracket nesting; rules
// then run over the stripped text. every error carries {line,col,len} so the
// underline sits on the token rather than the whole line.
// precision beats coverage: one bad squiggle and you stop trusting all of
// them, so rules that can't be made certain are left out.

var OPEN={'(':1,'[':1,'{':1}, CLOSE={')':'(',']':'[','}':'{'};
var COMPOUND=/^(\s*)(def|class|if|elif|else|for|while|with|try|except|finally)\b/;
var RESERVED=/^(True|False|None|and|or|not|in|is|if|elif|else|def|class|return|import|from|pass|break|continue|lambda|yield|while|for|with|try|except|finally|global|nonlocal|del|assert|raise|as|async|await)$/;

// characters that are never python outside a string or a comment. most of
// these arrive on a phone by paste or autocorrect and are invisible on screen
// — a curly quote and a straight one are one pixel apart at this size — which
// is exactly why they earn a squiggle.
// written as escapes on purpose: a literal U+00A0 in a character class is
// invisible in every editor, including this one.
var STRAY=/[$?`\u00a0\u2018\u2019\u201c\u201d\u2013\u2014\u00d7\u2212]/g;
var STRAYMSG={
  '$':'"$" is not python',
  '?':'"?" is not python',
  '`':'backticks are not python',
  '\u00a0':'non-breaking space, not a space',
  '\u2018':'curly quote - python needs \'',
  '\u2019':'curly quote - python needs \'',
  '\u201c':'curly quote - python needs "',
  '\u201d':'curly quote - python needs "',
  '\u2013':'en dash, not a minus',
  '\u2014':'em dash, not a minus',
  '\u00d7':'\u00d7 is not *',
  '\u2212':'minus sign, not a hyphen'
};

// which keyword a block-continuation clause is allowed to follow at its own
// indent. anything else is dangling and cannot be anything but an error.
var FOLLOWS={
  elif:{'if':1,elif:1},
  'else':{'if':1,elif:1,'for':1,'while':1,'try':1,'except':1},
  'except':{'try':1,'except':1},
  'finally':{'try':1,'except':1,'else':1}
};

// the '(' opening a trailing call in an assignment target, or -1 if the
// parenthesis is grouping rather than calling — '(a, b) = 1, 2' is legal.
function callOpen(lhs){
  if(!/\)$/.test(lhs))return -1;
  var d=0;
  for(var j=lhs.length-1;j>=0;j--){
    var ch=lhs.charAt(j);
    if(ch===')')d++;
    else if(ch==='('){
      if(--d)continue;
      var k=j-1;
      while(k>=0&&lhs.charAt(k)===' ')k--;
      return (k>=0&&/[\w\]]/.test(lhs.charAt(k)))?j:-1;
    }
  }
  return -1;
}

// blank the r/b/f/u letters in front of a string literal, so the f of an
// f-string is not left behind looking like a bare name. only a prefix if what
// sits before it is not itself part of an identifier — "if'a'" is not one.
function eatPrefix(L,flat,mask,j){
  var k=j-1,n=0;
  while(k>=0&&n<2&&/[rbfuRBFU]/.test(L.charAt(k))){k--;n++;}
  if(!n||(k>=0&&/\w/.test(L.charAt(k))))return;
  for(var q=k+1;q<j;q++){flat[q]=' ';mask[q]=' ';}
}

// two stripped copies of a line, both original length so columns stay true:
//   flat — strings and comments blanked, brackets and contents kept
//   mask — flat, plus everything nested inside brackets blanked
function scanLine(L,st){
  var flat=new Array(L.length), mask=new Array(L.length), j=0;
  for(;j<L.length;j++){
    var c=L.charAt(j), three=L.substr(j,3);
    if(st.tri){
      flat[j]=mask[j]=' ';
      if(three===st.tri){flat[j+1]=flat[j+2]=' ';mask[j+1]=mask[j+2]=' ';st.tri=null;j+=2;}
      continue;
    }
    if(st.q){
      flat[j]=mask[j]=' ';
      if(c==='\\'){if(j+1<L.length){flat[j+1]=mask[j+1]=' ';j++;}continue;}
      if(c===st.q)st.q=null;
      continue;
    }
    if(c==='#'){ while(j<L.length){flat[j]=mask[j]=' ';j++;} break; }
    if(three==='"""'||three==="'''"){
      st.tri=three; st.triLine=st.line; st.triCol=j;
      eatPrefix(L,flat,mask,j);
      flat[j]=flat[j+1]=flat[j+2]=' '; mask[j]=mask[j+1]=mask[j+2]=' '; j+=2; continue;
    }
    if(c==='"'||c==="'"){
      st.q=c; st.qcol=j; eatPrefix(L,flat,mask,j);
      flat[j]=mask[j]=' '; continue;
    }
    if(OPEN[c]){
      flat[j]=c; mask[j]=' ';
      st.stack.push({ch:c,line:st.line,col:j}); continue;
    }
    if(CLOSE[c]){
      flat[j]=c; mask[j]=' ';
      if(!st.stack.length)
        st.errs.push({line:st.line,col:j,len:1,msg:"no '"+CLOSE[c]+"' to match this"});
      else if(st.stack[st.stack.length-1].ch!==CLOSE[c]){
        var o=st.stack.pop();
        st.errs.push({line:st.line,col:j,len:1,
          msg:"'"+o.ch+"' on line "+(o.line+1)+" wants its own closer"});
      }else st.stack.pop();
      continue;
    }
    flat[j]=c;
    mask[j]=st.stack.length?' ':c;
  }
  return {flat:flat.join(''),mask:mask.join('')};
}

// a lone '=' outside brackets, skipping ==, !=, <=, >=, +=, and friends
function findBareEq(s,from){
  for(var j=from;j<s.length;j++){
    if(s.charAt(j)!=='=')continue;
    if(s.charAt(j+1)==='='){j++;continue;}
    if('=!<>+-*/%&|^~'.indexOf(s.charAt(j-1))>=0)continue;
    return j;
  }
  return -1;
}

// ---- names -----------------------------------------------------------------
// Two things live here. collectBindings is the flat version, still used to hand
// lintPy the names bound by the *other* open files, which have no scope
// relationship to this one. The scoped version further down is what the check
// actually resolves against.
// Either way bindings are over-collected on purpose: a name bound by a
// construct this misses would show up as a squiggle under working code, which
// costs far more than the report it would otherwise have missed.

var PYKW={};
('False None True and as assert async await break class continue def del elif '
+'else except finally for from global if import in is lambda nonlocal not or '
+'pass raise return try while with yield match case')
  .split(' ').forEach(function(k){PYKW[k]=1;});

var BUILTIN={};
('abs aiter anext all any ascii bin bool breakpoint bytearray bytes callable '
+'chr classmethod compile complex delattr dict dir divmod enumerate eval exec '
+'filter float format frozenset getattr globals hasattr hash help hex id input '
+'int isinstance issubclass iter len list locals map max memoryview min next '
+'object oct open ord pow print property range repr reversed round set setattr '
+'slice sorted staticmethod str sum super tuple type vars zip '
+'ArithmeticError AssertionError AttributeError BaseException BaseExceptionGroup '
+'BlockingIOError BrokenPipeError BufferError BytesWarning ChildProcessError '
+'ConnectionAbortedError ConnectionError ConnectionRefusedError '
+'ConnectionResetError DeprecationWarning EOFError EncodingWarning '
+'EnvironmentError Exception ExceptionGroup FileExistsError FileNotFoundError '
+'FloatingPointError FutureWarning GeneratorExit IOError ImportError '
+'ImportWarning IndentationError IndexError InterruptedError IsADirectoryError '
+'KeyError KeyboardInterrupt LookupError MemoryError ModuleNotFoundError '
+'NameError NotADirectoryError NotImplemented NotImplementedError OSError '
+'OverflowError PendingDeprecationWarning PermissionError ProcessLookupError '
+'RecursionError ReferenceError ResourceWarning RuntimeError RuntimeWarning '
+'StopAsyncIteration StopIteration SyntaxError SyntaxWarning SystemError '
+'SystemExit TabError TimeoutError TypeError UnboundLocalError '
+'UnicodeDecodeError UnicodeEncodeError UnicodeError UnicodeTranslateError '
+'UnicodeWarning UserWarning ValueError Warning ZeroDivisionError '
+'Ellipsis NotImplemented __import__ '
// self and cls are never worth flagging, and zooming into a method replaces
// the buffer with its body, so the def line that binds them is not even there.
+'self cls').split(/\s+/).forEach(function(k){if(k)BUILTIN[k]=1;});

function bindIdents(s,into){
  var re=/[A-Za-z_]\w*/g,m;
  while((m=re.exec(s))!==null){
    // skip an attribute, and the "e5" the identifier pattern finds inside 1e5
    if(m.index>0&&/[\w.]/.test(s.charAt(m.index-1)))continue;
    if(PYKW[m[0]])continue;
    into[m[0]]=1;
  }
}

// the text between an opening bracket at `from` and its matching close
function spanTo(s,from){
  var d=0;
  for(var j=from;j<s.length;j++){
    var c=s.charAt(j);
    if(c==='('||c==='['||c==='{')d++;
    else if(c===')'||c===']'||c==='}'){if(!--d)return s.slice(from+1,j);}
  }
  return s.slice(from+1);
}

// every name this source binds, by any means, anywhere. sets into['*'] if the
// file has a star import, after which nothing can be called undefined.
function collectBindings(src,into){
  var st={q:null,qcol:0,tri:null,triLine:0,triCol:0,stack:[],errs:[],line:0};
  var lines=src.split('\n'),flats=[],masks=[],depth=[],i,m;
  for(i=0;i<lines.length;i++){
    st.line=i;
    var r=scanLine(lines[i],st);
    flats.push(r.flat); masks.push(r.mask); depth.push(st.stack.length);
  }

  // import statements bind generously: every identifier in the statement,
  // continuation lines included. binding a module path costs nothing.
  var importing=false;
  for(i=0;i<flats.length;i++){
    if(!importing&&/^[ \t]*(from|import)\b/.test(flats[i]))importing=true;
    if(!importing)continue;
    if(/(^|[\s,(])\*/.test(flats[i]))into['*']=1;
    bindIdents(flats[i],into);
    if(!depth[i]&&!/\\[ \t]*$/.test(flats[i]))importing=false;
  }

  var S=flats.join('\n');

  // def NAME(params) and class NAME(bases) — the whole parameter list is bound,
  // defaults and annotations included, which over-collects and is fine.
  var dre=/\b(def|class)\s+([A-Za-z_]\w*)/g;
  while((m=dre.exec(S))!==null){
    into[m[2]]=1;
    var open=S.indexOf('(',m.index+m[0].length);
    if(open>=0&&!/[^ \t]/.test(S.slice(m.index+m[0].length,open)))
      bindIdents(spanTo(S,open),into);
  }

  // lambda params, up to the colon that ends them
  var lre=/\blambda\b/g;
  while((m=lre.exec(S))!==null){
    var col=S.indexOf(':',m.index);
    if(col>m.index)bindIdents(S.slice(m.index+6,col),into);
  }

  // for TARGET in ... — statement or comprehension, both look the same here
  var fre=/\bfor\b([\s\S]*?)\bin\b/g;
  while((m=fre.exec(S))!==null)bindIdents(m[1],into);

  // with ... as X, except E as X, import y as X
  var are=/\bas\s+([A-Za-z_]\w*)/g;
  while((m=are.exec(S))!==null)into[m[1]]=1;

  // global / nonlocal declare names outright
  var gre=/^[ \t]*(?:global|nonlocal)\b([^\n]*)/gm;
  while((m=gre.exec(S))!==null)bindIdents(m[1],into);

  // walrus, and a bare annotation like "count: int" with no value
  var wre=/([A-Za-z_]\w*)\s*:=/g;
  while((m=wre.exec(S))!==null)into[m[1]]=1;
  var nre=/^[ \t]*([A-Za-z_]\w*)\s*:[ \t]*[^=\n][^\n]*$/gm;
  while((m=nre.exec(S))!==null)if(!PYKW[m[1]])into[m[1]]=1;

  // assignment targets. the mask copy has bracket contents blanked, so an '='
  // found there is the statement's own operator and never a keyword argument;
  // the text left of it is read back out of flat, where the names survive.
  for(i=0;i<masks.length;i++){
    var eq=-1,at=0;
    for(;;){
      var nx=findBareEq(masks[i],at);
      if(nx<0)break;
      eq=nx; at=nx+1;
    }
    if(eq>0)bindIdents(flats[i].slice(0,eq),into);
  }
}

// is this identifier a keyword argument rather than a use of a variable?
function isKwarg(s,at,end){
  var b=at-1;
  while(b>=0&&s.charAt(b)===' ')b--;
  if(b<0||'(,'.indexOf(s.charAt(b))<0)return false;
  var a=end;
  while(a<s.length&&s.charAt(a)===' ')a++;
  return s.charAt(a)==='='&&s.charAt(a+1)!=='=';
}

function tidy(errs){
  errs.sort(function(a,b){return a.line-b.line||a.col-b.col;});
  var out=[],last={};
  errs.forEach(function(e){
    e.len=Math.max(1,e.len|0); e.col=Math.max(0,e.col|0);
    var end=last[e.line];
    if(end!==undefined&&e.col<end)return;    // overlaps a mark already placed
    last[e.line]=e.col+e.len;
    out.push(e);
  });
  return out;
}

// known: names bound in the other open files, so a helper defined in a sibling
// file is not reported as missing. Optional — without it the check just sees
// one file.
function lintPy(src,known){
  var lines=src.split('\n');
  var st={q:null,qcol:0,tri:null,triLine:0,triCol:0,stack:[],errs:[],line:0};
  var levels=[0];        // open indent columns, the way CPython tracks them
  var opensBlock=false;  // previous statement ended in ':'
  var continues=false;   // previous statement ended in '\'
  var started=false;
  var stmtCompound=false;
  var lastAt={};         // indent column -> keyword the last statement there began with

  var outer={},kn;
  if(known)for(kn in known)if(known.hasOwnProperty(kn))outer[kn]=1;
  var scoped=buildScopes(src);
  // after "from x import *" any name at all might exist, so the whole check
  // has to stand down rather than guess.
  var checkNames=!scoped.module.names['*']&&!outer['*'];
  var importing=false;

  for(var i=0;i<lines.length;i++){
    st.line=i;
    var raw=lines[i];
    var nestedAtStart=st.stack.length||st.tri;
    var r=scanLine(raw,st);
    var code=r.mask.replace(/\s+$/,'');
    var flat=r.flat.replace(/\s+$/,'');

    if(st.q){
      st.errs.push({line:i,col:st.qcol,len:Math.max(1,raw.length-st.qcol),
        msg:'unterminated string'});
      st.q=null;
    }

    // before the blank-line skip below: a line holding nothing but a
    // non-breaking space looks blank and is still a syntax error. r.flat is
    // used untrimmed here because \s strips   along with real spaces.
    STRAY.lastIndex=0;
    var sm;
    while((sm=STRAY.exec(r.flat))!==null)
      st.errs.push({line:i,col:sm.index,len:1,
        msg:STRAYMSG[sm[0]]||'not valid python'});

    // a name bound in no open file cannot resolve. import statements are
    // skipped whole — the names in them are module paths, not uses.
    if(!importing&&/^[ \t]*(from|import)\b/.test(flat))importing=true;
    if(checkNames&&!importing){
      var ure=/[A-Za-z_]\w*/g,um;
      while((um=ure.exec(r.flat))!==null){
        var nm=um[0],at=um.index;
        // an attribute is not a name, and 1e5 is not a use of "e5"
        if(at>0&&/[\w.]/.test(r.flat.charAt(at-1)))continue;
        if(PYKW[nm]||BUILTIN[nm]||outer[nm])continue;
        if(/^__\w*__$/.test(nm))continue;           // supplied by the runtime
        if(isKwarg(r.flat,at,at+nm.length))continue;
        var here=scoped.scopeOf[i]||scoped.module;
        if(visible(here,nm))continue;
        if(scoped.header[i]&&here.parent&&visible(here.parent,nm))continue;
        st.errs.push({line:i,col:at,len:nm.length,
          msg:'"'+nm+'" is not defined in this scope'});
      }
    }
    if(importing&&!st.stack.length&&!/\\[ \t]*$/.test(flat))importing=false;

    // blank or comment-only, and not part of a multi-line statement
    if(!code.trim()&&!nestedAtStart)continue;

    var complete=!st.stack.length&&!st.tri;
    var ind=(raw.match(/^[ \t]*/)||[''])[0];
    var col0=ind.length;

    // ---- first physical line of a statement -----------------------------
    if(!nestedAtStart){
      if(!continues){
        if(ind.indexOf('\t')>=0&&ind.indexOf(' ')>=0)
          st.errs.push({line:i,col:0,len:col0,msg:'mixed tabs and spaces'});

        if(opensBlock){
          if(col0<=levels[levels.length-1])
            st.errs.push({line:i,col:0,len:Math.max(1,col0),
              msg:'expected an indented block'});
          else levels.push(col0);
        }else if(col0>levels[levels.length-1]){
          st.errs.push({line:i,col:0,len:col0,msg:'unexpected indent'});
        }else{
          while(levels.length>1&&col0<levels[levels.length-1])levels.pop();
          if(col0!==levels[levels.length-1])
            st.errs.push({line:i,col:0,len:Math.max(1,col0),
              msg:'indent matches no enclosing block'});
        }
        if(started&&ind.indexOf('\t')<0&&col0%4!==0)
          st.errs.push({line:i,col:0,len:col0,msg:'indent is not a multiple of 4'});

        // an elif/else/except/finally has to answer something at its own
        // indent. guarded by !continues because 'x = 1 if y \' then 'else 2'
        // puts a perfectly legal else at the start of a line.
        var bk=code.match(/^(\s*)([A-Za-z_]\w*)/);
        var kwHere=bk?bk[2]:'';
        var ok=FOLLOWS[kwHere];
        if(ok&&!ok[lastAt[col0]])
          st.errs.push({line:i,col:bk[1].length,len:kwHere.length,
            msg:'"'+kwHere+'" with no '
              +((kwHere==='except'||kwHere==='finally')?'"try"':'"if"')
              +' at this indent'});
        for(var kc in lastAt)if(lastAt.hasOwnProperty(kc)&&+kc>col0)delete lastAt[kc];
        lastAt[col0]=kwHere;
      }
      started=true;
      stmtCompound=COMPOUND.test(code);

      var d=flat.match(/^(\s*)(def|class)\s*(\w*)/);
      if(d){
        if(!d[3])
          st.errs.push({line:i,col:d[1].length,len:d[2].length,msg:d[2]+' needs a name'});
        else if(d[2]==='def'&&flat.indexOf('(',d[1].length+3)<0)
          st.errs.push({line:i,col:flat.indexOf(d[3],d[1].length),len:d[3].length,
            msg:'def needs parentheses'});
      }

      var c2=code.match(/^(\s*)(if|elif|while)\b/);
      if(c2){
        var eq=findBareEq(code,c2[0].length);
        if(eq>=0)st.errs.push({line:i,col:eq,len:1,msg:'use "==" to compare'});
      }

      var a=code.match(/^(\s*)([A-Za-z_]\w*|\d[\w.]*)\s*=(?!=)/);
      if(a){
        if(RESERVED.test(a[2]))
          st.errs.push({line:i,col:a[1].length,len:a[2].length,
            msg:'cannot assign to "'+a[2]+'"'});
        else if(/^\d/.test(a[2]))
          st.errs.push({line:i,col:a[1].length,len:a[2].length,
            msg:'cannot assign to a number'});
      }

      // mask blanks brackets and everything in them, so a bare '=' found in
      // it is the statement's assignment operator and never one inside a call.
      // whatever sits to its left in flat is the target: 'f(x) = 1' is an
      // error, while 'f(x)[0] = 1' and '(a, b) = 1, 2' are both fine.
      if(!continues){
        var eq0=findBareEq(code,0);
        if(eq0>0){
          var lhs=flat.slice(0,eq0).replace(/\s+$/,'');
          if(callOpen(lhs)>=0){
            var lead=lhs.length-lhs.replace(/^\s+/,'').length;
            st.errs.push({line:i,col:lead,len:Math.max(1,lhs.length-lead),
              msg:'cannot assign to a function call'});
          }
        }
      }

      // the string is blanked in flat, so this rule reads the raw line.
      // anchored at line start, so a "# print x" comment can't reach it.
      var p=raw.match(/^(\s*)print\s+(?![(=])\S/);
      if(p)st.errs.push({line:i,col:p[1].length,len:5,msg:'python 3 needs print(...)'});
    }

    // ---- the line a statement finishes on -------------------------------
    // the colon lives at the end of the whole statement, which for a
    // multi-line header is not the line the keyword was on.
    if(complete){
      // the colon has to be there, but it does not have to be last: "if a: pass"
      // and "def f(x): return x" put the body on the same line. code is the
      // mask, so a colon found in it is at depth zero and never one from a dict
      // display or a slice.
      var tail=flat.slice(-1);
      if(stmtCompound&&code.indexOf(':')<0&&tail!=='\\')
        st.errs.push({line:i,col:Math.max(0,flat.length-1),len:1,msg:'missing ":"'});
      opensBlock=tail===':';
      continues=tail==='\\';
      stmtCompound=false;
    }
  }

  if(st.tri)st.errs.push({line:st.triLine,col:st.triCol,len:3,
    msg:'this """ is never closed'});
  st.stack.forEach(function(s){
    st.errs.push({line:s.line,col:s.col,len:1,msg:"'"+s.ch+"' is never closed"});});

  return tidy(st.errs);
}

// names bound by a source, for handing the sibling files to lintPy
function lintNames(src,into){
  var o=into||{};
  collectBindings(src,o);
  return o;
}

// ---- scopes ----------------------------------------------------------------
// Python resolves a name against the scope it is written in, then the enclosing
// functions, then the module, then the builtins — and never against a sibling
// function's locals. Indentation is enough to rebuild that here: a def or class
// header opens a scope, and its body is everything indented past it.
// A class body is skipped on the way out, because a method genuinely cannot see
// the class's own attributes without going through self.
// Within one scope the order does not matter: python decides what is local to a
// function from the whole body before running a line of it.

function newScope(kind,indent,parent){
  return {kind:kind,indent:indent,names:{},parent:parent};
}

// every name a statement binds, into the scope the statement was written in
function bindStatement(text,head,flats,masks,from,to,sc,mod){
  var m,q;
  // these two reach past the scope they are written in, which is the point
  if((m=text.match(/^[ \t]*global\b([\s\S]*)$/))!==null){
    bindIdents(m[1],mod.names); return;
  }
  if((m=text.match(/^[ \t]*nonlocal\b([\s\S]*)$/))!==null){
    var up=sc.parent;
    while(up&&up.kind!=='def')up=up.parent;
    bindIdents(m[1],(up||mod).names);
    return;
  }
  if(/^[ \t]*(from|import)\b/.test(head)){
    if(/(^|[\s,(])\*/.test(text))mod.names['*']=1;
    bindIdents(text,sc.names);
    return;
  }

  var lre=/\blambda\b/g;
  while((m=lre.exec(text))!==null){
    var c=text.indexOf(':',m.index);
    if(c>m.index)bindIdents(text.slice(m.index+6,c),sc.names);
  }
  var fre=/\bfor\b([\s\S]*?)\bin\b/g;
  while((m=fre.exec(text))!==null)bindIdents(m[1],sc.names);
  var are=/\bas[ \t]+([A-Za-z_]\w*)/g;
  while((m=are.exec(text))!==null)sc.names[m[1]]=1;
  var wre=/([A-Za-z_]\w*)\s*:=/g;
  while((m=wre.exec(text))!==null)sc.names[m[1]]=1;
  m=head.match(/^[ \t]*([A-Za-z_]\w*)[ \t]*:[ \t]*[^=\s][^\n]*$/);
  if(m&&!PYKW[m[1]])sc.names[m[1]]=1;

  // assignment targets: the mask copy has bracket contents blanked, so an '='
  // found there is the statement's own operator and never a keyword argument.
  for(q=from;q<=to;q++){
    var eq=-1,at=0,nx;
    for(;;){nx=findBareEq(masks[q],at);if(nx<0)break;eq=nx;at=nx+1;}
    if(eq>0)bindIdents(flats[q].slice(0,eq),sc.names);
  }
}

function buildScopes(src){
  var st={q:null,qcol:0,tri:null,triLine:0,triCol:0,stack:[],errs:[],line:0};
  var lines=src.split('\n'),flats=[],masks=[],open=[],i,q;
  for(i=0;i<lines.length;i++){
    st.line=i;
    var r=scanLine(lines[i],st);
    flats.push(r.flat); masks.push(r.mask);
    open.push((st.stack.length||st.tri)?1:0);
  }

  var mod=newScope('module',-1,null);
  var stk=[mod], scopeOf=new Array(lines.length), hdr=new Array(lines.length);
  i=0;
  while(i<lines.length){
    // a logical statement runs until brackets close and no backslash trails
    var k=i;
    while(k<lines.length-1&&(open[k]||/\\[ \t]*$/.test(flats[k])))k++;
    var head=flats[i].replace(/\s+$/,'');
    if(!head.length){
      for(q=i;q<=k;q++)scopeOf[q]=stk[stk.length-1];
      i=k+1; continue;
    }
    var ind=(lines[i].match(/^[ \t]*/)||[''])[0].length;
    while(stk.length>1&&stk[stk.length-1].indent>=ind)stk.pop();
    var top=stk[stk.length-1];
    var text=flats.slice(i,k+1).join('\n');

    var dm=head.match(/^[ \t]*(?:async[ \t]+)?(def|class)[ \t]+([A-Za-z_]\w*)/);
    if(dm){
      top.names[dm[2]]=1;              // the name belongs to the enclosing scope
      var child=newScope(dm[1]==='class'?'class':'def',ind,top);
      if(dm[1]==='def'){
        var after=dm.index+dm[0].length;
        var op=text.indexOf('(',after);
        if(op>=0&&!/[^ \t]/.test(text.slice(after,op)))
          bindIdents(spanTo(text,op),child.names);
      }
      // the header lines resolve against the child, so that a one-line body
      // like "def f(x): return x" can still see x. they are also marked as
      // headers, because everything else on that line — the method's own name,
      // a default value, a base class — is read in the enclosing scope, and
      // that scope may be a class body the child is not allowed to see through.
      for(q=i;q<=k;q++){scopeOf[q]=child;hdr[q]=1;}
      stk.push(child);
    }else{
      for(q=i;q<=k;q++)scopeOf[q]=top;
      bindStatement(text,head,flats,masks,i,k,top,mod);
    }
    i=k+1;
  }
  return {scopeOf:scopeOf,header:hdr,module:mod};
}

// the scope chain, with class bodies skipped once we have stepped out of one
function visible(sc,nm){
  var first=true;
  while(sc){
    if((first||sc.kind!=='class')&&sc.names[nm])return true;
    first=false;
    sc=sc.parent;
  }
  return false;
}
