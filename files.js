var NOTES={
'file:strategies/vwap.py':'reclaim + fade variants',
'file:engine/backtest.py':'event loop, slippage model',
'file:engine/stats.py':'bootstrap p-values, sharpe'
};
var gfx=document.getElementById('gfx');

function editNote(key,host,after){
  host.innerHTML='';
  var i=document.createElement('input');
  i.value=NOTES[key]||'';
  i.placeholder='one line — what and why';
  host.appendChild(i);
  i.focus();
  var done=function(){
    var v=i.value.trim();
    if(v)NOTES[key]=v; else delete NOTES[key];
    after();
  };
  i.addEventListener('blur',done);
  i.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();i.blur();}});
}

function panel(mode){
  if(list.style.display==='block'){list.style.display='none';return;}
  gfx.style.display='none';
  var redraw=function(){list.style.display='none';panel(mode);};
  list.innerHTML='';
  var add=function(txt,key,fn,cls,ind){
    var d=document.createElement('div');
    d.className='row2'+(cls?' '+cls:'');
    if(ind)d.style.paddingLeft=(10+ind*8)+'px';
    var t=document.createElement('span');
    t.textContent=txt;
    if(fn)t.addEventListener('click',function(){list.style.display='none';fn();});
    d.appendChild(t);
    if(key){
      var pen=document.createElement('span');
      pen.className='pen'; pen.textContent='✎';
      pen.addEventListener('click',function(e){
        e.stopPropagation();
        editNote(key,n,redraw);
      });
      d.appendChild(pen);
    }
    list.appendChild(d);
    var n=document.createElement('div');
    n.className='note';
    n.textContent=NOTES[key]||(key?'—':'');
    if(key)list.appendChild(n);
    return d;
  };
  var hdr=function(t){
    var d=document.createElement('div');
    d.className='hdr'; d.textContent=t; list.appendChild(d);};

  if(mode==='tree'){
    hdr('files');
    Object.keys(FILES).sort().forEach(function(k){
      var row=add(k,'file:'+k,function(){openFile(k);},k===cur?'cur':'');
      var x=document.createElement('span');
      x.className='del'; x.textContent='×';
      x.addEventListener('click',function(e){
        e.stopPropagation();
        var dc=document.createElement('div');
        dc.className='dc';
        var t=document.createElement('span');
        t.textContent='delete '+k.split('/').pop()+'?';
        t.style.flex='1';
        var y=document.createElement('button'); y.className='y'; y.textContent='Delete';
        var n2=document.createElement('button'); n2.textContent='Keep';
        y.addEventListener('click',function(){
          delete FILES[k]; delete NOTES['file:'+k];
          if(cur===k){
            var ks2=Object.keys(FILES);
            cur=ks2.length?ks2[0]:'';
            stack=[]; ed.value=cur?FILES[cur]:''; draw();
          }
          try{queue();}catch(e){}
          redraw();
        });
        n2.addEventListener('click',redraw);
        dc.appendChild(t); dc.appendChild(y); dc.appendChild(n2);
        var nx=row.nextSibling;
        if(nx&&nx.nextSibling)row.parentNode.insertBefore(dc,nx.nextSibling);
        else row.parentNode.appendChild(dc);
      });
      var pen=null;
      for(var ci=0;ci<row.children.length;ci++){
        if(row.children[ci].className==='pen'){pen=row.children[ci];break;}
      }
      if(pen)row.insertBefore(x,pen); else row.appendChild(x);
    });
    var ad=document.createElement('div');
    ad.className='add'; ad.textContent='+ new file';
    ad.addEventListener('click',function(){
      ad.innerHTML='';
      var i=document.createElement('input');
      i.placeholder='engine/fills.py';
      i.setAttribute('autocapitalize','off'); i.setAttribute('autocorrect','off');
      ad.appendChild(i); i.focus();
      var go=function(){
        var nm=i.value.trim();
        if(!nm){redraw();return;}
        if(!/\.py$/.test(nm))nm+='.py';
        nm=nm.replace(/^\/+/,'');
        if(!FILES[nm])FILES[nm]='';
        openFile(nm);
        list.style.display='none';
      };
      i.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();go();}});
      i.addEventListener('blur',function(){setTimeout(function(){if(document.activeElement!==i)go();},100);});
    });
    list.appendChild(ad);
    var ca=document.createElement('div');
    ca.className='add'; ca.style.color='var(--warn)';
    ca.textContent='⌫ delete all files';
    ca.addEventListener('click',function(){
      ca.innerHTML='';
      var t2=document.createElement('span');
      t2.textContent='erase everything?'; t2.style.flex='1';
      var y2=document.createElement('button'); y2.className='y'; y2.textContent='Erase all';
      var n3=document.createElement('button'); n3.textContent='Cancel';
      ca.className='dc';
      y2.addEventListener('click',function(){
        FILES={}; NOTES={}; cur=''; stack=[]; hist=[]; ed.value='';
        try{queue();}catch(e){}
        draw(); redraw();
      });
      n3.addEventListener('click',redraw);
      ca.appendChild(t2); ca.appendChild(y2); ca.appendChild(n3);
    });
    list.appendChild(ca);
  }else{
    popTo(0);
    hdr(cur);
    blocks(ed.value).forEach(function(b){
      add(b.k+' '+b.n+'  ·  '+(b.e-b.s+1)+' ln',
        'blk:'+cur+':'+b.n,
        function(){push(b);},'',b.ind/4);
    });
  }
  list.style.display='block';
}

function modName(f){return f.replace(/\.py$/,'').replace(/\//g,'.');}

function edges(){
  var syms={},out=[];
  Object.keys(FILES).forEach(function(f){
    syms[f]=blocks(FILES[f]).filter(function(b){return b.ind===0;})
                            .map(function(b){return b.n;});
  });
  Object.keys(FILES).forEach(function(f){
    var src=FILES[f];
    Object.keys(FILES).forEach(function(g){
      if(g===f)return;
      var w=0;
      if(src.indexOf(modName(g))>=0)w+=1;
      syms[g].forEach(function(s){
        var m=src.match(new RegExp('\\b'+s+'\\b','g'));
        if(m)w+=m.length;
      });
      if(w>0)out.push({a:f,b:g,w:w});
    });
  });
  return out;
}

function drawGraph(){
  if(gfx.style.display==='block'){gfx.style.display='none';return;}
  list.style.display='none';
  var fs=Object.keys(FILES),es=edges();
  var W=320,H=320,cx=160,cy=150,r=98,n=fs.length;
  var pt={};
  fs.forEach(function(f,i){
    var a=-Math.PI/2+i*2*Math.PI/n;
    pt[f]={x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)};
  });
  var s='<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg">';
  s+='<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" '
   +'markerWidth="5" markerHeight="5" orient="auto-start-reverse">'
   +'<path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>';
  s+='<g stroke="var(--kw)" color="var(--kw)" fill="none" opacity="0.75">';
  es.forEach(function(e){
    var A=pt[e.a],B=pt[e.b];
    var dx=B.x-A.x,dy=B.y-A.y,L=Math.hypot(dx,dy);
    var ux=dx/L,uy=dy/L,pad=26;
    var x1=A.x+ux*pad,y1=A.y+uy*pad,x2=B.x-ux*pad,y2=B.y-uy*pad;
    var mx=(x1+x2)/2-dy*0.12,my=(y1+y2)/2+dx*0.12;
    s+='<path d="M'+x1.toFixed(1)+','+y1.toFixed(1)
      +' Q'+mx.toFixed(1)+','+my.toFixed(1)+' '+x2.toFixed(1)+','+y2.toFixed(1)+'" '
      +'stroke-width="'+Math.min(4,0.8+e.w*0.5).toFixed(1)+'" marker-end="url(#ar)"/>';
  });
  s+='</g>';
  fs.forEach(function(f){
    var P=pt[f],lab=f.split('/').pop();
    s+='<circle data-f="'+f+'" cx="'+P.x.toFixed(1)+'" cy="'+P.y.toFixed(1)+'" r="24" '
     +'fill="'+(f===cur?'var(--kw)':'var(--key)')+'" stroke="var(--bd)"/>';
    s+='<text x="'+P.x.toFixed(1)+'" y="'+(P.y+42).toFixed(1)+'" text-anchor="middle" '
     +'font-size="11" font-family="ui-monospace,Menlo,monospace" '
     +'fill="var(--fg)">'+lab+'</text>';
    var note=NOTES['file:'+f]||'';
    if(note)s+='<text x="'+P.x.toFixed(1)+'" y="'+(P.y+54).toFixed(1)+'" text-anchor="middle" '
     +'font-size="8.5" font-style="italic" fill="var(--mut)">'
     +note.slice(0,26).replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</text>';
  });
  s+='</svg>';
  gfx.innerHTML=s;
  gfx.querySelectorAll('circle[data-f]').forEach(function(c){
    c.style.cursor='pointer';
    c.addEventListener('click',function(){
      gfx.style.display='none';
      openFile(c.getAttribute('data-f'));
    });
  });
  gfx.style.display='block';
}
document.getElementById('gr').addEventListener('click',drawGraph);
