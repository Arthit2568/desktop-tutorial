const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, '..', 'frontend', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// WebSocket broadcast helper
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// ── ESP32 RFID endpoint ────────────────────────────────────────────────────────
app.post('/api/rfid/scan', (req, res) => {
  const { rfid_tag } = req.body;
  if (!rfid_tag) return res.status(400).json({ error: 'rfid_tag required' });

  const equipment = db.prepare(`
    SELECT e.*,
      br.id as borrow_id, br.status as borrow_status,
      s.student_id, s.name as student_name, s.advisor, s.department,
      br.course, br.purpose, br.borrow_date, br.expected_return_date, br.notes
    FROM equipment e
    LEFT JOIN borrowing_records br ON e.id = br.equipment_id AND br.status = 'borrowed'
    LEFT JOIN students s ON br.student_id = s.id
    WHERE e.rfid_tag = ?
  `).get(rfid_tag);

  if (!equipment) {
    broadcast({ type: 'rfid_unknown', rfid_tag });
    return res.status(404).json({ error: 'ไม่พบอุปกรณ์ที่ตรงกับ RFID นี้', rfid_tag });
  }

  broadcast({ type: 'rfid_scan', equipment });
  res.json({ success: true, equipment });
});

// ── Equipment CRUD ─────────────────────────────────────────────────────────────
app.get('/api/equipment', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM borrowing_records WHERE equipment_id = e.id AND status = 'borrowed') as active_borrows
    FROM equipment e ORDER BY e.id DESC
  `).all();
  res.json(rows);
});

app.get('/api/equipment/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/equipment', upload.single('photo'), (req, res) => {
  const { rfid_tag, equipment_id, name, category, specs } = req.body;
  if (!rfid_tag || !equipment_id || !name)
    return res.status(400).json({ error: 'rfid_tag, equipment_id, name required' });

  const photo_url = req.file ? `/uploads/${req.file.filename}` : '';
  try {
    const result = db.prepare(`
      INSERT INTO equipment (rfid_tag, equipment_id, name, category, photo_url, specs)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(rfid_tag, equipment_id, name, category || '', photo_url, specs || '');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'RFID หรือเลขครุภัณฑ์ซ้ำ' });
  }
});

app.put('/api/equipment/:id', upload.single('photo'), (req, res) => {
  const { name, category, specs, rfid_tag, equipment_id } = req.body;
  const existing = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const photo_url = req.file ? `/uploads/${req.file.filename}` : existing.photo_url;
  db.prepare(`
    UPDATE equipment SET name=?, category=?, specs=?, rfid_tag=?, equipment_id=?, photo_url=?
    WHERE id=?
  `).run(name || existing.name, category ?? existing.category,
         specs ?? existing.specs, rfid_tag || existing.rfid_tag,
         equipment_id || existing.equipment_id, photo_url, req.params.id);
  res.json({ success: true });
});

// ── Students CRUD ──────────────────────────────────────────────────────────────
app.get('/api/students', (req, res) => {
  res.json(db.prepare('SELECT * FROM students ORDER BY id DESC').all());
});

app.post('/api/students', (req, res) => {
  const { student_id, name, advisor, department } = req.body;
  if (!student_id || !name)
    return res.status(400).json({ error: 'student_id and name required' });
  try {
    const result = db.prepare(`
      INSERT INTO students (student_id, name, advisor, department) VALUES (?, ?, ?, ?)
    `).run(student_id, name, advisor || '', department || '');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'รหัสนิสิตซ้ำ' });
  }
});

app.put('/api/students/:id', (req, res) => {
  const { name, advisor, department } = req.body;
  const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE students SET name=?, advisor=?, department=? WHERE id=?')
    .run(name || existing.name, advisor ?? existing.advisor,
         department ?? existing.department, req.params.id);
  res.json({ success: true });
});

// ── Borrowing Records ──────────────────────────────────────────────────────────
app.get('/api/borrowing', (req, res) => {
  const { status, student_id, equipment_search } = req.query;
  let sql = `
    SELECT br.*,
      e.equipment_id as equip_code, e.name as equip_name, e.photo_url, e.specs, e.category,
      s.student_id as student_code, s.name as student_name, s.advisor, s.department
    FROM borrowing_records br
    JOIN equipment e ON br.equipment_id = e.id
    JOIN students s ON br.student_id = s.id
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND br.status = ?'; params.push(status); }
  if (student_id) { sql += ' AND s.student_id LIKE ?'; params.push(`%${student_id}%`); }
  if (equipment_search) {
    sql += ' AND (e.name LIKE ? OR e.equipment_id LIKE ?)';
    params.push(`%${equipment_search}%`, `%${equipment_search}%`);
  }
  sql += ' ORDER BY br.borrow_date DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/borrowing', (req, res) => {
  const { equipment_id, student_id, course, purpose, expected_return_date, notes } = req.body;
  if (!equipment_id || !student_id)
    return res.status(400).json({ error: 'equipment_id and student_id required' });

  const equip = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipment_id);
  if (!equip) return res.status(404).json({ error: 'ไม่พบอุปกรณ์' });
  if (equip.status === 'borrowed') return res.status(409).json({ error: 'อุปกรณ์ถูกยืมอยู่แล้ว' });

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(student_id);
  if (!student) return res.status(404).json({ error: 'ไม่พบข้อมูลนิสิต' });

  const result = db.prepare(`
    INSERT INTO borrowing_records (equipment_id, student_id, course, purpose, expected_return_date, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(equipment_id, student_id, course || '', purpose || '',
         expected_return_date || null, notes || '');

  db.prepare("UPDATE equipment SET status = 'borrowed' WHERE id = ?").run(equipment_id);

  const record = db.prepare(`
    SELECT br.*, e.equipment_id as equip_code, e.name as equip_name, e.photo_url, e.specs,
      s.student_id as student_code, s.name as student_name, s.advisor, s.department
    FROM borrowing_records br
    JOIN equipment e ON br.equipment_id = e.id
    JOIN students s ON br.student_id = s.id
    WHERE br.id = ?
  `).get(result.lastInsertRowid);

  broadcast({ type: 'new_borrow', record });
  res.json({ success: true, record });
});

app.put('/api/borrowing/:id/return', (req, res) => {
  const record = db.prepare('SELECT * FROM borrowing_records WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  if (record.status === 'returned') return res.status(409).json({ error: 'คืนแล้ว' });

  const now = new Date().toISOString();
  db.prepare("UPDATE borrowing_records SET status='returned', return_date=? WHERE id=?")
    .run(now, req.params.id);
  db.prepare("UPDATE equipment SET status='available' WHERE id=?").run(record.equipment_id);

  const updated = db.prepare(`
    SELECT br.*, e.equipment_id as equip_code, e.name as equip_name, e.photo_url, e.specs,
      s.student_id as student_code, s.name as student_name, s.advisor, s.department
    FROM borrowing_records br
    JOIN equipment e ON br.equipment_id = e.id
    JOIN students s ON br.student_id = s.id
    WHERE br.id = ?
  `).get(req.params.id);

  broadcast({ type: 'return', record: updated });
  res.json({ success: true, record: updated });
});

// ── Stats ──────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const total_equipment = db.prepare('SELECT COUNT(*) as c FROM equipment').get().c;
  const borrowed = db.prepare("SELECT COUNT(*) as c FROM equipment WHERE status='borrowed'").get().c;
  const available = db.prepare("SELECT COUNT(*) as c FROM equipment WHERE status='available'").get().c;
  const total_records = db.prepare('SELECT COUNT(*) as c FROM borrowing_records').get().c;
  const total_students = db.prepare('SELECT COUNT(*) as c FROM students').get().c;
  const overdue = db.prepare(`
    SELECT COUNT(*) as c FROM borrowing_records
    WHERE status='borrowed' AND expected_return_date < datetime('now')
  `).get().c;
  res.json({ total_equipment, borrowed, available, total_records, total_students, overdue });
});

// WebSocket connection
wss.on('connection', ws => {
  console.log('WebSocket client connected');
  ws.on('error', console.error);
});

server.listen(PORT, () => {
  console.log(`RFID Borrowing Server running at http://localhost:${PORT}`);
});
