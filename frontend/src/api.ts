// MemoriWA API client
const BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || '';

export function setToken(token: string | null) { if (token) localStorage.setItem('memoriwa_token', token); else localStorage.removeItem('memoriwa_token'); }
export function getToken(): string | null { return localStorage.getItem('memoriwa_token'); }

async function request(path: string, opts?: RequestInit) {
  const t = getToken();
  const headers: Record<string,string> = { 'Content-Type': 'application/json' };
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(BASE + path, { ...opts, headers: { ...headers, ...(opts?.headers as any||{})} });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function login(username: string, password: string) {
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!res.ok) throw new Error('Login failed');
  const data = await res.json();
  return data.access_token;
}

export function logout() { localStorage.removeItem('memoriwa_token'); }
export async function changePassword(current_password: string, new_password: string) { return request('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }); }
export async function getDocuments(q?: string, mode?: string) {
  const params = new URLSearchParams();
  params.set('limit', '100');
  if (q) params.set('q', q);
  if (mode) params.set('mode', mode);
  return request(`/api/documents?${params.toString()}`);
}
export async function uploadDocuments(files: File[], folder?: string) {
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  if (folder) fd.append('folder', folder);
  const t = getToken();
  const headers: Record<string, string> = {};
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(BASE + '/api/documents/upload', { method: 'POST', headers, body: fd });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function downloadGroupPdf(gid: string) {
  const t = getToken();
  const res = await fetch(BASE + `/api/groups/${encodeURIComponent(gid)}/export-pdf`, {
    headers: { Authorization: `Bearer ${t || ''}` }
  });
  if (!res.ok) throw new Error('Export PDF failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `laporan_${gid}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
export async function analyzeDocument(id: string) { return request(`/api/analysis/run/${id}`, { method: 'POST' }); }
export async function deleteDocument(id: string) { return request(`/api/documents/${id}`, { method: 'DELETE' }); }
export async function verifyDocuments(ids: string[], folder: string) { return request('/api/documents/verify', { method: 'POST', body: JSON.stringify({ ids, folder }) }); }
export async function updateGroup(gid: string, data: any) { return request(`/api/documents/group/${encodeURIComponent(gid)}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function updateDocument(id: string, data: any) { return request(`/api/documents/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function moveDocuments(ids: string[], folder: string) { return request('/api/documents/move', { method: 'POST', body: JSON.stringify({ ids, folder }) }); }
export async function renameFolder(oldName: string, newName: string) { return request('/api/folders/rename', { method: 'POST', body: JSON.stringify({ old: oldName, new: newName }) }); }
export async function deleteGroup(gid: string) { return request(`/api/documents/group/${encodeURIComponent(gid)}`, { method: 'DELETE' }); }
export async function identifyDocument(id: string) { return request(`/api/documents/${encodeURIComponent(id)}/identify`, { method: 'POST' }); }
export async function identifyGroup(gid: string) { return request(`/api/documents/group/${encodeURIComponent(gid)}/identify`, { method: 'POST' }); }

export async function createShare(target_type: string, target_id: string, expires_in_hours?: number, password?: string) {
  return request('/api/shares', { method: 'POST', body: JSON.stringify({ target_type, target_id, expires_in_hours, password }) });
}
export async function getShares() { return request('/api/shares'); }
export async function deleteShare(id: string) { return request(`/api/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

export async function createSmartCollection(name: string, query?: string, folder?: string, doc_type?: string) {
  return request('/api/smart-collections', { method: 'POST', body: JSON.stringify({ name, query, folder, doc_type }) });
}
export async function getSmartCollections() { return request('/api/smart-collections'); }
export async function deleteSmartCollection(id: string) { return request(`/api/smart-collections/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

export async function getSettings() { return request('/api/settings'); }
export async function saveSettings(data: any) { return request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }); }

export async function getProviders() { return request('/api/providers'); }
export async function createProvider(data: any) { return request('/api/providers', { method: 'POST', body: JSON.stringify(data) }); }
export async function deleteProvider(name: string) { return request(`/api/providers/${name}`, { method: 'DELETE' }); }
export async function updateProvider(name: string, data: any) { return request(`/api/providers/${name}`, { method: 'PUT', body: JSON.stringify(data) }); }

// WAHA functions - NO session parameter needed
export async function startWaha() { return request('/api/waha/start', { method: 'POST' }); }
export async function stopWaha() { return request('/api/waha/stop', { method: 'POST' }); }
export async function logoutWaha() { return request('/api/waha/logout', { method: 'POST' }); }
export async function getWahaStatus() { return request('/api/waha/status'); }
export async function getWahaQr() { return request('/api/waha/qr'); }
export async function getWahaHealth() { return request('/api/waha/health'); }
