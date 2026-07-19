import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, Archive, BarChart3, Bell, Check, ChevronRight, FileText,
  Folder, Inbox, Key, LayoutDashboard, LogOut, Menu, MoreHorizontal,
  Paperclip, Plus, QrCode, Search, Settings, Shield, SlidersHorizontal,
  Sparkles, Trash2, Upload, Wifi, WifiOff, X, RefreshCw, ScanLine, Smartphone
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  login, logout, getToken, setToken,
  getDocuments, getDocument, deleteDocument,
  analyzeDocument, analyzeAll,
  getStats, getSettings, saveSettings,
  getProviders, createProvider, updateProvider, deleteProvider,
  getWahaSessions, createWahaSession, startWahaSession, stopWahaSession,
  deleteWahaSession, getWahaQR, getWahaSessionStatus, getWahaHealth,
  connectWebSocket,
} from './api';
import './styles.css';

type Doc = { id: string; filename: string; sender: string; mime_type: string; status: string; created_at: string; metadata?: any; waha_session?: string };
type Provider = { id?: string; name: string; base_url: string; model: string; api_key?: string };
type WahaSession = { name: string; status: string; has_qr?: boolean; engine?: any; me?: any };

const DEMO = import.meta.env.VITE_DEMO_MODE === 'true';
const DEMO_DOCS: Doc[] = [
  { id: '1', filename: 'invoice_alfamart.pdf', sender: '6281244219088', mime_type: 'application/pdf', status: 'analyzed', created_at: new Date().toISOString() },
  { id: '2', filename: 'KTP_Budi.jpg', sender: '6281390821102', mime_type: 'image/jpeg', status: 'processing', created_at: new Date().toISOString() },
  { id: '3', filename: 'contract.docx', sender: '6281177828841', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', status: 'unanalyzed', created_at: new Date().toISOString() },
];
const DEMO_STATS = [
  { name: 'Mon', files: 34 }, { name: 'Tue', files: 48 }, { name: 'Wed', files: 39 },
  { name: 'Thu', files: 62 }, { name: 'Fri', files: 55 }, { name: 'Sat', files: 71 }, { name: 'Sun', files: 46 },
];

function App() {
  const [page, setPage] = useState('connect');
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
  const [flash, setFlash] = useState('');
  const [wahaSessions, setWahaSessions] = useState<WahaSession[]>([]);
  const [qrCode, setQrCode] = useState('');
  const [qrSession, setQrSession] = useState('');
  const [wahaConnected, setWahaConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const flashMsg = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(''), 3000); };

  // WebSocket
  useEffect(() => {
    if (!authed) return;
    const token = getToken();
    if (!token) return;
    const ws = connectWebSocket((msg) => {
      if (msg.type === 'document.created') {
        setDocs(prev => [msg.data, ...prev]);
      } else if (msg.type === 'document.updated') {
        setDocs(prev => prev.map(d => d.id === msg.data.id ? msg.data : d));
      } else if (msg.type?.startsWith('waha.session.')) {
        loadWahaSessions();
      }
    });
    wsRef.current = ws;
    return () => { ws?.close(); };
  }, [authed]);

  // Load data
  const loadDocs = useCallback(async () => {
    if (DEMO) return;
    try { const r = await getDocuments({ limit: 50 }); setDocs(r.items || []); } catch { /* ignore */ }
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
    try { const r = await getProviders(); setProvidersData(r.items || []); } catch { /* ignore */ }
  }, []);
  const loadWahaSessions = useCallback(async () => {
    if (DEMO) return;
    try {
      const r = await getWahaSessions();
      setWahaSessions(r.sessions || []);
      setWahaConnected(r.sessions?.some((s: WahaSession) => s.status === 'WORKING') || false);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!authed) return;
    loadDocs();
    loadStats();
    loadSettings();
    loadProviders();
    loadWahaSessions();
    const interval = setInterval(loadWahaSessions, 5000);
    return () => clearInterval(interval);
  }, [authed, loadDocs, loadStats, loadSettings, loadProviders, loadWahaSessions]);

  const doLogin = async () => {
    try {
      const r = await login(username, password);
      setAuthed(true);
      setLoginErr('');
    } catch (e: any) {
      setLoginErr(e.message || 'Login failed');
    }
  };
  const doLogout = () => { logout(); setAuthed(false); setPage('connect'); };

  const analyze = async (id: string) => {
    if (DEMO) { setDocs(prev => prev.map(d => d.id === id ? { ...d, status: 'analyzed' } : d)); flashMsg('Analyzed (demo)'); return; }
    try { await analyzeDocument(id); flashMsg('Analysis queued'); } catch { flashMsg('Analyze failed'); }
  };
  const analyzeAllFn = async () => {
    if (DEMO) { flashMsg('All analyzed (demo)'); return; }
    try { await analyzeAll(); flashMsg('Analysis queued for all'); } catch { flashMsg('Analyze all failed'); }
  };

  // Login screen
  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f3ee' }}>
        <div style={{ background: '#fff', border: '3px solid #111', boxShadow: '6px 6px #111', padding: '40px 32px', width: 380, maxWidth: '90vw' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ background: '#c8f31d', color: '#111', fontWeight: 950, fontSize: 28, padding: '10px 8px', border: '2px solid #111', display: 'inline-block', marginBottom: 12 }}>MW</div>
            <h2 style={{ fontSize: 24, margin: '8px 0', fontWeight: 950, letterSpacing: -1 }}>MemoriWA</h2>
            <p style={{ color: '#777', fontSize: 13, fontWeight: 700 }}>Document & Image Intelligence</p>
          </div>
          <div style={{ marginBottom: 16 }}>
            <input
              value={username} onChange={e => setUsername(e.target.value)}
              placeholder="Username"
              style={{ width: '100%', padding: '12px', border: '2px solid #111', fontSize: 14, fontWeight: 700, marginBottom: 8, boxSizing: 'border-box' }}
              onKeyDown={e => e.key === 'Enter' && doLogin()}
            />
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              style={{ width: '100%', padding: '12px', border: '2px solid #111', fontSize: 14, fontWeight: 700, boxSizing: 'border-box' }}
              onKeyDown={e => e.key === 'Enter' && doLogin()}
            />
          </div>
          {loginErr && <div style={{ color: '#f2504b', fontWeight: 700, fontSize: 12, marginBottom: 12 }}>{loginErr}</div>}
          <button onClick={doLogin} style={{ width: '100%', padding: '14px', background: '#c8f31d', border: '2px solid #111', fontWeight: 900, fontSize: 15, cursor: 'pointer', boxShadow: '3px 3px #111' }}>
            Sign In
          </button>
        </div>
      </div>
    );
  }

  const filtered = useMemo(() => docs.filter(d =>
    (filter === 'All' || d.mime_type?.includes(filter.toLowerCase()) || (filter === 'PDF' && d.filename?.endsWith('.pdf'))) &&
    (!query || `${d.filename} ${d.sender}`.toLowerCase().includes(query.toLowerCase()))
  ), [docs, filter, query]);

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="brand">
          <div className="brandmark">MW</div>
          <div><b>MemoriWA</b><small>Document Intelligence</small></div>
        </div>
        <nav>
          {([
            ['Connect WAHA', Smartphone],
            ['Inbox', Inbox],
            ['File Manager', Folder],
            ['Stats', BarChart3],
            ['Settings', Settings],
          ] as const).map(([n, I]) => (
            <button key={n} className={page === n ? 'active' : ''} onClick={() => setPage(n)}>
              <I size={19} />{n}
              {n === 'Inbox' && <em>{docs.length}</em>}
            </button>
          ))}
        </nav>
        <div className="connection">
          <span className="dot" style={{ background: wahaConnected ? '#4f0' : '#f2504b' }} />
          {wahaConnected ? 'WAHA CONNECTED' : 'WAHA OFFLINE'}
          <small>Auto-sync on</small>
        </div>
        <div className="user">
          <div className="avatar">AD</div>
          <span><b>Admin</b><small>Administrator</small></span>
          <MoreHorizontal size={18} />
        </div>
      </aside>

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <main>
        <header>
          <button className="mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu /></button>
          <div>
            <span className="eyebrow">WORKSPACE / {page.toUpperCase()}</span>
            <h1>{page}</h1>
          </div>
          <div className="head-actions">
            <button className="icon" onClick={doLogout}><LogOut size={19} /></button>
            {page === 'Inbox' && (
              <button className="button yellow" onClick={analyzeAllFn}>
                <Sparkles size={16} /> Analyze All
              </button>
            )}
          </div>
        </header>

        {page === 'connect' && <ConnectPage
          wahaSessions={wahaSessions}
          qrCode={qrCode}
          qrSession={qrSession}
          onLoad={() => loadWahaSessions()}
          onCreate={async (name: string) => {
            try {
              await createWahaSession(name);
              await loadWahaSessions();
              // Start session after creation
              await startWahaSession(name);
              await loadWahaSessions();
              flashMsg('Session created. Fetching QR...');
            } catch (e: any) { flashMsg('Error: ' + (e.message || 'Failed')); }
          }}
          onStart={async (name: string) => {
            try { await startWahaSession(name); await loadWahaSessions(); } catch { /* */ }
          }}
          onStop={async (name: string) => {
            try { await stopWahaSession(name); await loadWahaSessions(); } catch { /* */ }
          }}
          onDelete={async (name: string) => {
            try { await deleteWahaSession(name); await loadWahaSessions(); flashMsg('Session deleted'); } catch { /* */ }
          }}
          onGetQR={async (name: string) => {
            try {
              const r = await getWahaQR(name);
              setQrCode(r.qr);
              setQrSession(name);
            } catch (e: any) { flashMsg('QR not available: ' + (e.message || 'Unknown')); }
          }}
          connected={wahaConnected}
        />}

        {page === 'Inbox' && <InboxPage filtered={filtered} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} selected={selected} setSelected={setSelected} analyze={analyze} analyzeAll={analyzeAllFn} />}
        {page === 'File Manager' && <ManagerPage docs={docs} />}
        {page === 'Stats' && <StatsPage docs={docs} />}
        {page === 'Settings' && (
          <SettingsPage
            settings={settings}
            providers={providers}
            onSaveSettings={async (s) => {
              if (DEMO) { setSettingsData(s); flashMsg('Saved'); return; }
              try { setSettingsData(await saveSettings(s)); flashMsg('Saved'); } catch { flashMsg('Save failed'); }
            }}
            onAddProvider={async (p: Provider) => {
              if (DEMO) { setProvidersData(prev => [...prev, p]); return; }
              try { await createProvider(p); await loadProviders(); flashMsg('Provider added'); } catch { flashMsg('Add failed'); }
            }}
            onDeleteProvider={async (name: string) => {
              if (DEMO) { setProvidersData(prev => prev.filter(x => x.name !== name)); return; }
              try { await deleteProvider(name); await loadProviders(); } catch { /* */ }
            }}
          />
        )}
      </main>
      {flash && (
        <div className="toast"><Check size={17} />{flash}</div>
      )}
    </div>
  );
}

// ==================== Connect Page ====================
function ConnectPage(p: {
  wahaSessions: WahaSession[];
  qrCode: string; qrSession: string;
  onLoad: () => void; onCreate: (name: string) => void;
  onStart: (name: string) => void; onStop: (name: string) => void;
  onDelete: (name: string) => void; onGetQR: (name: string) => void;
  connected: boolean;
}) {
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      {/* Status Banner */}
      <div style={{
        background: p.connected ? '#d4ffd4' : '#ffe0e0',
        border: '3px solid #111',
        padding: '20px 24px',
        display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24,
        boxShadow: '4px 4px #111'
      }}>
        <div style={{ fontSize: 40 }}>{p.connected ? <Wifi /> : <WifiOff />}</div>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 950 }}>
            {p.connected ? 'WhatsApp Connected' : 'WhatsApp Not Connected'}
          </h2>
          <p style={{ color: '#555', fontWeight: 700 }}>
            {p.connected
              ? `${p.wahaSessions.filter(s => s.status === 'WORKING').length} active session(s). Documents will flow automatically.`
              : 'Connect a WhatsApp number to start receiving documents.'}
          </p>
        </div>
      </div>

      {/* Sessions List */}
      <div className="table-card" style={{ marginBottom: 24 }}>
        <div className="table-head" style={{ justifyContent: 'space-between' }}>
          <b>WAHA SESSIONS <span>{p.wahaSessions.length}</span></b>
          <button className="button" onClick={() => setShowCreate(!showCreate)}>
            <Plus size={15} /> New Session
          </button>
        </div>

        {showCreate && (
          <div style={{ padding: 18, borderBottom: '2px solid #111', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <small style={{ fontWeight: 900, display: 'block', marginBottom: 4 }}>Session Name</small>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="default"
                style={{ border: '2px solid #111', padding: '10px 12px', font: 'inherit', fontWeight: 700, width: '100%' }}
                onKeyDown={e => e.key === 'Enter' && (p.onCreate(newName || 'default'), setShowCreate(false), setNewName(''))}
              />
            </div>
            <button className="button green" onClick={() => { p.onCreate(newName || 'default'); setShowCreate(false); setNewName(''); }}>
              <QrCode size={15} /> Create & Get QR
            </button>
          </div>
        )}

        {p.wahaSessions.length === 0 && !showCreate && (
          <div style={{ padding: 30, textAlign: 'center', color: '#999', fontWeight: 700 }}>
            No sessions yet. Click "New Session" to connect a WhatsApp number.
          </div>
        )}

        {p.wahaSessions.map(s => (
          <div key={s.name} style={{ padding: '14px 18px', borderBottom: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.status === 'WORKING' ? '#4f0' : s.status === 'SCAN_QR_CODE' ? '#ff0' : '#ccc', display: 'inline-block' }} />
            <div style={{ flex: 1 }}>
              <b>{s.name}</b>
              <small style={{ display: 'block', color: '#777', marginTop: 2 }}>{s.status} {s.me ? `· ${s.me?.pushname || ''}` : ''}</small>
            </div>
            {s.status === 'SCAN_QR_CODE' && (
              <button className="button yellow" onClick={() => p.onGetQR(s.name)}>
                <QrCode size={14} /> Show QR
              </button>
            )}
            {s.status === 'STOPPED' && (
              <button className="button" onClick={() => p.onStart(s.name)}>
                <RefreshCw size={14} /> Start
              </button>
            )}
            {s.status === 'WORKING' && (
              <button className="button" onClick={() => p.onStop(s.name)}>
                Stop
              </button>
            )}
            <button className="button red" onClick={() => p.onDelete(s.name)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* QR Display */}
      {p.qrCode && (
        <div className="table-card" style={{ textAlign: 'center', padding: 24 }}>
          <div className="table-head" style={{ justifyContent: 'center', marginBottom: 16 }}>
            <b>SCAN QR — {p.qrSession}</b>
          </div>
          <img
            src={`data:image/png;base64,${p.qrCode}`}
            alt="WhatsApp QR"
            style={{ maxWidth: 280, border: '3px solid #111', boxShadow: '4px 4px #111' }}
          />
          <p style={{ marginTop: 12, color: '#777', fontWeight: 700 }}>
            Open WhatsApp on your phone → Settings → Linked Devices → Scan QR
          </p>
        </div>
      )}

      {/* How it works */}
      <div className="table-card" style={{ marginTop: 24 }}>
        <div className="table-head"><b>HOW IT WORKS</b></div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { step: 1, text: 'Create a new session — give it a name (e.g. "CS Bot" or "Sales")' },
            { step: 2, text: 'Click "Show QR" and scan it with WhatsApp on your phone' },
            { step: 3, text: 'Once connected, documents sent to that WhatsApp number will appear in Inbox' },
            { step: 4, text: 'Analyze documents manually from Inbox using AI providers configured in Settings' },
          ].map(s => (
            <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ background: '#c8f31d', border: '2px solid #111', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 950, fontSize: 16, flexShrink: 0 }}>
                {s.step}
              </span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{s.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== Inbox Page ====================
function InboxPage(p: any) {
  return (
    <>
      <section className="metrics">
        <Metric n={p.filtered.length} label="Files" c="lime" />
        <Metric n={p.filtered.filter((d: Doc) => d.status === 'unanalyzed').length} label="Pending" />
        <Metric n={p.filtered.filter((d: Doc) => d.status === 'analyzed').length} label="Analyzed" c="yellow" />
        <Metric n={p.filtered.filter((d: Doc) => d.status === 'failed').length} label="Failed" c="red" />
      </section>
      <section className="toolbar">
        <div className="search"><Search size={18} /><input placeholder="Search files..." value={p.query} onChange={(e: any) => p.setQuery(e.target.value)} /></div>
        {['All', 'PDF', 'IMAGE', 'DOCX'].map((x: string) => (
          <button key={x} className={p.filter === x ? 'chip selected' : 'chip'} onClick={() => p.setFilter(x)}>{x}</button>
        ))}
      </section>
      <section className="table-card">
        <div className="table-head">
          <b>DOCUMENTS <span>{p.filtered.length}</span></b>
          {p.selected.length > 0 && (
            <button className="button red" onClick={() => p.selected.forEach((id: string) => p.analyze(id))}>
              <Sparkles size={16} /> Analyze ({p.selected.length})
            </button>
          )}
        </div>
        <div className="table">
          {p.filtered.map((d: Doc) => (
            <div className="row" key={d.id}>
              <input type="checkbox" checked={p.selected.includes(d.id)} onChange={() => p.setSelected((s: string[]) => s.includes(d.id) ? s.filter((x: string) => x !== d.id) : [...s, d.id])} />
              <div className="fileicon"><FileText size={20} /></div>
              <div className="filename">
                <b>{d.filename}</b>
                <small>{d.sender} · {formatDate(d.created_at)}</small>
              </div>
              <span className={`status ${d.status}`}><i /> {d.status}</span>
              <button className="analyze" onClick={() => p.analyze(d.id)}><Sparkles size={15} /></button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ==================== Manager Page ====================
function ManagerPage({ docs }: { docs: Doc[] }) {
  const categories = useMemo(() => {
    const cats = new Set(docs.map(d => d.metadata?.analysis?.category || 'Unsorted'));
    return Array.from(cats);
  }, [docs]);

  return (
    <div>
      <div className="manager-head">
        <div className="folderbox"><Folder /><b>All files</b><small>{docs.length} docs</small></div>
        {categories.map(c => (
          <div className="folderbox" key={c}><Folder /><b>{c}</b><small>{docs.filter(d => (d.metadata?.analysis?.category || 'Unsorted') === c).length} docs</small></div>
        ))}
      </div>
      <section className="table-card">
        <div className="table-head"><b>RECENT</b></div>
        {docs.slice(0, 10).map(d => (
          <div className="row" key={d.id}>
            <div className="fileicon"><FileText size={20} /></div>
            <div className="filename"><b>{d.filename}</b><small>{d.sender}</small></div>
            <span className="tag">{d.metadata?.analysis?.category || '—'}</span>
            <ChevronRight />
          </div>
        ))}
      </section>
    </div>
  );
}

// ==================== Stats Page ====================
function StatsPage({ docs }: { docs: Doc[] }) {
  return (
    <>
      <section className="metrics">
        <Metric n={docs.length} label="Total" c="lime" />
        <Metric n={docs.filter(d => d.status === 'analyzed').length} label="Analyzed" />
        <Metric n={docs.filter(d => d.mime_type?.startsWith('image')).length} label="Images" c="yellow" />
        <Metric n={docs.filter(d => d.status === 'failed').length} label="Failed" c="red" />
      </section>
      <div className="chart-card">
        <div className="table-head"><b>STATUS BREAKDOWN</b></div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={['unanalyzed', 'processing', 'analyzed', 'failed'].map(s => ({ name: s, count: docs.filter(d => d.status === s).length }))}>
            <CartesianGrid stroke="#ddd" strokeDasharray="4 4" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#c8f31d" stroke="#111" strokeWidth={2} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

// ==================== Settings Page ====================
function SettingsPage(p: {
  settings: any; providers: Provider[];
  onSaveSettings: (s: any) => void; onAddProvider: (p: Provider) => void; onDeleteProvider: (name: string) => void;
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

  useEffect(() => { setS({ ...p.settings }); }, [p.settings]);
  useEffect(() => {
    if (!DEMO) fetch((import.meta.env.VITE_API_URL || '') + '/api/provider-presets', {
      headers: { Authorization: 'Bearer ' + getToken() }
    }).then(r => r.json()).then(d => setPresets(d.presets || [])).catch(() => { });
  }, []);

  const pickPreset = (k: string) => {
    setSelPreset(k); const pr = presets.find(x => x.key === k);
    if (pr) { setNewName(pr.name); setNewUrl(pr.base_url); setNewModel(pr.models?.[0] || ''); setNewKey(''); }
  };
  const addP = () => {
    p.onAddProvider({ name: newName, base_url: newUrl, model: newModel, api_key: newKey });
    setProvForm(false); setNewName(''); setNewUrl(''); setNewKey(''); setNewModel(''); setSelPreset('');
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, flexWrap: 'nowrap', overflow: 'auto' }}>
        {[{ key: 'general', label: 'General' }, { key: 'ai', label: 'AI Engine' }].map(t => (
          <button key={t.key} className={tab === t.key ? 'chip selected' : 'chip'} onClick={() => setTab(t.key)} style={{ whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="settings">
          <div className="setting"><div><b>THEME</b></div><select value={s.theme || 'system'} onChange={e => setS({ ...s, theme: e.target.value })} style={{ border: '2px solid #111', padding: '8px 12px', fontWeight: 900 }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
          <div className="setting"><div><b>LANGUAGE</b></div><select value={s.language || 'id'} onChange={e => setS({ ...s, language: e.target.value })} style={{ border: '2px solid #111', padding: '8px 12px', fontWeight: 900 }}><option value="id">Bahasa Indonesia</option><option value="en">English</option><option value="auto">Auto-detect</option></select></div>
          <div className="setting"><div><b>AUTO-ANALYZE</b><p>Manual-only for safety</p></div><span style={{ color: '#777', fontWeight: 900, fontSize: 11 }}>Disabled</span></div>
          <div className="setting"><div /><button className="button yellow" onClick={() => p.onSaveSettings(s)}><Check size={16} /> Save</button></div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="settings">
          <div style={{ borderBottom: '2px solid #111', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b>AI PROVIDERS</b>
            <button className="button" onClick={() => setProvForm(!provForm)}><Plus size={15} /> Add Provider</button>
          </div>
          {provForm && (
            <div style={{ padding: 18, borderBottom: '1px solid #ddd' }}>
              <div style={{ marginBottom: 12 }}><small style={{ fontWeight: 900, display: 'block', marginBottom: 4 }}>SELECT PROVIDER</small>
                <select value={selPreset} onChange={e => pickPreset(e.target.value)} style={{ border: '2px solid #111', padding: '9px 12px', fontWeight: 700, width: 280 }}>
                  <option value="">-- Choose --</option>
                  {presets.map((p: any) => <option key={p.key} value={p.key}>{p.name}</option>)}
                </select>
              </div>
              {selPreset && presets.find(p => p.key === selPreset)?.models?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <small style={{ fontWeight: 900, display: 'block', marginBottom: 4 }}>MODELS</small>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {presets.find(p => p.key === selPreset)!.models.map((m: string) => (
                      <button key={m} className={newModel === m ? 'chip selected' : 'chip'} onClick={() => setNewModel(m)}>{m}</button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
                <div><small style={{ fontWeight: 900 }}>Name</small><input value={newName} onChange={e => setNewName(e.target.value)} style={{ border: '2px solid #111', padding: '6px 8px', width: 130 }} /></div>
                <div><small style={{ fontWeight: 900 }}>Base URL</small><input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://api.openai.com/v1" style={{ border: '2px solid #111', padding: '6px 8px', width: 220 }} /></div>
                <div><small style={{ fontWeight: 900 }}>API Key</small><input type="password" value={newKey} onChange={e => setNewKey(e.target.value)} style={{ border: '2px solid #111', padding: '6px 8px', width: 160 }} /></div>
                <div><small style={{ fontWeight: 900 }}>Model</small><input value={newModel} onChange={e => setNewModel(e.target.value)} placeholder="gpt-4o" style={{ border: '2px solid #111', padding: '6px 8px', width: 150 }} /></div>
                <button className="button green" onClick={addP} disabled={!newName}><Check size={15} /> Save</button>
              </div>
            </div>
          )}
          {p.providers.length === 0 && !provForm && (
            <div style={{ padding: 22, textAlign: 'center', color: '#999', fontWeight: 700 }}>No AI providers. Choose a preset above.</div>
          )}
          {p.providers.map(prov => (
            <div className="setting" key={prov.name}>
              <div><b>{prov.name}</b><p>{prov.base_url || 'No URL'} {prov.model ? '· ' + prov.model : ''}</p></div>
              <button className="button red" onClick={() => p.onDeleteProvider(prov.name)}><Trash2 size={14} /> Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== Helpers ====================
function Metric({ n, label, c }: { n: number | string; label: string; c?: string }) {
  return <div className={'metric ' + (c || '')}><b>{n}</b><span>{label}</span></div>;
}

function formatDate(d: string): string {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return date.toLocaleDateString();
}

// ==================== Boot ====================
createRoot(document.getElementById('root')!).render(<App />);
