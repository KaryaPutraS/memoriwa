import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, Check, ChevronRight, FileText, Folder, Home, Menu, QrCode, Search, Settings, Sparkles, Trash2, Zap, Image, FileIcon, RotateCw, Play, Square, LogOut, Share2, Plus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { login, logout, getToken, setToken, getDocuments, startWaha, stopWaha, logoutWaha, getWahaStatus, getWahaQr, getWahaHealth, getProviders, createProvider, deleteProvider, updateProvider, getSettings, saveSettings, analyzeDocument, deleteDocument } from './api';
import './styles.css';

type Doc = { id:string; filename:string; sender:string; mime_type:string; status:string; metadata?:any; file_url?:string; url?:string; created_at?:string };
type Prov = { name:string; kind:string; model:string; api_key:string; base_url?:string; active?:boolean };
const SC: Record<string,string> = { unanalyzed:'#999', processing:'#f59e0b', analyzed:'#00d4aa', failed:'#f2504b' };
const API_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || '';

// Fetch a protected file with the Bearer token and expose it as a local blob
// URL — keeps JWTs out of URLs, access logs and browser history.
function useAuthFileUrl(id: string, enabled: boolean): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!enabled) { setUrl(''); return; }
    let obj = '', dead = false;
    fetch(API_URL + '/api/files/' + id + '/raw', { headers: { Authorization: 'Bearer ' + (getToken() || '') } })
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.blob(); })
      .then(b => { if (!dead) { obj = URL.createObjectURL(b); setUrl(obj); } })
      .catch(() => {});
    return () => { dead = true; if (obj) URL.revokeObjectURL(obj); };
  }, [id, enabled]);
  return url;
}

function App() {
  const PAGES=['Inbox','Files','Stats','Settings'];
  const pageFromHash=()=>{const h=window.location.hash.slice(1);return PAGES.includes(h)?h:'Inbox'};
  const [page, setPage] = useState(pageFromHash);
  useEffect(()=>{
    const f=()=>setPage(pageFromHash());
    window.addEventListener('hashchange',f);
    return ()=>window.removeEventListener('hashchange',f);
  },[]);
  const [sidebar, setSidebar] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [token, setTok] = useState(getToken()||'');
  const [toast, setToast] = useState('');
  const [provs, setProvs] = useState<Prov[]>([]);
  const [settings, setSettings] = useState<any>({});
  const [wahaOk, setWahaOk] = useState(false);

  const flash = (s:string) => { setToast(s); setTimeout(()=>setToast(''),2200); };

  useEffect(()=>{ if(!token)return;
    getDocuments().then(d=>setDocs(d.items||[])).catch(()=>{});
    getSettings().then(s=>setSettings(s)).catch(()=>{});
    getWahaStatus().then(s=>setWahaOk(s.connected)).catch(()=>{});
    getProviders().then(p=>setProvs(p.items||[])).catch(()=>{});
  },[token]);

  const refreshDocs = ()=>getDocuments().then(d=>setDocs(d.items||[]));
  const analyze = async (id:string)=>{ flash('Analyzing...'); await analyzeDocument(id).catch(()=>{}); refreshDocs(); flash('Done!'); };
  const deleteDoc = async (id:string)=>{ await deleteDocument(id).catch(()=>{}); setDocs(ds=>ds.filter(d=>d.id!==id)); flash('Deleted'); };
  const doLogout = ()=>{ logout(); setTok(''); };

  // Branding: apply custom favicon saved in Settings
  useEffect(()=>{
    if(!settings?.favicon_data)return;
    let l=document.querySelector("link[rel~='icon']") as HTMLLinkElement|null;
    if(!l){l=document.createElement('link');l.rel='icon';document.head.appendChild(l)}
    l.href=settings.favicon_data;
  },[settings?.favicon_data]);

  // Live updates: new WhatsApp files, analysis progress, WA connection state
  useEffect(()=>{
    if(!token)return;
    let ws:WebSocket|null=null, closed=false, retry:ReturnType<typeof setTimeout>|null=null;
    const connect=()=>{
      const proto=location.protocol==='https:'?'wss':'ws';
      ws=new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
      ws.onmessage=(ev)=>{try{
        const m=JSON.parse(ev.data);
        if(m.type==='document.created')setDocs(ds=>[m.data,...ds.filter(d=>d.id!==m.data.id)]);
        if(m.type==='document.updated')setDocs(ds=>ds.map(d=>d.id===m.data.id?{...d,...m.data}:d));
        if(m.type==='waha.status')setWahaOk(m.status==='WORKING');
      }catch{}};
      ws.onclose=()=>{if(!closed)retry=setTimeout(connect,3000)};
    };
    connect();
    return ()=>{closed=true;if(retry)clearTimeout(retry);ws?.close()};
  },[token]);

  if(!token) return <LoginScreen onLogin={t=>{setToken(t);setTok(t)}}/>;

  const nav = [
    {id:'Inbox',label:'Inbox',icon:Home},
    {id:'Files',label:'Files',icon:Folder},
    {id:'Stats',label:'Stats',icon:BarChart3},
    {id:'Settings',label:'Settings',icon:Settings},
  ];

  return (
    <div className={`shell ${sidebar?'open':''}`}>
      {sidebar&&<div className="overlay" onClick={()=>setSidebar(false)}/>}
      <aside className="sidebar">
        <div className="sb-br">{settings?.logo_data?<img src={settings.logo_data} alt="logo" style={{width:36,height:36,borderRadius:10,objectFit:'cover'}}/>:<div className="sb-lo"><Zap size={20}/></div>}<span>MemoriWA</span></div>
        <nav className="sb-nav">
          {nav.map(n=><button key={n.id} className={`sb-it ${page===n.id?'on':''}`} onClick={()=>{window.location.hash=n.id;setPage(n.id);setSidebar(false)}}><n.icon size={18}/><span>{n.label}</span></button>)}
        </nav>
        <div className="sb-ft"><div className={`dot ${wahaOk?'on':'off'}`}/><span>{wahaOk?'Connected':'Offline'}</span><button className="bi" style={{marginLeft:'auto',color:'#a0a0b8'}} title="Logout" onClick={doLogout}><LogOut size={15}/></button></div>
      </aside>
      <div className="mc">
        <header className="tb-top"><button className="mu" onClick={()=>setSidebar(!sidebar)}><Menu size={20}/></button><b>MemoriWA</b><div className={`dot ${wahaOk?'on':'off'}`} style={{marginLeft:'auto'}}/></header>
        {page==='Inbox' && <InboxPage docs={docs} refreshDocs={refreshDocs} analyze={analyze} del={deleteDoc}/>}
        {page==='Files' && <FilesPage docs={docs} analyze={analyze}/>}
        {page==='Stats' && <StatsPage docs={docs}/>}
        {page==='Settings' && <SettingsPage settings={settings} provs={provs}
          onSave={async(s:any)=>{try{setSettings(await saveSettings(s));flash('Saved')}catch{flash('Save failed')}}}
          onAdd={async(p:Prov)=>{await createProvider(p);setProvs((await getProviders()).items||[]);flash('Added')}}
          onDel={async(n:string)=>{await deleteProvider(n);setProvs((await getProviders()).items||[])}}
          onToggle={async(p:Prov)=>{await updateProvider(p.name,{name:p.name,kind:p.kind,model:p.model,api_key:'',base_url:p.base_url||'',active:!p.active});setProvs((await getProviders()).items||[]);flash(p.active?'Deactivated':'Activated')}}/>}
      </div>
      {toast&&<div className="toast"><Check size={16}/>{toast}</div>}
    </div>
  );
}

function LoginScreen({onLogin}:{onLogin:(t:string)=>void}) {
  const [u,su]=useState('admin'),[p,sp]=useState(''),[e,se]=useState(''),[b,sb]=useState(false);
  const go=async()=>{sb(true);se('');try{const t=await login(u,p);setToken(t);onLogin(t)}catch{se('Wrong credentials')}sb(false)};
  return <div className="lg-wrap"><div className="lg-card"><div className="lg-ic"><Zap size={32}/></div><h1>MemoriWA</h1><p>WhatsApp Document Intelligence</p>
    <input className="inp" placeholder="Username" value={u} onChange={e=>su(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} autoFocus/>
    <input className="inp" type="password" placeholder="Password" value={p} onChange={e=>sp(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()}/>
    {e&&<div className="er">{e}</div>}
    <button className="btn pr fu" onClick={go} disabled={b}>{b?<RotateCw size={16} className="sp-anim"/>:'Sign In'}</button>
  </div></div>;
}

function InboxPage({docs,refreshDocs,analyze,del}:{docs:Doc[];refreshDocs:()=>void;analyze:(id:string)=>void;del:(id:string)=>void}) {
  const [q,sq]=useState(''),[f,sf]=useState('All'),[sel,ssel]=useState<string[]>([]);
  const fd=React.useMemo(()=>{
    // Inbox is the work queue: analyzed files live under Files instead.
    let d=docs.filter(x=>x.status!=='analyzed');
    if(f==='PDF')d=d.filter(x=>x.mime_type==='application/pdf');
    if(f==='IMAGE')d=d.filter(x=>x.mime_type?.startsWith('image/'));
    if(q){const ql=q.toLowerCase();d=d.filter(x=>x.filename?.toLowerCase().includes(ql)||x.sender?.includes(q)||(JSON.stringify(x.metadata?.identity||'')+' '+(x.metadata?.extracted_text||'')).toLowerCase().includes(ql));}
    return d;
  },[docs,q,f]);
  const toggle=(id:string)=>ssel(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  return <div className="pg">
    <div className="mx">
      <M n={docs.length} l="Total" c="#c8f31d"/>
      <M n={docs.filter(d=>d.status==='unanalyzed').length} l="Pending" c="#999"/>
      <M n={docs.filter(d=>d.status==='analyzed').length} l="Done" c="#00d4aa"/>
      <M n={docs.filter(d=>d.status==='failed').length} l="Failed" c="#f2504b"/>
    </div>
    <div className="br">
      <div className="sbx"><Search size={15}/><input placeholder="Search..." value={q} onChange={e=>sq(e.target.value)}/></div>
      <div className="cs">{['All','PDF','IMAGE'].map(x=><button key={x} className={`ch ${f===x?'on':''}`} onClick={()=>sf(x)}>{x}</button>)}</div>
      <button className="btn sm" onClick={refreshDocs}><RotateCw size={13}/></button>
      {sel.length>0&&<button className="btn ac" onClick={()=>{sel.forEach(analyze);ssel([])}}><Sparkles size={13}/> Analyze ({sel.length})</button>}
    </div>
    <div className="cd">
      <div className="cd-hd"><b>Documents ({fd.length})</b></div>
      {fd.length===0?<div className="em"><FileText size={32}/><b>No documents</b><p>Send a file or image to your WhatsApp.</p></div>
      :fd.map(d=><DocRow key={d.id} doc={d} sel={sel} toggle={toggle} analyze={()=>analyze(d.id)} del={()=>del(d.id)}/>)}
    </div>
  </div>;
}

function M({n,l,c}:{n:number;l:string;c:string}) { return <div className="mt"><span className="mt-n" style={{color:c}}>{n}</span><span className="mt-l">{l}</span></div>; }

function DocRow({doc,sel,toggle,analyze,del}:{doc:Doc;sel:string[];toggle:(id:string)=>void;analyze:()=>void;del?:()=>void}) {
  const [o,so]=useState(false);
  const im=doc.mime_type?.startsWith('image/')||/\.(jpg|jpeg|png|webp|gif)$/i.test(doc.filename||'');
  const pd=doc.mime_type==='application/pdf';
  const pv=useAuthFileUrl(doc.id, o);
  const cl=SC[doc.status]||'#999';
  return <div className="dw">
    <div className="dr" onClick={()=>so(!o)}>
      <input type="checkbox" checked={sel.includes(doc.id)} onChange={e=>{e.stopPropagation();toggle(doc.id)}} onClick={e=>e.stopPropagation()}/>
      <div className="di">{im?<Image size={17}/>:pd?<FileIcon size={17}/>:<FileText size={17}/>}</div>
      <div className="dn"><div className="dnm">{doc.metadata?.identity?.title||doc.filename||'Untitled'}</div><div className="dnt">{doc.sender} · {doc.created_at?new Date(doc.created_at).toLocaleDateString():''}{doc.metadata?.identity?.doc_type?' · '+doc.metadata.identity.doc_type:''}</div></div>
      <span className="ds" style={{background:cl+'18',color:cl,borderColor:cl}}>{doc.status}{doc.status==='processing'&&typeof doc.metadata?.progress==='number'?` ${doc.metadata.progress}%`:''}</span>
      <button className="bi" onClick={e=>{e.stopPropagation();analyze()}}><Sparkles size={13}/></button>
      {del&&<button className="bi" onClick={e=>{e.stopPropagation();del()}}><Trash2 size={13}/></button>}
      <ChevronRight size={15} className={`dc ${o?'rt':''}`}/>
    </div>
    {o&&<div className="dp"><div className="dg"><div className="dp-info"><b>{doc.filename}</b>
      <div className="ir"><span>Type:</span>{doc.mime_type||'?'}</div><div className="ir"><span>From:</span>{doc.sender}</div><div className="ir"><span>Size:</span>{doc.metadata?.size?(doc.metadata.size/1024).toFixed(1)+' KB':'?'}</div></div>
      {doc.metadata?.identity&&<div className="dp-info"><div className="ir"><span>Summary:</span>{doc.metadata.identity.summary||'-'}</div><div className="ir"><span>Tags:</span>{(doc.metadata.identity.tags||[]).join(', ')||'-'}</div></div>}
      {!im&&doc.metadata?.extracted_text&&<div className="dp-info"><div className="ir" style={{whiteSpace:'pre-wrap'}}><span>Preview:</span>{doc.metadata.extracted_text.slice(0,400)}{doc.metadata.extracted_text.length>400?'…':''}</div></div>}
      {im&&pv&&<div className="pm"><img src={pv} alt={doc.filename} className="pi" onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/></div>}
      {pd&&<div className="pm pf"><FileIcon size={32}/><b>PDF</b><span>Document</span></div>}
      {!im&&!pd&&<div className="pm pfc"><FileText size={32}/><b>File</b><span>{doc.mime_type}</span></div>}</div>
      <div className="pa"><button className="btn sm" onClick={analyze}><Sparkles size={12}/> Analyze</button><a className="btn sm" href={pv||'#'} target="_blank" rel="noopener" onClick={e=>{if(!pv)e.preventDefault();}}><Share2 size={12}/> Open</a></div></div>
    }</div>;
}

function FilesPage({docs,analyze}:{docs:Doc[];analyze:(id:string)=>void}) {
  const [q,sq]=useState(''),[folder,setFolder]=useState('');
  // Folder name comes from the analysis result: a specific doc_type wins;
  // generic/empty types fall back to the first AI tag before 'Uncategorized'.
  const GENERIC=['','other','unknown','uncategorized','document','dokumen','file','general','lainnya','misc'];
  const folderOf=(d:Doc)=>{
    const t=(d.metadata?.identity?.doc_type||'').trim();
    if(t&&!GENERIC.includes(t.toLowerCase()))return t;
    const tag=(d.metadata?.identity?.tags||[])[0];
    if(tag)return String(tag);
    return 'Uncategorized';
  };
  const ql=q.trim().toLowerCase();
  const match=(d:Doc)=>!ql||(d.filename||'').toLowerCase().includes(ql)||(JSON.stringify(d.metadata?.identity||'')+' '+(d.metadata?.extracted_text||'')).toLowerCase().includes(ql);
  const analyzed=docs.filter(d=>d.status==='analyzed');
  const folders=React.useMemo(()=>{
    const m:Record<string,number>={};
    analyzed.forEach(d=>{const f=folderOf(d);m[f]=(m[f]||0)+1});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  },[docs]);
  const list=(folder?analyzed.filter(d=>folderOf(d)===folder):docs).filter(match);
  return <div className="pg">
    <div className="mx"><M n={analyzed.length} l="Analyzed" c="#00d4aa"/><M n={folders.length} l="Folders" c="#c8f31d"/><M n={docs.filter(d=>d.status==='unanalyzed').length} l="Pending" c="#999"/></div>
    <div className="br">
      <div className="sbx"><Search size={15}/><input placeholder="Search name, content, or identity..." value={q} onChange={e=>sq(e.target.value)}/></div>
      {folder&&<button className="btn sm" onClick={()=>setFolder('')}>Back</button>}
    </div>
    {!folder&&!ql&&<div className="cd"><div className="cd-hd"><b>Folders ({folders.length})</b></div>
      {folders.length===0?<div className="em"><Folder size={32}/><b>No folders yet</b><p>Analyze files in Inbox — folders are created automatically from the detected document type.</p></div>
      :folders.map(([f,n])=><div key={f} className="fr" style={{cursor:'pointer'}} onClick={()=>setFolder(f)}><Folder size={15}/><span className="f1">{f}</span><span className="mu xs">{n} file{n>1?'s':''}</span><ChevronRight size={13}/></div>)}
    </div>}
    {(folder||ql)&&<div className="cd"><div className="cd-hd"><b>{folder||'Search results'} ({list.length})</b></div>
      {list.length===0?<div className="em"><FileText size={32}/><b>No files found</b></div>
      :list.map(d=><DocRow key={d.id} doc={d} sel={[]} toggle={()=>{}} analyze={()=>analyze(d.id)}/>)}
    </div>}
  </div>;
}

function StatsPage({docs}:{docs:Doc[]}) {
  const sd=['unanalyzed','processing','analyzed','failed'].map(s=>({name:s,count:docs.filter(d=>d.status===s).length}));
  const td=['image','pdf','other'].map(t=>({name:t,count:docs.filter(d=>t==='image'?d.mime_type?.startsWith('image/'):t==='pdf'?d.mime_type==='application/pdf':!d.mime_type?.startsWith('image/')&&d.mime_type!=='application/pdf').length}));
  const COLS=['#aaa','#f59e0b','#00d4aa','#f2504b'];
  return <div className="pg"><div className="mx"><M n={docs.length} l="Total" c="#c8f31d"/><M n={docs.filter(d=>d.status==='analyzed').length} l="Done" c="#00d4aa"/><M n={docs.filter(d=>d.mime_type?.startsWith('image/')).length} l="Images" c="#f59e0b"/><M n={docs.filter(d=>d.mime_type==='application/pdf').length} l="PDFs" c="#f2504b"/></div>
    <div className="cs2"><div className="cd"><div className="cd-hd"><b>Status</b></div><ResponsiveContainer width="100%" height={200}><BarChart data={sd}><CartesianGrid stroke="#eee" strokeDasharray="4 4"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="count" stroke="#111" strokeWidth={2} radius={[4,4,0,0]}>{sd.map((_,i)=><Cell key={i} fill={COLS[i]}/>)}</Bar></BarChart></ResponsiveContainer></div>
    <div className="cd"><div className="cd-hd"><b>Types</b></div><ResponsiveContainer width="100%" height={200}><PieChart><Pie data={td} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={65} stroke="#111" strokeWidth={2}>{td.map((_,i)=><Cell key={i} fill={COLS[i+1]||COLS[0]}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer></div></div></div>;
}

function SettingsPage({settings,provs,onSave,onAdd,onDel,onToggle}:any) {
  const [tab,setTab]=useState('connect');
  const [loc,setLoc]=useState(settings||{});
  const readImg=(f:File,cb:(d:string)=>void)=>{
    if(f.size>300*1024){alert('Image too large (max 300 KB)');return}
    const r=new FileReader();r.onload=()=>cb(String(r.result));r.readAsDataURL(f);
  };
  return <div className="pg"><div className="tbs">
    {[{id:'connect',l:'Connection'},{id:'general',l:'General'},{id:'ai',l:'AI'}].map(t=><button key={t.id} className={`tb-btn ${tab===t.id?'on':''}`} onClick={()=>setTab(t.id)}>{t.l}</button>)}</div>
    {tab==='connect'&&<ConnectTab/>}
    {tab==='general'&&<>
      <div className="cd"><div className="cd-hd"><b>General</b></div><div className="p4 s3"><FL label="Webhook Secret" val={loc.webhook_secret||''} onChange={(v:string)=>setLoc({...loc,webhook_secret:v})}/><FL label="Retention (days)" val={loc.retention_days||'90'} onChange={(v:string)=>setLoc({...loc,retention_days:v})}/><button className="btn pr" onClick={()=>onSave(loc)}>Save</button></div></div>
      <div className="cd"><div className="cd-hd"><b>Branding</b></div><div className="p4 s3">
        <div className="fi"><label>Logo</label>{loc.logo_data&&<img src={loc.logo_data} alt="logo" style={{width:36,height:36,borderRadius:8,marginBottom:6}}/>}<input className="inp" type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)readImg(f,(d:string)=>setLoc((p:any)=>({...p,logo_data:d})))}}/></div>
        <div className="fi"><label>Favicon</label>{loc.favicon_data&&<img src={loc.favicon_data} alt="favicon" style={{width:20,height:20,marginBottom:6}}/>}<input className="inp" type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)readImg(f,(d:string)=>setLoc((p:any)=>({...p,favicon_data:d})))}}/></div>
        <p className="xs mu">PNG/JPG up to 300 KB. Saved to the server, applied for all browsers.</p>
        <button className="btn pr" onClick={()=>onSave(loc)}>Save</button>
      </div></div>
    </>}
    {tab==='ai'&&<><VisionCard settings={settings} onSave={onSave}/><AITab pv={provs} onAdd={onAdd} onDel={onDel} onToggle={onToggle}/></>}
  </div>;
}

function ConnectTab() {
  const [connected,setConn]=useState(false);
  const [qr,setQr]=useState('');
  const [qrBusy,setQrBusy]=useState(false);
  const [health,setHealth]=useState<any>(null);
  const [status,setStatus]=useState('');
  const pollRef=useRef<any>(null);

  const refresh=async()=>{
    try{const s=await getWahaStatus();setConn(s.connected);setStatus(s.status||'');setHealth(await getWahaHealth())}catch{}
  };

  useEffect(()=>{refresh();return()=>{if(pollRef.current)clearInterval(pollRef.current)}},[]);

  // WA rotates the pairing QR roughly every 20s — keep the shown code fresh
  // so it never expires before the user finishes scanning.
  useEffect(()=>{
    if(!qr||connected)return;
    const t=setInterval(async()=>{try{const q=await getWahaQr();if(q?.qr)setQr(q.qr)}catch{}},15000);
    return ()=>clearInterval(t);
  },[qr,connected]);

  const startWithPoll=async()=>{
    await startWaha();
    let tries=0;
    pollRef.current=setInterval(async()=>{
      tries++;
      try{
        const s=await getWahaStatus();
        setStatus(s.status||'');
        if(s.status==='SCAN_QR_CODE'&&!qr){
          const q=await getWahaQr();
          setQr(q?.qr||'');
          clearInterval(pollRef.current);pollRef.current=null;
        }
        if(s.connected){setConn(true);clearInterval(pollRef.current);pollRef.current=null}
      }catch{}
      if(tries>30){clearInterval(pollRef.current);pollRef.current=null}
    },2000);
  };

  return <div className="cd"><div className="cd-hd"><b>WhatsApp Connection</b></div><div className="p4 s4">
    <div className="fl aic g2"><div className={`dot ${connected?'on':'off'}`}/><b>{connected?'Connected':'Not Connected'}</b>{status&&<span className="xs mu ml2">{status}</span>}{health?.ok&&<span className="hb"><Check size={12}/>Online</span>}</div>
    <div className="fl g2">
      {!connected?<>
        <button className="btn pr" onClick={startWithPoll}><Play size={13}/> Start</button>
        <button className="btn" disabled={qrBusy||status==='SCAN_QR_CODE'} onClick={async()=>{setQrBusy(true);try{const q=await getWahaQr();setQr(q?.qr||'')}catch{}setQrBusy(false)}}>{qrBusy?<RotateCw size={13} className="sp-anim"/>:<QrCode size={13}/>} Show QR</button>
      </>:<>
        <button className="btn ac" onClick={async()=>{await logoutWaha();refresh();setQr('');setStatus('')}}><LogOut size={13}/> Disconnect</button>
        <button className="btn" onClick={async()=>{await stopWaha();refresh()}}><Square size={13}/> Stop</button>
      </>}
    </div>
    {qr&&<div className="qw"><img src={`data:image/png;base64,${qr}`} alt="QR" className="qi"/><p>Scan with WhatsApp → Linked Devices</p></div>}
    {!connected&&status==='WORKING'&&<div className="hb mt-2"><Check size={12}/>Connected! Files will appear in Inbox.</div>}
  </div></div>;
}

function AITab({pv,onAdd,onDel,onToggle}:{pv:Prov[];onAdd:(p:Prov)=>void;onDel:(n:string)=>void;onToggle:(p:Prov)=>void}) {
  const [k,sk]=useState('openai'),[m,sm]=useState('gpt-5.5'),[a,sa]=useState(''),[u,su]=useState(''),[s,ss]=useState(false);
  const PS:Record<string,{l:string;ms:string[];u:string}>={openai:{l:'OpenAI',ms:['gpt-5.5','gpt-5.4'],u:'https://api.openai.com/v1'},anthropic:{l:'Anthropic',ms:['claude-sonnet-5','claude-opus-4-8','claude-haiku-4-5'],u:'https://api.anthropic.com/v1'},deepseek:{l:'DeepSeek',ms:['deepseek-v4-flash','deepseek-v4-pro'],u:'https://api.deepseek.com/v1'},gemini:{l:'Gemini',ms:['gemini-3.5-flash','gemini-3.1-pro-preview','gemini-3.1-flash-lite'],u:'https://generativelanguage.googleapis.com/v1beta'},groq:{l:'Groq',ms:['meta-llama/llama-4-scout-17b-16e-instruct','llama-3.3-70b-versatile','openai/gpt-oss-120b'],u:'https://api.groq.com/openai/v1'},ollama:{l:'Ollama',ms:['llama3.3','qwen3','mistral'],u:'http://localhost:11434'},openrouter:{l:'OpenRouter',ms:['openai/gpt-5.5','anthropic/claude-sonnet-5','deepseek/deepseek-v4-flash'],u:'https://openrouter.ai/api/v1'},custom:{l:'Custom',ms:[''],u:''}};
  return <div className="cd"><div className="cd-hd"><b>AI Providers ({pv.length})</b><button className="btn sm" onClick={()=>ss(!s)}><Plus size={13}/>{s?'Cancel':'Add'}</button></div>
    {s&&<div className="p4 b2 s3"><div className="g2">
      <FL label="Provider" val={k} onChange={(v:string)=>{sk(v);sm(PS[v]?.ms[0]||'');su(PS[v]?.u||'')}} sl opts={Object.keys(PS).map(x=>({v:x,l:PS[x].l}))}/>
      <div className="fi"><label>Model</label><input className="inp" list="model-opts" value={m} onChange={e=>sm(e.target.value)} placeholder="ketik atau pilih model"/><datalist id="model-opts">{(PS[k]?.ms||[]).filter(x=>x).map(x=><option key={x} value={x}/>)}</datalist></div>
    </div><FL label="API Key" val={a} onChange={(v:string)=>sa(v)} pw/>{u&&<FL label="Base URL" val={u} onChange={(v:string)=>su(v)}/>}<button className="btn pr" onClick={()=>{if(!a)return;onAdd({name:`${k}-${Date.now()}`,kind:k,model:m,api_key:a,base_url:u||'',active:true});sa('');ss(false)}}><Plus size={13}/>Add</button></div>}
    {pv.length===0?<div className="em"><Settings size={32}/><b>No providers</b><p>Add at least one.</p></div>:pv.map(p=><div key={p.name} className="pr-row"><div><b>{p.kind}</b><span className="ml2 xs mu">{p.model}</span></div><div className="fl g2"><span className={`bd ${p.active?'on':'off'}`}>{p.active?'Active':'Off'}</span><button className="btn sm" onClick={()=>onToggle(p)}>{p.active?'Deactivate':'Activate'}</button><button className="bi" onClick={()=>onDel(p.name)}><Trash2 size={13}/></button></div></div>)}
  </div>;
}

function VisionCard({settings,onSave}:{settings:any;onSave:(s:any)=>void}) {
  const P:Record<string,{l:string;u:string;m:string}>={
    '':{l:'Default (active provider / env)',u:'',m:''},
    groq:{l:'Groq — Llama 4 Scout (free tier)',u:'https://api.groq.com/openai/v1',m:'meta-llama/llama-4-scout-17b-16e-instruct'},
    gemini:{l:'Gemini 2.5 Flash (free tier)',u:'https://generativelanguage.googleapis.com/v1beta',m:'gemini-2.5-flash'},
    openai:{l:'OpenAI — GPT-5.5',u:'https://api.openai.com/v1',m:'gpt-5.5'},
    custom:{l:'Custom',u:'',m:''}};
  const [pk,setPk]=useState('');
  const [b,sb]=useState(settings?.vision_base_url||'');
  const [m,sm]=useState(settings?.vision_model||'');
  const [k,sk]=useState('');
  useEffect(()=>{sb(settings?.vision_base_url||'');sm(settings?.vision_model||'')},[settings?.vision_base_url,settings?.vision_model]);
  const pick=(v:string)=>{setPk(v);if(P[v]){sb(P[v].u);sm(P[v].m)}};
  return <div className="cd"><div className="cd-hd"><b>Vision / OCR API</b></div><div className="p4 s3">
    <p className="xs mu">Used to read images &amp; scanned documents. Leave empty to use the active provider or server env key. The API key is stored encrypted and never shown again.</p>
    <FL label="Preset" val={pk} onChange={pick} sl opts={Object.keys(P).map(x=>({v:x,l:P[x].l}))}/>
    <FL label="Base URL" val={b} onChange={(v:string)=>sb(v)}/>
    <FL label="Vision Model" val={m} onChange={(v:string)=>sm(v)}/>
    <div className="fi"><label>API Key {settings?.vision_api_key_set&&<span className="xs mu">(saved — enter to replace)</span>}</label><input className="inp" type="password" value={k} onChange={e=>sk(e.target.value)} placeholder={settings?.vision_api_key_set?'••••••••':'API key'}/></div>
    <button className="btn pr" onClick={()=>{onSave({...settings,vision_base_url:b,vision_model:m,vision_api_key:k});sk('')}}>Save</button>
  </div></div>;
}

function FL({label,val,onChange,sl,opts,pw}:{label:string;val:string;onChange:(v:string)=>void;sl?:boolean;opts?:{v:string;l:string}[];pw?:boolean}) {
  return <div className="fi"><label>{label}</label>{sl&&opts?<select className="inp" value={val} onChange={e=>onChange(e.target.value)}>{opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>:<input className="inp" type={pw?'password':'text'} value={val} onChange={e=>onChange(e.target.value)}/>}</div>;
}

const el=document.getElementById('root');if(el)createRoot(el).render(<App/>);
