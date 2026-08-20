// sync.js — the user's Python files live in a GitHub repo; the phone is only a
// cache in front of it. store.js still writes every keystroke to localStorage,
// so nothing is lost offline or without a token; this pushes the result up when
// the network and a token are both there, and pulls on load so the work follows
// you to another device. Each .py file is a real file in the repo, so it can be
// read, edited, or cloned from github.com without this app.

var GK='pyed:gh:v1';
var GH={token:'',owner:'',repo:'',branch:'main'};
var GSHA={};    // path -> blob sha of the version we last saw on the remote
var GBASE={};   // path -> hash of the content we last saw on the remote
var GDIRTY=false;
var gtimer=null, gbusy=false, gstat='off', gerr='';
// A rejected token will be rejected again. Stop pushing until it changes,
// rather than waking the radio every few seconds to be told no.
var GHALT=false;

// FNV-1a. Only ever compared against itself, so any cheap hash will do — the
// point is to spot a changed file without keeping a second copy of every file
// in localStorage next to the one store.js already writes.
function ghash(s){
  var h=0x811c9dc5;
  for(var i=0;i<s.length;i++){
    h^=s.charCodeAt(i);
    h=(h+((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)))>>>0;
  }
  return h.toString(16);
}

// btoa/atob are byte-wise; Python files carry non-ASCII often enough that
// going through UTF-8 explicitly is not optional.
function b64enc(s){
  var b=new TextEncoder().encode(s),o='';
  for(var i=0;i<b.length;i++)o+=String.fromCharCode(b[i]);
  return btoa(o);
}
function b64dec(s){
  var raw=atob(String(s).replace(/\s/g,'')),b=new Uint8Array(raw.length);
  for(var i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);
  return new TextDecoder().decode(b);
}

function ghOn(){return !!(GH.token&&GH.owner&&GH.repo);}
function ghSlug(){return GH.owner+'/'+GH.repo;}
function ghPath(p){return p.split('/').map(encodeURIComponent).join('/');}

function ghCfgLoad(){
  try{
    var raw=window.localStorage.getItem(GK);
    if(!raw)return;
    var o=JSON.parse(raw)||{};
    GH.token=o.token||''; GH.owner=o.owner||''; GH.repo=o.repo||'';
    GH.branch=o.branch||'main';
    GSHA=o.sha||{}; GBASE=o.base||{}; GDIRTY=!!o.dirty;
  }catch(e){}
}
function ghCfgSave(){
  try{
    window.localStorage.setItem(GK,JSON.stringify({
      token:GH.token,owner:GH.owner,repo:GH.repo,branch:GH.branch,
      sha:GSHA,base:GBASE,dirty:GDIRTY}));
  }catch(e){}
}

function ghNote(){
  if(!ghOn())return 'not connected';
  if(gstat==='err')return 'error — '+gerr;
  if(gstat==='pull')return 'pulling…';
  if(gstat==='push')return 'pushing…';
  if(GDIRTY)return 'unpushed changes';
  return 'synced · '+ghSlug();
}
function ghStat(s,msg){
  gstat=s;
  gerr=(s==='err')?(msg||'sync failed'):'';
  var el=document.getElementById('ghs');
  if(el)el.textContent=ghNote();
  if(s==='err'){
    // the lint bar owns #warn; only borrow it for a real failure, and only
    // while it is empty, so an error squiggle is never hidden by a sync note.
    var w=document.getElementById('warn');
    if(w&&!w.textContent){w.className='';w.textContent='⇅ '+gerr;}
  }
}

function ghApi(path,opts){
  opts=opts||{};
  var h={'Accept':'application/vnd.github+json',
         'X-GitHub-Api-Version':'2022-11-28',
         'Authorization':'Bearer '+GH.token};
  if(opts.body)h['Content-Type']='application/json';
  return fetch('https://api.github.com'+path,{
    method:opts.method||'GET',
    headers:h,
    cache:'no-store',
    body:opts.body?JSON.stringify(opts.body):undefined
  }).then(function(r){
    if(r.status===204)return null;
    return r.json().then(function(j){return j;},function(){return null;})
      .then(function(j){
        if(!r.ok){
          var e=new Error((j&&j.message)||('github '+r.status));
          e.status=r.status;
          if(r.status===401)GHALT=true;   // no point asking again
          throw e;
        }
        return j;
      });
  });
}

// ---- pull -----------------------------------------------------------------

// One tree call lists the whole repo, one blob call per file fetches it —
// cheaper than walking /contents directory by directory, and it hands back the
// blob shas we need in order to update those same files later.
function ghPull(){
  if(!ghOn()||gbusy)return Promise.resolve(false);
  gbusy=true; ghStat('pull');
  return ghApi('/repos/'+ghSlug()+'/git/trees/'
               +encodeURIComponent(GH.branch)+'?recursive=1')
    .catch(function(e){
      if(e.status===409)return {tree:[]};   // repo exists but has no commits
      throw e;
    })
    .then(function(t){
      if(t.truncated)ghStat('err','repo too large to list in one call');
      var want=(t.tree||[]).filter(function(n){
        return n.type==='blob'&&(/\.py$/.test(n.path)||n.path==='notes.json');
      });
      return Promise.all(want.map(function(n){
        return ghApi('/repos/'+ghSlug()+'/git/blobs/'+n.sha).then(function(b){
          return {path:n.path,sha:n.sha,text:b64dec(b.content||'')};
        });
      }));
    })
    .then(function(got){
      if(!got.length){gbusy=false;ghStat('ok');return false;}
      var files={},notes=null,want=null;
      GSHA={}; GBASE={};
      got.forEach(function(f){
        GSHA[f.path]=f.sha;
        GBASE[f.path]=ghash(f.text);
        if(f.path==='notes.json'){
          try{
            var o=JSON.parse(f.text)||{};
            notes=o.notes||{};
            want=o.cur||null;
          }catch(e){}
        }else files[f.path]=f.text;
      });
      FILES=files;
      if(notes)NOTES=notes;
      var ks=Object.keys(FILES).sort();
      cur=(want&&FILES.hasOwnProperty(want))?want:(ks.length?ks[0]:'');
      stack=[]; hist=[]; ed.value=cur?FILES[cur]:'';
      draw();
      GDIRTY=false; ghCfgSave();
      gbusy=false; ghStat('ok');
      try{persist();}catch(e){}   // mirror what we pulled into the local cache
      return true;
    })
    .catch(function(e){
      gbusy=false; ghStat('err',e.message||'pull failed');
      return false;
    });
}

// ---- push -----------------------------------------------------------------

function ghPlan(){
  var jobs=[],p;
  for(p in FILES){
    if(!FILES.hasOwnProperty(p))continue;
    if(GBASE[p]!==ghash(FILES[p]))
      jobs.push({path:p,text:FILES[p],msg:(GSHA[p]?'edit ':'add ')+p});
  }
  var nj=JSON.stringify({notes:NOTES,cur:cur},null,2)+'\n';
  if(GBASE['notes.json']!==ghash(nj))
    jobs.push({path:'notes.json',text:nj,msg:'notes'});
  for(p in GSHA){
    if(!GSHA.hasOwnProperty(p)||p==='notes.json')continue;
    if(!FILES.hasOwnProperty(p))jobs.push({path:p,del:true,msg:'delete '+p});
  }
  return jobs;
}

function ghPut(job,retry){
  var url='/repos/'+ghSlug()+'/contents/'+ghPath(job.path);
  var body={message:job.msg,branch:GH.branch};
  if(GSHA[job.path])body.sha=GSHA[job.path];
  if(job.del){
    return ghApi(url,{method:'DELETE',body:body}).then(function(){
      delete GSHA[job.path]; delete GBASE[job.path];
    });
  }
  body.content=b64enc(job.text);
  return ghApi(url,{method:'PUT',body:body}).then(function(r){
    if(r&&r.content)GSHA[job.path]=r.content.sha;
    GBASE[job.path]=ghash(job.text);
  },function(e){
    // 409/422 means our sha is stale — the file changed on github.com or on
    // another device. Take the remote sha and write once more: the local
    // buffer is what the user is looking at, so it wins.
    if(retry||(e.status!==409&&e.status!==422))throw e;
    return ghApi(url+'?ref='+encodeURIComponent(GH.branch)).then(function(m){
      GSHA[job.path]=m&&m.sha;
      return ghPut(job,true);
    },function(){
      delete GSHA[job.path];
      return ghPut(job,true);
    });
  });
}

function ghPush(){
  if(!ghOn())return Promise.resolve(false);
  // a push that arrives mid-push must come back rather than be dropped, or
  // the last keystrokes of a burst never leave the phone
  if(gbusy){ghQueue();return Promise.resolve(false);}
  if(cur&&!stack.length)FILES[cur]=ed.value;
  var jobs=ghPlan();
  if(!jobs.length){
    GDIRTY=false; ghCfgSave(); ghStat('ok');
    return Promise.resolve(true);
  }
  gbusy=true; ghStat('push');
  // one at a time — concurrent writes to a branch race on its head
  return jobs.reduce(function(chain,job){
    return chain.then(function(){return ghPut(job);});
  },Promise.resolve()).then(function(){
    GDIRTY=false; ghCfgSave();
    gbusy=false; ghStat('ok');
    return true;
  },function(e){
    GDIRTY=true; ghCfgSave();
    gbusy=false; ghStat('err',e.message||'push failed');
    return false;
  });
}

// store.js calls this after each debounced local save. Push on a longer fuse
// than the 700 ms local write, so a burst of typing is one commit, not thirty.
function ghQueue(){
  if(!ghOn()||GHALT)return;
  GDIRTY=true;
  try{clearTimeout(gtimer);}catch(e){}
  gtimer=setTimeout(function(){ghPush();},4000);
}

// ---- panel ----------------------------------------------------------------

// Rendered at the top of the 🗂 file list by files.js — this is a question
// about where the files are, so it belongs next to them rather than behind
// another header button on an already full row.
function ghPanel(host,redraw){
  var hdr=document.createElement('div');
  hdr.className='hdr'; hdr.textContent='github';
  host.appendChild(hdr);

  var row=document.createElement('div');
  row.className='row2';
  var t=document.createElement('span');
  t.textContent=ghOn()?('⇅ '+ghSlug()):'⇅ connect a repo';
  t.style.flex='1';
  row.appendChild(t);
  host.appendChild(row);

  var note=document.createElement('div');
  note.className='note'; note.id='ghs';
  note.textContent=ghNote();
  host.appendChild(note);

  var form=document.createElement('div');
  form.style.display='none';
  form.style.padding='0';        // it is a container, not one of #list's rows
  form.style.border='0';
  host.appendChild(form);

  var field=function(label,val,ph,pw){
    var d=document.createElement('div');
    d.style.padding='6px 10px'; d.style.borderBottom='0';
    var l=document.createElement('div');
    l.className='note'; l.style.padding='0 0 3px'; l.style.border='0';
    l.textContent=label;
    var i=document.createElement('input');
    i.value=val||''; i.placeholder=ph||'';
    i.setAttribute('autocapitalize','off');
    i.setAttribute('autocorrect','off');
    i.setAttribute('spellcheck','false');
    if(pw)i.type='password';
    d.appendChild(l); d.appendChild(i);
    form.appendChild(d);
    return i;
  };
  var fo=field('owner',GH.owner,'khewes19');
  var fr=field('repo',GH.repo,'notebook-files');
  var fb=field('branch',GH.branch,'main');
  var ft=field('fine-grained token · contents read and write',GH.token,
               'github_pat_…',true);

  // A hidden field you cannot check is no good when the token is ninety
  // characters of noise and the failure is a flat "bad credentials". The
  // counter updates as you type, so a short paste is obvious before you save.
  var tinfo=document.createElement('div');
  tinfo.className='note';
  var tcount=function(){
    var v=ft.value.trim();
    tinfo.textContent=v
      ? v.length+' characters'+(v.length>=60?'':' — that is too short')
      : 'paste it; it is not typeable';
  };
  ft.addEventListener('input',tcount);
  tcount();
  var eye=document.createElement('span');
  eye.className='pen';
  eye.textContent='show';
  eye.addEventListener('click',function(){
    var hid=ft.type==='password';
    ft.type=hid?'text':'password';
    eye.textContent=hid?'hide':'show';
  });
  tinfo.appendChild(eye);
  form.appendChild(tinfo);

  var caution=document.createElement('div');
  caution.className='note';
  caution.textContent='the token is kept in this phone’s localStorage. scope it '
    +'to this one repo, and revoke it if you lose the phone.';
  form.appendChild(caution);

  var bar=document.createElement('div');
  bar.className='dc';
  form.appendChild(bar);
  var btn=function(txt,cls,fn){
    var b=document.createElement('button');
    b.textContent=txt;
    if(cls)b.className=cls;
    b.addEventListener('click',fn);
    bar.appendChild(b);
  };

  btn('Save','y',function(){
    GH.owner=fo.value.trim(); GH.repo=fr.value.trim();
    GH.branch=fb.value.trim()||'main'; GH.token=ft.value.trim();
    GSHA={}; GBASE={}; GDIRTY=true;   // a different repo shares no history
    GHALT=false;                      // a new token deserves a fresh try
    ghCfgSave();
    if(!ghOn()){ghStat('off');redraw();return;}

    // A token typed by hand on a phone is almost never right — a fine-grained
    // one is about ninety characters. Say so before spending a round trip.
    if(!/^(github_pat_|ghp_|gho_|ghs_)/.test(GH.token)){
      ghStat('err','that does not look like a token — it should begin '
        +'github_pat_ (fine-grained) or ghp_ (classic)');
      redraw(); return;
    }
    if(/^github_pat_/.test(GH.token)&&GH.token.length<60){
      ghStat('err','token looks cut short at '+GH.token.length
        +' characters — copy and paste it rather than typing it');
      redraw(); return;
    }

    ghStat('pull');
    // Ask who we are before asking about the repo. Otherwise a bad token and a
    // missing repo both arrive as one unhelpful 404, and they need opposite
    // fixes. /user answers for any valid token, whatever repos it can reach.
    var who='';
    ghApi('/user').then(function(u){
      who=(u&&u.login)||'?';
    },function(e){
      // only a 401 is conclusive. a fine-grained token scoped to one repo may
      // legitimately be refused elsewhere, so anything else carries on and
      // lets the repo check give the real answer.
      if(e.status===401)
        throw new Error('github rejected the token — paste it whole; ninety '
          +'characters cannot be retyped');
      who='?';
    }).then(function(){
      return ghApi('/repos/'+ghSlug()).catch(function(e){
        if(e.status===404)
          throw new Error('signed in as '+who+', but '+ghSlug()+' is not '
            +'visible — create the repo, or add it to the token’s selected '
            +'repositories');
        if(e.status===403)
          throw new Error('signed in as '+who+' — the token needs Contents: '
            +'read and write on '+ghSlug());
        throw e;
      });
    }).then(function(){
      return ghApi('/repos/'+ghSlug()+'/git/trees/'
                   +encodeURIComponent(GH.branch)+'?recursive=1')
        .catch(function(e){if(e.status===409)return {tree:[]};throw e;});
    }).then(function(t){
      // an empty repo gets seeded from the phone; a repo that already holds
      // files is the record, and the phone takes what is there.
      var has=(t.tree||[]).some(function(n){
        return n.type==='blob'&&/\.py$/.test(n.path);
      });
      return has?ghPull():ghPush();
    }).then(function(){redraw();},function(e){
      // the steps above already say which of the four things went wrong;
      // anything reaching here is a surprise and is reported verbatim.
      ghStat('err',e.message||'connect failed');
      redraw();
    });
  });
  btn('Pull',null,function(){ghPull().then(redraw);});
  btn('Push',null,function(){ghPush().then(redraw);});
  btn('Forget',null,function(){
    GH.token=''; GSHA={}; GBASE={}; GDIRTY=false;
    ghCfgSave(); ghStat('off'); redraw();
  });

  // an error with the form shut leaves nowhere to fix it
  var open=!ghOn()||gstat==='err';
  form.style.display=open?'block':'none';
  t.addEventListener('click',function(){
    open=!open;
    form.style.display=open?'block':'none';
  });
}

// ---- boot -----------------------------------------------------------------

// Nothing may touch the network until store.js has restored the local cache —
// otherwise the first push would upload the demo buffer over real work, and a
// late-landing restore would overwrite whatever the pull just brought down.
// store.js sets window.RESTORED and calls back if we are already loaded; the
// poll covers the other order, and gives up in case there is no local store.
var gbooted=false;
function ghBoot(){
  if(gbooted||!ghOn())return;
  gbooted=true;
  // work the phone made while offline outranks the remote, so flush it first
  (GDIRTY?ghPush():Promise.resolve(true)).then(function(){
    if(!GDIRTY)ghPull();
  });
}

ghCfgLoad();
(function(){
  var tries=0;
  (function wait(){
    if(window.RESTORED||++tries>30){ghBoot();return;}
    setTimeout(wait,50);
  })();
})();
