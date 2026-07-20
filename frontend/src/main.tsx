import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, Check, ChevronRight, FileText, Folder, Home, Menu, QrCode, Search, Settings, Sparkles, Trash2, Zap, Image, FileIcon, RotateCw, Play, Square, LogOut, Share2, Plus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import {
  login, getToken, setToken, getDocuments,
  startWahaSession as startWaha, stopWahaSession as stopWaha, deleteWahaSession as logoutWaha, getWahaSessionStatus as getWahaStatus, getWahaQR as getWahaQr, getWahaHealth,
  getProviders, createProvider, deleteProvider,
  getSettings, saveSettings, analyzeDocument,
} from './api';
import './styles.css';

type Doc = { id:string; filename:string; sender:string; mime_type:string; status:string; metadata?:any; file_url?:string; url?:string; created_at?:string };
type Prov = { name:string; kind:string; model:string; api_key:string; base_url?:string; active?:boolean };
const SC: Record<string,string> = { unanalyzed:'#999', processing:'#f59e0b', analyzed:'#00d4aa', failed:'#f2504b' };
const API_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || '';

/* ========== APP ========== */
function App() {
  const [pg,sp] = useState('Inbox');
  const [sb,ssb] = useState(false);
  const [docs,sd] = useState<Doc[]>([]);
  const [tok,st] = useState(getToken()||'');
  const [msg,sm] = useState('');
  const [pv,spv] = useState<Prov[]>([]);
  const [sett,ssett] = useState<any>({});
  const [wc,swc] = useState(false);

  const flash = (s:string) => { sm(s); setTimeout(() => sm(''), 2200); };
  const load = useCallback(async () => {
    try { sd((await getDocuments({limit:50})).items||[]); } catch {}
    try { ssett(await getSettings()); } catch {}
    try { swc((await getWahaStatus('default')).connected); } catch {}
    try { spv((await getProviders()).items||[]); } catch {}
  }, []);
  useEffect(() => { if (tok) load(); }, [tok, load]);

  const rf = () => getDocuments({limit:50}).then(d => sd(d.items||[]));
  const az = async (id:string) => { flash('Analyzing...'); await analyzeDocument(id).catch(()=>{}); rf(); flash('Done!'); };

  if (!tok) return <Login onLogin={(t:string) => { setToken(t); st(t); }} />;

  const nav = [
    { id:'Inbox', l:'Inbox', i:Home },
    { id:'Files', l:'Files', i:Folder },
    { id:'Stats', l:'Stats', i:BarChart3 },
    { id:'Settings', l:'Settings', i:Settings },
  ];

  return (
    <div className={`shell ${sb?'open':''}`}>
      {sb && <div className="overlay" onClick={() => ssb(false)} />}
      <aside className="sidebar">
        <div className="sb-br"><div className="sb-lo"><Zap size={20} /></div><span>MemoriWA</span></div>
        <nav className="sb-nav">
          {nav.map(n => (
            <button key={n.id} className={`sb-it ${pg===n.id?'on':''}`} onClick={() => { sp(n.id); ssb(false); }}>
              <n.i size={18} /><span>{n.l}</span>
            </button>
          ))}
        </nav>
        <div className="sb-ft"><div className={`dot ${wc?'on':'off'}`} /><span>{wc?'Connected':'Offline'}</span></div>
      </aside>
      <div className="mc">
        <header className="tb-top">
          <button className="mu" onClick={() => ssb(!sb)}><Menu size={20} /></button>
          <b>MemoriWA</b>
          <div className={`dot ${wc?'on':'off'}`} style={{ marginLeft:'auto' }} />
        </header>
        {pg==='Inbox' && <InboxPage docs={docs} rf={rf} az={az} />}
        {pg==='Files' && <FilesPage docs={docs} />}
        {pg==='Stats' && <StatsPage docs={docs} />}
        {pg==='Settings' && <SettingsPage sett={sett} pv={pv}
          onSave={async (s:any) => { ssett(await saveSettings(s)); flash('Saved'); }}
          onAdd={async (p:Prov) => { await createProvider(p); spv((await getProviders()).items||[]); flash('Added'); }}
          onDel={async (n:string) => { await deleteProvider(n); spv((await getProviders()).items||[]); }}
        />}
      </div>
      {msg && <div className="toast"><Check size={16} /> {msg}</div>}
    </div>
  );
}

/* ========== LOGIN ========== */
function Login({ onLogin }: { onLogin: (t:string) => void }) {
  const [u,su] = useState('admin');
  const [p,sp] = useState('');
  const [e,se] = useState('');
  const [b,sb] = useState(false);
  const go = async () => { sb(true); se(''); try { const t = await login(u,p); setToken(t); onLogin(t); } catch { se('Wrong credentials'); } sb(false); };
  return (
    <div className="lg-wrap"><div className="lg-card"><div className="lg-ic"><Zap size={32} /></div>
      <h1>MemoriWA</h1><p>WhatsApp Document Intelligence</p>
      <input className="inp" placeholder="Username" value={u} onChange={e => su(e.target.value)} onKeyDown={e => e.key==='Enter' && go()} autoFocus />
      <input className="inp" type="password" placeholder="Password" value={p} onChange={e => sp(e.target.value)} onKeyDown={e => e.key==='Enter' && go()} />
      {e && <div className="er">{e}</div>}
      <button className="btn pr fu" onClick={go} disabled={b}>{b ? <RotateCw size={16} className="sp-anim" /> : 'Sign In'}</button>
    </div></div>
  );
}

/* ========== INBOX ========== */
function InboxPage({ docs, rf, az }: { docs:Doc[]; rf:()=>void; az:(id:string)=>void }) {
  const [q,sq] = useState('');
  const [f,sf] = useState('All');
  const [sel,ssel] = useState<string[]>([]);
  const fd = React.useMemo(() => {
    let d = docs;
    if (f==='PDF') d = d.filter(x => x.mime_type==='application/pdf');
    if (f==='IMAGE') d = d.filter(x => x.mime_type?.startsWith('image/'));
    if (q) d = d.filter(x => x.filename?.toLowerCase().includes(q.toLowerCase()) || x.sender?.includes(q));
    return d;
  }, [docs,q,f]);
  const toggle = (id:string) => ssel(s => s.includes(id) ? s.filter(x => x!==id) : [...s,id]);
  const azAll = () => { sel.forEach(az); ssel([]); };

  return (
    <div className="pg">
      <div className="mx">
        <M n={docs.length} l="Total" c="#c8f31d" />
        <M n={docs.filter(d => d.status==='unanalyzed').length} l="Pending" c="#999" />
        <M n={docs.filter(d => d.status==='analyzed').length} l="Done" c="#00d4aa" />
        <M n={docs.filter(d => d.status==='failed').length} l="Failed" c="#f2504b" />
      </div>
      <div className="br">
        <div className="sbx"><Search size={15} /><input placeholder="Search..." value={q} onChange={e => sq(e.target.value)} /></div>
        <div className="cs">{['All','PDF','IMAGE'].map(x => <button key={x} className={`ch ${f===x?'on':''}`} onClick={() => sf(x)}>{x}</button>)}</div>
        <button className="btn sm" onClick={rf}><RotateCw size={13} /></button>
        {sel.length > 0 && <button className="btn ac" onClick={azAll}><Sparkles size={13} /> Analyze ({sel.length})</button>}
      </div>
      <div className="cd">
        <div className="cd-hd"><b>Documents ({fd.length})</b></div>
        {fd.length===0 ? <div className="em"><FileText size={32} /><b>No documents</b><p>Send a file or image to your WhatsApp.</p></div>
          : fd.map(d => <DocRow key={d.id} doc={d} sel={sel} toggle={toggle} az={() => az(d.id)} />)}
      </div>
    </div>
  );
}

function M({ n, l, c }: { n:number; l:string; c:string }) {
  return <div className="mt"><span className="mt-n" style={{ color:c }}>{n}</span><span className="mt-l">{l}</span></div>;
}

/* ========== DOC ROW ========== */
function DocRow({ doc, sel, toggle, az }: { doc:Doc; sel:string[]; toggle:(id:string)=>void; az:()=>void }) {
  const [o,so] = useState(false);
  const im = doc.mime_type?.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(doc.filename||'');
  const pd = doc.mime_type==='application/pdf';
  const pv = API_URL + '/api/files/' + doc.id + '/raw';
  const cl = SC[doc.status] || '#999';

  return (
    <div className="dw">
      <div className="dr" onClick={() => so(!o)}>
        <input type="checkbox" checked={sel.includes(doc.id)} onChange={e => { e.stopPropagation(); toggle(doc.id); }} onClick={e => e.stopPropagation()} />
        <div className="di">{im ? <Image size={17} /> : pd ? <FileIcon size={17} /> : <FileText size={17} />}</div>
        <div className="dn"><div className="dnm">{doc.filename||'Untitled'}</div><div className="dnt">{doc.sender} · {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ''}</div></div>
        <span className="ds" style={{ background:cl+'18', color:cl, borderColor:cl }}>{doc.status}</span>
        <button className="bi" onClick={e => { e.stopPropagation(); az(); }}><Sparkles size={13} /></button>
        <ChevronRight size={15} className={`dc ${o?'rt':''}`} />
      </div>
      {o && (
        <div className="dp">
          <div className="dg">
            <div className="dp-info">
              <b>{doc.filename}</b>
              <div className="ir"><span>Type:</span> {doc.mime_type||'?'}</div>
              <div className="ir"><span>From:</span> {doc.sender}</div>
              <div className="ir"><span>Size:</span> {doc.metadata?.size ? (doc.metadata.size/1024).toFixed(1)+' KB' : '?'}</div>
            </div>
            {im && <div className="pm"><img src={pv} alt={doc.filename} className="pi" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} /></div>}
            {pd && <div className="pm pf"><FileIcon size={32} /><b>PDF</b><span>Document</span></div>}
            {!im && !pd && <div className="pm pfc"><FileText size={32} /><b>File</b><span>{doc.mime_type}</span></div>}
          </div>
          <div className="pa">
            <button className="btn sm" onClick={az}><Sparkles size={12} /> Analyze</button>
            <a className="btn sm" href={pv} target="_blank" rel="noopener"><Share2 size={12} /> Open</a>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== FILES ========== */
function FilesPage({ docs }: { docs:Doc[] }) {
  return (
    <div className="pg">
      <div className="mx">
        <M n={docs.filter(d => d.status==='analyzed').length} l="Analyzed" c="#00d4aa" />
        <M n={docs.filter(d => d.status==='unanalyzed').length} l="Pending" c="#999" />
      </div>
      <div className="cd">
        <div className="cd-hd"><b>All Files ({docs.length})</b></div>
        {docs.length===0 ? <div className="em"><Folder size={32} /><b>Empty</b><p>Analyze files to see them here.</p></div>
          : docs.slice(0,20).map(d => <div key={d.id} className="fr"><FileText size={15} /><span className="f1">{d.filename}</span><span className="mu xs">{d.sender}</span><ChevronRight size={13} /></div>)}
      </div>
    </div>
  );
}

/* ========== STATS ========== */
function StatsPage({ docs }: { docs:Doc[] }) {
  const sd = ['unanalyzed','processing','analyzed','failed'].map(s => ({ name:s, count:docs.filter(d => d.status===s).length }));
  const td = ['image','pdf','other'].map(t => ({ name:t, count:docs.filter(d => t==='image'?d.mime_type?.startsWith('image/'):t==='pdf'?d.mime_type==='application/pdf':!d.mime_type?.startsWith('image/')&&d.mime_type!=='application/pdf').length }));
  const COLS = ['#aaa','#f59e0b','#00d4aa','#f2504b'];

  return (
    <div className="pg">
      <div className="mx">
        <M n={docs.length} l="Total" c="#c8f31d" />
        <M n={docs.filter(d => d.status==='analyzed').length} l="Done" c="#00d4aa" />
        <M n={docs.filter(d => d.mime_type?.startsWith('image/')).length} l="Images" c="#f59e0b" />
        <M n={docs.filter(d => d.mime_type==='application/pdf').length} l="PDFs" c="#f2504b" />
      </div>
      <div className="cs2">
        <div className="cd"><div className="cd-hd"><b>Status</b></div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sd}><CartesianGrid stroke="#eee" strokeDasharray="4 4" /><XAxis dataKey="name" tick={{fontSize:10}} /><YAxis tick={{fontSize:10}} /><Tooltip />
              <Bar dataKey="count" stroke="#111" strokeWidth={2} radius={[4,4,0,0]}>{sd.map((_,i) => <Cell key={i} fill={COLS[i]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="cd"><div className="cd-hd"><b>Types</b></div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart><Pie data={td} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={65} stroke="#111" strokeWidth={2}>
              {td.map((_,i) => <Cell key={i} fill={COLS[i+1]||COLS[0]} />)}</Pie><Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/* ========== SETTINGS ========== */
function SettingsPage({ sett, pv, onSave, onAdd, onDel }: any) {
  const [tab,st] = useState('connect');
  const [loc,sl] = useState(sett||{});
  const TABS = [{id:'connect',l:'Connection'},{id:'general',l:'General'},{id:'ai',l:'AI'}];

  return (
    <div className="pg">
      <div className="tbs">
        {TABS.map(t => <button key={t.id} className={`tb-btn ${tab===t.id?'on':''}`} onClick={() => st(t.id)}>{t.l}</button>)}
      </div>
      {tab==='connect' && <ConnectTab />}
      {tab==='general' && <div className="cd"><div className="cd-hd"><b>General</b></div>
        <div className="p4 s3">
          <FL label="Webhook Secret" val={loc.webhook_secret||''} onChange={(v:string) => sl({...loc,webhook_secret:v})} />
          <FL label="Retention (days)" val={loc.retention_days||'90'} onChange={(v:string) => sl({...loc,retention_days:v})} />
          <button className="btn pr" onClick={() => onSave(loc)}>Save</button>
        </div></div>}
      {tab==='ai' && <AITab pv={pv} onAdd={onAdd} onDel={onDel} />}
    </div>
  );
}

/* ========== CONNECT ========== */
function ConnectTab() {
  const [c,sc] = useState(false);
  const [qr,sq] = useState('');
  const [qb,sqb] = useState(false);
  const [h,sh] = useState<any>(null);
  const rf = async () => { try { sc((await getWahaStatus('default')).connected); sh(await getWahaHealth()); } catch {} };
  useEffect(() => { rf(); }, []);

  return (
    <div className="cd"><div className="cd-hd"><b>WhatsApp Connection</b></div>
      <div className="p4 s4">
        <div className="fl aic g2"><div className={`dot ${c?'on':'off'}`} /><b>{c?'Connected':'Not Connected'}</b>{h?.ok && <span className="hb"><Check size={12} />Online</span>}</div>
        <div className="fl g2">
          {!c ? (<>
            <button className="btn pr" onClick={async () => { await startWaha('default'); rf(); }}><Play size={13} /> Start</button>
            <button className="btn" disabled={qb} onClick={async () => { sqb(true); try { sq((await getWahaQr('default')).qr||''); } catch {} sqb(false); }}>
              {qb ? <RotateCw size={13} className="sp-anim" /> : <QrCode size={13} />} Show QR
            </button>
          </>) : (<>
            <button className="btn ac" onClick={async () => { await logoutWaha('default'); rf(); sq(''); }}><LogOut size={13} /> Disconnect</button>
            <button className="btn" onClick={async () => { await stopWaha('default'); rf(); }}><Square size={13} /> Stop</button>
          </>)}
        </div>
        {qr && <div className="qw"><img src={`data:image/png;base64,${qr}`} alt="QR" className="qi" /><p>Scan with WhatsApp → Linked Devices</p></div>}
      </div></div>
  );
}

/* ========== AI ========== */
function AITab({ pv, onAdd, onDel }: { pv:Prov[]; onAdd:(p:Prov)=>void; onDel:(n:string)=>void }) {
  const [k,sk] = useState('openai');
  const [m,sm] = useState('gpt-4o');
  const [a,sa] = useState('');
  const [u,su] = useState('');
  const [s,ss] = useState(false);

  const PRESETS: Record<string,{l:string;ms:string[];u:string}> = {
    openai:{l:'OpenAI',ms:['gpt-4o','gpt-4o-mini'],u:''},
    anthropic:{l:'Anthropic',ms:['claude-sonnet-4','claude-3-5-haiku'],u:''},
    deepseek:{l:'DeepSeek',ms:['deepseek-chat','deepseek-reasoner'],u:''},
    gemini:{l:'Gemini',ms:['gemini-2.5-pro','gemini-2.5-flash'],u:''},
    groq:{l:'Groq',ms:['llama-3-70b','mixtral-8x7b'],u:''},
    ollama:{l:'Ollama',ms:['llama3','mistral'],u:'http://localhost:11434'},
    openrouter:{l:'OpenRouter',ms:['openai/gpt-4o','anthropic/claude-sonnet-4'],u:'https://openrouter.ai/api/v1'},
    custom:{l:'Custom',ms:[''],u:''},
  };

  const add = () => { if(!a)return; onAdd({name:`${k}-${Date.now()}`,kind:k,model:m,api_key:a,base_url:u||'',active:true}); sa(''); ss(false); };

  return (
    <div className="cd">
      <div className="cd-hd"><b>AI Providers ({pv.length})</b><button className="btn sm" onClick={() => ss(!s)}><Plus size={13} />{s?'Cancel':'Add'}</button></div>
      {s && <div className="p4 b2 s3">
        <div className="g2">
          <FL label="Provider" val={k} onChange={(v:string) => { sk(v); sm(PRESETS[v]?.ms[0]||''); su(PRESETS[v]?.u||''); }} sl opts={Object.keys(PRESETS).map(x => ({v:x,l:PRESETS[x].l}))} />
          <FL label="Model" val={m} onChange={(v:string) => sm(v)} sl opts={(PRESETS[k]?.ms||[]).map(x => ({v:x,l:x}))} />
        </div>
        <FL label="API Key" val={a} onChange={(v:string) => sa(v)} pw />
        {u && <FL label="Base URL" val={u} onChange={(v:string) => su(v)} />}
        <button className="btn pr" onClick={add}><Plus size={13} />Add</button>
      </div>}
      {pv.length===0 ? <div className="em"><Settings size={32} /><b>No providers</b><p>Add at least one.</p></div>
        : pv.map(p => <div key={p.name} className="pr-row">
          <div><b>{p.kind}</b><span className="ml2 xs mu">{p.model}</span></div>
          <div className="fl g2"><span className={`bd ${p.active?'on':'off'}`}>{p.active?'Active':'Off'}</span><button className="bi" onClick={() => onDel(p.name)}><Trash2 size={13} /></button></div>
        </div>)}
    </div>
  );
}

/* ========== FL ========== */
function FL({ label, val, onChange, sl, opts, pw }: { label:string; val:string; onChange:(v:string)=>void; sl?:boolean; opts?:{v:string;l:string}[]; pw?:boolean }) {
  return (
    <div className="fi">
      <label>{label}</label>
      {sl && opts ? <select className="inp" value={val} onChange={e => onChange(e.target.value)}>{opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
        : <input className="inp" type={pw?'password':'text'} value={val} onChange={e => onChange(e.target.value)} />}
    </div>
  );
}

/* ========== MOUNT ========== */
const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
