var cell=document.getElementById('cell'), scr=document.getElementById('scr'),
    outp=document.getElementById('outp'), cname=document.getElementById('cname'),
    srcv=document.getElementById('src');
var PY=null, PYBUSY=false, CELL=null;

function fullSource(){
  var path=stack.map(function(f){return f.name;});
  save();
  var s=FILES[cur]||'';
  restorePath(path);
  return s;
}
function say(t,cls){ outp.className=cls||''; outp.textContent=t; }

function openCell(){
  if(cell.style.display==='block'){closeCell();return;}
  list.style.display='none'; gfx.style.display='none';
  var name='', body=ed.value;
  if(stack.length){ name=stack[stack.length-1].name; }
  else{
    var bs=blocks(ed.value),ln=caretLine(),pick=null;
    for(var i=0;i<bs.length;i++){
      var b=bs[i];
      if(ln>=b.s&&ln<=b.e&&(!pick||b.ind>pick.ind))pick=b;
    }
    if(pick){
      name=pick.n;
      body=ed.value.split('\n').slice(pick.s,pick.e+1).join('\n');
    }else{ name=cur.split('/').pop(); }
  }
  CELL={name:name,key:'cell:'+cur+':'+name};
  cname.textContent=name;
  srcv.textContent=body;
  scr.value=NOTES[CELL.key]||('# scratch — runs after the whole file\n'
    +'# e.g.  print('+name+')\n');
  say('');
  cell.style.display='block';
  T=scr; scr.focus();
}
function closeCell(){
  if(CELL){NOTES[CELL.key]=scr.value; try{queue();}catch(e){}}
  cell.style.display='none'; T=null; ed.focus();
}
document.getElementById('cx').addEventListener('click',closeCell);
document.getElementById('run').addEventListener('click',openCell);

function loadScript(u){
  return new Promise(function(res,rej){
    var s=document.createElement('script');
    s.src=u; s.onload=res; s.onerror=function(){rej(new Error('cdn'));};
    document.head.appendChild(s);
  });
}
var CDNS=[
 'https://cdnjs.cloudflare.com/ajax/libs/pyodide/0.26.2/pyodide.js',
 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js'
];
async function ensurePy(){
  if(PY)return PY;
  say('loading python runtime — first time only, ~10s…');
  var err=null;
  for(var i=0;i<CDNS.length;i++){
    try{ await loadScript(CDNS[i]); err=null; break; }
    catch(e){ err=e; }
  }
  if(typeof loadPyodide!=='function'){
    throw new Error('python runtime unavailable here (no CDN access).\n'
      +'Tips still work. Running needs this hosted on your own origin.');
  }
  PY=await loadPyodide({indexURL:CDNS[1].replace('pyodide.js','')});
  if(!PY||typeof PY.runPython!=='function')throw new Error('runtime init failed');
  return PY;
}
// Every model call goes through here, so the model id, the refusal check and
// the "you have not stood the proxy up yet" message live in one place.
// The browser never holds a key: API points at a worker that adds it, which is
// also what makes the request legal cross-origin.
var MODEL='claude-opus-5';
async function ask(body,beta){
  if(!API||/(^|\.)api\.anthropic\.com/.test(API))
    throw new Error('no proxy configured — point API in edit.js at your worker');
  // fallbacks:"default" reroutes a declined request server-side instead of
  // handing back a refusal; it is what the accompanying beta flag gates.
  var betas='server-side-fallback-2026-07-01'+(beta?','+beta:'');
  var r=await fetch(API+'/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','anthropic-beta':betas},
    body:JSON.stringify(body)
  });
  var d=await r.json();
  if(d.error)throw new Error(d.error.message||('api error '+r.status));
  // a refusal is a 200 with no content worth reading, so check before reading
  if(d.stop_reason==='refusal')
    throw new Error('the model declined this one'
      +(d.stop_details&&d.stop_details.category
        ? ' ('+d.stop_details.category+')' : ''));
  return d;
}

async function serverRun(){
  say('running on the server…','tip');
  var body={
    model:MODEL,
    max_tokens:8000,          // a real traceback does not fit in a thousand
    fallbacks:'default',
    tools:[{type:'code_execution_20260521',name:'code_execution'}],
    messages:[{role:'user',content:
      'Run this Python and report the output. Use the code execution tool. '
     +'Do not explain, do not comment on the code. If it raises, run it anyway '
     +'and report the traceback verbatim.\n\n```python\n'
     +fullSource().slice(0,8000)+'\n'+scr.value.slice(0,2000)+'\n```'}]
  };
  var d=await ask(body,'code-execution-2025-08-25');
  var out=[],txt=[],got=false;
  (d.content||[]).forEach(function(b){
    if(b.type==='text'&&b.text)txt.push(b.text.trim());
    // 20260521 returns bash_code_execution_tool_result; the bare name is what
    // the older tool versions returned, and costs nothing to keep accepting.
    if(b.type==='bash_code_execution_tool_result'||
       b.type==='code_execution_tool_result'){
      got=true;
      var c=b.content||{};
      if(c.stdout)out.push(c.stdout);
      if(c.stderr)out.push(c.stderr);
      if(c.content&&c.content.length)out.push('[produced '+c.content.length
        +' file(s) — plots need the Files API to display]');
    }
  });
  if(!got)throw new Error('no execution result');
  var s=out.join('\n').trim();
  say(s||txt.join('\n')||'(no output)');
  return true;
}

// The last resort when neither Pyodide nor the server can run the code: hand
// it to the clipboard so a real interpreter in the chat can. An earlier version
// asked the model to act as CPython and print what stdout would show; it was
// replaced by this and then sat unreachable, because the assignment below runs
// at load and wins over the declaration. Simulated output that looks real is
// worse than no output, so only this route survives.
function traceRun(){
  var ok=copyText(chatPayload());
  say((ok?'⇪ copied to clipboard.\n':'')
    +'No runtime in this sandbox. Paste into the chat and Claude will run it '
    +'for real — stdout, tracebacks, and plots.\n\nTap ✦ Tips for a review '
    +'without leaving the cell.','tip');
}
var PYDEAD=false;
async function runCell(){
  if(PYBUSY)return;
  if(PYDEAD){
    PYBUSY=true;
    try{ await serverRun(); }
    catch(e){ await traceRun(); }
    PYBUSY=false;
    return;
  }
  PYBUSY=true;
  try{
    if(typeof WebAssembly!=='object'||typeof WebAssembly.instantiate!=='function'){
      throw new Error('nowasm');
    }
    var py=await ensurePy();
    var buf=[];
    py.setStdout({batched:function(s){buf.push(s);}});
    py.setStderr({batched:function(s){buf.push(s);}});
    var code=fullSource()+'\n'+scr.value;
    if(/\bnumpy\b|\bpandas\b/.test(code)){
      say('loading packages…');
      try{ await py.loadPackagesFromImports(code); }catch(e){}
    }
    say('running…');
    var r=py.runPython(code);
    if(r!==undefined&&r!==null)buf.push(String(r));
    say(buf.join('\n').trim()||'(no output)');
  }catch(e){
    PYDEAD=true;
    try{ await serverRun(); }
    catch(e2){ await traceRun(); }
    PYBUSY=false;
    return;
  }
  PYBUSY=false;
}
document.getElementById('crun').addEventListener('click',runCell);

async function tipCell(){
  say('thinking…','tip');
  try{
    var d=await ask({
        model:MODEL,
        max_tokens:1000,        // five short lines by design
        fallbacks:'default',
        messages:[{role:'user',content:
          'You review Python for a phone editor where short functions matter.\n'
         +'Reply in at most 5 short lines, no markdown, no preamble.\n'
         +'Line 1: a summary of the function under 60 chars, starting with a '
         +'lowercase verb. If you need the word "and", say so — it means the '
         +'function does two things.\n'
         +'Then at most 4 terse notes: bugs, edge cases, or a shorter way to '
         +'write it. Skip anything obvious.\n\n'
         +'FILE:\n'+fullSource().slice(0,6000)
         +'\n\nFUNCTION UNDER REVIEW: '+(CELL?CELL.name:'')
         +'\n\nSCRATCH:\n'+scr.value.slice(0,1000)}]
    });
    var txt=(d.content||[]).map(function(x){return x.text||'';}).join('').trim();
    say(txt||'no response','tip');
  }catch(e){
    // the real reason, not a shrug — 401 and 429 need different answers
    say('tips: '+(e.message||e),'err');
  }
}
document.getElementById('ctip').addEventListener('click',tipCell);

function chatPayload(){
  return 'run this and give me the output:\n\n```python\n'
    +fullSource()+'\n'+scr.value+'\n```';
}
function copyText(t){
  var ta=document.createElement('textarea');
  ta.value=t;
  ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta);
  ta.select();
  var ok=false;
  try{ ok=document.execCommand('copy'); }catch(e){}
  document.body.removeChild(ta);
  return ok;
}
document.getElementById('cchat').addEventListener('click',function(){
  var ok=copyText(chatPayload());
  say(ok
    ? 'copied — close this and paste into the chat.\nClaude runs it for real and pastes the output back.'
    : 'copy failed — select the source above manually','tip');
});

scr.addEventListener('focus',function(){T=scr;});
ed.addEventListener('focus',function(){if(cell.style.display!=='block')T=null;});
document.getElementById('back').addEventListener('click',goBack);

document.getElementById('out').addEventListener('click',function(){panel('out');});
document.getElementById('tree').addEventListener('click',function(){panel('tree');});
draw();

paint();

var app=document.getElementById('app');
var vv=window.visualViewport;

function unzoom(){
  if(!vv)return;
  var s=vv.scale||1;
  if(s>1.005){
    app.style.transform='scale('+(1/s)+')';
    app.style.width=(100*s)+'%';
    app.style.height=(vv.height*s)+'px';
  }else{
    app.style.transform='';
    app.style.width='';
    app.style.height='';
  }
}
if(vv){
  vv.addEventListener('resize',unzoom);
  vv.addEventListener('scroll',unzoom);
}
window.addEventListener('resize',unzoom);
unzoom();
