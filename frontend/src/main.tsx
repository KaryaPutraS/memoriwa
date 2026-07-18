import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, Archive, BarChart3, Bell, Check, ChevronRight, FileText,
  Folder, Inbox, Key, LayoutDashboard, LogOut, Menu, MoreHorizontal,
  Paperclip, Plus, Search, Settings, Shield, SlidersHorizontal,
  Sparkles, Trash2, Upload, Users, X,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import './styles.css';
import {
  login as apiLogin, logout as apiLogout, getToken,
  getDocuments, getDocument, deleteDocument,
  analyzeDocument, analyzeAll, getStats,
  getSettings, saveSettings, testWahaConnection,
  getProviders, createProvider, updateProvider, deleteProvider,
  connectWebSocket,
} from './api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Doc = {
  id: string; filename: string; sender: string; mime_type: string;
  status: string; created_at: string; metadata?: any; source?: string; url?: string;
};

type Provider = {
  id?: string; name: string; base_url: string; model: string; api_key?: string;
};

const DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

// Demo mock data
const DEMO_DOCS: Doc[] = [
  { id: '1', filename: 'invoice_alfamart_0626.pdf', sender: '62812 4421 9088', mime_type: 'PDF', status: 'analyzed', created_at: new Date(Date.now() - 120000).toISOString(), metadata: { tag: 'Invoice' } },
  { id: '2', filename: 'KTP_Budi_Santoso.jpg', sender: '62813 9082 1102', mime_type: 'IMAGE', status: 'processing', created_at: new Date(Date.now() - 480000).toISOString(), metadata: { tag: 'Identity' } },
  { id: '3', filename: 'contract_vendor_final.docx', sender: '62811 7782 8841', mime_type: 'DOCX', status: 'analyzed', created_at: new Date(Date.now() - 3600000).toISOString(), metadata: { tag: 'Contract' } },
  { id: '4', filename: 'receipt_tokopedia.png', sender: '62852 1190 4221', mime_type: 'IMAGE', status: 'failed', created_at: new Date(Date.now() - 7200000).toISOString(), metadata: { tag: 'Receipt' } },
  { id: '5', filename: 'proposal_q3.pdf', sender: '62877 1192 0992', mime_type: 'PDF', status: 'analyzed', created_at: new Date(Date.now() - 10800000).toISOString(), metadata: { tag: 'Proposal' } },
];
const DEMO_STATS = [
  { name: 'Mon', files: 34 }, { name: 'Tue', files: 48 }, { name: 'Wed', files: 39 },
  { name: 'Thu', files: 62 }, { name: 'Fri', files: 55 }, { name: 'Sat', files: 71 }, { name: 'Sun', files: 46 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtSize(mime: string): string {
  if (mime.includes('pdf')) return '2.4 MB';
  if (mime.includes('image')) return '1.1 MB';
  if (mime.includes('word') || mime.includes('doc')) return '845 KB';
  return '—';
}

function fmtTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch { return ''; }
}

function tagFromDoc(d: Doc): string {
  return (d.metadata?.tag) || (d.metadata?.analysis?.category) || d.mime_type?.split('/')[0]?.toUpperCase() || 'File';
}

function extFromMime(m: string): string {
  if (!m) return 'FILE';
  if (m.includes('pdf')) return 'PDF';
  if (m.includes('image')) return 'IMAGE';
  if (m.includes('word') || m.includes('document')) return 'DOCX';
  return m.split('/')[1]?.toUpperCase() || m.toUpperCase();
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [page, setPage] = useState('Inbox');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authed, setAuthed] = useState(!!getToken());
  const [loginErr, setLoginErr] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [docs, setDocs] = useState<Doc[]>(DEMO ? DEMO_DOCS : []);
  const [stats, setStats] = useState<any>(null);
  const [chartStats, setChartStats] = useState(DEMO_STATS);
  const [settings, setSettingsData] = useState<any>({ theme: 'system', language: 'id', auto_analyze: false });
  const [providers, setProvidersData] = useState<Provider[]>([]);
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [toast, setToast] = useState('');

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }, []);

  // Load data on auth
  const loadDocs = useCallback(async () => {
    if (DEMO) return;
    try {
      const d = await getDocuments({ limit: 100 });
      setDocs(d.items);
    } catch { /* ignore */ }
  }, []);
  const loadStats = useCallback(async () => {
    if (DEMO) return;
    try { setStats(await getStats()); } catch { /* ignore */ }
  }, []);
  const loadSettings = useCallback(async () => {
    if (DEMO) return;
    try { setSettingsData(await getSettings()); } catch { /* ignore */ }
  }, []);
  const loadProviders = useCallback(async () => {
    if (DEMO) return;
    try { setProvidersData((await getProviders()).items); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (authed) {
      loadDocs();
      loadStats();
      loadSettings();
      loadProviders();
    }
  }, [authed, loadDocs, loadStats, loadSettings, loadProviders]);

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    if (DEMO || !authed) return;
    connectWebSocket((msg: any) => {
      if (msg.type === 'document.created') {
        setDocs(prev => {
          const exists = prev.find(d => d.id === msg.data.id);
          if (exists) return prev;
          return [msg.data, ...prev];
        });
        loadStats();
      } else if (msg.type === 'document.updated') {
        setDocs(prev => prev.map(d => d.id === msg.data.id ? msg.data : d));
        loadStats();
      }
    }, wsRef);
    return () => { wsRef.current?.close(); };
  }, [authed, loadStats]);

  // Login
  const doLogin = async () => {
    if (DEMO) { setAuthed(true); return; }
    try {
      setLoginErr('');
      await apiLogin(username, password);
      setAuthed(true);
    } catch (e: any) {
      setLoginErr(e.message || 'Login failed');
    }
  };

  const doLogout = () => {
    apiLogout();
    setAuthed(false);
    setDocs([]);
    setStats(null);
  };

  // Actions
  const doAnalyze = async (id: string) => {
    if (DEMO) { flash('Demo mode: analyze queued locally'); return; }
    try {
      await analyzeDocument(id);
      flash('Analysis queued');
      loadDocs();
    } catch { flash('Analysis request failed'); }
  };

  const doAnalyzeAll = async () => {
    if (DEMO) { flash('Demo mode: bulk analyze queued'); return; }
    try {
      const r = await analyzeAll();
      flash(`Queued ${r.queued} document(s)`);
      loadDocs();
    } catch { flash('Analysis request failed'); }
  };

  const filtered = useMemo(() => docs.filter(d => {
    const typeMatch = filter === 'All' || extFromMime(d.mime_type) === filter;
    const queryMatch = !query || `${d.filename} ${d.sender}`.toLowerCase().includes(query.toLowerCase());
    return typeMatch && queryMatch;
  }), [docs, filter, query]);

  // Build metric display values
  const statCounts = stats || { total: docs.length, unanalyzed: 0, processing: 0, analyzed: 0, failed: 0 };

  // Login page
  if (!authed) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#f4f3ee',
      }}>
        <div style={{
          background: '#fff', border: '2px solid #111', boxShadow: '6px 6px #111',
          padding: '40px 36px', maxWidth: 420, width: '100%',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
            <div style={{ background: '#c8f31d', color: '#111', fontWeight: 950, fontSize: 20, padding: '8px 7px', border: '2px solid #111', boxShadow: '3px 3px #111' }}>AP</div>
            <div><b style={{ fontSize: 16, display: 'block' }}>MemoriWA</b><small style={{ color: '#9b9b95', fontSize: 9, letterSpacing: 1.4, fontWeight: 800 }}>Document Intelligence</small></div>
          </div>
          {DEMO && (
            <div style={{ background: '#ffca28', border: '2px solid #111', padding: '8px 12px', marginBottom: 16, fontWeight: 900, fontSize: 11 }}>
              DEMO MODE — click Login to continue
            </div>
          )}
          <input
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doLogin()}
            style={{
              width: '100%', padding: '12px 14px', border: '2px solid #111',
              marginBottom: 10, font: 'inherit', boxSizing: 'border-box',
            }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doLogin()}
            style={{
              width: '100%', padding: '12px 14px', border: '2px solid #111',
              marginBottom: 10, font: 'inherit', boxSizing: 'border-box',
            }}
          />
          {loginErr && (
            <div style={{ color: '#f2504b', fontWeight: 900, marginBottom: 10, fontSize: 12 }}>
              {loginErr}
            </div>
          )}
          <button
            onClick={doLogin}
            style={{
              width: '100%', background: '#c8f31d', border: '2px solid #111',
              padding: '13px', fontWeight: 900, cursor: 'pointer',
              boxShadow: '3px 3px #111', font: 'inherit',
            }}
          >
            Login
          </button>
        </div>
      </div>
    );
  }

  // Main app
  return (
    <div className="app">
      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen?' open':''}`}>
        <div className="brand">
          <div className="brandmark">AP</div>
          <div><b>MemoriWA</b><small>Document Intelligence</small></div>
        </div>
        <nav>
          {([
            ['Dashboard', LayoutDashboard],
            ['Inbox', Inbox],
            ['File Manager', Folder],
            ['Stats', BarChart3],
            ['Settings', Settings],
          ] as const).map(([n, I]) => (
            <button
              className={page === n ? 'active' : ''}
              onClick={() => setPage(n)}
              key={n}
            >
              <I size={19} />{n}
              {n === 'Inbox' && <em>{statCounts.unanalyzed || statCounts.total}</em>}
            </button>
          ))}
        </nav>
        <div className="connection">
          <span className="dot" /> {DEMO ? 'DEMO' : 'API'} CONNECTED
          <small>Realtime sync on</small>
        </div>
        <div className="user" style={{ cursor: 'pointer' }} onClick={doLogout}>
          <div className="avatar">AK</div>
          <span><b>Admin</b><small>Administrator</small></span>
          <LogOut size={18} />
        </div>
      </aside>

      {/* Mobile overlay to close sidebar */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <main>
        <header>
          <button className="mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu /></button>
          <div>
            <span className="eyebrow">WORKSPACE / {page.toUpperCase()}</span>
            <h1>{page}</h1>
          </div>
          <div className="head-actions">
            <button className="icon"><Bell size={19} /><i /></button>
            {page === 'Inbox' && (
              <button className="button yellow" onClick={doAnalyzeAll}>
                <Sparkles size={16} /> Analyze all
              </button>
            )}
          </div>
        </header>

        {page === 'Inbox' && (
          <InboxPage
            filtered={filtered} filter={filter} setFilter={setFilter}
            query={query} setQuery={setQuery}
            selected={selected} setSelected={setSelected}
            analyze={doAnalyze} analyzeAll={doAnalyzeAll}
            stats={statCounts}
          />
        )}
        {page === 'Dashboard' && <Dashboard stats={statCounts} chartStats={chartStats} />}
        {page === 'File Manager' && <Manager docs={docs} />}
        {page === 'Stats' && <StatsPage stats={statCounts} chartStats={chartStats} />}
        {page === 'Settings' && (
          <SettingsPage
            settings={settings}
            providers={providers}
            onSaveSettings={async (s) => {
              if (DEMO) { setSettingsData(s); flash('Settings saved'); return; }
              try { const r = await saveSettings(s); setSettingsData(r); flash('Settings saved'); } catch { flash('Save failed'); }
            }}
            onAddProvider={async (p) => {
              if (DEMO) { setProvidersData(prev => [...prev, p]); flash('Provider added'); return; }
              try { await createProvider(p); loadProviders(); flash('Provider added'); } catch { flash('Add failed'); }
            }}
            onDeleteProvider={async (name) => {
              if (DEMO) { setProvidersData(prev => prev.filter(x => x.name !== name)); flash('Provider deleted'); return; }
              try { await deleteProvider(name); loadProviders(); flash('Provider deleted'); } catch { flash('Delete failed'); }
            }}
          />
        )}

        {toast && (
          <div className="toast"><Check size={17} />{toast}</div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function Metric({ n, label, c }: { n: string | number; label: string; c?: string }) {
  return (
    <div className={`metric ${c || ''}`}>
      <b>{n}</b><span>{label}</span><small>+12.4% ↗</small>
    </div>
  );
}

function InboxPage(p: {
  filtered: Doc[]; filter: string; setFilter: (f: string) => void;
  query: string; setQuery: (q: string) => void;
  selected: string[]; setSelected: (s: string[]) => void;
  analyze: (id: string) => void; analyzeAll: () => void;
  stats: any;
}) {
  return (
    <>
      <section className="metrics">
        <Metric n={p.stats.unanalyzed || p.stats.total || 0} label="New files" c="lime" />
        <Metric n={p.stats.analyzed || 0} label="Processed" />
        <Metric n={p.stats.failed || 0} label="Needs review" c="red" />
        <Metric n="—" label="AI accuracy" c="yellow" />
      </section>
      <section className="toolbar">
        <div className="search">
          <Search size={18} />
          <input placeholder="Search files, senders..." value={p.query} onChange={e => p.setQuery(e.target.value)} />
        </div>
        {['All', 'PDF', 'IMAGE', 'DOCX'].map(x => (
          <button
            className={p.filter === x ? 'chip selected' : 'chip'}
            onClick={() => p.setFilter(x)} key={x}
          >
            {x}
          </button>
        ))}
        <button className="icon"><SlidersHorizontal size={17} /></button>
      </section>
      <section className="table-card">
        <div className="table-head">
          <b>INCOMING FILES <span>{p.filtered.length}</span></b>
          {p.selected.length > 0 && (
            <button className="button red" onClick={() => p.selected.forEach(p.analyze)}>
              <Sparkles size={16} /> Analyze selected ({p.selected.length})
            </button>
          )}
        </div>
        <div className="table">
          {p.filtered.map(d => (
            <div className="row" key={d.id}>
              <input
                type="checkbox"
                checked={p.selected.includes(d.id)}
                onChange={() => p.setSelected(
                  p.selected.includes(d.id)
                    ? p.selected.filter(x => x !== d.id)
                    : [...p.selected, d.id]
                )}
              />
              <div className="fileicon"><FileText size={20} /></div>
              <div className="filename">
                <b>{d.filename}</b>
                <small>{d.sender} · {fmtTime(d.created_at)}</small>
              </div>
              <span className="tag">{tagFromDoc(d)}</span>
              <span className="type">{extFromMime(d.mime_type)} · {fmtSize(d.mime_type)}</span>
              <span className={`status ${d.status.replace(' ', '-').toLowerCase()}`}>
                <i /> {d.status}
              </span>
              <button className="analyze" onClick={() => p.analyze(d.id)}>
                <Sparkles size={15} /> Analyze
              </button>
              <MoreHorizontal size={18} />
            </div>
          ))}
          {p.filtered.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: '#999' }}>
              No documents found. Documents arrive via the webhook or switch to demo mode.
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function Dashboard({ stats, chartStats }: { stats: any; chartStats: any[] }) {
  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">DOCUMENT DASHBOARD</span>
          <h2>Your document brain is<br /><mark>ready for review.</mark></h2>
          <p>{stats?.unanalyzed || 0} new files waiting. Process them from the Inbox.</p>
        </div>
        <div className="hero-art">✦<br /><small>AI<br />READY</small></div>
      </section>
      <StatsPage stats={stats} chartStats={chartStats} />
    </>
  );
}

function StatsPage({ stats, chartStats }: { stats: any; chartStats: any[] }) {
  return (
    <>
      <section className="metrics">
        <Metric n={stats?.total || 0} label="Total files" c="lime" />
        <Metric n="—" label="Extraction rate" />
        <Metric n="—" label="Storage used" c="yellow" />
        <Metric n="24/7" label="Monitoring" c="red" />
      </section>
      <section className="chart-card">
        <div className="table-head">
          <b>FILES PROCESSED <span>LAST 7 DAYS</span></b>
          <span className="live"><i /> LIVE</span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartStats}>
            <CartesianGrid stroke="#ddd" strokeDasharray="4 4" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="files" fill="#c8f31d" stroke="#111" strokeWidth={2} />
          </BarChart>
        </ResponsiveContainer>
      </section>
      {/* Status breakdown */}
      <section className="metrics" style={{ marginTop: 22 }}>
        <div className="metric lime"><b>{stats?.unanalyzed || 0}</b><span>Unanalyzed</span></div>
        <div className="metric yellow"><b>{stats?.processing || 0}</b><span>Processing</span></div>
        <div className="metric"><b>{stats?.analyzed || 0}</b><span>Analyzed</span></div>
        <div className="metric red"><b>{stats?.failed || 0}</b><span>Failed</span></div>
      </section>
    </>
  );
}

function Manager({ docs }: { docs: Doc[] }) {
  return (
    <>
      <div className="manager-head">
        <div className="folderbox"><Folder /> <b>All files</b><small>{docs.length} documents</small></div>
        {['Invoices', 'Identity', 'Contracts', 'Receipts', 'Unsorted'].map(x => (
          <div className="folderbox" key={x}><Folder /><b>{x}</b><small>{Math.floor(Math.random() * 200 + 40)} documents</small></div>
        ))}
      </div>
      <section className="table-card">
        <div className="table-head"><b>RECENT DOCUMENTS</b></div>
        {docs.slice(0, 20).map(d => (
          <div className="row" key={d.id}>
            <div className="fileicon"><FileText size={20} /></div>
            <div className="filename">
              <b>{d.filename}</b><small>{d.sender} · {fmtTime(d.created_at)}</small>
            </div>
            <span className="tag">{tagFromDoc(d)}</span>
            <span className="type">{extFromMime(d.mime_type)} · {fmtSize(d.mime_type)}</span>
            <span className={`status ${d.status.replace(' ', '-').toLowerCase()}`}><i /> {d.status}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function SettingsPage(p: {
  settings: any;
  providers: Provider[];
  onSaveSettings: (s: any) => void;
  onAddProvider: (prov: Provider) => void;
  onDeleteProvider: (name: string) => void;
}) {
  const [s, setS] = useState({ ...p.settings });
  const [tab, setTab] = useState('general');
  const [provForm, setProvForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newModel, setNewModel] = useState('');
  const [presets, setPresets] = useState<any[]>([]);
  const [selPreset, setSelPreset] = useState('');
  const [wahaStatus, setWahaStatus] = useState('');
  const [wahaSess, setWahaSess] = useState<any[]>([]);

  useEffect(() => { setS({ ...p.settings }); }, [p.settings]);
  useEffect(() => {
    if (!DEMO) {
      const t = sessionStorage.getItem('token');
      if (t) fetch((import.meta.env.VITE_API_URL||'')+'/api/provider-presets',{
        headers:{Authorization:'Bearer '+t}
      }).then(r=>r.json()).then(d=>setPresets(d.presets||[])).catch(()=>{});
    }
  }, []);

  const pickPreset=(k:string)=>{
    setSelPreset(k); const pr=presets.find(x=>x.key===k);
    if(pr){setNewName(pr.name);setNewUrl(pr.base_url);setNewModel(pr.models?.[0]||'');setNewKey('');}
  };
  const saveW=async()=>{
    try{await saveSettings(s);setWahaStatus('Saved \u2713')}catch(e:any){setWahaStatus('Error: '+e.message)}
    p.onSaveSettings(s);
  };
  const testW=async()=>{
    await saveW();
    try{const d=await testWahaConnection();setWahaStatus(d.ok?'Connected \u2713 - '+(d.sessions?.length||0)+' sessions':'Failed: '+(d.error||'?'));if(d.sessions)setWahaSess(d.sessions)}catch(e:any){setWahaStatus('Error: '+e.message)}
  };
  const addP=()=>{p.onAddProvider({name:newName,base_url:newUrl,model:newModel,api_key:newKey});setProvForm(false);setNewName('');setNewUrl('');setNewKey('');setNewModel('');setSelPreset('');};

  return (
    <div>
      <div style={{display:'flex',gap:4,marginBottom:18,flexWrap:'wrap'}}>
        {[{key:'general',label:'General'},{key:'waha',label:'WAHA Connection'},{key:'ai',label:'AI Engine'}].map(t=>(
          <button key={t.key} className={tab===t.key?'chip selected':'chip'} onClick={()=>setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab==='general'&&(
        <div className="settings">
          <div className="setting"><div><b>THEME</b><p>Dashboard visual theme</p></div><select value={s.theme||'system'} onChange={e=>setS({...s,theme:e.target.value})} style={{border:'2px solid #111',padding:'8px 12px',font:'inherit',fontWeight:900}}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
          <div className="setting"><div><b>LANGUAGE</b><p>Preferred language</p></div><select value={s.language||'id'} onChange={e=>setS({...s,language:e.target.value})} style={{border:'2px solid #111',padding:'8px 12px',font:'inherit',fontWeight:900}}><option value="id">Bahasa Indonesia</option><option value="en">English</option><option value="auto">Auto-detect</option></select></div>
          <div className="setting"><div><b>AUTO-ANALYZE</b><p>Manual-only for safety</p></div><span style={{color:'#777',fontWeight:900,fontSize:11}}>Disabled</span></div>
          <div className="setting"><div/><button className="button yellow" onClick={()=>p.onSaveSettings(s)}><Check size={16}/>Save</button></div>
        </div>
      )}

      {tab==='waha'&&(
        <div className="settings">
          <div style={{borderBottom:'2px solid #111',padding:'12px 14px',fontWeight:900,fontSize:14}}>WAHA CONNECTION</div>
          <div className="setting"><div><b>BASE URL</b><p>WAHA API endpoint</p></div><input value={s.waha_base_url||''} onChange={e=>setS({...s,waha_base_url:e.target.value})} placeholder="http://localhost:3000" style={{border:'2px solid #111',padding:'9px 12px',font:'inherit',fontWeight:700,width:280}}/></div>
          <div className="setting"><div><b>API KEY</b><p>WAHA auth token</p></div><input type="password" value={s.waha_api_key||''} onChange={e=>setS({...s,waha_api_key:e.target.value})} placeholder="••••••••" style={{border:'2px solid #111',padding:'9px 12px',font:'inherit',fontWeight:700,width:280}}/></div>
          <div className="setting"><div><b>TIMEOUT</b><p>Request timeout (sec)</p></div><input type="number" value={s.waha_timeout||30} onChange={e=>setS({...s,waha_timeout:Number(e.target.value)})} style={{border:'2px solid #111',padding:'9px 12px',font:'inherit',fontWeight:700,width:80}}/></div>
          <div className="setting"><div/><div style={{display:'flex',gap:8}}><button className="button" onClick={saveW}><Check size={15}/>Save</button><button className="button yellow" onClick={testW}><Activity size={15}/>Test Connection</button></div></div>
          {wahaStatus&&<div style={{padding:'8px 16px',margin:'0 14px 14px',border:'2px solid #111',background:wahaStatus.includes('\u2713')?'#d4ffd4':'#ffe0e0',fontWeight:700,fontSize:13}}>{wahaStatus}</div>}
          {wahaSess.length>0&&<div style={{padding:'0 14px 14px'}}><b>SESSIONS ({wahaSess.length})</b>{wahaSess.map((s:any,i:number)=><div key={i} style={{padding:'6px 0',borderBottom:'1px solid #eee',display:'flex',gap:8,alignItems:'center'}}><span style={{width:8,height:8,borderRadius:'50%',background:s.status==='CONNECTED'?'#0f0':'#ccc',display:'inline-block'}}/><b>{s.name||s.id||'Session '+(i+1)}</b><small>{s.status||'?'}</small></div>)}</div>}
        </div>
      )}

      {tab==='ai'&&(
        <div className="settings">
          <div style={{borderBottom:'2px solid #111',padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}><b style={{fontWeight:900,fontSize:14}}>AI PROVIDERS</b><button className="button" onClick={()=>setProvForm(!provForm)}><Plus size={15}/>Add Provider</button></div>
          {provForm&&(
            <div style={{padding:18,borderBottom:'1px solid #ddd'}}>
              <div style={{marginBottom:12}}><small style={{display:'block',fontWeight:900,marginBottom:4}}>SELECT PROVIDER</small><select value={selPreset} onChange={e=>pickPreset(e.target.value)} style={{border:'2px solid #111',padding:'9px 12px',font:'inherit',fontWeight:700,width:280}}><option value="">-- Choose --</option>{presets.map((p:any)=><option key={p.key} value={p.key}>{p.name}</option>)}</select></div>
              {selPreset&&presets.find(p=>p.key===selPreset)?.models?.length>0&&<div style={{marginBottom:12}}><small style={{display:'block',fontWeight:900,marginBottom:4}}>AVAILABLE MODELS</small><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{presets.find(p=>p.key===selPreset)!.models.map((m:string)=><button key={m} className={newModel===m?'chip selected':'chip'} onClick={()=>setNewModel(m)}>{m}</button>)}</div></div>}
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'flex-end',marginTop:8}}>
                <div><small style={{display:'block',fontWeight:900,marginBottom:4}}>Name</small><input value={newName} onChange={e=>setNewName(e.target.value)} style={{border:'2px solid #111',padding:'6px 8px',font:'inherit',width:130}}/></div>
                <div><small style={{display:'block',fontWeight:900,marginBottom:4}}>Base URL</small><input value={newUrl} onChange={e=>setNewUrl(e.target.value)} placeholder="https://api.openai.com/v1" style={{border:'2px solid #111',padding:'6px 8px',font:'inherit',width:220}}/></div>
                <div><small style={{display:'block',fontWeight:900,marginBottom:4}}>API Key</small><input type="password" value={newKey} onChange={e=>setNewKey(e.target.value)} style={{border:'2px solid #111',padding:'6px 8px',font:'inherit',width:160}}/></div>
                <div><small style={{display:'block',fontWeight:900,marginBottom:4}}>Model</small><input value={newModel} onChange={e=>setNewModel(e.target.value)} placeholder="gpt-4o" style={{border:'2px solid #111',padding:'6px 8px',font:'inherit',width:150}}/></div>
                <button className="button green" onClick={addP} disabled={!newName}><Check size={15}/>Save</button>
              </div>
            </div>
          )}
          {p.providers.length===0&&!provForm&&<div style={{padding:22,textAlign:'center',color:'#999',fontWeight:700}}>No AI providers. Choose a preset above.</div>}
          {p.providers.map(prov=><div className="setting" key={prov.name}><div><b>{prov.name}</b><p>{prov.base_url||'No URL'} {prov.model?'\u00b7 '+prov.model:''}</p></div><button className="button red" onClick={()=>p.onDeleteProvider(prov.name)}><Trash2 size={14}/>Remove</button></div>)}
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
