# DEMO BÃI ĐỖ XE THÔNG MINH – Socket.IO ROOM

> Bản thử nghiệm môn Lập trình mạng, **không phải hệ thống chữa cháy thực tế**.

## 1. Chức năng

- **Hàng 1 – ESP32 thật** (`ESP32_001`): 3 quang trở tại GPIO34/35/32, báo cháy GPIO25, relay GPIO26, LED thay còi GPIO27. Khi cháy: relay lên mức HIGH, LED đổi trạng thái mỗi 500 ms. Xử lý ngõ ra tại ESP32 ngay cả khi mất mạng.
- **Hàng 2 – ESP32 giả lập bằng Node.js** (`ESP32_002`): 3 vị trí đỗ, cảm biến cháy/relay/LED đều giả lập; thay đổi trạng thái bằng các nút Web.
- **Web Dashboard**: tổng chỗ, đã đỗ, còn trống, chưa rõ, an toàn/cháy từng hàng, lịch sử thay đổi và các nút kiểm thử gửi riêng đến từng ROOM.
- Nếu hàng nào offline, các vị trí của hàng đó hiển thị **CHƯA RÕ** (không tính nhầm là trống).

## 2. ROOM được dùng thế nào?

| Thành phần | Tên ROOM | Mục đích |
|---|---|---|
| ESP32 hàng 1 | `device_ESP32_001` | Điều khiển riêng hàng 1 |
| ESP32 hàng 2 giả lập | `device_ESP32_002` | Điều khiển riêng hàng 2 |
| ESP32 hàng 1 | `row_1` | Nhóm thiết bị thuộc hàng 1 (để mở rộng) |
| ESP32 hàng 2 | `row_2` | Nhóm thiết bị thuộc hàng 2 (để mở rộng) |
| Web | `dashboard` | Nhận trạng thái 2 hàng |

Khi client gửi `register_device`, **Server** gọi `socket.join('device_...')`.
Web gửi `control_device` cho Server; Server chuyển tiếp bằng
`io.to('device_ESP32_001').emit('control', command)` hoặc ROOM hàng 2.
ROOM chỉ nhóm socket ở **phía Server**, không phải một server vật lý mới.

Các sự kiện:
- `register_device`: ESP32 đăng ký `deviceId`.
- `register_web`: Web tham gia ROOM `dashboard`.
- `status`: ESP32 gửi `{slots:[0,1,0],fire:false,relay:false,buzzer:false}`.
- `snapshot`: Server phát tổng hợp trạng thái vào ROOM `dashboard`.
- `control_device`: Web yêu cầu Server gửi lệnh đến đúng thiết bị.
- `control`: Server gửi đến ROOM của ESP32.
- `control_reply`: ESP32 trả lời, Web nhận xác nhận.

## 3. Sơ đồ chân ESP32 hàng 1

| Linh kiện | GPIO | Chế độ | Hoạt động |
|---|---:|---|---|
| LDR chỗ 1 | 34 | ADC1 INPUT | Sáng: ADC cao = trống; che: ADC thấp = có xe |
| LDR chỗ 2 | 35 | ADC1 INPUT | Tương tự |
| LDR chỗ 3 | 32 | ADC1 INPUT | Tương tự |
| Cảm biến cháy | 25 | INPUT | HIGH (3.3 V) là có cháy |
| Module relay | 26 | OUTPUT | HIGH khi cháy (module kích mức HIGH) |
| LED thay buzzer | 27 | OUTPUT | Khi cháy đổi mức mỗi 500 ms |

**Đấu LDR đúng chiều điện áp theo yêu cầu:**

```text
3.3V ── LDR ──●── điện trở 10kΩ ── GND
              │
              └── GPIO34 (hoặc GPIO35 / GPIO32)
```

Nếu đảo vị trí LDR và điện trở, công thức sáng/tối sẽ bị đảo, không đúng thuật toán này.

- Cảm biến cháy phải xuất **logic 3.3 V** tương thích ESP32. Không nối tín hiệu 5 V thẳng vào GPIO25. Nếu nguồn phát tín hiệu không tự giữ LOW khi không cháy, cần điện trở kéo xuống ngoài (ví dụ 10kΩ). `pinMode(INPUT)` không tự chống nổi mức.
- LED GPIO27 cần điện trở hạn dòng khoảng 220–330Ω. Chỉ dùng relay/thiết bị demo thấp áp; không trực tiếp nối điện lưới/van công suất.
- Mạch relay phải hỗ trợ kích **mức HIGH bằng tín hiệu 3.3 V**. Nếu dùng loại kích LOW cần thay cả cách điều khiển và mạch.

## 4. Chạy thử Server + hàng 2 giả lập + Web (CHƯA CẦN ESP32 THẬT)

Cài **Node.js** và mở terminal ở thư mục `Parking_ROOM_Demo`:

```bash
npm install
npm start
```

Mở terminal **thứ hai, cùng thư mục**:

```bash
npm run sim
```

Mở trình duyệt **trên máy chạy Server**:

```text
http://localhost:3000
```

Kỳ vọng: hàng 1 OFFLINE và 3 chỗ chưa rõ; hàng 2 ONLINE với chỗ 1 trống, chỗ 2 có xe, chỗ 3 trống. Tổng cộng: 1 chỗ có xe, 2 chỗ trống, 3 chỗ chưa rõ.

**Thử ROOM:**
1. Bấm **Yêu cầu trạng thái Hàng 2**: hàng 2 phản hồi, xem dòng `control_reply` và terminal Server (log `[ROOM SEND] device_ESP32_002`).
2. Bấm **Đảo chỗ H2-1**: số đã đỗ tăng từ 1 lên 2; lịch sử xuất hiện "Hàng 2 - chỗ 1: Xe vào".
3. Bấm lại **Đảo chỗ H2-1**: số đã đỗ giảm; lịch sử xuất hiện "Xe ra".
4. Bấm **Giả lập CHÁY Hàng 2**: báo đỏ; sau đó **Tắt cháy Hàng 2** để trở lại trạng thái không có cảnh báo từ hàng đang online.
5. Khi kết nối ESP32 thật, bấm **Yêu cầu trạng thái Hàng 1** và xem ESP32 trả lời riêng. Trường hợp Hàng 1 offline, Server sẽ từ chối gửi tới thiết bị đó.

## 5. Nạp chương trình vào ESP32 hàng 1 bằng PlatformIO

Mở **VS Code → File → Open Folder →** chọn **`esp32_hang1`** (thư mục có `platformio.ini`).
Cài extension **PlatformIO IDE** nếu chưa có. Không cần tạo project PlatformIO mới.

Mở `esp32_hang1/src/main.cpp`, thay:

```cpp
const char* WIFI_SSID = "TEN_WIFI";
const char* WIFI_PASSWORD = "MAT_KHAU_WIFI";
const char* SERVER_IP = "192.168.1.100";
```

`SERVER_IP` là **IP LAN của laptop chạy `npm start`**, không phải IP ESP32 và cũng không phải `localhost`.
Trên Windows xem IP bằng `ipconfig`, tìm `IPv4 Address` của adapter Wi-Fi.
ESP32 và laptop cùng mạng; nếu có tường lửa, cho phép Node.js nhận TCP cổng **3000** trên mạng riêng (Private network).

Trong PlatformIO: Build (dấu ✓) → Upload (mũi tên) → Serial Monitor (115200 baud).
Các thư viện `WebSockets` và `ArduinoJson` được cài tự động bởi `lib_deps` trong `platformio.ini` (cần Internet ở lần cài đầu).

**Chú ý phân biệt:** Header đúng của ví dụ là `#include <SocketIOclient.h>` từ thư viện **Links2004/WebSockets**, không phải `#include <WebSocketsClient.h>` đơn lẻ. Socket.IO chứa giao thức sự kiện bổ sung trên WebSocket.

## 6. Chỉnh ngưỡng LDR trước khi chạy thật

Trong `main.cpp`, code đang đặt ngưỡng minh họa:

```cpp
const int ADC_OCCUPIED_BELOW = 1700;
const int ADC_FREE_ABOVE = 2200;
```

ESP32 đọc ADC **0..4095**. Các ngưỡng **1700 và 2200 chỉ là ví dụ**, không phải giá trị đúng sẵn cho mọi cảm biến. Mở Serial Monitor, ghi ADC khi **chỗ sáng không có xe** và khi **xe che LDR** ở cả ba vị trí. Chọn ngưỡng ở giữa hai cụm giá trị (có khoảng trễ/hysteresis).

Nếu ADC nằm giữa 2 ngưỡng khi mới khởi động, vị trí sẽ ở trạng thái **chưa rõ** đến khi đọc được giá trị đủ sáng hoặc đủ tối. Điều này tránh báo sai là trống.

**Lưu ý:** Đèn xe, ánh sáng môi trường thay đổi và che bóng có thể làm LDR đổi trạng thái giả. Lịch sử "Xe vào/ra" ở đây là **suy luận từ cảm biến**, chưa phải đếm xe ra/vào tại cổng. Trong đồ án hoàn chỉnh có thể bổ sung NFC/cảm biến cổng.

## 7. Cấu trúc dự án

```text
Parking_ROOM_Demo/
├── package.json
├── server.js                    # Server Socket.IO: ROOM, Map, lịch sử
├── esp32_gialap_hang2.js        # Client Node.js giả lập ESP32 thứ hai
├── web/
│   └── index.html               # Dashboard trình duyệt
├── esp32_hang1/
│   ├── platformio.ini           # Thư viện + board ESP32
│   └── src/
│       └── main.cpp             # ESP32 thật, LDR/relay/LED/báo cháy
└── README_HUONG_DAN.md
```

## 8. Các giới hạn và yêu cầu an toàn

- Bản mẫu minh họa áp dụng kiến thức ROOM của slide 10–34. Code ESP32 dùng lớp `SocketIOclient` của thư viện Links2004 đang được duy trì thay cho thư viện `SocketIoClient` cũ trong slide; Server giữ Socket.IO **2.4.1** theo bài học (Engine.IO 3) để tương thích ví dụ.
- Socket.IO 2.x đã cũ: chỉ dùng mạng thử nghiệm được tin cậy. Ví dụ chưa có xác thực/chứng thực thiết bị, mã hóa TLS, lưu trữ dữ liệu, hay khôi phục sau mất điện.
- Hàng 2 chỉ là mô phỏng phần mềm: `relay` và `buzzer` là biến trạng thái, không có chân điện thật.
- Cảnh báo cháy ở bản mẫu **không thay thế thiết bị báo cháy/chữa cháy được chứng nhận**. Không kết nối trực tiếp bản thử nghiệm với van nước dùng trong thực tế. Mất nguồn ESP32 hay hư cảm biến có thể khiến hệ thống không hoạt động.
- Lịch sử chỉ lưu tối đa 80 sự kiện trong RAM. Khởi động lại Server thì mất lịch sử.
- Trên máy này chưa xác minh được nạp firmware lên ESP32 và chạy E2E do không có phần cứng/network package; cần kiểm tra trên máy bạn.
