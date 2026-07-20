import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3, Check, ChevronRight, FileText, Folder, Home,
  LucideIcon, Menu, QrCode, Search, Settings, Sparkles, Trash2,
  X, Zap, Image, File, RotateCw, Play, Square, LogOut, Share2,
  Plus, AlertCircle
} from 'lucide-react';
import {
  BarChart as ReBarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import {
  login, logout, getToken, setToken,
  getDocuments,
  startWaha, stopWaha, logoutWaha, getWahaStatus, getWahaQr, getWahaHealth,
  getProviders, createProvider, deleteProvider,
  getSettings, saveSettings, analyzeDocument,
} from './api';
import './styles.css';

// TYPES
type Doc = { id: string; filename: string; sender: string; mime_type: string; status: string; metadata?: any; file_url?: string; url?: string; created_at?: string };
type Provider = { name: string; kind: string; model: string; api_key: string; base_url?: string; active?: boolean };

// =========== APP ===========
function App() {
  const [page, setPage] = useState('Inbox');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [token, setTokenState] = useState(getToken() || '');
  const [flash, setFlashMsg] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [settings, setSettingsState] = useState<any>({});
  const [wahaConnected, setWahaConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const flash = (msg: string) => { setFlashMsg(msg); setTimeout(() => setFlashMsg(''), 2200); };

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    Promise.all([
      getDocuments().then(d => setDocs(d.items || [])).catch(() => {}),
      getSettings().then(s => setSettingsState(s)).catch(() => {}),
      getWahaStatus().then(s => setWahaConnected(s.connected)).catch(() => {}),
      getProviders().then(p => setProviders(p.items || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [token]);

  const refreshDocs = () => getDocuments().then(d => setDocs(d.items || []));
  const doAnalyze = async (id: string) => {
    flash('Analyzing...');
    await analyzeDocument(id).catch(() => {});
    refreshDocs();
    flash('Analyzed!');
  };

  if (!token) return <LoginScreen onLogin={t => { setToken(t); setTokenState(t); }} />;

  const nav = [
    { id: 'Inbox', label: 'Inbox', icon: Home },
    { id: 'Files', label: 'Files', icon: Folder },
    { id: 'Stats', label: 'Stats', icon: BarChart3 },
    { id: 'Settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className={`shell ${sidebarOpen ? 'open' : ''}`}>
      {sidebarOpen && <div className="overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className="sidebar">
        <div className="sb-brand">
          <div className="sb-logo"><Zap size={20} /></div>
          <span>MemoriWA</span>
        </div>
        <nav className="sb-nav">
          {nav.map(n => (
            <button key={n.id} className={`sb-item ${page === n.id ? 'active' : ''}`}
              onClick={() => { setPage(n.id); setSidebarOpen(false); }}>
              <n.icon size={18} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sb-footer">
          <div className={`dot ${wahaConnected ? 'on' : 'off'}`} />
          <span>{wahaConnected ? 'Connected' : 'Offline'}</span>
        </div>
      </aside>

      <div className="main-area">
        <header className="top-bar">
          <button className="menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={20} /></button>
          <b>MemoriWA</b>
          <div className={`dot ${wahaConnected ? 'on' : 'off'}`} style={{ marginLeft: 'auto' }} />
        </header>

        {page === 'Inbox' && <InboxPage docs={docs} onRefresh={refreshDocs} onAnalyze={doAnalyze} />}
        {page === 'Files' && <FilesPage docs={docs} />}
        {page === 'Stats' && <StatsPage docs={docs} />}
        {page === 'Settings' && <SettingsPage settings={settings} providers={providers}
          onSave={async (s: any) => { setSettingsState(await saveSettings(s)); flash('Saved'); }}
          onAdd={async (p: Provider) => { await createProvider(p); setProviders((await getProviders()).items || []); flash('Added'); }}
          onDel={async (n: string) => { await deleteProvider(n); setProviders((await getProviders()).items || []); }}
        />}
      </div>
      {flash && <div className="toast"><Check size={16} /> {flash}</div>}
    </div>
  );
}

// =========== LOGIN ===========
function LoginScreen({ onLogin }: { onLogin: (t: string) => void }) {
  const [u, setU] = useState('admin');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true); setErr('');
    try { const t = await login(u, p); setToken(t); onLogin(t); }
    catch { setErr('Wrong username or password'); }
    setBusy(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo"><Zap size={32} /></div>
        <h1>MemoriWA</h1>
        <p>WhatsApp Document Intelligence</p>
        <input className="input" placeholder="Username" value={u} onChange={e => setU(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
        <input className="input" type="password" placeholder="Password" value={p} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
        {err && <div className="error-text">{err}</div>}
        <button className="btn primary full" onClick={go} disabled={busy}>
          {busy ? <RotateCw size={16} className="spin" /> : 'Sign In'}
        </button>
      </div>
    </div>
  );
}

// =========== INBOX ===========
function InboxPage({ docs, onRefresh, onAnalyze }: { docs: Doc[]; onRefresh: () => void; onAnalyze: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState('All');
  const [sel, setSel] = useState<string[]>([]);

  const filtered = useMemo(() => {
    let d = docs;
    if (f === 'PDF') d = d.filter(x => x.mime_type === 'application/pdf');
    if (f === 'IMAGE') d = d.filter(x => x.mime_type?.startsWith('image/'));
    if (q) d = d.filter(x => x.filename?.toLowerCase().includes(q.toLowerCase()) || x.sender?.includes(q));
    return d;
  }, [docs, q, f]);

  return (
    <div className="page">
      <div className="metrics">
        <div className="metric"><span className="m-n green">{docs.length}</span><span className="m-l">Total</span></div>
        <div className="metric"><span className="m-n gray">{docs.filter(d => d.status === 'unanalyzed').length}</span><span className="m-l">Pending</span></div>
        <div className="metric"><span className="m-n teal">{docs.filter(d => d.status === 'analyzed').length}</span><span className="m-l">Analyzed</span></div>
        <div className="metric"><span className="m-n red">{docs.filter(d => d.status === 'failed').length}</span><span className="m-l">Failed</span></div>
      </div>

      <div className="bar">
        <div className="search-box">
          <Search size={15} />
          <input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="chips">
          {['All','PDF','IMAGE'].map(x => <button key={x} className={`chip ${f===x?'active':''}`} onClick={()=>setF(x)}>{x}</button>)}
        </div>
        <button className="btn small" onClick={onRefresh}><RotateCw size={13} /></button>
        {sel.length > 0 && <button className="btn accent" onClick={()=>{sel.forEach(onAnalyze);setSel([]);}}><Sparkles size={13}/> Analyze ({sel.length})</button>}
      </div>

      <div className="card">
        <div className="card-hd"><b>Documents ({filtered.length})</b></div>
        {filtered.length === 0 ? (
          <div className="empty"><FileText size={32}/><b>No documents</b><p>Send a file or image to your WhatsApp.</p></div>
        ) : filtered.map(d => <DocRow key={d.id} doc={d} sel={sel} onSel={()=>setSel(s=>s.includes(d.id)?s.filter(x=>x!==d.id):[...s,d.id])} onAz={()=>onAnalyze(d.id)} />)}
      </div>
    </div>
  );
}

// =========== DOC ROW ===========
function DocRow({ doc, sel, onSel, onAz }: { doc: Doc; sel: string[]; onSel: () => void; onAz: () => void }) {
  const [open, setOpen] = useState(false);
  const isImg = doc.mime_type?.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(doc.filename||'');
  const isPdf = doc.mime_type === 'application/pdf';
  const api = (import.meta.env.VITE_API_URL || '');
  const previewUrl = api + '/api/files/' + doc.id + '/raw';

  const sc: Record<string,string> = { unanalyzed:'#999', processing:'#f59e0b', analyzed:'#00d4aa', failed:'#f2504b' };

  return (
    <div className="dr-wrap">
      <div className="dr" onClick={()=>setOpen(!open)}>
        <input type="checkbox" checked={sel.includes(doc.id)} onChange={e=>{e.stopPropagation();onSel();}} onClick={e=>e.stopPropagation()} />
        <div className="dr-icon">{isImg?<Image size={17}/>:isPdf?<File size={17}/>:<FileText size={17}/>}</div>
        <div className="dr-info">
          <div className="dr-name">{doc.filename||'Untitled'}</div>
          <div className="dr-meta">{doc.sender} · {doc.created_at?new Date(doc.created_at).toLocaleDateString():''}</div>
        </div>
        <span className="dr-status" style={{background:(sc[doc.status]||'#999')+'18',color:sc[doc.status]||'#999',borderColor:sc[doc.status]||'#999'}}>{doc.status}</span>
        <button className="btn-icon" onClick={e=>{e.stopPropagation();onAz();}}><Sparkles size={13}/></button>
        <ChevronRight size={15} className={`dr-chev ${open?'rot':''}`}/>
      </div>
      {open && (
        <div className="dr-preview">
          <div className="dr-pv-grid">
            <div className="dr-pv-info">
              <b>{doc.filename}</b>
              <div className="info-row"><span>Type:</span> {doc.mime_type||'?'}</div>
              <div className="info-row"><span>From:</span> {doc.sender}</div>
              <div className="info-row"><span>Size:</span> {doc.metadata?.size?(doc.metadata.size/1024).toFixed(1)+' KB':'?'}</div>
            </div>
            {isImg && <div className="dr-pv-media"><img src={previewUrl} alt={doc.filename} className="pv-img" onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/></div>}
            {isPdf && <div className="dr-pv-media pdf"><File size={32}/><b>PDF</b><span>Document</span></div>}
            {!isImg && !isPdf && <div className="dr-pv-media doc"><FileText size={32}/><b>File</b><span>{doc.mime_type}</span></div>}
          </div>
          <div className="dr-pv-actions">
            <button className="btn small" onClick={onAz}><Sparkles size={12}/> Analyze</button>
            <a className="btn small" href={previewUrl} target="_blank" rel="noopener"><Share2 size={12}/> Open</a>
          </div>
        </div>
      )}
    </div>
  );
}

// =========== FILES ===========
function FilesPage({ docs }: { docs: Doc[] }) {
  return (
    <div className="page">
      <div className="metrics">
        <div className="metric"><span className="m-n teal">{docs.filter(d=>d.status==='analyzed').length}</span><span className="m-l">Analyzed</span></div>
        <div className="metric"><span className="m-n gray">{docs.filter(d=>d.status==='unanalyzed').length}</span><span className="m-l">Pending</span></div>
      </div>
      <div className="card">
        <div className="card-hd"><b>All Files ({docs.length})</b></div>
        {docs.length===0?<div className="empty"><Folder size={32}/><b>Empty</b><p>Analyze files to see them here.</p></div>
        : docs.slice(0,20).map(d=><div key={d.id} className="file-row"><FileText size={15}/><span className="flex-1">{d.filename}</span><span className="muted text-xs">{d.sender}</span><ChevronRight size={13}/></div>) }
      </div>
    </div>
  );
}

// =========== STATS ===========
function StatsPage({ docs }: { docs: Doc[] }) {
  const statusData = ['unanalyzed','processing','analyzed','failed'].map(s=>({name:s,count:docs.filter(d=>d.status===s).length}));
  const typeData = ['image','pdf','other'].map(t=>({name:t,count:docs.filter(d=>t==='image'?d.mime_type?.startsWith('image/'):t==='pdf'?d.mime_type==='application/pdf':!d.mime_type?.startsWith('image/')&&d.mime_type!=='application/pdf').length}));
  const COLS = ['#aaa','#f59e0b','#00d4aa','#f2504b'];

  return (
    <div className="page">
      <div className="metrics">
        <div className="metric"><span className="m-n green">{docs.length}</span><span className="m-l">Total</span></div>
        <div className="metric"><span className="m-n teal">{docs.filter(d=>d.status==='analyzed').length}</span><span className="m-l">Done</span></div>
        <div className="metric"><span className="m-n">{docs.filter(d=>d.mime_type?.startsWith('image/')).length}</span><span className="m-l">Images</span></div>
        <div className="metric"><span className="m-n red">{docs.filter(d=>d.mime_type==='application/pdf').length}</span><span className="m-l">PDFs</span></div>
      </div>
      <div className="charts">
        <div className="card"><div className="card-hd"><b>Status</b></div>
          <ResponsiveContainer width="100%" height={200}><ReBarChart data={statusData}><CartesianGrid stroke="#eee" strokeDasharray="4 4"/><XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Bar dataKey="count" stroke="#111" strokeWidth={2} radius={[4,4,0,0]}>{statusData.map((_,i)=><Cell key={i} fill={COLS[i]}/>)}</Bar></ReBarChart></ResponsiveContainer>
        </div>
        <div className="card"><div className="card-hd"><b>Types</b></div>
          <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={typeData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={65} stroke="#111" strokeWidth={2}>{typeData.map((_,i)=><Cell key={i} fill={COLS[i+1]||COLS[0]}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// =========== SETTINGS ===========
function SettingsPage({ settings, providers, onSave, onAdd, onDel }: any) {
  const [tab, setTab] = useState('connect');
  const [loc, setLoc] = useState(settings||{});

  return (
    <div className="page">
      <div className="tabs">
        {[{id:'connect',label:'Connection'},{id:'general',label:'General'},{id:'ai',label:'AI Providers'}].map(t=>(
          <button key={t.id} className={`tab ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab==='connect' && <ConnectPanel />}
      {tab==='general' && <div className="card"><div className="card-hd"><b>General</b></div>
        <div className="p-4 space-y-3">
          <Fld label="Webhook Secret" val={loc.webhook_secret||''} onChange={v=>setLoc({...loc,webhook_secret:v})} />
          <Fld label="Retention (days)" val={loc.retention_days||'90'} onChange={v=>setLoc({...loc,retention_days:v})} />
          <button className="btn primary" onClick={()=>onSave(loc)}>Save</button>
        </div></div>}

      {tab==='ai' && <AiPanel providers={providers} onAdd={onAdd} onDel={onDel} />}
    </div>
  );
}

function ConnectPanel() {
  const [status, setStatus] = useState<'loading'|'ok'|'err'>('loading');
  const [connected, setConn] = useState(false);
  const [qr, setQr] = useState('');
  const [qrBusy, setQrBusy] = useState(false);
  const [health, setHealth] = useState<any>(null);

  const refresh = async () => {
    try { const s = await getWahaStatus(); setConn(s.connected); setStatus('ok'); setHealth(await getWahaHealth()); }
    catch { setStatus('err'); }
  };
  useEffect(() => { refresh(); }, []);

  return (
    <div className="card"><div className="card-hd"><b>WhatsApp Connection</b></div>
      <div className="p-4 space-y-4">
        <div className="conn-row">
          <div className={`dot ${connected?'on':'off'}`} />
          <b>{connected?'Connected':'Not Connected'}</b>
          {health?.ok && <span className="health-ok"><Check size={12}/>WAHA Online</span>}
        </div>
        <div className="flex gap-2">
          {!connected ? <>
            <button className="btn primary" onClick={async ()=>{setStatus('loading');await startWaha();refresh();}}><Play size={13}/> Start</button>
            <button className="btn" disabled={qrBusy} onClick={async ()=>{setQrBusy(true);try{const q=await getWahaQr();setQr(q?.qr||'');}catch{}setQrBusy(false);}}>
              {qrBusy?<RotateCw size={13} className="spin"/>:<QrCode size={13}/>} Show QR
            </button>
          </> : <>
            <button className="btn accent" onClick={async ()=>{await logoutWaha();refresh();setQr('');}}><LogOut size={13}/> Disconnect</button>
            <button className="btn" onClick={async ()=>{await stopWaha();refresh();}}><Square size={13}/> Stop</button>
          </>}
        </div>
        {qr && <div className="qr-box"><img src={`data:image/png;base64,${qr}`} alt="QR" className="qr-img"/><p>Scan with WhatsApp → Linked Devices</p></div>}
      </div></div>
  );
}

function AiPanel({ providers, onAdd, onDel }: { providers: Provider[]; onAdd: (p:Provider)=>void; onDel: (n:string)=>void }) {
  const [kind, setKind] = useState('openai');
  const [model, setModel] = useState('gpt-4o');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [show, setShow] = useState(false);

  const presets: Record<string,{label:string;models:string[];url:string}> = {
    openai:{label:'OpenAI',models:['gpt-4o','gpt-4o-mini','gpt-3.5-turbo'],url:''},
    anthropic:{label:'Anthropic',models:['claude-sonnet-4','claude-3-5-haiku'],url:''},
    deepseek:{label:'DeepSeek',models:['deepseek-chat','deepseek-reasoner'],url:''},
    gemini:{label:'Gemini',models:['gemini-2.5-pro','gemini-2.5-flash'],url:''},
    groq:{label:'Groq',models:['llama-3-70b','mixtral-8x7b'],url:''},
    ollama:{label:'Ollama',models:['llama3','mistral'],url:'http://localhost:11434'},
    openrouter:{label:'OpenRouter',models:['openai/gpt-4o','anthropic/claude-sonnet-4'],url:'https://openrouter.ai/api/v1'},
    custom:{label:'Custom',models:[''],url:''},
  };

  return (
    <div className="space-y-4">
      <div className="card"><div className="card-hd"><b>AI Providers ({providers.length})</b>
        <button className="btn small" onClick={()=>setShow(!show)}><Plus size={13}/> {show?'Cancel':'Add'}</button></div>
        {show && <div className="p-4 border-b-2 space-y-3">
          <div className="grid-2">
            <Fld label="Provider" val={kind} onChange={v=>{setKind(v as string);setModel(presets[v]?.models[0]||'');setBaseUrl(presets[v]?.url||'');}} select options={Object.keys(presets).map(k=>({value:k,label:presets[k].label}))}/>
            <Fld label="Model" val={model} onChange={setModel} select options={presets[kind]?.models.map(m=>({value:m,label:m}))||[]}/>
          </div>
          <Fld label="API Key" val={apiKey} onChange={setApiKey} password />
          {baseUrl && <Fld label="Base URL" val={baseUrl} onChange={setBaseUrl}/>}
          <button className="btn primary" onClick={()=>{if(!apiKey)return;onAdd({name:`${kind}-${Date.now()}`,kind,model,api_key:apiKey,base_url:baseUrl||'',active:true});setApiKey('');setShow(false);}}><Plus size={13}/> Add</button>
        </div>}
        {providers.length===0?<div className="empty"><Settings size={32}/><b>No providers</b><p>Add at least one.</p></div>
        : providers.map(p=><div key={p.name} className="prov-row"><div><b>{p.kind}</b><span className="muted ml-2 text-xs">{p.model}</span></div><div className="flex gap-2"><span className={`badge ${p.active?'on':'off'}`}>{p.active?'Active':'Off'}</span><button className="btn-icon" onClick={()=>onDel(p.name)}><Trash2 size={13}/></button></div></div>)}
      </div>
    </div>
  );
}

function Fld({ label, val, onChange, select, options, password }: { label: string; val: string; onChange: (v: string) => void; select?: boolean; options?: {value:string;label:string}[]; password?: boolean }) {
  return <div className="field"><label>{label}</label>
    {select && options ? <select className="input" value={val} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
    : <input className="input" type={password?'password':'text'} value={val} onChange={e=>onChange(e.target.value)} />}
  </div>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
