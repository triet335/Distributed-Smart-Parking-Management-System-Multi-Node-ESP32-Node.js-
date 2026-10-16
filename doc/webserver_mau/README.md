# ParkFlow — Quản lý bãi giữ xe ESP32

Giao diện **React JSX + HTML + CSS**, máy chủ **Node.js/Express**, cập nhật thời gian thực bằng **Socket.IO**. ESP32 giữ giao thức **WebSocket nhị phân 1 byte** tại `/ws?id=ESP-01`.

## Chạy ứng dụng

Yêu cầu Node.js 20 trở lên. Mở PowerShell tại thư mục gốc `DOAN_LTM`:

```powershell
cd webserver
npm.cmd install
npm.cmd start
```

Mở **http://localhost:3000**. `npm start` tự biên dịch JSX và CSS trước khi chạy server. Dùng `npm.cmd` trên PowerShell nếu `npm.ps1` bị Execution Policy chặn. Trên CMD/Linux/macOS có thể dùng `npm`.

Phát triển giao diện:

```powershell
npm.cmd run dev
```

JSX/CSS được biên dịch khi thay đổi; tải lại trình duyệt để xem. Server tự khởi động lại khi sửa JavaScript phía server. Kiểm tra tự động: `npm.cmd test`; chỉ biên dịch giao diện: `npm.cmd run build`.

Nếu server đã chạy ở cổng 3000, sau khi sửa giao diện chỉ cần `npm.cmd run build` rồi nhấn **Ctrl + F5** trên trình duyệt. Chạy thêm `npm.cmd start` trong terminal khác sẽ báo `EADDRINUSE` vì cổng đang được sử dụng.

Kiểm tra giao diện bằng Chrome/Edge đã cài: `node scripts/check-browser.js`. Script dùng server tạm và ESP32 mô phỏng, không gửi lệnh đến phần cứng; ảnh giao diện máy tính/điện thoại nằm trong `.qa/`.

## Chạy thử khi chưa có ESP32

Giữ server hoạt động, mở terminal thứ hai trong `webserver`:

```powershell
npm.cmd run sim
```

Ba thiết bị ESP-03/04/05 được ghi rõ **Mô phỏng**, tự thay đổi trạng thái ô và phát xung IR. Thử bật/tắt còi và relay trong bảng điều khiển; thiết bị mô phỏng phản hồi xác nhận giống firmware mới. Dừng bằng Ctrl+C. ESP-01/02 vẫn ngoại tuyến nếu chưa cắm phần cứng. Mô phỏng không hỗ trợ OTA.

## Kết nối phần cứng

1. Trong cả hai file `src/esp_client/clien_1/src/main.cpp` và `clien_2/src/main.cpp`, chỉnh `WIFI_SSID`, `WIFI_PASSWORD`, `SERVER_HOST` theo mạng thực tế. `SERVER_HOST` là IPv4 máy tính chạy server (xem bằng `ipconfig`), **không phải localhost**.
2. Giữ `SERVER_PORT = 3000`, `NODE_ID = ESP-01` và `ESP-02` tương ứng. Máy tính và ESP32 phải cùng mạng, cho phép TCP 3000 qua Windows Firewall trên mạng nội bộ.
3. Build & Upload hai firmware bằng PlatformIO qua USB. **Nạp lại firmware đã cập nhật** để điều khiển còi và nhận ACK. Firmware cũ chỉ hỗ trợ relay, xác nhận relay qua bit 5.
4. Truy cập `http://<IPv4-máy-tính>:3000` từ điện thoại/máy tính cùng mạng. ESP32 tự xuất hiện khi kết nối.

Còi GPIO 26; relay GPIO 27. Cảm biến cháy tự bật còi và được ưu tiên hơn lệnh tắt thủ công. Server không tự bật relay khi có cháy. Relay do người vận hành điều khiển.

## Chức năng

- Tổng quan sức chứa, ô trống/có xe, số ô chưa xác định, bộ đếm lượt IR.
- Sơ đồ bãi xe; chọn hàng, tìm tên/mã thiết bị, lọc khu vực và trạng thái kết nối.
- **1 ESP32 quản lý đúng 1 hàng xe**, gồm 1–3 ô đỗ. Khu vực chỉ dùng để nhóm nhiều hàng độc lập. Form thêm mới từ chối mã ESP32 đã gắn với một hàng; sửa hàng qua nút Cấu hình hàng.
- Hàng báo cháy nhấp nháy nền/viền đỏ và có nhãn BÁO CHÁY; các hàng khác cùng khu vực giữ nguyên trạng thái. Cảnh báo có nút đến đúng hàng, tự bỏ bộ lọc và đặt tiêu điểm vào hàng cần kiểm tra. Hiệu ứng dừng khi nhận dữ liệu hết cháy; khi mất kết nối vẫn giữ cảnh báo gần nhất và ghi rõ cần kiểm tra tại chỗ.
- Hiệu ứng chuyển trang, số thống kê đổi giá trị, xe vào ô, nút bấm và hộp thoại. Khi hệ điều hành bật giảm chuyển động, giữ cảnh báo đỏ và chữ rõ ràng thay cho nhấp nháy.
- Font **Be Vietnam Pro** hỗ trợ tiếng Việt, lưu tại `public/fonts/` cùng giấy phép SIL OFL để dùng khi không có Internet. Chữ trạng thái lớn hơn, màu nhấn riêng cho từng khu vực, phản hồi rõ khi chọn hàng/chờ lệnh/bật thiết bị và nút xóa bộ lọc.
- Bật/tắt còi, relay chữa cháy; chờ ESP32 xác nhận tối đa 5 giây. Khi ngoại tuyến hoặc chưa nhận dữ liệu, điều khiển bị vô hiệu hóa.
- Trạng thái ô ngoại tuyến/lỗi cảm biến hiện **chưa xác định**, không cộng vào ô còn trống. Bộ đếm IR là tổng lượt đi qua cảm biến, không phải số xe đang đỗ.
- Cảnh báo cháy, lỗi cảm biến; cấu hình tên hàng, khu vực, 1–3 ô cho mỗi node ở server.
- Nhật ký 200 sự kiện gần nhất, xuất CSV; lưu cấu hình, bộ đếm IR và nhật ký trong `data/parking.json` qua lần khởi động lại. Trạng thái cảm biến chỉ có giá trị sau khi ESP32 gửi dữ liệu mới.
- OTA: gửi `.bin` tối đa 4 MB qua multipart HTTP tới `/update` trên ESP32. Chỉ báo thành công khi ESP32 trả `OK`. Không có phần cứng thì chưa thể xác minh nạp firmware thực tế.

## Mã nguồn

```text
webserver/
  client/App.jsx       # React components, Socket.IO, thao tác điều khiển
  client/styles.css    # Giao diện responsive
  client/visual-theme.css # Font size, màu sắc và hiệu ứng tương tác
  public/index.html    # HTML khởi chạy React
  public/fonts/        # Font tiếng Việt dùng cục bộ và giấy phép
  public/assets/       # JS/CSS được tạo khi build
  scripts/build.js     # esbuild chuyển JSX thành JavaScript
  scripts/dev.js       # Theo dõi frontend/backend khi phát triển
  server.js            # Express, REST API, WebSocket, ACK, OTA
  virtual_nodes.js     # ESP32 mô phỏng
  tests/server.test.js # Kiểm tra giao thức và API
```

## Giao thức

| Bit | Ý nghĩa |
| --- | --- |
| 0–2 | Ba ô đỗ: 1 = có xe |
| 3 | Xung IR; server đếm cạnh lên |
| 4 | Báo cháy |
| 5 | Relay chữa cháy |
| 6 | Lỗi cảm biến |
| 7 | Dự phòng |

Server gửi text JSON `{ "cmd": "buzzer", "value": true, "requestId": "..." }`; ESP32 trả `{ "type": "ack", "cmd": "buzzer", "value": true, "success": true, "requestId": "...", "buzzer": true }`. Còi còn được báo qua text `{ "type": "state", "buzzer": false }` khi trạng thái thực thay đổi. Các khung text không được giải mã như dữ liệu nhị phân.

REST: `GET /api/nodes`, `GET /api/events`, `GET /api/health`, `POST /api/nodes/:id/setup`, `POST /api/nodes/:id/control`, `POST /api/nodes/:id/ota`.

Ứng dụng phục vụ đồ án trong mạng nội bộ, hiện chưa có đăng nhập/phân quyền. Đổi cổng bằng `$env:PORT = '3001'` trước khi chạy server và mô phỏng; firmware phải dùng cùng cổng.
