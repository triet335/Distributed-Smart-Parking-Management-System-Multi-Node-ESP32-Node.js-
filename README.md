# 🚗 HỆ THỐNG GIÁM SÁT & QUẢN TRỊ BÃI ĐỖ XE THÔNG MINH PHÂN TÁN
### Distributed Smart Parking Management System (Multi-Node ESP32 & Node.js)

[![Node.js](https://img.shields.io/badge/Node.js-18.x+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.io-4.7.x-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![ESP32](https://img.shields.io/badge/ESP32-Espressif-E7352C?style=for-the-badge&logo=espressif&logoColor=white)](https://www.espressif.com/)
[![PlatformIO](https://img.shields.io/badge/PlatformIO-IDE-orange?style=for-the-badge&logo=platformio&logoColor=white)](https://platformio.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.style=for-the-badge)](LICENSE)

> **Học phần:** Lập trình Mạng (KC321) — Trường Đại học Cần Thơ (CTU)  
> **Giảng viên hướng dẫn:** TS. GVC. Nguyễn Văn Khanh *(PLC & IIoT Lab)*  
> **Nhóm thực hiện (Nhóm 3):**
> 1. **Lê Minh Triết** (B2308335) - *Nhóm trưởng*
> 2. **Thạch Thảo** (B2308327)
> 3. **Trương Đình Trí** (B2308337)
> 4. **Đỗ Thanh Đức** (B2308287)

---

## 📌 1. Giới thiệu tổng quan

Dự án xây dựng mô hình **Hệ thống giám sát và điều hành bãi đỗ xe thông minh theo kiến trúc mạng phân tán (Distributed Architecture)**. Hệ thống kết hợp giữa các trạm biên vi điều khiển **ESP32**, giao tiếp thời gian thực qua **Socket.IO / WebSockets** với máy chủ trung tâm **Node.js**, và giao diện **Web Dashboard** trực quan hóa toàn bộ trạng thái sa bàn bãi xe.

### 🎯 Mục tiêu chính:
- **Tự động hóa cổng ra/vào:** Quẹt thẻ RFID/NFC (PN532), phân quyền xe hợp lệ qua Whitelist, tự động điều khiển thanh chắn Barie (Servo) và còi báo.
- **Giám sát chỗ đỗ thời gian thực:** Cảm biến quang trở (LDR) theo dõi từng vị trí xe, tích hợp thuật toán lọc thích nghi EMA và chống nhiễu người đi bộ.
- **Hệ thống PCCC & Chiếu sáng an toàn:** Tự động kích hoạt còi/đèn báo cháy toàn khu và kích hoạt phun nước dập lửa cục bộ; mở Barie khẩn cấp chỉ với 1 click.
- **Tối ưu hóa tầng truyền vận:** Nén dữ liệu truyền thông xuống **1-Byte Bitmask** (tiết kiệm hơn 98% băng thông mạng) và hỗ trợ nạp firmware không dây **Web OTA qua Stream & Pipe**.

---

## 🌟 2. Ứng dụng 4 trụ cột môn Lập trình Mạng

Dự án áp dụng đầy đủ các kỹ thuật cốt lõi trong chương trình Lập trình Mạng:

1. **Quản lý Client bằng `Map()` trong JavaScript:** Lưu trữ tập trung danh sách Node (`ESP_GATE`, `ESP_ZONE_A`, `ESP_ZONE_B`), trạng thái trực tuyến (online/offline, heartbeat timeout), địa chỉ IP và socket ID.
2. **Socket.IO Rooms phân luồng dữ liệu:**
   - `room_gate`: Xử lý sự kiện ra/vào cổng, quẹt thẻ NFC và điều khiển Barie.
   - `room_zone_A` & `room_zone_B`: Thu nhận dữ liệu cảm biến và gửi lệnh điều khiển thiết bị từng khu đỗ.
   - `room_dashboard`: Broadcast trạng thái bãi xe đến các giao diện Web Dashboard quản trị.
3. **Gói tin nhị phân siêu tối ưu (1-Byte Bitmask Payload):** Đóng gói toàn bộ trạng thái 3 ô đỗ, đèn chiếu sáng, báo cháy, bơm nước và lỗi vào **đúng 1 byte nhị phân** (vẫn có chế độ JSON dự phòng).
4. **Nạp Firmware từ xa Web OTA (Stream & Pipe):** Sử dụng `fs.createReadStream()` với `highWaterMark: 1024` bytes kết hợp đường ống `pipe()` truyền trực tiếp firmware `.bin` lên ESP32 mà không làm nghẽn RAM máy chủ.

---

## 🏗️ 3. Kiến trúc hệ thống

```
                         ┌──────────────────────────────────────────────┐
                         │      NODE.JS / EXPRESS SERVER (Port 3000)    │
                         │  - Quản lý Client (Map), Định tuyến REST API │
                         │  - Socket.IO Rooms & Stream/Pipe Web OTA     │
                         └──────┬──────────────────┬─────────────────┬──┘
                                │                  │                 │
            Socket.IO / JSON    │                  │                 │ 1-Byte Bitmask / JSON
        ┌───────────────────────┘                  │                 └────────────────────────┐
        ▼                                          ▼                                          ▼
┌───────────────────────┐              ┌───────────────────────┐              ┌───────────────────────┐
│     NODE CỔNG         │              │      NODE KHU A       │              │      NODE KHU B       │
│  (ID: ESP_GATE)       │              │  (ID: ESP_ZONE_A)     │              │  (ID: ESP_ZONE_B)     │
│ - PN532 NFC UART      │              │ - 3 LDR (Slot 1, 2, 3)│              │ - 3 LDR (Slot 4, 5, 6)│
│ - Servo SG90 Barie    │              │ - Đèn chiếu sáng      │              │ - Đèn chiếu sáng      │
│ - Buzzer & LDR Cổng   │              │ - Đèn & Còi Báo Cháy  │              │ - Đèn & Còi Báo Cháy  │
└───────────────────────┘              │ - Giả lập Bơm Nước    │              │ - Giả lập Bơm Nước    │
                                       │ - Cảm biến lửa & Nút  │              │ - Cảm biến lửa & Nút  │
                                       └───────────────────────┘              └───────────────────────┘
                                                   ▲                                      ▲
                                                   └──────────────────┬───────────────────┘
                                                        (Mô phỏng mở rộng tải)
                                                       ┌─────────────────────┐
                                                       │  2 VIRTUAL NODES    │
                                                       │  Khu C & Khu D      │
                                                       └─────────────────────┘
```

---

## 🔌 4. Sơ đồ kết nối phần cứng (Pinout)

### 🚪 4.1. Node Cổng (`ESP_GATE` - `esp_client_0`)
| Linh kiện | Chân ESP32 | Chế độ | Chức năng |
| :--- | :---: | :---: | :--- |
| **PN532 SDA (TXD)** | **GPIO 16 (RX2)** | Serial2 UART | Tốc độ 115200 baud, SW1=OFF, SW2=OFF |
| **PN532 SCL (RXD)** | **GPIO 17 (TX2)** | Serial2 UART | Kết nối TX2 ESP32 $\to$ RX PN532 |
| **Servo SG90** | **GPIO 19** | ESP32PWM | Nâng hạ Barie ($0^\circ \to 90^\circ$, tự đóng sau 3.5s) |
| **Còi Buzzer Cổng** | **GPIO 18** | `OUTPUT` | 1 bíp: hợp lệ; 3 bíp: thẻ lạ hoặc hết chỗ |
| **Quang trở LDR Cổng** | **GPIO 34** | `INPUT` (ADC1) | Cầu phân áp $10\text{k}\Omega$, nhận diện ngày/đêm |
| **LED Onboard** | **GPIO 2** | `OUTPUT` | Báo trạng thái WiFi và chớp khi quẹt thẻ |

### 🅿️ 4.2. Node Khu A & Khu B (`ESP_ZONE_A` / `ESP_ZONE_B` - `esp_client_1` & `esp_client_2`)
| Linh kiện | Chân ESP32 | Chế độ | Chức năng |
| :--- | :---: | :---: | :--- |
| **LDR Ô 1 / Ô 4** | **GPIO 34** | `INPUT` (ADC1) | Cảm biến vị trí đỗ 1 (Khu A) hoặc 4 (Khu B) |
| **LDR Ô 2 / Ô 5** | **GPIO 35** | `INPUT` (ADC1) | Cảm biến vị trí đỗ 2 (Khu A) hoặc 5 (Khu B) |
| **LDR Ô 3 / Ô 6** | **GPIO 32** | `INPUT` (ADC1) | Cảm biến vị trí đỗ 3 (Khu A) hoặc 6 (Khu B) |
| **Đèn chiếu sáng khu** | **GPIO 23** | `OUTPUT` | Tự động bật khi trời tối hoặc bật qua Web |
| **Đèn báo cháy (Đỏ)** | **GPIO 13** | `OUTPUT` | Nhấp nháy chu kỳ 200ms khi phát hiện cháy |
| **Đèn phun nước (Xanh)** | **GPIO 14** | `OUTPUT` | Sáng liên tục mô phỏng van phun nước dập lửa |
| **Còi Buzzer báo động** | **GPIO 27** | `OUTPUT` | Hú còi cảnh báo tại chỗ khi có cháy |
| **Cảm biến lửa (Flame DO)** | **GPIO 4** | `INPUT` | Tích cực mức `LOW` khi phát hiện ngọn lửa |
| **Nút bấm khẩn cấp** | **GPIO 25** | `INPUT_PULLUP` | Nhấn nối GND để kích hoạt báo cháy khẩn |

---

## ⚡ 5. Thuật toán xử lý biên (Edge Processing)

Để đảm bảo hệ thống vận hành tin cậy trong môi trường thực tế, firmware ESP32 tích hợp 2 thuật toán:

1. **Chống nhiễu bóng người (Debounce Delay 1.5s - 2.0s):** Khi người đi bộ lướt qua che quang trở, giá trị ADC giảm tức thời $(< 0.5\text{s})$. Hệ thống chỉ xác nhận chuyển trạng thái ô đỗ khi ánh sáng bị che (hoặc sáng lại) **liên tục từ 1.5 đến 2 giây**, triệt tiêu tình trạng nhấp nháy trên giao diện Web.
2. **Đường nền sáng thích nghi EMA (Adaptive Baseline DSP):**
   $$B_t = \alpha \cdot A_t + (1 - \alpha) B_{t-1} \quad (\alpha \approx 0.02)$$
   - Tự động học và thích nghi theo độ sáng thay đổi của phòng học/môi trường.
   - Khi phát hiện xe vào đỗ, hệ thống tự động **đóng băng đường nền (Freeze Baseline)** để không bị kéo tụt theo bóng tối gầm xe.

---

## 📡 6. Cấu trúc gói tin 1-Byte Bitmask

Dữ liệu định kỳ từ Khu A và Khu B được nén thành 1 byte nhị phân truyền qua WebSocket:

| Bit | Trường | Giá trị 0 | Giá trị 1 | Mô tả |
| :---: | :--- | :---: | :---: | :--- |
| **Bit 0** | `SLOT_1` | Trống | Có xe | Trạng thái ô 1 (hoặc ô 4) |
| **Bit 1** | `SLOT_2` | Trống | Có xe | Trạng thái ô 2 (hoặc ô 5) |
| **Bit 2** | `SLOT_3` | Trống | Có xe | Trạng thái ô 3 (hoặc ô 6) |
| **Bit 3** | `LIGHT_STATE` | Tắt | Bật | Trạng thái đèn chiếu sáng |
| **Bit 4** | `FIRE_ALARM` | Bình thường | Báo cháy | Tín hiệu cảm biến lửa / nút khẩn |
| **Bit 5** | `PUMP_STATE` | Tắt | Bơm phun | Trạng thái van phun nước |
| **Bit 6** | `FAULT_FLAG` | Bình thường | Báo lỗi | Cảnh báo lỗi cảm biến/mạng |
| **Bit 7** | `RESERVED` | `0` | `0` | Bit dự phòng |

---

## 📂 7. Cấu trúc thư mục

```plaintext
DOAN_LTM/
├── doc/                        # Tài liệu báo cáo, slide bài giảng, hình ảnh
├── src/
│   ├── websever/               # Máy chủ Node.js & Giao diện Web
│   │   ├── public/
│   │   │   ├── index.html      # Giao diện Web Dashboard quản trị trung tâm
│   │   │   ├── gate.html       # Bảng điện tử hiển thị tại cổng (/gate-display)
│   │   │   ├── app.js          # Logic Socket.IO Client trên trình duyệt
│   │   │   └── style.css       # Giao diện CSS hiện đại (Dark Theme)
│   │   ├── ota_service.js      # Module Web OTA (Stream & Pipe nạp firmware)
│   │   ├── virtual_nodes.js    # Script giả lập 2 Node ảo (Khu C & D) để test tải
│   │   ├── server.js           # Server chính (Express, Socket.IO, Map Devices)
│   │   └── package.json        # Dependencies Node.js
│   └── esp_client/             # Mã nguồn Firmware ESP32 (PlatformIO)
│       ├── esp_client_0/       # Firmware Node Cổng (ESP_GATE)
│       ├── esp_client_1/       # Firmware Node Khu A (ESP_ZONE_A)
│       └── esp_client_2/       # Firmware Node Khu B (ESP_ZONE_B)
├── Y_TUONG_DO_AN_CHI_TIET.md   # Bản đặc tả kỹ thuật chi tiết
└── README.md                   # Tài liệu giới thiệu dự án
```

---

## 🚀 8. Hướng dẫn cài đặt & Chạy dự án

### 📋 Yêu cầu môi trường
- [Node.js](https://nodejs.org/) (khuyến nghị phiên bản 16.x hoặc 18.x trở lên).
- [VS Code](https://code.visualstudio.com/) kèm tiện ích mở rộng [PlatformIO IDE](https://platformio.org/).
- Máy tính và 3 kit ESP32 kết nối cùng một mạng WiFi cục bộ (hoặc phát từ điểm truy cập di động Hotspot).

---

### Bước 1: Khởi động Server Node.js
1. Mở terminal và chuyển vào thư mục `src/websever`:
   ```bash
   cd src/websever
   ```
2. Cài đặt các gói thư viện cần thiết:
   ```bash
   npm install
   ```
3. Khởi động Server:
   ```bash
   npm start
   ```
   Server sẽ lắng nghe tại cổng `3000`. Hãy ghi lại địa chỉ IP mạng nội bộ của máy tính (ví dụ: `192.168.1.100`).

---

### Bước 2: Nạp Firmware cho các Kit ESP32
1. Mở thư mục từng node bằng **VS Code (PlatformIO)**:
   - Node Cổng: `src/esp_client/esp_client_0`
   - Node Khu A: `src/esp_client/esp_client_1`
   - Node Khu B: `src/esp_client/esp_client_2`
2. Mở file `src/main.cpp` của từng dự án và sửa thông số mạng:
   ```cpp
   const char* WIFI_SSID     = "TÊN_WIFI_CỦA_BẠN";
   const char* WIFI_PASSWORD = "MAT_KHAU_WIFI";
   const char* SERVER_IP     = "192.168.1.100"; // Điền đúng IP máy tính chạy server
   const uint16_t SERVER_PORT = 3000;
   ```
3. Cắm cáp Micro-USB và nhấn **Upload** (biểu tượng mũi tên trên thanh PlatformIO) để nạp code.

---

### Bước 3: Truy cập hệ thống & Vận hành
- **Giao diện Dashboard Trung Tâm:** Truy cập trình duyệt tại `http://localhost:3000` (hoặc `http://<IP_SERVER>:3000`).
- **Bảng điện tử tại Cổng:** Truy cập `http://localhost:3000/gate-display`.
- **Chạy mô phỏng tải Virtual Nodes (Tùy chọn):** Mở thêm một terminal mới tại thư mục `src/websever` và chạy:
   ```bash
   npm run sim
   ```
   Lệnh này sẽ khởi chạy 2 Node ảo (Khu C & Khu D) để chứng minh khả năng mở rộng đa cụm node của hệ thống.

---

## 🧪 9. Kịch bản thực nghiệm & Demo đồ án

1. **Khởi động & Bắt tay kết nối:** Khởi động Server $\to$ 3 kit ESP32 tự kết nối WiFi và gia nhập các Room Socket tương ứng $\to$ Dashboard cập nhật trạng thái Online tức thì.
2. **Quy trình Xe Vào/Ra:**
   - Quẹt thẻ NFC hợp lệ $\to$ Còi bíp 1 lần, Barie mở góc $90^\circ$, sau 3.5s tự hạ xuống, số chỗ trống giảm 1.
   - Thử quẹt thẻ không nằm trong Whitelist $\to$ Còi bíp 3 lần, Barie không mở, Web cảnh báo từ chối.
3. **Cảm biến ô đỗ & Chống nhiễu:**
   - Che LDR tại ô 1 $\to$ Sau đúng 1.5s (bộ lọc Debounce xác nhận), ô 1 trên Web chuyển sang màu Đỏ.
4. **Bật đèn thông minh:**
   - Che LDR cổng (giả lập trời tối) $\to$ Tín hiệu `ldrDark: true` kích hoạt tự động đèn chiếu sáng tại cả 2 khu đỗ xe.
5. **Kịch bản PCCC & Thoát hiểm:**
   - Kích hoạt cảm biến lửa hoặc bấm nút khẩn cấp tại Khu A $\to$ Còi hú và đèn đỏ chớp tại CẢ 2 KHU; duy nhất **đèn phun nước Khu A bật**.
   - Trên Web Dashboard bấm nút **"MỞ TOANG BARIE THOÁT HIỂM"** $\to$ Barie giữ nguyên $90^\circ$ cho xe thoát hiểm.
   - Bấm nút **"RESET HỆ THỐNG"** để đưa mọi thiết bị về trạng thái an toàn.
6. **Bắt gói tin Wireshark:** Soi trực tiếp gói tin nhị phân 1-Byte để kiểm chứng hiệu năng tiết kiệm băng thông.
7. **Nâng cấp Web OTA:** Kéo thả firmware `.bin` lên giao diện Web OTA để minh họa nạp code qua luồng Stream/Pipe.

---

## 👥 10. Đóng góp & Bản quyền

Dự án được xây dựng phục vụ học tập và nghiên cứu trong khuôn khổ môn học **Lập trình Mạng (KC321)** tại **Trường Đại học Cần Thơ**.

Mọi đóng góp, báo cáo lỗi hoặc ý tưởng phát triển vui lòng tạo Issue hoặc Pull Request trên kho mã nguồn GitHub này! 🎉
