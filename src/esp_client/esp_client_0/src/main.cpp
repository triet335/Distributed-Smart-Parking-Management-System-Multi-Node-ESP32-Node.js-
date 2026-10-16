/**
 * ============================================================================
 * ĐỒ ÁN LẬP TRÌNH MẠNG (KC321) - ĐẠI HỌC CẦN THƠ
 * GIẢNG VIÊN HƯỚNG DẪN: TS. GVC. NGUYỄN VĂN KHANH (PLC & IIoT LAB)
 * 
 * FIRMWARE NODE CỔNG (ESP32 GATE CLIENT - ID: ESP_GATE)
 * Phần cứng kết nối (đã test chạy chuẩn 100%):
 * - PN532 UART: SDA(TX) -> GPIO 16 (RX2) | SCL(RX) -> GPIO 17 (TX2) (SW1=OFF, SW2=OFF)
 * - Servo SG90: GPIO 19 (Cần Barie)
 * - Buzzer: GPIO 18 (1 bíp hợp lệ, 3 bíp từ chối/đầy bãi)
 * - LDR Cổng: GPIO 34 (ADC1 đo độ sáng ngoài trời)
 * - LED Onboard: GPIO 2
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <SocketIOclient.h>
#include <WebServer.h>
#include <Update.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ----------------------------------------------------------------------------
// CẤU HÌNH WIFI & MÁY CHỦ (Thay đổi theo mạng WiFi thực tế khi chạy thử)
// ----------------------------------------------------------------------------
const char* WIFI_SSID     = "CTU_STUDENT";     // Tên WiFi
const char* WIFI_PASSWORD = "";                // Mật khẩu WiFi
const char* SERVER_IP     = "192.168.1.100";   // IP máy tính chạy Server Node.js
const uint16_t SERVER_PORT = 3000;
const char* DEVICE_ID     = "ESP_GATE";

// ----------------------------------------------------------------------------
// SƠ ĐỒ CHÂN NGOẠI VI
// ----------------------------------------------------------------------------
#define PIN_PN532_RX      16  // ESP32 RX2 <-- SDA (TXD) của PN532
#define PIN_PN532_TX      17  // ESP32 TX2 --> SCL (RXD) của PN532
#define PIN_SERVO         19
#define PIN_BUZZER        18
#define PIN_LDR_GATE      34  // ADC1_CH6 an toàn khi bật WiFi
#define PIN_LED_ONBOARD   2

#define SERVO_CLOSE_ANGLE 0
#define SERVO_OPEN_ANGLE  90
#define SERVO_MIN_PULSE_US 500
#define SERVO_MAX_PULSE_US 2400
#define BARIE_HOLD_TIME_MS 3500

Servo barieServo;
SocketIOclient socketIO;
WebServer otaServer(80);

// Biến trạng thái
bool nfcReady = false;
bool isBarieOpen = false;
bool isEmergencyHold = false;
unsigned long barieOpenTime = 0;

bool isWaitingForCard = false;
unsigned long lastPollStartTime = 0;
unsigned long lastSeenCardTime = 0;
bool cardStillPresent = false;

bool lastLdrDark = false;
unsigned long lastLdrCheckTime = 0;
bool sioConnected = false;

portMUX_TYPE barieMux = portMUX_INITIALIZER_UNLOCKED;

// ============================================================================
// BỘ ĐIỀU KHIỂN PN532 HSU (UART) NON-BLOCKING (Kế thừa từ test_linh_kien)
// ============================================================================

void pn532AbortAndFlush() {
  const uint8_t wakeAndAck[] = {
    0x55, 0x55, 0x00, 0x00, 0x00,
    0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00
  };
  Serial2.write(wakeAndAck, sizeof(wakeAndAck));
  Serial2.flush();
  delay(15);
  while (Serial2.available()) Serial2.read();
  isWaitingForCard = false;
}

bool pn532SendCommand(const uint8_t *cmd, uint8_t cmdlen) {
  while (Serial2.available()) Serial2.read();
  uint8_t len = cmdlen + 1;
  uint8_t lcs = (~len) + 1;

  uint8_t header[] = {0x55, 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, len, lcs, 0xD4};
  Serial2.write(header, sizeof(header));

  uint8_t sum = 0xD4;
  for (uint8_t i = 0; i < cmdlen; i++) {
    Serial2.write(cmd[i]);
    sum += cmd[i];
  }
  uint8_t dcs = (~sum) + 1;
  uint8_t postamble[] = {dcs, 0x00};
  Serial2.write(postamble, sizeof(postamble));
  Serial2.flush();

  uint8_t ackBuf[6] = {0};
  uint8_t idx = 0;
  unsigned long start = millis();
  while (millis() - start < 50) {
    if (Serial2.available()) {
      uint8_t b = Serial2.read();
      if (idx < 6) ackBuf[idx++] = b;
      if (idx == 6) {
        if (ackBuf[0] == 0x00 && ackBuf[1] == 0x00 && ackBuf[2] == 0xFF &&
            ackBuf[3] == 0x00 && ackBuf[4] == 0xFF && ackBuf[5] == 0x00) {
          return true;
        }
        for (int i = 0; i < 5; i++) ackBuf[i] = ackBuf[i + 1];
        idx = 5;
      }
    }
  }
  return false;
}

int pn532ReadResponse(uint8_t *buf, uint8_t maxLen, uint16_t timeoutMs) {
  unsigned long start = millis();
  uint8_t state = 0;
  uint8_t frameLen = 0;
  uint8_t count = 0;

  while (millis() - start < timeoutMs) {
    if (Serial2.available()) {
      uint8_t b = Serial2.read();
      switch (state) {
        case 0: if (b == 0x00) state = 1; break;
        case 1: if (b == 0xFF) state = 2; else if (b != 0x00) state = 0; break;
        case 2: frameLen = b; state = 3; break;
        case 3:
          if ((uint8_t)(frameLen + b) == 0x00 && frameLen > 0) {
            state = 4;
            count = 0;
          } else {
            state = 0;
          }
          break;
        case 4:
          if (count < maxLen) buf[count] = b;
          count++;
          if (count >= frameLen) state = 5;
          break;
        case 5:
          return count;
      }
    }
  }
  return -1;
}

bool initPN532_Fast() {
  for (int attempt = 1; attempt <= 5; attempt++) {
    pn532AbortAndFlush();
    delay(30);

    const uint8_t cmdVer[] = {0x02};
    if (!pn532SendCommand(cmdVer, sizeof(cmdVer))) continue;

    uint8_t resp[16];
    int n = pn532ReadResponse(resp, sizeof(resp), 100);
    if (n >= 6 && resp[0] == 0xD5 && resp[1] == 0x03) {
      Serial.printf("[NFC] Đã nhận diện PN5%02X | Firmware: %d.%d\n", resp[2], resp[3], resp[4]);

      const uint8_t cmdSAM[] = {0x14, 0x01, 0x14, 0x01};
      pn532SendCommand(cmdSAM, sizeof(cmdSAM));
      pn532ReadResponse(resp, sizeof(resp), 100);

      const uint8_t cmdRetries[] = {0x32, 0x05, 0xFF, 0x01, 0xFF};
      pn532SendCommand(cmdRetries, sizeof(cmdRetries));
      pn532ReadResponse(resp, sizeof(resp), 100);

      return true;
    }
    delay(100);
  }
  return false;
}

void startContinuousCardListen() {
  const uint8_t cmdListen[] = {0x4A, 0x01, 0x00};
  if (pn532SendCommand(cmdListen, sizeof(cmdListen))) {
    isWaitingForCard = true;
    lastPollStartTime = millis();
  } else {
    pn532AbortAndFlush();
  }
}

bool checkCardArrived(uint8_t *uid, uint8_t *uidLen) {
  if (!isWaitingForCard) {
    startContinuousCardListen();
    return false;
  }
  if (millis() - lastPollStartTime > 4000) {
    pn532AbortAndFlush();
    startContinuousCardListen();
    return false;
  }
  if (Serial2.available() < 6) return false;

  uint8_t resp[32];
  int n = pn532ReadResponse(resp, sizeof(resp), 40);
  isWaitingForCard = false;

  if (n >= 12 && resp[0] == 0xD5 && resp[1] == 0x4B && resp[2] >= 1) {
    uint8_t len = resp[7];
    if (len > 0 && len <= 7 && (8 + len <= n)) {
      *uidLen = len;
      for (uint8_t i = 0; i < len; i++) uid[i] = resp[8 + i];
      return true;
    }
  }
  pn532AbortAndFlush();
  return false;
}

// ============================================================================
// ĐIỀU KHIỂN BARIE & CÒI BUZZER
// ============================================================================

void openBarie() {
  portENTER_CRITICAL(&barieMux);
  barieOpenTime = millis();
  isBarieOpen = true;
  portEXIT_CRITICAL(&barieMux);

  barieServo.write(SERVO_OPEN_ANGLE);
  Serial.println("[BARIE] >> Đang MỞ (90 độ)...");
}

void closeBarie() {
  if (isEmergencyHold) return; // Nếu đang mở khẩn cấp thì không đóng
  portENTER_CRITICAL(&barieMux);
  isBarieOpen = false;
  portEXIT_CRITICAL(&barieMux);

  barieServo.write(SERVO_CLOSE_ANGLE);
  Serial.println("[BARIE] << Đã ĐÓNG (0 độ).");
}

void beepSuccess() {
  digitalWrite(PIN_BUZZER, HIGH);
  delay(100);
  digitalWrite(PIN_BUZZER, LOW);
}

void beepReject() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(80);
    digitalWrite(PIN_BUZZER, LOW);
    delay(80);
  }
}

// ============================================================================
// GIAO TIẾP MẠNG SOCKET.IO (Slide C3 Thầy Khanh)
// ============================================================================

void sendSocketEvent(const char* eventName, JsonDocument& doc) {
  if (!sioConnected) return;
  DynamicJsonDocument eventDoc(512);
  JsonArray arr = eventDoc.to<JsonArray>();
  arr.add(eventName);
  arr.add(doc.as<JsonObject>());
  String output;
  serializeJson(eventDoc, output);
  socketIO.sendEVENT(output);
}

void socketIOEvent(socketIOmessageType_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case sIOtype_DISCONNECT:
      sioConnected = false;
      Serial.println("[SOCKET] Mất kết nối tới Server");
      digitalWrite(PIN_LED_ONBOARD, LOW);
      break;

    case sIOtype_CONNECT:
      sioConnected = true;
      Serial.println("[SOCKET] Đã kết nối Socket.IO thành công!");
      digitalWrite(PIN_LED_ONBOARD, HIGH);
      socketIO.send(sIOtype_CONNECT, "/");

      // Đăng ký định danh thiết bị ESP_GATE
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
      break;

    case sIOtype_EVENT:
      {
        DynamicJsonDocument doc(512);
        DeserializationError err = deserializeJson(doc, payload, length);
        if (err || !doc.is<JsonArray>()) return;
        JsonArray arr = doc.as<JsonArray>();
        const char* eventName = arr[0] | "";

        if (strcmp(eventName, "gate_command") == 0) {
          JsonObject cmd = arr[1].as<JsonObject>();
          const char* action = cmd["action"] | "";
          Serial.printf("[LỆNH SERVER] Action: %s\n", action);

          if (strcmp(action, "open_barie") == 0) {
            openBarie();
            beepSuccess();
          } else if (strcmp(action, "close_barie") == 0) {
            isEmergencyHold = false;
            closeBarie();
          } else if (strcmp(action, "emergency_open") == 0) {
            isEmergencyHold = true;
            openBarie();
            Serial.println("[BARIE] MỞ TOANG KHẨN CẤP THOÁT HIỂM!");
          } else if (strcmp(action, "reject") == 0 || strcmp(action, "full_reject") == 0) {
            beepReject();
          }
        }
      }
      break;
    default:
      break;
  }
}

// ============================================================================
// HỖ TRỢ NẠP WEB OTA (STREAM & PIPE - CHƯƠNG 2)
// ============================================================================

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
      if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
        Update.printError(Serial);
      }
    } else if (upload.status == UPLOAD_FILE_WRITE) {
      if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
        Update.printError(Serial);
      }
    } else if (upload.status == UPLOAD_FILE_END) {
      if (Update.end(true)) {
        Serial.printf("[OTA] Nạp hoàn tất: %u bytes. Đang khởi động lại...\n", upload.totalSize);
      } else {
        Update.printError(Serial);
      }
    }
  });
  otaServer.begin();
  Serial.println("[OTA] Web OTA Server đã sẵn sàng tại cổng 80");
}

// ============================================================================
// SETUP & LOOP
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println("\n==============================================");
  Serial.println("  ESP32 NODE CỔNG (BARIE + PN532 + LDR)      ");
  Serial.println("  Học phần: Lập trình mạng (KC321) - ĐHCT    ");
  Serial.println("==============================================\n");

  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_ONBOARD, OUTPUT);
  pinMode(PIN_LDR_GATE, INPUT);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_ONBOARD, LOW);

  // Khởi động PN532
  Serial2.begin(115200, SERIAL_8N1, PIN_PN532_RX, PIN_PN532_TX);
  delay(50);
  nfcReady = initPN532_Fast();
  if (nfcReady) {
    startContinuousCardListen();
    Serial.println("[NFC] PN532 UART sẵn sàng quét thẻ!");
  } else {
    Serial.println("[NFC] [LỖI] Không tìm thấy PN532! Kiểm tra công tắc SW1, SW2!");
  }

  // Khởi động Servo Barie
  ESP32PWM::allocateTimer(0);
  barieServo.setPeriodHertz(50);
  barieServo.attach(PIN_SERVO, SERVO_MIN_PULSE_US, SERVO_MAX_PULSE_US);
  barieServo.write(SERVO_CLOSE_ANGLE);

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
    Serial.println("\n[WIFI] Chưa kết nối được WiFi. Tiếp tục chạy chế độ Offline.");
  }
}

void loop() {
  otaServer.handleClient();
  socketIO.loop();

  // 1. Tự động đóng Barie sau 3.5s (nếu không mở khẩn cấp)
  if (isBarieOpen && !isEmergencyHold && (millis() - barieOpenTime >= BARIE_HOLD_TIME_MS)) {
    closeBarie();
  }

  // 2. Đọc cảm biến ánh sáng LDR Cổng (Kiểm tra mỗi 2 giây)
  if (millis() - lastLdrCheckTime >= 2000) {
    lastLdrCheckTime = millis();
    int ldrVal = analogRead(PIN_LDR_GATE);
    bool isDark = (ldrVal < 1800);

    if (isDark != lastLdrDark) {
      lastLdrDark = isDark;
      Serial.printf("[LDR CỔNG] %s (ADC: %d)\n", isDark ? "TRỜI TỐI" : "TRỜI SÁNG", ldrVal);

      // Gửi sự kiện cập nhật độ sáng lên Server
      if (sioConnected) {
        DynamicJsonDocument doc(128);
        doc["ldrDark"] = isDark;
        doc["barieState"] = isBarieOpen ? "opened" : "closed";
        sendSocketEvent("gate_event", doc);
      }
    }
  }

  // 3. Quét thẻ NFC
  if (nfcReady) {
    uint8_t uid[7] = {0};
    uint8_t uidLen = 0;

    if (checkCardArrived(uid, &uidLen)) {
      lastSeenCardTime = millis();

      if (!cardStillPresent) {
        cardStillPresent = true;

        // Chuyển UID thành chuỗi Hex (ví dụ "1A2B3C4D")
        char uidStr[20] = "";
        for (uint8_t i = 0; i < uidLen; i++) {
          char hexByte[3];
          sprintf(hexByte, "%02X", uid[i]);
          strcat(uidStr, hexByte);
        }

        Serial.printf("\n>>> QUẸT THẺ NFC THÀNH CÔNG: [%s] <<<\n", uidStr);

        // Gửi sự kiện quẹt thẻ lên Server để kiểm tra Whitelist và Chỗ trống
        if (sioConnected) {
          DynamicJsonDocument doc(256);
          doc["uid"] = uidStr;
          doc["ldrDark"] = lastLdrDark;
          doc["barieState"] = isBarieOpen ? "opened" : "closed";
          sendSocketEvent("gate_event", doc);
        } else {
          // Chế độ Offline tạm thời khi mất mạng: Vẫn cho mở Barie
          openBarie();
          beepSuccess();
        }
      } else {
        // Thẻ vẫn giữ trên đầu đọc: duy trì thời gian mở barie
        if (isBarieOpen && !isEmergencyHold) {
          portENTER_CRITICAL(&barieMux);
          barieOpenTime = millis();
          portEXIT_CRITICAL(&barieMux);
        }
      }

      delay(150);
      startContinuousCardListen();
    } else {
      // Đã rút thẻ ra khỏi đầu đọc sau 400ms không thấy phản hồi
      if (cardStillPresent && (millis() - lastSeenCardTime > 400)) {
        cardStillPresent = false;
        Serial.println("[NFC] Đã rút thẻ ra. Sẵn sàng cho lượt tiếp theo.");
      }
    }
  }

  delay(5);
}
