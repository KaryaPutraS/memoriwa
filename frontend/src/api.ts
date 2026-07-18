const BASE = import.meta.env.VITE_API_URL || '';

let bearerToken: string | null = sessionStorage.getItem('token');

export function setToken(token: string | null) {
  bearerToken = token;
  if (token) sessionStorage.setItem('token', token);
  else sessionStorage.removeItem('token');
}

export function getToken(): string | null {
  return bearerToken;
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Auth
export async function login(username: string, password: string) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.access_token);
  return data;
}

export function logout() {
  setToken(null);
}

// Documents
export async function getDocuments(params?: {
  q?: string; status?: string; limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.q) sp.set('q', params.q);
  if (params?.status) sp.set('status', params.status);
  if (params?.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return request(`/api/documents${qs ? '?' + qs : ''}`);
}

export async function getDocument(id: string) {
  return request(`/api/documents/${encodeURIComponent(id)}`);
}

export async function deleteDocument(id: string) {
  return request(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Analysis
export async function analyzeDocument(id: string) {
  return request(`/api/analysis/run/${encodeURIComponent(id)}`, {
    method: 'POST',
  });
}

export async function analyzeAll() {
  return request('/api/analysis/run', { method: 'POST' });
}

// Stats
export async function getStats() {
  return request('/api/stats');
}

// Settings
export async function getSettings() {
  return request('/api/settings');
}

export async function saveSettings(data: {
  theme?: string; language?: string; auto_analyze?: boolean;
}) {
  return request('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// Providers
export async function getProviders() {
  return request('/api/providers');
}

export async function createProvider(data: {
  name: string; base_url?: string; api_key?: string; model?: string;
}) {
  return request('/api/providers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateProvider(name: string, data: {
  name: string; base_url?: string; api_key?: string; model?: string;
}) {
  return request(`/api/providers/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteProvider(name: string) {
  return request(`/api/providers/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

// WAHA
export async function testWahaConnection() {
  return request('/api/waha/test', { method: 'POST' });
}

// Sessions
export async function getSessions() {
  return request('/api/sessions');
}

// WebSocket
export function connectWebSocket(
  onEvent: (msg: any) => void,
  socketRef?: { current: WebSocket | null },
): WebSocket | null {
  const wsBase = import.meta.env.VITE_WS_URL || BASE.replace(/^http/, 'ws');
  if (!bearerToken) return null;
  const url = `${wsBase}/ws`;
  const socket = new WebSocket(url, [`access_token.${bearerToken}`]);
  if (socketRef) socketRef.current = socket;
  socket.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  socket.onclose = () => {
    if (socketRef) socketRef.current = null;
    setTimeout(() => {
      if (bearerToken) connectWebSocket(onEvent, socketRef);
    }, 5000);
  };
  return socket;
}
