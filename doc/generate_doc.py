import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def create_document():
    doc = docx.Document()

    # 1. Cấu hình lề trang tiêu chuẩn luận văn/đồ án ĐHCT:
    # Top: 2.0 cm, Bottom: 2.0 cm, Left: 3.0 cm, Right: 2.0 cm
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(0.79)      # 2.0 cm
        section.bottom_margin = Inches(0.79)   # 2.0 cm
        section.left_margin = Inches(1.18)     # 3.0 cm
        section.right_margin = Inches(0.79)    # 2.0 cm

    # Màu sắc nhận diện học thuật chuyên nghiệp
    COLOR_PRIMARY = RGBColor(0, 51, 102)     # Xanh Navy đậm (#003366)
    COLOR_SECONDARY = RGBColor(31, 73, 125)  # Xanh lam đậm (#1F497D)
    COLOR_TEXT = RGBColor(30, 41, 59)        # Xám đen đậm (#1E293B)
    COLOR_MUTED = RGBColor(100, 116, 139)    # Xám phụ (#64748B)

    # Đặt font mặc định cho toàn bộ tài liệu là Times New Roman
    normal_style = doc.styles['Normal']
    normal_style.font.name = 'Times New Roman'
    normal_style.font.size = Pt(13)
    normal_style.font.color.rgb = COLOR_TEXT

    def format_p(p, space_before=0, space_after=6, line_spacing=1.2, align=WD_ALIGN_PARAGRAPH.JUSTIFY):
        p.paragraph_format.space_before = Pt(space_before)
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.line_spacing = line_spacing
        p.alignment = align
        return p

    def set_cell_background(cell, hex_color):
        shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
        cell._tc.get_or_add_tcPr().append(shading)

    def set_cell_padding(cell, top=100, bottom=100, left=150, right=150):
        tcPr = cell._tc.get_or_add_tcPr()
        tcMar = OxmlElement('w:tcMar')
        for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
            node = OxmlElement(f'w:{m}')
            node.set(qn('w:w'), str(val))
            node.set(qn('w:type'), 'dxa')
            tcMar.append(node)
        tcPr.append(tcMar)

    def add_h1(text):
        p = doc.add_paragraph()
        format_p(p, space_before=16, space_after=8, align=WD_ALIGN_PARAGRAPH.LEFT)
        run = p.add_run(text)
        run.bold = True
        run.font.size = Pt(14)
        run.font.color.rgb = COLOR_PRIMARY
        return p

    def add_h2(text):
        p = doc.add_paragraph()
        format_p(p, space_before=12, space_after=6, align=WD_ALIGN_PARAGRAPH.LEFT)
        run = p.add_run(text)
        run.bold = True
        run.font.size = Pt(13)
        run.font.color.rgb = COLOR_SECONDARY
        return p

    def add_h3(text):
        p = doc.add_paragraph()
        format_p(p, space_before=8, space_after=4, align=WD_ALIGN_PARAGRAPH.LEFT)
        run = p.add_run(text)
        run.bold = True
        run.italic = True
        run.font.size = Pt(13)
        run.font.color.rgb = COLOR_TEXT
        return p

    def add_bullet(text, bold_prefix=""):
        p = doc.add_paragraph(style='List Bullet')
        format_p(p, space_before=2, space_after=4, align=WD_ALIGN_PARAGRAPH.JUSTIFY)
        if bold_prefix:
            r_b = p.add_run(bold_prefix)
            r_b.bold = True
        p.add_run(text)
        return p

    def add_code_box(code_text):
        table = doc.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = table.cell(0, 0)
        set_cell_background(cell, "F8FAFC")
        set_cell_padding(cell, top=120, bottom=120, left=180, right=180)
        
        # Border viền xám nhạt
        tcPr = cell._tc.get_or_add_tcPr()
        borders = parse_xml(f'''
            <w:tcBorders {nsdecls("w")}>
                <w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
                <w:left w:val="single" w:sz="18" w:space="0" w:color="003366"/>
                <w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
                <w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
            </w:tcBorders>
        ''')
        tcPr.append(borders)
        
        p = cell.paragraphs[0]
        format_p(p, space_before=2, space_after=2, line_spacing=1.1, align=WD_ALIGN_PARAGRAPH.LEFT)
        run = p.add_run(code_text)
        run.font.name = 'Consolas'
        run.font.size = Pt(9.5)
        run.font.color.rgb = RGBColor(15, 23, 42)
        doc.add_paragraph().paragraph_format.space_after = Pt(4)

    # =========================================================================
    # TRANG TIÊU ĐỀ ĐỒ ÁN (HEADER BANNER)
    # =========================================================================
    p_inst = doc.add_paragraph()
    format_p(p_inst, space_before=0, space_after=2, align=WD_ALIGN_PARAGRAPH.CENTER)
    r = p_inst.add_run("BỘ GIÁO DỤC VÀ ĐÀO TẠO — TRƯỜNG ĐẠI HỌC CẦN THƠ\nTRƯỜNG BÁCH KHOA — KHOA TỰ ĐỘNG HÓA\nPHÒNG THÍ NGHIỆM KỸ THUẬT PLC & IIoT")
    r.bold = True
    r.font.size = Pt(11)
    r.font.color.rgb = COLOR_SECONDARY

    p_line = doc.add_paragraph()
    format_p(p_line, space_before=2, space_after=14, align=WD_ALIGN_PARAGRAPH.CENTER)
    r_l = p_line.add_run("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    r_l.font.color.rgb = COLOR_PRIMARY
    r_l.bold = True

    p_doc_type = doc.add_paragraph()
    format_p(p_doc_type, space_before=0, space_after=6, align=WD_ALIGN_PARAGRAPH.CENTER)
    r_dt = p_doc_type.add_run("BẢN ĐỀ XUẤT Ý TƯỞNG ĐỒ ÁN MÔN HỌC")
    r_dt.bold = True
    r_dt.font.size = Pt(16)
    r_dt.font.color.rgb = COLOR_PRIMARY

    p_course = doc.add_paragraph()
    format_p(p_course, space_before=0, space_after=16, align=WD_ALIGN_PARAGRAPH.CENTER)
    r_c = p_course.add_run("HỌC PHẦN: LẬP TRÌNH MẠNG (KC321)")
    r_c.bold = True
    r_c.font.size = Pt(13)
    r_c.font.color.rgb = COLOR_SECONDARY

    # TÊN ĐỀ TÀI BOX
    tbl_title = doc.add_table(rows=1, cols=1)
    tbl_title.alignment = WD_TABLE_ALIGNMENT.CENTER
    c_t = tbl_title.cell(0, 0)
    set_cell_background(c_t, "EFF6FF")
    set_cell_padding(c_t, top=140, bottom=140, left=180, right=180)
    tcPr = c_t._tc.get_or_add_tcPr()
    tcPr.append(parse_xml(f'''
        <w:tcBorders {nsdecls("w")}>
            <w:top w:val="single" w:sz="6" w:space="0" w:color="93C5FD"/>
            <w:left w:val="single" w:sz="24" w:space="0" w:color="003366"/>
            <w:bottom w:val="single" w:sz="6" w:space="0" w:color="93C5FD"/>
            <w:right w:val="single" w:sz="6" w:space="0" w:color="93C5FD"/>
        </w:tcBorders>
    '''))
    p_t = c_t.paragraphs[0]
    format_p(p_t, space_before=0, space_after=4, align=WD_ALIGN_PARAGRAPH.CENTER)
    r_t1 = p_t.add_run("HỆ THỐNG GIÁM SÁT VÀ QUẢN TRỊ BÃI ĐỖ XE PHÂN TÁN THEO KIẾN TRÚC MULTI-NODE: TỐI ƯU BĂNG THÔNG TRUYỀN THÔNG NHỊ PHÂN (BINARY BITMASK), XỬ LÝ BIÊN THÍCH NGHI (ADAPTIVE EDGE DSP), CẤU HÌNH ĐỘNG VÀ NẠP FIRMWARE TỪ XA QUA WEB OTA TRÊN ESP32\n")
    r_t1.bold = True
    r_t1.font.size = Pt(13.5)
    r_t1.font.color.rgb = COLOR_PRIMARY
    
    r_t2 = p_t.add_run("Distributed Multi-Node Smart Parking System: Binary Bitmask Protocol Optimization, Adaptive Edge DSP, Dynamic Web Provisioning, and Remote Firmware Management via Web OTA on ESP32")
    r_t2.italic = True
    r_t2.font.size = Pt(11.5)
    r_t2.font.color.rgb = COLOR_MUTED

    # THÔNG TIN THỰC HIỆN
    p_meta = doc.add_paragraph()
    format_p(p_meta, space_before=14, space_after=14, align=WD_ALIGN_PARAGRAPH.LEFT)
    r_m = p_meta.add_run("Giảng viên hướng dẫn: ")
    r_m.bold = True
    p_meta.add_run("TS. GVC. Nguyễn Văn Khanh (Trưởng PTN Kỹ thuật PLC & IIoT)\n")
    
    r_m2 = p_meta.add_run("Nhóm sinh viên thực hiện (Nhóm 3):\n")
    r_m2.bold = True
    p_meta.add_run("1. Lê Minh Triết — MSSV: B2308335 (Nhóm trưởng)\n")
    p_meta.add_run("2. Thạch Thảo — MSSV: B2308327\n")
    p_meta.add_run("3. Trương Đình Trí — MSSV: B2308337\n")
    p_meta.add_run("4. Đỗ Thanh Đức — MSSV: B2308287\n")
    r_m3 = p_meta.add_run("Quy mô mô hình thử nghiệm: ")
    r_m3.bold = True
    p_meta.add_run("Sa bàn bãi xe 1.0m x 1.5m, gồm 02 Node phần cứng độc lập (quản lý 2 hàng xe) kết hợp 03 Node ảo (Virtual Clients) mô phỏng mở rộng quy mô trên máy tính.")

    # =========================================================================
    # PHẦN 1: TÍNH CẤP THIẾT & VẤN ĐỀ CỐT LÕI
    # =========================================================================
    add_h1("PHẦN 1: TÍNH CẤP THIẾT VÀ VẤN ĐỀ CỐT LÕI CẦN GIẢI QUYẾT")
    
    add_h2("1.1. Khắc phục hạn chế của các đồ án IoT truyền thống")
    add_bullet(" Đa phần các đồ án nhúng dồn toàn bộ cảm biến của cả bãi xe vào một vi điều khiển duy nhất. Điều này dẫn tới hiện tượng cạn kiệt chân GPIO, khó khăn khi kéo dây ở khoảng cách xa và rủi ro sập toàn bộ hệ thống nếu vi điều khiển bị treo.", "Hạn chế của kiến trúc tập trung (Monolithic):")
    add_bullet(" Sử dụng công tắc hành trình cơ học rất nhanh hỏng hóc, dễ kẹt bụi bẩn, gãy chốt và mòn tiếp điểm sau một thời gian xe ra vào liên tục dưới sàn đỗ.", "Kém tin cậy ở cảm biến cơ học:")
    add_bullet(" Các hệ thống thông thường đóng gói dữ liệu dạng chuỗi JSON cồng kềnh (ví dụ: {\"nodeId\":1,\"slot1\":true,...} tốn ~70–100 Bytes) rồi đẩy định kỳ lên mạng, gây nghẽn băng thông mạng LAN, tăng độ trễ và tiêu tốn nhiều bộ nhớ RAM để parse chuỗi văn bản.", "Lãng phí băng thông mạng:")

    add_h2("1.2. Định vị bài toán cốt lõi của Lập trình Mạng (KC321)")
    p_core = doc.add_paragraph()
    format_p(p_core)
    p_core.add_run("Đề tài không đơn thuần là một mạch điện tử vi điều khiển đọc cảm biến, mà tập trung trực diện vào các mục tiêu kỹ thuật mạng theo đúng chương trình đào tạo của Thầy Nguyễn Văn Khanh:")
    add_bullet(" Phân chia bãi xe thành nhiều Node độc lập, kết nối máy chủ tập trung qua Socket.IO, phân nhóm quản lý theo từng Room riêng biệt (Slide 10–23 Chương 3).", "Kiến trúc Multi-Client & Socket Rooms:")
    add_bullet(" Thiết kế giao thức nhị phân siêu tinh gọn (1-Byte Payload Bitmask), giảm kích thước gói tin đến 98.5% so với JSON, kiểm chứng trực tiếp bằng Wireshark.", "Tối ưu hóa tầng vận chuyển (Transport Layer):")
    add_bullet(" Cho phép quản trị viên thêm vị trí đỗ, thêm hàng xe mới trực tiếp từ Dashboard; cấu hình tham số truyền qua API định tuyến động (/api/nodes/:id/setup - Slide 42 Chương 3).", "Cấu hình động & Express Dynamic Routing:")
    add_bullet(" Vận dụng bài học đọc file theo từng khối (Chunks / highWaterMark) và nối ống dẫn (pipe) từ máy chủ Node.js xuống ESP32 để nạp firmware không dây (Chương 2 & Báo cáo B1).", "Nâng cấp từ xa qua Web OTA (Stream & Pipe):")
    add_bullet(" Áp dụng bộ lọc số EMA thích nghi và cơ chế đóng băng đường nền (Freeze Baseline) trên ESP32 để tự động bù trừ ánh sáng ngày/đêm cho quang trở (LDR), bám sát hướng nghiên cứu AIoT & Sensors của PTN.", "Xử lý tín hiệu số tại biên (Edge DSP):")

    # =========================================================================
    # PHẦN 2: KIẾN TRÚC TỔNG THỂ HỆ THỐNG
    # =========================================================================
    add_h1("PHẦN 2: KIẾN TRÚC TỔNG THỂ HỆ THỐNG PHÂN TÁN")

    add_h2("2.1. Sơ đồ khối kiến trúc truyền thông")
    diagram_text = """
                            [ GIAO DIỆN WEB DASHBOARD ]
                     (Thêm Hàng xe / Setup Node / Kéo thả OTA)
                               ▲                   ▲
       WebSocket / Socket.IO   │                   │ HTTP Chunked OTA Stream
       Binary Bitmask (1 Byte) │                   │ (File firmware .bin)
                               ▼                   ▼
    =========================================================================
                          NODE.JS / EXPRESS WEB SERVER 
                     - Express Routes & Dynamic Params (:id)
                     - Map() quản lý danh sách Client (Slide 16-18 C3)
                     - Socket.IO Rooms & Ping/Pong Heartbeat
                     - Stream Pipe nạp firmware OTA (Slide C2)
    =========================================================================
                               ▲                       ▲
                               │ WebSocket / Socket.IO │
                               │ Port 3000             │
                               ▼                       ▼
    ┌───────────────────────────────────┐     ┌───────────────────────────┐
    │           ESP32 NODE 1            │     │       ESP32 NODE 2        │
    │         (Hàng A - Khu 1)          │     │     (Hàng B - Khu 2)      │
    ├───────────────────────────────────┤     ├───────────────────────────┤
    │ - 3 Quang trở chìm (DSP EMA)      │     │ - 3 Quang trở chìm        │
    │ - 1 Cảm biến IR đếm xe đầu hàng   │     │ - 1 Cảm biến IR đếm xe    │
    │ - 1 Nút gạt báo cháy khẩn cấp     │     │ - 1 Nút gạt báo cháy      │
    │ - 1 Còi hú & Relay van chữa cháy  │     │ - 1 Còi hú & Relay van CC │
    │ - Quản lý cấu hình NVS/Preferences│     │ - Quản lý cấu hình NVS    │
    └───────────────────────────────────┘     └───────────────────────────┘
                               ▲
                               │
                      ┌────────┴────────────────────────┐
                      │    3 CLIENT ẢO (VIRTUAL NODES)  │
                      │  (Script Node.js giả lập tải)   │
                      │  - Hàng C, Hàng D, Hàng E       │
                      │  - Chứng minh mở rộng hệ thống  │
                      └─────────────────────────────────┘
    """
    add_code_box(diagram_text.strip())

    add_h2("2.2. Phân bổ phần cứng và Client ảo")
    add_bullet(" Giám sát 3 vị trí đỗ (Slot 1, 2, 3), 1 cảm biến hồng ngoại (IR) phát hiện xe ra/vào đầu hàng, 1 công tắc/cảm biến báo cháy, 1 còi hú (Buzzer) và 1 relay van xả chữa cháy cục bộ.", "Node 1 vật lý (Hàng A):")
    add_bullet(" Giám sát 3 vị trí đỗ (Slot 4, 5, 6), 1 cảm biến IR đầu hàng, 1 công tắc báo cháy, 1 còi hú và relay chữa cháy.", "Node 2 vật lý (Hàng B):")
    add_bullet(" Chạy trên máy tính thông qua script Node.js độc lập để giả lập Hàng C, D, E kết nối đồng thời vào Server, chứng minh khả năng mở rộng hệ thống đa kết nối (Multi-client scaling) đúng theo yêu cầu trong slide Bài 4.", "03 Virtual Nodes (Client ảo):")

    # =========================================================================
    # PHẦN 3: XỬ LÝ BIÊN THÍCH NGHI (ADAPTIVE EDGE DSP)
    # =========================================================================
    add_h1("PHẦN 3: XỬ LÝ BIÊN THÍCH NGHI (ADAPTIVE EDGE DSP TRÊN ESP32)")
    
    p_dsp = doc.add_paragraph()
    format_p(p_dsp)
    p_dsp.add_run("Nhược điểm lớn nhất của quang trở (LDR) là giá trị điện trở phụ thuộc vào ánh sáng môi trường. Nếu trời tối dần hoặc bật tắt đèn phòng, hệ thống dùng ngưỡng cố định sẽ báo sai lệch hoàn toàn. Đề tài khắc phục triệt để bằng giải thuật lọc số thích nghi tại biên:")

    add_h2("3.1. Thuật toán bám đường nền thích nghi (Adaptive Baseline Tracking)")
    p_ema = doc.add_paragraph()
    format_p(p_ema)
    p_ema.add_run("Sử dụng bộ lọc số Exponential Moving Average (EMA) chu kỳ 50ms để liên tục cập nhật mức ánh sáng nền môi trường:\n")
    p_ema.add_run("B_t = α · A_t + (1 - α) · B_{t-1}\n").bold = True
    p_ema.add_run("Trong đó: A_t là giá trị ADC đọc từ LDR tại thời điểm t; B_t là đường nền thích nghi; hệ số α = 0.02 là tốc độ thích nghi chậm. Khi ánh sáng thay đổi từ từ (hoàng hôn, đèn mờ dần), đường nền B_t sẽ trôi theo, loại bỏ hoàn toàn báo động ảo.")

    add_h2("3.2. Cơ chế đóng băng đường nền (Baseline Freezing)")
    add_bullet(" Khi xe đi vào vị trí đỗ, gầm xe che khuất LDR làm giá trị ADC sụt giảm đột ngột vượt quá ngưỡng: |A_t - B_t| > Δ_threshold => Xác nhận CÓ XE ĐỖ (OCCUPIED).", "Kích hoạt chuyển trạng thái:")
    add_bullet(" Ngay khi xác định ô có xe, thuật toán tạm dừng cập nhật B_t (B_t = B_{t-1}). Điều này ngăn hiện tượng 'đường nền thích nghi theo bóng tối gầm xe', đảm bảo khi xe rời đi sau nhiều giờ đỗ, hệ thống lập tức phát hiện ô trống trở lại mà không bị lệch mức chuẩn.", "Đóng băng đường nền (Freeze Baseline):")

    # =========================================================================
    # PHẦN 4: THIẾT KẾ CÁC TRỤ CỘT LẬP TRÌNH MẠNG
    # =========================================================================
    add_h1("PHẦN 4: THIẾT KẾ CHI TIẾT CÁC TRỤ CỘT LẬP TRÌNH MẠNG")

    add_h2("4.1. Trụ cột 1: Thêm chỗ động & Cấu hình tập trung từ Web (Express Dynamic Routing)")
    add_bullet(" Trên giao diện Web Dashboard, quản trị viên bấm nút '+ Thêm Hàng Mới' để nhập Mã Node (ví dụ ESP-01), Khu vực (Zone_A), Số lượng ô đỗ (3 ô) và ngưỡng cảm biến.", "Quản trị tập trung:")
    add_bullet(" Máy chủ Express tiếp nhận yêu cầu qua endpoint động: app.post('/api/nodes/:id/setup', ...). Server lưu cấu hình vào cấu trúc dữ liệu Map() (Slide 16-18 Chương 3), sau đó phát lệnh cấu hình xuống ESP32.", "Định tuyến tham số động (Slide 42 Chương 3):")
    add_bullet(" ESP32 nhận gói cấu hình và lưu vào bộ nhớ Preferences (NVS Flash). Khi mất điện hoặc reset, ESP32 tự động nhớ cấu hình mà không cần nạp lại mã nguồn.", "Lưu trữ bền vững trên ESP32:")

    add_h2("4.2. Trụ cột 2: Tối ưu hóa băng thông bằng Giao thức nhị phân 1-Byte (Binary Bitmask)")
    p_bit = doc.add_paragraph()
    format_p(p_bit)
    p_bit.add_run("Toàn bộ dữ liệu trạng thái của một hàng xe (3 vị trí đỗ, cảm biến đếm xe vào hàng, cảm biến cháy, trạng thái chữa cháy) được nén gọn trong duy nhất 1 Byte (8 bits):")

    # BẢNG ĐẶC TẢ GIAO THỨC 1-BYTE
    tbl_bits = doc.add_table(rows=9, cols=5)
    tbl_bits.alignment = WD_TABLE_ALIGNMENT.CENTER
    headers = ["Bit", "Tên trường", "Giá trị 0", "Giá trị 1", "Ý nghĩa chức năng kỹ thuật"]
    col_widths = [Inches(0.8), Inches(1.3), Inches(1.1), Inches(1.1), Inches(2.3)]

    # Header row
    hdr_cells = tbl_bits.rows[0].cells
    for i, h in enumerate(headers):
        hdr_cells[i].text = h
        hdr_cells[i].paragraphs[0].runs[0].bold = True
        hdr_cells[i].paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        set_cell_background(hdr_cells[i], "003366")
        set_cell_padding(hdr_cells[i], 80, 80, 100, 100)
        hdr_cells[i].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    bit_data = [
        ("Bit 0", "SLOT_1", "Trống", "Có xe", "Trạng thái vị trí đỗ số 1"),
        ("Bit 1", "SLOT_2", "Trống", "Có xe", "Trạng thái vị trí đỗ số 2"),
        ("Bit 2", "SLOT_3", "Trống", "Có xe", "Trạng thái vị trí đỗ số 3"),
        ("Bit 3", "IR_PASS", "Không", "Có xe qua", "Cảm biến hồng ngoại đếm xe cổng hàng"),
        ("Bit 4", "FIRE_ALARM", "Bình thường", "BÁO CHÁY", "Tín hiệu nút gạt/cảm biến khẩn cấp"),
        ("Bit 5", "EXTINGUISH", "Bơm tắt", "Bơm đang phun", "Trạng thái relay van xả chữa cháy"),
        ("Bit 6", "NODE_FAULT", "Tốt", "Lỗi", "Cảnh báo lỗi phần cứng hoặc đứt dây"),
        ("Bit 7", "RESERVED", "0", "-", "Dự phòng mở rộng giao thức")
    ]

    for row_idx, data in enumerate(bit_data, start=1):
        row_cells = tbl_bits.rows[row_idx].cells
        bg_col = "F8FAFC" if row_idx % 2 == 1 else "FFFFFF"
        for col_idx, val in enumerate(data):
            row_cells[col_idx].text = val
            set_cell_background(row_cells[col_idx], bg_col)
            set_cell_padding(row_cells[col_idx], 60, 60, 100, 100)
            p = row_cells[col_idx].paragraphs[0]
            format_p(p, space_before=0, space_after=0, line_spacing=1.1, 
                     align=WD_ALIGN_PARAGRAPH.CENTER if col_idx in [0, 2, 3] else WD_ALIGN_PARAGRAPH.LEFT)

    p_eff = doc.add_paragraph()
    format_p(p_eff, space_before=8, space_after=6)
    p_eff.add_run("Hiệu quả vượt trội: ").bold = True
    p_eff.add_run("So với chuỗi văn bản JSON (~70–100 Bytes), gói tin nhị phân 1-Byte giảm 98.5% băng thông mạng LAN. Trình duyệt Web giải mã trực tiếp bằng ArrayBuffer và DataView trong thời gian chưa tới 1 millisecond.")

    add_h2("4.3. Trụ cột 3: Quản lý nhóm kênh phân tán & Duy trì kết nối (Socket Rooms & Ping/Pong)")
    add_bullet(" Node 1 tham gia room_zone_A, Node 2 tham gia room_zone_B. Máy chủ quản lý danh sách Node qua đối tượng Map() của JavaScript (Slide 16-18 Chương 3).", "Khai thác Socket.IO Rooms (Slide 10–23 Chương 3):")
    add_bullet(" Server định kỳ gửi gói ping mỗi 5 giây. Nếu quá 15 giây không có dữ liệu phản hồi, Server lập tức chuyển trạng thái Node trên Web sang OFFLINE.", "Cơ chế Heartbeat (Ping/Pong):")
    add_bullet(" Khi Node 1 phát hiện bit FIRE_ALARM = 1, Server gửi lệnh ngược về Node 1 để hú còi và bật relay xả nước; đồng thời broadcast sang Room của Node 2 để kích hoạt cảnh báo di tản toàn bãi.", "Điều khiển hai chiều khẩn cấp (Full-Duplex):")

    add_h2("4.4. Trụ cột 4: Nạp Firmware từ xa qua Web OTA (Stream & Pipe - Chương 2)")
    add_bullet(" Quản trị viên chỉ cần kéo thả file firmware .bin biên dịch từ PlatformIO trực tiếp lên giao diện Web tại ô quản lý Node tương ứng mà không cần cắm cáp nạp.", "Kéo thả từ trình duyệt:")
    add_bullet(" Máy chủ Node.js tiếp nhận file dưới dạng luồng (ReadableStream), chia thành các khối dữ liệu nhỏ (highWaterMark: 4096 bytes) và pipe thẳng sang kết nối HTTP POST Stream của ESP32 thông qua thư viện Update.h.", "Nối ống dẫn (Pipe Stream):")
    add_bullet(" Trình duyệt Web hiển thị thanh tiến trình % nạp theo thời gian thực. Nạp xong ESP32 tự khởi động lại và chạy bản firmware mới mượt mà.", "Hiển thị tiến trình trực quan:")

    # =========================================================================
    # PHẦN 5: ĐÁNH GIÁ TÍNH KHẢ THI VÀ ĐỘ KHÓ DỰ ÁN
    # =========================================================================
    add_h1("PHẦN 5: ĐÁNH GIÁ TÍNH KHẢ THI VÀ ĐỘ KHÓ DỰ ÁN")

    tbl_eval = doc.add_table(rows=7, cols=3)
    tbl_eval.alignment = WD_TABLE_ALIGNMENT.CENTER
    headers_eval = ["Tiêu chí đánh giá", "Mức độ", "Phân tích chi tiết & Đối chiếu bài giảng"]

    hdr_cells = tbl_eval.rows[0].cells
    for i, h in enumerate(headers_eval):
        hdr_cells[i].text = h
        hdr_cells[i].paragraphs[0].runs[0].bold = True
        hdr_cells[i].paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        set_cell_background(hdr_cells[i], "003366")
        set_cell_padding(hdr_cells[i], 80, 80, 100, 100)
        hdr_cells[i].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    eval_data = [
        ("Tính khả thi phần cứng", "10 / 10", "Linh kiện giá rẻ, cực kỳ sẵn có tại Việt Nam (ESP32: ~80k, LDR + trở: ~5k/ô, IR: ~15k, còi + relay: ~20k). Sa bàn 1.0m x 1.5m rất vừa vặn để đặt trên bàn bảo vệ."),
        ("Tính tương thích giáo trình", "10 / 10", "Khớp 100% nội dung giảng dạy của Thầy Khanh: Express dynamic routes (:id), Socket.IO Rooms, Map trong JS, Stream & Pipe (highWaterMark), Client-Server."),
        ("Độ khó thuật toán biên (DSP)", "6.0 / 10", "Công thức lọc EMA chỉ vài dòng số học thực trên C++, thực thi cực nhanh, hoàn toàn khả thi trên ESP32."),
        ("Độ khó giao thức nhị phân", "7.0 / 10", "Đóng gói bit trên C++ và bóc tách bit bằng DataView trên JS. Độ khó chuẩn mực cho đồ án điểm 9–10."),
        ("Độ khó Web Setup & Web OTA", "8.0 / 10", "Sử dụng Express Dynamic Params và nối Pipe Stream từ Web tới ESP32. Đây là điểm sáng vượt trội so với các đồ án thông thường."),
        ("Thời gian triển khai", "2–3 tuần", "Nhóm 4 bạn sinh viên hoàn toàn làm kịp tiến độ báo cáo cuối kỳ.")
    ]

    for row_idx, data in enumerate(eval_data, start=1):
        row_cells = tbl_eval.rows[row_idx].cells
        bg_col = "F8FAFC" if row_idx % 2 == 1 else "FFFFFF"
        for col_idx, val in enumerate(data):
            row_cells[col_idx].text = val
            set_cell_background(row_cells[col_idx], bg_col)
            set_cell_padding(row_cells[col_idx], 60, 60, 100, 100)
            p = row_cells[col_idx].paragraphs[0]
            format_p(p, space_before=0, space_after=0, line_spacing=1.1,
                     align=WD_ALIGN_PARAGRAPH.CENTER if col_idx == 1 else WD_ALIGN_PARAGRAPH.LEFT)
            if col_idx == 1:
                p.runs[0].bold = True

    doc.add_paragraph().paragraph_format.space_after = Pt(4)

    # =========================================================================
    # PHẦN 6: KỊCH BẢN DEMO THỰC TẾ & BẢO VỆ
    # =========================================================================
    add_h1("PHẦN 6: KỊCH BẢN DEMO THỰC TẾ VÀ ĐIỂM NHẤN BẢO VỆ")

    add_h2("6.1. Kịch bản thực nghiệm 5 bước trước Hội đồng chấm thi")
    add_bullet(" Mở Web Dashboard. Bấm '+ Thêm Hàng xe mới', chọn Hàng A, thiết lập 3 ô đỗ. Giao diện Web hiển thị ngay sa bàn Hàng A với 3 ô đỗ màu xanh lá cây (Trống).", "Bước 1: Quản trị & Cấu hình Hàng xe trên Web:")
    add_bullet(" Kéo thả file firmware .bin lên Web. Thanh tiến trình % hiển thị quá trình stream dữ liệu. ESP32 nhận firmware và khởi động lại trơn tru không cần cắm dây nạp.", "Bước 2: Nạp cấu hình & Firmware từ xa (Web OTA):")
    add_bullet(" Đẩy mô hình ô tô qua cảm biến IR => Web tăng số đếm xe vào hàng. Xe vào vị trí ô 1 che quang trở => Ô 1 đổi màu Đỏ tức thì (< 30ms). Dùng đèn flash điện thoại rọi thử => Thuật toán EMA tự động bám sáng nền, không bị nhảy trạng thái sai.", "Bước 3: Trải nghiệm đỗ xe & Kiểm tra chống nhiễu:")
    add_bullet(" Gạt công tắc khẩn cấp => Còi hú tại Node 1 kêu, Web nhấp nháy đỏ báo động toàn bãi, relay van chữa cháy đóng để xả nước cứu hỏa.", "Bước 4: Sự cố khẩn cấp (Báo cháy & Chữa cháy):")
    add_bullet(" Bật script virtual_nodes.js => 3 dãy xe Hàng C, D, E xuất hiện và đổi màu xe ra vào liên tục, minh chứng khả năng chịu tải Multi-Client.", "Bước 5: Trình diễn mở rộng bãi xe (Virtual Nodes):")

    add_h2("6.2. 'Vũ khí điểm 10': Minh chứng bắt gói tin thực tế bằng Wireshark")
    p_ws = doc.add_paragraph()
    format_p(p_ws)
    p_ws.add_run("Trong buổi bảo vệ, nhóm trực tiếp mở phần mềm Wireshark lọc theo cổng WebSocket 3000:\n")
    add_bullet(" Chỉ trực tiếp vào khung WebSocket Data Frame: Trường Payload Data có kích thước đúng 1 Byte duy nhất (ví dụ 0x01 khi xe đỗ ô 1).", "Minh chứng Payload 1-Byte:")
    add_bullet(" 'Thưa thầy, hệ thống thông thường gửi chuỗi JSON tốn 70–100 byte, ở đây nhóm em nén toàn bộ trạng thái trong đúng 1 byte nhị phân, giảm 98.5% băng thông và giảm thiểu độ trễ tầng vận chuyển!'", "Thuyết trình thuyết phục:")

    # =========================================================================
    # PHẦN 7: PHÂN CÔNG NHIỆM VỤ THỰC HIỆN TRONG NHÓM
    # =========================================================================
    add_h1("PHẦN 7: PHÂN CÔNG NHIỆM VỤ CHI TIẾT TRONG NHÓM 3")

    tbl_team = doc.add_table(rows=5, cols=3)
    tbl_team.alignment = WD_TABLE_ALIGNMENT.CENTER
    headers_team = ["Thành viên", "Trách nhiệm chính", "Chi tiết công việc phụ trách"]

    hdr_cells = tbl_team.rows[0].cells
    for i, h in enumerate(headers_team):
        hdr_cells[i].text = h
        hdr_cells[i].paragraphs[0].runs[0].bold = True
        hdr_cells[i].paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
        set_cell_background(hdr_cells[i], "003366")
        set_cell_padding(hdr_cells[i], 80, 80, 100, 100)
        hdr_cells[i].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    team_data = [
        ("Lê Minh Triết\n(Nhóm trưởng)", "Kiến trúc mạng &\nLập trình Server Node.js", "- Xây dựng Express server, API dynamic routes (/api/nodes/:id/setup).\n- Triển khai luồng Web OTA Stream & Pipe file firmware.\n- Quản lý Socket.IO Rooms và đối tượng Map()."),
        ("Thạch Thảo", "Giao diện Web Dashboard &\nGiải mã nhị phân", "- Thiết kế giao diện Dashboard sa bàn bãi đỗ xe.\n- Lập trình UI thêm hàng xe động và form setup cấu hình.\n- Lập trình giải mã nhị phân bằng DataView trên JavaScript."),
        ("Trương Đình Trí", "Firmware ESP32 &\nXử lý biên thích nghi", "- Lập trình PlatformIO C++ cho ESP32 Client 1 và Client 2.\n- Triển khai thuật toán lọc EMA bù sáng và Freeze Baseline.\n- Đóng gói dữ liệu nhị phân 1-Byte và nhận nạp Web OTA qua Update.h."),
        ("Đỗ Thanh Đức", "Sa bàn phần cứng &\nKịch bản Node ảo", "- Gia công mô hình sa bàn bãi xe 1m x 1.5m, đấu dây cảm biến.\n- Viết script Node.js mô phỏng 3 Node ảo để test mở rộng bãi xe.\n- Chuẩn bị kịch bản thực nghiệm bắt gói Wireshark.")
    ]

    for row_idx, data in enumerate(team_data, start=1):
        row_cells = tbl_team.rows[row_idx].cells
        bg_col = "F8FAFC" if row_idx % 2 == 1 else "FFFFFF"
        for col_idx, val in enumerate(data):
            row_cells[col_idx].text = val
            set_cell_background(row_cells[col_idx], bg_col)
            set_cell_padding(row_cells[col_idx], 60, 60, 100, 100)
            p = row_cells[col_idx].paragraphs[0]
            format_p(p, space_before=0, space_after=0, line_spacing=1.1,
                     align=WD_ALIGN_PARAGRAPH.CENTER if col_idx in [0, 1] else WD_ALIGN_PARAGRAPH.LEFT)
            if col_idx == 0:
                p.runs[0].bold = True

    # Lưu tài liệu
    output_path = 'doc/Y_TUONG_DO_AN_FINAL.docx'
    doc.save(output_path)
    print(f"XUẤT THÀNH CÔNG: {output_path}")

if __name__ == '__main__':
    create_document()
