// ===== SUPABASE CONFIG =====
const SB_URL = 'https://pvkakagdizthpizykbqu.supabase.co';
const SB_ANON = 'sb_publishable_8ZwrmJmmnxcsPcS2SInf6g_qfqJWs9P';
// sb is created in index.html via the Supabase JS library


// ===== STATE =====
let currentUser = null;
let assets = [];
let allTickets = [];
let profiles = [];
let allActivity = [];
let currentPage = 'login';
let currentSection = 'my-assigned';
let searchQuery = '';
let kbBuf = '';
let loginMode = 'signin'; // 'signin' | 'signup'
let selectedIds = new Set();
let statusFilter = '';
let assetPage = 50; // Assets page count
let editorPage = 50; // Editor available count
let searchTimer = null;
let lastSyncHash = '';
let syncing = false;
let setsData = [];
let setAssetsData = [];
let realtimeChannel = null;
const SHEET_URL = '1-d7CZvE2mAC0lFYiHaAg49uxUETtv49-aXhETNbH6dg';
const SHEET_GID = '1725432366';
const SYNC_INTERVAL = 300000; // 5 min

// ===== SUPABASE API HELPERS =====
function sbHeaders(token) {
  const h = { 'apikey': SB_ANON, 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function sbFetch(path, opts = {}) {
  const token = localStorage.getItem('supabase_token');
  const res = await fetch(`${SB_URL}${path}`, {
    ...opts,
    headers: { ...sbHeaders(token), ...opts.headers },
  });
  if (res.status === 401 && token) {
    // Try refresh
    const refreshed = await refreshSession();
    if (refreshed) {
      const newToken = localStorage.getItem('supabase_token');
      const res2 = await fetch(`${SB_URL}${path}`, {
        ...opts,
        headers: { ...sbHeaders(newToken), ...opts.headers },
      });
      return res2;
    }
    // Refresh failed, logout
    localStorage.removeItem('supabase_token');
    localStorage.removeItem('supabase_refresh');
    localStorage.removeItem('supabase_user');
    currentUser = null;
    window.location.hash = 'login';
    throw new Error('Session expired');
  }
  return res;
}

async function sbGet(path) {
  const res = await sbFetch(`/rest/v1${path}`);
  if (!res.ok) { const e = await res.json().catch(() => ({ message: res.statusText })); throw new Error(e.message); }
  return res.json();
}
async function sbGetAll(path) {
  const STEP = 1000;
  const sep = path.includes('?') ? '&' : '?';
  const first = await sbGet(`${path}${sep}limit=${STEP}&offset=0`);
  if (!first || !first.length) return [];
  if (first.length < STEP) return first;
  const pages = Math.ceil(4000 / STEP);
  const promises = [];
  for (let off = STEP; off < pages * STEP; off += STEP) {
    promises.push(sbGet(`${path}${sep}limit=${STEP}&offset=${off}`));
  }
  const rest = await Promise.all(promises);
  return first.concat(...rest.filter(r => r && r.length));
}

async function sbPatch(path, body) {
  const res = await sbFetch(`/rest/v1${path}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Prefer': 'return=representation' },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({ message: res.statusText })); throw new Error(e.message); }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function sbPost(path, body) {
  const res = await sbFetch(`/rest/v1${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Prefer': 'return=representation' },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({ message: res.statusText })); throw new Error(e.message); }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function sbDelete(path) {
  const res = await sbFetch(`/rest/v1${path}`, { method: 'DELETE' });
  if (!res.ok) { const e = await res.json().catch(() => ({ message: res.statusText })); throw new Error(e.message); }
  return res.json();
}

// ===== AUTH (using Supabase JS library from CDN) =====
// Bridge: keep raw fetch helpers working by syncing token to our localStorage key
sb.auth.onAuthStateChange((event, session) => {
  if (session) {
    localStorage.setItem('supabase_token', session.access_token);
    localStorage.setItem('supabase_refresh', session.refresh_token);
  }
});

async function finishAuth(session, email) {
  localStorage.setItem('supabase_token', session.access_token);
  localStorage.setItem('supabase_refresh', session.refresh_token);
  let profile = null;
  try {
    const userRes = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${session.user.id}&select=*`, {
      headers: { 'apikey': SB_ANON, 'Authorization': `Bearer ${session.access_token}` },
    });
    if (userRes.ok) { const p = await userRes.json(); profile = p[0] || null; }
    if (!profile) {
      const createRes = await fetch(`${SB_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: { 'apikey': SB_ANON, 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ id: session.user.id, email, name: session.user.user_metadata?.name || email.split('@')[0], role: 'editor' }),
      });
      if (createRes.ok) { const c = await createRes.json(); profile = Array.isArray(c) ? c[0] : c; }
    }
  } catch(e) { console.warn('Profile DB error, using virtual:', e); }
  if (!profile) profile = { id: session.user.id, email, name: session.user.user_metadata?.name || email.split('@')[0], role: 'editor' };
  localStorage.setItem('supabase_user', JSON.stringify(profile));
  return { session, user: profile };
}

async function signup(email, password, name) {
  let cleanEmail = email;
  if (!cleanEmail.includes('@')) cleanEmail = `${cleanEmail}@lionsgate.test`;
  const { data, error } = await sb.auth.signUp({
    email: cleanEmail,
    password,
    options: { data: { name: name || cleanEmail.split('@')[0] }, emailRedirectTo: `${location.origin}/verified.html` },
  });
  if (error) {
    const msg = error.message;
    if (msg.includes('already been registered') || msg.includes('already exists') || msg.includes('User already registered')) {
      document.getElementById('ln-group').style.display = 'none';
      document.getElementById('login-btn').textContent = 'Sign In';
      document.getElementById('login-toggle-text').textContent = "Don't have an account?";
      document.getElementById('login-toggle').textContent = 'Sign Up';
      loginMode = 'signin';
      throw new Error('An account with this email already exists. Please sign in.');
    }
    if (msg.includes('rate limit') || msg.includes('Rate limit')) {
      // Bypass rate limit via SQL RPC, then sign in
      const res = await fetch(`${SB_URL}/rest/v1/rpc/create_auth_user`, {
        method: 'POST',
        headers: { 'apikey': SB_ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password, name: name || cleanEmail.split('@')[0] }),
      });
      if (res.ok) return signin(cleanEmail, password);
      const e = await res.json().catch(() => ({}));
      throw new Error('Signup failed: ' + (e.message || e.msg || 'RPC error'));
    }
    throw new Error(msg);
  }
  if (data.session) return finishAuth(data.session, cleanEmail);
  throw new Error('Account created! Check your email for the confirmation link, then sign in.');
}

async function signin(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message || 'Invalid credentials');
  return finishAuth(data.session, email);
}

async function signout() {
  if (realtimeChannel) { try { sb.removeChannel(realtimeChannel); } catch {} realtimeChannel = null; }
  try { await sb.auth.signOut(); } catch {}
  localStorage.removeItem('supabase_token');
  localStorage.removeItem('supabase_refresh');
  localStorage.removeItem('supabase_user');
  currentUser = null;
}

// Keep refreshSession for the raw fetch helper
async function refreshSession() {
  const { data, error } = await sb.auth.refreshSession();
  if (error || !data.session) return false;
  localStorage.setItem('supabase_token', data.session.access_token);
  localStorage.setItem('supabase_refresh', data.session.refresh_token);
  return true;
}

// ===== DATA LOADING =====
async function loadData() {
  try {
    const [a, t, p, ac, sd, sad] = await Promise.all([
      sbGetAll('/assets?select=*,editor:assigned_editor(id,name),reviewer:assigned_reviewer(id,name)&order=sheet_row.asc'),
      sbGet('/tickets?select=*,creator:created_by(id,name),assignee:assigned_to(id,name),asset:asset_id(title)&order=created_at.desc'),
      sbGet('/profiles?select=*&order=name.asc'),
      sbGet('/activity_log?select=*,user:user_id(id,name),asset:asset_id(title)&order=created_at.desc&limit=100'),
      sbGet('/sets?order=name.asc'),
      sbGet('/set_assets?select=*,asset:asset_id(*)'),
    ]);
    assets = (a || []).map(x => ({ ...x, editor_name: x.editor?.name, reviewer_name: x.reviewer?.name }));
    allTickets = (t || []).map(x => ({ ...x, creator_name: x.creator?.name, assignee_name: x.assignee?.name, asset_title: x.asset?.title }));
    profiles = p || [];
    // Sync currentUser role from latest profile data (in case it changed externally)
    if (myId()) {
      const myProfile = profiles.find(x => x.id === myId());
      if (myProfile && myProfile.role !== currentUser.role) {
        currentUser = { ...currentUser, role: myProfile.role, name: myProfile.name, email: myProfile.email, is_active: myProfile.is_active };
        localStorage.setItem('supabase_user', JSON.stringify(currentUser));
      }
    }
    allActivity = (ac || []).map(x => ({ ...x, user_name: x.user?.name, asset_title: x.asset?.title }));
    setsData = sd || [];
    setAssetsData = (sad || []).map(x => ({ ...x, asset_title: x.asset?.title, asset_ref: x.asset?.asset_ref, editor_status: x.asset?.editor_status }));
    if (myId()) await loadNotifs();
  } catch (e) { console.error('Load error:', e); }
}

function myId() { return currentUser?.id; }
function myRole() { return currentUser?.role || 'editor'; }

// ===== INIT =====
async function init() {
  // Show loading state immediately
  const app = document.getElementById('app');
  if (app) app.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;"><div style="width:36px;height:36px;border:3px solid #e5e7eb;border-top-color:#735c00;border-radius:50%;animation:spin .8s linear infinite;"></div><span style="color:#888;font-size:15px;">Loading...</span></div>';
  // Restore session
  let session = null;
  try {
    const s = await sb.auth.getSession();
    session = s.data.session;
  } catch {}
  if (!session) {
    // Try restoring from our own token storage
    const savedUser = localStorage.getItem('supabase_user');
    const savedToken = localStorage.getItem('supabase_token');
    const savedRefresh = localStorage.getItem('supabase_refresh');
    if (savedUser && savedToken) {
      try {
        const { data } = await sb.auth.setSession({ access_token: savedToken, refresh_token: savedRefresh });
        session = data.session;
      } catch {}
    }
  }
  if (session) {
    const savedUser = localStorage.getItem('supabase_user');
    if (savedUser) {
      currentUser = JSON.parse(savedUser);
    } else {
      currentUser = { id: session.user.id, email: session.user.email, name: session.user.user_metadata?.name || session.user.email.split('@')[0], role: 'editor' };
    }
    localStorage.setItem('supabase_token', session.access_token);
    localStorage.setItem('supabase_refresh', session.refresh_token);
  } else {
    localStorage.removeItem('supabase_token');
    localStorage.removeItem('supabase_refresh');
    localStorage.removeItem('supabase_user');
  }
  // Prevent back-button access after logout
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && !currentUser) { location.hash = 'login'; }
  });
  // Single notification outside-click listener
  document.addEventListener('click', (e) => {
    const np = document.getElementById('np');
    if (np && np.style.display !== 'none' && !np.contains(e.target) && !e.target.closest('[onclick*="renderNotifPanel"]')) {
      np.style.display = 'none'; notifOpen = false;
    }
  });
  document.addEventListener('keydown', handleKey);
  go(location.hash.slice(1) || 'login');
  window.addEventListener('hashchange', () => go(location.hash.slice(1) || 'login'));
  // Periodic sheet check
  setInterval(checkSheet, SYNC_INTERVAL);
  // Real-time subscription for sets + set_assets
  if (sb) {
    realtimeChannel = sb.channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sets' }, () => {
        if (currentUser) loadData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'set_assets' }, () => {
        if (currentUser) loadData();
      })
      .subscribe();
  }
}

// ===== ROUTER =====
function go(page) {
  // If already logged in and trying to go to login, redirect to dashboard
  if (page === 'login' && currentUser) { page = 'dashboard'; location.hash = 'dashboard'; }
  if (page === 'login') { currentPage = 'login'; render(); return; }
  if (!currentUser) { location.hash = 'login'; return; }
  if (page === 'reviewer' && myRole() === 'editor') page = 'access-denied';
  currentPage = page;
  loadData().then(() => {
    render();
    syncSearch();
    // Auto-fetch missing thumbnails if toggle enabled
    if (thumbAutoFetch && !page.startsWith('asset-detail')) {
      const missing = assets.filter(a => !a.thumbnail_base64 || a.thumbnail_base64.length <= 50);
      if (missing.length > 0) setTimeout(() => {
        const pEl = document.createElement('div');
        pEl.id = 'auto-thumb-bar';
        document.getElementById('app')?.appendChild(pEl);
        fetchWebThumbnails(pEl, false);
      }, 1000);
    }
  });
}

function render() {
  const app = document.getElementById('app');
  if (currentPage === 'login') { app.innerHTML = renderLogin(); attachLogin(); return; }
  app.innerHTML = layout();
  document.getElementById('pc').innerHTML = pageContent();
  attachAll();
  syncSearch();
}

function layout() {
  const items = [
    { id: 'editor', label: 'Dashboard', icon: 'dashboard', roles: ['editor', 'reviewer', 'admin'] },
    { id: 'editor-list', label: 'Editor', icon: 'edit', roles: ['editor', 'reviewer', 'admin'] },
    { id: 'sets', label: 'Sets', icon: 'folder_special', roles: ['editor', 'reviewer', 'admin'] },
    { id: 'reviewer', label: 'Reviewer', icon: 'visibility', roles: ['reviewer', 'admin'] },
    { id: 'assets', label: 'Assets', icon: 'inventory_2', roles: ['editor', 'reviewer', 'admin'] },
    { id: 'tickets', label: 'Tickets', icon: 'local_activity', roles: ['editor', 'reviewer', 'admin'] },
    { id: 'activity', label: 'Activity', icon: 'monitoring', roles: ['editor', 'reviewer', 'admin'] },
    { id: 'admin', label: 'Admin', icon: 'settings', roles: ['admin'] },
  ];
  const vis = items.filter(i => i.roles.includes(myRole()));
  const active = currentPage === 'asset-detail' ? 'assets' : currentPage;
  const pendingCount = assets.filter(a => a.reviewer_status === 'Need to Review').length;
  return `<div class="app-layout"><aside class="sidebar"><div class="sidebar-brand"><h1>Lionsgate</h1><p>Asset Management</p></div><nav class="sidebar-nav">${vis.map(i => `<a href="#${i.id}" class="${active === i.id ? 'active' : ''}"><span class="material-symbols-outlined icon">${i.icon}</span>${i.label}${i.id === 'reviewer' && pendingCount ? `<span class="badge">${pendingCount}</span>` : ''}</a>`).join('')}</nav><div class="sidebar-footer"><a href="#" id="logout-btn"><span class="material-symbols-outlined icon">logout</span> Sign Out</a></div></aside><div class="main-content"><header class="topbar"><div class="topbar-left"><div class="search-box"><span class="material-symbols-outlined icon">search</span><input type="text" placeholder="Search assets (/)" id="gs" value="${esc(searchQuery)}" /></div></div><div class="topbar-right"><button class="icon-btn" onclick="globalSearch()" title="Global search (Ctrl+K)"><span class="material-symbols-outlined">search</span></button><button class="icon-btn" onclick="showShortcuts()" title="Shortcuts"><span class="material-symbols-outlined">keyboard</span></button><button class="sync-btn" id="sync-btn" onclick="syncFromSheet()" title="Sync data from Google Sheets"><span class="material-symbols-outlined" id="sync-icon" style="font-size:16px;">sync</span> Sync</button><button class="icon-btn" title="Notifications" onclick="renderNotifPanel()" style="position:relative;"><span class="material-symbols-outlined">notifications</span>${notifCount() ? `<span class="notif-badge" style="position:absolute;top:2px;right:2px;">${notifCount()}</span>` : ''}</button><div style="width:1px;height:24px;background:var(--outline);margin:0 4px;"></div><div class="user-avatar"><img src="https://ui-avatars.com/api/?name=${esc(currentUser.name)}&background=d4af37&color=fff" /><div><div class="name">${esc(currentUser.name)}</div><div class="role">${myRole().charAt(0).toUpperCase()+myRole().slice(1)}</div></div></div></div></header><div class="page-content" id="pc"></div></div></div>`;
}

function pageContent() {
  switch (currentPage) {
    case 'editor': return renderEditor();
    case 'editor-list': return renderEditorList();
    case 'sets': return renderSets();
    case 'reviewer': return renderReviewer();
    case 'assets': return renderAssets();
    case 'asset-detail': return renderAssetDetail(parseInt(location.hash.split('?')[1]?.split('=')[1]) || 1);
    case 'tickets': return renderTickets();
    case 'activity': return renderActivity();
    case 'admin': return renderAdmin();
    case 'access-denied': return '<div class="access-guard"><span class="material-symbols-outlined" style="font-size:64px;color:var(--error);margin-bottom:20px;">block</span><h2>Access Denied</h2><p>You don\'t have permission here.</p><a href="#editor" class="btn-primary" style="margin-top:24px;text-decoration:none;">Go to Editor</a></div>';
    default: return '<div style="padding:40px;text-align:center;">Page not found</div>';
  }
}

// ===== LOGIN =====
function renderLogin() {
  return `<div class="app-layout" style="min-height:100vh;align-items:center;justify-content:center;background:radial-gradient(ellipse at top right, var(--surface-container-highest), var(--surface-container-low));"><div style="background:var(--surface-container-lowest);border:1px solid var(--outline);border-radius:var(--radius-lg);padding:var(--space-xl);width:100%;max-width:400px;text-align:center;"><div style="margin-bottom:var(--space-md);"><div style="width:64px;height:64px;border-radius:50%;background:var(--surface-container-low);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-md);border:1px solid rgba(208,197,175,0.3);"><span class="material-symbols-outlined" style="font-size:32px;color:var(--primary);">movie</span></div><h1 style="font-size:22px;font-weight:600;color:var(--primary);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">Lionsgate</h1><p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--on-surface-variant);opacity:0.7;">Asset Management</p></div><div style="height:1px;background:var(--outline);margin:var(--space-lg) 0;"></div><div id="login-form"><div id="login-msg" style="font-size:13px;margin-bottom:12px;display:none;"></div><div class="form-group" style="text-align:left;"><label style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--secondary);display:block;margin-bottom:6px;">Email</label><input type="email" id="le" style="width:100%;padding:12px;border:1px solid var(--outline);border-radius:var(--radius);font-size:15px;background:var(--surface);box-sizing:border-box;" placeholder="you@example.com" /></div><div class="form-group" style="text-align:left;"><label style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--secondary);display:block;margin-bottom:6px;">Password</label><input type="password" id="lp" style="width:100%;padding:12px;border:1px solid var(--outline);border-radius:var(--radius);font-size:15px;background:var(--surface);box-sizing:border-box;" /></div><div class="form-group" id="ln-group" style="text-align:left;display:none;"><label style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--secondary);display:block;margin-bottom:6px;">Name</label><input type="text" id="ln" style="width:100%;padding:12px;border:1px solid var(--outline);border-radius:var(--radius);font-size:15px;background:var(--surface);box-sizing:border-box;" placeholder="John Doe" /></div><a href="#" id="forgot-link" style="display:block;font-size:13px;color:var(--primary);font-weight:500;text-decoration:none;margin:4px 0 12px;text-align:right;cursor:pointer;">Forgot Password?</a><button id="login-btn" class="btn-full btn-gold" style="margin-top:0;">Sign In</button><p style="font-size:13px;color:var(--secondary);margin-top:16px;"><span id="login-toggle-text">Don't have an account?</span> <a href="#" id="login-toggle" style="color:var(--primary);font-weight:600;text-decoration:none;">Sign Up</a></p></div></div></div>`;
}

function forgotPassword() {
  const email = document.getElementById('le').value.trim();
  if (!email) { showMsg('Enter your email first', 'var(--error)'); return; }
  const link = document.getElementById('forgot-link');
  const origHTML = link.innerHTML;
  const origPtr = link.style.pointerEvents;
  link.innerHTML = '<span class="spinner"></span> Sending...';
  link.style.pointerEvents = 'none';
  const baseUrl = location.href.includes('/') ? location.href.substring(0, location.href.lastIndexOf('/') + 1) : location.href;
  const redirectTo = baseUrl + 'reset-password.html';
  sb.auth.resetPasswordForEmail(email, { redirectTo })
    .then(({ error }) => {
      link.style.display = 'none';
      if (error) { showMsg(error.message, 'var(--error)'); link.style.display = 'block'; link.innerHTML = origHTML; link.style.pointerEvents = origPtr; }
      else showMsg('Check your email for the reset link.', 'var(--success)');
    }).catch(e => {
      link.style.display = 'block'; link.innerHTML = origHTML; link.style.pointerEvents = origPtr;
      showMsg(e.message || 'Something went wrong', 'var(--error)');
    });
}

function attachLogin() {
  document.getElementById('login-btn').onclick = handleLogin;
  document.getElementById('forgot-link').onclick = (e) => { e.preventDefault(); forgotPassword(); };
  document.getElementById('login-toggle').onclick = (e) => {
    e.preventDefault();
    loginMode = loginMode === 'signin' ? 'signup' : 'signin';
    document.getElementById('ln-group').style.display = loginMode === 'signup' ? 'block' : 'none';
    document.getElementById('login-btn').textContent = loginMode === 'signup' ? 'Sign Up' : 'Sign In';
    document.getElementById('login-toggle-text').textContent = loginMode === 'signup' ? 'Already have an account?' : "Don't have an account?";
    document.getElementById('login-toggle').textContent = loginMode === 'signup' ? 'Sign In' : 'Sign Up';
  };
  ['le', 'lp', 'ln'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  });
}

async function handleLogin() {
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'Please wait...';
  const email = document.getElementById('le').value.trim();
  const password = document.getElementById('lp').value;
  const name = document.getElementById('ln')?.value.trim();
  const msg = document.getElementById('login-msg');
  msg.style.display = 'none';
  if (!email || !password) { showMsg('Email and password required', 'red'); btn.disabled = false; btn.textContent = loginMode === 'signup' ? 'Sign Up' : 'Sign In'; return; }
  try {
    if (loginMode === 'signup') {
      const result = await signup(email, password, name);
      if (result.user) {
        currentUser = result.user;
        location.hash = 'editor';
        return;
      }
      showMsg('Account created! You can now sign in.', '#22c55e');
      loginMode = 'signin';
      document.getElementById('ln-group').style.display = 'none';
      document.getElementById('login-btn').textContent = 'Sign In';
      document.getElementById('login-toggle-text').textContent = "Don't have an account?";
      document.getElementById('login-toggle').textContent = 'Sign Up';
      return;
    }
    const { user } = await signin(email, password);
    currentUser = user;
    location.hash = 'editor';
  } catch (e) { showMsg(e.message, 'var(--error)'); }
  btn.disabled = false;
  btn.textContent = loginMode === 'signup' ? 'Sign Up' : 'Sign In';
}

function showMsg(text, color) {
  const el = document.getElementById('login-msg');
  el.textContent = text;
  el.style.display = 'block';
  el.style.color = color;
}

// ===== KEYBOARD SHORTCUTS =====
function handleKey(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); globalSearch(); return; }
  if (e.key === 'Escape') { document.getElementById('searchOverlay')?.remove(); document.querySelectorAll('.modal-overlay').forEach(m => m.remove()); return; }
  if (e.key === '/' && !e.ctrlKey) { e.preventDefault(); document.getElementById('gs')?.focus(); return; }
  if (e.key === '?') { showShortcuts(); return; }
  if (e.key === 'g') { kbBuf = 'g'; setTimeout(() => kbBuf = '', 800); return; }
  if (kbBuf === 'g') { kbBuf = ''; const m = { e: 'editor', r: 'reviewer', a: 'assets', t: 'tickets', v: 'activity', m: 'admin' }; if (m[e.key]) location.hash = m[e.key]; }
}

function showShortcuts() {
  const d = document.createElement('div'); d.className = 'modal-overlay'; d.style.display = 'flex';
  d.innerHTML = `<div class="modal" style="max-width:450px;"><div class="modal-header"><h3>Shortcuts</h3><button class="modal-close" onclick="this.closest('.modal-overlay').remove()"><span class="material-symbols-outlined">close</span></button></div><div class="modal-body" style="display:grid;grid-template-columns:auto 1fr;gap:12px 20px;font-size:14px;"><span style="background:var(--surface-container);padding:2px 8px;border-radius:4px;font-family:monospace;font-weight:600;text-align:center;">Ctrl+K</span><span>Global search</span><span style="background:var(--surface-container);padding:2px 8px;border-radius:4px;font-family:monospace;font-weight:600;text-align:center;">g</span><span>then e/r/a/t/v/m to navigate</span><span style="background:var(--surface-container);padding:2px 8px;border-radius:4px;font-family:monospace;font-weight:600;text-align:center;">/</span><span>Search assets</span><span style="background:var(--surface-container);padding:2px 8px;border-radius:4px;font-family:monospace;font-weight:600;text-align:center;">?</span><span>This help</span><span style="background:var(--surface-container);padding:2px 8px;border-radius:4px;font-family:monospace;font-weight:600;text-align:center;">Esc</span><span>Close modal</span></div></div>`;
  document.body.appendChild(d);
}

// ===== FILTER =====
function filter(list) {
  if (!searchQuery) return list;
  const q = searchQuery.toLowerCase();
  return list.filter(a => (a.title||'').toLowerCase().includes(q) || (a.editor_status||'').toLowerCase().includes(q) || (a.reviewer_status||'').toLowerCase().includes(q) || (a.first_air_date||'').includes(q));
}

function syncSearch() {
  const el = document.getElementById('gs');
  if (el) el.value = searchQuery;
}

// ===== BUNDLE LIST VIEW =====
function renderEditorList() {
  const list = filter(assets);
  const inSet = new Set();
  const setItems = {};
  for (const sa of setAssetsData) {
    inSet.add(sa.asset_id);
    if (!setItems[sa.set_id]) setItems[sa.set_id] = [];
    setItems[sa.set_id].push(sa);
  }
  const unbundled = list.filter(a => !inSet.has(a.id));
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let html = `<div class="page-header"><h2>Sets View</h2>${searchQuery ? `<span class="text-sm text-secondary">"${esc(searchQuery)}"</span>` : ''}</div>`;
  for (const set of setsData) {
    const items = (setItems[set.id]||[]).map(sa => {
      const a = sa.asset || assets.find(x => x.id === sa.asset_id);
      return a ? bundleRow(a) : '';
    }).filter(Boolean).join('');
    if (!items) continue;
    html += `<div class="collapse-header" onclick="toggleCollapse(this)"><span class="material-symbols-outlined arrow open">expand_more</span><strong style="flex:1;">${esc(set.name)}</strong><span class="badge-sm">${(setItems[set.id]||[]).length}</span></div><div class="collapse-body open"><div class="bundle-list">${items}</div></div>`;
  }
  if (unbundled.length) {
    html += `<div class="collapse-header" onclick="toggleCollapse(this)"><span class="material-symbols-outlined arrow open">expand_more</span><strong style="flex:1;">Unbundled</strong><span class="badge-sm">${unbundled.length}</span></div><div class="collapse-body open"><div class="bundle-list">${unbundled.map(a => bundleRow(a)).join('')}</div></div>`;
  }
  return html;
}
function bundleRow(a) {
  const assetId = a.asset_ref || a.title.split(' ')[0] || `#${a.id}`;
  return `<div class="br" onclick="location.hash='asset-detail?id=${a.id}'"><div class="br-info"><span class="br-title">${esc(assetId)}</span><span class="br-meta">${esc(a.title)} — ${a.first_air_date || '—'}</span></div><span class="status-badge ${cls(a.editor_status)}"><span class="dot"></span> ${a.editor_status}</span></div>`;
}

// ===== SETS =====
let setCreateMode = false;
let setEditName = '';
let setSearchVal = '';
let setNameVal = '';

function renderSets() {
  if (setCreateMode) return renderSetCreate();
  const inSet = new Set();
  for (const sa of setAssetsData) inSet.add(sa.asset_id);
  const bundledAssets = inSet.size;
  const unbundledCount = assets.length - bundledAssets;
  let html = `<div class="page-header"><h2>Sets</h2><button class="btn-primary" onclick="setCreateMode=true;render()"><span class="material-symbols-outlined" style="font-size:16px;">add</span> Create Set</button></div>`;
  html += `<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;"><div class="stat-card" style="flex:1;min-width:120px;"><div class="stat-card-header"><span class="label">Sets</span><span class="material-symbols-outlined stat-icon" style="color:var(--primary);">folder_special</span></div><div class="value">${setsData.length}</div></div><div class="stat-card" style="flex:1;min-width:120px;"><div class="stat-card-header"><span class="label">Bundled</span><span class="material-symbols-outlined stat-icon" style="color:#22c55e;">check_circle</span></div><div class="value">${bundledAssets}</div></div><div class="stat-card" style="flex:1;min-width:120px;"><div class="stat-card-header"><span class="label">Unbundled</span><span class="material-symbols-outlined stat-icon" style="color:var(--secondary);">radio_button_unchecked</span></div><div class="value">${unbundledCount}</div></div></div>`;
  if (!setsData.length) return html + empty('folder_special', 'No sets yet. Create one to group your assets.');
  for (const set of setsData) {
    const items = setAssetsData.filter(sa => sa.set_id === set.id);
    const rows = items.map(sa => {
      const a = sa.asset || assets.find(x => x.id === sa.asset_id) || {};
      const aid = a.asset_ref || (a.title||'').split(' ')[0] || `#${a.id}`;
      return `<div class="sr-item" style="padding:8px 14px;"><span style="flex:1;"><strong>${esc(aid)}</strong> <span class="text-sm text-secondary">${esc(a.title||'')}</span></span><span class="status-badge ${cls(a.editor_status||'')}" style="font-size:10px;padding:2px 8px;"><span class="dot"></span> ${a.editor_status||'Pending'}</span><button class="icon-btn" onclick="event.stopPropagation();removeFromSet(${a.id},${set.id})" title="Remove" style="width:24px;height:24px;"><span class="material-symbols-outlined" style="font-size:14px;">remove_circle</span></button></div>`;
    }).join('');
    html += `<div class="set-card"><div class="set-header"><div class="set-info"><strong class="set-name">${esc(set.name)}</strong><span class="badge-sm">${items.length}</span></div><div class="set-actions"><button class="btn-sm" onclick="renameSet(${set.id})"><span class="material-symbols-outlined" style="font-size:14px;">edit</span> Rename</button><button class="btn-sm" onclick="addAssetsToSet(${set.id})"><span class="material-symbols-outlined" style="font-size:14px;">add</span> Add</button><button class="btn-sm" style="color:var(--error);" onclick="deleteSet(${set.id})"><span class="material-symbols-outlined" style="font-size:14px;">delete</span> Delete</button></div></div><div class="set-assets">${rows}</div></div>`;
  }
  return html;
}

function renderSetCreate() {
  const isEdit = !!setEditName;
  const editSet = isEdit ? setsData.find(s => s.id === parseInt(setEditName)) : null;
  const inSet = isEdit ? new Set(setAssetsData.filter(sa => sa.set_id === parseInt(setEditName)).map(sa => sa.asset_id)) : new Set();
  const available = isEdit ? assets.filter(a => !inSet.has(a.id) || selectedIds.has(a.id)) : assets.filter(a => {
    // exclude assets already in any set
    return !setAssetsData.some(sa => sa.asset_id === a.id);
  });
  const title = isEdit ? `Edit Set: ${esc(editSet ? editSet.name : '')}` : 'Create Set';
  const selAssets = isEdit ? available.filter(a => selectedIds.has(a.id)) : selectedAssets;
  let html = `<div class="page-header"><h2>${title}</h2><button class="btn-sm" onclick="setCreateMode=false;setEditName='';setNameVal='';selectedAssets=[];clearSelection();render()"><span class="material-symbols-outlined" style="font-size:14px;">arrow_back</span> Back</button></div>`;
  html += `<div class="form-group"><label>Set Name</label><input type="text" id="newSetName" value="${esc(isEdit && editSet ? editSet.name : setNameVal)}" placeholder="e.g. June 1st Delivery" style="width:100%;max-width:400px;padding:10px 14px;border:1px solid var(--outline);border-radius:var(--radius);font-size:15px;background:var(--surface);" /></div>`;
  // Dump field
  html += `<div style="margin-top:16px;"><label>Asset IDs / Titles</label><textarea id="setDump" style="width:100%;padding:10px 14px;border:1px solid var(--outline);border-radius:var(--radius);font-size:13px;background:var(--surface);box-sizing:border-box;resize:vertical;font-family:monospace;" rows="6" placeholder="Paste asset IDs or titles, one per line&#10;e.g.&#10;DNGL001&#10;DNGL002&#10;FMLY001">${esc(setSearchVal)}</textarea></div>`;
  html += `<button class="btn-sm" onclick="resolveDump()" style="margin-top:6px;"><span class="material-symbols-outlined" style="font-size:14px;">search</span> Find &amp; Add (${setSearchVal.trim() ? setSearchVal.trim().split(/\s*[\n,]\s*/).filter(Boolean).length : 0} lines)</button>`;
  // Failed lookups
  if (setFailedLines.length) {
    html += `<div style="margin-top:8px;padding:8px 12px;border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius);background:rgba(239,68,68,0.04);font-size:12px;color:var(--error);">Not found: ${setFailedLines.map(l => `<strong>${esc(l)}</strong>`).join(', ')}</div>`;
  }
  // Selected assets list
  if (selAssets.length) {
    html += `<div style="margin:12px 0;"><div style="font-size:13px;font-weight:600;margin-bottom:6px;">Selected (${selAssets.length} of ${available.length} available):</div>`;
    html += selAssets.map(a => {
      const aid = a.asset_ref || a.title.split(' ')[0] || `#${a.id}`;
      return `<div class="sel-chip"><span><strong>${esc(aid)}</strong> <span class="text-sm text-secondary">${esc(a.title||'').slice(0,50)}</span></span><span class="material-symbols-outlined sel-remove" onclick="deselectAsset(${a.id})">close</span></div>`;
    }).join('');
    html += `</div>`;
  }
  html += `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;"><button class="btn-primary" onclick="confirmCreateSet()"><span class="material-symbols-outlined" style="font-size:16px;">check</span> ${isEdit?'Update':'Create'} (${selAssets.length})</button><button class="btn-sm" onclick="clearSelection();setCreateMode=false;setEditName='';setNameVal='';setSearchVal='';setFailedLines=[];selectedAssets=[];render()">Cancel</button></div>`;
  return html;
}

let setFailedLines = [];
let selectedAssets = []; // Array of asset objects for the current set creation

function resolveDump() {
  const text = document.getElementById('setDump')?.value || '';
  setSearchVal = text;
  const isEdit = !!setEditName;
  const inSet = isEdit ? new Set(setAssetsData.filter(sa => sa.set_id === parseInt(setEditName)).map(sa => sa.asset_id)) : new Set();
  const available = isEdit ? assets.filter(a => !inSet.has(a.id) || selectedIds.has(a.id)) : assets.filter(a => !setAssetsData.some(sa => sa.asset_id === a.id));
  const lines = text.split(/\s*[\n,]\s*/).map(s => s.trim()).filter(Boolean);
  const failed = [];
  const foundIds = new Set(selectedAssets.map(a => a.id));
  for (const line of lines) {
    const q = line.toLowerCase();
    const found = available.filter(a => (a.asset_ref||'').toLowerCase() === q || (a.title||'').toLowerCase() === q);
    if (!found.length) { failed.push(line); continue; }
    for (const a of found) {
      if (!foundIds.has(a.id)) { selectedAssets.push(a); foundIds.add(a.id); }
    }
  }
  setFailedLines = failed;
  if (!selectedAssets.length && !failed.length) { toast('No assets matched', 'info'); }
  else { toast(`Selected ${selectedAssets.length} asset(s)` + (failed.length ? `, ${failed.length} not found` : ''), failed.length ? 'warning' : 'success'); }
  const pc = document.getElementById('pc');
  if (pc) { pc.innerHTML = pageContent(); attachAll(); }
}

function deselectAsset(id) { selectedAssets = selectedAssets.filter(a => a.id !== id); render(); }

function clearSelection() { selectedAssets = []; selectedIds.clear(); render(); }

function escJS(s) { return s.replace(/'/g, "\\'"); }

async function confirmCreateSet() {
  const name = document.getElementById('newSetName')?.value?.trim();
  if (!name) { toast('Set name required', 'error'); return; }
  const wasEdit = !!setEditName;
  const assetsToTag = wasEdit ? [...selectedIds] : selectedAssets.map(a => a.id);
  if (!assetsToTag.length) { toast('Select at least one asset', 'error'); return; }
  try {
    if (wasEdit) {
      const setId = parseInt(setEditName);
      const prevRows = await sbGet(`/set_assets?select=asset_id&set_id=eq.${setId}`);
      const prevIds = (prevRows||[]).map(r => r.asset_id);
      const removed = prevIds.filter(id => !selectedIds.has(id));
      for (const id of removed) {
        await sbDelete(`/set_assets?set_id=eq.${setId}&asset_id=eq.${id}`);
      }
      for (const id of assetsToTag) {
        if (!prevIds.includes(id)) {
          await sbPost('/set_assets', { set_id: setId, asset_id: id });
        }
      }
    } else {
      const set = await sbPost('/sets', { name });
      const setId = set.id;
      for (const id of assetsToTag) {
        await sbPost('/set_assets', { set_id: setId, asset_id: id });
      }
    }
    selectedIds.clear();
    selectedAssets = [];
    setCreateMode = false;
    setEditName = '';
    setNameVal = '';
    setFailedLines = [];
    toast(wasEdit ? `Set updated` : `Set "${name}" created with ${assetsToTag.length} assets`, 'success');
    await loadData(); render();
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

function addAssetsToSet(setId) {
  setEditName = String(setId);
  selectedAssets = [];
  const ids = setAssetsData.filter(sa => sa.set_id === setId).map(sa => sa.asset_id);
  selectedIds = new Set(ids);
  setCreateMode = true;
  render();
}

async function renameSet(setId) {
  const set = setsData.find(s => s.id === setId);
  if (!set) return;
  const name = prompt('New name for "' + set.name + '":');
  if (!name || !name.trim() || name.trim() === set.name) return;
  try {
    await sbPatch(`/sets?id=eq.${setId}`, { name: name.trim() });
    toast(`Renamed to "${name.trim()}"`, 'success');
    await loadData(); render();
  } catch (e) { toast('Rename failed: ' + e.message, 'error'); }
}

async function removeFromSet(assetId, setId) {
  try {
    await sbDelete(`/set_assets?set_id=eq.${setId}&asset_id=eq.${assetId}`);
    toast('Removed from set', 'info');
    await loadData(); render();
  } catch (e) { toast('Remove failed: ' + e.message, 'error'); }
}

async function deleteSet(setId) {
  const set = setsData.find(s => s.id === setId);
  if (!set) return;
  if (!confirm(`Delete set "${set.name}"?`)) return;
  try {
    await sbDelete(`/sets?id=eq.${setId}`);
    toast(`Set deleted`, 'success');
    await loadData(); render();
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}

// ===== EDITOR =====
function renderEditor() {
  const mine = filter(assets.filter(a => a.assigned_editor === myId()));
  const avail = filter(assets.filter(a => !a.assigned_editor));
  const sent = filter(assets.filter(a => a.assigned_editor === myId() && a.editor_status === 'Send for approval'));
  const reedit = filter(assets.filter(a => a.assigned_editor === myId() && a.editor_status === 'Re-Edit'));
  const availShown = avail.slice(0, editorPage);
  const availMore = avail.length - availShown.length;
  const tabs = { 'my-assigned': renderMine(mine), 'available': renderAvail(availShown)+(availMore>0?`<div style="text-align:center;padding:20px;"><button class="btn-primary" onclick="editorPage+=50;render()">Show 50 more (${availMore} remaining)</button></div>`:''), 'sent': sent.length ? grid(sent) : empty('outbox','No assets sent for review'), 'reedit': reedit.length ? grid(reedit) : empty('replay','No re-edits requested'), 'recent': feed(allActivity.slice(0,15)) };
  return `<div class="page-header"><h2>Editor Panel</h2>${searchQuery ? `<span class="text-sm text-secondary">"${esc(searchQuery)}"</span>` : ''}</div><div class="stats-grid">${[
    ['Uploaded','cloud_upload','#22c55e', assets.filter(a=>a.editor_status==='Uploaded').length],
    ['Pending','hourglass_empty','#3b82f6', assets.filter(a=>a.editor_status==='Pending').length],
    ['Issue','error_outline','var(--error)', assets.filter(a=>a.editor_status==='Issue').length],
    ['In Progress','edit_document','#e9c349', assets.filter(a=>a.editor_status==='Working').length],
    ['Re-Edit','sync_problem','var(--error)', reedit.length],
    ['For Approval','send','var(--primary)', sent.length],
    ['Total Mine','folder_open','var(--secondary)', mine.length],
  ].map(s => `<div class="stat-card"><div class="stat-card-header"><span class="label">${s[0]}</span><span class="material-symbols-outlined stat-icon" style="color:${s[2]};">${s[1]}</span></div><div class="value">${s[3]}</div></div>`).join('')}</div><div class="section-tabs">${['my-assigned','available','sent','reedit','recent'].map(t => `<a href="#" class="tab-link ${currentSection===t?'active':''}" data-sec="${t}"><span class="material-symbols-outlined icon">${t==='my-assigned'?'assignment_ind':t==='available'?'inbox':t==='sent'?'outbox':t==='reedit'?'replay':'history'}</span>${t.charAt(0).toUpperCase()+t.slice(1)}</a>`).join('')}</div><div class="two-col"><div class="col-main">${tabs[currentSection]||tabs['my-assigned']}</div><div class="col-side">${currentSection!=='recent'?feed():''}</div></div>`;
}

function groupByMonth(list) {
  const groups = {};
  for (const a of list) {
    const d = a.first_air_date || '';
    const parts = d.split('/');
    let key = 'Other';
    if (parts.length >= 2) {
      const m = parseInt(parts[0]);
      const y = parts.length >= 3 ? `20${parts[2]}` : '2026';
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      key = `${months[m-1]||m} ${y}`;
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  }
  const sorted = Object.keys(groups).sort((a,b) => {
    if (a === 'Other') return 1; if (b === 'Other') return -1;
    return 0; // Keep original order
  });
  // Sort months chronologically
  const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  sorted.sort((a,b) => {
    if (a === 'Other') return 1; if (b === 'Other') return -1;
    const [ma, ya] = a.split(' '); const [mb, yb] = b.split(' ');
    if (ya !== yb) return (parseInt(ya)||0) - (parseInt(yb)||0);
    return monthOrder.indexOf(ma) - monthOrder.indexOf(mb);
  });
  return sorted.map((key, i) => {
    const items = groups[key];
    const isFirst = i === 0 ? 'open' : '';
    const showAssign = !items[0]?.assigned_editor;
    return `<div class="collapse-header" onclick="toggleCollapse(this)"><span class="material-symbols-outlined arrow ${isFirst}">expand_more</span><strong style="flex:1;">${key}</strong><span class="badge-sm" style="margin:0;">${items.length}</span></div><div class="collapse-body ${isFirst}"><div class="asset-grid" style="padding-top:12px;">${items.map(a => card(a, showAssign)).join('')}</div></div>`;
  }).join('');
}

function renderMine(list) {
  if (!list.length) return empty('assignment_ind','No assets assigned. Claim from Available tab.');
  return `<div class="flex items-center justify-between mb-md"><h3 style="font-size:20px;font-weight:600;">My Assigned (${list.length})</h3></div>${groupByMonth(list)}`;
}

function renderAvail(list) {
  if (!list.length) return empty('inbox','All assets are assigned');
  return `<div class="flex items-center justify-between mb-md"><h3 style="font-size:20px;font-weight:600;">Available (${list.length})</h3></div>${groupByMonth(list)}`;
}

function toggleCollapse(header) {
  const arrow = header.querySelector('.arrow');
  const body = header.nextElementSibling;
  if (!body) return;
  const isOpen = body.classList.contains('open');
  if (isOpen) { body.classList.remove('open'); arrow.classList.remove('open'); }
  else { body.classList.add('open'); arrow.classList.add('open'); }
}

const thumbCache = new Map();
function card(a, showAssign, selectable) {
  const checked = selectedIds.has(a.id) ? 'checked' : '';
  const chk = selectable ? `<label class="chk-wrap" onclick="event.stopPropagation()"><input type="checkbox" ${checked} onchange="toggleSelect(${a.id})" /></label>` : '';
  const assetId = a.asset_ref || a.title.split(' ')[0] || `#${a.id}`;
  const title = (a.title || '').trim();
  let thumb = (a.thumbnail_base64 && a.thumbnail_base64.length > 50) ? a.thumbnail_base64 : '';
  const thumbKey = seriesPrefix(a) || title.toLowerCase();
  if (!thumb && title) {
    if (thumbWebCache[thumbKey]) thumb = thumbWebCache[thumbKey];
  }
  if (!thumb && title) {
    if (!thumbCache.has(thumbKey)) thumbCache.set(thumbKey, generateThumbnail(title));
    thumb = thumbCache.get(thumbKey);
  }
  const thumbHtml = thumb ? `<div class="card-thumb" style="background-image:url('${thumb}');"></div>` : '';
  return `<div class="asset-card${selectable?' selectable':''}" onclick="location.hash='asset-detail?id=${a.id}'">${chk}${thumbHtml}<div class="card-body"><div class="asset-card-top"><div class="ac-head"><strong class="asset-id">${esc(assetId)}</strong><span class="asset-title" title="${esc(a.title)}">${esc(a.title)}</span></div><span class="status-badge ${cls(a.editor_status)}"><span class="dot"></span> ${a.editor_status}</span></div><div class="asset-card-meta"><div class="meta-row"><span class="material-symbols-outlined icon">calendar_today</span><span>${a.first_air_date||'—'}</span></div><div class="meta-row"><span class="material-symbols-outlined icon">${a.video_location?'movie':'block'}</span><span>${a.video_location?'Avail':'Missing'}</span></div></div><div class="asset-card-footer" style="justify-content:${showAssign?'space-between':'flex-end'}">${showAssign?`<button class="btn-assign-me" data-id="${a.id}" onclick="event.stopPropagation();assignMe(${a.id})"><span class="material-symbols-outlined" style="font-size:14px;">assignment_ind</span> Assign Me</button>`:''}<a href="#asset-detail?id=${a.id}" onclick="event.stopPropagation();">Open <span class="material-symbols-outlined icon">arrow_forward</span></a></div></div></div>`;
}

function grid(list) {
  return `<div class="asset-grid">${list.map(a => card(a)).join('')}</div>`;
}

function empty(icon, text) {
  return `<div style="text-align:center;padding:60px 20px;color:var(--secondary);"><span class="material-symbols-outlined" style="font-size:48px;display:block;margin-bottom:16px;opacity:0.3;">${icon}</span><h3 style="font-weight:600;margin-bottom:8px;">${text}</h3></div>`;
}

function feed(items) {
  const list = items || allActivity.slice(0,10);
  if (!list.length) return '<div class="activity-feed"><div class="activity-feed-header"><h3>Activity Feed</h3></div><div class="feed-body"><div style="text-align:center;padding:20px;color:var(--secondary);">No activity yet.</div></div></div>';
  return `<div class="activity-feed"><div class="activity-feed-header"><h3>Activity Feed</h3><span class="live-badge"><span class="live-dot"></span>Live</span></div><div class="feed-body">${list.map(i => `<div class="feed-item"><div class="feed-icon ${actColor(i.action)}"><span class="material-symbols-outlined">${actIcon(i.action)}</span></div><div><p><strong>${i.user_name||'System'}</strong> ${i.action}</p><div class="time">${ago(i.created_at)}</div></div></div>`).join('')}</div></div>`;
}

function ago(d) {
  if (!d) return '';
  const diff = Math.floor((Date.now() - new Date(d+'Z'))/60000);
  if (diff<1) return 'Just now';
  if (diff<60) return `${diff}m ago`;
  if (diff<1440) return `${Math.floor(diff/60)}h ago`;
  return `${Math.floor(diff/1440)}d ago`;
}

function actIcon(a) {
  if (a.includes('approv')) return 'check';
  if (a.includes('Re-Edit')) return 'replay';
  if (a.includes('sent')||a.includes('Send')) return 'send';
  if (a.includes('ticket')) return 'confirmation_number';
  if (a.includes('synced')||a.includes('sheet')) return 'sync';
  if (a.includes('assign')||a.includes('Assign')) return 'assignment';
  if (a.includes('comment')) return 'chat';
  if (a.includes('delet')) return 'delete';
  if (a.includes('changed')||a.includes('→')) return 'edit';
  return 'circle';
}

function actColor(a) {
  if (a.includes('approv')) return 'green';
  if (a.includes('Re-Edit')||a.includes('delet')) return 'red';
  if (a.includes('sent')||a.includes('synced')||a.includes('assign')||a.includes('Assign')) return 'blue';
  return 'gold';
}

// ===== REVIEWER =====
function renderReviewer() {
  const pending = filter(assets.filter(a => a.reviewer_status === 'Need to Review'));
  return `<div class="page-header"><h2>Reviewer Panel</h2></div><div class="stats-grid">${[
    ['Need to Review','rate_review','#a855f7', pending.length],
    ['Reviewing','visibility','#3b82f6', assets.filter(a=>a.reviewer_status==='Reviewing').length],
    ['Approved','check_circle','#22c55e', assets.filter(a=>a.reviewer_status==='Approved').length],
    ['Re-Edit','sync_problem','var(--error)', assets.filter(a=>a.reviewer_status==='Re-Edit').length],
  ].map(s => `<div class="stat-card"><div class="stat-card-header"><span class="label">${s[0]}</span><span class="material-symbols-outlined stat-icon" style="color:${s[2]};">${s[1]}</span></div><div class="value">${s[3]}</div></div>`).join('')}</div><div class="two-col"><div class="col-main"><h3 style="font-size:20px;font-weight:600;margin-bottom:16px;">Pending Review</h3>${pending.length?pending.map(a => `<div class="review-card"><div class="flex items-center justify-between"><h4 style="font-size:16px;font-weight:600;cursor:pointer;" onclick="location.hash='asset-detail?id=${a.id}'">${esc(a.title)}</h4><span class="status-badge status-needreview"><span class="dot"></span> Need to Review</span></div><div class="flex items-center gap-md" style="font-size:13px;color:var(--secondary);margin:8px 0;"><span>From: <strong>${a.editor_name||'Unknown'}</strong></span><span>Air: ${a.first_air_date||'—'}</span></div><div class="actions"><button class="btn-approve" onclick="approveAsset(${a.id})"><span class="material-symbols-outlined" style="font-size:16px;">check</span> Approve</button><button class="btn-reedit-action" onclick="rejectAsset(${a.id})"><span class="material-symbols-outlined" style="font-size:16px;">replay</span> Re-Edit</button><button class="btn-outline" onclick="location.hash='asset-detail?id=${a.id}'" style="flex:1;padding:8px 16px;font-size:13px;font-weight:600;"><span class="material-symbols-outlined" style="font-size:16px;">open_in_new</span> View</button></div></div>`).join(''):empty('inbox','All caught up!')}</div><div class="col-side">${feed()}</div></div>`;
}

// ===== ASSETS LIBRARY =====
function renderAssets() {
  const list = filter(statusFilter ? assets.filter(a => a.editor_status === statusFilter) : assets);
  const stats = [
    ['All','apps', assets.length],
    ['Uploaded','cloud_upload','#22c55e', assets.filter(a=>a.editor_status==='Uploaded').length],
    ['Pending','hourglass_empty','#3b82f6', assets.filter(a=>a.editor_status==='Pending').length],
    ['Issue','error_outline','var(--error)', assets.filter(a=>a.editor_status==='Issue').length],
    ['Working','edit_document','#e9c349', assets.filter(a=>a.editor_status==='Working').length],
    ['Re-Edit','sync_problem','var(--error)', assets.filter(a=>a.editor_status==='Re-Edit').length],
  ];
  const active = statusFilter || 'All';
  const shown = list.slice(0, assetPage);
  const more = list.length - shown.length;
  return `<div class="page-header"><h2>Assets Library</h2><div class="flex items-center gap-md"><span class="text-sm text-secondary">${list.length} of ${assets.length}</span>${statusFilter ? `<button class="btn-sm" onclick="statusFilter='';assetPage=50;render()">Clear filter</button>` : ''}</div></div><div class="stats-grid">${stats.map(s => {const label=s[0],icon=s[1],val=s[3]??s[2];return `<div class="stat-card clickable ${active===label?'active':''}" onclick="statusFilter='${label==='All'?'':label}';assetPage=50;render()"><div class="stat-card-header"><span class="label">${label}</span><span class="material-symbols-outlined stat-icon" style="color:${s[3]?s[3]:'var(--secondary)'};">${icon}</span></div><div class="value">${val}</div></div>`;}).join('')}</div>${shown.length?grid(shown):empty('search_off','No assets match your search')}${more>0?`<div style="text-align:center;padding:20px;"><button class="btn-primary" onclick="assetPage+=50;render()">Show 50 more (${more} remaining)</button></div>`:''}`;
}

// ===== ASSET DETAIL BIG WINDOW =====
function renderAssetDetail(id) {
  const a = assets.find(x => x.id === id);
  if (!a) return '<div style="padding:40px;text-align:center;">Asset not found.</div>';
  const tix = allTickets.filter(t => t.asset_id === id);
  const editors = profiles.filter(u => u.role === 'editor' || u.role === 'admin');
  const reviewers = profiles.filter(u => u.role === 'reviewer' || u.role === 'admin');
  const thumb = a.thumbnail_base64 || a.thumbnail_url || '';
  return `<div class="detail-big">
  <div class="detail-section" style="animation-delay:0.02s">
    <a href="#assets" style="display:inline-flex;align-items:center;gap:6px;color:var(--secondary);text-decoration:none;font-size:13px;margin-bottom:8px;"><span class="material-symbols-outlined" style="font-size:16px;">arrow_back</span> Back to Assets</a>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">
        <h2 style="font-size:26px;font-weight:700;margin:0;">${esc(a.title)}</h2>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap;">
          <span class="status-badge ${cls(a.editor_status)}"><span class="dot"></span> ${a.editor_status}</span>
          ${a.reviewer_status ? `<span class="status-badge ${cls(a.reviewer_status)}"><span class="dot"></span> ${a.reviewer_status}</span>` : ''}
          <span style="font-size:12px;color:var(--secondary);">Sheet Row #${a.sheet_row||a.id+1}</span>
        </div>
      </div>
      ${thumb ? `<img src="${thumb}" alt="" class="thumbnail-preview" />` : ''}
    </div>
  </div>

  <div class="detail-section" style="animation-delay:0.06s">
    <div class="detail-section-title"><span class="material-symbols-outlined" style="font-size:18px;">info</span> File Paths</div>
    <div class="metadata-grid">
      <div class="metadata-field"><label>Video File Path</label><div class="value editable" onclick="editField(${a.id},'file_path','${esc(a.file_path||'')}')">${a.file_path||a.video_location||'—'}</div></div>
      <div class="metadata-field"><label>Subtitle Path</label><div class="value editable" onclick="editField(${a.id},'subtitle_path','${esc(a.subtitle_path||'')}')">${a.subtitle_path||a.cc_location||'—'}</div></div>
      <div class="metadata-field"><label>Video Location (Original)</label><div class="value">${a.video_location||'—'}<button class="copy-btn" onclick="navigator.clipboard.writeText('${esc(a.video_location||'')}')" style="margin-left:auto;"><span class="material-symbols-outlined" style="font-size:14px;">content_copy</span></button></div></div>
      <div class="metadata-field"><label>CC Location (Original)</label><div class="value">${a.cc_location||'—'}</div></div>
    </div>
  </div>

  <div class="detail-section" style="animation-delay:0.10s">
    <div class="detail-section-title"><span class="material-symbols-outlined" style="font-size:18px;">settings</span> Technical Metadata</div>
    <div class="metadata-grid">
      <div class="metadata-field"><label>Received Resolution</label><input type="text" class="meta-inp" data-id="${a.id}" data-field="received_resolution" value="${esc(a.received_resolution||'')}" placeholder="e.g. 1920x1080" /></div>
      <div class="metadata-field"><label>Received FPS</label><input type="text" class="meta-inp" data-id="${a.id}" data-field="received_fps" value="${esc(a.received_fps||'')}" placeholder="e.g. 23.976" /></div>
      <div class="metadata-field"><label>Delivered Resolution</label><input type="text" class="meta-inp" data-id="${a.id}" data-field="delivered_resolution" value="${esc(a.delivered_resolution||'')}" placeholder="e.g. 1920x1080" /></div>
      <div class="metadata-field"><label>Delivered FPS</label><input type="text" class="meta-inp" data-id="${a.id}" data-field="delivered_fps" value="${esc(a.delivered_fps||'')}" placeholder="e.g. 23.976" /></div>
      <div class="metadata-field"><label>Duration</label><input type="text" class="meta-inp" data-id="${a.id}" data-field="duration" value="${esc(a.duration||'')}" placeholder="e.g. 01:30:00" /></div>
      <div class="metadata-field"><label>Audio Channel</label><select class="meta-inp" data-id="${a.id}" data-field="audio_channel"><option value="">—</option><option value="Stereo" ${a.audio_channel==='Stereo'?'selected':''}>Stereo</option><option value="5.1" ${a.audio_channel==='5.1'?'selected':''}>5.1 Surround</option><option value="7.1" ${a.audio_channel==='7.1'?'selected':''}>7.1 Surround</option><option value="Mono" ${a.audio_channel==='Mono'?'selected':''}>Mono</option></select></div>
      <div class="metadata-field"><label>Reviewed</label><label style="display:flex;align-items:center;gap:8px;padding:8px 0;"><input type="checkbox" class="meta-chk" data-id="${a.id}" data-field="reviewed" ${a.reviewed?'checked':''} style="width:18px;height:18px;accent-color:var(--primary);" /> <span style="font-size:14px;">${a.reviewed?'Reviewed':'Not Reviewed'}</span></label></div>
      <div class="metadata-field"><label>Air Date</label><div class="value">${a.first_air_date||'—'}</div></div>
    </div>
  </div>

  <div class="detail-section" style="animation-delay:0.14s">
    <div class="detail-section-title"><span class="material-symbols-outlined" style="font-size:18px;">assignment</span> Status & Assignment</div>
    <div class="metadata-grid">
      <div class="metadata-field"><label>Editor Status</label><div class="select-wrap"><select class="status-ch" data-id="${a.id}" data-field="editor_status">${ES.map(s => `<option value="${s}" ${s===a.editor_status?'selected':''}>${s}</option>`).join('')}</select><span class="material-symbols-outlined arrow">expand_more</span></div></div>
      <div class="metadata-field"><label>Assigned Editor</label><div class="select-wrap"><select class="assign-ch" data-id="${a.id}" data-field="assigned_editor"><option value="">Unassigned</option>${editors.map(u => `<option value="${u.id}" ${u.id===a.assigned_editor?'selected':''}>${u.name}</option>`).join('')}</select><span class="material-symbols-outlined arrow">expand_more</span></div></div>
      <div class="metadata-field"><label>Reviewer Status</label><div class="select-wrap"><select class="status-ch" data-id="${a.id}" data-field="reviewer_status">${RS.map(s => `<option value="${s}" ${s===a.reviewer_status?'selected':''}>${s}</option>`).join('')}</select><span class="material-symbols-outlined arrow">expand_more</span></div></div>
      <div class="metadata-field"><label>Assigned Reviewer</label><div class="select-wrap"><select class="assign-ch" data-id="${a.id}" data-field="assigned_reviewer"><option value="">Unassigned</option>${reviewers.map(u => `<option value="${u.id}" ${u.id===a.assigned_reviewer?'selected':''}>${u.name}</option>`).join('')}</select><span class="material-symbols-outlined arrow">expand_more</span></div></div>
    </div>
  </div>

  <div class="detail-section" style="animation-delay:0.18s">
    <div class="detail-section-title"><span class="material-symbols-outlined" style="font-size:18px;">notes</span> Notes & Actions</div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;">
      <div>
        <textarea id="an" style="width:100%;padding:12px;border:1px solid var(--outline);border-radius:var(--radius);font-size:14px;min-height:120px;resize:vertical;background:var(--surface);box-sizing:border-box;">${esc(a.notes||'')}</textarea>
        <button class="btn-primary" id="save-n" data-id="${a.id}" style="margin-top:8px;"><span class="material-symbols-outlined" style="font-size:16px;">save</span> Save Notes</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn-primary" id="send-app" data-id="${a.id}" style="width:100%;"><span class="material-symbols-outlined" style="font-size:16px;">send</span> Send for Approval</button>
        <button class="btn-approve" onclick="approveAsset(${a.id})" style="width:100%;"><span class="material-symbols-outlined" style="font-size:16px;">check</span> Approve</button>
        <button class="btn-reedit-action" onclick="rejectAsset(${a.id})" style="width:100%;"><span class="material-symbols-outlined" style="font-size:16px;">replay</span> Re-Edit</button>
        <button class="btn-outline" onclick="showTicketModal(${a.id})" style="width:100%;"><span class="material-symbols-outlined" style="font-size:16px;">bug_report</span> Report Issue</button>
        <a href="mailto:core.creative@amagi.com?subject=Lionsgate (${a.id}) S%26P Report&body=Hi Team,%0D%0ALionsgate (${a.id}) S%26P Report attached for review purposes." class="btn-outline" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;box-sizing:border-box;"><span class="material-symbols-outlined" style="font-size:16px;">mail</span> Email Report</a>
      </div>
    </div>
  </div>

  <div class="detail-section" style="animation-delay:0.22s">
    <div class="detail-section-title"><span class="material-symbols-outlined" style="font-size:18px;">confirmation_number</span> Tickets (${tix.length})</div>
    ${tix.length ? `<div style="background:var(--surface);border:1px solid var(--outline);border-radius:var(--radius);overflow:hidden;"><table class="data-table"><thead><tr><th>#</th><th>Title</th><th>Status</th><th>Priority</th><th>Created</th></tr></thead><tbody>${tix.map(t => `<tr class="clickable-row" onclick="openTicket(${t.id})"><td style="color:var(--secondary);">${t.id}</td><td style="font-weight:500;">${esc(t.title)}</td><td><span class="status-badge ${t.status==='open'?'status-working':t.status==='in_progress'?'status-needreview':'status-default'}" style="font-size:11px;"><span class="dot"></span> ${t.status.replace('_',' ')}</span></td><td><span class="${prio(t.priority)}">${t.priority}</span></td><td style="font-size:13px;color:var(--secondary);">${ago(t.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<div style="padding:20px;text-align:center;color:var(--secondary);border:1px solid var(--outline);border-radius:var(--radius);">No tickets yet</div>'}
  </div>
  ${createTicketModal(a.id)}
  </div>`;
}

// ===== INLINE FIELD EDIT =====
async function editField(id, field, current) {
  const val = prompt(`Enter new value for ${field}:`, current);
  if (val === null) return;
  try { await sbPatch(`/assets?id=eq.${id}`, { [field]: val }); await loadData(); render(); toast('Field updated', 'success'); } catch(e) { toast(e.message, 'error'); }
}

// ===== CREATE TICKET MODAL =====
let ticketFiles = [];
function createTicketModal(assetId) {
  const assetOpts = assets.map(a => `<option value="${a.id}" ${a.id==assetId?'selected':''}>${esc(a.title)} (ID:${a.id})</option>`).join('');
  return `<div id="ct-modal" class="modal-overlay" style="display:none;"><div class="modal" style="max-width:560px;"><div class="modal-header"><h3>Create Ticket</h3><button class="modal-close" onclick="document.getElementById('ct-modal').style.display='none'"><span class="material-symbols-outlined">close</span></button></div><div class="modal-body">
    <div class="form-group"><label>Subject <span style="color:var(--error);">*</span></label><input type="text" id="ct-title" style="width:100%;padding:10px 12px;border:1px solid var(--outline);border-radius:var(--radius);font-size:14px;" placeholder="Brief summary of the issue" required /></div>
    <div class="form-group"><label>Asset <span style="color:var(--error);">*</span></label><div class="select-wrap"><select id="ct-asset-id">${assetOpts}</select><span class="material-symbols-outlined arrow">expand_more</span></div></div>
    <div class="form-group"><label>Description / Body <span style="color:var(--error);">*</span></label><textarea id="ct-desc" style="width:100%;padding:10px 12px;border:1px solid var(--outline);border-radius:var(--radius);font-size:14px;min-height:100px;resize:vertical;" placeholder="Detailed description of the issue" required></textarea></div>
    <div class="form-group"><label>Priority</label><div class="select-wrap"><select id="ct-prio"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select><span class="material-symbols-outlined arrow">expand_more</span></div></div>
    <div class="form-group"><label>Assign To</label><div class="select-wrap"><select id="ct-assign"><option value="">Unassigned</option>${profiles.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}</select><span class="material-symbols-outlined arrow">expand_more</span></div></div>
    <div class="form-group"><label>Attachments</label>
      <div class="upload-zone" id="uz" onclick="document.getElementById('uf').click()" ondragover="this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="handleDrop(event)">
        <span class="material-symbols-outlined" style="font-size:32px;color:var(--secondary);display:block;margin-bottom:8px;">cloud_upload</span>
        <div style="font-size:13px;color:var(--secondary);">Click or drag files here</div>
        <div style="font-size:11px;color:var(--secondary);margin-top:4px;">Max 50MB — ZIP, PPROJ, PDF, images</div>
        <input type="file" id="uf" multiple onchange="handleFiles(this.files)" style="display:none;" />
      </div>
      <div class="file-list" id="fl"></div>
    </div>
  </div><div class="modal-footer"><button class="btn-outline" onclick="document.getElementById('ct-modal').style.display='none'">Cancel</button><button class="btn-primary" id="ct-submit">Create Ticket</button></div></div></div>`;
}

// File upload helpers
function handleDrop(e) { e.preventDefault(); document.getElementById('uz').classList.remove('dragover'); handleFiles(e.dataTransfer.files); }
function handleFiles(files) { for (const f of files) ticketFiles.push(f); renderFileList(); }
function renderFileList() {
  const el = document.getElementById('fl');
  if (!el) return;
  if (!ticketFiles.length) { el.innerHTML = ''; return; }
  el.innerHTML = ticketFiles.map((f,i) => `<div class="file-item"><span class="material-symbols-outlined" style="font-size:16px;color:var(--secondary);">${f.type.includes('zip')?'folder_zip':f.type.includes('pdf')?'picture_as_pdf':'description'}</span><span class="name">${esc(f.name)}</span><span style="font-size:11px;color:var(--secondary);">${(f.size/1024).toFixed(0)}KB</span><span class="remove" onclick="ticketFiles.splice(${i},1);renderFileList();">✕</span></div>`).join('');
}

async function uploadFiles(ticketId) {
  const uploaded = [];
  for (const f of ticketFiles) {
    const path = `tickets/${ticketId}/${Date.now()}_${f.name}`;
    const res = await fetch(`${SB_URL}/storage/v1/object/asset-files/${path}`, {
      method: 'POST',
      headers: { 'apikey': SB_ANON, 'Authorization': `Bearer ${localStorage.getItem('supabase_token')}`, 'Content-Type': f.type || 'application/octet-stream' },
      body: f,
    });
    if (res.ok) uploaded.push(path);
  }
  return uploaded;
}

// ===== TICKETS PAGE =====
function renderTickets() {
  return `<div class="page-header"><h2>Tickets</h2><button class="btn-primary" onclick="showTicketModal()"><span class="material-symbols-outlined" style="font-size:18px;">add</span> New</button></div><div style="background:var(--surface);border:1px solid var(--outline);border-radius:var(--radius);overflow:hidden;"><table class="data-table"><thead><tr><th>#</th><th>Title</th><th>Asset</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Created</th></tr></thead><tbody>${allTickets.map(t => `<tr class="clickable-row" onclick="openTicket(${t.id})"><td style="color:var(--secondary);">${t.id}</td><td style="font-weight:500;">${esc(t.title)}</td><td>${t.asset_title||'—'}</td><td><span class="status-badge ${t.status==='open'?'status-working':t.status==='in_progress'?'status-needreview':'status-default'}" style="font-size:11px;"><span class="dot"></span> ${t.status.replace('_',' ')}</span></td><td><span class="${prio(t.priority)}">${t.priority}</span></td><td>${t.assignee_name||'—'}</td><td style="font-size:13px;color:var(--secondary);">${ago(t.created_at)}</td></tr>`).join('')}</tbody></table></div><div id="ticket-modal"></div>`;
}

// ===== TICKET DETAIL MODAL =====
async function openTicket(id) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/tickets?id=eq.${id}&select=*,creator:created_by(id,name),assignee:assigned_to(id,name),asset:asset_id(title)`, {
      headers: { 'apikey': SB_ANON, 'Authorization': `Bearer ${localStorage.getItem('supabase_token')}` },
    });
    const tix = await res.json();
    const t = tix[0];
    if (!t) return;
    const comRes = await fetch(`${SB_URL}/rest/v1/ticket_comments?ticket_id=eq.${id}&select=*,user:user_id(id,name)&order=created_at.asc`, {
      headers: { 'apikey': SB_ANON, 'Authorization': `Bearer ${localStorage.getItem('supabase_token')}` },
    });
    const comments = (await comRes.json()) || [];
    const el = document.getElementById('ticket-modal');
    el.style.display = 'flex';
    el.innerHTML = `<div class="modal" style="max-width:580px;"><div class="modal-header"><h3>#${t.id} ${esc(t.title)}</h3><button class="modal-close" onclick="document.getElementById('ticket-modal').style.display='none'"><span class="material-symbols-outlined">close</span></button></div><div class="modal-body"><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;"><div class="form-group"><label>Status</label><div class="select-wrap"><select class="tix-up" data-id="${t.id}" data-field="status">${['open','in_progress','resolved','closed'].map(s => `<option value="${s}" ${s===t.status?'selected':''}>${s.replace('_',' ')}</option>`).join('')}</select><span class="material-symbols-outlined arrow">expand_more</span></div></div><div class="form-group"><label>Priority</label><div class="select-wrap"><select class="tix-up" data-id="${t.id}" data-field="priority">${['low','medium','high','critical'].map(s => `<option value="${s}" ${s===t.priority?'selected':''}>${s}</option>`).join('')}</select><span class="material-symbols-outlined arrow">expand_more</span></div></div><div class="form-group"><label>Assignee</label><div class="select-wrap"><select class="tix-up" data-id="${t.id}" data-field="assigned_to"><option value="">Unassigned</option>${profiles.map(u => `<option value="${u.id}" ${u.id===t.assigned_to?'selected':''}>${u.name}</option>`).join('')}</select><span class="material-symbols-outlined arrow">expand_more</span></div></div><div><label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--secondary);display:block;margin-bottom:6px;">Asset</label><div style="padding:10px 12px;border:1px solid var(--outline);border-radius:var(--radius);font-size:14px;background:var(--surface-container-low);">${t.asset?.title||'—'}</div></div></div>${t.description?`<div style="margin-bottom:16px;"><label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--secondary);display:block;margin-bottom:6px;">Description</label><div style="padding:12px;background:var(--surface-container-low);border-radius:var(--radius);font-size:14px;">${esc(t.description)}</div></div>`:''}<div style="border-top:1px solid var(--outline);padding-top:16px;"><h4 style="font-size:14px;font-weight:600;margin-bottom:12px;">Comments (${comments.length})</h4><div style="margin-bottom:16px;">${comments.length?comments.map(c => `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--outline);"><div style="width:28px;height:28px;border-radius:50%;background:var(--surface-container-high);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;">${(c.user_name||'?')[0]}</div><div><div style="font-weight:600;font-size:13px;">${c.user_name}</div><div style="font-size:13px;margin-top:2px;">${esc(c.content)}</div><div style="font-size:11px;color:var(--secondary);margin-top:4px;">${ago(c.created_at)}</div></div></div>`).join(''):'<div style="text-align:center;padding:16px;color:var(--secondary);font-size:13px;">No comments.</div>'}</div><div style="display:flex;gap:8px;"><input type="text" id="tc-input" placeholder="Write a comment..." style="flex:1;padding:10px 12px;border:1px solid var(--outline);border-radius:var(--radius);font-size:14px;" /><button class="btn-primary" onclick="addComment(${t.id})" style="padding:10px 20px;">Send</button></div></div></div></div>`;
    document.querySelectorAll('.tix-up').forEach(el => {
      el.onchange = async () => {
        try { await sbPatch(`/tickets?id=eq.${el.dataset.id}`, { [el.dataset.field]: el.value, updated_at: new Date().toISOString() }); await loadData(); } catch(e) { alert(e.message); }
      };
    });
    document.getElementById('tc-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') addComment(t.id); });
  } catch(e) { alert(e.message); }
}

async function addComment(ticketId) {
  const input = document.getElementById('tc-input');
  if (!input?.value.trim()) return;
  try {
    await sbPost('/ticket_comments', { ticket_id: ticketId, user_id: myId(), content: input.value.trim() });
    await sbPost('/activity_log', { asset_id: null, user_id: myId(), action: `commented on ticket #${ticketId}`, details: {} });
    input.value = '';
    await openTicket(ticketId);
  } catch(e) { alert(e.message); }
}

function showTicketModal(assetId) {
  const m = document.getElementById('ct-modal') || (() => { const d = document.createElement('div'); d.id = 'ct-modal'; d.className = 'modal-overlay'; d.innerHTML = createTicketModal(); document.body.appendChild(d); return d; })();
  m.style.display = 'flex';
  if (assetId) {
    const sel = document.getElementById('ct-asset-id');
    if (sel) sel.value = assetId;
  }
}

// ===== ACTIVITY PAGE =====
function renderActivity() {
  return `<div class="page-header"><h2>Activity</h2></div><div style="background:var(--surface);border:1px solid var(--outline);border-radius:var(--radius);"><div style="padding:24px 24px 0;display:flex;gap:16px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--outline);padding-bottom:16px;"><span class="live-badge" style="margin-right:auto;"><span class="live-dot"></span> Live Log</span></div><div style="padding:24px;">${feed(allActivity.slice(0,30))}</div></div>`;
}

// ===== TOAST =====
function toast(msg, type) {
  const c = document.getElementById('tc') || (() => { const d = document.createElement('div'); d.id = 'tc'; d.className = 'toast-container'; document.body.appendChild(d); return d; })();
  const t = document.createElement('div'); t.className = 'toast ' + (type||'info');
  t.innerHTML = `<span>${esc(msg)}</span><span class="close" onclick="this.parentElement.remove()">✕</span>`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ===== NOTIFICATIONS =====
let notifications = [];
let notifOpen = false;

async function loadNotifs() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/notifications?user_id=eq.${myId()}&order=created_at.desc&limit=50`, {
      headers: { 'apikey': SB_ANON, 'Authorization': `Bearer ${localStorage.getItem('supabase_token')}` },
    });
    if (res.ok) notifications = await res.json();
  } catch {}
}

function notifCount() { return notifications.filter(n => !n.is_read).length; }

function renderNotifPanel() {
  if (!document.getElementById('np')) {
    const np = document.createElement('div'); np.id = 'np'; np.className = 'notif-panel';
    np.innerHTML = `<div class="notif-panel-header"><strong>Notifications</strong><button class="icon-btn" onclick="closeNotifPanel()"><span class="material-symbols-outlined">close</span></button></div><div class="notif-panel-body" id="npb"></div>`;
    document.body.appendChild(np);
  }
  const np = document.getElementById('np'); np.style.display = 'flex'; notifOpen = true;
  const body = document.getElementById('npb');
  if (!notifications.length) { body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--secondary);">No notifications</div>'; return; }
  body.innerHTML = notifications.map(n => `<div class="notif-item ${n.is_read?'':'unread'}" onclick="${n.link ? `location.hash='${n.link}';closeNotifPanel()` : ''};markNotifRead(${n.id})"><div>${esc(n.message)}</div><div class="notif-time">${ago(n.created_at)}</div></div>`).join('');
}

function closeNotifPanel() { const np = document.getElementById('np'); if (np) np.style.display = 'none'; notifOpen = false; }
async function markNotifRead(id) {
  try { await sbPatch(`/notifications?id=eq.${id}`, { is_read: true }); notifications = notifications.map(n => n.id === id ? {...n, is_read: true} : n); render(); } catch {}
}

async function createNotification(userId, type, message, assetId) {
  try {
    await sbPost('/notifications', { user_id: userId, from_user_id: myId(), asset_id: assetId, type, message, link: assetId ? 'asset-detail?id='+assetId : '' });
  } catch {}
}
async function notifyReviewers(assetId, message) {
  const reviewers = profiles.filter(p => (p.role === 'reviewer' || p.role === 'admin') && p.is_active && p.id !== myId());
  for (const r of reviewers) await createNotification(r.id, 'review_request', message || 'Asset requires your review', assetId);
}
async function notifyAllUsers(message, assetId) {
  const users = profiles.filter(p => p.is_active && p.id !== myId());
  for (const u of users) await createNotification(u.id, 'new_asset', message || 'New asset added', assetId);
}

// ===== ADMIN =====
function renderAdmin() {
  return `<div class="page-header"><h2>Admin Panel</h2></div>
  <div class="two-col" style="gap:20px;">
    <div>
      <div style="background:var(--surface);border:1px solid var(--outline);border-radius:var(--radius);overflow:hidden;">
        <div style="padding:16px 20px;border-bottom:1px solid var(--outline);display:flex;justify-content:space-between;"><strong>Users (${profiles.length})</strong></div>
        <table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>${profiles.map(u => `<tr><td>${esc(u.name)}</td><td style="color:var(--secondary);">${u.email}</td><td><select class="role-ch" data-id="${u.id}" ${myRole()!=='admin'?'disabled':''} style="padding:4px 8px;border:1px solid var(--outline);border-radius:var(--radius);font-size:13px;background:var(--surface);"><option value="editor" ${u.role==='editor'?'selected':''}>Editor</option><option value="reviewer" ${u.role==='reviewer'?'selected':''}>Reviewer</option><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option></select></td><td><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" class="active-ch" data-id="${u.id}" ${u.is_active?'checked':''} ${myRole()!=='admin'?'disabled':''} style="width:16px;height:16px;accent-color:var(--primary);" /><span style="font-size:13px;color:${u.is_active?'#22c55e':'var(--error)'};">${u.is_active?'Active':'Inactive'}</span></label></td><td>${myRole()==='admin' && u.id !== myId() ? `<button class="btn-delete-user" data-id="${u.id}" style="background:none;border:1px solid var(--error);color:var(--error);padding:4px 10px;border-radius:var(--radius);font-size:12px;cursor:pointer;">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table>
      </div>
    </div>
    <div>
      <div style="background:var(--surface);border:1px solid var(--outline);border-radius:var(--radius);padding:20px;">
        <strong style="display:flex;align-items:center;gap:8px;margin-bottom:12px;"><span class="material-symbols-outlined" style="font-size:20px;">image</span> Thumbnails</strong>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-primary" onclick="openThumbnailModal()" style="font-size:13px;"><span class="material-symbols-outlined" style="font-size:16px;">travel_explore</span> Open Thumbnail Manager</button>
          <button class="btn-primary" onclick="fetchThumbnails()" style="font-size:13px;"><span class="material-symbols-outlined" style="font-size:16px;">auto_awesome</span> Generate Gradients</button>
        </div>
        <div id="thumbProgress" style="margin-top:10px;font-size:12px;color:var(--secondary);display:none;"></div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer;font-size:13px;user-select:none;">
          <div onclick="event.stopPropagation();toggleThumbAutoFetch(!${thumbAutoFetch});render()" style="width:40px;height:22px;border-radius:11px;background:${thumbAutoFetch?'var(--primary)':'#ccc'};position:relative;cursor:pointer;transition:background .2s;flex-shrink:0;">
            <div style="width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;top:2px;${thumbAutoFetch?'right:2px':'left:2px'};transition:left .2s,right .2s;box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>
          </div>
          <span>Auto-fetch missing thumbnails</span>
        </label>
        <div style="margin-top:12px;font-size:11px;color:var(--secondary);line-height:1.5;">
          <strong>How it works:</strong><br />
          • Thumbnail Manager lets you search &amp; fetch real posters from the web (free, no API key)<br />
          • Uses iTunes Search API + TVMaze (fallback) to find artwork<br />
          • Images are stored as base64 in the database &amp; cached in your browser<br />
          • Same-series assets (e.g. BMF004 &amp; BMF005) share one thumbnail<br />
          • Gradients are used as fallback when no web image is found<br />
          • Enable auto-fetch to automatically search for missing thumbnails on page load
        </div>
      </div>
    </div>
  </div>`;
}

// ===== THUMBNAILS =====
const THUMB_CACHE_KEY = 'lionsgate_thumb_cache';
let thumbWebCache = loadThumbCache();
let thumbAutoFetch = localStorage.getItem('thumb_auto_fetch') === 'true';

function loadThumbCache() {
  try { return JSON.parse(localStorage.getItem(THUMB_CACHE_KEY)) || {}; } catch { return {}; }
}
function saveThumbCache() {
  try { localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(thumbWebCache)); } catch {}
}

function toggleThumbAutoFetch(v) {
  thumbAutoFetch = v;
  localStorage.setItem('thumb_auto_fetch', v ? 'true' : 'false');
  toast(v ? 'Auto-fetch enabled' : 'Auto-fetch disabled', 'info');
}

// Extract series prefix from asset_ref (e.g. "BMF004" → "BMF", "SOME-SHOW-001" → "SOME-SHOW")
function seriesPrefix(a) {
  const ref = (a.asset_ref || '').trim();
  if (!ref) return (a.title || '').trim().toLowerCase();
  const m = ref.match(/^([A-Za-z\-]+)/);
  return m ? m[1].toLowerCase() : ref.toLowerCase();
}

async function searchWebPoster(term) {
  const t = term.trim().toLowerCase();
  if (!t) return null;
  if (thumbWebCache[t]) return thumbWebCache[t];
  // Build searches: try exact term, then with "tv series" for short terms
  let searches = [t];
  if (t.length < 8) searches.push(t + ' tv series', t + ' show', t + ' poster');
  for (const q of searches) {
    // iTunes Search API — try direct, then via CORS proxy
    let b64 = await fetchPosterFromSource(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=movie,tvSeason&limit=5`, (data) => {
      if (data.results && data.results.length) {
        const item = data.results[0];
        let url = item.artworkUrl100 || item.artworkUrl60;
        if (url) return url.replace(/100x100bb/, '600x600bb').replace(/60x60bb/, '600x600bb');
      }
      return null;
    });
    if (b64) { thumbWebCache[t] = b64; saveThumbCache(); return b64; }
    // TVMaze fallback
    b64 = await fetchPosterFromSource(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`, (data) => {
      if (data.length && data[0].show && data[0].show.image) {
        return data[0].show.image.original || data[0].show.image.medium;
      }
      return null;
    });
    if (b64) { thumbWebCache[t] = b64; saveThumbCache(); return b64; }
  }
  return null;
}

// Helper: fetch JSON from URL, extract image URL via extractor, convert to base64
// Uses CORS proxy fallback if direct fetch fails
const CORS_PROXY = 'https://corsproxy.io/?';
async function fetchPosterFromSource(url, extractor) {
  // Try direct fetch first
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const imgUrl = extractor(data);
      if (imgUrl) {
        const b64 = await imageToBase64(imgUrl);
        if (b64) return b64;
      }
    }
  } catch(e) { console.warn('Direct fetch failed for', url.slice(0,80), e.message); }
  // Retry via CORS proxy
  try {
    const proxyUrl = CORS_PROXY + encodeURIComponent(url);
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const text = await res.text();
      const data = JSON.parse(text.startsWith('{') ? text : text.replace(/^[^{]*/,''));
      const imgUrl = extractor(data);
      if (imgUrl) {
        const b64 = await imageToBase64(imgUrl);
        if (b64) return b64;
      }
    }
  } catch(e) { console.warn('Proxy fetch failed for', url.slice(0,80), e.message); }
  return null;
}

async function imageToBase64(url) {
  // Try fetch + blob first (bypasses crossOrigin canvas issues)
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    }
  } catch(e) { console.warn('imageToBase64 fetch failed:', e.message); }
  // Fallback: canvas with crossOrigin
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 200;
        c.height = img.naturalHeight || 280;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(c.toDataURL('image/jpeg', 0.8));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Normalize size: all thumbnails to 200x280 for consistency
function normalizeThumbnail(base64) {
  if (!base64) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 200; c.height = 280;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 200, 280);
        resolve(c.toDataURL('image/jpeg', 0.7));
      } catch { resolve(base64); }
    };
    img.onerror = () => resolve(null);
    img.src = base64;
  });
}

async function fetchWebThumbnails(progressEl, onlyFailed) {
  if (!progressEl) return;
  progressEl.style.display = 'block';
  // Group by series prefix
  const groupMap = {};
  for (const a of assets) {
    const key = seriesPrefix(a);
    if (!key) continue;
    if (!groupMap[key]) groupMap[key] = { key, assets: [], hasThumb: false };
    groupMap[key].assets.push(a);
    if (a.thumbnail_base64 && a.thumbnail_base64.length > 50) groupMap[key].hasThumb = true;
  }
  let groups = Object.values(groupMap);
  const failedKeys = JSON.parse(localStorage.getItem('thumb_failed') || '[]');
  if (onlyFailed) groups = groups.filter(g => failedKeys.includes(g.key));
  const total = groups.length;
  let fetched = 0, cached = 0, failed = 0;
  const newFailed = [];
  // Build progress bar HTML
  progressEl.innerHTML = `<div style="background:#eee;border-radius:8px;overflow:hidden;height:24px;position:relative;margin-bottom:6px;"><div id="thumb-progress-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#735c00,#d4af37);border-radius:8px;transition:width .3s;"></div><span id="thumb-progress-pct" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#333;">0%</span></div><div id="thumb-progress-label" style="font-size:11px;color:#666;"></div>`;
  const bar = document.getElementById('thumb-progress-bar');
  const pct = document.getElementById('thumb-progress-pct');
  const label = document.getElementById('thumb-progress-label');
  for (let i = 0; i < total; i++) {
    const g = groups[i];
    const p = Math.round((i / total) * 100);
    if (bar) bar.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
    if (label) label.textContent = `[${i+1}/${total}] ${esc(g.key).slice(0,60)}...`;
    await new Promise(r => setTimeout(r, 0)); // yield
    if (g.hasThumb) { cached += g.assets.length; continue; }
    let b64 = thumbWebCache[g.key] || null;
    if (!b64) {
      b64 = await searchWebPoster(g.key);
      if (b64) { thumbWebCache[g.key] = b64; saveThumbCache(); }
    }
    if (b64) {
      const norm = await normalizeThumbnail(b64);
      for (const a of g.assets) {
        try { await sbPatch(`/assets?id=eq.${a.id}`, { thumbnail_base64: norm || b64 }); } catch {}
      }
      fetched += g.assets.length;
    } else {
      failed += g.assets.length;
      newFailed.push(g.key);
    }
  }
  if (bar) bar.style.width = '100%';
  if (pct) pct.textContent = '100%';
  if (label) label.textContent = `Done — ${fetched} thumbnails from web, ${cached} already had thumbnails, ${failed} not found`;
  // Save failed keys for retry
  if (!onlyFailed) localStorage.setItem('thumb_failed', JSON.stringify(newFailed));
  else { const retry = JSON.parse(localStorage.getItem('thumb_failed') || '[]'); localStorage.setItem('thumb_failed', JSON.stringify(retry.filter(k => !newFailed.includes(k)))); }
  await loadData();
  if (currentPage === 'admin') render();
  toast(`Thumbnails: ${fetched} web, ${cached} existing, ${failed} not found`, failed > 0 ? 'warning' : 'success');
}

// Fallback: gradient-only generation (for the "Generate Gradients" button)
async function fetchThumbnails() {
  const progress = document.getElementById('thumbProgress');
  if (!progress) return;
  progress.style.display = 'block';
  const titleMap = {};
  for (const a of assets) {
    const t = (a.title||'').trim();
    if (!t) continue;
    if (!titleMap[t]) titleMap[t] = [];
    titleMap[t].push(a);
  }
  const titles = Object.keys(titleMap);
  let generated = 0, copied = 0;
  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    const group = titleMap[t];
    progress.textContent = `[${i+1}/${titles.length}] ${esc(t).slice(0,60)}...`;
    const existing = group.find(a => a.thumbnail_base64 && a.thumbnail_base64.length > 50);
    if (existing) {
      const misses = group.filter(a => !a.thumbnail_base64 || a.thumbnail_base64.length <= 50);
      for (const m of misses) { try { await sbPatch(`/assets?id=eq.${m.id}`, { thumbnail_base64: existing.thumbnail_base64 }); } catch {} }
      if (misses.length) copied += misses.length;
      continue;
    }
    const b64 = generateThumbnail(t);
    for (const a of group) { try { await sbPatch(`/assets?id=eq.${a.id}`, { thumbnail_base64: b64 }); } catch {} }
    generated += group.length;
  }
  progress.textContent = `Done — ${generated} generated, ${copied} copied from siblings`;
  await loadData();
  if (currentPage === 'admin') render();
  toast(`Thumbnails: ${generated} generated, ${copied} reused`, 'success');
}

// Fallback: gradient generation (used when web fetch fails)
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
function generateThumbnail(title) {
  const c = document.createElement('canvas');
  c.width = 200; c.height = 280;
  const ctx = c.getContext('2d');
  const hue = hashStr(title) % 360;
  const grad = ctx.createLinearGradient(0, 0, 200, 280);
  grad.addColorStop(0, `hsl(${hue}, 50%, 35%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360}, 55%, 20%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 200, 280);
  const words = title.trim().split(/\s+/);
  const initials = words.slice(0, 3).map(w => w[0]).join('').toUpperCase().slice(0, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = initials.length <= 2 ? 72 : 56;
  ctx.font = `600 ${fs}px Inter, sans-serif`;
  ctx.fillText(initials, 100, 130);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 198, 278);
  return c.toDataURL('image/jpeg', 0.7);
}

// Thumbnail Manager Modal
function openThumbnailModal() {
  let modal = document.getElementById('thumb-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'thumb-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';
    modal.onclick = (e) => { if (e.target === modal) closeThumbnailModal(); };
    document.body.appendChild(modal);
  }
  renderThumbnailModal();
  modal.style.display = 'flex';
}

function closeThumbnailModal() {
  const m = document.getElementById('thumb-modal');
  if (m) m.style.display = 'none';
}

function renderThumbnailModal(filter = '') {
  const modal = document.getElementById('thumb-modal');
  if (!modal) return;
  const failedKeys = JSON.parse(localStorage.getItem('thumb_failed') || '[]');
  // Group by series prefix
  const groupMap = {};
  for (const a of assets) {
    const key = seriesPrefix(a);
    if (!key) continue;
    if (filter && !key.includes(filter.toLowerCase()) && !(a.title||'').toLowerCase().includes(filter.toLowerCase())) continue;
    if (!groupMap[key]) groupMap[key] = { key, title: a.title || key, count: 0, b64: null, assetId: a.id };
    groupMap[key].count++;
    if (a.thumbnail_base64 && a.thumbnail_base64.length > 50) groupMap[key].b64 = a.thumbnail_base64;
  }
  const groups = Object.values(groupMap);
  const failedCount = failedKeys.filter(k => groupMap[k] && !groupMap[k].b64).length;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:800px;width:90%;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid #e5e7eb;">
        <strong style="font-size:16px;">Thumbnail Manager (${groups.length} series)</strong>
        <div style="display:flex;align-items:center;gap:16px;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;user-select:none;" title="Auto-fetch missing thumbnails on page load">
            <div onclick="event.stopPropagation();toggleThumbAutoFetch(!${thumbAutoFetch});renderThumbnailModal(document.getElementById('thumb-search')?.value||'')" style="width:36px;height:20px;border-radius:10px;background:${thumbAutoFetch?'#735c00':'#ccc'};position:relative;cursor:pointer;transition:background .2s;flex-shrink:0;">
              <div style="width:16px;height:16px;border-radius:50%;background:#fff;position:absolute;top:2px;${thumbAutoFetch?'right:2px':'left:2px'};transition:left .2s,right .2s;box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>
            </div>
            <span>Auto-fetch</span>
          </label>
          <button onclick="closeThumbnailModal()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;padding:4px;">✕</button>
        </div>
      </div>
      <div style="padding:12px 24px;border-bottom:1px solid #e5e7eb;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input id="thumb-search" type="text" placeholder="Filter by series..." value="${esc(filter)}" style="flex:1;padding:8px 12px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;" oninput="renderThumbnailModal(this.value)" />
        <button class="btn-primary" onclick="fetchWebThumbnails(document.getElementById('thumb-progress'))" style="font-size:12px;padding:8px 16px;"><span class="material-symbols-outlined" style="font-size:14px;">travel_explore</span> Fetch All</button>
        ${failedCount ? `<button class="btn-primary" onclick="fetchWebThumbnails(document.getElementById('thumb-progress'),true)" style="font-size:12px;padding:8px 16px;background:#eab308;color:#fff;"><span class="material-symbols-outlined" style="font-size:14px;">refresh</span> Retry ${failedCount}</button>` : ''}
        <button class="btn-primary" onclick="fetchThumbnails()" style="font-size:12px;padding:8px 16px;"><span class="material-symbols-outlined" style="font-size:14px;">auto_awesome</span> Gradients</button>
      </div>
      <div id="thumb-progress" style="padding:8px 24px;font-size:12px;color:#666;display:none;"></div>
      <div style="flex:1;overflow-y:auto;padding:16px 24px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;">
          ${groups.map(g => {
            const img = g.b64 ? `<img src="${g.b64}" style="width:100%;aspect-ratio:200/280;object-fit:cover;border-radius:6px;" />` : `<div style="width:100%;aspect-ratio:200/280;border-radius:6px;background:#f3f4f5;display:flex;align-items:center;justify-content:center;color:#999;font-size:11px;">No thumbnail</div>`;
            const isFailed = !g.b64 && failedKeys.includes(g.key);
            return `<div style="border:1px solid ${isFailed ? '#f59e0b' : '#e5e7eb'};border-radius:8px;overflow:hidden;background:#fafafa;">
              ${img}
              <div style="padding:8px 10px;">
                <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(g.key)}">${esc(g.key)}${isFailed ? ' <span style="color:#f59e0b;font-size:10px;">⚠</span>' : ''}</div>
                <div style="font-size:11px;color:#888;">${g.count} asset(s)</div>
                ${g.b64 ? '' : `<button onclick="fetchSingleThumbnail('${esc(g.title)}',this,'${esc(g.key)}')" style="margin-top:6px;font-size:11px;padding:4px 10px;border:1px solid #735c00;border-radius:4px;background:#fff;color:#735c00;cursor:pointer;width:100%;">Search Web</button>`}
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
}

async function fetchSingleThumbnail(title, btn, key) {
  btn.disabled = true; btn.textContent = 'Searching...';
  const cacheKey = (key || title).trim().toLowerCase();
  let b64 = thumbWebCache[cacheKey] || null;
  if (!b64) b64 = await searchWebPoster(title);
  if (!b64) { btn.textContent = 'Not found'; return; }
  const norm = await normalizeThumbnail(b64);
  const groupKey = key || title;
  const group = assets.filter(a => seriesPrefix(a) === groupKey.trim().toLowerCase() || (a.title||'').trim().toLowerCase() === title.trim().toLowerCase());
  for (const a of group) {
    try { await sbPatch(`/assets?id=eq.${a.id}`, { thumbnail_base64: norm || b64 }); } catch {}
  }
  btn.textContent = 'Saved!';
  btn.style.background = '#22c55e'; btn.style.color = '#fff'; btn.style.borderColor = '#22c55e';
  await loadData();
  if (currentPage === 'admin') render();
  renderThumbnailModal(document.getElementById('thumb-search')?.value || '');
}

// ===== ACTIONS =====
async function assignMe(id) {
  try {
    await sbPatch(`/assets?id=eq.${id}`, { assigned_editor: myId(), updated_at: new Date().toISOString() });
    await logAct(id, `assigned to ${currentUser.name}`);
    toast('Assigned!', 'success');
    await loadData(); render();
  } catch(e) { toast(e.message, 'error'); }
}
async function approveAsset(id) {
  try {
    await sbPatch(`/assets?id=eq.${id}`, { reviewer_status: 'Approved', amagi_comments: 'Approved', editor_status: 'Approved', updated_at: new Date().toISOString() });
    await logAct(id, `approved asset`);
    const a = assets.find(x => x.id === id);
    if (a) await notifyAllUsers(`"${a.title}" approved`, id);
    toast('Approved!', 'success');
    await loadData(); render();
  } catch(e) { toast(e.message, 'error'); }
}
async function rejectAsset(id) {
  try {
    await sbPatch(`/assets?id=eq.${id}`, { reviewer_status: 'Re-Edit', editor_status: 'Re-Edit', updated_at: new Date().toISOString() });
    await logAct(id, `requested Re-Edit`);
    const a = assets.find(x => x.id === id);
    if (a && a.assigned_editor) await createNotification(a.assigned_editor, 're_edit', `"${a.title}" requires re-edit`, id);
    toast('Re-Edit requested', 'info');
    await loadData(); render();
  } catch(e) { toast(e.message, 'error'); }
}
async function logAct(assetId, action) {
  try { await sbPost('/activity_log', { asset_id: assetId, user_id: myId(), action, details: {} }); } catch {}
}

// ===== ATTACH HANDLERS =====
function attachAll() {
  // Section tabs
  document.querySelectorAll('[data-sec]').forEach(el => {
    el.onclick = (e) => { e.preventDefault(); currentSection = el.dataset.sec; render(); };
  });
  // Status changes
  document.querySelectorAll('.status-ch').forEach(el => {
    el.onchange = async () => {
      const data = { [el.dataset.field]: el.value, updated_at: new Date().toISOString() };
      if (el.dataset.field === 'editor_status' && el.value === 'Send for approval') data.reviewer_status = 'Need to Review';
      if (el.dataset.field === 'reviewer_status' && el.value === 'Approved') { data.amagi_comments = 'Approved'; data.editor_status = 'Approved'; }
      if (el.dataset.field === 'reviewer_status' && el.value === 'Re-Edit') data.editor_status = 'Re-Edit';
      try {
        await sbPatch(`/assets?id=eq.${el.dataset.id}`, data);
        await logAct(parseInt(el.dataset.id), `changed ${el.dataset.field} → ${el.value}`);
        await loadData();
        render();
      } catch(e) { alert(e.message); }
    };
  });
  // Assignment changes
  document.querySelectorAll('.assign-ch').forEach(el => {
    el.onchange = async () => {
      try {
        await sbPatch(`/assets?id=eq.${el.dataset.id}`, { [el.dataset.field]: el.value || null, updated_at: new Date().toISOString() });
        await logAct(parseInt(el.dataset.id), `changed assignment`);
        await loadData();
        render();
      } catch(e) { alert(e.message); }
    };
  });
  // Save notes
  document.getElementById('save-n')?.addEventListener('click', async () => {
    const id = parseInt(document.getElementById('save-n').dataset.id);
    const notes = document.getElementById('an')?.value || '';
    try {
      await sbPatch(`/assets?id=eq.${id}`, { notes, updated_at: new Date().toISOString() });
      document.getElementById('save-n').innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">check</span> Saved!';
      setTimeout(() => { document.getElementById('save-n').innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">save</span> Save'; }, 2000);
    } catch(e) { alert(e.message); }
  });
  // Send for approval
  document.getElementById('send-app')?.addEventListener('click', async () => {
    const id = parseInt(document.getElementById('send-app').dataset.id);
    try {
      await sbPatch(`/assets?id=eq.${id}`, { editor_status: 'Send for approval', reviewer_status: 'Need to Review', updated_at: new Date().toISOString() });
      const a = assets.find(x => x.id === id);
      await logAct(id, `sent ${a?.title||'asset'} for approval`);
      if (a) await notifyReviewers(id, `"${a.title}" sent for review by ${currentUser.name}`);
      toast('Sent for approval!', 'success');
      await loadData();
      render();
    } catch(e) { toast(e.message, 'error'); }
  });
  // Create ticket
  document.getElementById('ct-btn')?.addEventListener('click', () => {
    showTicketModal(parseInt(document.getElementById('ct-btn').dataset.id));
  });
  document.getElementById('ct-submit')?.addEventListener('click', async () => {
    const assetId = document.getElementById('ct-asset-id')?.value;
    const title = document.getElementById('ct-title')?.value.trim();
    const desc = document.getElementById('ct-desc')?.value.trim();
    const priority = document.getElementById('ct-prio')?.value;
    const assignee = document.getElementById('ct-assign')?.value;
    if (!assetId) { toast('Please select an asset', 'error'); return; }
    if (!title) { toast('Subject is required', 'error'); return; }
    if (!desc) { toast('Description is required', 'error'); return; }
    try {
      const t = await sbPost('/tickets', { asset_id: parseInt(assetId), title, description: desc, priority: priority||'medium', created_by: myId(), assigned_to: assignee||null });
      if (ticketFiles.length) {
        const uploaded = await uploadFiles(t.id);
        toast(`${uploaded.length} file(s) uploaded`, 'success');
        ticketFiles = [];
      }
      document.getElementById('ct-modal').style.display = 'none';
      ticketFiles = [];
      toast('Ticket created', 'success');
      await loadData();
      render();
    } catch(e) { toast(e.message, 'error'); }
  });
  // Metadata inputs (auto-save on change)
  document.querySelectorAll('.meta-inp').forEach(el => {
    el.onchange = async () => {
      try { await sbPatch(`/assets?id=eq.${el.dataset.id}`, { [el.dataset.field]: el.value }); toast('Saved', 'success'); } catch(e) { toast(e.message, 'error'); }
    };
  });
  document.querySelectorAll('.meta-chk').forEach(el => {
    el.onchange = async () => {
      try { await sbPatch(`/assets?id=eq.${el.dataset.id}`, { [el.dataset.field]: el.checked }); toast('Saved', 'success'); } catch(e) { toast(e.message, 'error'); }
    };
  });
  // Admin role changes
  document.querySelectorAll('.role-ch').forEach(el => {
    el.onchange = async () => {
      try {
        await sbPatch(`/profiles?id=eq.${el.dataset.id}`, { role: el.value });
        // If changing own role, update in-memory user too
        if (el.dataset.id === myId()) {
          currentUser = { ...currentUser, role: el.value };
          localStorage.setItem('supabase_user', JSON.stringify(currentUser));
        }
        await loadData(); render();
      } catch(e) { alert(e.message); }
    };
  });
  document.querySelectorAll('.active-ch').forEach(el => {
    el.onchange = async () => {
      try { await sbPatch(`/profiles?id=eq.${el.dataset.id}`, { is_active: el.checked }); await loadData(); render(); } catch(e) { alert(e.message); }
    };
  });
  document.querySelectorAll('.btn-delete-user').forEach(el => {
    el.onclick = async () => {
      if (!confirm('Delete this user? This will also delete the auth account.')) return;
      try { await sbDelete(`/profiles?id=eq.${el.dataset.id}`); await loadData(); render(); } catch(e) { alert(e.message); }
    };
  });
  // Search
  document.getElementById('gs')?.addEventListener('input', () => {
    searchQuery = document.getElementById('gs').value;
    assetPage = 50; editorPage = 50;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const pc = document.getElementById('pc');
      if (pc) { pc.innerHTML = pageContent(); attachAll(); }
    }, 150);
  });
  // Save set name value across re-renders
  document.getElementById('newSetName')?.addEventListener('input', function() {
    setNameVal = this.value;
  });
  // Save dump textarea value across re-renders
  document.getElementById('setDump')?.addEventListener('input', function() {
    setSearchVal = this.value;
  });
  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
    e.preventDefault(); await signout(); location.hash = 'login';
  });
}

// ===== GLOBAL SEARCH (Ctrl+K) =====
function globalSearch() {
  let overlay = document.getElementById('searchOverlay');
  if (overlay) { overlay.remove(); return; }
  overlay = document.createElement('div'); overlay.id = 'searchOverlay'; overlay.className = 'search-overlay';
  overlay.innerHTML = `<div class="search-modal"><input class="search-inp" id="gs-inp" placeholder="Search assets, tickets, users..." autofocus /><div class="search-results" id="gs-results"></div></div>`;
  document.body.appendChild(overlay);
  const inp = document.getElementById('gs-inp'); inp.focus();
  let timer;
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => doGlobalSearch(inp.value), 150);
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doGlobalSearch(inp.value); if (e.key === 'Escape') overlay.remove(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  doGlobalSearch('');
}

function doGlobalSearch(q) {
  const el = document.getElementById('gs-results');
  if (!el) return;
  const lq = q.toLowerCase();
  let results = [];

  // Search assets
  for (const a of assets) {
    if (!lq || (a.title||'').toLowerCase().includes(lq) || (a.editor_status||'').toLowerCase().includes(lq) || (a.reviewer_status||'').toLowerCase().includes(lq) || a.first_air_date?.includes(lq) || a.asset_ref?.includes(lq) || (a.video_location||'').toLowerCase().includes(lq)) {
      results.push({ type: 'asset', label: a.title || 'Untitled', sub: `#${a.id} · ${a.editor_status||'—'}`, link: `asset-detail?id=${a.id}`, icon: 'inventory_2' });
    }
  }
  // Search tickets
  for (const t of allTickets) {
    if (!lq || (t.title||'').toLowerCase().includes(lq) || (t.description||'').toLowerCase().includes(lq) || t.status?.includes(lq)) {
      results.push({ type: 'ticket', label: t.title || 'Untitled', sub: `#${t.id} · ${t.status||'—'}`, link: null, icon: 'confirmation_number' });
    }
  }
  // Search profiles
  for (const p of profiles) {
    if (!lq || (p.name||'').toLowerCase().includes(lq) || (p.email||'').toLowerCase().includes(lq) || p.role?.includes(lq)) {
      results.push({ type: 'user', label: p.name || 'Unknown', sub: `${p.email||'—'} · ${p.role||'—'}`, link: null, icon: 'person' });
    }
  }

  if (!results.length) { el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--secondary);">No results</div>'; return; }
  el.innerHTML = results.slice(0, 50).map(r => `<div class="sr-item" onclick="location.hash='${r.link}';document.getElementById('searchOverlay')?.remove()"><span class="material-symbols-outlined icon">${r.icon}</span><div class="label"><div>${highlight(r.label, q)}</div><div style="font-size:12px;color:var(--secondary);">${r.sub}</div></div><span class="type-tag">${r.type}</span></div>`).join('');
}

function highlight(text, q) {
  if (!q || !text) return esc(text);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return esc(text);
  return esc(text.slice(0, idx)) + '<span class="match">' + esc(text.slice(idx, idx + q.length)) + '</span>' + esc(text.slice(idx + q.length));
}

function clearSelection() { selectedIds.clear(); render(); }

// ===== GVIZ JSONP (bypasses CORS via script tag injection) =====
function fetchGvizJsonp(sheetId, gid) {
  return new Promise((resolve, reject) => {
    const old = window.google?.visualization?.Query?.setResponse;
    window.google = window.google || {};
    window.google.visualization = window.google.visualization || {};
    window.google.visualization.Query = window.google.visualization.Query || {};
    window.google.visualization.Query.setResponse = (data) => {
      window.google.visualization.Query.setResponse = old || (() => {});
      resolve(data);
    };
    const timeout = setTimeout(() => reject('Timeout'), 30000);
    const s = document.createElement('script');
    s.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&tq=select+*+limit+100000&gid=${gid}`;
    s.onerror = () => { clearTimeout(timeout); reject('Network error'); };
    document.body.appendChild(s);
  });
}

function gvizVal(cell) {
  if (!cell) return '';
  if (cell.f) return cell.f.trim();
  if (cell.v === null || cell.v === undefined) return '';
  if (typeof cell.v === 'object' && cell.v instanceof Date) return cell.v.toISOString().split('T')[0];
  return String(cell.v).trim();
}

function mapAmagiStatus(amagi) {
  if (!amagi || !amagi.trim()) return 'Pending';
  const val = amagi.trim();
  const map = {
    'No Subtitle': 'Issue',
    'Not Available in S3': 'Issue',
    'Hires Uploaded': 'Uploaded',
    'Already Received Before': 'Uploaded',
    'Location Paths Not Available': 'Issue',
    'Received': 'Pending',
    'Issue': 'Issue',
    'Subtitle Issue': 'Issue',
    'Working': 'Working',
    'Pending': 'Issue',
    'Approved': 'Uploaded',
    'Already Done': 'Uploaded',
    'Uploaded': 'Uploaded',
    'Review Done': 'Uploaded',
    'Re-Edit': 'Re-Edit',
    'Re-Work': 'Re-Edit',
    'Need to Review': 'Issue',
    'Reviewing': 'Working',
    'No subtitle': 'Issue',
    'Subtitle issue': 'Issue',
    'Ready to Share': 'Uploaded',
    'SharedPrev': 'Uploaded',
  };
  return map[val] || 'Uploaded';
}

// ===== SHEET SYNC =====
async function syncFromSheet() {
  if (syncing) return;
  syncing = true;
  const btn = document.getElementById('sync-btn');
  const icon = document.getElementById('sync-icon');
  if (btn) btn.disabled = true;
  if (icon) icon.textContent = 'sync';
  try {
    const data = await fetchGvizJsonp(SHEET_URL, SHEET_GID);
    if (!data || !data.table || !data.table.rows) throw new Error('No data in sheet');
    const raw = data.table.rows;
    if (raw.length < 3) throw new Error('Sheet has insufficient rows');

    const assets = [];
    for (let i = 0; i < raw.length; i++) {
      if (i < 2) continue;
      const rc = raw[i].c || [];
      if (!rc[1] || !gvizVal(rc[1])) continue;

      const title = gvizVal(rc[1]);
      const videoLocation = gvizVal(rc[2]);
      const ccLocation = gvizVal(rc[3]);
      const firstAirDate = gvizVal(rc[4]);
      const amagiComments = gvizVal(rc[5]);
      const notes = gvizVal(rc[6]);

      let assetRef = '';
      if (videoLocation) {
        const parts = videoLocation.replace(/\\/g, '/').split('/');
        assetRef = parts[parts.length - 1].replace(/\.\w+$/, '');
      }

      const editorStatus = mapAmagiStatus(amagiComments);

      assets.push({
        title, video_location: videoLocation, cc_location: ccLocation,
        first_air_date: firstAirDate, amagi_comments: amagiComments, notes,
        sheet_row: i + 1, asset_ref: assetRef, editor_status: editorStatus,
      });
    }

    if (!assets.length) throw new Error('No assets parsed from sheet');

    // Delete all existing assets via sb (Supabase library, no CORS issues)
    const { error: delErr } = await sb.from('assets').delete().gt('id', -1);
    if (delErr) throw new Error('Delete failed: ' + delErr.message);

    // Batch insert
    const chunkSize = 200;
    let inserted = 0;
    for (let i = 0; i < assets.length; i += chunkSize) {
      const chunk = assets.slice(i, i + chunkSize);
      const { error: insErr } = await sb.from('assets').insert(chunk);
      if (insErr) throw new Error('Insert failed: ' + insErr.message);
      inserted += chunk.length;
    }

    lastSyncHash = assets.map(a => a.asset_ref + a.title).join('|');
    toast(`Synced ${inserted} assets from sheet`, 'success');
    await loadData(); render();
  } catch (e) {
    toast('Sync failed: ' + e.message, 'error');
    console.error(e);
  } finally {
    syncing = false;
    if (btn) btn.disabled = false;
    if (icon) icon.textContent = 'sync';
  }
}

async function checkSheet() {
  if (!currentUser || syncing) return;
  try {
    const data = await fetchGvizJsonp(SHEET_URL, SHEET_GID);
    if (!data || !data.table || !data.table.rows) return;
    const raw = data.table.rows;
    const hash = raw.map((r, i) => {
      if (i < 2) return '';
      const rc = r.c || [];
      return (gvizVal(rc[1]) || '') + (gvizVal(rc[2]) || '');
    }).join('|');
    if (lastSyncHash && hash !== lastSyncHash) {
      toast('Sheet data changed — auto-syncing...', 'info');
      await syncFromSheet();
    }
    lastSyncHash = hash;
  } catch {}
}

// ===== CSV PARSER =====
function parseCSV(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === '\n' && !inQuotes) {
      lines.push(current); current = '';
    } else if (c === '\r' && !inQuotes) {
      // skip \r, use \n as delimiter
    } else {
      current += c;
    }
  }
  if (current) lines.push(current);

  return lines.map(line => {
    const fields = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (c === ',' && !q) {
        fields.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    fields.push(cur);
    return fields;
  });
}

// ===== UTILITY =====
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function cls(s) { return {Working:'status-working',Pending:'status-pending',Approved:'status-approved','Re-Edit':'status-reedit','Need to Review':'status-needreview',Reviewing:'status-needreview','Send for approval':'status-needreview','Rendered Prev & Hires':'status-approved',Downloaded:'status-approved','Uploaded - Need to verify':'status-working',Uploaded:'status-approved',Converted:'status-approved','Review Done':'status-approved'}[s]||'status-default'; }
function prio(p) { return p==='high'||p==='critical'?'priority-high':p==='medium'?'priority-medium':'priority-low'; }
const ES = ["Pending","Working","Converted","Downloaded","Issue","Kept for Converting","Kept for downloading","Movie not available","Need to Review","Not Available in S3","Re-Edit","Re-Edit Done","Re-Render","Re-Upload","Re-Uploading","Re-work","Ready for Hi-Rez","Ready to upload","Renderd Hi-Res file","Rendered Prev & Hires","Rendered Preview file","Rendering Hi-Res file","Rendering Preview file","Review Done","Reviewing","Send for approval","Subtitle not available","Transcording","Uploaded","Uploading","Already Done","Uploaded - Need to verify","Re-Work"];
const RS = ["Need to Review","Reviewing","Review Done","Approved","Re-Edit","Re-Work","Re-Re-Render","Issue"];
const AC = ["Approved","Working","Pending","SharedPrev","No subtitle","Not Available in S3","Hires Uploaded","Ready to Share","Already Received Before","Location Paths Not Available","Received","Subtitle issue"];

// ===== START =====
document.addEventListener('DOMContentLoaded', init);
