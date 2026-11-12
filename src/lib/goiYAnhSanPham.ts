/**
 * ẢNH CẦN CHỤP CHO MỘT SẢN PHẨM — đề xuất cho NGƯỜI làm (12/11/2026)
 *
 * Chủ shop: "khi đăng sản phẩm thì cần làm hình ảnh gì đề xuất cho con người làm". Không tạo ảnh bằng AI — chỉ ra DANH SÁCH ẢNH
 * nhân viên cần chụp / dựng cho từng mặt hàng, theo thứ tự ưu tiên, kèm cách chụp, để đăng Shopee (và các sàn khác) không bị
 * thiếu ảnh, khách đỡ hỏi, đỡ trả hàng.
 *
 * Hàm thuần (không đọc CSDL): vào là tên, nhóm hàng (+ nhóm cha), mô tả, số ảnh đang có trong kho Kengi; ra là danh sách ảnh nên
 * có + mức thiếu. Nhận ngành bằng từ khoá CÓ DẤU, ranh giới từ (không khớp "giày" vào "giấy", "đầm" vào "đậm") — một sản phẩm có
 * thể thuộc nhiều nhóm (máy khoan pin = dụng cụ + đồ điện), ảnh gộp lại không trùng.
 *
 * ⚠ Nguồn: hướng dẫn đăng bán của Shopee + kinh nghiệm bán hàng phổ biến. Con số ĐÃ chắc chắn: tối đa 9 ảnh / sản phẩm (trang
 * thông tin sản phẩm cũng chặn 9). Còn lại (ảnh vuông, cỡ từ khoảng 500 px, một số ngành đòi tối thiểu 3 ảnh, bảng size thời trang
 * / giày dép) ghi dạng "nên" / "nhiều ngành" — quy định từng ngành vẫn xem lúc đăng trên Seller Center. Giới hạn video (độ dài,
 * dung lượng) CHƯA kiểm được ⇒ không ghi số.
 */

export type NganhAnh = 'thoi_trang' | 'giay_dep' | 'dung_cu' | 'dien_tu' | 'my_pham' | 'thuc_pham' | 'me_be' | 'gia_dung'

export interface AnhCanChup {
    /** mã ổn định (giao diện đánh dấu đã chụp theo mã) */
    ma: string
    ten: string
    /** chụp thế nào — một hai câu, nói cho người cầm máy */
    cach: string
    /** thiếu ảnh này thì đăng dễ bị từ chối / khách không mua — làm trước */
    batBuoc: boolean
    /** ảnh này đến từ nhóm ngành nào ('chung' = mọi sản phẩm) */
    nhom: NganhAnh | 'chung'
}

export interface GoiYAnh {
    nganh: { ma: NganhAnh; ten: string }[]
    soAnh: number
    toiDa: number
    nenCo: number
    toiThieu: number
    /** chua_co: 0 ảnh · thieu: dưới mức tối thiểu · nen_them: chưa đủ mức nên có · du: đủ */
    muc: 'chua_co' | 'thieu' | 'nen_them' | 'du'
    /** cần thêm bao nhiêu ảnh để đủ mức nên có (0 khi đủ) */
    canThem: number
    tomTat: string
    /** danh sách theo thứ tự ưu tiên — bắt buộc trước; Shopee nhận tối đa `toiDa` ảnh nên chọn từ trên xuống */
    anh: AnhCanChup[]
    video: string
    luuY: string[]
    nguon: string
}

export const TOI_DA_ANH = 9
/** mức nên có — 7 ảnh trở lên là đủ các góc + chi tiết + ảnh dùng thật */
export const NEN_CO_ANH = 7
/** một số ngành Shopee không cho đăng dưới 3 ảnh — dùng làm mức "thiếu" cho mọi mặt hàng */
export const TOI_THIEU_ANH = 3

const TEN_NGANH: Record<NganhAnh, string> = {
    thoi_trang: 'Thời trang', giay_dep: 'Giày dép', dung_cu: 'Dụng cụ / máy công cụ', dien_tu: 'Đồ điện / điện tử',
    my_pham: 'Mỹ phẩm / chăm sóc', thuc_pham: 'Thực phẩm', me_be: 'Mẹ & bé / đồ chơi', gia_dung: 'Gia dụng / nhà cửa',
}

/** Từ khoá CÓ DẤU (chữ thường) — so nguyên từ / cụm từ. Thứ tự ngành = thứ tự ảnh riêng trong danh sách. */
const TU_KHOA: [NganhAnh, string[]][] = [
    // ⚠ tránh từ đơn hai nghĩa: "tất" (tất cả), "bánh" (bánh xe), "đĩa" (đĩa cắt), "sữa" (sữa tắm), "chuột" (bẫy chuột), "bàn"
    // (bàn phím), "son" — dùng cụm. Không có dấu ("giay") thì KHÔNG nhận: "giấy" và "giày" cùng một chữ khi bỏ dấu.
    ['thoi_trang', ['áo thun', 'áo phông', 'áo sơ mi', 'sơ mi', 'áo khoác', 'áo polo', 'áo len', 'áo nỉ', 'áo hoodie', 'hoodie', 'áo dài', 'áo croptop',
        'áo', 'quần', 'váy', 'chân váy', 'đầm', 'jean', 'jeans', 'kaki', 'đồ bộ', 'đồ ngủ', 'đồng phục', 'thời trang', 'quần áo', 'bikini', 'nội y',
        'tất chân', 'đôi tất', 'tất nam', 'tất nữ', 'vớ']],
    ['giay_dep', ['giày', 'dép', 'sandal', 'sneaker', 'boot', 'bốt', 'guốc', 'xăng đan', 'giày dép']],
    ['dung_cu', ['khoan', 'máy khoan', 'máy cắt', 'máy mài', 'máy bắn vít', 'máy vặn vít', 'máy hàn', 'máy cưa', 'cưa', 'cờ lê', 'mỏ lết', 'tua vít', 'tô vít',
        'kìm', 'búa', 'bộ dụng cụ', 'dụng cụ', 'đồ nghề', 'máy bơm', 'máy rửa xe', 'máy xịt rửa', 'máy nén khí', 'mũi khoan', 'lưỡi cắt', 'đá mài', 'đĩa cắt',
        'đĩa mài', 'ê tô', 'cần siết', 'đầu khẩu', 'máy phun', 'máy đục', 'máy chà nhám', 'máy thổi', 'súng bắn keo', 'thước', 'máy công cụ', 'cầm tay']],
    ['dien_tu', ['điện thoại', 'sạc', 'cáp', 'pin', 'tai nghe', 'loa', 'quạt', 'nồi cơm', 'nồi chiên', 'bếp điện', 'bếp từ', 'máy sấy', 'ấm siêu tốc', 'đèn',
        'camera', 'router', 'wifi', 'bàn phím', 'chuột máy tính', 'chuột không dây', 'chuột gaming', 'màn hình', 'tivi', 'tủ lạnh', 'máy lọc', 'máy xay',
        'bàn là', 'bàn ủi', 'máy hút', 'ổ cắm', 'công tắc', 'adapter', 'điện tử', 'điện máy', 'đồ điện', 'thiết bị điện', 'đồng hồ thông minh', 'smartwatch',
        'usb', 'thẻ nhớ', 'máy in', 'pin sạc', 'sạc dự phòng']],
    ['my_pham', ['mỹ phẩm', 'kem dưỡng', 'kem chống nắng', 'serum', 'son môi', 'son dưỡng', 'son kem', 'son thỏi', 'son tint', 'sữa rửa mặt', 'toner', 'mặt nạ',
        'dầu gội', 'dầu xả', 'sữa tắm', 'nước hoa', 'tẩy trang', 'phấn', 'mascara', 'dưỡng da', 'dưỡng ẩm', 'lotion', 'kem nền', 'chăm sóc da', 'chăm sóc tóc']],
    ['thuc_pham', ['thực phẩm', 'bánh kẹo', 'bánh quy', 'bánh tráng', 'bánh ngọt', 'bánh mì', 'bánh pía', 'bánh trung thu', 'kẹo', 'trà', 'cà phê', 'hạt điều',
        'hạt dinh dưỡng', 'gia vị', 'nước mắm', 'mì', 'bún', 'phở', 'snack', 'mứt', 'ô mai', 'mật ong', 'yến', 'đồ ăn', 'đồ uống', 'nước giải khát',
        'sữa bột', 'sữa tươi', 'sữa hạt', 'sữa chua', 'sữa đặc', 'ngũ cốc', 'khô gà', 'khô bò', 'đặc sản']],
    // "xe đẩy" một mình KHÔNG nhận (xe đẩy hàng là dụng cụ) — xe đẩy em bé / cho bé đã có "em bé", "cho bé"
    ['me_be', ['đồ chơi', 'bỉm', 'tã', 'bình sữa', 'lego', 'búp bê', 'mẹ và bé', 'mẹ & bé', 'trẻ em', 'cho bé', 'em bé', 'sơ sinh']],
    ['gia_dung', ['nồi', 'chảo', 'bát', 'chén', 'bát đĩa', 'đĩa ăn', 'đĩa sứ', 'ly', 'cốc', 'hộp đựng', 'kệ', 'giá treo', 'chăn', 'ga giường', 'gối', 'rèm',
        'thảm', 'khăn', 'móc treo', 'thùng rác', 'chổi', 'cây lau', 'gia dụng', 'nhà bếp', 'nhà cửa', 'đồ dùng nhà', 'phòng tắm', 'bàn ăn', 'bàn làm việc', 'ghế',
        'tủ quần áo', 'tủ giày', 'kệ giày', 'móc quần áo', 'giá phơi',
        // đồ giữ nhiệt / đựng nước (HUTI bán nhiều — thử máy chủ giả 12/11 thấy "Bình giữ nhiệt" không nhận ngành nào); KHÔNG thêm
        // "ấm" một mình ("áo giữ ấm" thành gia dụng) — "ấm siêu tốc" đã ở đồ điện
        'bình giữ nhiệt', 'cốc giữ nhiệt', 'ly giữ nhiệt', 'bình nước', 'bình đựng nước', 'hộp cơm', 'phích']],
]

/** Cụm CHỨA từ khoá của ngành nhưng không phải hàng ngành đó (áo gối = vỏ gối, tủ giày = đồ nội thất…) — bỏ trước khi soát. */
const LOAI_TRU: Partial<Record<NganhAnh, string[]>> = {
    thoi_trang: ['áo gối', 'áo nệm', 'áo trùm', 'áo ghế', 'áo xe', 'áo bọc', 'áo chăn', 'tủ quần áo', 'móc quần áo', 'kẹp quần áo',
        'giá phơi quần áo', 'sào phơi quần áo', 'máy giặt quần áo', 'bàn chải quần áo'],
    giay_dep: ['tủ giày', 'kệ giày', 'kệ để giày', 'giá để giày', 'xi đánh giày', 'bàn chải giày'],
}

const thoat = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** khớp NGUYÊN từ / cụm (ranh giới là ký tự không phải chữ / số Unicode — \b của JS không hiểu chữ có dấu) */
function coTu(chu: string, tu: string[]): boolean {
    if (!tu.length || !chu) return false
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${tu.map(thoat).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu').test(chu)
}

/** Nhóm ngành của sản phẩm theo tên + nhóm hàng (+ nhóm cha). Có thể nhiều ngành; không khớp gì ⇒ [] (chỉ ảnh chung). */
export function nhanNganhAnh(o: { ten?: string | null; nhomHang?: string | null; nhomCha?: (string | null | undefined)[] | null }): NganhAnh[] {
    const chu = [o.ten, o.nhomHang, ...(o.nhomCha || [])].filter(Boolean).join(' · ').normalize('NFC').toLowerCase()
    if (!chu.trim()) return []
    const ra: NganhAnh[] = []
    for (const [ma, tu] of TU_KHOA) {
        // bỏ các cụm loại trừ rồi mới soát: "Áo gối lụa" không phải thời trang, "Áo thun + áo gối" vẫn là
        let c = chu
        for (const k of LOAI_TRU[ma] || []) c = c.split(k).join(' ')
        if (coTu(c, tu)) ra.push(ma)
    }
    return ra
}

const anh = (nhom: AnhCanChup['nhom'], ma: string, ten: string, cach: string, batBuoc = false): AnhCanChup => ({ ma, ten, cach, batBuoc, nhom })

/** Ảnh mọi sản phẩm cần — ba ảnh đầu là bắt buộc (ảnh bìa, các góc, cận chi tiết). */
const CHUNG_DAU: AnhCanChup[] = [
    anh('chung', 'anh_bia', 'Ảnh bìa nền trắng',
        'Nền trắng hoặc trơn sáng, chụp chính diện, sản phẩm chiếm khoảng 70–90% khung, ảnh vuông. Đây là ảnh khách thấy ở kết quả tìm kiếm: không chèn chữ khuyến mãi, số điện thoại, logo sàn khác.', true),
    anh('chung', 'cac_goc', 'Các góc còn lại',
        'Mặt sau, hai bên, góc nghiêng 45° — đủ để khách hình dung sản phẩm khi cầm trên tay.', true),
    anh('chung', 'can_chi_tiet', 'Cận chi tiết',
        'Cận chất liệu, đường hoàn thiện, logo / tem hãng, mã model trên thân — chỗ khách hay soi để biết hàng thật, hàng tốt.', true),
]
const CHUNG_SAU: AnhCanChup[] = [
    anh('chung', 'kich_thuoc', 'Kích thước thật',
        'Đặt cạnh thước, bàn tay hoặc vật quen thuộc (điện thoại, cây bút) và ghi số đo (cm) lên ảnh — giảm hẳn đơn trả vì "nhỏ hơn tưởng".'),
    anh('chung', 'dang_dung', 'Đang sử dụng',
        'Sản phẩm lúc đang dùng thật / đặt trong bối cảnh thật (trên bàn, trong bếp, ngoài công trình…).'),
    anh('chung', 'tron_bo', 'Trọn bộ khách nhận',
        'Bày hết những gì có trong hộp: sản phẩm, phụ kiện, sách hướng dẫn, hộp — đúng như lúc giao.'),
    anh('chung', 'thong_tin_chinh', 'Ảnh tóm tắt điểm chính',
        'Một ảnh ghi 3–5 điểm chính (chất liệu, kích thước, công suất, bảo hành…) chữ to dễ đọc — chỉ thông tin THẬT, không ghi giá, không số điện thoại.'),
]

const RIENG: Record<NganhAnh, AnhCanChup[]> = {
    thoi_trang: [
        anh('thoi_trang', 'bang_size', 'Bảng size',
            'Số đo từng size theo cm (dài áo, ngang vai, vòng ngực / eo / mông, dài quần…) làm thành ảnh rõ chữ. Nhiều ngành thời trang trên Shopee bắt buộc bảng size khi đăng.', true),
        anh('thoi_trang', 'mac_that', 'Ảnh mặc trên người',
            'Người mặc thật, toàn thân và nửa người; ghi chiều cao / cân nặng người mặc và size đang mặc (ví dụ "1m60, 50kg, mặc size M").'),
        anh('thoi_trang', 'trai_phang', 'Ảnh trải phẳng',
            'Trải phẳng trên nền trơn, chụp thẳng từ trên xuống, mặt trước và mặt sau — thấy rõ form dáng.'),
        anh('thoi_trang', 'can_vai', 'Cận chất vải',
            'Cận vải, đường may, cổ, tay, khoá kéo, nút — thấy được độ dày, độ co giãn.'),
        anh('thoi_trang', 'tung_mau', 'Mỗi màu một ảnh',
            'Mỗi màu chụp riêng dưới ánh sáng tự nhiên, không chỉnh màu — Shopee gắn được ảnh cho từng phân loại màu.'),
    ],
    giay_dep: [
        anh('giay_dep', 'bang_size_giay', 'Bảng size giày',
            'Bảng quy đổi size ↔ chiều dài bàn chân (cm), ghi rõ form rộng hay ôm. Nhiều ngành giày dép trên Shopee bắt buộc bảng size khi đăng.', true),
        anh('giay_dep', 'tren_chan', 'Mang trên chân',
            'Mang trên chân thật, đứng và bước — thấy độ ôm, độ cao.'),
        anh('giay_dep', 'de_giay', 'Đế giày',
            'Lật đế chụp rõ rãnh chống trơn, chất liệu đế, độ dày.'),
        anh('giay_dep', 'tren_xuong', 'Nhìn từ trên + hai cạnh',
            'Chụp từ trên xuống và hai cạnh bên để thấy độ rộng mũi, độ dày.'),
    ],
    dung_cu: [
        anh('dung_cu', 'cam_tay', 'Cầm trên tay',
            'Người cầm dụng cụ đúng tư thế dùng — thấy kích cỡ thật và cách cầm.'),
        anh('dung_cu', 'dang_lam', 'Đang làm việc',
            'Đang khoan / cắt / siết… trên vật liệu thật (gỗ, sắt, bê tông) — ảnh khách tin nhất.'),
        anh('dung_cu', 'dau_phu_kien', 'Đầu, mũi, phụ kiện',
            'Cận đầu kẹp, mũi khoan, lưỡi cắt, pin, sạc, hộp đựng đi kèm.'),
        anh('dung_cu', 'nhan_than_may', 'Nhãn trên thân máy',
            'Chụp nét nhãn trên thân: công suất, tốc độ (vòng/phút), điện áp pin, lực siết, model.'),
    ],
    dien_tu: [
        anh('dien_tu', 'tem_thong_so', 'Tem thông số',
            'Chụp nét tem / nhãn ghi công suất (W), điện áp (V), dung lượng (mAh), model — khách so thông số trước khi mua.', true),
        anh('dien_tu', 'cong_nut', 'Cổng kết nối, nút bấm',
            'Cận các cổng (USB-C, 3,5 mm…), nút, công tắc, đèn báo.'),
        anh('dien_tu', 'dang_chay', 'Đang hoạt động',
            'Bật lên: đèn sáng, màn hình hiện, quạt quay… chứng minh hàng chạy được.'),
        anh('dien_tu', 'bao_hanh', 'Tem bảo hành, chứng nhận',
            'Tem / phiếu bảo hành, tem hợp quy (CR) nếu có.'),
    ],
    my_pham: [
        anh('my_pham', 'nhan_phu', 'Nhãn phụ tiếng Việt',
            'Mặt sau: thành phần, cách dùng, hạn dùng, số công bố, nhà phân phối — chụp nét đọc được chữ.', true),
        anh('my_pham', 'ket_cau', 'Kết cấu (texture)',
            'Quệt / bóp một ít lên mu bàn tay hoặc mặt kính — thấy độ đặc và màu thật.'),
        anh('my_pham', 'dung_tich', 'Dung tích, cỡ chai',
            'Thấy rõ số ml / g trên vỏ, đặt cạnh bàn tay để hình dung cỡ chai.'),
        anh('my_pham', 'hop_tem', 'Hộp, chai, tem chống giả',
            'Hộp ngoài và chai bên trong, mã vạch, tem chống giả / tem nhập khẩu nếu có.'),
    ],
    thuc_pham: [
        anh('thuc_pham', 'nhan_hsd', 'Nhãn: thành phần, NSX, HSD',
            'Chụp nét nhãn có thành phần, khối lượng tịnh, ngày sản xuất, hạn sử dụng, nơi sản xuất.', true),
        anh('thuc_pham', 'ben_trong', 'Bên trong / khi dùng',
            'Mở gói, pha, bày ra đĩa — thấy hình dạng, màu, độ to thật.'),
        anh('thuc_pham', 'dong_goi', 'Quy cách đóng gói khi giao',
            'Gói hàng thực tế khách nhận (hộp, túi zip, chống vỡ) — đỡ hỏi đáp, đỡ đánh giá xấu.'),
    ],
    me_be: [
        anh('me_be', 'do_tuoi', 'Độ tuổi phù hợp, cảnh báo',
            'Chụp chỗ bao bì ghi độ tuổi, cảnh báo chi tiết nhỏ / hướng dẫn an toàn.'),
        anh('me_be', 'chung_nhan', 'Chứng nhận an toàn',
            'Tem hợp quy (CR), chứng nhận chất liệu (không BPA…) nếu có.'),
    ],
    gia_dung: [
        anh('gia_dung', 'khong_gian', 'Trong không gian thật',
            'Đặt trong bếp / phòng / bàn làm việc thật để khách hình dung cỡ và cách dùng.'),
        anh('gia_dung', 'chat_lieu', 'Cận chất liệu',
            'Cận bề mặt, chất liệu (inox, nhựa, gỗ…), đáy, nắp, mối nối.'),
    ],
}

export const LUU_Y_ANH: string[] = [
    `Shopee nhận tối đa ${TOI_DA_ANH} ảnh mỗi sản phẩm — chọn theo thứ tự danh sách (ảnh bắt buộc trước). Một số ngành không cho đăng dưới ${TOI_THIEU_ANH} ảnh.`,
    'Ảnh vuông (1:1), nên từ 1000×1000 px để khách phóng to xem chi tiết (ảnh quá nhỏ, cỡ dưới khoảng 500 px, dễ bị Shopee từ chối). Kengi tự nén cạnh dài về 2000 px khi tải lên.',
    'Không chèn số điện thoại, Zalo, đường link, mã QR, logo hay tên sàn khác — Shopee có thể hạ hiển thị hoặc khoá sản phẩm.',
    'Chụp hàng thật đang bán; không lấy ảnh mạng có hình mờ (watermark) của shop khác. Tắt bộ lọc làm đẹp — màu phải đúng hàng thật.',
    'Ánh sáng đều (gần cửa sổ ban ngày, hoặc hai đèn hai bên), nền gọn, máy đặt chắc tay.',
]

export const VIDEO_ANH = 'Nên có 1 video ngắn quay hàng thật: xoay quanh sản phẩm rồi cảnh đang dùng. Giới hạn độ dài / dung lượng video xem ngay lúc tải lên Seller Center.'
export const NGUON_ANH = 'Theo hướng dẫn đăng bán của Shopee và kinh nghiệm bán hàng phổ biến; quy định riêng từng ngành xem lúc đăng trên Seller Center.'

/** Đề xuất ảnh cho MỘT sản phẩm. `soAnh` = số ảnh đang có trong kho Kengi (trang Thông tin sản phẩm). */
export function goiYAnh(o: { ten?: string | null; nhomHang?: string | null; nhomCha?: (string | null | undefined)[] | null; soAnh?: number | null }): GoiYAnh {
    const nganh = nhanNganhAnh(o)
    const soAnh = Math.max(0, Math.floor(Number(o.soAnh) || 0))
    const rieng = nganh.flatMap(n => RIENG[n])
    // bắt buộc của ngành (bảng size, tem thông số, nhãn phụ…) đứng ngay sau ba ảnh chung bắt buộc
    const ds = [...CHUNG_DAU, ...rieng.filter(a => a.batBuoc), ...rieng.filter(a => !a.batBuoc), ...CHUNG_SAU]
    const daCo = new Set<string>()
    const anhRa = ds.filter(a => (daCo.has(a.ma) ? false : (daCo.add(a.ma), true)))
    const muc: GoiYAnh['muc'] = soAnh === 0 ? 'chua_co' : soAnh < TOI_THIEU_ANH ? 'thieu' : soAnh < NEN_CO_ANH ? 'nen_them' : 'du'
    const canThem = Math.max(0, NEN_CO_ANH - soAnh)
    const soBatBuoc = anhRa.filter(a => a.batBuoc).length
    const tomTat = muc === 'chua_co'
        ? `Chưa có ảnh nào — chụp ít nhất ${soBatBuoc} ảnh bắt buộc bên dưới (nên đủ ${NEN_CO_ANH}–${TOI_DA_ANH} ảnh) rồi mới đăng.`
        : muc === 'thieu'
            ? `Đang có ${soAnh}/${TOI_DA_ANH} ảnh — chưa đủ ${TOI_THIEU_ANH} ảnh (một số ngành Shopee không cho đăng). Chụp thêm theo thứ tự bên dưới.`
            : muc === 'nen_them'
                ? `Đang có ${soAnh}/${TOI_DA_ANH} ảnh — đăng được, nhưng nên thêm ${canThem} ảnh nữa (đủ ${NEN_CO_ANH}+) để khách đỡ hỏi, đỡ trả hàng.`
                : `Đang có ${soAnh}/${TOI_DA_ANH} ảnh — đủ số lượng; soát lại xem đã có đủ các ảnh bắt buộc bên dưới chưa.`
    return {
        nganh: nganh.map(ma => ({ ma, ten: TEN_NGANH[ma] })),
        soAnh, toiDa: TOI_DA_ANH, nenCo: NEN_CO_ANH, toiThieu: TOI_THIEU_ANH,
        muc, canThem, tomTat,
        anh: anhRa, video: VIDEO_ANH, luuY: LUU_Y_ANH, nguon: NGUON_ANH,
    }
}

/** Bản gọn cho danh sách (mỗi dòng sản phẩm trên Shopee Pilot): mức thiếu + mấy ảnh bắt buộc đầu — đủ để gắn nhãn "Thiếu ảnh". */
export function tomTatAnh(o: Parameters<typeof goiYAnh>[0]): { soAnh: number; muc: GoiYAnh['muc']; canThem: number; nganh: string[]; batBuoc: string[] } {
    const g = goiYAnh(o)
    return { soAnh: g.soAnh, muc: g.muc, canThem: g.canThem, nganh: g.nganh.map(n => n.ten), batBuoc: g.anh.filter(a => a.batBuoc).map(a => a.ten) }
}
