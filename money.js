// ═══════════════════════════════════════════════════════
// MONEY MANAGER — personal lifetime income / expense tracker
// ═══════════════════════════════════════════════════════

const MM_INCOME_CATS = [
  { id:'salary',    icon:'💼', label:'Salary' },
  { id:'freelance', icon:'💻', label:'Freelance' },
  { id:'business',  icon:'🏢', label:'Business' },
  { id:'gift',      icon:'🎁', label:'Gift' },
  { id:'refund',    icon:'↩️', label:'Refund' },
  { id:'invest',    icon:'📈', label:'Investment' },
  { id:'other-in',  icon:'📦', label:'Other' },
];

const MM_EXPENSE_CATS = [
  { id:'food',         icon:'🍽️', label:'Food & Drink' },
  { id:'grocery',      icon:'🛒', label:'Groceries' },
  { id:'transport',    icon:'🚗', label:'Transport' },
  { id:'shopping',     icon:'🛍️', label:'Shopping' },
  { id:'entertain',    icon:'🎬', label:'Entertainment' },
  { id:'bills',        icon:'🧾', label:'Bills & Utilities' },
  { id:'health',       icon:'💊', label:'Health' },
  { id:'travel',       icon:'✈️', label:'Travel' },
  { id:'education',    icon:'📚', label:'Education' },
  { id:'home',         icon:'🏠', label:'Home' },
  { id:'other-out',    icon:'📦', label:'Other' },
];

const MM_ASSET_TYPES = [
  { id:'cash',   icon:'💵', label:'Cash Wallet' },
  { id:'bank',   icon:'🏦', label:'Bank Account' },
  { id:'crypto', icon:'🪙', label:'Crypto Wallet' },
  { id:'other',  icon:'📦', label:'Other' },
];

const DONUT_COLORS = ['#06d6a0', '#ff6b35', '#ffd166', '#a855f7', '#0ea5e9', '#ef476f', '#14b8a6', '#f97316', '#8b5cf6', '#10b981', '#fb7185'];

function mmCat(id, type){
  const list = type === 'income' ? MM_INCOME_CATS : MM_EXPENSE_CATS;
  return list.find(c => c.id === id) || { id, icon:'📦', label: id };
}
function mmAssetType(id){
  return MM_ASSET_TYPES.find(t => t.id === id) || MM_ASSET_TYPES[3];
}

// ── STATE ──
state.profile = { name:'', currency:'USD', firstRun:true, googleUser:null };
state.money = { transactions: [], assets: [] };
state.mmPeriod = 'thisMonth';
state.mmCustomFrom = null;
state.mmCustomTo = null;
state.editTxId = null;
state.editAssetId = null;
state.assetReturnToTx = false;
state.prevTxAssetSelection = '';
state.txFilter = { type:'all', category:'all', search:'' };

function loadProfile(){
  try {
    const raw = localStorage.getItem('tripsplit_profile');
    if (raw) state.profile = { ...state.profile, ...JSON.parse(raw) };
  } catch {}
}
function saveProfile(){ localStorage.setItem('tripsplit_profile', JSON.stringify(state.profile)); }

function loadMoney(){
  try {
    const raw = localStorage.getItem('tripsplit_money');
    if (raw) state.money = JSON.parse(raw);
  } catch {}
  state.money.transactions = state.money.transactions || [];
  state.money.assets = state.money.assets || [];
  // Migration: older txs may not have assetId — treat as unassigned.
  state.money.transactions.forEach(tx => {
    if (tx.assetId === undefined) tx.assetId = null;
  });
}
function saveMoney(){ localStorage.setItem('tripsplit_money', JSON.stringify(state.money)); }

// ── UTILS ──
function mmMoney(amount, currency){
  const cur = currency || state.profile.currency || 'USD';
  try { return new Intl.NumberFormat('en-US',{ style:'currency', currency:cur, minimumFractionDigits:2 }).format(amount); }
  catch { return `${cur} ${parseFloat(amount).toFixed(2)}`; }
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── ASSETS ──
function getAssets(){ return state.money.assets || []; }

function computeAssetBalance(assetId){
  const asset = getAssets().find(a => a.id === assetId);
  if (!asset) return 0;
  let bal = parseFloat(asset.initialBalance) || 0;
  state.money.transactions.forEach(tx => {
    if (tx.assetId !== assetId) return;
    if (tx.type === 'income')  bal += tx.amount;
    if (tx.type === 'expense') bal -= tx.amount;
  });
  return bal;
}

function openAddAssetModal(prefilledType){
  state.editAssetId = null;
  document.getElementById('assetModalTitle').textContent = 'Add Asset';
  document.getElementById('assetName').value = '';
  document.getElementById('assetType').value = prefilledType || 'cash';
  document.getElementById('assetCurrency').value = state.profile.currency || 'USD';
  document.getElementById('assetInitialBalance').value = '0';
  document.getElementById('assetDeleteBtn').style.display = 'none';
  document.getElementById('assetBalanceNote').textContent = "What's currently in this account before tracking begins. Future income/expenses will adjust the balance automatically.";
  openModal('assetModal');
  setTimeout(() => document.getElementById('assetName').focus(), 60);
}

function openEditAssetModal(id){
  const asset = getAssets().find(a => a.id === id);
  if (!asset) return;
  state.editAssetId = id;
  document.getElementById('assetModalTitle').textContent = 'Edit Asset';
  document.getElementById('assetName').value = asset.name;
  document.getElementById('assetType').value = asset.type;
  document.getElementById('assetCurrency').value = asset.currency;
  document.getElementById('assetInitialBalance').value = asset.initialBalance;
  document.getElementById('assetDeleteBtn').style.display = 'inline-flex';
  const balance = computeAssetBalance(id);
  document.getElementById('assetBalanceNote').textContent = `Current balance: ${mmMoney(balance, asset.currency)} (initial ${mmMoney(asset.initialBalance, asset.currency)} + tx).`;
  openModal('assetModal');
}

function saveAsset(){
  const name = document.getElementById('assetName').value.trim();
  const type = document.getElementById('assetType').value;
  const currency = document.getElementById('assetCurrency').value || 'USD';
  const initialBalance = parseFloat(document.getElementById('assetInitialBalance').value) || 0;
  if (!name) { toast('Enter an account name','error'); return; }

  let newId = state.editAssetId;
  if (state.editAssetId) {
    const a = getAssets().find(x => x.id === state.editAssetId);
    if (!a) return;
    Object.assign(a, { name, type, currency, initialBalance });
    toast('Account updated','success');
  } else {
    const a = {
      id: uuid(), name, type, currency, initialBalance,
      createdAt: Date.parse(new Date().toISOString()),
    };
    state.money.assets.push(a);
    newId = a.id;
    toast(`Account "${name}" added`,'success');
  }
  saveMoney();
  closeModal('assetModal');
  state.editAssetId = null;
  renderMoneyView();
  // If asset was added while inside the tx modal, return there and pick this asset.
  if (state.assetReturnToTx) {
    state.assetReturnToTx = false;
    populateAssetDropdown(newId);
    state.prevTxAssetSelection = newId;
  }
}

function deleteAssetFromModal(){
  if (!state.editAssetId) return;
  const linked = state.money.transactions.filter(t => t.assetId === state.editAssetId);
  if (linked.length) {
    toast(`Can't delete — ${linked.length} transaction${linked.length===1?' is':'s are'} still linked. Reassign them first.`, 'error');
    return;
  }
  if (!confirm('Delete this account?')) return;
  state.money.assets = state.money.assets.filter(a => a.id !== state.editAssetId);
  saveMoney();
  closeModal('assetModal');
  state.editAssetId = null;
  renderMoneyView();
  toast('Account deleted','info');
}

// ── DONUT CHART ──
function renderDonut(segments, options){
  options = options || {};
  const positiveSegs = segments.filter(s => s.value > 0);
  const total = positiveSegs.reduce((s, x) => s + x.value, 0);
  let gradient;
  if (total <= 0) {
    gradient = `conic-gradient(var(--border) 0deg 360deg)`;
  } else {
    const stops = [];
    let acc = 0;
    positiveSegs.forEach(seg => {
      const start = (acc / total) * 360;
      acc += seg.value;
      const end = (acc / total) * 360;
      stops.push(`${seg.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`);
    });
    gradient = `conic-gradient(${stops.join(', ')})`;
  }
  const sizeClass = options.size === 'small' ? ' small' : '';
  return `
    <div class="donut-wrap">
      <div class="donut${sizeClass}" style="background: ${gradient};">
        <div class="donut-hole">
          ${options.centerLabel ? `<div class="donut-center-label">${options.centerLabel}</div>` : ''}
          ${options.centerValue ? `<div class="donut-center-value">${options.centerValue}</div>` : ''}
        </div>
      </div>
    </div>`;
}

function renderDonutLegend(segments){
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  return `<div class="donut-legend">${segments.map(seg => {
    const pct = total > 0 ? (Math.max(0, seg.value)/total*100).toFixed(1) : 0;
    return `<div class="donut-legend-item">
      <span class="donut-legend-dot" style="background:${seg.color}"></span>
      <span class="donut-legend-label">${seg.label}</span>
      <span class="donut-legend-value">${seg.formattedValue}<span class="donut-legend-pct"> ${pct}%</span></span>
    </div>`;
  }).join('')}</div>`;
}

// ── PERIOD FILTERING ──
function mmPeriodRange(){
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (state.mmPeriod === 'thisMonth') return { from: new Date(y, m, 1), to: new Date(y, m+1, 0, 23,59,59) };
  if (state.mmPeriod === 'lastMonth') return { from: new Date(y, m-1, 1), to: new Date(y, m, 0, 23,59,59) };
  if (state.mmPeriod === 'thisYear')  return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23,59,59) };
  if (state.mmPeriod === 'custom') {
    const f = state.mmCustomFrom ? new Date(state.mmCustomFrom+'T00:00:00') : new Date(2000,0,1);
    const t = state.mmCustomTo   ? new Date(state.mmCustomTo  +'T23:59:59') : new Date(2100,11,31);
    return { from:f, to:t };
  }
  return { from: new Date(2000,0,1), to: new Date(2100,11,31) };
}
function mmInRange(tx){
  const { from, to } = mmPeriodRange();
  const d = new Date(tx.date + 'T00:00:00');
  return d >= from && d <= to;
}
function mmPeriodLabel(){
  if (state.mmPeriod === 'thisMonth')  return 'This Month';
  if (state.mmPeriod === 'lastMonth')  return 'Last Month';
  if (state.mmPeriod === 'thisYear')   return 'This Year';
  if (state.mmPeriod === 'custom')     return 'Custom';
  return 'All Time';
}
function setMMPeriod(p){
  state.mmPeriod = p;
  if (p === 'custom') {
    openModal('mmCustomRangeModal');
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('mmFromDate').value = state.mmCustomFrom || today;
    document.getElementById('mmToDate').value   = state.mmCustomTo   || today;
  } else {
    renderMoneyView();
  }
}
function applyCustomRange(){
  const f = document.getElementById('mmFromDate').value;
  const t = document.getElementById('mmToDate').value;
  if (!f || !t) { toast('Pick both dates','error'); return; }
  if (new Date(f) > new Date(t)) { toast('From date must be before To date','error'); return; }
  state.mmCustomFrom = f; state.mmCustomTo = t;
  closeModal('mmCustomRangeModal');
  renderMoneyView();
}

// ── NAVIGATION ──
function showMoneyView(){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('moneyView').classList.add('active');
  document.body.classList.add('mm-mode');
  setActiveNav('money');
  document.getElementById('headerActions').innerHTML = `
    <button class="btn btn-ghost" onclick="showProfileView()" title="Profile settings">⚙️</button>
    <button class="btn btn-mm-ghost" onclick="openAddTxModal('income')">+ Income</button>
    <button class="btn btn-mm" onclick="openAddTxModal('expense')">+ Expense</button>`;
  state.currentTripId = null;
  renderMoneyView();
}

function setActiveNav(section){
  document.querySelectorAll('.side-nav .nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.section === section);
  });
}

function showGroupList(type){
  state.activeGroupType = type;
  const labels = groupLabels(type);
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('tripsView').classList.add('active');
  document.body.classList.remove('mm-mode');
  setActiveNav(type === 'home' ? 'homes' : 'trips');
  document.getElementById('headerActions').innerHTML = `
    <button class="btn btn-ghost" onclick="downloadBackup()" title="Download backup file">⬇ Backup</button>
    <button class="btn btn-ghost" onclick="triggerRestoreUpload()" title="Restore from backup file">⬆ Restore</button>
    <button class="btn btn-primary" onclick="openNewTripModal()">${labels.newButton}</button>`;
  state.currentTripId = null;
  renderTripsGrid();
}

function showTripsMainView(){ showGroupList('trip'); }
function showSharedHomesView(){ showGroupList('home'); }

function showProfileView(){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('profileView').classList.add('active');
  document.body.classList.remove('mm-mode');
  setActiveNav('profile');
  document.getElementById('headerActions').innerHTML = `
    <button class="btn btn-ghost" onclick="openProfileSetup(false)">Edit Profile</button>`;
  state.currentTripId = null;
  renderProfileView();
}

// Override the back button's showTripsView (defined in app.js) so the nav
// state and header actions stay in sync.
window.showTripsView = function(){ showGroupList(state.activeGroupType || 'trip'); };

// ── RENDER ──
function renderMoneyView(){
  document.getElementById('mmGreetingName').textContent = state.profile.name || 'there';
  document.querySelectorAll('.mm-period-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.period === state.mmPeriod);
  });

  const all = state.money.transactions || [];
  const txs = all.filter(mmInRange);
  const income  = txs.filter(t => t.type === 'income').reduce((s,t)=>s+t.amount, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s,t)=>s+t.amount, 0);
  const net = income - expense;

  document.getElementById('mmIncomeAmount').textContent  = mmMoney(income);
  document.getElementById('mmExpenseAmount').textContent = mmMoney(expense);
  document.getElementById('mmNetAmount').textContent     = (net >= 0 ? '+' : '') + mmMoney(net);
  document.getElementById('mmNetAmount').className       = 'mm-stat-value ' + (net >= 0 ? 'pos' : 'neg');
  document.getElementById('mmPeriodLabel').textContent   = mmPeriodLabel();
  document.getElementById('mmTxCount').textContent       = `${txs.length} transaction${txs.length===1?'':'s'} this period · ${all.length} total`;

  renderAssetsSection();
  renderRecentList(txs, all);
  renderSpendingBreakdown(txs);
  renderIncomeBreakdown(txs);
  renderTopPayees(txs);
}

function renderAssetsSection(){
  const assets = getAssets();
  const el = document.getElementById('mmAssetsSection');
  if (!assets.length) {
    el.innerHTML = `
      <div class="mm-card mm-assets-card">
        <div class="mm-card-header">
          <h3>💼 Your Assets</h3>
          <button class="btn btn-mm btn-sm" onclick="openAddAssetModal()">+ Add Asset</button>
        </div>
        <div class="mm-empty">
          <div class="mm-empty-icon">💼</div>
          <h3>No accounts yet</h3>
          <p>Add your cash wallet, bank account, or crypto wallet to track balances.</p>
        </div>
      </div>`;
    return;
  }
  const segments = assets.map((a, i) => {
    const balance = computeAssetBalance(a.id);
    return {
      id: a.id,
      label: `${mmAssetType(a.type).icon} ${escapeHtml(a.name)}`,
      value: Math.max(0, balance),
      formattedValue: mmMoney(balance, a.currency),
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      balance, currency: a.currency,
    };
  });
  const total = assets.reduce((s, a) => s + computeAssetBalance(a.id), 0);
  const baseCurrency = state.profile.currency || assets[0].currency;
  const mixedCur = !assets.every(a => a.currency === baseCurrency);

  el.innerHTML = `
    <div class="mm-card mm-assets-card">
      <div class="mm-card-header">
        <h3>💼 Your Assets</h3>
        <button class="btn btn-mm-ghost btn-sm" onclick="openAddAssetModal()">+ Add Asset</button>
      </div>
      <div class="mm-assets-body">
        ${renderDonut(segments, { centerLabel:'Total', centerValue: mixedCur ? '—' : mmMoney(total, baseCurrency) })}
        <div class="mm-asset-legend">
          ${segments.map(seg => `
            <div class="mm-asset-row" onclick="openEditAssetModal('${seg.id}')" title="Click to edit">
              <span class="donut-legend-dot" style="background:${seg.color}"></span>
              <span class="mm-asset-name">${seg.label}</span>
              <span class="mm-asset-balance ${seg.balance < 0 ? 'neg' : ''}">${seg.formattedValue}</span>
            </div>`).join('')}
          ${mixedCur ? `<div class="mm-mixed-currency-note">Mixed currencies — total not converted.</div>` : ''}
        </div>
      </div>
    </div>`;
}

function renderRecentList(txs, all){
  const recent = [...txs].sort((a,b)=>new Date(b.date)-new Date(a.date) || (b.createdAt||0)-(a.createdAt||0)).slice(0, 8);
  const recentList = document.getElementById('mmRecentList');
  if (!recent.length) {
    recentList.innerHTML = `<div class="mm-empty">
      <div class="mm-empty-icon">💸</div>
      <h3>No transactions in this period</h3>
      <p>Add your first ${all.length ? 'one' : 'income or expense'} above to start tracking.</p>
    </div>`;
  } else {
    recentList.innerHTML = recent.map(renderMMTxRow).join('') + `
      <div style="text-align:center; margin-top:14px;">
        <button class="btn btn-mm-ghost btn-sm" onclick="openAllTxView()">View all transactions →</button>
      </div>`;
  }
}

function renderSpendingBreakdown(txs){
  const el = document.getElementById('mmCategoryBars');
  const byCat = {};
  txs.filter(t => t.type === 'expense').forEach(t => {
    byCat[t.category] = (byCat[t.category] || 0) + t.amount;
  });
  const segments = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([catId, amt], i) => {
    const c = mmCat(catId, 'expense');
    return {
      label: `${c.icon} ${c.label}`,
      value: amt,
      formattedValue: mmMoney(amt),
      color: DONUT_COLORS[i % DONUT_COLORS.length],
    };
  });
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!segments.length) {
    el.innerHTML = `<p class="mm-empty-line">No expenses in this period.</p>`;
  } else {
    el.innerHTML = `
      <div class="donut-stack">
        ${renderDonut(segments, { centerLabel:'Spent', centerValue: mmMoney(total), size:'small' })}
        ${renderDonutLegend(segments)}
      </div>`;
  }
}

function renderIncomeBreakdown(txs){
  const el = document.getElementById('mmIncomeBars');
  const byCat = {};
  txs.filter(t => t.type === 'income').forEach(t => {
    byCat[t.category] = (byCat[t.category] || 0) + t.amount;
  });
  const segments = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([catId, amt], i) => {
    const c = mmCat(catId, 'income');
    return {
      label: `${c.icon} ${c.label}`,
      value: amt,
      formattedValue: mmMoney(amt),
      color: DONUT_COLORS[i % DONUT_COLORS.length],
    };
  });
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!segments.length) {
    el.innerHTML = `<p class="mm-empty-line">No income in this period.</p>`;
  } else {
    el.innerHTML = `
      <div class="donut-stack">
        ${renderDonut(segments, { centerLabel:'Earned', centerValue: mmMoney(total), size:'small' })}
        ${renderDonutLegend(segments)}
      </div>`;
  }
}

function renderTopPayees(txs){
  const payeeEl = document.getElementById('mmTopPayees');
  const payeeMap = {};
  txs.filter(t => t.type === 'expense' && t.payee && t.payee.trim()).forEach(t => {
    const k = t.payee.trim();
    payeeMap[k] = (payeeMap[k] || 0) + t.amount;
  });
  const topPayees = Object.entries(payeeMap).sort((a,b)=>b[1]-a[1]).slice(0, 6);
  if (!topPayees.length) {
    payeeEl.innerHTML = `<p class="mm-empty-line">No named payees yet. Add a shop/payee when you log an expense to see top spenders here.</p>`;
  } else {
    payeeEl.innerHTML = topPayees.map(([name, amt]) => `
      <div class="mm-payee-row">
        <div class="mm-payee-name">${escapeHtml(name)}</div>
        <div class="mm-payee-amount">${mmMoney(amt)}</div>
      </div>`).join('');
  }
}

function renderMMTxRow(tx){
  const cat = mmCat(tx.category, tx.type);
  const isIncome = tx.type === 'income';
  const sign = isIncome ? '+' : '−';
  const amountCls = isIncome ? 'pos' : 'neg';
  const dateStr = tx.date ? new Date(tx.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
  const subParts = [dateStr];
  if (tx.payee) subParts.push(escapeHtml(tx.payee));
  const sub = subParts.filter(Boolean).join(' · ');
  const asset = tx.assetId ? getAssets().find(a => a.id === tx.assetId) : null;
  const assetTag = asset
    ? `<span class="mm-asset-tag">${mmAssetType(asset.type).icon} ${escapeHtml(asset.name)}</span>`
    : `<span class="mm-asset-tag muted">no account</span>`;
  const linkTag = tx.tripLink ? `<span class="mm-trip-tag" title="Auto-linked from a trip expense">🔗 from trip</span>` : '';
  const editBtn = `<button class="btn btn-ghost btn-sm btn-icon" onclick="openEditTxModal('${tx.id}')" title="${tx.tripLink ? 'Edit account / category (amount syncs from trip)' : 'Edit'}">${tx.tripLink ? '🔗' : '✏️'}</button>`;
  const delBtn = tx.tripLink
    ? ''
    : `<button class="btn btn-danger btn-sm btn-icon" onclick="deleteTransaction('${tx.id}')" title="Delete">🗑️</button>`;
  return `
  <div class="mm-tx-row ${isIncome ? 'income' : 'expense'}">
    <div class="mm-tx-cat">${cat.icon}</div>
    <div class="mm-tx-info">
      <div class="mm-tx-title">${escapeHtml(tx.description || cat.label)} ${linkTag}</div>
      <div class="mm-tx-sub">${cat.label}${sub ? ' · ' + sub : ''} · ${assetTag}${tx.notes ? ' · 📝' : ''}</div>
    </div>
    <div class="mm-tx-right">
      <div class="mm-tx-amount ${amountCls}">${sign} ${mmMoney(tx.amount, tx.currency)}</div>
    </div>
    <div class="mm-tx-actions">${editBtn}${delBtn}</div>
  </div>`;
}

// ── PROFILE SETUP ──
function openProfileSetup(isFirstRun){
  document.getElementById('profileSetupTitle').textContent = isFirstRun ? 'Welcome to TripSplit 👋' : 'Edit Profile';
  document.getElementById('profileSetupSub').textContent = isFirstRun
    ? "First, tell us who you are. We'll auto-link your trip payments to your personal money manager so you don't have to enter them twice."
    : 'Update your name and default currency.';
  document.getElementById('profileNameInput').value = state.profile.name || '';
  document.getElementById('profileCurrencyInput').value = state.profile.currency || 'USD';
  const emailGroup = document.getElementById('profileEmailGroup');
  const emailInput = document.getElementById('profileEmailInput');
  const email = state.profile.googleUser?.email || '';
  if (emailGroup && emailInput) {
    emailGroup.style.display = email ? 'block' : 'none';
    emailInput.value = email;
  }
  openModal('profileSetupModal');
  setTimeout(() => document.getElementById('profileNameInput').focus(), 60);
}
function saveProfileSettings(){
  const name = document.getElementById('profileNameInput').value.trim();
  const currency = document.getElementById('profileCurrencyInput').value || 'USD';
  if (!name) { toast('Please enter your name','error'); return; }
  const wasFirstRun = state.profile.firstRun;
  state.profile.name = name;
  state.profile.currency = currency;
  state.profile.firstRun = false;
  saveProfile();
  closeModal('profileSetupModal');
  toast(wasFirstRun ? `Welcome, ${name}!` : 'Profile saved', 'success');
  if (state.profile.googleUser && window.startTripCloudSync && window.firebase?.auth?.().currentUser) {
    startTripCloudSync(firebase.auth().currentUser);
  }
  retroLinkAllTrips();
  renderMoneyView();
  if (document.getElementById('profileView')?.classList.contains('active')) renderProfileView();
}
function openMMSettings(){ openProfileSetup(false); }

function renderProfileView(){
  const panel = document.getElementById('profilePanel');
  if (!panel) return;
  const user = state.profile.googleUser;
  const email = user?.email || 'Not signed in';
  const photo = user?.picture || 'icons/icon-192.png';
  const name = state.profile.name || user?.name || 'No name set';
  panel.innerHTML = `
    <div class="profile-card-main">
      <img class="profile-avatar-large" src="${photo}" alt="">
      <div class="profile-main-copy">
        <h3>${escapeHtml(name)}</h3>
        <p>${escapeHtml(email)}</p>
      </div>
      <button class="btn btn-primary" onclick="openProfileSetup(false)">Edit Name</button>
    </div>
    <div class="profile-grid">
      <div class="profile-info-card">
        <span>Name</span>
        <strong>${escapeHtml(name)}</strong>
      </div>
      <div class="profile-info-card">
        <span>Google Email</span>
        <strong>${escapeHtml(email)}</strong>
        <small>Email is controlled by Google sign-in.</small>
      </div>
      <div class="profile-info-card">
        <span>Default Currency</span>
        <strong>${escapeHtml(state.profile.currency || 'USD')}</strong>
      </div>
    </div>
    <div class="profile-actions">
      ${user ? `<button class="btn btn-ghost" onclick="signOutGoogle()">Sign out</button>` : `<button class="btn btn-mm" onclick="signInWithGoogle()">Continue with Google</button>`}
    </div>`;
}

// Firebase Auth stores the Google identity used for cloud trip sync.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC_8UgDD7TDvFeRv9AWrtQKM1ni0yU4Tc8",
  authDomain: "tripsplit-94d96.firebaseapp.com",
  projectId: "tripsplit-94d96",
  storageBucket: "tripsplit-94d96.firebasestorage.app",
  messagingSenderId: "936242386888",
  appId: "1:936242386888:web:5a174c52e7c3da57b052fd",
  measurementId: "G-NS0SQ00X7Q"
};
let googleButtonsRendered = false;
let firebaseReady = false;

function applyFirebaseUser(user) {
  if (!user) return;
  state.profile.googleUser = {
    id: user.uid,
    name: user.displayName || state.profile.name || '',
    email: user.email || '',
    picture: user.photoURL || '',
  };
  state.profile.name = state.profile.name || user.displayName || '';
  state.profile.firstRun = false;
  saveProfile();
  updateGoogleAuthUI();
  if (document.getElementById('profileView')?.classList.contains('active')) renderProfileView();
}

function initFirebase() {
  if (firebaseReady) return true;
  if (!window.firebase?.initializeApp || !firebase.auth || !firebase.firestore) return false;
  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
  firebase.auth().onAuthStateChanged(user => {
    if (user) {
      applyFirebaseUser(user);
      if (window.startTripCloudSync) startTripCloudSync(user);
    } else if (window.stopTripCloudSync) {
      stopTripCloudSync();
    }
  });
  firebaseReady = true;
  return true;
}

function initFirebaseWhenReady(attempt = 0) {
  if (initFirebase()) return;
  if (attempt < 60) setTimeout(() => initFirebaseWhenReady(attempt + 1), 150);
}

function signInWithGoogle(attempt = 0) {
  if (!initFirebase()) {
    if (attempt < 60) setTimeout(() => signInWithGoogle(attempt + 1), 150);
    else toast('Google sign-in is still loading. Please try again.','error');
    return;
  }
  const wasFirstRun = state.profile.firstRun || !state.profile.name;
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt:'select_account' });
  firebase.auth().signInWithPopup(provider).then(result => {
    const user = result.user;
    applyFirebaseUser(user);
    if (window.startTripCloudSync) startTripCloudSync(user);
    const displayName = user.displayName || user.email || 'there';
    const nameInput = document.getElementById('profileNameInput');
    if (nameInput) nameInput.value = displayName;
    closeModal('profileSetupModal');
    toast(wasFirstRun ? `Welcome, ${displayName}!` : 'Signed in with Google', 'success');
    retroLinkAllTrips();
    renderMoneyView();
  }).catch(err => {
    console.warn('Firebase Google sign-in failed:', err);
    const msg = err?.code === 'auth/unauthorized-domain'
      ? 'This domain is not authorized in Firebase Authentication.'
      : 'Google sign-in failed. Please try again.';
    toast(msg,'error');
  });
}

function initGoogleSignIn(attempt = 0) {
  if (googleButtonsRendered) return;
  ['googleSignInSidebar', 'googleSignInProfile'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<button class="google-login-btn" type="button" onclick="signInWithGoogle()">Continue with Google</button>`;
  });

  googleButtonsRendered = true;
  updateGoogleAuthUI();
}

function updateGoogleAuthUI() {
  const user = state.profile.googleUser;
  const signedOut = document.getElementById('sidebarSignedOut');
  const signedIn = document.getElementById('sidebarSignedIn');
  if (!signedOut || !signedIn) return;

  signedOut.style.display = user ? 'none' : 'flex';
  signedIn.style.display = user ? 'flex' : 'none';
  if (!user) return;

  document.getElementById('googleUserName').textContent = user.name || 'Signed in';
  document.getElementById('googleUserEmail').textContent = user.email || '';
  const avatar = document.getElementById('googleUserAvatar');
  avatar.src = user.picture || 'icons/icon-192.png';
  avatar.alt = user.name ? `${user.name} profile photo` : 'Google profile photo';
}

function signOutGoogle() {
  if (initFirebase()) firebase.auth().signOut().catch(err => console.warn('Firebase sign-out failed:', err));
  if (window.stopTripCloudSync) stopTripCloudSync();
  state.profile.googleUser = null;
  saveProfile();
  updateGoogleAuthUI();
  if (document.getElementById('profileView')?.classList.contains('active')) renderProfileView();
  toast('Signed out of Google on this device','info');
}

window.signInWithGoogle = signInWithGoogle;
window.signOutGoogle = signOutGoogle;

// ── ADD / EDIT TRANSACTION ──
function openAddTxModal(type){
  state.editTxId = null;
  document.getElementById('txModalTitle').textContent = type === 'income' ? 'Add Income' : 'Add Expense';
  document.getElementById('txType').value = type;
  document.getElementById('txAmount').value = '';
  document.getElementById('txAmount').disabled = false;
  document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('txDate').disabled = false;
  document.getElementById('txDescription').value = '';
  document.getElementById('txDescription').disabled = false;
  document.getElementById('txPayee').value = '';
  document.getElementById('txNotes').value = '';
  document.getElementById('txCurrency').value = state.profile.currency || 'USD';
  document.getElementById('txCurrency').disabled = false;
  populateCategoryDropdown(type);
  populateAssetDropdown('');
  state.prevTxAssetSelection = '';
  document.getElementById('addTxModal').dataset.type = type;
  document.getElementById('addTxModal').querySelector('.modal').classList.toggle('mm-modal-income', type === 'income');
  document.getElementById('addTxModal').querySelector('.modal').classList.toggle('mm-modal-expense', type === 'expense');
  document.getElementById('txTripLinkInfo').style.display = 'none';
  document.getElementById('txSaveBtn').textContent = type === 'income' ? 'Save Income' : 'Save Expense';
  document.getElementById('txDeleteBtn').style.display = 'none';
  openModal('addTxModal');
}

function openEditTxModal(id){
  const tx = state.money.transactions.find(t => t.id === id);
  if (!tx) return;
  state.editTxId = id;
  const isLinked = !!tx.tripLink;
  document.getElementById('txModalTitle').textContent = isLinked
    ? `Edit Trip-Linked Expense`
    : `Edit ${tx.type === 'income' ? 'Income' : 'Expense'}`;
  document.getElementById('txType').value = tx.type;
  document.getElementById('txAmount').value = tx.amount;
  document.getElementById('txAmount').disabled = isLinked;
  document.getElementById('txDate').value = tx.date;
  document.getElementById('txDate').disabled = isLinked;
  document.getElementById('txDescription').value = tx.description || '';
  document.getElementById('txDescription').disabled = isLinked;
  document.getElementById('txPayee').value = tx.payee || '';
  document.getElementById('txNotes').value = tx.notes || '';
  document.getElementById('txCurrency').value = tx.currency || state.profile.currency || 'USD';
  document.getElementById('txCurrency').disabled = isLinked;
  populateCategoryDropdown(tx.type, tx.category);
  populateAssetDropdown(tx.assetId || '');
  state.prevTxAssetSelection = tx.assetId || '';
  document.getElementById('addTxModal').dataset.type = tx.type;
  document.getElementById('addTxModal').querySelector('.modal').classList.toggle('mm-modal-income', tx.type === 'income');
  document.getElementById('addTxModal').querySelector('.modal').classList.toggle('mm-modal-expense', tx.type === 'expense');

  const linkInfo = document.getElementById('txTripLinkInfo');
  if (isLinked) {
    linkInfo.innerHTML = `🔗 <b>Linked from a trip expense.</b> Amount, date, and description sync from the trip — edit the source trip expense to change them. You can still set the account, category, payee, and notes here.`;
    linkInfo.style.display = 'block';
  } else {
    linkInfo.style.display = 'none';
  }
  document.getElementById('txSaveBtn').textContent = 'Save Changes';
  document.getElementById('txDeleteBtn').style.display = isLinked ? 'none' : 'inline-flex';
  openModal('addTxModal');
}

function populateCategoryDropdown(type, selected){
  const list = type === 'income' ? MM_INCOME_CATS : MM_EXPENSE_CATS;
  const sel = document.getElementById('txCategory');
  sel.innerHTML = list.map(c => `<option value="${c.id}" ${c.id===selected?'selected':''}>${c.icon} ${c.label}</option>`).join('');
}

function populateAssetDropdown(selectedId){
  const sel = document.getElementById('txAssetId');
  if (!sel) return;
  const assets = getAssets();
  let html = '<option value="">— Select account —</option>';
  if (assets.length) {
    html += assets.map(a => `<option value="${a.id}" ${a.id===selectedId?'selected':''}>${mmAssetType(a.type).icon} ${escapeHtml(a.name)}  ·  ${mmMoney(computeAssetBalance(a.id), a.currency)}</option>`).join('');
  }
  html += `<option value="__add__">＋ Add new account…</option>`;
  sel.innerHTML = html;
  sel.value = selectedId || '';
}

function onTxAssetChange(){
  const sel = document.getElementById('txAssetId');
  const val = sel.value;
  if (val === '__add__') {
    sel.value = state.prevTxAssetSelection || '';
    state.assetReturnToTx = true;
    openAddAssetModal();
  } else {
    state.prevTxAssetSelection = val;
  }
}

function saveTransaction(){
  const type = document.getElementById('txType').value;
  const amount = parseFloat(document.getElementById('txAmount').value);
  const date = document.getElementById('txDate').value;
  const category = document.getElementById('txCategory').value;
  const description = document.getElementById('txDescription').value.trim();
  const payee = document.getElementById('txPayee').value.trim();
  const notes = document.getElementById('txNotes').value.trim();
  const currency = document.getElementById('txCurrency').value || state.profile.currency || 'USD';
  const assetId = document.getElementById('txAssetId').value;

  if (state.editTxId) {
    const tx = state.money.transactions.find(t => t.id === state.editTxId);
    if (!tx) return;
    // For trip-linked txs, only update non-locked fields.
    if (tx.tripLink) {
      if (!assetId || assetId === '__add__') { toast('Pick an account','error'); return; }
      tx.category = category;
      tx.payee = payee;
      tx.notes = notes;
      tx.assetId = assetId;
    } else {
      if (!amount || amount <= 0) { toast('Enter a valid amount','error'); return; }
      if (!date) { toast('Pick a date','error'); return; }
      if (!category) { toast('Pick a category','error'); return; }
      if (!assetId || assetId === '__add__') { toast('Pick an account','error'); return; }
      Object.assign(tx, { type, amount, date, category, description, payee, notes, currency, assetId });
    }
    toast('Transaction updated','success');
  } else {
    if (!amount || amount <= 0) { toast('Enter a valid amount','error'); return; }
    if (!date) { toast('Pick a date','error'); return; }
    if (!category) { toast('Pick a category','error'); return; }
    if (!assetId || assetId === '__add__') { toast('Pick an account','error'); return; }
    state.money.transactions.push({
      id: uuid(),
      type, amount, date, category, description, payee, notes, currency, assetId,
      createdAt: Date.parse(new Date().toISOString()),
      tripLink: null,
    });
    toast(type === 'income' ? 'Income added' : 'Expense added', 'success');
  }
  saveMoney();
  closeModal('addTxModal');
  state.editTxId = null;
  renderMoneyView();
  if (document.getElementById('allTxView').classList.contains('active')) renderAllTxView();
}

function deleteTxFromModal(){
  if (!state.editTxId) return;
  const tx = state.money.transactions.find(t => t.id === state.editTxId);
  if (tx && tx.tripLink) { toast('Linked to a trip — delete the trip expense instead','info'); return; }
  if (!confirm('Delete this transaction?')) return;
  state.money.transactions = state.money.transactions.filter(t => t.id !== state.editTxId);
  saveMoney();
  closeModal('addTxModal');
  state.editTxId = null;
  renderMoneyView();
  if (document.getElementById('allTxView').classList.contains('active')) renderAllTxView();
  toast('Transaction deleted','info');
}

function deleteTransaction(id){
  const tx = state.money.transactions.find(t => t.id === id);
  if (!tx) return;
  if (tx.tripLink) { toast('Linked to a trip — delete the trip expense instead','info'); return; }
  if (!confirm('Delete this transaction?')) return;
  state.money.transactions = state.money.transactions.filter(t => t.id !== id);
  saveMoney();
  renderMoneyView();
  if (document.getElementById('allTxView').classList.contains('active')) renderAllTxView();
  toast('Transaction deleted','info');
}

// ── ALL TRANSACTIONS VIEW ──
function openAllTxView(){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('allTxView').classList.add('active');
  document.body.classList.add('mm-mode');
  document.getElementById('headerActions').innerHTML = `
    <button class="btn btn-mm-ghost" onclick="openAddTxModal('income')">+ Income</button>
    <button class="btn btn-mm" onclick="openAddTxModal('expense')">+ Expense</button>`;
  state.txFilter = { type:'all', category:'all', search:'' };
  document.getElementById('txFilterType').value = 'all';
  document.getElementById('txFilterCategory').value = 'all';
  document.getElementById('txFilterSearch').value = '';
  populateFilterCategoryDropdown();
  renderAllTxView();
}

function populateFilterCategoryDropdown(){
  const sel = document.getElementById('txFilterCategory');
  sel.innerHTML = `<option value="all">All Categories</option>`
    + `<optgroup label="Income">${MM_INCOME_CATS.map(c=>`<option value="in:${c.id}">${c.icon} ${c.label}</option>`).join('')}</optgroup>`
    + `<optgroup label="Expense">${MM_EXPENSE_CATS.map(c=>`<option value="ex:${c.id}">${c.icon} ${c.label}</option>`).join('')}</optgroup>`;
}

function applyTxFilter(){
  state.txFilter.type     = document.getElementById('txFilterType').value;
  state.txFilter.category = document.getElementById('txFilterCategory').value;
  state.txFilter.search   = document.getElementById('txFilterSearch').value.toLowerCase().trim();
  renderAllTxView();
}

function renderAllTxView(){
  const f = state.txFilter;
  let list = [...state.money.transactions];
  if (f.type !== 'all') list = list.filter(t => t.type === f.type);
  if (f.category !== 'all') {
    const [pref, id] = f.category.split(':');
    list = list.filter(t => t.category === id && t.type === (pref === 'in' ? 'income' : 'expense'));
  }
  if (f.search) {
    list = list.filter(t =>
      (t.description||'').toLowerCase().includes(f.search) ||
      (t.payee||'').toLowerCase().includes(f.search) ||
      (t.notes||'').toLowerCase().includes(f.search)
    );
  }
  list.sort((a,b) => new Date(b.date) - new Date(a.date) || (b.createdAt||0) - (a.createdAt||0));

  const income  = list.filter(t => t.type === 'income').reduce((s,t)=>s+t.amount, 0);
  const expense = list.filter(t => t.type === 'expense').reduce((s,t)=>s+t.amount, 0);
  document.getElementById('allTxSummary').innerHTML = `
    <span><b>${list.length}</b> result${list.length===1?'':'s'}</span>
    <span class="dot">·</span>
    <span class="pos">+${mmMoney(income)}</span>
    <span class="dot">·</span>
    <span class="neg">−${mmMoney(expense)}</span>`;

  const container = document.getElementById('allTxList');
  if (!list.length) {
    container.innerHTML = `<div class="mm-empty"><div class="mm-empty-icon">🔍</div><h3>No transactions match</h3><p>Try removing some filters or add a new transaction.</p></div>`;
    return;
  }
  const groups = {};
  list.forEach(t => {
    const d = new Date(t.date + 'T00:00:00');
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = d.toLocaleDateString('en-US',{month:'long', year:'numeric'});
    if (!groups[key]) groups[key] = { label, items:[] };
    groups[key].items.push(t);
  });
  container.innerHTML = Object.keys(groups).sort().reverse().map(k => {
    const g = groups[k];
    const monthIncome  = g.items.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
    const monthExpense = g.items.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
    return `
    <div class="mm-month-group">
      <div class="mm-month-header">
        <h4>${g.label}</h4>
        <div class="mm-month-stats">
          <span class="pos">+${mmMoney(monthIncome)}</span>
          <span class="neg">−${mmMoney(monthExpense)}</span>
        </div>
      </div>
      ${g.items.map(renderMMTxRow).join('')}
    </div>`;
  }).join('');
}

// ── TRIP INTEGRATION ──
function autoLinkTripExpense(trip, expense){
  if (!state.profile.name) return;
  const myName = state.profile.name;
  const matchedPayer = Object.keys(expense.payers || {}).find(
    k => k.toLowerCase() === myName.toLowerCase()
  );
  const existing = state.money.transactions.find(t => t.tripLink && t.tripLink.expenseId === expense.id);
  if (!matchedPayer) {
    if (existing) {
      state.money.transactions = state.money.transactions.filter(t => t.id !== existing.id);
      saveMoney();
    }
    return;
  }
  const myShare = expense.payers[matchedPayer];
  const description = `${trip.name} – ${expense.name}`;
  if (existing) {
    existing.amount = myShare;
    existing.date = expense.date;
    existing.description = description;
    existing.currency = trip.currency;
    // category, payee, notes, assetId kept as user has set them
  } else {
    state.money.transactions.push({
      id: uuid(),
      type: 'expense',
      amount: myShare,
      date: expense.date,
      category: 'travel',
      description,
      payee: '',
      notes: '',
      currency: trip.currency,
      assetId: null,
      createdAt: Date.parse(new Date().toISOString()),
      tripLink: { tripId: trip.id, expenseId: expense.id },
    });
  }
  saveMoney();
  if (document.getElementById('moneyView').classList.contains('active')) renderMoneyView();
  if (document.getElementById('allTxView').classList.contains('active')) renderAllTxView();
}

function removeLinkedMoneyTx(expenseId){
  const before = state.money.transactions.length;
  state.money.transactions = state.money.transactions.filter(t => !(t.tripLink && t.tripLink.expenseId === expenseId));
  if (state.money.transactions.length !== before) {
    saveMoney();
    if (document.getElementById('moneyView').classList.contains('active')) renderMoneyView();
    if (document.getElementById('allTxView').classList.contains('active')) renderAllTxView();
  }
}

function removeAllLinkedFromTrip(tripId){
  const before = state.money.transactions.length;
  state.money.transactions = state.money.transactions.filter(t => !(t.tripLink && t.tripLink.tripId === tripId));
  if (state.money.transactions.length !== before) saveMoney();
}

function retroLinkAllTrips(){
  if (!state.profile.name) return;
  state.trips.forEach(trip => {
    (trip.expenses || []).forEach(exp => autoLinkTripExpense(trip, exp));
  });
}

window.autoLinkTripExpense = autoLinkTripExpense;
window.removeLinkedMoneyTx = removeLinkedMoneyTx;
window.removeAllLinkedFromTrip = removeAllLinkedFromTrip;

// ── INIT ──
function initMoneyManager(){
  loadProfile();
  loadMoney();
  initFirebaseWhenReady();
  updateGoogleAuthUI();
  initGoogleSignIn();
  document.querySelectorAll('.mm-period-btn').forEach(btn => {
    btn.addEventListener('click', () => setMMPeriod(btn.dataset.period));
  });
  showMoneyView();
  if (state.profile.firstRun || !state.profile.name) {
    openProfileSetup(true);
  }
}

initMoneyManager();
