#include <Arduino.h>
#include <ESP32Servo.h>

/* ====================================================================
 * SƠ ĐỒ ĐẤU DÂY ESP32 (GIỮ NGUYÊN 100%)
 * - Cảm biến lửa DO : GPIO 4
 * - Buzzer          : GPIO 18
 * - Servo           : GPIO 19
 * - LED Onboard     : GPIO 2
 * - PN532 UART      : SDA(TX) -> GPIO 16 (RX2) | SCL(RX) -> GPIO 17 (TX2)
 *   (Gạt cả 2 công tắc trên PN532 về OFF: SW1=OFF, SW2=OFF)
 * ==================================================================== */

#define PIN_FLAME_DO      4
#define PIN_BUZZER        18
#define PIN_SERVO         19
#define PIN_LED_ONBOARD   2

#define PIN_PN532_RX      16  // ESP32 RX2 <-- SDA (TXD) của PN532
#define PIN_PN532_TX      17  // ESP32 TX2 --> SCL (RXD) của PN532

#define SERVO_CLOSE_ANGLE 0
#define SERVO_OPEN_ANGLE  90
#define SERVO_MIN_PULSE_US 500
#define SERVO_MAX_PULSE_US 2400

// Thời gian giữ Barie mở (3500ms = 3.5 giây)
#define BARIE_HOLD_TIME_MS 3500

Servo barieServo;

bool nfcReady = false;
volatile bool isFireAlarm = false;
volatile unsigned long barieOpenTime = 0;
volatile bool isBarieOpen = false;

// Quản lý trạng thái PN532 bất đồng bộ & Chống đọc lặp khi chưa rút thẻ
bool isWaitingForCard = false;
unsigned long lastPollStartTime = 0;
unsigned long lastSeenCardTime = 0;  // Thời điểm cuối cùng thẻ còn nằm trên đầu đọc
bool cardStillPresent = false;       // Cờ đánh dấu thẻ vẫn chưa được rút ra

portMUX_TYPE barieMux = portMUX_INITIALIZER_UNLOCKED;

// ====================================================================
// BỘ ĐIỀU KHIỂN PN532 HSU TRỰC TIẾP
// ====================================================================

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
        case 2:
          frameLen = b;
          state = 3;
          break;
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
      Serial.printf("[NFC] [OK] Đã nhận diện chip PN5%02X | Firmware: %d.%d\n", resp[2], resp[3], resp[4]);

      const uint8_t cmdSAM[] = {0x14, 0x01, 0x14, 0x01};
      pn532SendCommand(cmdSAM, sizeof(cmdSAM));
      pn532ReadResponse(resp, sizeof(resp), 100);

      // Giữ sóng RF liên tục để bắt thẻ nhạy tức thì
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

  if (Serial2.available() < 6) {
    return false;
  }

  uint8_t resp[32];
  int n = pn532ReadResponse(resp, sizeof(resp), 40);
  isWaitingForCard = false;

  if (n >= 12 && resp[0] == 0xD5 && resp[1] == 0x4B && resp[2] >= 1) {
    uint8_t len = resp[7];
    if (len > 0 && len <= 7 && (8 + len <= n)) {
      *uidLen = len;
      for (uint8_t i = 0; i < len; i++) {
        uid[i] = resp[8 + i];
      }
      return true; // Lưu ý: Không gọi startContinuousCardListen() ngay tại đây nữa
    }
  }

  pn532AbortAndFlush();
  return false;
}

// ====================================================================
// ĐIỀU KHIỂN BARIE, CÒI & CẢM BIẾN LỬA
// ====================================================================

void openBarie() {
  portENTER_CRITICAL(&barieMux);
  barieOpenTime = millis();
  bool needOpen = !isBarieOpen;
  isBarieOpen = true;
  portEXIT_CRITICAL(&barieMux);

  barieServo.write(SERVO_OPEN_ANGLE);

  if (needOpen) {
    Serial.println("[BARIE] >> Cần gạt ĐANG MỞ (Góc 90 độ)...");
  }
}

void closeBarie() {
  portENTER_CRITICAL(&barieMux);
  bool needClose = isBarieOpen;
  isBarieOpen = false;
  portEXIT_CRITICAL(&barieMux);

  if (needClose) {
    barieServo.write(SERVO_CLOSE_ANGLE);
    Serial.println("[BARIE] << Cần gạt ĐÃ ĐÓNG (Góc 0 độ).");
  }
}

void beepSuccess() {
  if (!isFireAlarm) {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(80);
    digitalWrite(PIN_BUZZER, LOW);
  }
}

void flameTask(void *pvParameters) {
  unsigned long lastPrint = 0;
  bool buzzerState = false;

  while (true) {
    int flame = digitalRead(PIN_FLAME_DO);

    if (flame == LOW) {
      if (!isFireAlarm) {
        isFireAlarm = true;
        Serial.println("\n[CẢNH BÁO CHÁY!] Có lửa! Mở khẩn cấp Barie & Hú còi báo động!");
        openBarie();
      }
      digitalWrite(PIN_LED_ONBOARD, HIGH);
      buzzerState = !buzzerState;
      digitalWrite(PIN_BUZZER, buzzerState ? HIGH : LOW);
      vTaskDelay(pdMS_TO_TICKS(120));
    } else {
      if (isFireAlarm) {
        isFireAlarm = false;
        digitalWrite(PIN_BUZZER, LOW);
        digitalWrite(PIN_LED_ONBOARD, LOW);
        Serial.println("[HỆ THỐNG] Đã an toàn, hết lửa. Đang đóng Barie...");
        closeBarie();
      }

      if (millis() - lastPrint >= 3000) {
        lastPrint = millis();
        Serial.println("[Cảm biến lửa] Bình thường (Không có lửa)");
      }
      vTaskDelay(pdMS_TO_TICKS(150));
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println("\n========================================");
  Serial.println("  HỆ THỐNG BARIE THÔNG MINH & BÁO CHÁY  ");
  Serial.println("  - Chế độ NFC : 1 CHẠM - CHỐNG ĐỌC LẶP ");
  Serial.println("========================================\n");

  pinMode(PIN_FLAME_DO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_ONBOARD, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_ONBOARD, LOW);

  Serial2.begin(115200, SERIAL_8N1, PIN_PN532_RX, PIN_PN532_TX);
  delay(50);

  Serial.println("[NFC] Đang đồng bộ với PN532...");
  nfcReady = initPN532_Fast();

  if (!nfcReady) {
    Serial.println("[NFC] [LỖI] Không giao tiếp được với PN532 qua UART!");
  } else {
    startContinuousCardListen();
    Serial.println("[NFC] [SẴN SÀNG] Chạm thẻ mở ngay - Giữ thẻ không bị kêu lặp!");
  }

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  barieServo.setPeriodHertz(50);

  int ch = barieServo.attach(PIN_SERVO, SERVO_MIN_PULSE_US, SERVO_MAX_PULSE_US);
  Serial.printf("[SERVO] Gán chân GPIO %d vào PWM channel %d\n", PIN_SERVO, ch);
  barieServo.write(SERVO_CLOSE_ANGLE);

  xTaskCreatePinnedToCore(flameTask, "FlameTask", 2048, NULL, 1, NULL, 0);

  Serial.println("\n>>> HỆ THỐNG ĐÃ SẴN SÀNG HOẠT ĐỘNG! <<<\n");
}

void loop() {
  // 1. Lệnh điều khiển từ Serial Monitor
  if (Serial.available() > 0) {
    char cmd = Serial.read();
    if (cmd == 'o' || cmd == '1') {
      Serial.println("[LỆNH SERIAL] Yêu cầu MỞ Barie!");
      openBarie();
    } else if (cmd == 'c' || cmd == '0') {
      Serial.println("[LỆNH SERIAL] Yêu cầu ĐÓNG Barie!");
      closeBarie();
    }
  }

  // 2. Tự động đóng Barie sau 3.5 giây (Tính từ lúc thẻ đã được rút ra)
  if (isBarieOpen && !isFireAlarm && (millis() - barieOpenTime >= BARIE_HOLD_TIME_MS)) {
    Serial.println("[BARIE] Hết thời gian chờ (3.5s) -> Tự động đóng lại.");
    closeBarie();
  }

  // 3. Xử lý đọc thẻ NFC
  if (!nfcReady || isFireAlarm) {
    delay(20);
    return;
  }

  uint8_t uid[7] = {0};
  uint8_t uidLength = 0;

  if (checkCardArrived(uid, &uidLength)) {
    // Ghi nhận thẻ vẫn đang nằm trong vùng sóng
    lastSeenCardTime = millis();

    if (!cardStillPresent) {
      // ĐÂY LÀ LẦN CHẠM MỚI ĐẦU TIÊN (sau khi đã rút thẻ cũ ra)
      cardStillPresent = true;

      // 1. Mở Barie ngay lập tức
      openBarie();

      // 2. Kêu Bíp đúng 1 lần duy nhất
      beepSuccess();

      // 3. In thông tin đúng 1 lần duy nhất
      Serial.println("\n****************************************");
      Serial.println(">>> [HỢP LỆ] ĐÃ QUẸT THẺ NFC THÀNH CÔNG! <<<");
      Serial.printf("Độ dài UID: %d bytes | Mã UID: ", uidLength);
      for (uint8_t i = 0; i < uidLength; i++) {
        if (uid[i] < 0x10) Serial.print("0");
        Serial.print(uid[i], HEX);
        if (i < uidLength - 1) Serial.print(":");
      }
      Serial.println("\n****************************************");
    } else {
      // Nếu người dùng VẪN GIỮ THẺ trên đầu đọc chưa rút ra:
      // Không in lại Serial, không kêu Bíp lại, chỉ âm thầm giữ cho Barie không đóng xuống
      portENTER_CRITICAL(&barieMux);
      barieOpenTime = millis();
      portEXIT_CRITICAL(&barieMux);
    }

    // Nghỉ 150ms rồi mới hỏi lại PN532 để kiểm tra xem thẻ đã được rút ra chưa
    delay(150);
    startContinuousCardListen();

  } else {
    // Nếu đang ở trạng thái "có thẻ" nhưng suốt 400ms vừa qua PN532 không thấy thẻ phản hồi nữa
    // => Người dùng ĐÃ RÚT THẺ RA KHỎI ĐẦU ĐỌC!
    if (cardStillPresent && (millis() - lastSeenCardTime > 400)) {
      cardStillPresent = false;
      Serial.println("[NFC] Đã lấy thẻ ra khỏi đầu đọc. Sẵn sàng cho lượt quẹt mới.");
    }
  }

  delay(5);
}