# BẢN ĐẶC TẢ Ý TƯỞNG & THIẾT KẾ ĐỒ ÁN CHI TIẾT
## ĐỀ TÀI: HỆ THỐNG GIÁM SÁT & QUẢN TRỊ BÃI ĐỖ XE THÔNG MINH PHÂN TÁN (MULTI-NODE ESP32)
**Học phần:** Lập trình Mạng (KC321) — Trường Đại học Cần Thơ  
**Giảng viên hướng dẫn:** TS. GVC. Nguyễn Văn Khanh (PLC & IIoT Lab)  
**Nhóm sinh viên thực hiện (Nhóm 3):**
1. Lê Minh Triết (MSSV: B2308335) - Nhóm trưởng
2. Thạch Thảo (MSSV: B2308327)
3. Trương Đình Trí (MSSV: B2308337)
4. Đỗ Thanh Đức (MSSV: B2308287)

---

## 1. TỔNG QUAN HỆ THỐNG & MÔ HÌNH PHÂN TÁN

Hệ thống được thiết kế theo kiến trúc **Mạng phân tán (Distributed Architecture)** gồm 3 Kit vi điều khiển ESP32 vật lý, 1 Máy chủ trung tâm (Node.js Server) và 2 Node ảo mở rộng:

```
                            [ NODE.JS / EXPRESS WEB SERVER (Port 3000) ]
                             - Map() quản lý danh sách thiết bị
                             - Socket.IO Rooms: room_gate, room_zone_A, room_zone_B, room_dashboard
                             - Stream & Pipe Web OTA (Tách module độc lập)
                                  ▲                 ▲                 ▲
            Socket.IO / JSON      │                 │                 │ Socket.IO / 1-Byte Bitmask (kèm JSON)
         ┌────────────────────────┴────────┐        │                 │
         ▼                                 ▼        ▼                 ▼
 ┌─────────────────┐             ┌───────────────────┐      ┌───────────────────┐
 │ ESP32 NODE CỔNG │             │ ESP32 KHU A       │      │ ESP32 KHU B       │
 │ - PN532 UART    │             │ - 3 LDR (Slot1-3) │      │ - 3 LDR (Slot4-6) │
 │ - Servo Barie   │             │ - Đèn chiếu sáng  │      │ - Đèn chiếu sáng  │
 │ - Còi Buzzer    │             │ - Đèn báo cháy Đỏ │      │ - Đèn báo cháy Đỏ │
 │ - LDR Cổng      │             │ - Đèn phun nước   │      │ - Đèn phun nước   │
 └─────────────────┘             │ - Còi + Cảm biến  │      │ - Còi + Cảm biến  │
                                 └───────────────────┘      └───────────────────┘
                                           ▲                          ▲
                                           └───────────┬──────────────┘
                                                       │ (Kiểm thử tải)
                                            ┌─────────────────────┐
                                            │ 2 NODE ẢO (Node.js) │
                                            │ - Khu C & Khu D     │
                                            └─────────────────────┘
```

---

## 2. ĐẶC TẢ PHẦN CỨNG & BẢNG PHÂN CHÂN (PINOUT)

### 2.1. Node Cổng (ESP32 Gate Client - ID: `ESP_GATE`)
*Phụ trách: Kiểm soát xe ra vào, quẹt thẻ NFC, điều khiển thanh chắn Barie, phát âm thanh hướng dẫn và đo độ sáng môi trường.*

| Thiết bị / Linh kiện | Chân GPIO | Chế độ (Mode) | Nguyên lý hoạt động & Chú thích |
| :--- | :---: | :---: | :--- |
| **PN532 SDA (TXD)** | **GPIO 16 (RX2)** | Serial2 UART | Tốc độ 115200 bps, driver non-blocking (SW1=OFF, SW2=OFF) |
| **PN532 SCL (RXD)** | **GPIO 17 (TX2)** | Serial2 UART | Kết nối trực tiếp ESP32 TX2 -> SCL PN532 |
| **Động cơ Servo SG90** | **GPIO 19** | ESP32PWM | Góc $0^\circ$ (Đóng), $90^\circ$ (Mở). Tự động đóng sau 3.5s |
| **Còi Buzzer cổng** | **GPIO 18** | `OUTPUT` | Bíp 1 lần (Hợp lệ); Bíp 3 lần (Không hợp lệ / Đầy bãi) |
| **LDR đo sáng cổng** | **GPIO 34** | `INPUT` (ADC1) | Cầu phân áp trở $10\text{k}\Omega$. Đọc ADC nhận diện trời tối |
| **LED Onboard / Status** | **GPIO 2** | `OUTPUT` | Báo trạng thái kết nối mạng & chớp khi quẹt thẻ |

> **Phương án hiển thị tại cổng:**
> * **Chính:** Tối giản phần cứng (không hàn LCD/OLED). Tránh lỗi dây và quá tải chân I2C.
> * **Dự phòng:** Cung cấp trang Web riêng tại `http://<IP_SERVER>:3000/gate-display` tối ưu cho điện thoại/máy tính bảng đặt tại bàn hướng dẫn.

---

### 2.2. Node Khu A & Node Khu B (ESP32 Parking Zones - ID: `ESP_ZONE_A`, `ESP_ZONE_B`)
*Mỗi khu quản lý 3 vị trí đỗ xe độc lập, hệ thống chiếu sáng khu vực và tổ hợp thiết bị PCCC cục bộ.*

| Thiết bị / Linh kiện | Chân GPIO | Chế độ (Mode) | Nguyên lý hoạt động & Chú thích |
| :--- | :---: | :---: | :--- |
| **LDR Ô 1 (Slot 1 / 4)** | **GPIO 34** | `INPUT` (ADC1) | Cầu phân áp $10\text{k}\Omega$ nối 3.3V (ADC1_CH6 an toàn WiFi) |
| **LDR Ô 2 (Slot 2 / 5)** | **GPIO 35** | `INPUT` (ADC1) | Cầu phân áp $10\text{k}\Omega$ nối 3.3V (ADC1_CH7 an toàn WiFi) |
| **LDR Ô 3 (Slot 3 / 6)** | **GPIO 32** | `INPUT` (ADC1) | Cầu phân áp $10\text{k}\Omega$ nối 3.3V (ADC1_CH4 an toàn WiFi) |
| **Đèn chiếu sáng khu** | **GPIO 23** | `OUTPUT` | LED siêu sáng/thường (trở $220\Omega$). Tự động bật theo LDR cổng hoặc Web |
| **Đèn báo cháy (LED Đỏ)** | **GPIO 13** | `OUTPUT` | Nhấp nháy chu kỳ 200ms khi phát hiện cháy |
| **Đèn phun nước (LED Xanh)**| **GPIO 14**| `OUTPUT` | Sáng liên tục mô phỏng kích hoạt van xả nước chữa cháy |
| **Còi Buzzer cảnh báo** | **GPIO 27** | `OUTPUT` | Hú còi cảnh báo tại chỗ khi có sự cố cháy |
| **Cảm biến lửa (Flame DO)**| **GPIO 4** | `INPUT` | Mức LOW khi có ngọn lửa (đã kiểm thử ổn định) |
| **Nút bấm khẩn cấp** | **GPIO 25** | `INPUT_PULLUP` | Nút nhấn nhả/công tắc gạt, nhấn nối GND = Báo động khẩn |

---

## 3. THUẬT TOÁN XỬ LÝ BIÊN & CHỐNG NHIỄU (EDGE PROCESSING)

### 3.1. Cơ chế chống nhiễu thời gian (Debounce Confirmation Delay)
* Khi có người đi bộ lướt qua hoặc bóng người che quang trở LDR, giá trị ADC sụt giảm tức thời ($< 0.5$ giây).
* **Thuật toán xác nhận trạng thái:**
  * Khi phát hiện ô bị che tối: Bắt đầu kích hoạt bộ đếm thời gian. Chỉ khi trạng thái bị che duy trì **liên tục từ 1.5 đến 2.0 giây**, hệ thống mới xác nhận ô chuyển sang **CÓ XE ĐỖ**.
  * Khi xe rời đi: Ánh sáng phải quay lại mức cao liên tục trên 1.5 giây mới xác nhận ô **TRỐNG**.
  * Loại bỏ hoàn toàn hiện tượng nhấp nháy trạng thái trên giao diện Web Dashboard.

### 3.2. Thuật toán thích nghi đường nền sáng EMA (Adaptive Edge DSP)
* Cung cấp cờ tiền xử lý:
  ```cpp
  #define USE_ADAPTIVE_DSP true // Đặt false nếu chỉ muốn dùng ngưỡng cố định đơn giản
  ```
* **Khi bật (`true`):** Bộ lọc Exponential Moving Average liên tục học ánh sáng môi trường phòng học:
  $$B_t = \alpha \cdot A_t + (1 - \alpha) B_{t-1} \quad (\alpha \approx 0.02)$$
  * Khi xe vào đỗ: Kích hoạt cơ chế **Freeze Baseline** (đóng băng đường nền $B_t$) để nền không bị kéo tụt theo bóng tối gầm xe.
* **Khi tắt (`false`):** Dùng ngưỡng so sánh cố định có vùng trễ trôi động (Hysteresis):
  * Ô có xe khi $V_{ADC} < 1700$.
  * Ô trống khi $V_{ADC} > 2200$.

---

## 4. THIẾT KẾ MẠNG & CHUẨN MÔN HỌC (TS. NGUYỄN VĂN KHANH)

### 4.1. Bốn trụ cột môn Lập trình Mạng (KC321)
1. **Quản lý danh sách Client bằng đối tượng `Map()` trong JS (Slide 16-18 C3):**
   ```javascript
   const devices = new Map();
   // Key: deviceId ('ESP_GATE', 'ESP_ZONE_A', 'ESP_ZONE_B')
   // Value: { id, type, online, lastSeen, data, socketId }
   ```
2. **Socket.IO Rooms phân luồng theo khu vực (Slide 10-23 C3):**
   * `room_gate`: Nhận diện sự kiện quẹt thẻ NFC và điều khiển thanh chắn Barie.
   * `room_zone_A`: Điều khiển và nhận dữ liệu hàng xe Khu A.
   * `room_zone_B`: Điều khiển và nhận dữ liệu hàng xe Khu B.
   * `room_dashboard`: Phát broadcast toàn bộ sa bàn bãi xe đến các trình duyệt Web.
3. **Tối ưu hóa gói tin tầng truyền vận (1-Byte Bitmask Payload):**
   * Giảm kích thước khung truyền từ ~70 bytes (JSON) xuống đúng **1 Byte nhị phân** đối với dữ liệu cảm biến định kỳ từ Khu A & Khu B.
   * Cung cấp cờ dự phòng `#define USE_BINARY_PAYLOAD false` để chuyển sang JSON khi cần đối chiếu.
4. **Nâng cấp từ xa Web OTA (Stream & Pipe - Slide C2):**
   * Tách riêng thành module `ota_service.js`. Sử dụng `fs.createReadStream()` với `highWaterMark: 1024` bytes kết hợp `pipe()` trực tiếp đến HTTP update endpoint trên ESP32 (`Update.h`).

---

### 4.2. Cấu trúc Giao thức truyền thông

#### A. Khung tin 1-Byte Bitmask (ESP32 Khu A / Khu B -> Server)
| Bit | Tên trường | Giá trị 0 | Giá trị 1 | Chức năng |
| :---: | :---: | :---: | :---: | :--- |
| **Bit 0** | `SLOT_1` | Trống | Có xe | Trạng thái vị trí đỗ 1 |
| **Bit 1** | `SLOT_2` | Trống | Có xe | Trạng thái vị trí đỗ 2 |
| **Bit 2** | `SLOT_3` | Trống | Có xe | Trạng thái vị trí đỗ 3 |
| **Bit 3** | `LIGHT_STATE`| Đèn tắt | Đèn đang bật | Trạng thái đèn chiếu sáng khu |
| **Bit 4** | `FIRE_ALARM` | Bình thường | CẢNH BÁO CHÁY | Tín hiệu từ cảm biến lửa / nút khẩn |
| **Bit 5** | `PUMP_STATE` | Bơm tắt | Bơm đang phun | Trạng thái van xả nước chữa cháy |
| **Bit 6** | `FAULT_FLAG` | Bình thường | Cảnh báo lỗi | Lỗi đường truyền hoặc cảm biến |
| **Bit 7** | `RESERVED`   | 0 | 0 | Dự phòng mở rộng |

*Gói tin JSON dự phòng khi không dùng Bitmask:*
```json
{
  "type": "zone_status",
  "slots": [1, 0, 0],
  "light": true,
  "fire": false,
  "pump": false
}
```

#### B. Khung tin Node Cổng (ESP32 Cổng -> Server qua Socket.IO JSON)
```json
{
  "type": "gate_event",
  "action": "card_scanned",
  "uid": "1A2B3C4D",
  "ldrDark": true,
  "barieState": "closed"
}
```

---

## 5. LOGIC NGHIỆP VỤ & QUY TRÌNH HOẠT ĐỘNG TOÀN DIỆN

### 5.1. Quy trình quản lý xe Vào / Ra cổng (1 Cổng duy nhất)
1. **Quản lý danh sách thẻ hợp lệ (Whitelist):**
   * Server lưu danh sách UID thẻ mẫu được phép ra vào: `["1A2B3C4D", "F5E4D3C2", "047A8B12"]`.
   * Thẻ lạ không có trong danh sách $\to$ Server gửi lệnh Còi cổng bíp **3 tiếng ngắn**, Barie không mở, Web thông báo *"Thẻ không hợp lệ"*.
2. **Quy tắc Vào / Ra luân phiên trên 1 đầu đọc:**
   * **Quẹt lần 1 (Xe Vào):**
     * Kiểm tra tổng số chỗ trống của 2 khu ($N_{free} = N_{ZoneA} + N_{ZoneB}$).
     * Nếu còn chỗ ($N_{free} > 0$): Còi cổng bíp **1 tiếng dài**, Barie nâng góc $90^\circ$, sau 3.5 giây tự động hạ xuống, lưu trạng thái xe đang trong bãi.
     * Nếu bãi xe đã kín ($N_{free} == 0$): Còi cổng bíp **3 tiếng**, Barie **không mở**, Web hiện cảnh báo *"Bãi xe đã đầy"*.
   * **Quẹt lần 2 (Xe Ra):**
     * Server xác nhận lượt xe ra, còi bíp **1 tiếng dài**, Barie nâng lên cho xe xuất bến, giải phóng trạng thái xe.

### 5.2. Kịch bản Khẩn cấp PCCC & Cứu hỏa
1. **Phát hiện sự cố:** Khi cảm biến lửa hoặc nút khẩn cấp tại Khu A (hoặc Khu B) kích hoạt $\to$ Gửi tin khẩn lên Server qua Socket.IO.
2. **Báo động toàn bãi xe:** Server phát lệnh cảnh báo đến tất cả các Room:
   * **Đèn báo cháy Đỏ** và **Còi hú** ở **CẢ 2 KHU (A và B)** đều kích hoạt để mọi người kịp thời di tản.
3. **Phun nước cục bộ:** **CHỈ CÓ đèn phun nước (LED Xanh) tại đúng khu vực xảy ra cháy mới được kích hoạt**, khu vực an toàn không phun nước để tránh làm ướt xe xung quanh.
4. **Kiểm soát Barie cổng:**
   * Để đảm bảo an toàn vận hành, Barie **KHÔNG** tự bung ngẫu nhiên.
   * Trên Web Dashboard trung tâm lập tức nhấp nháy đỏ báo động và hiện nút lớn: **"MỞ TOANG BARIE THOÁT HIỂM"**. Quản trị viên chỉ cần bấm xác nhận, Barie cổng sẽ mở giữ nguyên $90^\circ$ cho toàn bộ xe thoát hiểm.
5. **Nút Reset PCCC:** Trên Web Dashboard có nút **"TẮT BÁO CHÁY / RESET TOÀN BỘ"** để đưa hệ thống đèn, còi, bơm và barie trở về trạng thái an toàn ban đầu.

### 5.3. Điều khiển đèn chiếu sáng thông minh
* Khi LDR cổng phát hiện trời tối $\to$ Gửi tín hiệu `ldrDark: true` về Server.
* Server tự động gửi lệnh bật đèn chiếu sáng tới `room_zone_A` và `room_zone_B`.
* Người quản trị trên Web Dashboard có thể bấm nút bật/tắt thủ công cho từng khu vực bất cứ lúc nào.

---

## 6. THIẾT KẾ GIAO DIỆN WEB DASHBOARD

### 6.1. Giao diện Admin Dashboard chính (`/`)
* **Sa bàn bãi xe trực quan 3D/Flat:**
  * Nhìn vào lập tức nhận biết bãi đỗ xe gồm 2 dãy A và B, với 6 ô đỗ xe lớn hiển thị màu sắc thời gian thực:
    * **Xanh lá:** Ô đang trống (Sẵn sàng đỗ).
    * **Đỏ cam:** Ô đã có xe đỗ.
    * **Xám:** Ô mất kết nối mạng.
* **Khu vực Cổng kiểm soát:**
  * Đồ họa cần gạt Barie trực quan (đổi góc nâng/hạ theo thời gian thực).
  * Hiển thị mã UID thẻ vừa quẹt gần nhất và thời gian xe Vào/Ra.
* **Bảng điều khiển trung tâm:**
  * Nút Mở Barie khẩn cấp.
  * Công tắc Bật/Tắt đèn chiếu sáng Khu A & Khu B.
  * Nút Kích hoạt báo cháy thử nghiệm & Nút Reset PCCC.
* **Nhật ký sự kiện (Activity Log):**
  * Danh sách 100 sự kiện mới nhất (giờ quẹt thẻ, xe vào/ra, cảnh báo cháy, lệnh điều khiển) kèm tính năng xuất file CSV.

### 6.2. Trang Bảng điện tử Cổng phụ (`/gate-display`)
* Dành riêng cho màn hình/máy tính bảng đặt tại cổng ra vào cho người lái xe xem.
* Giao diện Full-screen tối giản, chữ số cực lớn:
  * **"CÒN TRỐNG: X / 6 CHỖ"**
  * **"KHU A: X Ô | KHU B: Y Ô"**
  * Khung thông báo trạng thái quẹt thẻ: **"XIN MỜI VÀO"** (Xanh) hoặc **"BÃI XE ĐÃ ĐẦY"** (Đỏ).

### 6.3. Mô phỏng mở rộng (Virtual Nodes)
* Script `virtual_nodes.js` giả lập thêm **Khu C & Khu D** (6 ô ảo) kết nối qua Socket.IO để kiểm thử khả năng mở rộng của hệ thống trước giảng viên.

---

## 7. KỊCH BẢN THỰC NGHIỆM & BẢO VỆ ĐỒ ÁN (DEMO SCENARIO)

1. **Bước 1 (Khởi động hệ thống):** Khởi động Server Node.js. 3 Kit ESP32 khởi động, tự kết nối WiFi và gia nhập các Socket Room tương ứng. Dashboard cập nhật tức thì trạng thái trực tuyến của 3 Node.
2. **Bước 2 (Mô phỏng xe vào bãi):**
   * Quẹt thẻ NFC hợp lệ $\to$ Còi cổng bíp 1 lần, Barie mở góc $90^\circ$, sau 3.5s tự đóng lại.
   * Đặt mô hình xe vào ô số 1 che LDR $\to$ Sau 1.5s (chống nhiễu), ô số 1 trên Web chuyển sang màu Đỏ, số chỗ trống giảm 1.
3. **Bước 3 (Thử nghiệm bật đèn thông minh):**
   * Che tối quang trở LDR tại cổng $\to$ Web nhận tín hiệu, tự động bật đèn chiếu sáng cả 2 Khu A và B.
4. **Bước 4 (Sự cố PCCC khẩn cấp):**
   * Dùng bật lửa hoặc bấm nút khẩn cấp tại Khu A $\to$ Còi và đèn báo cháy tại cả 2 khu A và B cùng kêu/chớp, đèn phun nước Khu A bật.
   * Trên Web bấm nút **"MỞ TOANG BARIE THOÁT HIỂM"** $\to$ Barie cổng mở toang cho xe chạy thoát.
   * Bấm nút **"RESET HỆ THỐNG"** $\to$ Toàn bộ hệ thống trở về trạng thái bình thường.
5. **Bước 5 (Bắt gói tin Wireshark):**
   * Mở Wireshark soi gói tin nhị phân 1-Byte và giải thích cho Thầy cơ chế tiết kiệm băng thông 98.5%.
6. **Bước 6 (Demo nạp Web OTA qua Stream/Pipe):**
   * Kéo thả file `.bin` lên giao diện Web OTA để chứng minh tính năng nạp firmware không dây qua luồng Stream theo đúng chương trình học.
