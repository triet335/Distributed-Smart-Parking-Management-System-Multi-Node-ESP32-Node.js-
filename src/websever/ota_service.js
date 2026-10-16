/**
 * ============================================================================
 * ĐỒ ÁN LẬP TRÌNH MẠNG (KC321) - ĐẠI HỌC CẦN THƠ
 * GIẢNG VIÊN HƯỚNG DẪN: TS. GVC. NGUYỄN VĂN KHANH (PLC & IIoT LAB)
 * 
 * MODULE: WEB OTA STREAM & PIPE SERVICE (Chương 2: Stream & Pipe)
 * Kỹ thuật:
 * - fs.createReadStream với kích thước khối (highWaterMark: 1024 / 4096 bytes)
 * - Nối ống dẫn (pipe) file firmware .bin trực tiếp sang HTTP Request của ESP32
 * - Báo cáo tiến trình stream % theo thời gian thực về Dashboard qua Socket.IO
 * ============================================================================
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

/**
 * Nạp firmware không dây qua Stream & Pipe
 * @param {string} espIp IP của ESP32 mục tiêu (ví dụ '192.168.1.101')
 * @param {string} filePath Đường dẫn tuyệt đối tới file .bin vừa tải lên
 * @param {object} io Socket.IO instance để broadcast tiến trình
 * @param {string} nodeId Định danh Node (ví dụ 'ESP_GATE', 'ESP_ZONE_A')
 * @returns {Promise<{success: boolean, message: string}>}
 */
function streamOtaFirmware(espIp, filePath, io, nodeId) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            return reject(new Error('File firmware không tồn tại trên máy chủ'));
        }

        const stat = fs.statSync(filePath);
        const totalSize = stat.size;
        let uploadedBytes = 0;

        console.log(`[OTA STREAM] Bắt đầu stream ${totalSize} bytes tới ${nodeId} (${espIp}:80)...`);

        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="update"; filename="firmware.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
        const footer = `\r\n--${boundary}--\r\n`;

        const postLength = Buffer.byteLength(header) + totalSize + Buffer.byteLength(footer);

        const options = {
            hostname: espIp,
            port: 80,
            path: '/update',
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': postLength
            },
            timeout: 30000
        };

        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => { responseData += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200 || responseData.includes('OK')) {
                    console.log(`[OTA STREAM] Nạp firmware thành công cho ${nodeId}!`);
                    if (io) {
                        io.emit('ota_progress', { id: nodeId, percent: 100, status: 'success', message: 'Nạp thành công! Node đang khởi động lại...' });
                    }
                    resolve({ success: true, message: `Node ${nodeId} đã cập nhật firmware thành công!` });
                } else {
                    const err = `ESP32 phản hồi lỗi (Code ${res.statusCode}): ${responseData}`;
                    console.error(`[OTA STREAM] ${err}`);
                    if (io) {
                        io.emit('ota_progress', { id: nodeId, percent: 0, status: 'error', message: err });
                    }
                    resolve({ success: false, message: err });
                }
            });
        });

        req.on('error', (err) => {
            console.error(`[OTA STREAM] Lỗi kết nối tới ${espIp}: ${err.message}`);
            if (io) {
                io.emit('ota_progress', { id: nodeId, percent: 0, status: 'error', message: `Mất kết nối: ${err.message}` });
            }
            resolve({ success: false, message: `Không thể kết nối đến ESP32: ${err.message}` });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, message: 'Quá thời gian chờ ESP32 phản hồi OTA (Timeout)' });
        });

        // Ghi phần header multipart
        req.write(header);

        // VẬN DỤNG KIẾN THỨC CHƯƠNG 2: Stream với khối highWaterMark
        const fileStream = fs.createReadStream(filePath, { highWaterMark: 1024 });

        fileStream.on('data', (chunk) => {
            uploadedBytes += chunk.length;
            const percent = Math.min(99, Math.round((uploadedBytes / totalSize) * 100));

            // Báo cáo tiến trình qua Socket.IO tới Web Dashboard
            if (io) {
                io.emit('ota_progress', {
                    id: nodeId,
                    percent,
                    status: 'uploading',
                    uploadedBytes,
                    totalSize
                });
            }

            // Ghi chunk vào socket request
            req.write(chunk);
        });

        fileStream.on('end', () => {
            req.write(footer);
            req.end();
            console.log(`[OTA STREAM] Đã đẩy xong toàn bộ Stream sang ${espIp}. Đang chờ ESP32 ghi flash...`);
            if (io) {
                io.emit('ota_progress', { id: nodeId, percent: 99, status: 'flashing', message: 'Đang ghi bộ nhớ Flash...' });
            }
        });

        fileStream.on('error', (streamErr) => {
            req.destroy();
            console.error(`[OTA STREAM] Lỗi đọc file stream: ${streamErr.message}`);
            resolve({ success: false, message: `Lỗi đọc file: ${streamErr.message}` });
        });
    });
}

module.exports = { streamOtaFirmware };
