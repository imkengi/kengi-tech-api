// ─────────────────────────────────────────────────────────────────────────────
//  Chart of Accounts — Thông tư 99/2025/TT-BTC (unified, effective 01/01/2026)
//
//  TT99/2025 replaces BOTH TT200/2014 and TT133/2016 with a single accounting
//  regime for every enterprise. The account numbering is inherited from TT200,
//  so existing ledgers keep working; this seed is the FULL canonical account
//  list of the Vietnamese enterprise accounting system (loại 1 → 9 + ngoại
//  bảng), tên tài khoản CÓ DẤU đúng chuẩn.
//
//  Shared by:
//    - src/routes/tax.ts        (POST /api/tax/chart-of-accounts/seed)
//    - src/routes/accounts.ts   (GET/POST/PUT/DELETE /api/accounts)
//    - src/routes/admin.ts      (POST /api/admin/seed-coa — seed mọi store)
// ─────────────────────────────────────────────────────────────────────────────

export const COA_CIRCULAR = 'TT99/2025/TT-BTC'

export interface CoaSeedAccount {
    code: string
    name: string
    nameEn?: string
    level: number
    parentCode?: string
    type: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense' | 'OffBalance'
    nature: 'Debit' | 'Credit'
    description?: string
}

export const COA_SEED: CoaSeedAccount[] = [
    // ─── Loại 1: Tài sản ngắn hạn (Current assets) ──────────────────────────────
    { code: '111', name: 'Tiền mặt', nameEn: 'Cash on hand', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1111', name: 'Tiền Việt Nam', nameEn: 'Cash in VND', level: 2, parentCode: '111', type: 'Asset', nature: 'Debit' },
    { code: '1112', name: 'Ngoại tệ', nameEn: 'Cash in foreign currency', level: 2, parentCode: '111', type: 'Asset', nature: 'Debit' },
    { code: '1113', name: 'Vàng tiền tệ', nameEn: 'Monetary gold', level: 2, parentCode: '111', type: 'Asset', nature: 'Debit' },
    { code: '112', name: 'Tiền gửi ngân hàng', nameEn: 'Cash in bank', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1121', name: 'Tiền Việt Nam gửi ngân hàng', nameEn: 'Bank deposits in VND', level: 2, parentCode: '112', type: 'Asset', nature: 'Debit' },
    { code: '1122', name: 'Ngoại tệ gửi ngân hàng', nameEn: 'Bank deposits in foreign currency', level: 2, parentCode: '112', type: 'Asset', nature: 'Debit' },
    { code: '1123', name: 'Vàng tiền tệ gửi ngân hàng', nameEn: 'Monetary gold at bank', level: 2, parentCode: '112', type: 'Asset', nature: 'Debit' },
    { code: '113', name: 'Tiền đang chuyển', nameEn: 'Cash in transit', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1131', name: 'Tiền Việt Nam đang chuyển', nameEn: 'VND in transit', level: 2, parentCode: '113', type: 'Asset', nature: 'Debit' },
    { code: '1132', name: 'Ngoại tệ đang chuyển', nameEn: 'Foreign currency in transit', level: 2, parentCode: '113', type: 'Asset', nature: 'Debit' },
    { code: '121', name: 'Chứng khoán kinh doanh', nameEn: 'Trading securities', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1211', name: 'Cổ phiếu', nameEn: 'Shares', level: 2, parentCode: '121', type: 'Asset', nature: 'Debit' },
    { code: '1212', name: 'Trái phiếu', nameEn: 'Bonds', level: 2, parentCode: '121', type: 'Asset', nature: 'Debit' },
    { code: '1218', name: 'Chứng khoán và công cụ tài chính khác', nameEn: 'Other securities & financial instruments', level: 2, parentCode: '121', type: 'Asset', nature: 'Debit' },
    { code: '128', name: 'Đầu tư nắm giữ đến ngày đáo hạn', nameEn: 'Held-to-maturity investments', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1281', name: 'Tiền gửi có kỳ hạn', nameEn: 'Term deposits', level: 2, parentCode: '128', type: 'Asset', nature: 'Debit' },
    { code: '1282', name: 'Trái phiếu nắm giữ đến đáo hạn', nameEn: 'Held-to-maturity bonds', level: 2, parentCode: '128', type: 'Asset', nature: 'Debit' },
    { code: '1283', name: 'Cho vay', nameEn: 'Loans given', level: 2, parentCode: '128', type: 'Asset', nature: 'Debit' },
    { code: '1288', name: 'Các khoản đầu tư khác nắm giữ đến đáo hạn', nameEn: 'Other held-to-maturity investments', level: 2, parentCode: '128', type: 'Asset', nature: 'Debit' },
    { code: '131', name: 'Phải thu của khách hàng', nameEn: 'Trade receivables', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '133', name: 'Thuế GTGT được khấu trừ', nameEn: 'Deductible VAT', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1331', name: 'Thuế GTGT được khấu trừ của hàng hóa, dịch vụ', nameEn: 'Deductible VAT on goods & services', level: 2, parentCode: '133', type: 'Asset', nature: 'Debit' },
    { code: '1332', name: 'Thuế GTGT được khấu trừ của TSCĐ', nameEn: 'Deductible VAT on fixed assets', level: 2, parentCode: '133', type: 'Asset', nature: 'Debit' },
    { code: '136', name: 'Phải thu nội bộ', nameEn: 'Intra-company receivables', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1361', name: 'Vốn kinh doanh ở đơn vị trực thuộc', nameEn: 'Working capital at subsidiaries', level: 2, parentCode: '136', type: 'Asset', nature: 'Debit' },
    { code: '1362', name: 'Phải thu nội bộ về chênh lệch tỷ giá', nameEn: 'Intra-company FX differences receivable', level: 2, parentCode: '136', type: 'Asset', nature: 'Debit' },
    { code: '1363', name: 'Phải thu nội bộ về chi phí đi vay đủ điều kiện vốn hóa', nameEn: 'Intra-company capitalizable borrowing costs', level: 2, parentCode: '136', type: 'Asset', nature: 'Debit' },
    { code: '1368', name: 'Phải thu nội bộ khác', nameEn: 'Other intra-company receivables', level: 2, parentCode: '136', type: 'Asset', nature: 'Debit' },
    { code: '138', name: 'Phải thu khác', nameEn: 'Other receivables', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1381', name: 'Tài sản thiếu chờ xử lý', nameEn: 'Shortage of assets awaiting resolution', level: 2, parentCode: '138', type: 'Asset', nature: 'Debit' },
    { code: '1385', name: 'Phải thu về cổ phần hóa', nameEn: 'Receivables from equitization', level: 2, parentCode: '138', type: 'Asset', nature: 'Debit' },
    { code: '1388', name: 'Phải thu khác', nameEn: 'Miscellaneous receivables', level: 2, parentCode: '138', type: 'Asset', nature: 'Debit' },
    { code: '141', name: 'Tạm ứng', nameEn: 'Advances to employees', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '151', name: 'Hàng mua đang đi đường', nameEn: 'Goods in transit', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '152', name: 'Nguyên liệu, vật liệu', nameEn: 'Raw materials', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '153', name: 'Công cụ, dụng cụ', nameEn: 'Tools & supplies', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1531', name: 'Công cụ, dụng cụ', nameEn: 'Tools & supplies', level: 2, parentCode: '153', type: 'Asset', nature: 'Debit' },
    { code: '1532', name: 'Bao bì luân chuyển', nameEn: 'Returnable packaging', level: 2, parentCode: '153', type: 'Asset', nature: 'Debit' },
    { code: '1533', name: 'Đồ dùng cho thuê', nameEn: 'Rental equipment', level: 2, parentCode: '153', type: 'Asset', nature: 'Debit' },
    { code: '1534', name: 'Thiết bị, phụ tùng thay thế', nameEn: 'Spare parts', level: 2, parentCode: '153', type: 'Asset', nature: 'Debit' },
    { code: '154', name: 'Chi phí sản xuất, kinh doanh dở dang', nameEn: 'Work in progress', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '155', name: 'Thành phẩm', nameEn: 'Finished goods', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1551', name: 'Thành phẩm nhập kho', nameEn: 'Finished goods in warehouse', level: 2, parentCode: '155', type: 'Asset', nature: 'Debit' },
    { code: '1557', name: 'Thành phẩm bất động sản', nameEn: 'Real estate finished goods', level: 2, parentCode: '155', type: 'Asset', nature: 'Debit' },
    { code: '156', name: 'Hàng hóa', nameEn: 'Merchandise inventory', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1561', name: 'Giá mua hàng hóa', nameEn: 'Purchase cost of goods', level: 2, parentCode: '156', type: 'Asset', nature: 'Debit' },
    { code: '1562', name: 'Chi phí thu mua hàng hóa', nameEn: 'Purchasing expenses', level: 2, parentCode: '156', type: 'Asset', nature: 'Debit' },
    { code: '1567', name: 'Hàng hóa bất động sản', nameEn: 'Real estate goods', level: 2, parentCode: '156', type: 'Asset', nature: 'Debit' },
    { code: '157', name: 'Hàng gửi đi bán', nameEn: 'Goods on consignment', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '158', name: 'Hàng hóa kho bảo thuế', nameEn: 'Goods in bonded warehouse', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '161', name: 'Chi sự nghiệp', nameEn: 'Non-business expenditures', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '1611', name: 'Chi sự nghiệp năm trước', nameEn: 'Prior-year non-business expenditures', level: 2, parentCode: '161', type: 'Asset', nature: 'Debit' },
    { code: '1612', name: 'Chi sự nghiệp năm nay', nameEn: 'Current-year non-business expenditures', level: 2, parentCode: '161', type: 'Asset', nature: 'Debit' },
    { code: '171', name: 'Giao dịch mua bán lại trái phiếu Chính phủ', nameEn: 'Government bond repo transactions', level: 1, type: 'Asset', nature: 'Debit' },

    // ─── Loại 2: Tài sản dài hạn (Non-current assets) ───────────────────────────
    { code: '211', name: 'Tài sản cố định hữu hình', nameEn: 'Tangible fixed assets', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '2111', name: 'Nhà cửa, vật kiến trúc', nameEn: 'Buildings & structures', level: 2, parentCode: '211', type: 'Asset', nature: 'Debit' },
    { code: '2112', name: 'Máy móc, thiết bị', nameEn: 'Machinery & equipment', level: 2, parentCode: '211', type: 'Asset', nature: 'Debit' },
    { code: '2113', name: 'Phương tiện vận tải, truyền dẫn', nameEn: 'Vehicles & transmission equipment', level: 2, parentCode: '211', type: 'Asset', nature: 'Debit' },
    { code: '2114', name: 'Thiết bị, dụng cụ quản lý', nameEn: 'Office equipment', level: 2, parentCode: '211', type: 'Asset', nature: 'Debit' },
    { code: '2115', name: 'Cây lâu năm, súc vật làm việc và cho sản phẩm', nameEn: 'Perennial plants & working animals', level: 2, parentCode: '211', type: 'Asset', nature: 'Debit' },
    { code: '2118', name: 'TSCĐ hữu hình khác', nameEn: 'Other tangible fixed assets', level: 2, parentCode: '211', type: 'Asset', nature: 'Debit' },
    { code: '212', name: 'Tài sản cố định thuê tài chính', nameEn: 'Finance lease assets', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '2121', name: 'TSCĐ hữu hình thuê tài chính', nameEn: 'Tangible finance lease assets', level: 2, parentCode: '212', type: 'Asset', nature: 'Debit' },
    { code: '2122', name: 'TSCĐ vô hình thuê tài chính', nameEn: 'Intangible finance lease assets', level: 2, parentCode: '212', type: 'Asset', nature: 'Debit' },
    { code: '213', name: 'Tài sản cố định vô hình', nameEn: 'Intangible fixed assets', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '2131', name: 'Quyền sử dụng đất', nameEn: 'Land use rights', level: 2, parentCode: '213', type: 'Asset', nature: 'Debit' },
    { code: '2132', name: 'Quyền phát hành', nameEn: 'Publication rights', level: 2, parentCode: '213', type: 'Asset', nature: 'Debit' },
    { code: '2133', name: 'Bản quyền, bằng sáng chế', nameEn: 'Copyrights & patents', level: 2, parentCode: '213', type: 'Asset', nature: 'Debit' },
    { code: '2134', name: 'Nhãn hiệu, tên thương mại', nameEn: 'Trademarks & trade names', level: 2, parentCode: '213', type: 'Asset', nature: 'Debit' },
    { code: '2135', name: 'Chương trình phần mềm', nameEn: 'Software', level: 2, parentCode: '213', type: 'Asset', nature: 'Debit' },
    { code: '2136', name: 'Giấy phép và giấy phép nhượng quyền', nameEn: 'Licenses & franchises', level: 2, parentCode: '213', type: 'Asset', nature: 'Debit' },
    { code: '2138', name: 'TSCĐ vô hình khác', nameEn: 'Other intangible fixed assets', level: 2, parentCode: '213', type: 'Asset', nature: 'Debit' },
    { code: '214', name: 'Hao mòn tài sản cố định', nameEn: 'Accumulated depreciation', level: 1, type: 'Asset', nature: 'Credit' },
    { code: '2141', name: 'Hao mòn TSCĐ hữu hình', nameEn: 'Depreciation of tangible assets', level: 2, parentCode: '214', type: 'Asset', nature: 'Credit' },
    { code: '2142', name: 'Hao mòn TSCĐ thuê tài chính', nameEn: 'Depreciation of finance lease assets', level: 2, parentCode: '214', type: 'Asset', nature: 'Credit' },
    { code: '2143', name: 'Hao mòn TSCĐ vô hình', nameEn: 'Amortization of intangible assets', level: 2, parentCode: '214', type: 'Asset', nature: 'Credit' },
    { code: '2147', name: 'Hao mòn bất động sản đầu tư', nameEn: 'Depreciation of investment property', level: 2, parentCode: '214', type: 'Asset', nature: 'Credit' },
    { code: '217', name: 'Bất động sản đầu tư', nameEn: 'Investment property', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '221', name: 'Đầu tư vào công ty con', nameEn: 'Investments in subsidiaries', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '222', name: 'Đầu tư vào công ty liên doanh, liên kết', nameEn: 'Investments in joint ventures & associates', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '228', name: 'Đầu tư khác', nameEn: 'Other investments', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '2281', name: 'Đầu tư góp vốn vào đơn vị khác', nameEn: 'Equity investments in other entities', level: 2, parentCode: '228', type: 'Asset', nature: 'Debit' },
    { code: '2288', name: 'Đầu tư khác', nameEn: 'Miscellaneous investments', level: 2, parentCode: '228', type: 'Asset', nature: 'Debit' },
    { code: '229', name: 'Dự phòng tổn thất tài sản', nameEn: 'Provisions for asset losses', level: 1, type: 'Asset', nature: 'Credit' },
    { code: '2291', name: 'Dự phòng giảm giá chứng khoán kinh doanh', nameEn: 'Provision for trading securities', level: 2, parentCode: '229', type: 'Asset', nature: 'Credit' },
    { code: '2292', name: 'Dự phòng tổn thất đầu tư vào đơn vị khác', nameEn: 'Provision for investment losses', level: 2, parentCode: '229', type: 'Asset', nature: 'Credit' },
    { code: '2293', name: 'Dự phòng phải thu khó đòi', nameEn: 'Provision for doubtful debts', level: 2, parentCode: '229', type: 'Asset', nature: 'Credit' },
    { code: '2294', name: 'Dự phòng giảm giá hàng tồn kho', nameEn: 'Provision for inventory devaluation', level: 2, parentCode: '229', type: 'Asset', nature: 'Credit' },
    { code: '241', name: 'Xây dựng cơ bản dở dang', nameEn: 'Construction in progress', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '2411', name: 'Mua sắm TSCĐ', nameEn: 'Fixed asset acquisition', level: 2, parentCode: '241', type: 'Asset', nature: 'Debit' },
    { code: '2412', name: 'Xây dựng cơ bản', nameEn: 'Capital construction', level: 2, parentCode: '241', type: 'Asset', nature: 'Debit' },
    { code: '2413', name: 'Sửa chữa lớn TSCĐ', nameEn: 'Major repairs of fixed assets', level: 2, parentCode: '241', type: 'Asset', nature: 'Debit' },
    { code: '242', name: 'Chi phí trả trước', nameEn: 'Prepaid expenses', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '243', name: 'Tài sản thuế thu nhập hoãn lại', nameEn: 'Deferred tax assets', level: 1, type: 'Asset', nature: 'Debit' },
    { code: '244', name: 'Cầm cố, thế chấp, ký quỹ, ký cược', nameEn: 'Pledges, mortgages & deposits', level: 1, type: 'Asset', nature: 'Debit' },

    // ─── Loại 3: Nợ phải trả (Liabilities) ──────────────────────────────────────
    { code: '331', name: 'Phải trả cho người bán', nameEn: 'Trade payables', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '333', name: 'Thuế và các khoản phải nộp Nhà nước', nameEn: 'Taxes & state payables', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '3331', name: 'Thuế giá trị gia tăng phải nộp', nameEn: 'VAT payable', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '33311', name: 'Thuế GTGT đầu ra', nameEn: 'Output VAT', level: 3, parentCode: '3331', type: 'Liability', nature: 'Credit' },
    { code: '33312', name: 'Thuế GTGT hàng nhập khẩu', nameEn: 'VAT on imports', level: 3, parentCode: '3331', type: 'Liability', nature: 'Credit' },
    { code: '3332', name: 'Thuế tiêu thụ đặc biệt', nameEn: 'Special consumption tax', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '3333', name: 'Thuế xuất, nhập khẩu', nameEn: 'Import/export duties', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '3334', name: 'Thuế thu nhập doanh nghiệp', nameEn: 'Corporate income tax', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '3335', name: 'Thuế thu nhập cá nhân', nameEn: 'Personal income tax', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '3336', name: 'Thuế tài nguyên', nameEn: 'Natural resources tax', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '3337', name: 'Thuế nhà đất, tiền thuê đất', nameEn: 'Land & housing tax', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '3338', name: 'Thuế bảo vệ môi trường và các loại thuế khác', nameEn: 'Environmental & other taxes', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '33381', name: 'Thuế bảo vệ môi trường', nameEn: 'Environmental protection tax', level: 3, parentCode: '3338', type: 'Liability', nature: 'Credit' },
    { code: '33382', name: 'Các loại thuế khác', nameEn: 'Other taxes', level: 3, parentCode: '3338', type: 'Liability', nature: 'Credit' },
    { code: '3339', name: 'Phí, lệ phí và các khoản phải nộp khác', nameEn: 'Fees & other state payables', level: 2, parentCode: '333', type: 'Liability', nature: 'Credit' },
    { code: '334', name: 'Phải trả người lao động', nameEn: 'Payables to employees', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '3341', name: 'Phải trả công nhân viên', nameEn: 'Payables to staff', level: 2, parentCode: '334', type: 'Liability', nature: 'Credit' },
    { code: '3348', name: 'Phải trả người lao động khác', nameEn: 'Payables to other workers', level: 2, parentCode: '334', type: 'Liability', nature: 'Credit' },
    { code: '335', name: 'Chi phí phải trả', nameEn: 'Accrued expenses', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '336', name: 'Phải trả nội bộ', nameEn: 'Intra-company payables', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '337', name: 'Thanh toán theo tiến độ kế hoạch hợp đồng xây dựng', nameEn: 'Construction contract progress billing', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '338', name: 'Phải trả, phải nộp khác', nameEn: 'Other payables', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '3381', name: 'Tài sản thừa chờ giải quyết', nameEn: 'Surplus assets awaiting resolution', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '3382', name: 'Kinh phí công đoàn', nameEn: 'Trade union fund', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '3383', name: 'Bảo hiểm xã hội', nameEn: 'Social insurance', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '3384', name: 'Bảo hiểm y tế', nameEn: 'Health insurance', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '3385', name: 'Phải trả về cổ phần hóa', nameEn: 'Equitization payables', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '3386', name: 'Bảo hiểm thất nghiệp', nameEn: 'Unemployment insurance', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '3387', name: 'Doanh thu chưa thực hiện', nameEn: 'Unearned revenue', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '3388', name: 'Phải trả, phải nộp khác', nameEn: 'Miscellaneous payables', level: 2, parentCode: '338', type: 'Liability', nature: 'Credit' },
    { code: '341', name: 'Vay và nợ thuê tài chính', nameEn: 'Borrowings & finance lease liabilities', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '3411', name: 'Các khoản đi vay', nameEn: 'Borrowings', level: 2, parentCode: '341', type: 'Liability', nature: 'Credit' },
    { code: '3412', name: 'Nợ thuê tài chính', nameEn: 'Finance lease liabilities', level: 2, parentCode: '341', type: 'Liability', nature: 'Credit' },
    { code: '343', name: 'Trái phiếu phát hành', nameEn: 'Bonds issued', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '3431', name: 'Trái phiếu thường', nameEn: 'Ordinary bonds', level: 2, parentCode: '343', type: 'Liability', nature: 'Credit' },
    { code: '3432', name: 'Trái phiếu chuyển đổi', nameEn: 'Convertible bonds', level: 2, parentCode: '343', type: 'Liability', nature: 'Credit' },
    { code: '344', name: 'Nhận ký quỹ, ký cược', nameEn: 'Deposits received', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '347', name: 'Thuế thu nhập hoãn lại phải trả', nameEn: 'Deferred tax liabilities', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '352', name: 'Dự phòng phải trả', nameEn: 'Provisions for liabilities', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '3521', name: 'Dự phòng bảo hành sản phẩm hàng hóa', nameEn: 'Product warranty provision', level: 2, parentCode: '352', type: 'Liability', nature: 'Credit' },
    { code: '3522', name: 'Dự phòng bảo hành công trình xây dựng', nameEn: 'Construction warranty provision', level: 2, parentCode: '352', type: 'Liability', nature: 'Credit' },
    { code: '3523', name: 'Dự phòng tái cơ cấu doanh nghiệp', nameEn: 'Restructuring provision', level: 2, parentCode: '352', type: 'Liability', nature: 'Credit' },
    { code: '3524', name: 'Dự phòng phải trả khác', nameEn: 'Other provisions', level: 2, parentCode: '352', type: 'Liability', nature: 'Credit' },
    { code: '353', name: 'Quỹ khen thưởng, phúc lợi', nameEn: 'Bonus & welfare funds', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '3531', name: 'Quỹ khen thưởng', nameEn: 'Bonus fund', level: 2, parentCode: '353', type: 'Liability', nature: 'Credit' },
    { code: '3532', name: 'Quỹ phúc lợi', nameEn: 'Welfare fund', level: 2, parentCode: '353', type: 'Liability', nature: 'Credit' },
    { code: '3533', name: 'Quỹ phúc lợi đã hình thành TSCĐ', nameEn: 'Welfare fund used for fixed assets', level: 2, parentCode: '353', type: 'Liability', nature: 'Credit' },
    { code: '3534', name: 'Quỹ thưởng ban quản lý điều hành', nameEn: 'Management bonus fund', level: 2, parentCode: '353', type: 'Liability', nature: 'Credit' },
    { code: '356', name: 'Quỹ phát triển khoa học và công nghệ', nameEn: 'Science & technology development fund', level: 1, type: 'Liability', nature: 'Credit' },
    { code: '3561', name: 'Quỹ phát triển khoa học và công nghệ', nameEn: 'S&T development fund', level: 2, parentCode: '356', type: 'Liability', nature: 'Credit' },
    { code: '3562', name: 'Quỹ PTKH&CN đã hình thành TSCĐ', nameEn: 'S&T fund used for fixed assets', level: 2, parentCode: '356', type: 'Liability', nature: 'Credit' },
    { code: '357', name: 'Quỹ bình ổn giá', nameEn: 'Price stabilization fund', level: 1, type: 'Liability', nature: 'Credit' },

    // ─── Loại 4: Vốn chủ sở hữu (Equity) ────────────────────────────────────────
    { code: '411', name: 'Vốn đầu tư của chủ sở hữu', nameEn: "Owner's invested capital", level: 1, type: 'Equity', nature: 'Credit' },
    { code: '4111', name: 'Vốn góp của chủ sở hữu', nameEn: 'Contributed capital', level: 2, parentCode: '411', type: 'Equity', nature: 'Credit' },
    { code: '4112', name: 'Thặng dư vốn cổ phần', nameEn: 'Share premium', level: 2, parentCode: '411', type: 'Equity', nature: 'Credit' },
    { code: '4113', name: 'Quyền chọn chuyển đổi trái phiếu', nameEn: 'Bond conversion options', level: 2, parentCode: '411', type: 'Equity', nature: 'Credit' },
    { code: '4118', name: 'Vốn khác', nameEn: 'Other capital', level: 2, parentCode: '411', type: 'Equity', nature: 'Credit' },
    { code: '412', name: 'Chênh lệch đánh giá lại tài sản', nameEn: 'Asset revaluation differences', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '413', name: 'Chênh lệch tỷ giá hối đoái', nameEn: 'Foreign exchange differences', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '4131', name: 'Chênh lệch tỷ giá do đánh giá lại các khoản mục tiền tệ', nameEn: 'FX differences from revaluation', level: 2, parentCode: '413', type: 'Equity', nature: 'Credit' },
    { code: '4132', name: 'Chênh lệch tỷ giá trong giai đoạn trước hoạt động', nameEn: 'Pre-operating FX differences', level: 2, parentCode: '413', type: 'Equity', nature: 'Credit' },
    { code: '414', name: 'Quỹ đầu tư phát triển', nameEn: 'Development investment fund', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '417', name: 'Quỹ hỗ trợ sắp xếp doanh nghiệp', nameEn: 'Enterprise restructuring support fund', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '418', name: 'Các quỹ khác thuộc vốn chủ sở hữu', nameEn: 'Other equity funds', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '419', name: 'Cổ phiếu quỹ', nameEn: 'Treasury shares', level: 1, type: 'Equity', nature: 'Debit' },
    { code: '421', name: 'Lợi nhuận sau thuế chưa phân phối', nameEn: 'Undistributed profit after tax', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '4211', name: 'Lợi nhuận sau thuế chưa phân phối năm trước', nameEn: 'Prior-year undistributed profit', level: 2, parentCode: '421', type: 'Equity', nature: 'Credit' },
    { code: '4212', name: 'Lợi nhuận sau thuế chưa phân phối năm nay', nameEn: 'Current-year undistributed profit', level: 2, parentCode: '421', type: 'Equity', nature: 'Credit' },
    { code: '441', name: 'Nguồn vốn đầu tư xây dựng cơ bản', nameEn: 'Capital construction fund', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '461', name: 'Nguồn kinh phí sự nghiệp', nameEn: 'Non-business funding sources', level: 1, type: 'Equity', nature: 'Credit' },
    { code: '4611', name: 'Nguồn kinh phí sự nghiệp năm trước', nameEn: 'Prior-year non-business funding', level: 2, parentCode: '461', type: 'Equity', nature: 'Credit' },
    { code: '4612', name: 'Nguồn kinh phí sự nghiệp năm nay', nameEn: 'Current-year non-business funding', level: 2, parentCode: '461', type: 'Equity', nature: 'Credit' },
    { code: '466', name: 'Nguồn kinh phí đã hình thành TSCĐ', nameEn: 'Funding used for fixed assets', level: 1, type: 'Equity', nature: 'Credit' },

    // ─── Loại 5: Doanh thu (Revenue) ────────────────────────────────────────────
    { code: '511', name: 'Doanh thu bán hàng và cung cấp dịch vụ', nameEn: 'Revenue from sales & services', level: 1, type: 'Revenue', nature: 'Credit' },
    { code: '5111', name: 'Doanh thu bán hàng hóa', nameEn: 'Merchandise sales revenue', level: 2, parentCode: '511', type: 'Revenue', nature: 'Credit' },
    { code: '5112', name: 'Doanh thu bán các thành phẩm', nameEn: 'Finished goods sales revenue', level: 2, parentCode: '511', type: 'Revenue', nature: 'Credit' },
    { code: '5113', name: 'Doanh thu cung cấp dịch vụ', nameEn: 'Service revenue', level: 2, parentCode: '511', type: 'Revenue', nature: 'Credit' },
    { code: '5114', name: 'Doanh thu trợ cấp, trợ giá', nameEn: 'Subsidy revenue', level: 2, parentCode: '511', type: 'Revenue', nature: 'Credit' },
    { code: '5117', name: 'Doanh thu kinh doanh bất động sản đầu tư', nameEn: 'Investment property revenue', level: 2, parentCode: '511', type: 'Revenue', nature: 'Credit' },
    { code: '5118', name: 'Doanh thu khác', nameEn: 'Other revenue', level: 2, parentCode: '511', type: 'Revenue', nature: 'Credit' },
    { code: '515', name: 'Doanh thu hoạt động tài chính', nameEn: 'Financial income', level: 1, type: 'Revenue', nature: 'Credit' },
    { code: '521', name: 'Các khoản giảm trừ doanh thu', nameEn: 'Revenue deductions', level: 1, type: 'Revenue', nature: 'Debit' },
    { code: '5211', name: 'Chiết khấu thương mại', nameEn: 'Trade discounts', level: 2, parentCode: '521', type: 'Revenue', nature: 'Debit' },
    { code: '5212', name: 'Hàng bán bị trả lại', nameEn: 'Sales returns', level: 2, parentCode: '521', type: 'Revenue', nature: 'Debit' },
    { code: '5213', name: 'Giảm giá hàng bán', nameEn: 'Sales allowances', level: 2, parentCode: '521', type: 'Revenue', nature: 'Debit' },

    // ─── Loại 6: Chi phí sản xuất, kinh doanh (Operating costs) ─────────────────
    { code: '611', name: 'Mua hàng', nameEn: 'Purchases', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '6111', name: 'Mua nguyên liệu, vật liệu', nameEn: 'Raw material purchases', level: 2, parentCode: '611', type: 'Expense', nature: 'Debit' },
    { code: '6112', name: 'Mua hàng hóa', nameEn: 'Merchandise purchases', level: 2, parentCode: '611', type: 'Expense', nature: 'Debit' },
    { code: '621', name: 'Chi phí nguyên liệu, vật liệu trực tiếp', nameEn: 'Direct materials cost', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '622', name: 'Chi phí nhân công trực tiếp', nameEn: 'Direct labor cost', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '623', name: 'Chi phí sử dụng máy thi công', nameEn: 'Construction machinery costs', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '627', name: 'Chi phí sản xuất chung', nameEn: 'Manufacturing overhead', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '6271', name: 'Chi phí nhân viên phân xưởng', nameEn: 'Workshop staff costs', level: 2, parentCode: '627', type: 'Expense', nature: 'Debit' },
    { code: '6272', name: 'Chi phí vật liệu', nameEn: 'Materials overhead', level: 2, parentCode: '627', type: 'Expense', nature: 'Debit' },
    { code: '6273', name: 'Chi phí dụng cụ sản xuất', nameEn: 'Production tools overhead', level: 2, parentCode: '627', type: 'Expense', nature: 'Debit' },
    { code: '6274', name: 'Chi phí khấu hao TSCĐ', nameEn: 'Depreciation overhead', level: 2, parentCode: '627', type: 'Expense', nature: 'Debit' },
    { code: '6277', name: 'Chi phí dịch vụ mua ngoài', nameEn: 'Outsourced services overhead', level: 2, parentCode: '627', type: 'Expense', nature: 'Debit' },
    { code: '6278', name: 'Chi phí bằng tiền khác', nameEn: 'Other cash overhead', level: 2, parentCode: '627', type: 'Expense', nature: 'Debit' },
    { code: '631', name: 'Giá thành sản xuất', nameEn: 'Production cost', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '632', name: 'Giá vốn hàng bán', nameEn: 'Cost of goods sold', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '635', name: 'Chi phí tài chính', nameEn: 'Financial expenses', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '641', name: 'Chi phí bán hàng', nameEn: 'Selling expenses', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '6411', name: 'Chi phí nhân viên bán hàng', nameEn: 'Sales staff costs', level: 2, parentCode: '641', type: 'Expense', nature: 'Debit' },
    { code: '6412', name: 'Chi phí vật liệu, bao bì', nameEn: 'Materials & packaging costs', level: 2, parentCode: '641', type: 'Expense', nature: 'Debit' },
    { code: '6413', name: 'Chi phí dụng cụ, đồ dùng', nameEn: 'Tools & supplies costs', level: 2, parentCode: '641', type: 'Expense', nature: 'Debit' },
    { code: '6414', name: 'Chi phí khấu hao TSCĐ', nameEn: 'Depreciation - selling', level: 2, parentCode: '641', type: 'Expense', nature: 'Debit' },
    { code: '6415', name: 'Chi phí bảo hành', nameEn: 'Warranty costs', level: 2, parentCode: '641', type: 'Expense', nature: 'Debit' },
    { code: '6417', name: 'Chi phí dịch vụ mua ngoài', nameEn: 'Outsourced services - selling (platform fees...)', level: 2, parentCode: '641', type: 'Expense', nature: 'Debit' },
    { code: '6418', name: 'Chi phí bằng tiền khác', nameEn: 'Other cash costs - selling', level: 2, parentCode: '641', type: 'Expense', nature: 'Debit' },
    { code: '642', name: 'Chi phí quản lý doanh nghiệp', nameEn: 'General & administration expenses', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '6421', name: 'Chi phí nhân viên quản lý', nameEn: 'Admin staff costs', level: 2, parentCode: '642', type: 'Expense', nature: 'Debit' },
    { code: '6422', name: 'Chi phí vật liệu quản lý', nameEn: 'Admin materials costs', level: 2, parentCode: '642', type: 'Expense', nature: 'Debit' },
    { code: '6423', name: 'Chi phí đồ dùng văn phòng', nameEn: 'Office supplies costs', level: 2, parentCode: '642', type: 'Expense', nature: 'Debit' },
    { code: '6424', name: 'Chi phí khấu hao TSCĐ', nameEn: 'Depreciation - admin', level: 2, parentCode: '642', type: 'Expense', nature: 'Debit' },
    { code: '6425', name: 'Thuế, phí và lệ phí', nameEn: 'Taxes & fees - admin', level: 2, parentCode: '642', type: 'Expense', nature: 'Debit' },
    { code: '6426', name: 'Chi phí dự phòng', nameEn: 'Provision expenses', level: 2, parentCode: '642', type: 'Expense', nature: 'Debit' },
    { code: '6427', name: 'Chi phí dịch vụ mua ngoài', nameEn: 'Outsourced services - admin', level: 2, parentCode: '642', type: 'Expense', nature: 'Debit' },
    { code: '6428', name: 'Chi phí bằng tiền khác', nameEn: 'Other cash costs - admin', level: 2, parentCode: '642', type: 'Expense', nature: 'Debit' },

    // ─── Loại 7: Thu nhập khác (Other income) ───────────────────────────────────
    { code: '711', name: 'Thu nhập khác', nameEn: 'Other income', level: 1, type: 'Revenue', nature: 'Credit' },

    // ─── Loại 8: Chi phí khác (Other expenses) ──────────────────────────────────
    { code: '811', name: 'Chi phí khác', nameEn: 'Other expenses', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '821', name: 'Chi phí thuế thu nhập doanh nghiệp', nameEn: 'Corporate income tax expense', level: 1, type: 'Expense', nature: 'Debit' },
    { code: '8211', name: 'Chi phí thuế TNDN hiện hành', nameEn: 'Current CIT expense', level: 2, parentCode: '821', type: 'Expense', nature: 'Debit' },
    { code: '8212', name: 'Chi phí thuế TNDN hoãn lại', nameEn: 'Deferred CIT expense', level: 2, parentCode: '821', type: 'Expense', nature: 'Debit' },

    // ─── Loại 9: Xác định kết quả kinh doanh (Income summary) ───────────────────
    { code: '911', name: 'Xác định kết quả kinh doanh', nameEn: 'Income summary', level: 1, type: 'Equity', nature: 'Debit' },

    // ─── Tài khoản ngoài bảng (Off-balance-sheet) ──────────────────────────────
    { code: '001', name: 'Tài sản thuê ngoài', nameEn: 'Leased assets (off-balance)', level: 1, type: 'OffBalance', nature: 'Debit' },
    { code: '002', name: 'Vật tư, hàng hóa nhận giữ hộ, nhận gia công', nameEn: 'Goods held for others / processing', level: 1, type: 'OffBalance', nature: 'Debit' },
    { code: '003', name: 'Hàng hóa nhận bán hộ, nhận ký gửi, ký cược', nameEn: 'Consignment goods received', level: 1, type: 'OffBalance', nature: 'Debit' },
    { code: '004', name: 'Nợ khó đòi đã xử lý', nameEn: 'Written-off bad debts', level: 1, type: 'OffBalance', nature: 'Debit' },
    { code: '007', name: 'Ngoại tệ các loại', nameEn: 'Foreign currencies', level: 1, type: 'OffBalance', nature: 'Debit' },
]

// Fast lookup: account code → display name (Vietnamese)
const NAME_BY_CODE = new Map<string, string>(COA_SEED.map(a => [a.code, a.name]))

/** Return the canonical Vietnamese name for an account code, or the code itself. */
export function accountName(code: string): string {
    return NAME_BY_CODE.get(code) || code
}

/** Classify an account into balance-sheet / P&L groups by its leading digit. */
export function classifyAccount(code: string): 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'other' {
    switch (code.charAt(0)) {
        case '1':
        case '2': return 'asset'
        case '3': return 'liability'
        case '4': return 'equity'
        case '5': return 'revenue'
        case '6':
        case '8': return 'expense'
        case '7': return 'revenue'
        default: return 'other'
    }
}
