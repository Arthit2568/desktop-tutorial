/* ── Config ───────────────────────────────────────────────────────────────── */
const API = '';  // same origin; set to 'http://localhost:3000' for dev
let ws = null;
let wsReconnectTimer = null;
let currentEquipmentDbId = null;
let currentBorrowId = null;

/* ── WebSocket ────────────────────────────────────────────────────────────── */
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    setWSStatus(true);
    clearTimeout(wsReconnectTimer);
  };
  ws.onclose = () => {
    setWSStatus(false);
    wsReconnectTimer = setTimeout(connectWS, 3000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = ({ data }) => {
    try { handleWSMessage(JSON.parse(data)); } catch {}
  };
}

function setWSStatus(connected) {
  const dot = document.querySelector('.ws-dot');
  const label = document.querySelector('.ws-label');
  dot.className = `ws-dot ${connected ? 'connected' : 'disconnected'}`;
  label.textContent = connected ? 'เชื่อมต่อแล้ว' : 'ขาดการเชื่อมต่อ';
}

function handleWSMessage(msg) {
  if (msg.type === 'rfid_scan') {
    showRFIDResult(msg.equipment);
    showToast(`สแกน: ${msg.equipment.name}`, 'success');
    pulseRFID('scanning');
  } else if (msg.type === 'rfid_unknown') {
    pulseRFID('error');
    showToast(`ไม่พบ RFID: ${msg.rfid_tag}`, 'error');
  } else if (msg.type === 'new_borrow' || msg.type === 'return') {
    loadStats();
    if (currentPage === 'borrowing') loadBorrowingRecords();
    if (currentPage === 'dashboard') loadRecentBorrows();
  }
}

/* ── Navigation ───────────────────────────────────────────────────────────── */
let currentPage = 'dashboard';

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));

  if (page === 'dashboard') { loadStats(); loadRecentBorrows(); }
  else if (page === 'borrowing') loadBorrowingRecords();
  else if (page === 'equipment') loadEquipment();
  else if (page === 'students') { loadStudents(); }
  else if (page === 'rfid') loadStudentsForSelect();
}

/* ── API helpers ──────────────────────────────────────────────────────────── */
async function api(method, path, body, isFormData = false) {
  const opts = { method, headers: {} };
  if (body) {
    if (isFormData) {
      opts.body = body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(API + path, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

/* ── Toast ────────────────────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ── Stats ────────────────────────────────────────────────────────────────── */
async function loadStats() {
  try {
    const s = await api('GET', '/api/stats');
    document.getElementById('stat-total').textContent = s.total_equipment;
    document.getElementById('stat-available').textContent = s.available;
    document.getElementById('stat-borrowed').textContent = s.borrowed;
    document.getElementById('stat-overdue').textContent = s.overdue;
    document.getElementById('stat-students').textContent = s.total_students;
    document.getElementById('stat-records').textContent = s.total_records;
  } catch {}
}

/* ── Recent Borrows ───────────────────────────────────────────────────────── */
async function loadRecentBorrows() {
  try {
    const records = await api('GET', '/api/borrowing?status=borrowed');
    const el = document.getElementById('recentBorrows');
    el.innerHTML = records.length
      ? records.slice(0, 6).map(renderRecordCard).join('')
      : emptyState('ไม่มีรายการยืมในขณะนี้');
  } catch {}
}

/* ── RFID Scanner ─────────────────────────────────────────────────────────── */
function pulseRFID(mode) {
  const v = document.getElementById('rfidVisual');
  v.className = 'rfid-visual ' + mode;
  setTimeout(() => { v.className = 'rfid-visual'; }, 2000);
}

async function manualScan() {
  const tag = document.getElementById('manualRfid').value.trim();
  if (!tag) return;
  await performScan(tag);
}

async function quickScan(tag) {
  document.getElementById('manualRfid').value = tag;
  await performScan(tag);
}

async function performScan(rfid_tag) {
  document.getElementById('rfidStatusText').textContent = 'กำลังค้นหา...';
  try {
    const data = await api('POST', '/api/rfid/scan', { rfid_tag });
    showRFIDResult(data.equipment);
    pulseRFID('scanning');
    document.getElementById('rfidStatusText').textContent = 'พบอุปกรณ์';
    loadStudentsForSelect();
  } catch (e) {
    pulseRFID('error');
    document.getElementById('rfidStatusText').textContent = 'ไม่พบอุปกรณ์';
    document.getElementById('rfidResult').classList.add('hidden');
    showToast(e.message || 'ไม่พบอุปกรณ์ที่ตรงกับ RFID นี้', 'error');
  }
}

function showRFIDResult(eq) {
  currentEquipmentDbId = eq.id;
  currentBorrowId = eq.borrow_id || null;

  document.getElementById('rfidResult').classList.remove('hidden');
  document.getElementById('resPhoto').src = eq.photo_url || 'css/no-image.svg';
  document.getElementById('resName').textContent = eq.name;
  document.getElementById('resEquipId').textContent = eq.equipment_id;
  document.getElementById('resCategory').textContent = eq.category || '-';
  document.getElementById('resSpecs').textContent = eq.specs || 'ไม่มีข้อมูลสเปค';

  const isBorrowed = eq.status === 'borrowed';
  const badge = document.getElementById('resBadge');
  badge.textContent = isBorrowed ? 'กำลังถูกยืม' : 'พร้อมให้ยืม';
  badge.className = `equip-badge ${isBorrowed ? 'badge-borrowed' : 'badge-available'}`;

  document.getElementById('resBorrowerSection').classList.toggle('hidden', !isBorrowed);
  document.getElementById('resBorrowSection').classList.toggle('hidden', isBorrowed);

  if (isBorrowed) {
    document.getElementById('resStudentId').textContent = eq.student_id || '-';
    document.getElementById('resStudentName').textContent = eq.student_name || '-';
    document.getElementById('resAdvisor').textContent = eq.advisor || '-';
    document.getElementById('resDepartment').textContent = eq.department || '-';
    document.getElementById('resCourse').textContent = eq.course || '-';
    document.getElementById('resBorrowDate').textContent = formatDate(eq.borrow_date);
    document.getElementById('resExpectedReturn').textContent = eq.expected_return_date ? formatDate(eq.expected_return_date) : '-';
    document.getElementById('resReturnBtn').onclick = () => returnEquipment(eq.borrow_id);
  }
}

async function loadStudentsForSelect() {
  try {
    const students = await api('GET', '/api/students');
    const sel = document.getElementById('borrowStudentSelect');
    sel.innerHTML = '<option value="">-- เลือกนิสิต --</option>' +
      students.map(s => `<option value="${s.id}">${s.student_id} - ${s.name}</option>`).join('');
    document.getElementById('resBorrowBtn').onclick = () => submitBorrow();
  } catch {}
}

async function submitBorrow() {
  const student_id = document.getElementById('borrowStudentSelect').value;
  if (!student_id) return showToast('กรุณาเลือกนิสิต', 'error');
  if (!currentEquipmentDbId) return;

  const expected = document.getElementById('borrowExpectedReturn').value;
  try {
    await api('POST', '/api/borrowing', {
      equipment_id: currentEquipmentDbId,
      student_id,
      course: document.getElementById('borrowCourse').value,
      purpose: document.getElementById('borrowPurpose').value,
      expected_return_date: expected || null,
    });
    showToast('ยืมอุปกรณ์สำเร็จ', 'success');
    await performScan(document.getElementById('manualRfid').value);
    loadStats();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function returnEquipment(borrowId) {
  if (!borrowId) return;
  try {
    await api('PUT', `/api/borrowing/${borrowId}/return`);
    showToast('คืนอุปกรณ์สำเร็จ', 'success');
    await performScan(document.getElementById('manualRfid').value);
    loadStats();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

/* ── Borrowing Records ────────────────────────────────────────────────────── */
async function loadBorrowingRecords() {
  const eq = document.getElementById('searchEquip').value;
  const st = document.getElementById('searchStudent').value;
  const status = document.getElementById('filterStatus').value;
  const params = new URLSearchParams();
  if (eq) params.set('equipment_search', eq);
  if (st) params.set('student_id', st);
  if (status) params.set('status', status);
  try {
    const records = await api('GET', `/api/borrowing?${params}`);
    document.getElementById('borrowingList').innerHTML = records.length
      ? records.map(r => renderRecordCard(r, true)).join('')
      : emptyState('ไม่พบรายการที่ตรงกับเงื่อนไข');
  } catch {}
}

function renderRecordCard(r, showReturn = false) {
  const isOverdue = r.status === 'borrowed' && r.expected_return_date && new Date(r.expected_return_date) < new Date();
  const statusLabel = r.status === 'returned' ? 'คืนแล้ว' : isOverdue ? 'เกินกำหนด' : 'กำลังยืม';
  const statusClass = r.status === 'returned' ? 'status-returned' : isOverdue ? 'status-overdue' : 'status-borrowed';
  const photoSrc = r.photo_url || 'css/no-image.svg';

  return `
    <div class="record-card ${isOverdue ? 'overdue-row' : ''}">
      <div class="record-thumb">
        <img src="${photoSrc}" alt="${r.equip_name}" onerror="this.src='css/no-image.svg'" />
      </div>
      <div class="record-body">
        <div class="record-title">${r.equip_name}</div>
        <div class="record-meta">
          <span>🏷️ ${r.equip_code}</span>
          <span>👤 ${r.student_code} ${r.student_name}</span>
          <span>📚 ${r.course || '-'}</span>
          <span>👩‍🏫 ${r.advisor || '-'}</span>
          <span>📤 ยืม: ${formatDate(r.borrow_date)}</span>
          ${r.expected_return_date ? `<span>📅 กำหนดคืน: ${formatDate(r.expected_return_date)}</span>` : ''}
          ${r.return_date ? `<span>📥 คืน: ${formatDate(r.return_date)}</span>` : ''}
        </div>
      </div>
      <div class="record-status">
        <span class="status-badge ${statusClass}">${statusLabel}</span>
        ${showReturn && r.status === 'borrowed' ? `<button class="btn btn-sm btn-success" onclick="returnFromList(${r.id})">📥 คืน</button>` : ''}
      </div>
    </div>`;
}

async function returnFromList(id) {
  try {
    await api('PUT', `/api/borrowing/${id}/return`);
    showToast('คืนอุปกรณ์สำเร็จ', 'success');
    loadBorrowingRecords();
    loadStats();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

/* ── Equipment ────────────────────────────────────────────────────────────── */
async function loadEquipment() {
  try {
    const list = await api('GET', '/api/equipment');
    document.getElementById('equipmentGrid').innerHTML = list.length
      ? list.map(renderEquipCard).join('')
      : emptyState('ยังไม่มีครุภัณฑ์ในระบบ');
  } catch {}
}

function renderEquipCard(e) {
  const photoSrc = e.photo_url || '';
  const imgContent = photoSrc
    ? `<img src="${photoSrc}" alt="${e.name}" onerror="this.parentElement.innerHTML='<div class=\\'no-img\\'>🔧</div>'" />`
    : `<div class="no-img">🔧</div>`;
  return `
    <div class="equip-card">
      <div class="equip-card-img">${imgContent}</div>
      <div class="equip-card-body">
        <div class="equip-card-title">${e.name}</div>
        <div class="equip-card-id">${e.equipment_id} · ${e.rfid_tag}</div>
        <div class="equip-card-footer">
          <span class="status-badge ${e.status === 'available' ? 'status-returned' : 'status-borrowed'}">
            ${e.status === 'available' ? 'พร้อมให้ยืม' : 'กำลังถูกยืม'}
          </span>
          <div class="equip-card-actions">
            <button class="btn-icon" onclick="openEquipModal(${e.id})" title="แก้ไข">✏️</button>
          </div>
        </div>
      </div>
    </div>`;
}

function openEquipModal(id) {
  document.getElementById('equipModalTitle').textContent = id ? 'แก้ไขครุภัณฑ์' : 'เพิ่มครุภัณฑ์';
  document.getElementById('equipId').value = id || '';
  document.getElementById('equipForm').reset();
  if (id) {
    api('GET', `/api/equipment/${id}`).then(e => {
      document.getElementById('equipRfid').value = e.rfid_tag;
      document.getElementById('equipCode').value = e.equipment_id;
      document.getElementById('equipName').value = e.name;
      document.getElementById('equipCategory').value = e.category;
      document.getElementById('equipSpecs').value = e.specs;
    });
  }
  document.getElementById('equipModal').classList.remove('hidden');
}

async function saveEquipment(e) {
  e.preventDefault();
  const id = document.getElementById('equipId').value;
  const formData = new FormData();
  formData.append('rfid_tag', document.getElementById('equipRfid').value);
  formData.append('equipment_id', document.getElementById('equipCode').value);
  formData.append('name', document.getElementById('equipName').value);
  formData.append('category', document.getElementById('equipCategory').value);
  formData.append('specs', document.getElementById('equipSpecs').value);
  const photoFile = document.getElementById('equipPhoto').files[0];
  if (photoFile) formData.append('photo', photoFile);

  try {
    if (id) {
      await api('PUT', `/api/equipment/${id}`, formData, true);
    } else {
      await api('POST', '/api/equipment', formData, true);
    }
    showToast('บันทึกสำเร็จ', 'success');
    closeModal('equipModal');
    loadEquipment();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ── Students ─────────────────────────────────────────────────────────────── */
async function loadStudents() {
  try {
    const list = await api('GET', '/api/students');
    document.getElementById('studentList').innerHTML = list.length
      ? list.map(renderStudentCard).join('')
      : emptyState('ยังไม่มีข้อมูลนิสิต');
  } catch {}
}

function renderStudentCard(s) {
  const initial = s.name.replace(/^(นาย|นางสาว|นาง)\s*/, '').charAt(0) || '?';
  return `
    <div class="student-card">
      <div class="student-avatar">${initial}</div>
      <div class="student-info">
        <div class="student-name">${s.name}</div>
        <div class="student-meta">
          <span>🎓 ${s.student_id}</span>
          <span>👩‍🏫 ${s.advisor || '-'}</span>
          <span>🏛️ ${s.department || '-'}</span>
        </div>
      </div>
      <button class="btn-icon" onclick="openStudentModal(${s.id})" title="แก้ไข">✏️</button>
    </div>`;
}

function openStudentModal(id) {
  document.getElementById('studentDbId').value = id || '';
  document.getElementById('studentForm').reset();
  if (id) {
    api('GET', '/api/students').then(list => {
      const s = list.find(x => x.id === id);
      if (s) {
        document.getElementById('studentCode').value = s.student_id;
        document.getElementById('studentName').value = s.name;
        document.getElementById('studentAdvisor').value = s.advisor;
        document.getElementById('studentDept').value = s.department;
        document.getElementById('studentCode').readOnly = true;
      }
    });
  } else {
    document.getElementById('studentCode').readOnly = false;
  }
  document.getElementById('studentModal').classList.remove('hidden');
}

async function saveStudent(e) {
  e.preventDefault();
  const id = document.getElementById('studentDbId').value;
  const body = {
    student_id: document.getElementById('studentCode').value,
    name: document.getElementById('studentName').value,
    advisor: document.getElementById('studentAdvisor').value,
    department: document.getElementById('studentDept').value,
  };
  try {
    if (id) {
      await api('PUT', `/api/students/${id}`, body);
    } else {
      await api('POST', '/api/students', body);
    }
    showToast('บันทึกสำเร็จ', 'success');
    closeModal('studentModal');
    loadStudents();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ── Modals ───────────────────────────────────────────────────────────────── */
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

/* ── Utils ────────────────────────────────────────────────────────────────── */
function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function emptyState(msg) {
  return `<div class="empty-state"><div>📭</div>${msg}</div>`;
}

/* ── Keyboard shortcuts ───────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement === document.getElementById('manualRfid')) {
    manualScan();
  }
  if (e.key === 'Escape') {
    ['equipModal', 'studentModal'].forEach(m => document.getElementById(m).classList.add('hidden'));
  }
});

/* ── Init ─────────────────────────────────────────────────────────────────── */
connectWS();
loadStats();
loadRecentBorrows();
