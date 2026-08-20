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
      flat[j]=flat[j+1]=flat[j+2]=' '; mask[j]=mask[j+1]=mask[j+2]=' '; j+=2; continue;
    }
    if(c==='"'||c==="'"){ st.q=c; st.qcol=j; flat[j]=mask[j]=' '; continue; }
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

function lintPy(src){
  var lines=src.split('\n');
  var st={q:null,qcol:0,tri:null,triLine:0,triCol:0,stack:[],errs:[],line:0};
  var levels=[0];        // open indent columns, the way CPython tracks them
  var opensBlock=false;  // previous statement ended in ':'
  var continues=false;   // previous statement ended in '\'
  var started=false;
  var stmtCompound=false;
  var lastAt={};         // indent column -> keyword the last statement there began with

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
      var tail=flat.slice(-1);
      if(stmtCompound&&tail!==':'&&tail!=='\\')
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
