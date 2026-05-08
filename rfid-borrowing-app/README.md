# ระบบยืม-คืนครุภัณฑ์ RFID (ESP32 + PN532)

ระบบบริหารจัดการการยืม-คืนครุภัณฑ์โดยใช้ RFID ผ่าน ESP32 + PN532 NFC Module

## สถาปัตยกรรมระบบ

```
[ESP32 + PN532] --HTTP POST--> [Node.js Server] <--WebSocket--> [Web Browser]
                                     |
                               [SQLite Database]
```

## คุณสมบัติ
- สแกน RFID แสดงข้อมูลครุภัณฑ์ทันที (real-time via WebSocket)
- ยืม-คืนครุภัณฑ์ผ่านหน้าเว็บ
- แสดง: เลขครุภัณฑ์, รูปถ่าย, สเปค, รหัสนิสิต, ชื่อ, อ.ที่ปรึกษา, รายวิชา, วันยืม-คืน
- แดชบอร์ดสรุป พร้อมแจ้งเตือนเกินกำหนดคืน
- จัดการครุภัณฑ์และนิสิตผ่านหน้าเว็บ

## วิธีติดตั้ง

### 1. Backend (Node.js)
```bash
cd backend
npm install
npm start
```
เซิร์ฟเวอร์จะรันที่ http://localhost:3000

### 2. เปิดเว็บ
เปิดเบราว์เซอร์ไปที่ http://localhost:3000

### 3. ESP32 + PN532

**Arduino Libraries ที่ต้องติดตั้ง:**
- `Adafruit PN532` (by Adafruit)
- `ArduinoJson` (by Benoit Blanchon)

**การเชื่อมต่อ PN532 (I2C mode):**
| PN532 | ESP32 |
|-------|-------|
| VCC   | 3.3V  |
| GND   | GND   |
| SDA   | GPIO21|
| SCL   | GPIO22|
| IRQ   | GPIO2 |
| RSTO  | GPIO4 |

> PN532 DIP Switch: SW1=OFF, SW2=ON (I2C mode)

**แก้ไข config ใน `rfid_borrowing_esp32.ino`:**
```cpp
const char* WIFI_SSID     = "ชื่อ WiFi ของคุณ";
const char* WIFI_PASSWORD = "รหัส WiFi ของคุณ";
const char* SERVER_URL    = "http://IP_ของ_Server:3000/api/rfid/scan";
```

## API Endpoints

| Method | Path | คำอธิบาย |
|--------|------|-----------|
| POST   | /api/rfid/scan | รับค่า RFID จาก ESP32 |
| GET    | /api/equipment | รายการครุภัณฑ์ทั้งหมด |
| POST   | /api/equipment | เพิ่มครุภัณฑ์ |
| PUT    | /api/equipment/:id | แก้ไขครุภัณฑ์ |
| GET    | /api/students | รายการนิสิต |
| POST   | /api/students | เพิ่มนิสิต |
| GET    | /api/borrowing | รายการยืม-คืน |
| POST   | /api/borrowing | บันทึกการยืม |
| PUT    | /api/borrowing/:id/return | บันทึกการคืน |
| GET    | /api/stats | สถิติภาพรวม |

## ตัวอย่างการส่งข้อมูลจาก ESP32

```json
POST /api/rfid/scan
Content-Type: application/json

{
  "rfid_tag": "AA:BB:CC:DD"
}
```

**Response (พบอุปกรณ์ว่าง):**
```json
{
  "success": true,
  "equipment": {
    "id": 1,
    "equipment_id": "KHP-2024-001",
    "name": "Arduino Uno R3",
    "status": "available",
    "specs": "MCU: ATmega328P..."
  }
}
```
