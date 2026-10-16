#include <Arduino.h>
#include <WiFi.h>
#include <SocketIOclient.h>  // Socket.IO client, KHONG phai WebSocketsClient thuan
#include <ArduinoJson.h>

// THAY DOI 3 GIA TRI NAY THEO WIFI VA MAY CHAY NODE.JS
const char* WIFI_SSID = "12";
const char* WIFI_PASSWORD = "thaocony";
const char* SERVER_IP = "10.65.82.96";
const uint16_t SERVER_PORT = 3000;
const char* DEVICE_ID = "ESP32_004";

// Hang 4: 3 LDR = 3 cho do, ADC1: GPIO34, 35, 32.
const uint8_t LDR_PINS[3] = {34, 35, 32};
const uint8_t FIRE_PIN = 25;       // 1 = co chay; bat buoc co muc LOW on dinh khi khong chay
const uint8_t RELAY_PIN = 26;     // Relay active-HIGH (dung theo yeu cau demo)
const uint8_t BUZZER_LED_PIN = 27; // LED thay buzzer, nhap nhay 500ms

// GIA TRI MAU, PHAI DO ADC THUC TE DE HIEU CHINH.
// Sang: dien ap ADC cao; xe che: dien ap ADC thap.
// Co hysteresis de tranh chong chanh khi gan nguong.
const int ADC_OCCUPIED_BELOW = 1700;
const int ADC_FREE_ABOVE = 2200;

SocketIOclient socketIO;
int8_t slots[3] = {-1, -1, -1}; // -1 chua ro, 0 trong, 1 co xe
bool fireNow = false;
bool blinkOn = false;
bool sioConnected = false;
bool sioStarted = false;
unsigned long lastBlink = 0;
unsigned long lastSend = 0;
unsigned long lastWifiRetry = 0;
unsigned long lastAdcPrint = 0;

// SocketIOclient gui payload dang JSON array: ["ten_su_kien", du_lieu]
void sendEventWithObject(const char* eventName, JsonDocument& data) {
  if (!sioConnected || WiFi.status() != WL_CONNECTED) return;
  DynamicJsonDocument eventDoc(512);
  JsonArray arr = eventDoc.to<JsonArray>();
  arr.add(eventName);
  arr.add(data.as<JsonObject>());
  String output;
  serializeJson(eventDoc, output);
  socketIO.sendEVENT(output);
}

void sendStatus() {
  DynamicJsonDocument doc(256);
  JsonObject obj = doc.to<JsonObject>();
  JsonArray a = obj.createNestedArray("slots");
  for (int i = 0; i < 3; i++) {
    if (slots[i] == -1) a.add((const char*)nullptr); // JSON null
    else a.add(slots[i]);
  }
  obj["fire"] = fireNow;
  obj["relay"] = fireNow;  // GPIO26 = HIGH neu fireNow = true
  obj["buzzer"] = blinkOn;
  sendEventWithObject("status", doc);
  lastSend = millis();
}

void replyControl(const char* message) {
  DynamicJsonDocument doc(128);
  doc["message"] = message;
  sendEventWithObject("control_reply", doc);
}

void socketEvent(socketIOmessageType_t type, uint8_t* payload, size_t length) {
  if (type == sIOtype_DISCONNECT) {
    sioConnected = false;
    Serial.println("[SOCKET] Mat ket noi");
    return;
  }
  if (type == sIOtype_CONNECT) {
    Serial.println("[SOCKET] Da mo ket noi Socket.IO");
    // Ket noi vao namespace mac dinh, Socket.IO 2.x / Engine.IO 3.
    socketIO.send(sIOtype_CONNECT, "/");
    sioConnected = true;

    DynamicJsonDocument registerDoc(128);
    JsonArray arr = registerDoc.to<JsonArray>();
    arr.add("register_device");
    arr.add(DEVICE_ID);
    String output;
    serializeJson(registerDoc, output);
    socketIO.sendEVENT(output);
    Serial.print("[REGISTER] ");
    Serial.println(DEVICE_ID);
    sendStatus();
    return;
  }
  if (type != sIOtype_EVENT) return;

  DynamicJsonDocument doc(512);
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err || !doc.is<JsonArray>()) return;
  JsonArray arr = doc.as<JsonArray>();
  const char* eventName = arr[0] | "";
  if (strcmp(eventName, "control") != 0) return;
  JsonObject cmd = arr[1].as<JsonObject>();
  const char* action = cmd["action"] | "";
  if (strcmp(action, "request_status") == 0) {
    Serial.println("[ROOM] Nhan request_status RIENG cho ESP32_004");
    replyControl("Hang 4 da nhan request_status");
    sendStatus();
  }
}

int readAdcAverage(uint8_t pin) {
  int32_t sum = 0;
  for (int i = 0; i < 6; i++) sum += analogRead(pin);
  return (int)(sum / 6);
}

void readParkingSlots(bool& changed) {
  for (int i = 0; i < 3; i++) {
    int adc = readAdcAverage(LDR_PINS[i]);
    int8_t next = slots[i];
    if (adc < ADC_OCCUPIED_BELOW) next = 1;
    else if (adc > ADC_FREE_ABOVE) next = 0;
    // O giua 2 nguong thi GIU trang thai cu de tranh rung.
    if (next != slots[i]) {
      slots[i] = next;
      changed = true;
    }
    if (millis() - lastAdcPrint >= 2000) {
      Serial.printf("Slot%d GPIO%d ADC=%d state=%d\n", i + 1, LDR_PINS[i], adc, slots[i]);
    }
  }
  if (millis() - lastAdcPrint >= 2000) lastAdcPrint = millis();
}

void updateFireAndOutputs(bool& changed) {
  bool current = (digitalRead(FIRE_PIN) == HIGH);
  if (current != fireNow) {
    fireNow = current;
    changed = true;
    Serial.println(fireNow ? "!!! BAO CHAY HANG 1 !!!" : "Hang 4 an toan");
    lastBlink = millis();
    blinkOn = false;
  }
  // Dieu khien LOCAL, khong phu thuoc WiFi / Server.
  digitalWrite(RELAY_PIN, fireNow ? HIGH : LOW);
  if (fireNow) {
    if (millis() - lastBlink >= 500) {
      blinkOn = !blinkOn;
      lastBlink = millis();
    }
  } else {
    blinkOn = false;
  }
  digitalWrite(BUZZER_LED_PIN, blinkOn ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(FIRE_PIN, INPUT); // Can mach keo xuong ngoai khi cam bien khong xuat HIGH
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_LED_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  digitalWrite(BUZZER_LED_PIN, LOW);
  analogReadResolution(12);
  for (uint8_t pin : LDR_PINS) analogSetPinAttenuation(pin, ADC_11db);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  socketIO.onEvent(socketEvent);
  socketIO.setReconnectInterval(3000);
  Serial.println("Hang 4 khoi dong; van xu ly bao chay khi mat mang.");
}

void loop() {
  bool changed = false;
  updateFireAndOutputs(changed);
  readParkingSlots(changed);

  if (WiFi.status() == WL_CONNECTED) {
    if (!sioStarted) {
      Serial.print("WiFi OK. Dia chi ESP32: ");
      Serial.println(WiFi.localIP());
      // Socket.IO 2.4.1 dung Engine.IO v3 (EIO=3).
      socketIO.begin(SERVER_IP, SERVER_PORT, "/socket.io/?EIO=3");
      sioStarted = true;
    }
    socketIO.loop();
    if (sioConnected && (changed || millis() - lastSend >= 5000)) {
      sendStatus();
    }
  } else {
    sioConnected = false;
    if (millis() - lastWifiRetry >= 7000) {
      lastWifiRetry = millis();
      WiFi.reconnect();
    }
  }
  delay(20);
}
