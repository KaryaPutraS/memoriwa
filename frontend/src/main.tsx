import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, Check, ChevronRight, FileText, Folder, Home, Menu, Pencil, QrCode, Search, Settings, Sparkles, Trash2, Zap, Image, FileIcon, RotateCw, Play, Square, LogOut, Share2, Plus, FolderInput, Wand2, LayoutGrid, List } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { login, logout, getToken, setToken, getDocuments, startWaha, stopWaha, logoutWaha, getWahaStatus, getWahaQr, getWahaHealth, getProviders, createProvider, deleteProvider, updateProvider, getSettings, saveSettings, analyzeDocument, deleteDocument, verifyDocuments, updateGroup, updateDocument, moveDocuments, renameFolder, deleteGroup, identifyDocument, identifyGroup, changePassword, uploadDocuments, downloadGroupPdf, createShare, getShares, deleteShare, createSmartCollection, getSmartCollections, deleteSmartCollection } from './api';
import './styles.css';

type Doc = { id:string; filename:string; sender:string; mime_type:string; status:string; metadata?:any; file_url?:string; url?:string; created_at?:string };
type Prov = { name:string; kind:string; model:string; api_key:string; base_url?:string; active?:boolean };
const SC: Record<string,string> = { unanalyzed:'#999', processing:'#f59e0b', analyzed:'#00d4aa', failed:'#f2504b' };
const API_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || '';

// Persistent Blob URL Cache so switching tabs or leaving page never breaks previews!
const blobUrlCache = new Map<string, string>();
const blobFetching = new Map<string, Promise<string>>();

function fetchAuthBlobUrl(id: string): Promise<string> {
  if (blobUrlCache.has(id)) return Promise.resolve(blobUrlCache.get(id)!);
  if (blobFetching.has(id)) return blobFetching.get(id)!;
  const p = fetch(API_URL + '/api/files/' + id + '/raw', {
    headers: { Authorization: 'Bearer ' + (getToken() || '') }
  })
    .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.blob(); })
    .then(b => {
      const obj = URL.createObjectURL(b);
      blobUrlCache.set(id, obj);
      blobFetching.delete(id);
      return obj;
    })
    .catch(err => {
      blobFetching.delete(id);
      throw err;
    });
  blobFetching.set(id, p);
  return p;
}

function useAuthFileUrl(id: string, enabled: boolean): string {
  const [url, setUrl] = useState<string>(() => (enabled && id && blobUrlCache.get(id)) || '');

  useEffect(() => {
    if (!enabled || !id) return;
    if (blobUrlCache.has(id)) { setUrl(blobUrlCache.get(id)!); return; }
    let active = true;
    fetchAuthBlobUrl(id).then(u => { if (active) setUrl(u); }).catch(() => {});
    return () => { active = false; };
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
  const verifyDocs = async (ids:string[], folder:string)=>{ await verifyDocuments(ids, folder).catch(()=>{}); refreshDocs(); flash('Saved to Files'); };
  const saveGroup = async (gid:string, explanation:string, folder:string)=>{ await updateGroup(gid, {explanation, folder}).catch(()=>{}); refreshDocs(); flash('Saved'); };
  const editDoc = async (id:string, patch:any)=>{ await updateDocument(id, patch).catch(()=>{}); refreshDocs(); flash('Saved'); };
  const moveDocs = async (ids:string[], folder:string)=>{ await moveDocuments(ids, folder).catch(()=>{}); refreshDocs(); flash('Moved'); };
  const renameF = async (oldN:string, newN:string)=>{ await renameFolder(oldN, newN).catch(()=>{}); refreshDocs(); flash('Folder renamed'); };
  const delMany = async (ids:string[])=>{ await Promise.all(ids.map(id=>deleteDocument(id).catch(()=>{}))); setDocs(ds=>ds.filter(d=>!ids.includes(d.id))); flash('Deleted'); };
  const delGroup = async (gid:string)=>{ await deleteGroup(gid).catch(()=>{}); setDocs(ds=>ds.filter(d=>d.metadata?.group_id!==gid)); flash('Group deleted'); };
  const identify = async (id:string)=>{ flash('Identifying with AI...'); await identifyDocument(id).catch(()=>flash('Identify failed — check AI provider')); refreshDocs(); flash('Done!'); };
  const identifyG = async (gid:string)=>{ flash('Identifying with AI...'); await identifyGroup(gid).catch(()=>flash('Identify failed — check AI provider')); refreshDocs(); flash('Done!'); };
  const regroup = async (id:string, gid:string)=>{ await updateDocument(id,{group:gid}).catch(()=>{}); refreshDocs(); flash('Photo moved'); };
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
        {page==='Inbox' && <InboxPage docs={docs} refreshDocs={refreshDocs} analyze={analyze} del={deleteDoc} delMany={delMany} delGroup={delGroup} verify={verifyDocs} saveGroup={saveGroup} identifyG={identifyG} regroup={regroup} flash={flash}/>}
        {page==='Files' && <FilesPage docs={docs} refreshDocs={refreshDocs} flash={flash} analyze={analyze} del={deleteDoc} editDoc={editDoc} moveDocs={moveDocs} renameF={renameF} identify={identify}/>}
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

function ShareModal({targetType, targetId, onClose, flash}:{targetType:string; targetId:string; onClose:()=>void; flash:(msg:string)=>void}) {
  const [hours, setHours] = useState('24');
  const [password, setPassword] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const h = hours ? parseInt(hours) : undefined;
      const res = await createShare(targetType, targetId, h, password || undefined);
      const fullUrl = window.location.origin + res.share_url;
      setShareUrl(fullUrl);
      flash('Public share link created!');
    } catch (e: any) {
      flash('Failed to create share link: ' + (e.message || 'Error'));
    } finally {
      setLoading(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    flash('Link copied to clipboard!');
  };

  return (
    <div className="overlay" style={{display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}} onClick={onClose}>
      <div className="lg-card" style={{maxWidth:440,width:'90%',background:'#181824',border:'1px solid #333',borderRadius:16,padding:24}} onClick={e=>e.stopPropagation()}>
        <h3 style={{marginTop:0,marginBottom:12,display:'flex',alignItems:'center',gap:8}}><Share2 size={18}/> Share Public Link</h3>
        {!shareUrl ? (
          <>
            <div className="fi" style={{marginBottom:12}}>
              <label style={{fontSize:12,color:'#aaa'}}>Expiration Time</label>
              <select className="inp" value={hours} onChange={e=>setHours(e.target.value)}>
                <option value="24">24 Hours</option>
                <option value="168">7 Days</option>
                <option value="720">30 Days</option>
                <option value="0">Never (No Expiration)</option>
              </select>
            </div>
            <div className="fi" style={{marginBottom:16}}>
              <label style={{fontSize:12,color:'#aaa'}}>Password Protection (Optional)</label>
              <input className="inp" type="password" placeholder="Leave empty for public link" value={password} onChange={e=>setPassword(e.target.value)}/>
            </div>
            <div className="fl g2">
              <button className="btn pr sm" disabled={loading} onClick={handleCreate}>Create Link</button>
              <button className="btn sm" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="fi" style={{marginBottom:16}}>
              <label style={{fontSize:12,color:'#aaa'}}>Shareable Link</label>
              <input className="inp" readOnly value={shareUrl} style={{fontSize:12}}/>
            </div>
            <div className="fl g2">
              <button className="btn pr sm" onClick={copyLink}>Copy Link</button>
              <button className="btn sm" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function UploadZone({onUploaded, flash, folder}:{onUploaded:()=>void; flash:(msg:string)=>void; folder?:string}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    flash('Uploading file(s)...');
    try {
      await uploadDocuments(files, folder);
      flash(`Uploaded ${files.length} file(s)!`);
      onUploaded();
    } catch (err: any) {
      flash('Upload failed: ' + (err.message || 'Error'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  return (
    <div style={{display:'inline-flex', alignItems:'center'}}>
      <input type="file" ref={fileRef} multiple style={{display:'none'}} onChange={handleFileChange}/>
      <button className="btn pr sm" disabled={uploading} onClick={()=>fileRef.current?.click()} style={{gap:5}}>
        <Plus size={13}/> <span>Upload</span>
      </button>
    </div>
  );
}

function InboxPage({docs,refreshDocs,analyze,del,delMany,delGroup,verify,saveGroup,identifyG,regroup,flash}:{docs:Doc[];refreshDocs:()=>void;analyze:(id:string)=>void;del:(id:string)=>void;delMany:(ids:string[])=>void;delGroup:(gid:string)=>void;verify:(ids:string[],folder:string)=>void;saveGroup:(gid:string,expl:string,folder:string)=>void;identifyG:(gid:string)=>void;regroup:(id:string,gid:string)=>void;flash:(msg:string)=>void}) {
  const [q,sq]=useState(''),[f,sf]=useState('All'),[sel,ssel]=useState<string[]>([]);
  const [shareTarget, setShareTarget] = useState<{type:string; id:string}|null>(null);
  const fd=React.useMemo(()=>{
    let d=docs.filter(x=>x.status!=='analyzed');
    if(f==='PDF')d=d.filter(x=>x.mime_type==='application/pdf');
    if(f==='IMAGE')d=d.filter(x=>x.mime_type?.startsWith('image/'));
    if(q){const ql=q.toLowerCase();d=d.filter(x=>x.filename?.toLowerCase().includes(ql)||x.sender?.includes(q)||(JSON.stringify(x.metadata?.identity||'')+' '+(x.metadata?.extracted_text||'')+' '+(x.metadata?.explanation||'')).toLowerCase().includes(ql));}
    return d;
  },[docs,q,f]);
  const toggle=(id:string)=>ssel(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const grouped=React.useMemo(()=>{
    const g:Record<string,Doc[]>={};const s:Doc[]=[];
    fd.forEach(d=>{const gid=d.metadata?.group_id;if(gid)(g[gid]=g[gid]||[]).push(d);else s.push(d)});
    return {g:Object.entries(g),s};
  },[fd]);
  return <div className="pg">
    {shareTarget && <ShareModal targetType={shareTarget.type} targetId={shareTarget.id} onClose={()=>setShareTarget(null)} flash={flash}/>}
    <div className="mx">
      <M n={docs.length} l="Total" c="#c8f31d"/>
      <M n={docs.filter(d=>d.status==='unanalyzed').length} l="Pending" c="#999"/>
      <M n={docs.filter(d=>d.status==='analyzed').length} l="Done" c="#00d4aa"/>
      <M n={docs.filter(d=>d.status==='failed').length} l="Failed" c="#f2504b"/>
    </div>
    <div className="br">
      <div className="sbx"><Search size={15}/><input placeholder="Search..." value={q} onChange={e=>sq(e.target.value)}/></div>
      <div className="cs">{['All','PDF','IMAGE'].map(x=><button key={x} className={`ch ${f===x?'on':''}`} onClick={()=>sf(x)}>{x}</button>)}</div>
      <UploadZone onUploaded={refreshDocs} flash={flash}/>
      <button className="btn sm" onClick={refreshDocs}><RotateCw size={13}/></button>
      {sel.length>0&&<button className="btn ac" onClick={()=>{sel.forEach(analyze);ssel([])}}><Sparkles size={13}/> Analyze ({sel.length})</button>}
    </div>
    <div className="cd">
      <div className="cd-hd"><b>Documents ({fd.length})</b></div>
      {fd.length===0?<div className="em"><FileText size={32}/><b>No documents</b><p>Send a file or image to your WhatsApp.</p></div>
      :<>{grouped.g.map(([gid,gdocs])=><GroupCard key={gid} gid={gid} docs={gdocs} onVerify={verify} onSave={saveGroup} onDeleteSelected={delMany} onDeleteGroup={delGroup} onRegroup={regroup} onIdentifyGroup={identifyG} onShare={(t,id)=>setShareTarget({type:t,id})} otherGroups={grouped.g.filter(([g2]:any)=>g2!==gid).map(([g2,gd]:any)=>({gid:g2,title:gd[0]?.metadata?.identity?.title||gd[0]?.metadata?.explanation||'Photo group'}))}/>)}
      {grouped.s.map(d=><DocRow key={d.id} doc={d} sel={sel} toggle={toggle} analyze={()=>analyze(d.id)} del={()=>del(d.id)} onShare={(t,id)=>setShareTarget({type:t,id})}/>)}</>}
    </div>
  </div>;
}

function M({n,l,c}:{n:number;l:string;c:string}) { return <div className="mt"><span className="mt-n" style={{color:c}}>{n}</span><span className="mt-l">{l}</span></div>; }

// One photo inside a group grid: tap to include/exclude it, drag it onto
// another group card to move it there (photo was grouped wrong).
function GroupThumb({doc,on,flip,gid}:{doc:Doc;on:boolean;flip:()=>void;gid:string}) {
  const url=useAuthFileUrl(doc.id,true);
  const [imgErr, setImgErr]=useState(false);
  return <div className={`gthumb ${on?'':'off'}`} onClick={flip} title={doc.filename}
    draggable
    onDragStart={e=>{e.dataTransfer.setData('application/x-mw-doc',JSON.stringify({id:doc.id,gid}));e.dataTransfer.effectAllowed='move';e.stopPropagation()}}>
    <input type="checkbox" checked={on} onChange={flip} onClick={e=>e.stopPropagation()}/>
    {url&&!imgErr?<img src={url} alt={doc.filename} draggable={false} onError={()=>setImgErr(true)}/>:<div className="gph"><Image size={20} color="#666"/></div>}
  </div>;
}

// A photo burst + its WhatsApp caption, waiting for human verification.
// Photos are shown so the user can pick which ones belong — only the
// selected ones are verified into Files; the rest can be deleted here.
function GroupCard({gid,docs,onVerify,onSave,onDeleteSelected,onDeleteGroup,onRegroup,onIdentifyGroup,onShare,otherGroups}:{gid:string;docs:Doc[];onVerify:(ids:string[],folder:string)=>void;onSave:(gid:string,expl:string,folder:string)=>void;onDeleteSelected?:(ids:string[])=>void;onDeleteGroup?:(gid:string)=>void;onRegroup?:(id:string,gid:string)=>void;onIdentifyGroup?:(gid:string)=>void;onShare?:(type:string,id:string)=>void;otherGroups?:{gid:string;title:string}[]}) {
  const first=docs[0]||{};
  const [edit,setEdit]=useState(false);
  const [dragOver,setDragOver]=useState(false);
  const [moveTo,setMoveTo]=useState('');
  const [selp,setSelp]=useState<string[]>(docs.map(d=>d.id));
  const [expl,setExpl]=useState(first.metadata?.explanation||'');
  const [folder,setFolder]=useState(first.metadata?.folder||'');
  useEffect(()=>{setExpl(first.metadata?.explanation||'');setFolder(first.metadata?.folder||'');setSelp(docs.map(d=>d.id))},[first.metadata?.explanation,first.metadata?.folder,docs.length]);
  const flip=(id:string)=>setSelp(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const title=first.metadata?.identity?.title||first.metadata?.explanation||'Photo group';
  const onDrop=(e:React.DragEvent)=>{
    e.preventDefault();setDragOver(false);
    try{
      const d=JSON.parse(e.dataTransfer.getData('application/x-mw-doc')||'{}');
      if(d.id&&d.gid&&d.gid!==gid&&onRegroup)onRegroup(d.id,gid);
    }catch{}
  };
  return <div className={`dw ${dragOver?'dragover':''}`}
    onDragOver={e=>{if(e.dataTransfer.types.includes('application/x-mw-doc')){e.preventDefault();setDragOver(true)}}}
    onDragLeave={()=>setDragOver(false)} onDrop={onDrop}>
    <div className="dr" onClick={()=>setEdit(!edit)}>
      <div className="di"><Image size={17}/></div>
      <div className="dn"><div className="dnm">{title}</div><div className="dnt">{docs.length} foto · {first.sender}{first.metadata?.folder?' · '+first.metadata.folder:''}</div></div>
      <span className="ds" style={{background:'#f59e0b18',color:'#f59e0b',borderColor:'#f59e0b'}}>review</span>
      {onShare&&<button className="bi" title="Share public link" onClick={e=>{e.stopPropagation();onShare('group',gid)}}><Share2 size={13}/></button>}
      {onIdentifyGroup&&<button className="bi" title="AI: extract keywords as identity" onClick={e=>{e.stopPropagation();onIdentifyGroup(gid)}}><Wand2 size={13}/></button>}
      <button className="bi" title="Verify selected & save to Files" onClick={e=>{e.stopPropagation();if(selp.length)onVerify(selp,folder)}}><Check size={14}/></button>
      <button className="bi" title="Edit explanation / folder" onClick={e=>{e.stopPropagation();setEdit(!edit)}}><Pencil size={13}/></button>
      <ChevronRight size={15} className={`dc ${edit?'rt':''}`}/>
    </div>
    <div className="ggrid" onClick={e=>e.stopPropagation()}>
      {docs.map(d=><GroupThumb key={d.id} doc={d} gid={gid} on={selp.includes(d.id)} flip={()=>flip(d.id)}/>)}
    </div>
    <div className="pa">
      <button className="btn sm" disabled={!selp.length} onClick={()=>onVerify(selp,folder)}><Check size={12}/> Verify selected ({selp.length})</button>
      <button className="btn sm" onClick={()=>downloadGroupPdf(gid)} title="Export PDF Laporan Activity"><FileText size={12}/> Export PDF</button>
      {onDeleteSelected&&<button className="btn sm" disabled={!selp.length} onClick={()=>{if(confirm(`Delete ${selp.length} selected photo(s)?`))onDeleteSelected(selp)}}><Trash2 size={12}/> Delete selected</button>}
      {onDeleteGroup&&<button className="btn sm" onClick={()=>{if(confirm('Delete this whole group?'))onDeleteGroup(gid)}}><Trash2 size={12}/> Delete group</button>}
    </div>
    {edit&&<div className="dp"><div className="p4 s3">
      <div className="fi"><label>Explanation</label><textarea className="inp" rows={3} value={expl} onChange={e=>setExpl(e.target.value)}/></div>
      <div className="fi"><label>Folder (manual, optional)</label><input className="inp" value={folder} onChange={e=>setFolder(e.target.value)} placeholder="mis. dokumentasi kegiatan"/></div>
      {!!(otherGroups&&otherGroups.length&&onRegroup)&&<div className="fi"><label>Move selected photos to another group</label>
        <div className="fl g2">
          <select className="inp" value={moveTo} onChange={e=>setMoveTo(e.target.value)}><option value="">— pilih grup tujuan —</option>{otherGroups.map(g=><option key={g.gid} value={g.gid}>{g.title.slice(0,60)}</option>)}</select>
          <button className="btn sm" disabled={!moveTo||!selp.length} onClick={()=>{selp.forEach(id=>onRegroup(id,moveTo));setMoveTo('')}}><FolderInput size={12}/> Move</button>
        </div>
        <p className="xs mu">Di komputer: foto juga bisa di-drag langsung ke kartu grup lain.</p>
      </div>}
      <div className="fl g2">
        <button className="btn sm" onClick={()=>onSave(gid,expl,folder)}>Save changes</button>
        <button className="btn pr" disabled={!selp.length} onClick={()=>onVerify(selp,folder)}><Check size={12}/> Verify & save to Files</button>
      </div>
    </div></div>}
  </div>;
}

function PptPreview({doc}:{doc:Doc}) {
  const text=doc.metadata?.extracted_text;
  return <div className="pm-pptx">
    <div className="pm-hdr">
      <div className="pm-badge">P</div>
      <div>
        <div className="pm-title">{doc.filename}</div>
        <div className="pm-sub">PowerPoint Presentation</div>
      </div>
    </div>
    {text?<div>
        <div className="mu xs" style={{marginBottom:4,fontWeight:'bold'}}>SLIDE CONTENT EXTRACTED</div>
        <div className="pm-txt">{text}</div>
      </div>:<div className="pm-empty">
        <FileText size={28} color="#ea580c" style={{margin:'0 auto 6px',display:'block'}}/>
        <b style={{color:'#9a3412'}}>Slide text ready to analyze</b>
        <p className="mu xs" style={{marginTop:2}}>Click Analyze to extract presentation slides into clean text.</p>
      </div>}
  </div>;
}

function DocxPreview({doc}:{doc:Doc}) {
  const text=doc.metadata?.extracted_text;
  return <div className="pm-docx">
    <div className="pm-hdr">
      <div className="pm-badge">W</div>
      <div>
        <div className="pm-title">{doc.filename}</div>
        <div className="pm-sub">Word Document</div>
      </div>
    </div>
    {text?<div>
        <div className="mu xs" style={{marginBottom:4,fontWeight:'bold'}}>DOCUMENT CONTENT</div>
        <div className="pm-txt">{text}</div>
      </div>:<div className="pm-empty">
        <FileText size={28} color="#2563eb" style={{margin:'0 auto 6px',display:'block'}}/>
        <b style={{color:'#1e40af'}}>Document content ready to analyze</b>
        <p className="mu xs" style={{marginTop:2}}>Click Analyze to extract document paragraphs into clean text.</p>
      </div>}
  </div>;
}

function XlsxPreview({doc}:{doc:Doc}) {
  const text=doc.metadata?.extracted_text;
  return <div className="pm-xlsx">
    <div className="pm-hdr">
      <div className="pm-badge">X</div>
      <div>
        <div className="pm-title">{doc.filename}</div>
        <div className="pm-sub">Excel Spreadsheet</div>
      </div>
    </div>
    {text?<div>
        <div className="mu xs" style={{marginBottom:4,fontWeight:'bold'}}>SPREADSHEET DATA EXTRACTED</div>
        <div className="pm-txt">{text}</div>
      </div>:<div className="pm-empty">
        <FileText size={28} color="#16a34a" style={{margin:'0 auto 6px',display:'block'}}/>
        <b style={{color:'#15803d'}}>Spreadsheet data ready to analyze</b>
        <p className="mu xs" style={{marginTop:2}}>Click Analyze to extract spreadsheet cells into clean text.</p>
      </div>}
  </div>;
}

function DocRow({doc,sel,toggle,analyze,del,onEdit,folders,onIdentify,onShare}:{doc:Doc;sel:string[];toggle:(id:string)=>void;analyze:()=>void;del?:()=>void;onEdit?:(id:string,patch:any)=>void;folders?:string[];onIdentify?:(id:string)=>void;onShare?:(type:string,id:string)=>void}) {
  const [o,so]=useState(false);
  const [editing,setEditing]=useState(false);
  const [etitle,setEtitle]=useState('');
  const [efolder,setEfolder]=useState('');
  const mime=(doc.mime_type||'').toLowerCase();
  const fname=(doc.filename||'').toLowerCase();
  const im=mime.startsWith('image/')||/\.(jpg|jpeg|png|webp|gif|svg)$/i.test(fname);
  const pd=mime==='application/pdf'||fname.endsWith('.pdf');
  const isVid=mime.startsWith('video/')||/\.(mp4|webm|mov|mkv)$/i.test(fname);
  const isAud=mime.startsWith('audio/')||/\.(mp3|wav|ogg|m4a)$/i.test(fname);
  const isPpt=mime.includes('presentationml')||/\.(pptx|ppt)$/i.test(fname);
  const isDocx=mime.includes('wordprocessingml')||/\.(docx|doc)$/i.test(fname);
  const isXlsx=mime.includes('spreadsheetml')||/\.(xlsx|xls|csv)$/i.test(fname);
  const pv=useAuthFileUrl(doc.id, im||pd||isVid||isAud||o);
  const cl=SC[doc.status]||'#999';
  const tags:string[]=(doc.metadata?.identity?.tags||[]).slice(0,3);
  const startEdit=()=>{setEtitle(doc.metadata?.identity?.title||doc.filename||'');setEfolder(doc.metadata?.folder||'');setEditing(true);so(true)};
  return <div className="dw">
    <div className="dr" onClick={()=>so(!o)}>
      <input type="checkbox" checked={sel.includes(doc.id)} onChange={e=>{e.stopPropagation();toggle(doc.id)}} onClick={e=>e.stopPropagation()}/>
      <div className="di">{im&&pv?<img src={pv} className="tt" alt=""/>:im?<Image size={17}/>:pd?<FileIcon size={17}/>:<FileText size={17}/>}</div>
      <div className="dn"><div className="dnm">{doc.metadata?.identity?.title||doc.metadata?.explanation||doc.filename||'Untitled'}</div><div className="dnt">{doc.sender} · {doc.created_at?new Date(doc.created_at).toLocaleDateString():''}{doc.metadata?.folder?' · '+doc.metadata.folder:doc.metadata?.identity?.doc_type?' · '+doc.metadata.identity.doc_type:''}</div>
      {!!tags.length&&<div className="tchips">{tags.map(t=><span key={t} className="tchip">{t}</span>)}</div>}</div>
      {typeof doc.metadata?.relevance_score==='number'&&doc.metadata.relevance_score>0&&<span className="ds" style={{background:'#00d4aa18',color:'#00d4aa',borderColor:'#00d4aa'}}>{Math.round(doc.metadata.relevance_score*100)}% match</span>}
      <span className="ds" style={{background:cl+'18',color:cl,borderColor:cl}}>{doc.status}{doc.status==='processing'&&typeof doc.metadata?.progress==='number'?` ${doc.metadata.progress}%`:''}</span>
      {onShare&&<button className="bi" title="Share public link" onClick={e=>{e.stopPropagation();onShare('document',doc.id)}}><Share2 size={13}/></button>}
      {onIdentify&&!!(doc.metadata?.explanation||doc.metadata?.caption)&&<button className="bi" title="AI: extract keywords as identity" onClick={e=>{e.stopPropagation();onIdentify(doc.id)}}><Wand2 size={13}/></button>}
      <button className="bi" title="Analyze" onClick={e=>{e.stopPropagation();analyze()}}><Sparkles size={13}/></button>
      {onEdit&&<button className="bi" title="Edit" onClick={e=>{e.stopPropagation();startEdit()}}><Pencil size={13}/></button>}
      {del&&<button className="bi" title="Delete" onClick={e=>{e.stopPropagation();del()}}><Trash2 size={13}/></button>}
      <ChevronRight size={15} className={`dc ${o?'rt':''}`}/>
    </div>
    {o&&<div className="dp"><div className="dg"><div className="dp-info"><b>{doc.filename}</b>
      <div className="ir"><span>Type:</span>{doc.mime_type||'?'}</div><div className="ir"><span>From:</span>{doc.sender}</div><div className="ir"><span>Size:</span>{doc.metadata?.size?(doc.metadata.size/1024).toFixed(1)+' KB':'?'}</div></div>
      {doc.metadata?.identity&&<div className="dp-info"><div className="ir"><span>Summary:</span>{doc.metadata.identity.summary||'-'}</div><div className="ir"><span>Tags:</span>{(doc.metadata.identity.tags||[]).join(', ')||'-'}</div></div>}
      {doc.metadata?.explanation&&<div className="dp-info"><div className="ir" style={{whiteSpace:'pre-wrap'}}><span>Report:</span>{doc.metadata.explanation}</div></div>}
      {im&&pv&&<div className="pm pm-img"><img src={pv} alt={doc.filename} className="pi" onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/></div>}
      {pd&&pv&&<div className="pm pm-pdf" style={{width:'100%'}}><iframe src={pv} style={{width:'100%',height:'100%',minHeight:360,border:'1px solid #333',borderRadius:8,background:'#fff'}} title={doc.filename}/></div>}
      {isVid&&pv&&<div className="pm pm-video" style={{width:'100%'}}><video src={pv} controls style={{width:'100%',maxHeight:360,borderRadius:8}}/></div>}
      {isAud&&pv&&<div className="pm pm-audio" style={{width:'100%'}}><audio src={pv} controls style={{width:'100%'}}/></div>}
      {(isPpt||isDocx||isXlsx)&&<div className="pm pm-office" style={{width:'100%'}}><iframe src={`/api/files/${doc.id}/view?token=${encodeURIComponent(getToken()||'')}`} style={{width:'100%',height:380,border:'1px solid #334155',borderRadius:10,background:'#0f172a'}} title={doc.filename}/></div>}
      {!im&&!pd&&!isVid&&!isAud&&!isPpt&&!isDocx&&!isXlsx&&!doc.metadata?.extracted_text&&<div className="pm pfc"><FileText size={32}/><b>File</b><span>{doc.mime_type}</span></div>}</div>
      <div className="pa">
        <button className="btn sm" onClick={analyze}><Sparkles size={12}/> Analyze</button>
        <a className="btn sm" href={`/api/files/${doc.id}/view?token=${encodeURIComponent(getToken()||'')}`} target="_blank" rel="noopener"><Share2 size={12}/> Open Preview</a>
        <a className="btn sm" href={pv||`/api/files/${doc.id}/raw?token=${encodeURIComponent(getToken()||'')}`} target="_blank" rel="noopener" download={doc.filename}><FolderInput size={12}/> Download File</a>
      </div></div>
    }
    {editing&&onEdit&&<div className="dp"><div className="p4 s3">
      <div className="fi"><label>Title</label><input className="inp" value={etitle} onChange={e=>setEtitle(e.target.value)}/></div>
      <div className="fi"><label>Folder</label><input className="inp" list="dl-folders" value={efolder} onChange={e=>setEfolder(e.target.value)} placeholder="mis. dokumentasi kegiatan"/></div>
      <div className="fl g2">
        <button className="btn pr" onClick={()=>{onEdit(doc.id,{title:etitle,folder:efolder});setEditing(false)}}><Check size={12}/> Save</button>
        {doc.metadata?.group_id&&<button className="btn sm" onClick={()=>{onEdit(doc.id,{ungroup:true});setEditing(false)}}>Remove from group</button>}
        <button className="btn sm" onClick={()=>setEditing(false)}>Cancel</button>
      </div>
    </div></div>}
    </div>;
}

function FilesPage({docs,refreshDocs,flash,analyze,del,editDoc,moveDocs,renameF,identify}:{docs:Doc[];refreshDocs?:()=>void;flash?:(msg:string)=>void;analyze:(id:string)=>void;del:(id:string)=>void;editDoc:(id:string,patch:any)=>void;moveDocs:(ids:string[],folder:string)=>void;renameF:(oldN:string,newN:string)=>void;identify:(id:string)=>void}) {
  const [q,sq]=useState(''),[folder,setFolder]=useState('');
  const [sel,ssel]=useState<string[]>([]);
  const [renaming,setRenaming]=useState(''),[rname,setRname]=useState('');
  const [mopen,setMopen]=useState(false),[mtarget,setMtarget]=useState('');
  const [folderView, setFolderView] = useState<'grid'|'list'>('grid');
  const toggle=(id:string)=>ssel(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const GENERIC=['','other','unknown','uncategorized','document','dokumen','file','general','lainnya','misc'];
  const folderOf=(d:Doc)=>{
    const mf=(d.metadata?.folder||'').trim();
    if(mf)return mf;
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
  const allNames=folders.map(([f])=>f);
  const doRename=(oldN:string)=>{const nn=rname.trim();if(nn&&nn!==oldN)renameF(oldN,nn);setRenaming('');if(folder===oldN)setFolder(nn||oldN)};
  return <div className="pg">
    <div className="mx"><M n={analyzed.length} l="Analyzed" c="#00d4aa"/><M n={folders.length} l="Folders" c="#c8f31d"/><M n={docs.filter(d=>d.status==='unanalyzed').length} l="Pending" c="#999"/></div>
    <datalist id="dl-folders">{allNames.map(f=><option key={f} value={f}/>)}</datalist>
    <div className="br">
      <div className="sbx"><Search size={15}/><input placeholder="Search name, content, or identity..." value={q} onChange={e=>sq(e.target.value)}/></div>
      {refreshDocs&&flash&&<UploadZone onUploaded={refreshDocs} flash={flash} folder={folder}/>}
      {folder&&<button className="btn sm" onClick={()=>{setFolder('');ssel([])}}>Back</button>}
      {sel.length>0&&<button className="btn sm" onClick={()=>{setMopen(!mopen);setMtarget(folder||'')}}><FolderInput size={13}/> Move ({sel.length})</button>}
      {sel.length>0&&<button className="btn sm" onClick={()=>{if(confirm(`Delete ${sel.length} file(s)?`)){sel.forEach(del);ssel([])}}}><Trash2 size={13}/> Delete ({sel.length})</button>}
    </div>
    {mopen&&sel.length>0&&<div className="cd"><div className="p4 s3">
      <div className="fi"><label>Move {sel.length} file(s) to folder</label><input className="inp" list="dl-folders" value={mtarget} onChange={e=>setMtarget(e.target.value)} placeholder="Folder name (new or existing)"/></div>
      <div className="fl g2"><button className="btn pr" disabled={!mtarget.trim()} onClick={()=>{moveDocs(sel,mtarget.trim());ssel([]);setMopen(false)}}><Check size={12}/> Move</button><button className="btn sm" onClick={()=>setMopen(false)}>Cancel</button></div>
    </div></div>}
    {!folder&&!ql&&<div className="cd">
      <div className="cd-hd">
        <b>Folders ({folders.length})</b>
        <div className="cs" style={{gap:4}}>
          <button className={`ch ${folderView==='grid'?'on':''}`} onClick={()=>setFolderView('grid')} title="Grid View (Kotak)"><LayoutGrid size={13}/> Grid</button>
          <button className={`ch ${folderView==='list'?'on':''}`} onClick={()=>setFolderView('list')} title="List View (Kebawah)"><List size={13}/> List</button>
        </div>
      </div>
      {folders.length===0?<div className="em"><Folder size={32}/><b>No folders yet</b><p>Analyze files in Inbox — folders are created automatically from the detected document type.</p></div>
      :folderView==='grid'?(
        <div className="fgrid">
          {folders.map(([f,n])=>(
            <div key={f} className="fcard" onClick={()=>setFolder(f)}>
              <div className="fc-ic"><Folder size={22}/></div>
              <div className="fc-main">
                {renaming===f?(
                  <input className="inp" value={rname} onChange={e=>setRname(e.target.value)} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Enter')doRename(f);if(e.key==='Escape')setRenaming('')}} autoFocus/>
                ):(
                  <div className="fc-name">{f}</div>
                )}
                <div className="fc-sub">{n} file{n>1?'s':''}</div>
              </div>
              {renaming===f?(
                <div className="fc-act">
                  <button className="bi" title="Save" onClick={e=>{e.stopPropagation();doRename(f)}}><Check size={13}/></button>
                  <button className="bi" title="Cancel" onClick={e=>{e.stopPropagation();setRenaming('')}}><RotateCw size={12}/></button>
                </div>
              ):(
                <button className="bi fc-edit" title="Rename folder" onClick={e=>{e.stopPropagation();setRenaming(f);setRname(f)}}><Pencil size={13}/></button>
              )}
            </div>
          ))}
        </div>
      ):(
        folders.map(([f,n])=><div key={f} className="fr" style={{cursor:'pointer'}} onClick={()=>setFolder(f)}>
          <Folder size={15}/>
          {renaming===f
            ?<span className="f1" onClick={e=>e.stopPropagation()}><input className="inp" value={rname} onChange={e=>setRname(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')doRename(f);if(e.key==='Escape')setRenaming('')}} autoFocus/></span>
            :<span className="f1">{f}</span>}
          <span className="mu xs">{n} file{n>1?'s':''}</span>
          {renaming===f
            ?<><button className="bi" title="Save name" onClick={e=>{e.stopPropagation();doRename(f)}}><Check size={13}/></button><button className="bi" title="Cancel" onClick={e=>{e.stopPropagation();setRenaming('')}}><RotateCw size={12}/></button></>
            :<button className="bi" title="Rename folder" onClick={e=>{e.stopPropagation();setRenaming(f);setRname(f)}}><Pencil size={13}/></button>}
          <ChevronRight size={13}/></div>)
      )}
    </div>}
    {(folder||ql)&&<div className="cd"><div className="cd-hd"><b>{folder||'Search results'} ({list.length})</b>
      {list.length>0&&<button className="btn sm" onClick={()=>{const ids=list.map(d=>d.id);ssel(sel.length===ids.length?[]:ids)}}>{sel.length===list.length?'Unselect all':'Select all'}</button>}
    </div>
      {list.length===0?<div className="em"><FileText size={32}/><b>No files found</b></div>
      :list.map(d=><DocRow key={d.id} doc={d} sel={sel} toggle={toggle} analyze={()=>analyze(d.id)} del={()=>del(d.id)} onEdit={editDoc} folders={allNames} onIdentify={identify}/>)}
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
      <PasswordCard/>
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

// Self-contained change-password card (Settings -> General). The new
// password replaces the env password from then on and survives restarts.
function PasswordCard() {
  const [cur,setCur]=useState(''),[nw,setNw]=useState(''),[cf,setCf]=useState('');
  const [err,setErr]=useState(''),[ok,setOk]=useState(false),[busy,setBusy]=useState(false);
  const go=async()=>{
    setErr('');setOk(false);
    if(nw.length<8){setErr('Password baru minimal 8 karakter');return}
    if(nw!==cf){setErr('Konfirmasi password tidak sama');return}
    setBusy(true);
    try{await changePassword(cur,nw);setOk(true);setCur('');setNw('');setCf('')}
    catch{setErr('Gagal menyimpan — periksa password saat ini')}
    setBusy(false);
  };
  return <div className="cd"><div className="cd-hd"><b>Change Password</b></div><div className="p4 s3">
    <div className="fi"><label>Password saat ini</label><input className="inp" type="password" value={cur} onChange={e=>setCur(e.target.value)} autoComplete="current-password"/></div>
    <div className="fi"><label>Password baru (min. 8 karakter)</label><input className="inp" type="password" value={nw} onChange={e=>setNw(e.target.value)} autoComplete="new-password"/></div>
    <div className="fi"><label>Ulangi password baru</label><input className="inp" type="password" value={cf} onChange={e=>setCf(e.target.value)} autoComplete="new-password" onKeyDown={e=>e.key==='Enter'&&go()}/></div>
    {err&&<div className="er">{err}</div>}
    {ok&&<div className="hb"><Check size={12}/>Password berhasil diganti — gunakan saat login berikutnya.</div>}
    <button className="btn pr" disabled={busy||!cur||!nw} onClick={go}>{busy?<RotateCw size={13} className="sp-anim"/>:<Check size={13}/>} Simpan password</button>
  </div></div>;
}

const el=document.getElementById('root');if(el)createRoot(el).render(<App/>);
