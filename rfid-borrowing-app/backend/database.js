const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'borrowing.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid_tag TEXT UNIQUE NOT NULL,
    equipment_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    photo_url TEXT DEFAULT '',
    specs TEXT DEFAULT '',
    status TEXT DEFAULT 'available',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    advisor TEXT DEFAULT '',
    department TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS borrowing_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    course TEXT DEFAULT '',
    purpose TEXT DEFAULT '',
    borrow_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    expected_return_date DATETIME,
    return_date DATETIME,
    status TEXT DEFAULT 'borrowed',
    notes TEXT DEFAULT '',
    FOREIGN KEY (equipment_id) REFERENCES equipment(id),
    FOREIGN KEY (student_id) REFERENCES students(id)
  );
`);

// Seed demo data if empty
const equipmentCount = db.prepare('SELECT COUNT(*) as c FROM equipment').get().c;
if (equipmentCount === 0) {
  const insertEquip = db.prepare(`
    INSERT INTO equipment (rfid_tag, equipment_id, name, category, specs, status)
    VALUES (?, ?, ?, ?, ?, 'available')
  `);
  insertEquip.run('AA:BB:CC:DD', 'KHP-2024-001', 'Arduino Uno R3', 'Microcontroller',
    'MCU: ATmega328P, Flash: 32KB, SRAM: 2KB, Clock: 16MHz, Digital I/O: 14, Analog: 6');
  insertEquip.run('11:22:33:44', 'KHP-2024-002', 'Raspberry Pi 4 Model B', 'Single Board Computer',
    'CPU: Cortex-A72 1.8GHz Quad-core, RAM: 4GB, Storage: MicroSD, USB: 4x, HDMI: 2x');
  insertEquip.run('AA:11:BB:22', 'KHP-2024-003', 'ESP32 Development Board', 'Microcontroller',
    'MCU: Xtensa LX6 Dual-core 240MHz, Flash: 4MB, WiFi: 802.11b/g/n, Bluetooth: 4.2 BLE');
  insertEquip.run('FF:EE:DD:CC', 'KHP-2024-004', 'Oscilloscope DS1054Z', 'Test Equipment',
    'Channels: 4, Bandwidth: 50MHz, Sample Rate: 1GSa/s, Memory Depth: 12Mpts, Display: 7 inch TFT');

  const insertStudent = db.prepare(`
    INSERT INTO students (student_id, name, advisor, department)
    VALUES (?, ?, ?, ?)
  `);
  insertStudent.run('64010001', 'นายสมชาย ใจดี', 'ผศ.ดร.วิชัย มีความรู้', 'วิศวกรรมคอมพิวเตอร์');
  insertStudent.run('64010002', 'นางสาวสมหญิง รักเรียน', 'รศ.ดร.สมศรี พัฒนาดี', 'วิศวกรรมไฟฟ้า');
  insertStudent.run('65020003', 'นายวิชัย เก่งมาก', 'ผศ.ดร.วิชัย มีความรู้', 'วิศวกรรมคอมพิวเตอร์');
}

module.exports = db;
