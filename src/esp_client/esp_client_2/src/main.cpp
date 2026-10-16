/**
 * ============================================================================
 * ĐỒ ÁN LẬP TRÌNH MẠNG (KC321) - ĐẠI HỌC CẦN THƠ
 * GIẢNG VIÊN HƯỚNG DẪN: TS. GVC. NGUYỄN VĂN KHANH (PLC & IIoT LAB)
 * 
 * FIRMWARE NODE KHU A (ESP32 ZONE A CLIENT - ID: ESP_ZONE_B)
 * Quản lý:
 * - 3 LDR phát hiện xe (Slot 1, 2, 3) có lọc thích nghi EMA và chống nhiễu 1.5s
 * - 1 Đèn chiếu sáng (GPIO 23)
 * - 1 Đèn báo cháy Đỏ (GPIO 13)
 * - 1 Đèn giả lập phun nước Xanh (GPIO 14)
 * - 1 Còi Buzzer (GPIO 27)
 * - 1 Cảm biến lửa Flame DO (GPIO 4)
 * - 1 Nút bấm khẩn cấp (GPIO 25)
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <SocketIOclient.h>
#include <WebServer.h>
#include <Update.h>
#include <ArduinoJson.h>

// ----------------------------------------------------------------------------
// CẤU HÌNH WIFI & MÁY CHỦ (Thay đổi theo thực tế)
// ----------------------------------------------------------------------------
const char* WIFI_SSID     = "CTU_STUDENT";
const char* WIFI_PASSWORD = "";
const char* SERVER_IP     = "192.168.1.100";
const uint16_t SERVER_PORT = 3000;
const char* DEVICE_ID     = "ESP_ZONE_B";

// CỜ TÙY CHỌN TÍNH NĂNG (Dự phòng theo yêu cầu đồ án)
#define USE_ADAPTIVE_DSP    true   // true: Lọc thích nghi EMA; false: Ngưỡng cố định
#define USE_BINARY_PAYLOAD  true   // true: 1-Byte Bitmask; false: Chuỗi JSON

// ----------------------------------------------------------------------------
// SƠ ĐỒ CHÂN NGOẠI VI
// ----------------------------------------------------------------------------
const int PIN_LDR[3]          = {34, 35, 32}; // 3 chân ADC1 quang trở
const int PIN_LIGHT           = 23;           // Đèn chiếu sáng khu vực
const int PIN_LED_FIRE        = 13;           // Đèn báo cháy Đỏ
const int PIN_LED_PUMP        = 14;           // Đèn xả nước chữa cháy Xanh
const int PIN_BUZZER          = 27;           // Còi hú cảnh báo
const int PIN_FLAME_DO        = 4;            // Cảm biến lửa (Mức LOW = Có lửa)
const int PIN_EMERGENCY_BTN   = 25;           // Nút khẩn cấp (PULLUP, nhấn = LOW)

// ----------------------------------------------------------------------------
// KHỞI TẠO ĐỐI TƯỢNG VÀ THAM SỐ THUẬT TOÁN
// ----------------------------------------------------------------------------
SocketIOclient socketIO;
WebServer otaServer(80);

// Thuật toán EMA
const float EMA_ALPHA = 0.02;
const int OCCUPIED_THRESHOLD = 400;
const int HYSTERESIS = 80;
float baseline[3] = {2000.0, 2000.0, 2000.0};

// Chống nhiễu thời gian: Phải che liên tục >= 1500ms mới tính có xe
const unsigned long CONFIRM_HOLD_MS = 1500;
unsigned long candidateStartTime[3] = {0, 0, 0};
bool candidateState[3] = {false, false, false}; // Trạng thái thô tức thời
bool slotOccupied[3] = {false, false, false};   // Trạng thái đã xác nhận

// Trạng thái thiết bị
bool lightState = false;
bool fireAlarm = false;
bool pumpState = false;
bool buzzerState = false;
bool sioConnected = false;

unsigned long lastBlinkTime = 0;
bool blinkToggle = false;
unsigned long lastSendStatusTime = 0;

// ----------------------------------------------------------------------------
// ĐÓNG GÓI 1-BYTE BINARY BITMASK (Tối ưu băng thông tầng vận chuyển)
// Bit 0: Slot 1 | Bit 1: Slot 2 | Bit 2: Slot 3 | Bit 3: Light | Bit 4: Fire | Bit 5: Pump
// ----------------------------------------------------------------------------
uint8_t encodeBitmask() {
  uint8_t mask = 0;
  if (slotOccupied[0]) mask |= (1 << 0);
  if (slotOccupied[1]) mask |= (1 << 1);
  if (slotOccupied[2]) mask |= (1 << 2);
  if (lightState)      mask |= (1 << 3);
  if (fireAlarm)       mask |= (1 << 4);
  if (pumpState)       mask |= (1 << 5);
  return mask;
}

void sendStatus() {
  if (!sioConnected) return;

#if USE_BINARY_PAYLOAD
  // Gửi 1-Byte Bitmask nhị phân qua Socket.IO binary event
  uint8_t mask = encodeBitmask();
  socketIO.sendBIN(sIOtype_BINARY_EVENT, &mask, 1);
#else
  // Gửi định dạng JSON dự phòng
  DynamicJsonDocument doc(256);
  JsonArray arr = doc.createNestedArray("slots");
  arr.add(slotOccupied[0] ? 1 : 0);
  arr.add(slotOccupied[1] ? 1 : 0);
  arr.add(slotOccupied[2] ? 1 : 0);
  doc["light"] = lightState;
  doc["fire"] = fireAlarm;
  doc["pump"] = pumpState;

  DynamicJsonDocument eventDoc(512);
  JsonArray eventArr = eventDoc.to<JsonArray>();
  eventArr.add("zone_status");
  eventArr.add(doc.as<JsonObject>());
  String out;
  serializeJson(eventDoc, out);
  socketIO.sendEVENT(out);
#endif

  lastSendStatusTime = millis();
}

// ----------------------------------------------------------------------------
// THUẬT TOÁN ĐỌC CẢM BIẾN VÀ CHỐNG NHIỄU (DEBOUNCE 1.5S)
// ----------------------------------------------------------------------------
void processSensors() {
  bool stateChanged = false;

  for (int i = 0; i < 3; i++) {
    int rawVal = analogRead(PIN_LDR[i]);
    bool rawOccupied = false;

#if USE_ADAPTIVE_DSP
    // 1. Lọc thích nghi EMA & Freeze Baseline
    if (!slotOccupied[i]) {
      baseline[i] = (EMA_ALPHA * rawVal) + ((1.0 - EMA_ALPHA) * baseline[i]);
      if (rawVal < (baseline[i] - OCCUPIED_THRESHOLD)) {
        rawOccupied = true;
      }
    } else {
      if (rawVal >= (baseline[i] - (OCCUPIED_THRESHOLD - HYSTERESIS))) {
        rawOccupied = false;
      } else {
        rawOccupied = true;
      }
    }
#else
    // 2. Ngưỡng cố định đơn giản
    if (rawVal < 1700) rawOccupied = true;
    else if (rawVal > 2200) rawOccupied = false;
    else rawOccupied = slotOccupied[i];
#endif

    // 3. Cơ chế chống nhiễu thời gian: Cần duy trì trạng thái >= 1.5s
    if (rawOccupied != candidateState[i]) {
      candidateState[i] = rawOccupied;
      candidateStartTime[i] = millis();
    } else {
      if ((millis() - candidateStartTime[i] >= CONFIRM_HOLD_MS) && (candidateState[i] != slotOccupied[i])) {
        slotOccupied[i] = candidateState[i];
        stateChanged = true;
        Serial.printf("[DSP CONFIRMED] Ô %d -> %s (ADC: %d)\n", i + 1, slotOccupied[i] ? "CÓ XE ĐỖ" : "TRỐNG", rawVal);
      }
    }
  }

  // Đọc cảm biến lửa và nút bấm khẩn cấp
  bool flameDetected = (digitalRead(PIN_FLAME_DO) == LOW);
  bool emergencyBtnPressed = (digitalRead(PIN_EMERGENCY_BTN) == LOW);
  bool currentFireState = flameDetected || emergencyBtnPressed;

  if (currentFireState && !fireAlarm) {
    fireAlarm = true;
    stateChanged = true;
    Serial.println("[CẢNH BÁO CHÁY] Phát hiện lửa hoặc nút khẩn cấp được kích hoạt!");
  }

  if (stateChanged || (millis() - lastSendStatusTime >= 4000)) {
    sendStatus();
  }
}

// ----------------------------------------------------------------------------
// ĐIỀU KHIỂN CHẤP HÀNH NGOẠI VI (ĐÈN, BƠM, CÒI)
// ----------------------------------------------------------------------------
void updateActuators() {
  // Đèn chiếu sáng
  digitalWrite(PIN_LIGHT, lightState ? HIGH : LOW);

  // Đèn phun nước
  digitalWrite(PIN_LED_PUMP, pumpState ? HIGH : LOW);

  // Cảnh báo cháy: Chớp đèn Đỏ và hú còi
  if (fireAlarm) {
    if (millis() - lastBlinkTime >= 200) {
      lastBlinkTime = millis();
      blinkToggle = !blinkToggle;
      digitalWrite(PIN_LED_FIRE, blinkToggle ? HIGH : LOW);
      digitalWrite(PIN_BUZZER, (buzzerState && blinkToggle) ? HIGH : LOW);
    }
  } else {
    digitalWrite(PIN_LED_FIRE, LOW);
    digitalWrite(PIN_BUZZER, LOW);
  }
}

// ----------------------------------------------------------------------------
// GIAO TIẾP MẠNG SOCKET.IO
// ----------------------------------------------------------------------------
void socketIOEvent(socketIOmessageType_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case sIOtype_DISCONNECT:
      sioConnected = false;
      Serial.println("[SOCKET] Mất kết nối tới Server");
      break;

    case sIOtype_CONNECT:
      sioConnected = true;
      Serial.println("[SOCKET] Kết nối Socket.IO thành công!");
      socketIO.send(sIOtype_CONNECT, "/");

      // Đăng ký định danh thiết bị
      {
        DynamicJsonDocument regDoc(128);
        JsonArray arr = regDoc.to<JsonArray>();
        arr.add("register_device");
        arr.add(DEVICE_ID);
        arr.add(WiFi.localIP().toString());
        String out;
        serializeJson(regDoc, out);
        socketIO.sendEVENT(out);
      }
      sendStatus();
      break;

    case sIOtype_EVENT:
      {
        DynamicJsonDocument doc(512);
        DeserializationError err = deserializeJson(doc, payload, length);
        if (err || !doc.is<JsonArray>()) return;
        JsonArray arr = doc.as<JsonArray>();
        const char* eventName = arr[0] | "";

        if (strcmp(eventName, "zone_command") == 0) {
          JsonObject cmd = arr[1].as<JsonObject>();
          const char* action = cmd["action"] | "";

          if (strcmp(action, "set_light") == 0) {
            lightState = cmd["value"] | false;
            Serial.printf("[LỆNH] Đèn chiếu sáng -> %s\n", lightState ? "BẬT" : "TẮT");
          } else if (strcmp(action, "set_pump") == 0) {
            pumpState = cmd["value"] | false;
            Serial.printf("[LỆNH] Bơm phun nước -> %s\n", pumpState ? "BẬT" : "TẮT");
          } else if (strcmp(action, "fire_alert") == 0) {
            fireAlarm = cmd["value"] | false;
            buzzerState = fireAlarm;
            Serial.println("[LỆNH] BÁO ĐỘNG CHÁY TOÀN BÃI XE!");
          } else if (strcmp(action, "reset_fire") == 0) {
            fireAlarm = false;
            pumpState = false;
            buzzerState = false;
            Serial.println("[LỆNH] Đặt lại hệ thống an toàn (Reset PCCC)");
          }
          sendStatus();
        }
      }
      break;
    default:
      break;
  }
}

// ----------------------------------------------------------------------------
// HỖ TRỢ NẠP WEB OTA (STREAM & PIPE - CHƯƠNG 2)
// ----------------------------------------------------------------------------
void setupOtaServer() {
  otaServer.on("/update", HTTP_POST, []() {
    otaServer.sendHeader("Connection", "close");
    otaServer.send(200, "text/plain", (Update.hasError()) ? "FAIL" : "OK");
    delay(500);
    ESP.restart();
  }, []() {
    HTTPUpload& upload = otaServer.upload();
    if (upload.status == UPLOAD_FILE_START) {
      Serial.printf("[OTA] Nhận luồng Stream firmware: %s\n", upload.filename.c_str());
      if (!Update.begin(UPDATE_SIZE_UNKNOWN)) Update.printError(Serial);
    } else if (upload.status == UPLOAD_FILE_WRITE) {
      if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) Update.printError(Serial);
    } else if (upload.status == UPLOAD_FILE_END) {
      if (Update.end(true)) {
        Serial.printf("[OTA] Nạp hoàn tất: %u bytes. Khởi động lại...\n", upload.totalSize);
      } else {
        Update.printError(Serial);
      }
    }
  });
  otaServer.begin();
  Serial.println("[OTA] Web OTA Server sẵn sàng tại cổng 80");
}

// ----------------------------------------------------------------------------
// SETUP & LOOP
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println("\n==============================================");
  Serial.println("  ESP32 CLIENT KHU B (DÃY 2 - SLOT 4, 5, 6)   ");
  Serial.println("  Học phần: Lập trình mạng (KC321) - ĐHCT    ");
  Serial.println("==============================================\n");

  pinMode(PIN_LDR[0], INPUT);
  pinMode(PIN_LDR[1], INPUT);
  pinMode(PIN_LDR[2], INPUT);
  pinMode(PIN_FLAME_DO, INPUT);
  pinMode(PIN_EMERGENCY_BTN, INPUT_PULLUP);

  pinMode(PIN_LIGHT, OUTPUT);
  pinMode(PIN_LED_FIRE, OUTPUT);
  pinMode(PIN_LED_PUMP, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  digitalWrite(PIN_LIGHT, LOW);
  digitalWrite(PIN_LED_FIRE, LOW);
  digitalWrite(PIN_LED_PUMP, LOW);
  digitalWrite(PIN_BUZZER, LOW);

  // Khởi tạo mức nền baseline ADC
  for (int i = 0; i < 3; i++) {
    baseline[i] = analogRead(PIN_LDR[i]);
  }

  // Kết nối WiFi
  Serial.printf("[WIFI] Đang kết nối tới %s...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 20) {
    delay(500);
    Serial.print(".");
    retry++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Đã kết nối! IP: %s\n", WiFi.localIP().toString().c_str());
    setupOtaServer();

    // Kết nối Socket.IO
    socketIO.begin(SERVER_IP, SERVER_PORT, "/socket.io/?EIO=4");
    socketIO.onEvent(socketIOEvent);
  } else {
    Serial.println("\n[WIFI] Chưa có WiFi. Vẫn xử lý cảm biến Offline.");
  }
}

void loop() {
  otaServer.handleClient();
  socketIO.loop();

  processSensors();
  updateActuators();

  delay(20);
}
