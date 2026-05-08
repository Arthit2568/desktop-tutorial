/**
 * RFID Borrowing System - ESP32 + PN532 NFC/RFID Module
 *
 * Hardware: ESP32 + PN532 NFC Module Kit (I2C mode)
 * Library:  Adafruit PN532 (Install via Arduino Library Manager)
 *
 * PN532 Wiring (I2C):
 *   PN532 VCC  -> ESP32 3.3V
 *   PN532 GND  -> ESP32 GND
 *   PN532 SDA  -> ESP32 GPIO21
 *   PN532 SCL  -> ESP32 GPIO22
 *   PN532 IRQ  -> GPIO2  (optional, for interrupt mode)
 *   PN532 RSTO -> GPIO4  (optional, for reset)
 *
 * PN532 DIP Switch for I2C mode: SW1=OFF, SW2=ON
 *
 * After scanning, ESP32 sends HTTP POST to server:
 *   POST /api/rfid/scan
 *   { "rfid_tag": "AA:BB:CC:DD" }
 */

#include <Wire.h>
#include <Adafruit_PN532.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ── WiFi & Server Config ─────────────────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL    = "http://192.168.1.100:3000/api/rfid/scan";  // เปลี่ยน IP ให้ตรงกับ server

// ── PN532 I2C Pins ───────────────────────────────────────────────────────────
#define PN532_IRQ   2
#define PN532_RESET 4
Adafruit_PN532 nfc(PN532_IRQ, PN532_RESET);

// ── LED & Buzzer ─────────────────────────────────────────────────────────────
#define LED_GREEN  5
#define LED_RED    18
#define BUZZER_PIN 19

// ── State ───────────────────────────────────────────────────────────────────
String lastTag = "";
unsigned long lastScanTime = 0;
const unsigned long SCAN_COOLDOWN = 2000;  // 2 seconds between same card scans

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== RFID Borrowing System ===");

  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // ── Init PN532 ──
  Wire.begin(21, 22);  // SDA=21, SCL=22
  nfc.begin();

  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.println("[ERROR] PN532 not found! Check wiring.");
    blinkError();
    while (1);
  }
  Serial.printf("[PN532] Found chip PN5%02X, FW v%d.%d\n",
    (versiondata >> 24) & 0xFF,
    (versiondata >> 16) & 0xFF,
    (versiondata >> 8) & 0xFF);

  nfc.SAMConfig();
  Serial.println("[PN532] Ready. Waiting for card...");

  // ── Connect WiFi ──
  connectWiFi();

  beepSuccess();
}

void loop() {
  uint8_t uid[7];
  uint8_t uidLen;

  // Poll for RFID/NFC card (ISO14443A = Mifare, NTAG, etc.)
  bool found = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLen, 200);

  if (found) {
    String tagID = formatUID(uid, uidLen);
    unsigned long now = millis();

    // Cooldown to avoid repeated scans of same card
    if (tagID != lastTag || (now - lastScanTime) > SCAN_COOLDOWN) {
      lastTag = tagID;
      lastScanTime = now;

      Serial.printf("[SCAN] Tag: %s\n", tagID.c_str());
      sendTagToServer(tagID);
    }
  }

  // Reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Reconnecting...");
    connectWiFi();
  }
}

/* ── Format UID as XX:XX:XX:XX ─────────────────────────────────────────────── */
String formatUID(uint8_t* uid, uint8_t len) {
  String result = "";
  for (uint8_t i = 0; i < len; i++) {
    if (i > 0) result += ":";
    if (uid[i] < 0x10) result += "0";
    result += String(uid[i], HEX);
  }
  result.toUpperCase();
  return result;
}

/* ── Send tag to server ─────────────────────────────────────────────────────── */
void sendTagToServer(String tagID) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi not connected");
    blinkError();
    return;
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);

  // Build JSON payload
  StaticJsonDocument<128> doc;
  doc["rfid_tag"] = tagID;
  String payload;
  serializeJson(doc, payload);

  int statusCode = http.POST(payload);

  if (statusCode == 200) {
    String response = http.getString();
    Serial.printf("[HTTP] OK: %s\n", response.c_str());

    // Parse response to check equipment status
    StaticJsonDocument<512> resDoc;
    if (deserializeJson(resDoc, response) == DeserializationError::Ok) {
      const char* status = resDoc["equipment"]["status"] | "unknown";
      const char* name   = resDoc["equipment"]["name"]   | "Unknown";
      Serial.printf("[INFO] Equipment: %s | Status: %s\n", name, status);
    }
    beepSuccess();
    blinkGreen();

  } else if (statusCode == 404) {
    Serial.printf("[HTTP] Tag not found: %s\n", tagID.c_str());
    beepError();
    blinkError();

  } else {
    Serial.printf("[HTTP] Error: %d\n", statusCode);
    beepError();
    blinkError();
  }

  http.end();
}

/* ── WiFi ───────────────────────────────────────────────────────────────────── */
void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Connection failed.");
    blinkError();
  }
}

/* ── Indicators ──────────────────────────────────────────────────────────────── */
void beepSuccess() {
  tone(BUZZER_PIN, 1000, 100);
  delay(120);
  tone(BUZZER_PIN, 1500, 100);
  delay(120);
}

void beepError() {
  tone(BUZZER_PIN, 400, 500);
}

void blinkGreen() {
  digitalWrite(LED_GREEN, HIGH);
  delay(500);
  digitalWrite(LED_GREEN, LOW);
}

void blinkError() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_RED, HIGH);
    delay(200);
    digitalWrite(LED_RED, LOW);
    delay(200);
  }
}
