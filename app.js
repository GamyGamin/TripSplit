// ── CONSTANTS ──
const EMOJIS = ['🏖️','🏔️','🌍','🗺️','🎒','⛺','🏝️','🚢','🛶','🎡','🌴','🏕️','🗼','🎭','🌋','🧳'];
const CAT_ICONS  = { food:'🍽️', hotel:'🏨', travel:'✈️', fun:'🎉', grocery:'🛒', other:'📦' };
const CAT_LABELS = { food:'Food & Drink', hotel:'Accommodation', travel:'Transport', fun:'Activities', grocery:'Groceries', other:'Other' };
const CAT_COLORS = { food:'#ff6b35', hotel:'#ffd166', travel:'#06d6a0', fun:'#a855f7', grocery:'#0ea5e9', other:'#a09fba' };
const AV_COLORS  = ['#ef476f','#06d6a0','#ffd166','#a855f7','#0ea5e9','#ff6b35','#14b8a6','#f97316'];

// ── STATE ──
let state = { trips:[], currentTripId:null, activeGroupType:'trip', splitMode:'equal', editExpenseId:null, editTransferId:null, manualAmount:false, partialSettle:null };
let newTripMembers = [], selectedEmoji = '🏖️';
let pendingRestoreTrips = null;
let tripCloud = { db:null, user:null, email:null, unsubscribe:null, applying:false, ready:false };

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function getCurrentUserEmail() {
  return normalizeEmail(state.profile?.googleUser?.email || tripCloud.email || '');
}

function getCurrentUserName() {
  return (state.profile?.name || state.profile?.googleUser?.name || '').trim();
}

function migrateTrips(trips) {
  trips.forEach(trip => {
    trip.type = trip.type || 'trip';
    trip.expenses = trip.expenses || [];
    trip.settlements = trip.settlements || [];
    trip.transfers = trip.transfers || [];
    trip.members = trip.members || [];
    trip.memberEmails = (trip.memberEmails || []).map(normalizeEmail).filter(Boolean);
    trip.memberProfiles = trip.memberProfiles || trip.members.map((name, i) => ({
      name,
      email: normalizeEmail(trip.memberEmails[i] || ''),
    }));
    trip.expenses.forEach(exp => {
      if (exp.paidBy && !exp.payers) { exp.payers = { [exp.paidBy]: exp.amount }; delete exp.paidBy; }
    });
  });
  return trips;
}

function groupLabels(type = state.activeGroupType || 'trip') {
  return type === 'home'
    ? { type:'home', singular:'Shared Home', plural:'Shared Homes', emptyIcon:'🏠', defaultEmoji:'🏠', namePlaceholder:'e.g. Campus Boarding', newButton:'＋ New Home', created:'Shared home' }
    : { type:'trip', singular:'Trip', plural:'Trips', emptyIcon:'🗺️', defaultEmoji:'🏖️', namePlaceholder:'e.g. Bali Summer 2025', newButton:'＋ New Trip', created:'Trip' };
}

function groupsForActiveType() {
  return state.trips.filter(trip => (trip.type || 'trip') === (state.activeGroupType || 'trip'));
}

function loadState() {
  try { state.trips = JSON.parse(localStorage.getItem('tripsplit_v2') || '[]'); } catch {}
  migrateTrips(state.trips);
}
function saveState(options = {}) {
  localStorage.setItem('tripsplit_v2', JSON.stringify(state.trips));
  if (options.sync !== false) syncTripsToCloud();
}

function tripCanSync(trip) {
  return !!(tripCloud.ready && tripCloud.email && trip.memberEmails && trip.memberEmails.includes(tripCloud.email));
}

function tripForCloud(trip) {
  return {
    ...JSON.parse(JSON.stringify(trip)),
    memberEmails: Array.from(new Set((trip.memberEmails || []).map(normalizeEmail).filter(Boolean))),
    updatedAt: Date.now(),
    updatedBy: tripCloud.email || '',
  };
}

function mergeCloudTrips(cloudTrips) {
  const cloudIds = new Set(cloudTrips.map(t => t.id));
  const localOnly = state.trips.filter(t => !cloudIds.has(t.id));
  state.trips = [...cloudTrips, ...localOnly].sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  migrateTrips(state.trips);
  saveState({ sync:false });
}

async function syncTripsToCloud() {
  if (!tripCloud.ready || tripCloud.applying) return;
  const trips = state.trips.filter(tripCanSync).map(tripForCloud);
  await Promise.all(trips.map(trip =>
    tripCloud.db.collection('trips').doc(trip.id).set(trip, { merge:true }).catch(err => {
      console.warn('Trip cloud sync failed:', err);
    })
  ));
}

async function startTripCloudSync(firebaseUser) {
  if (!firebaseUser || !firebaseUser.email || !window.firebase?.firestore) return;
  if (tripCloud.unsubscribe) tripCloud.unsubscribe();

  tripCloud.db = firebase.firestore();
  tripCloud.user = firebaseUser;
  tripCloud.email = normalizeEmail(firebaseUser.email);
  tripCloud.ready = true;

  try {
    await tripCloud.db.collection('users').doc(firebaseUser.uid).set({
      uid: firebaseUser.uid,
      email: tripCloud.email,
      name: getCurrentUserName() || firebaseUser.displayName || '',
      photoURL: firebaseUser.photoURL || '',
      lastSeenAt: Date.now(),
    }, { merge:true });
  } catch (err) {
    console.warn('Cloud profile write failed:', err);
    toast('Cloud profile write blocked. Check Firestore rules.','error');
  }

  tripCloud.unsubscribe = tripCloud.db.collection('trips')
    .where('memberEmails', 'array-contains', tripCloud.email)
    .onSnapshot(snapshot => {
      tripCloud.applying = true;
      const cloudTrips = snapshot.docs.map(doc => {
        const data = doc.data();
        return { ...data, id: data.id || doc.id, cloudSynced:true };
      });
      mergeCloudTrips(cloudTrips);
      tripCloud.applying = false;
      if (document.getElementById('tripsView')?.classList.contains('active')) renderTripsGrid();
      if (state.currentTripId && document.getElementById('tripDetailView')?.classList.contains('active')) {
        renderTripDetail();
        renderExpenses();
      }
    }, err => {
      tripCloud.applying = false;
      console.warn('Trip cloud listener failed:', err);
      toast('Cloud trip sync needs Firestore access/rules','error');
    });

  syncTripsToCloud();
}

function stopTripCloudSync() {
  if (tripCloud.unsubscribe) tripCloud.unsubscribe();
  tripCloud = { db:null, user:null, email:null, unsubscribe:null, applying:false, ready:false };
}

window.startTripCloudSync = startTripCloudSync;
window.stopTripCloudSync = stopTripCloudSync;

// ── UTILS ──
function uuid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function fmt(amount, currency) {
  const trip = state.trips.find(t => t.id === state.currentTripId);
  const cur = currency || (trip ? trip.currency : 'USD');
  try { return new Intl.NumberFormat('en-US', { style:'currency', currency:cur, minimumFractionDigits:2 }).format(amount); }
  catch { return `${cur} ${parseFloat(amount).toFixed(2)}`; }
}
function fmtFor(amount, currency) {
  try { return new Intl.NumberFormat('en-US', { style:'currency', currency, minimumFractionDigits:2 }).format(amount); }
  catch { return `${currency} ${parseFloat(amount).toFixed(2)}`; }
}
function avColor(name) { let h=0; for (let c of name) h=(h*31+c.charCodeAt(0))%AV_COLORS.length; return AV_COLORS[h]; }
function avatar(name, size=36) {
  const col = avColor(name);
  return `<div class="avatar" style="background:${col}22;color:${col};width:${size}px;height:${size}px;font-size:${Math.floor(size*.38)}px;">${name[0].toUpperCase()}</div>`;
}
function getMemberEmail(trip, memberName) {
  return normalizeEmail((trip.memberProfiles || []).find(m => m.name === memberName)?.email || '');
}
function getMyTripMemberName(trip) {
  const email = getCurrentUserEmail();
  if (email) {
    const match = (trip.memberProfiles || []).find(m => normalizeEmail(m.email) === email);
    if (match) return match.name;
  }
  const profileName = getCurrentUserName().toLowerCase();
  return trip.members.find(m => m.toLowerCase() === profileName) || trip.members[0];
}
function miniAvatar(name, size=16) {
  const col = avColor(name);
  return `<span class="mini-av" style="background:${col}22;color:${col};width:${size}px;height:${size}px;">${name[0].toUpperCase()}</span>`;
}
function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:'✅',error:'❌',info:'ℹ️'}[type]}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── PAYER HELPERS ──
function readPayerAmounts() {
  const trip = getTrip(); if (!trip) return {};
  const res = {};
  trip.members.forEach((m,i) => {
    const v = parseFloat(document.getElementById(`payer_${i}`)?.value) || 0;
    if (v > 0) res[m] = v;
  });
  return res;
}
function payerSum() {
  const trip = getTrip(); if (!trip) return 0;
  let s=0;
  trip.members.forEach((_,i) => { s += parseFloat(document.getElementById(`payer_${i}`)?.value) || 0; });
  return s;
}

function updatePayerUI() {
  const trip = getTrip(); if (!trip) return;
  const sum = payerSum();
  const manualAmt = parseFloat(document.getElementById('expenseAmount').value) || 0;

  if (sum > 0 && !state.manualAmount) {
    document.getElementById('expenseAmount').value = sum.toFixed(2);
  }

  const refAmt = state.manualAmount ? manualAmt : sum;
  const pill = document.getElementById('payerTotalPill');
  const hint = document.getElementById('payerHint');

  trip.members.forEach((m,i) => {
    const inp = document.getElementById(`payer_${i}`);
    if (inp) inp.classList.toggle('has-value', (parseFloat(inp.value)||0) > 0);
  });

  if (sum === 0) {
    pill.className = 'payer-total-pill zero';
    pill.textContent = '— —';
    hint.textContent = 'Enter who paid and how much. Total expense will auto-fill.';
  } else {
    const diff = refAmt > 0 ? Math.abs(refAmt - sum) : 0;
    const ok   = refAmt > 0 && diff < 0.05;
    pill.className = `payer-total-pill ${ok ? 'ok' : 'bad'}`;
    pill.textContent = ok ? `✅ ${fmt(sum)} matched` : `Paid: ${fmt(sum)}`;
    const payers = Object.entries(readPayerAmounts()).map(([m,v]) => `${m} (${fmt(v)})`).join(', ');
    hint.textContent = ok
      ? `✔ Payers: ${payers}`
      : refAmt > 0
        ? `Payers total ${fmt(sum)} but expense is ${fmt(refAmt)} — difference: ${fmt(Math.abs(refAmt-sum))}`
        : `Payers total: ${fmt(sum)}`;
  }
  updateSplitInfo();
}

function onManualAmountType() {
  state.manualAmount = true;
  updatePayerUI();
  updateSplitInfo();
}

// ── TRIPS VIEW ──
function showTripsView() {
  state.activeGroupType = state.activeGroupType || 'trip';
  const labels = groupLabels();
  document.getElementById('tripsView').classList.add('active');
  document.getElementById('tripDetailView').classList.remove('active');
  document.getElementById('headerActions').innerHTML = `
    <button class="btn btn-ghost" onclick="downloadBackup()" title="Download backup file">⬇ Backup</button>
    <button class="btn btn-ghost" onclick="triggerRestoreUpload()" title="Restore from backup file">⬆ Restore</button>
    <button class="btn btn-primary" onclick="openNewTripModal()">${labels.newButton}</button>`;
  state.currentTripId = null;
  renderTripsGrid();
}

function renderTripsGrid() {
  const grid = document.getElementById('tripsGrid');
  const labels = groupLabels();
  const groups = groupsForActiveType();
  const title = document.getElementById('groupListTitle');
  if (title) title.innerHTML = `Your <span>${labels.plural}</span>`;
  if (!groups.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">${labels.emptyIcon}</div><h3>No ${labels.plural.toLowerCase()} yet</h3><p>Create your first ${labels.singular.toLowerCase()} to start splitting expenses</p></div>`;
    return;
  }
  grid.innerHTML = groups.map(trip => {
    const total = trip.expenses.reduce((s,e)=>s+e.amount,0);
    const { netBalances } = computeBalances(trip);
    const my = getMyTripMemberName(trip), myBal = netBalances[my]||0;
    const cls = myBal>0.01?'owed':myBal<-0.01?'owe':'settled';
    const txt = myBal>0.01?`+${fmt(myBal,trip.currency)} owed to you`:myBal<-0.01?`${fmt(myBal,trip.currency)} you owe`:'All settled';
    return `
    <div class="trip-card" onclick="openTrip('${trip.id}')">
      <span class="trip-emoji">${trip.emoji}</span>
      <div class="trip-name">${trip.name}</div>
      <div class="trip-meta">
        <span>👥 ${trip.members.length}</span>
        <span>💸 ${trip.expenses.length} expenses</span>
        ${(trip.transfers||[]).length ? `<span>⇄ ${(trip.transfers||[]).length} transfers</span>` : ''}
        ${trip.startDate?`<span>📅 ${new Date(trip.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>`:''}
      </div>
      <div class="trip-balance">
        <span class="balance-tag ${cls}">${txt}</span>
        <span class="trip-total">${fmt(total,trip.currency)} total</span>
      </div>
    </div>`;
  }).join('');
}

// ── NEW TRIP ──
function openNewTripModal() {
  const labels = groupLabels();
  newTripMembers=[]; selectedEmoji=labels.defaultEmoji;
  ['tripName','memberInput','memberEmailInput'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('newTripModalTitle').textContent = `Create New ${labels.singular}`;
  document.getElementById('tripNameLabel').textContent = `${labels.singular} Name`;
  document.getElementById('tripName').placeholder = labels.namePlaceholder;
  document.getElementById('createTripButton').textContent = `Create ${labels.singular}`;
  document.getElementById('memberTags').innerHTML='';
  ['tripStartDate','tripEndDate'].forEach(id=>document.getElementById(id).value='');
  const myEmail = getCurrentUserEmail();
  const myName = getCurrentUserName();
  if (myName || myEmail) {
    newTripMembers.push({ name:myName || myEmail.split('@')[0], email:myEmail });
    renderNewMemberTags();
  }
  renderEmojiPicker();
  openModal('newTripModal');
}
function renderEmojiPicker() {
  document.getElementById('emojiPicker').innerHTML = EMOJIS.map(e=>
    `<span class="emoji-option ${e===selectedEmoji?'selected':''}" onclick="selectEmoji('${e}')">${e}</span>`).join('');
}
function selectEmoji(e) { selectedEmoji=e; renderEmojiPicker(); }
function handleMemberInput(e) { if(e.key==='Enter'){e.preventDefault();addMemberFromInput();} }
function addMemberFromInput() {
  const name=document.getElementById('memberInput').value.trim();
  const email=normalizeEmail(document.getElementById('memberEmailInput').value);
  if(!name && !email)return;
  if(email && !isValidEmail(email)){toast('Enter a valid email','error');return;}
  const displayName = name || email.split('@')[0];
  if(newTripMembers.some(m => m.name.toLowerCase() === displayName.toLowerCase() || (email && m.email === email))){toast('Already added','error');return;}
  newTripMembers.push({ name:displayName, email });
  document.getElementById('memberInput').value='';
  document.getElementById('memberEmailInput').value='';
  renderNewMemberTags();
}
function removeNewMember(index){newTripMembers.splice(index,1);renderNewMemberTags();}
function renderNewMemberTags(){
  document.getElementById('memberTags').innerHTML=newTripMembers.map((m,i)=>`
    <div class="member-tag">${avatar(m.name,22)} <span>${m.name}${m.email ? ` <small>${m.email}</small>` : ''}</span>
      <span class="remove-member" onclick="removeNewMember(${i})">✕</span>
    </div>`).join('');
}
function createTrip(){
  const labels = groupLabels();
  const name=document.getElementById('tripName').value.trim();
  if(!name){toast(`Enter a ${labels.singular.toLowerCase()} name`,'error');return;}
  if(!newTripMembers.length){toast('Add at least one member','error');return;}
  const memberNames = newTripMembers.map(m => m.name);
  const memberEmails = Array.from(new Set(newTripMembers.map(m => normalizeEmail(m.email)).filter(Boolean)));
  const memberProfiles = newTripMembers.map(m => ({ name:m.name, email:normalizeEmail(m.email) }));
  const trip={id:uuid(),type:labels.type,name,emoji:selectedEmoji,
    startDate:document.getElementById('tripStartDate').value,
    endDate:document.getElementById('tripEndDate').value,
    currency:document.getElementById('tripCurrency').value,
    members:memberNames,memberEmails,memberProfiles,createdByEmail:getCurrentUserEmail(),updatedAt:Date.now(),expenses:[],settlements:[],transfers:[]};
  state.trips.unshift(trip);
  saveState();closeModal('newTripModal');
  toast(`${labels.created} "${name}" created! 🎉`,'success');renderTripsGrid();
}

// ── TRIP DETAIL ──
function openTrip(id){
  state.currentTripId=id;
  const trip = getTrip();
  if (trip) state.activeGroupType = trip.type || 'trip';
  const labels = groupLabels();
  document.getElementById('tripsView').classList.remove('active');
  document.getElementById('tripDetailView').classList.add('active');
  document.getElementById('headerActions').innerHTML=`
    <button class="btn btn-ghost" onclick="downloadTripPDF()" title="Download PDF report">📄 PDF</button>
    <button class="btn btn-ghost" onclick="openAddMemberModal()">👥 Add Member</button>
    <button class="btn btn-ghost" onclick="openTransferModal()">⇄ Transfer</button>
    <button class="btn btn-primary" onclick="openAddExpenseModal()">＋ Expense</button>`;
  const back = document.getElementById('tripBackButton');
  if (back) back.textContent = `← Back to ${labels.plural}`;
  renderTripDetail();switchTab('expenses');
}
function getTrip(){return state.trips.find(t=>t.id===state.currentTripId);}

function renderTripDetail(){
  const trip=getTrip();if(!trip)return;
  const total=trip.expenses.reduce((s,e)=>s+e.amount,0);
  const {netBalances}=computeBalances(trip);
  const maxOwed=Math.max(...Object.values(netBalances).filter(v=>v>0),0);
  const maxOwes=Math.abs(Math.min(...Object.values(netBalances).filter(v=>v<0),0));
  document.getElementById('tripHeaderCard').innerHTML=`
    <div class="trip-header-left">
      <div class="trip-header-emoji">${trip.emoji}</div>
      <div class="trip-header-info">
        <h1>${trip.name}</h1>
        <p>${trip.members.length} members · ${trip.currency} · ${trip.expenses.length} expenses${(trip.transfers||[]).length ? ` · ${(trip.transfers||[]).length} transfers` : ''}${trip.startDate?` · ${new Date(trip.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${trip.endDate?new Date(trip.endDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'TBD'}`:''}</p>
      </div>
    </div>
    <div class="trip-stats">
      <div class="stat"><div class="stat-value">${fmt(total)}</div><div class="stat-label">Total Spent</div></div>
      <div class="stat"><div class="stat-value positive">+${fmt(maxOwed)}</div><div class="stat-label">Max Owed Back</div></div>
      <div class="stat"><div class="stat-value negative">-${fmt(maxOwes)}</div><div class="stat-label">Max Owes</div></div>
    </div>`;
}

// ── TABS ──
function switchTab(tab){
  const tabs=['expenses','balances','summary','members'];
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',tabs[i]===tab));
  tabs.forEach(t=>{
    document.getElementById(`tab${t[0].toUpperCase()+t.slice(1)}`).style.display=t===tab?'block':'none';
  });
  if(tab==='expenses')renderExpenses();
  if(tab==='balances')renderBalancesTab();
  if(tab==='summary') renderSummaryTab();
  if(tab==='members') renderMembersTab();
}

// ── EXPENSES ──
function renderExpenses(){
  const trip=getTrip();if(!trip)return;
  const list=document.getElementById('expensesList');
  const activities = [
    ...trip.expenses.map(exp => ({ kind:'expense', date:exp.date, item:exp })),
    ...(trip.transfers || []).map(transfer => ({ kind:'transfer', date:transfer.date, item:transfer }))
  ].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  if(!activities.length){
    list.innerHTML=`<div class="empty-state"><div class="empty-icon">💸</div><h3>No activity yet</h3><p>Add an expense or initiate a transfer to get started</p></div>`;
  } else {
    list.innerHTML=activities.map(activity=>{
      if (activity.kind === 'transfer') {
        const transfer = activity.item;
        return `
      <div class="expense-item transfer-item">
        <div class="expense-cat transfer-cat">⇄</div>
        <div class="expense-info">
          <div class="expense-name">Transfer</div>
          <div class="expense-sub">${transfer.date?new Date(transfer.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):''} · ${transfer.from} sent money to ${transfer.to}</div>
          ${transfer.note ? `<div class="transfer-note">${transfer.note}</div>` : ''}
        </div>
        <div class="expense-right">
          <div class="expense-amount">${fmt(transfer.amount)}</div>
          <div class="expense-payer">balance transfer</div>
        </div>
        <div class="expense-actions">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="editTransfer('${transfer.id}')" title="Edit">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteTransfer('${transfer.id}')" title="Delete">🗑️</button>
        </div>
      </div>`;
      }
      const exp = activity.item;
      const color=CAT_COLORS[exp.category]||'#a09fba';
      const payers=exp.payers||{};
      const payerCount=Object.keys(payers).length;
      const pills=Object.entries(payers).map(([m,amt])=>
        `<span class="payer-pill">${miniAvatar(m)} <b>${m}</b>&nbsp;${fmt(amt)}</span>`).join('');
      const payerLabel = payerCount===1
        ? `paid by ${Object.keys(payers)[0]}`
        : `${payerCount} people paid`;
      return `
      <div class="expense-item">
        <div class="expense-cat cat-${exp.category}" style="color:${color}">${CAT_ICONS[exp.category]||'📦'}</div>
        <div class="expense-info">
          <div class="expense-name">${exp.name}</div>
          <div class="expense-sub">${exp.date?new Date(exp.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):''} · ${exp.splitType} split · ${payerLabel}</div>
          ${payerCount>1?`<div class="payer-pills">${pills}</div>`:''}
        </div>
        <div class="expense-right">
          <div class="expense-amount">${fmt(exp.amount)}</div>
          <div class="expense-payer">÷ ${Object.keys(exp.splits).length} people</div>
        </div>
        <div class="expense-actions">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="editExpense('${exp.id}')" title="Edit">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteExpense('${exp.id}')" title="Delete">🗑️</button>
        </div>
      </div>`;
    }).join('');
  }
  renderQuickBalances();
}

function renderQuickBalances(){
  const trip=getTrip();if(!trip)return;
  const {netBalances}=computeBalances(trip);
  document.getElementById('quickBalanceSidebar').innerHTML=`<h3>Quick Balances</h3>`+
    trip.members.map(m=>{
      const bal=netBalances[m]||0;
      const cls=bal>0.01?'pos':bal<-0.01?'neg':'zero';
      const txt=bal>0.01?`+${fmt(bal)}`:bal<-0.01?fmt(bal):'settled';
      return `<div class="member-item">${avatar(m)}<span class="member-name">${m}</span><span class="member-balance ${cls}">${txt}</span></div>`;
    }).join('');
}

// ── ADD / EDIT EXPENSE MODAL ──
function openAddExpenseModal(){
  const trip=getTrip();if(!trip)return;
  state.editExpenseId=null; state.splitMode='equal'; state.manualAmount=false;
  document.getElementById('expenseModalTitle').textContent='Add Expense';
  document.getElementById('expenseName').value='';
  document.getElementById('expenseAmount').value='';
  document.getElementById('expenseDate').value=new Date().toISOString().split('T')[0];
  document.getElementById('expenseCategory').value='food';
  document.getElementById('tripCurrencyLabel').textContent=trip.currency;
  document.querySelectorAll('.split-tab').forEach((t,i)=>t.classList.toggle('active',i===0));
  renderPayerRows({});
  renderSplitMembers({});
  openModal('addExpenseModal');
}

function editExpense(id){
  const trip=getTrip();if(!trip)return;
  const exp=trip.expenses.find(e=>e.id===id);if(!exp)return;
  state.editExpenseId=id; state.splitMode=exp.splitType; state.manualAmount=true;
  document.getElementById('expenseModalTitle').textContent='Edit Expense';
  document.getElementById('expenseName').value=exp.name;
  document.getElementById('expenseAmount').value=exp.amount;
  document.getElementById('expenseDate').value=exp.date;
  document.getElementById('expenseCategory').value=exp.category;
  document.getElementById('tripCurrencyLabel').textContent=trip.currency;
  document.querySelectorAll('.split-tab').forEach((t,i)=>t.classList.toggle('active',['equal','exact','percent'][i]===state.splitMode));
  renderPayerRows(exp.payers||{});
  renderSplitMembers(exp.splits||{});
  openModal('addExpenseModal');
}

function deleteExpense(id){
  const trip=getTrip();if(!trip)return;
  trip.expenses=trip.expenses.filter(e=>e.id!==id);
  saveState();renderExpenses();renderTripDetail();renderTripsGrid();
  if (window.removeLinkedMoneyTx) window.removeLinkedMoneyTx(id);
  toast('Expense deleted','info');
}

// ── RENDER PAYER ROWS ──
function openTransferModal(){
  const trip=getTrip();if(!trip)return;
  state.editTransferId = null;
  document.getElementById('transferModalTitle').textContent = 'Initiate Transfer';
  populateTransferMembers();
  document.getElementById('transferAmount').value = '';
  document.getElementById('transferDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('transferNote').value = '';
  openModal('transferModal');
}

function populateTransferMembers(transfer = {}){
  const trip=getTrip();if(!trip)return;
  const options = trip.members.map(m => `<option value="${m}">${m}</option>`).join('');
  document.getElementById('transferFrom').innerHTML = options;
  document.getElementById('transferTo').innerHTML = options;
  document.getElementById('transferFrom').value = transfer.from || trip.members[0] || '';
  document.getElementById('transferTo').value = transfer.to || trip.members[1] || trip.members[0] || '';
}

function editTransfer(id){
  const trip=getTrip();if(!trip)return;
  const transfer=(trip.transfers||[]).find(t=>t.id===id);if(!transfer)return;
  state.editTransferId = id;
  document.getElementById('transferModalTitle').textContent = 'Edit Transfer';
  populateTransferMembers(transfer);
  document.getElementById('transferAmount').value = transfer.amount;
  document.getElementById('transferDate').value = transfer.date || new Date().toISOString().split('T')[0];
  document.getElementById('transferNote').value = transfer.note || '';
  openModal('transferModal');
}

function saveTransfer(){
  const trip=getTrip();if(!trip)return;
  const from=document.getElementById('transferFrom').value;
  const to=document.getElementById('transferTo').value;
  const amount=parseFloat(document.getElementById('transferAmount').value);
  const date=document.getElementById('transferDate').value;
  const note=document.getElementById('transferNote').value.trim();
  if(!from||!to){toast('Select both members','error');return;}
  if(from===to){toast('Choose two different members','error');return;}
  if(!amount||amount<=0){toast('Enter a valid transfer amount','error');return;}
  const transfer={id:state.editTransferId||uuid(),from,to,amount:parseFloat(amount.toFixed(2)),date,note};
  trip.transfers = trip.transfers || [];
  if(state.editTransferId){
    const idx=trip.transfers.findIndex(t=>t.id===state.editTransferId);
    if(idx>=0)trip.transfers[idx]=transfer;
    toast('Transfer updated','success');
  } else {
    trip.transfers.push(transfer);
    toast(`${from} → ${to}: ${fmt(amount)} transferred`,'success');
  }
  trip.updatedAt = Date.now();
  state.editTransferId = null;
  saveState();closeModal('transferModal');
  renderExpenses();renderTripDetail();renderTripsGrid();renderQuickBalances();
}

function deleteTransfer(id){
  const trip=getTrip();if(!trip)return;
  trip.transfers=(trip.transfers||[]).filter(t=>t.id!==id);
  trip.updatedAt = Date.now();
  saveState();renderExpenses();renderTripDetail();renderTripsGrid();renderQuickBalances();
  toast('Transfer deleted','info');
}

function renderPayerRows(existing){
  const trip=getTrip();if(!trip)return;
  document.getElementById('payerRows').innerHTML=trip.members.map((m,i)=>`
    <div class="payer-row">
      ${avatar(m,30)}
      <span class="payer-row-name">${m}</span>
      <input
        type="number" class="payer-amount-input ${(existing[m]||0)>0?'has-value':''}"
        id="payer_${i}" placeholder="0.00" value="${existing[m]||''}"
        min="0" step="0.01"
        oninput="state.manualAmount=false; updatePayerUI();"
      >
    </div>`).join('');
  updatePayerUI();
}

// ── SPLIT MODE ──
function setSplitMode(mode){
  state.splitMode=mode;
  document.querySelectorAll('.split-tab').forEach((t,i)=>t.classList.toggle('active',['equal','exact','percent'][i]===mode));
  renderSplitMembers({});
}

function renderSplitMembers(existing){
  const trip=getTrip();if(!trip)return;
  const n=trip.members.length;
  const container=document.getElementById('splitMembersContainer');
  if(state.splitMode==='equal'){
    container.innerHTML=trip.members.map((m,i)=>`
      <div class="split-member-row">
        <input type="checkbox" class="split-checkbox" id="split_${i}" value="${m}" checked onchange="updateSplitInfo()">
        ${avatar(m,30)}<span class="member-name">${m}</span>
      </div>`).join('');
  } else if(state.splitMode==='exact'){
    container.innerHTML=trip.members.map((m,i)=>`
      <div class="split-member-row">
        ${avatar(m,30)}<span class="member-name">${m}</span>
        <input type="number" class="split-amount-input" id="split_${i}" placeholder="0.00"
          value="${existing[m]||''}" min="0" step="0.01" oninput="updateSplitInfo()">
      </div>`).join('');
  } else {
    const defPct=Object.keys(existing).length?null:(100/n).toFixed(1);
    container.innerHTML=trip.members.map((m,i)=>`
      <div class="split-member-row">
        ${avatar(m,30)}<span class="member-name">${m}</span>
        <input type="number" class="split-amount-input" id="split_${i}" placeholder="%"
          value="${existing[m]||defPct||''}" min="0" max="100" step="0.1" oninput="updateSplitInfo()">
        <span style="font-size:12px;color:var(--muted)">%</span>
      </div>`).join('');
  }
  updateSplitInfo();
}

function updateSplitInfo(){
  const trip=getTrip();if(!trip)return;
  const amount=parseFloat(document.getElementById('expenseAmount').value)||0;
  const n=trip.members.length;
  const info=document.getElementById('splitInfo');
  if(state.splitMode==='equal'){
    const checked=trip.members.filter((_,i)=>document.getElementById(`split_${i}`)?.checked);
    info.style.color='var(--muted)';
    info.textContent=amount>0&&checked.length>0?`Each person owes ${fmt(amount/checked.length)} (${checked.length} of ${n} members)`:checked.length===0?'Select at least one person':'Enter total amount';
  } else if(state.splitMode==='exact'){
    let tot=0; trip.members.forEach((_,i)=>{tot+=parseFloat(document.getElementById(`split_${i}`)?.value||0);});
    const diff=amount-tot;
    info.textContent=amount>0?`Assigned ${fmt(tot)} of ${fmt(amount)} ${Math.abs(diff)<0.05?'✅':`— ${fmt(Math.abs(diff))} ${diff>0?'remaining':'over'}`}`:`Assigned: ${fmt(tot)}`;
    info.style.color=Math.abs(diff)<0.05?'var(--teal)':'var(--red)';
  } else {
    let pct=0; trip.members.forEach((_,i)=>{pct+=parseFloat(document.getElementById(`split_${i}`)?.value||0);});
    const diff=100-pct;
    info.textContent=`Total: ${pct.toFixed(1)}% ${Math.abs(diff)<0.1?'✅':`— ${Math.abs(diff).toFixed(1)}% ${diff>0?'remaining':'over'}`}`;
    info.style.color=Math.abs(diff)<0.1?'var(--teal)':'var(--red)';
  }
}

// ── SAVE EXPENSE ──
function saveExpense(){
  const trip=getTrip();if(!trip)return;
  const name  =document.getElementById('expenseName').value.trim();
  const amount=parseFloat(document.getElementById('expenseAmount').value);
  if(!name)  {toast('Enter a description','error');return;}
  if(!amount||amount<=0){toast('Enter a valid total amount','error');return;}

  const payers=readPayerAmounts();
  if(!Object.keys(payers).length){toast('At least one person must have paid something','error');return;}
  const pSum=Object.values(payers).reduce((a,b)=>a+b,0);
  if(Math.abs(pSum-amount)>0.05){
    toast(`Payer total (${fmt(pSum)}) ≠ expense total (${fmt(amount)}). Fix the amounts.`,'error');
    return;
  }

  const splits={};
  const n=trip.members.length;
  if(state.splitMode==='equal'){
    const checked=trip.members.filter((_,i)=>document.getElementById(`split_${i}`)?.checked);
    if(!checked.length){toast('Select at least one person to split among','error');return;}
    const share=parseFloat((amount/checked.length).toFixed(2));
    checked.forEach(m=>splits[m]=share);
  } else if(state.splitMode==='exact'){
    let tot=0;
    trip.members.forEach((m,i)=>{const v=parseFloat(document.getElementById(`split_${i}`)?.value||0);if(v>0)splits[m]=v;tot+=v;});
    if(Math.abs(tot-amount)>0.05){toast('Exact split amounts must sum to total','error');return;}
  } else {
    let pct=0;
    trip.members.forEach((m,i)=>{const p=parseFloat(document.getElementById(`split_${i}`)?.value||0);if(p>0)splits[m]=parseFloat((amount*p/100).toFixed(2));pct+=p;});
    if(Math.abs(pct-100)>0.5){toast('Percentages must sum to 100%','error');return;}
  }
  if(!Object.keys(splits).length){toast('No one to split among','error');return;}

  const expense={
    id:state.editExpenseId||uuid(), name, amount, payers,
    category:document.getElementById('expenseCategory').value,
    date:document.getElementById('expenseDate').value,
    splitType:state.splitMode, splits
  };

  if(state.editExpenseId){
    const idx=trip.expenses.findIndex(e=>e.id===state.editExpenseId);
    if(idx>=0)trip.expenses[idx]=expense;
    toast('Expense updated ✅','success');
  } else {
    trip.expenses.push(expense);
    toast('Expense added ✅','success');
  }
  saveState();closeModal('addExpenseModal');
  renderExpenses();renderTripDetail();renderTripsGrid();
  // Auto-link this expense to the user's personal Money Manager (no-op if not a payer)
  if (window.autoLinkTripExpense) window.autoLinkTripExpense(trip, expense);
}

// ── BALANCE COMPUTATION ──
function computeBalances(trip){
  const net={};
  trip.members.forEach(m=>net[m]=0);
  trip.expenses.forEach(exp=>{
    Object.entries(exp.payers||{}).forEach(([m,paid])=>{ net[m]=(net[m]||0)+paid; });
    Object.entries(exp.splits).forEach(([m,share])=>{ net[m]=(net[m]||0)-share; });
  });
  (trip.transfers||[]).forEach(t=>{
    net[t.from]=(net[t.from]||0)+t.amount;
    net[t.to]  =(net[t.to]  ||0)-t.amount;
  });
  trip.settlements.forEach(s=>{
    net[s.from]=(net[s.from]||0)+s.amount;
    net[s.to]  =(net[s.to]  ||0)-s.amount;
  });
  return {netBalances:net, debts:simplifyDebts(net)};
}

function simplifyDebts(net){
  const creditors=[],debtors=[];
  Object.entries(net).forEach(([m,v])=>{
    if(v> 0.01)creditors.push({name:m,amount: v});
    if(v<-0.01)debtors.push ({name:m,amount:-v});
  });
  const debts=[];
  let ci=0,di=0;
  while(ci<creditors.length&&di<debtors.length){
    const c=creditors[ci],d=debtors[di];
    const pay=Math.min(c.amount,d.amount);
    debts.push({from:d.name,to:c.name,amount:parseFloat(pay.toFixed(2))});
    c.amount-=pay; d.amount-=pay;
    if(c.amount<0.01)ci++;
    if(d.amount<0.01)di++;
  }
  return debts;
}

// ── BALANCES TAB ──
function renderBalancesTab(){
  const trip=getTrip();if(!trip)return;
  const {debts,netBalances}=computeBalances(trip);
  const el=document.getElementById('balancesContent');
  const memberBals=trip.members.map(m=>{
    const bal=netBalances[m]||0;
    const cls=bal>0.01?'pos':bal<-0.01?'neg':'zero';
    const txt=bal>0.01?`gets back ${fmt(bal)}`:bal<-0.01?`owes ${fmt(-bal)}`:'✅ settled';
    return `<div class="member-item">${avatar(m,34)}<span class="member-name">${m}</span><span class="member-balance ${cls}">${txt}</span></div>`;
  }).join('');

  el.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
      <div class="sidebar-card" style="margin-bottom:0"><h3>Net Balances</h3>${memberBals}</div>
      <div class="sidebar-card" style="margin-bottom:0">
        <h3>Settlements Needed</h3>
        ${debts.length===0
          ?`<div class="all-settled"><div class="settled-icon">🎉</div><p>All settled up!</p></div>`
          :debts.map((d,i)=>`
            <div class="balance-item">
              ${avatar(d.from,32)}
              <span style="font-size:14px;font-weight:500;">${d.from}</span>
              <span style="color:var(--muted);font-size:18px;">→</span>
              ${avatar(d.to,32)}
              <span style="font-size:14px;font-weight:500;">${d.to}</span>
              <span class="balance-amount-tag">${fmt(d.amount)}</span>
              <div class="settle-actions">
                <button class="partial-btn" onclick="openPartialSettleModal(${i})">Partially Settle</button>
                <button class="settle-btn" onclick="settleDebtFromSuggestion(${i})">Mark Settled</button>
              </div>
            </div>`).join('')
        }
        ${renderSettledTransactions(trip)}
      </div>
    </div>`;
}

function settleDebt(from,to,amount){
  const trip=getTrip();if(!trip)return;
  trip.settlements.push({id:uuid(),from,to,amount,date:new Date().toISOString().split('T')[0]});
  saveState();renderBalancesTab();renderTripDetail();renderTripsGrid();renderQuickBalances();
  toast(`${from} → ${to}: ${fmt(amount)} settled`,'success');
}

// ── SETTLEMENT ACTIONS ──
function settleDebtFromSuggestion(index){
  const trip=getTrip();if(!trip)return;
  const {debts}=computeBalances(trip);
  const debt=debts[index];if(!debt)return;
  settleDebt(debt.from,debt.to,debt.amount);
}

function openPartialSettleModal(index){
  const trip=getTrip();if(!trip)return;
  const {debts}=computeBalances(trip);
  const debt=debts[index];if(!debt)return;
  state.partialSettle={from:debt.from,to:debt.to,max:debt.amount};
  document.getElementById('partialSummary').innerHTML=`
    ${avatar(debt.from,32)}
    <span style="font-size:14px;font-weight:500;">${debt.from}</span>
    <span class="arrow">→</span>
    ${avatar(debt.to,32)}
    <span style="font-size:14px;font-weight:500;">${debt.to}</span>
    <span class="max-tag">Owes <b>${fmt(debt.amount)}</b></span>`;
  const inp=document.getElementById('partialAmount');
  inp.value='';
  inp.max=debt.amount;
  document.getElementById('partialHint').textContent=`Enter an amount less than ${fmt(debt.amount)}. Remaining will stay owed.`;
  document.getElementById('partialHint').style.color='var(--muted)';
  openModal('partialSettleModal');
  setTimeout(()=>inp.focus(),50);
}

function onPartialAmountInput(){
  if(!state.partialSettle)return;
  const max=state.partialSettle.max;
  const val=parseFloat(document.getElementById('partialAmount').value);
  const hint=document.getElementById('partialHint');
  if(isNaN(val)||val<=0){
    hint.textContent=`Enter an amount less than ${fmt(max)}.`;
    hint.style.color='var(--muted)';
  } else if(val>=max){
    hint.textContent=`Must be less than ${fmt(max)} — use "Mark Settled" for the full amount.`;
    hint.style.color='var(--red)';
  } else {
    hint.textContent=`After settlement, ${fmt(max-val)} will still be owed.`;
    hint.style.color='var(--teal)';
  }
}

function confirmPartialSettle(){
  if(!state.partialSettle){toast('No debt selected','error');return;}
  const {from,to,max}=state.partialSettle;
  const val=parseFloat(document.getElementById('partialAmount').value);
  if(isNaN(val)||val<=0){toast('Enter a valid amount','error');return;}
  if(val>=max){toast(`Amount must be less than ${fmt(max)}`,'error');return;}
  closeModal('partialSettleModal');
  state.partialSettle=null;
  settleDebt(from,to,parseFloat(val.toFixed(2)));
}

function renderSettledTransactions(trip){
  const settlements=(trip.settlements||[]).map((settlement,index)=>({settlement,index})).reverse();
  return `
    <div class="settled-history">
      <h3>Settled Transactions</h3>
      ${settlements.length===0
        ?`<p class="settled-empty">No settled transactions yet.</p>`
        :settlements.map(({settlement,index})=>`
          <div class="balance-item">
            ${avatar(settlement.from,32)}
            <span style="font-size:14px;font-weight:500;">${settlement.from}</span>
            <span style="color:var(--muted);font-size:13px;">paid</span>
            ${avatar(settlement.to,32)}
            <span style="font-size:14px;font-weight:500;">${settlement.to}</span>
            <span class="settlement-date">${formatSettlementDate(settlement.date)}</span>
            <span class="balance-amount-tag">${fmt(settlement.amount)}</span>
            <button class="unsettle-btn" onclick="unsettleSettlement(${index})">Unsettle</button>
          </div>`).join('')
      }
    </div>`;
}

function formatSettlementDate(date){
  if(!date)return 'No date';
  const dt=new Date(date+'T00:00:00');
  if(Number.isNaN(dt.getTime()))return date;
  return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

function unsettleSettlement(index){
  const trip=getTrip();if(!trip||!trip.settlements||!trip.settlements[index])return;
  const [settlement]=trip.settlements.splice(index,1);
  saveState();renderBalancesTab();renderTripDetail();renderTripsGrid();renderQuickBalances();
  toast(`${settlement.from} → ${settlement.to}: ${fmt(settlement.amount)} unsettled`,'info');
}

// ── SUMMARY TAB ──
function renderSummaryTab(){
  const trip=getTrip();if(!trip)return;
  const total=trip.expenses.reduce((s,e)=>s+e.amount,0);
  const catTotals={},memberPaid={};
  trip.members.forEach(m=>memberPaid[m]=0);
  trip.expenses.forEach(e=>{
    catTotals[e.category]=(catTotals[e.category]||0)+e.amount;
    Object.entries(e.payers||{}).forEach(([m,v])=>{memberPaid[m]=(memberPaid[m]||0)+v;});
  });
  const catBars=Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>{
    const pct=total>0?(amt/total*100).toFixed(1):0;
    return `<div class="category-bar">
      <div class="category-bar-label"><span>${CAT_ICONS[cat]} ${cat[0].toUpperCase()+cat.slice(1)}</span><span>${fmt(amt)} (${pct}%)</span></div>
      <div class="category-bar-track"><div class="category-bar-fill" style="width:${pct}%;background:${CAT_COLORS[cat]}"></div></div>
    </div>`;}).join('');
  const memberRows=Object.entries(memberPaid).sort((a,b)=>b[1]-a[1]).map(([m,amt])=>`
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
      ${avatar(m,34)}<span style="flex:1;font-size:14px;font-weight:500;">${m}</span>
      <span style="font-family:'Playfair Display',serif;font-size:16px;">${fmt(amt)}</span>
    </div>`).join('');
  document.getElementById('summaryContent').innerHTML=`
    <div class="summary-grid">
      <div class="summary-stat"><div class="summary-stat-value">${fmt(total)}</div><div class="summary-stat-label">Total Spent</div></div>
      <div class="summary-stat"><div class="summary-stat-value">${trip.members.length?fmt(total/trip.members.length):'—'}</div><div class="summary-stat-label">Avg / Person</div></div>
      <div class="summary-stat"><div class="summary-stat-value">${trip.expenses.length}</div><div class="summary-stat-label">Expenses</div></div>
      <div class="summary-stat"><div class="summary-stat-value">${(trip.transfers||[]).length}</div><div class="summary-stat-label">Transfers</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
      <div class="sidebar-card"><h3>By Category</h3>${catBars||'<p style="color:var(--muted);font-size:14px;">No expenses yet</p>'}</div>
      <div class="sidebar-card"><h3>Amount Paid by Member</h3>${memberRows||'<p style="color:var(--muted);font-size:14px;">No expenses yet</p>'}</div>
    </div>`;
}

// ── MEMBERS TAB ──
function renderMembersTab(){
  const trip=getTrip();if(!trip)return;
  const {netBalances}=computeBalances(trip);
  const memberPaid={};
  trip.members.forEach(m=>memberPaid[m]=0);
  trip.expenses.forEach(e=>{Object.entries(e.payers||{}).forEach(([m,v])=>{memberPaid[m]=(memberPaid[m]||0)+v;});});
  document.getElementById('membersContent').innerHTML=`
    <div class="section-header" style="margin-bottom:20px;">
      <h3 style="font-family:'Playfair Display',serif;font-size:22px;">Members (${trip.members.length})</h3>
      <button class="btn btn-primary btn-sm" onclick="openAddMemberModal()">＋ Add Member</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;">
    ${trip.members.map(m=>{
      const bal=netBalances[m]||0;
      const balText=bal>0.01?`Gets back ${fmt(bal)}`:bal<-0.01?`Owes ${fmt(-bal)}`:'✅ Settled';
      const email=getMemberEmail(trip,m);
      return `
      <div class="sidebar-card" style="margin-bottom:0">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
          ${avatar(m,42)}
          <div>
            <div style="font-weight:600;font-size:15px;">${m}</div>
            <div style="font-size:12px;color:var(--muted);">${email ? email + ' · ' : ''}Paid ${fmt(memberPaid[m]||0)}</div>
          </div>
        </div>
        <div style="font-size:13px;font-weight:600;color:var(--${bal>0.01?'teal':bal<-0.01?'red':'muted'})">${balText}</div>
      </div>`;
    }).join('')}
    </div>`;
}

// ── ADD MEMBER ──
function openAddMemberModal(){
  document.getElementById('newMemberName').value='';
  document.getElementById('newMemberEmail').value='';
  openModal('addMemberModal');
}
function addMemberToTrip(){
  const trip=getTrip();if(!trip)return;
  const name=document.getElementById('newMemberName').value.trim();
  const email=normalizeEmail(document.getElementById('newMemberEmail').value);
  if(!name){toast('Enter a name','error');return;}
  if(email && !isValidEmail(email)){toast('Enter a valid email','error');return;}
  if(trip.members.includes(name)){toast('Already a member','error');return;}
  trip.memberEmails = trip.memberEmails || [];
  trip.memberProfiles = trip.memberProfiles || trip.members.map(memberName => ({ name:memberName, email:getMemberEmail(trip, memberName) }));
  if(email && trip.memberEmails.includes(email)){toast('That email is already on this trip','error');return;}
  trip.members.push(name);
  if(email) trip.memberEmails.push(email);
  trip.memberProfiles.push({ name, email });
  trip.updatedAt = Date.now();
  saveState();closeModal('addMemberModal');renderTripDetail();renderExpenses();
  toast(`${name} added to trip!`,'success');
}

// ─────────────────────────────────────────────────────────
// ── BACKUP / RESTORE ─────────────────────────────────────
// ─────────────────────────────────────────────────────────
function downloadBackup(){
  if(!state.trips.length){ toast('No trips to back up','error'); return; }
  const data = {
    app: 'TripSplit',
    version: 2,
    exportedAt: new Date().toISOString(),
    trips: state.trips
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const dateStr = new Date().toISOString().split('T')[0];
  a.href = url;
  a.download = `tripsplit-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`Backup downloaded (${state.trips.length} trip${state.trips.length===1?'':'s'})`,'success');
}

function triggerRestoreUpload(){
  document.getElementById('restoreFileInput').click();
}

function handleRestoreFile(e){
  const file = e.target.files[0];
  e.target.value = ''; // reset so re-selecting the same file fires change
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    let data;
    try {
      data = JSON.parse(ev.target.result);
    } catch {
      toast('Could not parse backup file (invalid JSON)','error'); return;
    }
    if(data && data.app !== 'TripSplit'){
      toast('Not a TripSplit backup file','error'); return;
    }
    const trips = data.trips;
    if(!Array.isArray(trips)){
      toast('Backup file has no trips','error'); return;
    }
    // Light shape validation
    const valid = trips.every(t => t && typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.members));
    if(!valid){
      toast('Backup file looks corrupted','error'); return;
    }
    pendingRestoreTrips = trips;
    const exportedDate = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date';
    const totalExpenses = trips.reduce((s,t)=>s+(t.expenses?.length||0),0);
    document.getElementById('restorePreview').innerHTML = `
      <div>Found <b>${trips.length}</b> trip${trips.length===1?'':'s'} with <b>${totalExpenses}</b> expense${totalExpenses===1?'':'s'}.</div>
      <div style="margin-top:6px;font-size:13px;color:var(--muted);">Exported: ${exportedDate}</div>
      <div class="restore-note">
        <b style="color:var(--text)">Merge</b> — Adds new trips and updates matching ones (same ID). Keeps your other local trips.<br>
        <b style="color:var(--text)">Replace All</b> — Removes existing trips and uses only the backup. <span style="color:var(--red)">Cannot be undone.</span>
      </div>`;
    openModal('restoreModal');
  };
  reader.onerror = () => toast('Could not read file','error');
  reader.readAsText(file);
}

function confirmRestore(mode){
  if(!pendingRestoreTrips){ toast('No file loaded','error'); return; }
  if(mode === 'replace'){
    state.trips = pendingRestoreTrips;
  } else {
    const byId = new Map(state.trips.map(t => [t.id, t]));
    pendingRestoreTrips.forEach(t => byId.set(t.id, t));
    state.trips = Array.from(byId.values());
  }
  migrateTrips(state.trips);
  saveState();
  pendingRestoreTrips = null;
  closeModal('restoreModal');
  renderTripsGrid();
  toast(`Restored — ${state.trips.length} trip${state.trips.length===1?'':'s'} in total`,'success');
}

// ─────────────────────────────────────────────────────────
// ── PDF EXPORT ───────────────────────────────────────────
// ─────────────────────────────────────────────────────────
function downloadTripPDF(){
  const trip = getTrip();
  if(!trip){ toast('No trip selected','error'); return; }
  if(!window.jspdf || !window.jspdf.jsPDF){
    toast('PDF library failed to load — check your internet connection','error'); return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'pt', format:'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let y = M;

  const cur = trip.currency;
  const money = (a) => fmtFor(a, cur);

  // ── HEADER ──
  doc.setFontSize(22);
  doc.setFont('helvetica','bold');
  doc.text(trip.name, M, y);
  y += 24;

  doc.setFontSize(10);
  doc.setFont('helvetica','normal');
  doc.setTextColor(120,120,120);
  const dateRange = trip.startDate
    ? `${new Date(trip.startDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}${trip.endDate ? ' – ' + new Date(trip.endDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : ''}`
    : 'No dates set';
  doc.text(`${trip.members.length} members  •  ${cur}  •  ${dateRange}`, M, y);
  y += 12;
  doc.text(`Generated ${new Date().toLocaleString()}`, M, y);
  y += 22;
  doc.setTextColor(0,0,0);

  // ── COMPUTE STATS ──
  const total = trip.expenses.reduce((s,e)=>s+e.amount, 0);
  const { netBalances, debts } = computeBalances(trip);
  const totalSettled = (trip.settlements||[]).reduce((s,x)=>s+x.amount, 0);
  const totalTransferred = (trip.transfers||[]).reduce((s,x)=>s+x.amount, 0);
  const totalOutstanding = debts.reduce((s,d)=>s+d.amount, 0);
  const memberPaid = {};
  trip.members.forEach(m => memberPaid[m] = 0);
  trip.expenses.forEach(e => {
    Object.entries(e.payers||{}).forEach(([m,v]) => { memberPaid[m] = (memberPaid[m]||0) + v; });
  });
  const topSpenderEntry = Object.entries(memberPaid).sort((a,b)=>b[1]-a[1])[0];

  // ── SUMMARY ──
  doc.setFontSize(14);
  doc.setFont('helvetica','bold');
  doc.text('Summary', M, y); y += 16;
  doc.setFontSize(11);
  doc.setFont('helvetica','normal');

  const summaryRows = [
    ['Total Spent', money(total)],
    ['Total Expenses', `${trip.expenses.length}`],
    ['Members', `${trip.members.length}`],
    ['Average / Person', trip.members.length ? money(total/trip.members.length) : '—'],
    ['Top Spender', topSpenderEntry && topSpenderEntry[1] > 0 ? `${topSpenderEntry[0]} — ${money(topSpenderEntry[1])}` : '—'],
    ['Transfers', `${(trip.transfers||[]).length} / ${money(totalTransferred)}`],
    ['Settled', money(totalSettled)],
    ['Outstanding', totalOutstanding < 0.01 ? 'All settled ✓' : money(totalOutstanding)],
  ];
  summaryRows.forEach(([k,v]) => {
    doc.setTextColor(120,120,120);
    doc.text(k, M, y);
    doc.setTextColor(0,0,0);
    doc.text(String(v), W - M, y, { align:'right' });
    // separator line
    doc.setDrawColor(230,230,230);
    doc.line(M, y+4, W - M, y+4);
    y += 16;
  });
  y += 12;

  const pageBreakIfNeeded = (needed) => {
    if (y + needed > H - M) { doc.addPage(); y = M; }
  };

  // ── MEMBER BREAKDOWN ──
  pageBreakIfNeeded(60);
  doc.setFontSize(14);
  doc.setFont('helvetica','bold');
  doc.text('Member Breakdown', M, y);

  if (doc.autoTable) {
    doc.autoTable({
      startY: y + 6,
      head: [['Member', 'Paid', 'Net Balance', 'Status']],
      body: trip.members.map(m => {
        const paid = memberPaid[m] || 0;
        const net  = netBalances[m] || 0;
        const status = net > 0.01 ? `Gets back ${money(net)}` : net < -0.01 ? `Owes ${money(-net)}` : 'Settled';
        const netCell = net >= 0 ? `+${money(net)}` : money(net);
        return [m, money(paid), netCell, status];
      }),
      margin: { left: M, right: M },
      headStyles: { fillColor: [255, 107, 53], textColor: [255,255,255] },
      styles: { fontSize: 9, cellPadding: 6 },
      columnStyles: { 1: { halign:'right' }, 2: { halign:'right' } },
    });
    y = doc.lastAutoTable.finalY + 20;
  } else {
    y += 16;
    trip.members.forEach(m => {
      const paid = memberPaid[m] || 0;
      const net  = netBalances[m] || 0;
      doc.setFontSize(10);
      doc.text(`${m}: paid ${money(paid)}, net ${net>=0?'+':''}${money(net)}`, M, y);
      y += 14;
    });
    y += 6;
  }

  // ── EXPENSES ──
  if (trip.expenses.length) {
    pageBreakIfNeeded(80);
    doc.setFontSize(14);
    doc.setFont('helvetica','bold');
    doc.text('Expenses', M, y);
    const sorted = [...trip.expenses].sort((a,b) => new Date(b.date) - new Date(a.date));
    if (doc.autoTable) {
      doc.autoTable({
        startY: y + 6,
        head: [['Date', 'Description', 'Category', 'Paid By', 'Amount']],
        body: sorted.map(exp => {
          const dateStr = exp.date ? new Date(exp.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
          const payers = Object.entries(exp.payers||{}).map(([m,v]) => `${m} (${money(v)})`).join(', ');
          return [dateStr, exp.name, CAT_LABELS[exp.category] || exp.category, payers, money(exp.amount)];
        }),
        margin: { left: M, right: M },
        headStyles: { fillColor: [255, 107, 53], textColor: [255,255,255] },
        styles: { fontSize: 8, cellPadding: 5, overflow:'linebreak' },
        columnStyles: {
          0: { cellWidth: 50 },
          2: { cellWidth: 70 },
          4: { halign:'right', cellWidth: 70 },
        },
      });
      y = doc.lastAutoTable.finalY + 20;
    }
  }

  // ── SETTLEMENTS ──
  if (trip.transfers && trip.transfers.length) {
    pageBreakIfNeeded(80);
    doc.setFontSize(14);
    doc.setFont('helvetica','bold');
    doc.text('Transfers', M, y);
    const tList = [...trip.transfers].reverse();
    if (doc.autoTable) {
      doc.autoTable({
        startY: y + 6,
        head: [['Date', 'From', 'To', 'Amount', 'Note']],
        body: tList.map(t => {
          const dateStr = t.date ? new Date(t.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
          return [dateStr, t.from, t.to, money(t.amount), t.note || ''];
        }),
        margin: { left: M, right: M },
        headStyles: { fillColor: [255, 209, 102], textColor: [30,30,30] },
        styles: { fontSize: 9, cellPadding: 6 },
        columnStyles: { 3: { halign:'right' } },
      });
      y = doc.lastAutoTable.finalY + 20;
    }
  }

  if (trip.settlements && trip.settlements.length) {
    pageBreakIfNeeded(80);
    doc.setFontSize(14);
    doc.setFont('helvetica','bold');
    doc.text('Settled Transactions', M, y);
    const sList = [...trip.settlements].reverse();
    if (doc.autoTable) {
      doc.autoTable({
        startY: y + 6,
        head: [['Date', 'From', 'To', 'Amount']],
        body: sList.map(s => {
          const dateStr = s.date ? new Date(s.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
          return [dateStr, s.from, s.to, money(s.amount)];
        }),
        margin: { left: M, right: M },
        headStyles: { fillColor: [6, 214, 160], textColor: [255,255,255] },
        styles: { fontSize: 9, cellPadding: 6 },
        columnStyles: { 3: { halign:'right' } },
      });
      y = doc.lastAutoTable.finalY + 20;
    }
  }

  // ── OUTSTANDING DEBTS ──
  if (debts.length) {
    pageBreakIfNeeded(80);
    doc.setFontSize(14);
    doc.setFont('helvetica','bold');
    doc.text('Outstanding Debts', M, y);
    if (doc.autoTable) {
      doc.autoTable({
        startY: y + 6,
        head: [['From', 'To', 'Amount']],
        body: debts.map(d => [d.from, d.to, money(d.amount)]),
        margin: { left: M, right: M },
        headStyles: { fillColor: [239, 71, 111], textColor: [255,255,255] },
        styles: { fontSize: 9, cellPadding: 6 },
        columnStyles: { 2: { halign:'right' } },
      });
      y = doc.lastAutoTable.finalY + 20;
    }
  } else if (trip.expenses.length) {
    pageBreakIfNeeded(40);
    doc.setFontSize(12);
    doc.setFont('helvetica','bold');
    doc.setTextColor(6, 175, 130);
    doc.text('All settled up!', M, y);
    doc.setTextColor(0,0,0);
  }

  // ── FOOTER on each page ──
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(160,160,160);
    doc.text(`TripSplit  •  ${trip.name}`, M, H - 18);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 18, { align:'right' });
  }

  const safeName = trip.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'trip';
  doc.save(`${safeName}-report.pdf`);
  toast('PDF downloaded','success');
}

// ── CLOSE ON OVERLAY CLICK ──
document.querySelectorAll('.modal-overlay').forEach(o=>{
  o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open');});
});

// ── INIT ──
loadState();
// money.js (loaded right after this file) calls initMoneyManager() which
// renders the default Money Manager landing.
