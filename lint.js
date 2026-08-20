// lint.js — cheap python syntax checks. no runtime, no parse tree.
// walks the source once tracking strings, comments and bracket depth,
// then tests each line against a small set of high-precision rules.
// misses a lot on purpose: a false redline costs more than a missed one.

var COMPOUND=/^\s*(def|class|if|elif|else|for|while|with|try|except|finally)\b/;
var OPEN={'(':1,'[':1,'{':1}, CLOSE={')':'(',']':'[','}':'{'};

// blank out everything the rules must not see: string bodies, comments,
// and anything nested inside brackets. keeps length so columns stay true.
function maskLine(L,state){
  var out=new Array(L.length), j=0;
  for(;j<L.length;j++){
    var c=L.charAt(j), three=L.substr(j,3);
    if(state.tri){
      out[j]=' ';
      if(three===state.tri){out[j+1]=out[j+2]=' ';state.tri=null;j+=2;}
      continue;
    }
    if(state.q){
      out[j]=' ';
      if(c==='\\'){if(j+1<L.length)out[++j]=' ';continue;}
      if(c===state.q)state.q=null;
      continue;
    }
    if(c==='#'){ while(j<L.length)out[j++]=' '; break; }
    if(three==='"""'||three==="'''"){
      state.tri=three; state.triLine=state.line;
      out[j]=out[j+1]=out[j+2]=' '; j+=2; continue;
    }
    if(c==='"'||c==="'"){ state.q=c; out[j]=' '; continue; }
    if(OPEN[c]){ state.stack.push({ch:c,line:state.line}); out[j]=' '; continue; }
    if(CLOSE[c]){
      if(!state.stack.length)state.errs.push({line:state.line,msg:"unmatched '"+c+"'"});
      else if(state.stack[state.stack.length-1].ch!==CLOSE[c]){
        state.errs.push({line:state.line,
          msg:"'"+state.stack[state.stack.length-1].ch+"' closed by '"+c+"'"});
        state.stack.pop();
      }else state.stack.pop();
      out[j]=' '; continue;
    }
    out[j]=state.stack.length?' ':c;   // nested in brackets -> invisible
  }
  return out.join('');
}

function lintPy(src){
  var lines=src.split('\n');
  var st={q:null,tri:null,triLine:0,stack:[],errs:[],line:0};

  for(var i=0;i<lines.length;i++){
    st.line=i;
    var depthAtStart=st.stack.length;
    var code=maskLine(lines[i],st).replace(/\s+$/,'');

    if(st.q){ st.errs.push({line:i,msg:'unterminated string'}); st.q=null; }

    // only judge a line that both starts and ends at statement level
    if(st.tri||depthAtStart||st.stack.length)continue;

    if(COMPOUND.test(code)&&code.slice(-1)!==':'&&code.slice(-1)!=='\\')
      st.errs.push({line:i,msg:'missing ":"'});

    var m=code.match(/^\s*(if|elif|while)\b(.*)$/);
    if(m&&/[^=!<>+\-*\/%]=[^=]/.test(m[2]))
      st.errs.push({line:i,msg:'use "==" not "="'});
  }

  if(st.tri)st.errs.push({line:st.triLine,msg:'unterminated """ block'});
  st.stack.forEach(function(s){
    st.errs.push({line:s.line,msg:"unclosed '"+s.ch+"'"});});

  var seen={},out=[];
  st.errs.sort(function(a,b){return a.line-b.line;});
  st.errs.forEach(function(e){if(!seen[e.line]){seen[e.line]=1;out.push(e);}});
  return out;
}
