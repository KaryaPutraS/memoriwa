import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3, Check, ChevronRight, FileText, Folder, Inbox,
  LogOut, Menu, MoreHorizontal, Plus, QrCode, Search, Settings,
  Sparkles, Trash2, Wifi, WifiOff, RefreshCw, Smartphone
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { login, logout, getToken, setToken, getDocuments, analyzeDocument, analyzeAll, getStats, getSettings, saveSettings, getProviders, createProvider, updateProvider, deleteProvider, connectWebSocket } from './api';
import './styles.css';

type Doc = { id: string; filename: string; sender: string; mime_type: string; status: string; created_at: string; metadata?: any };
type Provider = { id?: string; name: string; base_url: string; model: string; api_key?: string };

const API = import.meta.env.VITE_API_URL || '';
function ah(): Record<string, string> { const t = getToken(); const h: Record<string, string> = { 'Content-Type': 'application/json' }; if (t) h['Authorization'] = 'Bearer ' + t; return h; }
async function ag(path: string) { const r = await fetch(API + path, { headers: ah() }); if (!r.ok) throw new Error('Err'); return r.json(); }
async function ap(path: string, b?: any) { const r = await fetch(API + path, { method: 'POST', headers: ah(), body: b ? JSON.stringify(b) : undefined }); if (!r.ok) throw new Error('Err'); return r.json(); }

function App() {
  const [page, setPage] = useState('connect');
  const [side, setSide] = useState(false);
  const [authed, setAuthed] = useState(!!getToken());
  const [loginErr, setLoginErr] = useState('');
  const [uname, setUname] = useState('');
  const [pwd, setPwd] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [settings, setSettings] = useState<any>({ theme: 'system', language: 'id' });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [flash, setFlash] = useState('');
  const [conn, setConn] = useState(false);
  const [wStatus, setWStatus] = useState('');
  const [wMe, setWMe] = useState<any>(null);
  const [qr, setQr] = useState('');
  const [qrBusy, setQrBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const f = (m: string) => { setFlash(m); setTimeout(() => setFlash(''), 3000); };

  const pw = useCallback(async () => {
    try { const r = await ag('/api/waha/status'); setConn(r.connected); setWStatus(r.status || 'UNKNOWN'); setWMe(r.me); } catch { /* */ }
  }, []);
  const la = useCallback(async () => {
    try { const r = await getDocuments({ limit: 50 }); setDocs(r.items || []); } catch { /* */ }
    try { setStats(await getStats()); } catch { /* */ }
    try { setSettings(await getSettings()); } catch { /* */ }
    try { setProviders((await getProviders()).items || []); } catch { /* */ }
  }, []);

  useEffect(() => { if (!authed) return; la(); pw(); const i = setInterval(pw, 5000); return () => clearInterval(i); }, [authed, la, pw]);

  useEffect(() => {
    if (!authed) return;
    const t = getToken(); if (!t) return;
    const ws = connectWebSocket((m: any) => {
      if (m.type === 'document.created') setDocs(p => [m.data, ...p]);
      else if (m.type === 'document.updated') setDocs(p => p.map(d => d.id === m.data.id ? m.data : d));
      else if (m.type === 'waha.status') pw();
    });
    wsRef.current = ws;
    return () => { ws?.close(); };
  }, [authed, pw]);

  const doLogin = async () => { try { await login(uname, pwd); setAuthed(true); } catch (e: any) { setLoginErr(e.message || 'Failed'); } };
  const doLogout = () => { logout(); setAuthed(false); };
  const hs = async () => { setQrBusy(true); try { await ap('/api/waha/start'); await pw(); setTimeout(async () => { try { const r = await ag('/api/waha/qr'); setQr(r.qr); } catch (e: any) { f('QR: ' + e.message); } setQrBusy(false); }, 3000); } catch (e: any) { f(e.message); setQrBusy(false); } };
  const ho = async () => { try { await ap('/api/waha/stop'); f('Stopped'); pw(); } catch { /* */ } };
  const hl = async () => { try { await ap('/api/waha/logout'); setConn(false); setQr(''); f('Logged out'); pw(); } catch { /* */ } };
  const hq = async () => { setQrBusy(true); try { const r = await ag('/api/waha/qr'); setQr(r.qr); } catch (e: any) { f('QR: ' + e.message); } setQrBusy(false); };
  const az = async (id: string) => { try { await analyzeDocument(id); f('Queued'); } catch { f('Failed'); } };
  const aa = async () => { try { await analyzeAll(); f('Queued all'); } catch { f('Failed'); } };

  if (!authed) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f3ee' }}>
      <div style={{ background: '#fff', border: '3px solid #111', boxShadow: '6px 6px #111', padding: '40px 32px', width: 380, maxWidth: '90vw' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ background: '#c8f31d', color: '#111', fontWeight: 950, fontSize: 28, padding: '10px 8px', border: '2px solid #111', display: 'inline-block', marginBottom: 12 }}>MW</div>
          <h2 style={{ fontSize: 24, margin: '8px 0', fontWeight: 950, letterSpacing: -1 }}>MemoriWA</h2>
          <p style={{ color: '#777', fontSize: 13, fontWeight: 700 }}>Document Intelligence for WhatsApp</p>
        </div>
        <div style={{ marginBottom: 16 }}>
          <input value={uname} onChange={e => setUname(e.target.value)} placeholder="Username" style={{ width: '100%', padding: '12px', border: '2px solid #111', fontSize: 14, fontWeight: 700, marginBottom: 8, boxSizing: 'border-box' }} onKeyDown={e => e.key === 'Enter' && doLogin()} />
          <input type="password" value={pwd} onChange={e => setPwd(e.target.value)} placeholder="Password" style={{ width: '100%', padding: '12px', border: '2px solid #111', fontSize: 14, fontWeight: 700, boxSizing: 'border-box' }} onKeyDown={e => e.key === 'Enter' && doLogin()} />
        </div>
        {loginErr && <div style={{ color: '#f2504b', fontWeight: 700, fontSize: 12, marginBottom: 12 }}>{loginErr}</div>}
        <button onClick={doLogin} style={{ width: '100%', padding: '14px', background: '#c8f31d', border: '2px solid #111', fontWeight: 900, fontSize: 15, cursor: 'pointer', boxShadow: '3px 3px #111' }}>Sign In</button>
      </div>
    </div>
  );

  const flt = useMemo(() => docs.filter(d =>
    (filter === 'All' || d.mime_type?.includes(filter.toLowerCase()) || (filter === 'PDF' && d.filename?.endsWith('.pdf'))) &&
    (!query || `${d.filename} ${d.sender}`.toLowerCase().includes(query.toLowerCase()))
  ), [docs, filter, query]);

  const statusLabel: Record<string, string> = { 'NOT_CREATED': 'Not created', 'STOPPED': 'Stopped', 'STARTING': 'Starting...', 'SCAN_QR_CODE': 'Waiting for QR scan', 'WORKING': 'Connected', 'FAILED': 'Failed' };

  return (
    <div className="app">
      <aside className={`sidebar${side ? ' open' : ''}`}>
        <div className="brand"><div className="brandmark">MW</div><div><b>MemoriWA</b><small>Document Intelligence</small></div></div>
        <nav>{[
          ['Connect', Smartphone], ['Inbox', Inbox], ['File Manager', Folder], ['Stats', BarChart3], ['Settings', Settings],
        ].map(([n, I]: any) => (<button key={n} className={page === n ? 'active' : ''} onClick={() => setPage(n)}><I size={19} />{n}{n === 'Inbox' && <em>{docs.length}</em>}</button>))}</nav>
        <div className="connection"><span className="dot" style={{ background: conn ? '#4f0' : '#f2504b' }} />{conn ? 'CONNECTED' : 'OFFLINE'}{wMe?.pushname && <small>{wMe.pushname}</small>}</div>
        <div className="user"><div className="avatar">AD</div><span><b>Admin</b><small>Administrator</small></span><MoreHorizontal size={18} /></div>
      </aside>
      {side && <div className="sidebar-overlay" onClick={() => setSide(false)} />}

      <main>
        <header>
          <button className="mobile-menu" onClick={() => setSide(!side)}><Menu /></button>
          <div><span className="eyebrow">WORKSPACE / {page.toUpperCase()}</span><h1>{page}</h1></div>
          <div className="head-actions">
            <button className="icon" onClick={doLogout}><LogOut size={19} /></button>
            {page === 'Inbox' && <button className="button yellow" onClick={aa}><Sparkles size={16} /> Analyze All</button>}
          </div>
        </header>

        {page === 'connect' && (
          <div>
            <div style={{ background: conn ? '#d4ffd4' : wStatus === 'SCAN_QR_CODE' ? '#fffcd4' : '#ffe0e0', border: '3px solid #111', padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, boxShadow: '4px 4px #111' }}>
              <div style={{ fontSize: 40 }}>{conn ? <Wifi /> : <WifiOff />}</div>
              <div><h2 style={{ margin: 0, fontSize: 20, fontWeight: 950 }}>{conn ? 'WhatsApp Connected' : statusLabel[wStatus] || wStatus}</h2><p style={{ color: '#555', fontWeight: 700, margin: '4px 0 0' }}>{conn ? `Connected as ${wMe?.pushname || 'Unknown'}. Documents appear in Inbox automatically.` : 'One WhatsApp number per dashboard. Click Start to connect.'}</p></div>
            </div>

            <div className="table-card" style={{ marginBottom: 24 }}>
              <div className="table-head"><b>CONNECTION</b><span style={{ background: conn ? '#d4ffd4' : '#eee', padding: '4px 10px', fontWeight: 700, fontSize: 12 }}>{statusLabel[wStatus] || wStatus}</span></div>
              <div style={{ padding: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(!conn || wStatus === 'STOPPED' || wStatus === 'FAILED' || wStatus === 'NOT_CREATED') && <button className="button green" onClick={hs} disabled={qrBusy}>{qrBusy ? <RefreshCw size={15} /> : <QrCode size={15} />}{qrBusy ? ' Starting...' : ' Start & Show QR'}</button>}
                {wStatus === 'SCAN_QR_CODE' && <button className="button yellow" onClick={hq} disabled={qrBusy}><QrCode size={15} /> Refresh QR</button>}
                {conn && <button className="button" onClick={ho}>Stop Session</button>}
                <button className="button red" onClick={hl}><Trash2 size={15} /> Logout</button>
              </div>
            </div>

            {qr && <div className="table-card" style={{ textAlign: 'center', padding: 24, marginBottom: 24 }}><div style={{ borderBottom: '2px solid #111', padding: '12px 14px', fontWeight: 900, fontSize: 14, marginBottom: 16 }}>SCAN WITH WHATSAPP</div><img src={`data:image/png;base64,${qr}`} alt="QR" style={{ maxWidth: 280, border: '3px solid #111', boxShadow: '4px 4px #111' }} /><p style={{ marginTop: 12, color: '#777', fontWeight: 700 }}>WhatsApp → Settings → Linked Devices → Scan QR Code</p></div>}

            <div className="table-card"><div className="table-head"><b>HOW TO CONNECT</b></div>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[{ s: 1, t: 'Click "Start & Show QR" — a QR code appears on screen' }, { s: 2, t: 'Open WhatsApp on your phone → Settings → Linked Devices' }, { s: 3, t: 'Scan the QR code with your phone camera' }, { s: 4, t: 'Send any document or image to your WhatsApp — it appears in Inbox' }].map(x => (<div key={x.s} style={{ display: 'flex', alignItems: 'center', gap: 14 }}><span style={{ background: '#c8f31d', border: '2px solid #111', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 950, fontSize: 16, flexShrink: 0 }}>{x.s}</span><span style={{ fontWeight: 700, fontSize: 14 }}>{x.t}</span></div>))}
              </div>
              <div style={{ padding: '0 20px 20px', color: '#777', fontWeight: 700, fontSize: 13 }}>💡 One dashboard = one WhatsApp number. For multiple numbers, deploy multiple instances.</div>
            </div>
          </div>
        )}

        {page === 'Inbox' && <div>
          <section className="metrics"><M n={flt.length} l="Files" c="lime" /><M n={flt.filter((d: Doc) => d.status === 'unanalyzed').length} l="Pending" /><M n={flt.filter((d: Doc) => d.status === 'analyzed').length} l="Analyzed" c="yellow" /><M n={flt.filter((d: Doc) => d.status === 'failed').length} l="Failed" c="red" /></section>
          <section className="toolbar"><div className="search"><Search size={18} /><input placeholder="Search..." value={query} onChange={e => setQuery(e.target.value)} /></div>{['All', 'PDF', 'IMAGE', 'DOCX'].map(x => <button key={x} className={filter === x ? 'chip selected' : 'chip'} onClick={() => setFilter(x)}>{x}</button>)}</section>
          <section className="table-card"><div className="table-head"><b>DOCUMENTS <span>{flt.length}</span></b>{sel.length > 0 && <button className="button red" onClick={() => sel.forEach(id => az(id))}><Sparkles size={16} /> Analyze ({sel.length})</button>}</div>
            {flt.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#999', fontWeight: 700 }}>No documents yet. Send an image or document to your WhatsApp.</div>}
            {flt.map(d => <DocumentRow key={d.id} doc={d} selected={sel.includes(d.id)} onToggle={() => setSel(s => s.includes(d.id) ? s.filter(x => x !== d.id) : [...s, d.id])} onAnalyze={() => az(d.id)} />)}
          </section>
        </div>}

        {page === 'File Manager' && <div>
          <div className="manager-head"><div className="folderbox"><Folder /><b>All</b><small>{docs.length}</small></div></div>
          <section className="table-card"><div className="table-head"><b>RECENT</b></div>{docs.slice(0, 10).map(d => <div className="row" key={d.id}><div className="fileicon"><FileText size={20} /></div><div className="filename"><b>{d.filename}</b><small>{d.sender}</small></div><ChevronRight /></div>)}</section>
        </div>}

        {page === 'Stats' && <div>
          <section className="metrics"><M n={docs.length} l="Total" c="lime" /><M n={docs.filter(d => d.status === 'analyzed').length} l="Analyzed" /><M n={docs.filter(d => d.mime_type?.startsWith('image')).length} l="Images" c="yellow" /><M n={docs.filter(d => d.status === 'failed').length} l="Failed" c="red" /></section>
          <div className="chart-card"><div className="table-head"><b>STATUS</b></div><ResponsiveContainer width="100%" height={260}><BarChart data={['unanalyzed', 'processing', 'analyzed', 'failed'].map(s => ({ name: s, count: docs.filter(d => d.status === s).length }))}><CartesianGrid stroke="#ddd" strokeDasharray="4 4" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="count" fill="#c8f31d" stroke="#111" strokeWidth={2} /></BarChart></ResponsiveContainer></div>
        </div>}

        {page === 'Settings' && <SPage settings={settings} providers={providers}
          onSave={async (s: any) => { try { setSettings(await saveSettings(s)); f('Saved'); } catch { f('Failed'); } }}
          onAdd={async (p: Provider) => { try { await createProvider(p); setProviders((await getProviders()).items || []); f('Added'); } catch { f('Failed'); } }}
          onDel={async (n: string) => { try { await deleteProvider(n); setProviders((await getProviders()).items || []); } catch { /* */ } }} />}
      </main>
      {flash && <div className="toast"><Check size={17} />{flash}</div>}
    </div>
  );
}

function M({ n, l, c }: { n: number; l: string; c?: string }) { return <div className={'metric ' + (c || '')}><b>{n}</b><span>{l}</span></div>; }

function SPage(p: { settings: any; providers: Provider[]; onSave: (s: any) => void; onAdd: (p: Provider) => void; onDel: (n: string) => void }) {
  const [s, setS] = useState({ ...p.settings });
  const [tab, setTab] = useState('general');
  const [show, setShow] = useState(false);
  const [nn, setNn] = useState(''); const [nu, setNu] = useState(''); const [nk, setNk] = useState(''); const [nm, setNm] = useState('');
  const [presets, setPresets] = useState<any[]>([]); const [sp, setSp] = useState('');
  useEffect(() => { setS({ ...p.settings }); }, [p.settings]);
  useEffect(() => { fetch(API + '/api/provider-presets', { headers: ah() }).then(r => r.json()).then(d => setPresets(d.presets || [])).catch(() => { }); }, []);
  const pk = (k: string) => { setSp(k); const pr = presets.find(x => x.key === k); if (pr) { setNn(pr.name); setNu(pr.base_url); setNm(pr.models?.[0] || ''); setNk(''); } };
  return <div>
    <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>{['general', 'ai'].map(k => <button key={k} className={tab === k ? 'chip selected' : 'chip'} onClick={() => setTab(k)}>{k === 'general' ? 'General' : 'AI Engine'}</button>)}</div>
    {tab === 'general' && <div className="settings">
      <div className="setting"><div><b>THEME</b></div><select value={s.theme || 'system'} onChange={e => setS({ ...s, theme: e.target.value })} style={{ border: '2px solid #111', padding: '8px 12px', fontWeight: 900 }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
      <div className="setting"><div><b>LANGUAGE</b></div><select value={s.language || 'id'} onChange={e => setS({ ...s, language: e.target.value })} style={{ border: '2px solid #111', padding: '8px 12px', fontWeight: 900 }}><option value="id">Bahasa Indonesia</option><option value="en">English</option></select></div>
      <div className="setting"><div /><button className="button yellow" onClick={() => p.onSave(s)}><Check size={16} /> Save</button></div>
    </div>}
    {tab === 'ai' && <div className="settings">
      <div style={{ borderBottom: '2px solid #111', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b>AI PROVIDERS</b><button className="button" onClick={() => setShow(!show)}><Plus size={15} /> Add</button></div>
      {show && <div style={{ padding: 18, borderBottom: '1px solid #ddd' }}>
        <div style={{ marginBottom: 12 }}><small style={{ fontWeight: 900, display: 'block', marginBottom: 4 }}>Provider</small><select value={sp} onChange={e => pk(e.target.value)} style={{ border: '2px solid #111', padding: '9px 12px', fontWeight: 700, width: 280 }}><option value="">-- Choose --</option>{presets.map((p: any) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></div>
        {sp && presets.find(p => p.key === sp)?.models?.length > 0 && <div style={{ marginBottom: 12 }}><small style={{ fontWeight: 900 }}>Models</small><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>{presets.find(p => p.key === sp)!.models.map((m: string) => <button key={m} className={nm === m ? 'chip selected' : 'chip'} onClick={() => setNm(m)}>{m}</button>)}</div></div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
          <div><small style={{ fontWeight: 900 }}>Name</small><input value={nn} onChange={e => setNn(e.target.value)} style={{ border: '2px solid #111', padding: '6px 8px', width: 130 }} /></div>
          <div><small style={{ fontWeight: 900 }}>Base URL</small><input value={nu} onChange={e => setNu(e.target.value)} placeholder="https://api.openai.com/v1" style={{ border: '2px solid #111', padding: '6px 8px', width: 220 }} /></div>
          <div><small style={{ fontWeight: 900 }}>API Key</small><input type="password" value={nk} onChange={e => setNk(e.target.value)} style={{ border: '2px solid #111', padding: '6px 8px', width: 160 }} /></div>
          <div><small style={{ fontWeight: 900 }}>Model</small><input value={nm} onChange={e => setNm(e.target.value)} placeholder="gpt-4o" style={{ border: '2px solid #111', padding: '6px 8px', width: 150 }} /></div>
          <button className="button green" onClick={() => { p.onAdd({ name: nn, base_url: nu, model: nm, api_key: nk }); setShow(false); }} disabled={!nn}><Check size={15} /> Save</button>
        </div>
      </div>}
      {p.providers.length === 0 && !show && <div style={{ padding: 22, textAlign: 'center', color: '#999', fontWeight: 700 }}>No providers configured.</div>}
      {p.providers.map(prov => <div className="setting" key={prov.name}><div><b>{prov.name}</b><p>{prov.base_url || ''} {prov.model ? '· ' + prov.model : ''}</p></div><button className="button red" onClick={() => p.onDel(prov.name)}><Trash2 size={14} /> Remove</button></div>)}
    </div>}
  </div>;
}


// ==================== Document Row with Preview ====================
function DocumentRow({ doc, selected, onToggle, onAnalyze }: { doc: Doc; selected: boolean; onToggle: () => void; onAnalyze: () => void }) {
  const [preview, setPreview] = useState(false);
  const isImage = doc.mime_type?.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(doc.filename||'');
  const isPdf = doc.mime_type === 'application/pdf' || doc.filename?.toLowerCase().endsWith('.pdf');
  const fileUrl = (import.meta.env.VITE_API_URL || '') + '/api/files/' + doc.id + '/raw';
  const icon = isImage ? '<svg>...</svg>' : isPdf ? 'PDF' : 'DOC';

  return (
    <>
      <div className="row" style={{ cursor: 'pointer' }} onClick={() => setPreview(!preview)}>
        <input type="checkbox" checked={selected} onChange={e => { e.stopPropagation(); onToggle(); }} onClick={e => e.stopPropagation()} />
        <div className="fileicon">{isImage ? <FileText size={20} /> : <FileText size={20} />}</div>
        <div className="filename">
          <b>{doc.filename || 'Untitled'}</b>
          <small>{doc.sender} · {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ''}{doc.metadata?.caption ? ' · ' + doc.metadata.caption : ''}</small>
        </div>
        <span className={`status ${doc.status}`} onClick={e => e.stopPropagation()}><i /> {doc.status}</span>
        <button className="analyze" onClick={e => { e.stopPropagation(); onAnalyze(); }}><Sparkles size={15} /></button>
      </div>
      {preview && (
        <div style={{ padding: '12px 18px', borderBottom: '2px solid #111', background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 13 }}>File Info</b>
              <div style={{ marginTop: 4, fontSize: 12, color: '#555' }}>
                <div>Type: {doc.mime_type || 'Unknown'}</div>
                <div>Size: {doc.metadata?.size ? Math.round(doc.metadata.size/1024) + ' KB' : 'Unknown'}</div>
                {doc.metadata?.caption && <div>Caption: {doc.metadata.caption}</div>}
              </div>
            </div>
            {isImage && (
              <div style={{ maxWidth: 200, maxHeight: 150, overflow: 'hidden', border: '2px solid #111', background: '#eee' }}>
                <img
                  src={fileUrl}
                  alt={doc.filename}
                  style={{ width: '100%', height: 'auto', objectFit: 'cover' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
            )}
            {isPdf && (
              <div style={{ border: '2px solid #111', padding: '12px 16px', background: '#f2504b', color: '#fff', fontWeight: 900, fontSize: 13 }}>
                📄 PDF Document
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
