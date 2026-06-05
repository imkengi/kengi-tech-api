# Audit Tính Năng Kế Toán / Thuế — Hệ thống open-retail (kengitech-api)

> **Phạm vi audit:** Toàn bộ backend API. Repo này là **backend-only** (Express + Prisma + PostgreSQL multi-tenant theo schema). **Không có frontend** (pages/components) trong repo — không tìm thấy `next.config`, `vite.config`, thư mục `pages/`, `components/`, `frontend/`, `client/`. Mọi tính năng dưới đây là **API endpoints** (giao diện do app khác tiêu thụ).
>
> **Ngày audit:** 2026-06-05
> **Nguyên tắc:** Chỉ liệt kê những gì THỰC SỰ có trong code, kèm file path + dòng.

## Tổng quan kiến trúc dữ liệu kế toán

- **2 Prisma schema:**
  - `prisma/schema.prisma` — Registry (Store, RefreshToken, 2FA). **Không có model kế toán.**
  - `prisma/schema-store.prisma` — Schema nghiệp vụ per-store, chứa **toàn bộ** model kế toán/thuế.
- **Mount points** (`src/index.ts`):
  - `/api/tax` → `src/routes/tax.ts` (**~7.200 dòng, 400KB, 121 endpoints** — trung tâm kế toán/thuế)
  - `/api/reports/financial` → `src/routes/financialReports.ts`
  - `/api/expenses`, `/api/cash-receipts`, `/api/bank-accounts`, `/api/debts`, `/api/einvoice`, `/api/payroll`, `/api/transactions`
- **Engine hạch toán tự động:** `src/lib/autoJournal.ts`
- **Bảng dữ liệu báo cáo lớn:** BigQuery (`src/lib/bigquery.ts`) dùng cho `financialReports`, fallback sang Prisma.

---

## 1. THUẾ (Tax)

### 1.1. Cấu hình thuế suất — `TaxConfig`
- **Model:** `prisma/schema-store.prisma:781` — `TaxConfig { name, rate, description, isDefault, status }`
- **Endpoints** (`src/routes/tax.ts`):
  - `GET /api/tax` (dòng 13) — list thuế suất
  - `POST /api/tax` (dòng 22) — tạo (set isDefault sẽ tắt các config khác)
  - `PUT /api/tax/:id` (dòng 159), `DELETE /api/tax/:id` (dòng 171)

### 1.2. Thuế GTGT / VAT — Tờ khai 01/GTGT & 01/CNKD
- **Model:** `TaxDeclaration` (`schema-store.prisma:824`) — chứa các chỉ tiêu **ct21..ct40b** (VAT doanh nghiệp) và **cnkd\*** (hộ kinh doanh).
- **Endpoints** (`tax.ts`):
  - `GET /api/tax/declarations` (443) — list tờ khai
  - `POST /api/tax/declarations` (455) — tạo tờ khai. **Tự động chọn loại**: nếu doanh thu năm ≥ **500.000.000đ** → `company` (01_GTGT); ngược lại → `household` (01_CNKD).
  - `PUT /api/tax/declarations/:id` (564) — cập nhật + tự tính lại ct29, ct30, ct35, ct38, ct39, ct40b
  - `DELETE /api/tax/declarations/:id` (624)
  - `GET /api/tax/declarations/:id/xml` (637) — **xuất XML tờ khai** (`ToKhai_{formType}_{period}.xml`), cấu trúc `<HSoThueDTu><HSoKhaiThue><TTChung>...<CTieuTKhai>`
- **Công thức VAT (01/GTGT)** — `tax.ts` ~ dòng 277–315:
  - Phân loại doanh thu theo thuế suất (0% → ct22, 5% → ct23/ct24, 8% → ct25/ct26, 10% → ct27/ct28)
  - `ct29 = ct21+ct22+ct23+ct25+ct27` (tổng doanh thu chịu thuế)
  - `ct30 = ct24+ct26+ct28` (thuế đầu ra)
  - `ct31` = chi phí mua vào (importReceipt totalCost), `ct32 = ct31 × rate/100` (thuế đầu vào), `ct33 = ct32`
  - `ct35 = ct30 - ct33 - ct34` (VAT phải nộp trước hoàn/khấu trừ)
  - `ct38` = số thuế phải nộp (nếu ct35>0), `ct39` = số thuế được hoàn (nếu ct35<0), `ct40b = ct39 - ct40a`
- **Công thức Hộ kinh doanh (01/CNKD)** — dòng ~318–345:
  - `cnkdThreshold = 500.000.000đ`; doanh thu năm hóa (quý ×4, tháng ×12)
  - `cnkdVatRate = 1%` (TT40/2021), `cnkdPitRate = 0.5%`
  - Nếu vượt ngưỡng: `cnkdVatAmount = revenue × 1%`, `cnkdPitAmount = revenue × 0.5%`, `cnkdTotalTax` = tổng

### 1.3. Tờ khai bổ sung / điều chỉnh VAT (01_GTGT_BS)
- **Endpoints** (`tax.ts`):
  - `POST /api/tax/vat-amendment` (703) — tạo bản bổ sung (validate gốc phải là 01_GTGT, ghi `amendmentReason` bắt buộc, đánh số amendment tăng dần, period `...-BS{n}`)
  - `GET /api/tax/vat-amendment` (783), `GET /api/tax/vat-amendment/:id` (804) — kèm diff với bản gốc
  - `GET /api/tax/vat-amendment/:id/diff` (842) — diff từng chỉ tiêu
  - `POST /api/tax/vat-amendment/:id/submit` (877) — nộp (gốc chuyển status `amended`)

### 1.4. Thuế TNDN / CIT — Tờ khai 03/TNDN
- **Endpoints** (`tax.ts`):
  - `GET /api/tax/cit-declaration/calculate` (4626) — tính CIT theo quý từ **journalEntry**
  - `GET /api/tax/cit-declaration` (4643), `POST /api/tax/cit-declaration` (4670)
  - `GET /api/tax/cit-declaration/appendix/pl01-1` (4745) — **Phụ lục PL01-1**: chi tiết doanh thu theo nhóm hàng
  - `GET /api/tax/cit-declaration/appendix/pl01-2` (4816) — **Phụ lục PL01-2**: chi tiết chi phí theo tài khoản (632/635/641/642/811)
- **Công thức CIT:**
  - Doanh thu = TK511 + TK515 + TK711; Chi phí = TK632+635+641+642+811
  - `ct01` = tổng doanh thu, `ct03` = thu nhập chịu thuế = ct01 − chi phí, `ct05` = TNCT sau chuyển lỗ
  - `ct06 = 20%` (CIT_DEFAULT_RATE), `ct07 = round(ct05 × 20%)` = thuế TNDN phải nộp

### 1.5. Thuế TNCN / PIT — Quyết toán 05/QTT-TNCN
- **Endpoints** (`tax.ts`):
  - `GET /api/tax/pit-settlement/calculate` (5009) — tính từ `PayrollRecord`
  - `POST /api/tax/pit-settlement` (5035), `GET /api/tax/pit-settlement` (5107)
  - `GET /api/tax/pit-settlement/:year/employees` (5141) — chi tiết theo nhân viên
- **Hằng số & biểu thuế** (`tax.ts` ~4882–4895):
  - Giảm trừ bản thân: **11.000.000đ/tháng** (NĐ44/2023); Giảm trừ người phụ thuộc: **4.400.000đ/tháng/người**
  - **Biểu lũy tiến từng phần** (annual): 0–60tr @5%, 60–120tr @10%, 120–216tr @15%, 216–384tr @20%, 384–624tr @25%, 624–960tr @30%, >960tr @35%
  - `taxableIncome = totalIncome − (BHXH+BHYT+BHTN) − giảm trừ bản thân − giảm trừ người phụ thuộc`
  - `balanceDue = taxAmount − pitWithheld` (dương = phải nộp, âm = được hoàn)

### 1.6. Theo dõi nghĩa vụ & lịch thuế
- **`GET /api/tax/revenue-check`** (184) — kiểm tra doanh thu năm vs ngưỡng 500tr (chọn loại hình)
- **`GET /api/tax/invoices`** (208) — list hóa đơn/giao dịch theo kỳ, lọc `vatOnly`
- **Lịch nộp thuế** (model `TaxDeadline` `schema:1957`):
  - `GET /api/tax/deadlines` (6352) — tự seed deadline theo năm, auto đánh dấu overdue
  - `GET /api/tax/deadlines/overdue` (6397), `PUT /api/tax/deadlines/:id` (6418)
- **Báo cáo nghĩa vụ thuế:**
  - `GET /api/tax/reports/tax-obligations` (6827) — số dư phải nộp VAT(3331)/CIT(3334)/PIT(3335) + deadline sắp tới
  - `GET /api/tax/reports/summary` (6735) — báo cáo tổng hợp năm (xem mục 6)
- **Dự toán ngân sách thuế** (model `TaxBudget` `schema:1998`):
  - `GET/POST/PUT/DELETE /api/tax/budget` (6505/6525/6567/6587)
  - `GET /api/tax/budget-vs-actual` (6601) — so sánh dự toán vs thực tế (từ journalEntry), tính variance %
- **Nhật ký thao tác thuế** (model `TaxAuditLog` `schema:1979`):
  - `GET /api/tax/audit-log` (6458), `POST /api/tax/audit-log` (6487)
- **VAT trên giao dịch:** `PUT /api/transactions/:id/vat` (`src/routes/transactions.ts:1177`) — đánh dấu vatStatus issued/cancelled/none, tự sinh số hóa đơn VAT.

### 1.7. Hóa đơn điện tử (E-Invoice)
- **Models:** `EInvoiceConfig` (`schema:1529`), `EInvoice` (`schema:1544`)
- **Endpoints** (`src/routes/einvoice.ts`):
  - `GET /api/einvoice/providers` (11), `GET/PUT /api/einvoice/config` (16/43)
  - `POST /api/einvoice/test-connection` (89)
  - `POST /api/einvoice/issue/:transactionId` (106) — phát hành HĐ từ giao dịch (VAT mặc định **10%**), cập nhật vatStatus
  - `GET /api/einvoice/history` (208), `POST /api/einvoice/cancel/:invoiceId` (257)
- **Nhà cung cấp** (`src/services/einvoice/`): `misa`, `viettel`, `vnpt`, `fpt`, `easyinvoice`, `bkav`
  - ⚠️ **Chỉ MISA (`misa.ts`, 6KB) là tích hợp thật** (gọi `api.meinvoice.vn`: auth/token, /invoice, /invoice/cancel). Các provider còn lại (`fpt.ts`, `bkav.ts`, `vnpt.ts`, `easyinvoice.ts`, `viettel.ts`) là **skeleton/stub** — `issueInvoice`/`cancelInvoice` trả về *"Chưa implement"* / *"Vui lòng liên hệ để cấu hình API"*. `testConnection` có gọi thử `/api/health`.

### 1.8. Hóa đơn điều chỉnh (NĐ123/2020) — `AdjustmentInvoice`
- **Models:** `AdjustmentInvoice` (`schema:1565`), `AdjustmentInvoiceItem` (`schema:1608`)
- **Endpoints** (`tax.ts`):
  - `POST /api/tax/adjustment-invoices` (5252) — tạo (type: `increase`/`decrease`/`info_correction`, mã `HDDC-YYYYMMDD-NNN`)
  - `GET /api/tax/adjustment-invoices` (5321), `GET /api/tax/adjustment-invoices/:id` (5352), `PUT` (5369, chỉ khi draft)
  - `POST /api/tax/adjustment-invoices/:id/approve` (5462) — duyệt & **sinh bút toán**:
    - increase: Nợ 131 / Có 511 (doanh thu) + Nợ 131 / Có 3331 (VAT)
    - decrease: Nợ 511 / Có 131 + Nợ 3331 / Có 131
    - info_correction: không sinh bút toán

---

## 2. HẠCH TOÁN (Sổ cái, bút toán, hạch toán tự động)

### 2.1. Bút toán thủ công — `JournalEntry`
- **Model:** `JournalEntry` (`schema-store.prisma:1477`) — `{ date, description, debitAccount, creditAccount, amount, reference, referenceType, notes, branchId }`
- **Endpoints** (`tax.ts`):
  - `GET /api/tax/journal-entries` (996) — list + summary (totalDebit/totalCredit, isBalanced)
  - `POST /api/tax/journal-entries` (1014) — tạo thủ công; **bắt buộc cân Nợ = Có**, không cho Nợ=Có cùng TK (lỗi *"Bút toán chưa cân đối: Tổng Nợ ≠ Tổng Có"*)
  - `DELETE /api/tax/journal-entries/:id` (1055)

### 2.2. Hạch toán tự động — `src/lib/autoJournal.ts` + `/auto-journal`
- **Engine:** `src/lib/autoJournal.ts`
  - `AUTO_JOURNAL_REF_TYPES` = 7 loại nguồn: `sale`, `expense`, `import`, `payroll`, `online`, `cogs`, `depreciation`
  - `createJournalEntriesForTransaction()` — sinh **4 bút toán/giao dịch hoàn tất**, có **idempotency** theo `reference`:
    - Chọn TK Nợ theo hình thức TT: bank → **112**, tiền mặt đã trả đủ → **111**, chưa trả → **131**
    1. Doanh thu: Nợ 111/112/131 / Có **511** (`SALE-{receipt}`)
    2. VAT đầu ra: Nợ 111/112/131 / Có **3331** (`VAT-{receipt}`)
    3. Chiết khấu: Nợ **521** / Có 111/112/131 (`DISC-{receipt}`)
    4. Giá vốn: Nợ **632** / Có **156** (`COGS-{receipt}`)
- **Endpoints** (`tax.ts`):
  - `POST /api/tax/auto-journal` (1828) — hạch toán hàng loạt cả kỳ từ: giao dịch, **chi phí** (theo category → 6421/6422/6411/6415/6418/6423/6424/6425/6428), **nhập kho** (Nợ 156/Có 331), **lương** (Nợ 622/Có 334 + BHXH Nợ 622/Có 3383), **đơn online**, **khấu hao** (Nợ 6274 hoặc TK cấu hình/Có 214)
  - `DELETE /api/tax/auto-journal` (2155) — xóa bút toán tự động (giữ lại `manual` & `closing`)

### 2.3. Hệ thống tài khoản (Chart of Accounts) — xem mục 5

### 2.4. Đánh giá lại ngoại tệ (FX revaluation)
- **Model:** `ExchangeRate` (`schema:1939`)
- **Endpoints** (`tax.ts`):
  - `GET/POST/PUT/DELETE /api/tax/exchange-rates` (6048/6085/6121/6138), `GET /:id` (6072)
  - `POST /api/tax/exchange-rates/revalue` (6151) — chênh lệch tỷ giá ghi vào **TK413**, sinh bút toán lãi/lỗ tỷ giá (`FX-REVAL-{date}`)

---

## 3. TIỀN MẶT / NGÂN HÀNG

### 3.1. Phiếu thu — `CashReceipt`
- **Model:** `CashReceipt` (`schema:505`) — `{ description, amount, category, date, receivedVia, bankAccountId, customerId, status, ... }`
- **Endpoints** (`src/routes/cashReceipts.ts`):
  - `GET /api/cash-receipts` (10), `GET /api/cash-receipts/stats` (34) — tổng theo category
  - `POST /api/cash-receipts` (58) — tạo; nếu có `bankAccountId` → **mirror sang BankTransaction** (deposit)
  - `PUT /api/cash-receipts/:id` (106)
  - `POST /api/cash-receipts/:id/cancel` (139) — hủy mềm + đảo bút toán ngân hàng (withdraw)
  - `DELETE /api/cash-receipts/:id` (181)
- Category: `debt_collection | rental | capital | refund | other`

### 3.2. Phiếu chi — `Expense`
- **Model:** `Expense` (`schema:483`) — `{ description, amount, category, date, paidBy, recurring, bankAccountId, status, ... }`
- **Endpoints** (`src/routes/expenses.ts`):
  - `GET /api/expenses` (11, có cache), `GET /api/expenses/stats` (41)
  - `POST /api/expenses` (57, validate `CreateExpenseSchema`) — nếu có `bankAccountId` → mirror BankTransaction (withdraw)
  - `PUT /api/expenses/:id` (101), `POST /api/expenses/:id/cancel` (130, đảo bút toán ngân hàng), `DELETE` (173)

### 3.3. Tài khoản ngân hàng & giao dịch — `BankAccount`, `BankTransaction`
- **Models:** `BankAccount` (`schema:792`), `BankTransaction` (`schema:805`, type `deposit|withdraw`)
- **Endpoints chính** (`src/routes/bankAccounts.ts`): `GET/POST/PUT/DELETE /api/bank-accounts` (10/22/46/68)
- **Endpoints HKD** (`tax.ts`):
  - `GET/POST/PUT/DELETE /api/tax/hkd/bank-accounts` (3655/3662/3672/3681)
  - `GET/POST/PUT/DELETE /api/tax/hkd/bank-transactions` (3690/3700/3710/3718)

### 3.4. Sổ quỹ tiền mặt / sổ tiền gửi
- `GET /api/tax/cash-book` (`tax.ts:1160`) — **Sổ quỹ tiền mặt** (TK111), tính số dư lũy kế + dailyBalances
- HKD: `GET /api/tax/hkd/s6` (3727) — sổ quỹ tiền mặt + tiền gửi; CRUD s6 (POST 3795/PUT 3812/DELETE 3827)
- HKD: `GET /api/tax/hkd/s7` (3836) — nhật ký thu chi tiền gửi ngân hàng

> ⚠️ **Đối soát ngân hàng (bank reconciliation):** Có dữ liệu BankTransaction + mirror tự động từ phiếu thu/chi, nhưng **không tìm thấy endpoint đối soát/matching sao kê** chuyên dụng (không có import sao kê + matching). Chỉ có sổ theo dõi.

---

## 4. SỔ SÁCH (Khóa sổ, nhật ký, sổ cái, cân đối)

### 4.1. Sổ cái (General Ledger)
- `GET /api/tax/ledger?account=` (`tax.ts:1067`) — sổ cái chi tiết 1 TK, số dư lũy kế, tài khoản đối ứng
- `GET /api/tax/export/general-ledger` (7001) — xuất sổ cái (data-only) kèm số dư đầu/cuối kỳ

### 4.2. Sổ nhật ký chung (Journal Book)
- `GET /api/tax/export/journal-book` (`tax.ts:7091`) — xuất sổ nhật ký (giới hạn 20.000 dòng, có cờ `truncated`)

### 4.3. Bảng cân đối tài khoản (Trial Balance)
- `GET /api/tax/trial-balance` (`tax.ts:1119`) — tổng hợp Nợ/Có theo TK, kiểm tra cân (`isBalanced`)
- `GET /api/tax/export/trial-balance` (6893) — xuất kèm số dư đầu kỳ / phát sinh / cuối kỳ (dựa `nature` của COA)

### 4.4. Số dư tài khoản
- `GET /api/tax/account-balances` (`tax.ts:2545`) — số dư mọi TK tới cuối năm

### 4.5. Khóa sổ / Kết chuyển cuối kỳ (Closing Entries)
- `GET /api/tax/closing-entries/preview` (`tax.ts:2282`) — xem trước bút toán kết chuyển
- `POST /api/tax/closing-entries` (2307) — sinh bút toán kết chuyển về **TK911** (Xác định KQKD), lãi/lỗ về **421**; có **guard idempotency** (từ chối nếu đã có bút toán closing kỳ đó, `referenceType='closing'`, mã `CLOSE-...`)

### 4.6. Sổ sách Hộ kinh doanh (TT88/2021/TT-BTC) — S1..S7
- `tax.ts` dòng 3269–3886:
  - `GET /api/tax/hkd/s1` (3269) — **S1: Sổ chi tiết doanh thu bán hàng**
  - `GET /api/tax/hkd/s2` (3315) — **S2: Nhật ký nhập/xuất hàng hóa** (line items); `GET /api/tax/hkd/s2-summary` (3391) — tổng hợp tồn theo mã hàng (đầu kỳ/nhập/xuất/cuối kỳ)
  - `GET /api/tax/hkd/s3` (3442) — **S3: Chi tiết doanh thu & chi phí** (6 nhóm chi phí a–e theo TT152/2025)
  - `GET /api/tax/hkd/s4` (3524) — **S4: Theo dõi nghĩa vụ thuế**
  - `GET /api/tax/hkd/s5` (3570) — **S5: Theo dõi thanh toán tiền lương**
  - `GET /api/tax/hkd/s6` (3727) — **S6: Sổ quỹ tiền mặt & tiền gửi**
  - `GET /api/tax/hkd/s7` (3836) — **S7: Nhật ký thu chi tiền gửi ngân hàng**

### 4.7. Báo cáo Z / chốt ca POS — `ZReport`
- **Model:** `ZReport` (`schema:1869`)
- `GET /api/tax/z-reports/calculate` (`tax.ts:4389`), `GET /api/tax/z-reports` (4466), `GET /:id` (4490), `POST /api/tax/z-reports` (4504) — chốt doanh thu ngày theo register (cashSales/cardSales/netSales/cashDifference)

---

## 5. TÀI KHOẢN KẾ TOÁN (Chart of Accounts)

- **Model:** `ChartOfAccount` (`schema-store.prisma:1916`) — `{ code, name, nameEn, level, parentCode, type, nature, isActive, isSystem, ... }`
- **Endpoints** (`tax.ts`):
  - `POST /api/tax/chart-of-accounts/seed` (5836) — **seed bộ TK chuẩn TT200 (~63 tài khoản)**; `?force=true`
  - `GET /api/tax/chart-of-accounts` (5897) — list (lọc type/parentCode/isActive/q)
  - `GET /api/tax/chart-of-accounts/tree` (5924) — **cây tài khoản** (parent-child)
  - `GET /api/tax/chart-of-accounts/:code` (5951)
  - `POST /api/tax/chart-of-accounts` (5965) — thêm (yêu cầu code, name, type, nature)
  - `PUT /api/tax/chart-of-accounts/:code` (6002) — sửa (không đổi code)
  - `DELETE /api/tax/chart-of-accounts/:code` (6029) — **xóa mềm** (isActive=false); **không cho xóa TK hệ thống** (isSystem=true)
- **Bộ TK seed mặc định (trích):** 111/1111/1112, 112/1121/1122, 131, 133/1331, 152, 156, 211, 214, 331, 333/3331/3334, 334, 3383, 341, 411, 413, 421, 511/5111/5113, 515, 521, 622, 632, 635, 641, 642, 6274, 6411, 6415, 6418, 6421–6425, 711, 811, 821, 911, 001.

---

## 6. BÁO CÁO TÀI CHÍNH

### 6.1. Bảng cân đối kế toán (Balance Sheet)
- `GET /api/tax/balance-sheet` (`tax.ts:2381`) — phân loại TK theo chữ số đầu (1,2=Tài sản; 3=Nợ phải trả; 4=Vốn CSH), tính lợi nhuận chưa phân phối (421), kiểm tra `isBalanced` (Tài sản = Nợ + Vốn)

### 6.2. Báo cáo kết quả kinh doanh (Income Statement)
- `GET /api/tax/income-statement` (`tax.ts:2456`) — Doanh thu(511) − Chiết khấu(521) = DT thuần; − GV(632) = LN gộp; − CP(641/642/622); +/− TC(515/635); +/− khác(711/811) = LN trước thuế; biên LN gộp/ròng
- `GET /api/tax/revenue-analysis` (1755) — phân tích thu chi/P&L theo tháng, KPI (grossMargin, netMargin, EBITDA), cơ cấu chi phí

### 6.3. Báo cáo lưu chuyển tiền tệ (Cash Flow)
- `GET /api/tax/cash-flow` (`tax.ts:2575`) — LCTT đơn giản (TK tiền 111/112/1111.../theo hoạt động KD/đầu tư/tài chính)
- `GET /api/tax/cash-flow-statement` (5733) — **LCTT chuẩn (TT200)**: CT20/CT30/CT40/CT50/CT70, so sánh năm nay vs năm trước

### 6.4. Báo cáo tổng hợp & báo cáo tài chính tổng quát
- `GET /api/tax/reports/summary` (`tax.ts:6735`) — gộp Income Statement + Balance Sheet + nghĩa vụ thuế + chỉ số (Current ratio, Debt ratio, ROE, Gross/Net margin) cho cả năm
- **`GET /api/reports/financial`** (`src/routes/financialReports.ts:12`, perm `reports.view`) — báo cáo tài chính theo `period` (thisMonth/lastMonth/3months/6months/year):
  - **Dùng BigQuery** (`buildReportFromBigQuery`) nếu bật, fallback **Prisma** (`buildReportFromPrisma`)
  - Output: P&L (revenue/cogs/grossProfit/expenses/netProfit), Balance (assets/liabilities/equity với nguyên tắc `equity = assets − liabilities`), Cashflow, KPIs, dailyData, paymentBreakdown, topProducts
  - ⚠️ Bảng cân đối ở đây là **ước tính giản lược** (cash = revenue + thu nợ − chi phí; AP = đơn nhập chưa hoàn tất), **khác** với balance-sheet dựa journalEntry ở mục 6.1.

> **Lưu ý:** Tồn tại **2 hệ báo cáo song song**: (a) hệ dựa **sổ kế toán kép** (`/api/tax/*` từ JournalEntry — chuẩn kế toán), và (b) hệ **ước tính nhanh** (`/api/reports/financial` từ giao dịch/chi phí trực tiếp — phục vụ dashboard).

---

## 7. TÀI SẢN CỐ ĐỊNH (TSCĐ) & KHẤU HAO

- **Model:** `FixedAsset` (`schema-store.prisma:1502`) — `{ code, name, category, acquisitionDate, originalCost, usefulLifeMonths, method, accumulatedDepreciation, netBookValue, monthlyDepreciation, depreciationAccount(default 6424), residualValue, status, ... }`
- **Endpoints** (`tax.ts`):
  - `GET /api/tax/fixed-assets/summary` (1356) — tổng nguyên giá / khấu hao LK / GTCL / theo category
  - `POST /api/tax/fixed-assets/depreciation/run` (1391) — **chạy khấu hao tháng**: sinh bút toán Nợ TK khấu hao (6424/627*/641*/642*) / Có **214**, idempotent theo `referenceType='depreciation'` (`DEP-{code}-{year}-{month}`)
  - `GET /api/tax/fixed-assets` (1501), `POST` (1527), `GET /:id` (1606), `PUT /:id` (1621), `DELETE /:id` (1692, xóa mềm → `disposed`)
  - `GET /api/tax/fixed-assets/:id/depreciation` (1579) — bảng khấu hao chi tiết theo tháng
- **Phương pháp khấu hao:**
  - **Đường thẳng (straight-line, mặc định):** `monthly = (originalCost − residualValue) / usefulLifeMonths`
  - **Số dư giảm dần (declining-balance):** `rate = 2/usefulLifeMonths`, `monthly = NBV × rate` (sàn = residualValue)
  - Cap luỹ kế ≤ (nguyên giá − giá trị thanh lý); hết KH → status `fully-depreciated`
- **Kiểm kê TSCĐ:** qua module Kiểm kê (mục 8 dưới, type `fixed-assets`, mẫu D02-TS)

---

## 8. CÔNG NỢ (Phải thu / Phải trả / Tuổi nợ)

### 8.1. Công nợ khách hàng (phải thu) — `DebtEntry`
- **Model:** `DebtEntry` (`schema-store.prisma:986`) — `{ customerId, customerName, type, amount, description, balance }`
- **Endpoints** (`src/routes/debts.ts`):
  - `GET /api/debts/stats` (7) — tổng nợ, số KH, nợ TB, KH nợ lớn nhất
  - `GET /api/debts` (27) — list entry (lọc customerId/type)
  - `GET /api/debts/summary` (44) — gộp theo KH (kết hợp `Customer.debt` + DebtEntry + giao dịch `partial`/chưa trả đủ)
  - `POST /api/debts` (161) — ghi nợ/trả nợ (tính balance lũy kế), `DELETE /:id` (195)

### 8.2. Tuổi nợ (Debt Aging)
- `GET /api/tax/debt-aging?type=receivable|payable` (`tax.ts:1218`)
  - **Buckets:** `current` (≤0 ngày), `days30` (1–30), `days60` (31–60), `days90` (61–90), `overdue90` (>90)
  - **receivable:** từ `Customer.debt > 0`; **payable:** từ `ImportReceipt` (status pending/partial → công nợ NCC)

### 8.3. Công nợ phải trả NCC
- Phản ánh qua `ImportReceipt` chưa hoàn tất (debt-aging payable + balance-sheet TK331). Phiếu nhập: `src/routes/purchaseOrders.ts` / `src/routes/importReceipts.ts` (ngoài phạm vi kế toán nhưng là nguồn công nợ).

---

## 9. KIỂM KÊ KHO (bổ sung — liên quan hạch toán)

- **Models:** `InventoryCount` (`schema:1815`), `InventoryCountItem` (`schema:1844`)
- **Endpoints** (`tax.ts`):
  - `POST /api/tax/inventory-count` (3886) — tạo phiên kiểm kê (type `goods`/`fixed-assets`, mã `KK-YYYYMMDD-NNN`), auto nạp số sổ sách
  - `GET /api/tax/inventory-count` (3988), `GET /:id` (4017), `PUT /:id/items` (4034) — nhập số đếm
  - `POST /api/tax/inventory-count/:id/finalize` (4080) — **chốt + sinh bút toán chênh lệch**:
    - Hàng hóa thừa: Nợ 156 / Có 338; thiếu: Nợ 138 / Có 156 (×unitCost); cập nhật lại tồn kho
    - TSCĐ mất/thanh lý: Nợ 214 / Có 211 + Nợ 811 / Có 211
  - `GET /api/tax/inventory-count/:id/report` (4245) — biên bản **BC26-BH** (hàng) / **D02-TS** (TSCĐ)

---

## 10. PHỤ TRỢ KẾ TOÁN KHÁC

- **Tiện ích khác:**
  - `POST /api/tax/seed-test-data` (`tax.ts:2655`) — seed dữ liệu test
  - `GET /api/tax/store-info` / `PUT` (36/62) — thông tin DN cho tờ khai (taxCode, ownerName, businessType...)
  - `GET/POST/PUT/DELETE /api/tax/hkd-revenue` (108/125/139/151) — ghi chép doanh thu HKD ngày (model `HKDRevenueEntry` `schema:1629`, `tncnUocTinh = doanhThu × 0.5%`)
  - `GET /api/tax/payroll-accounting` (1714) — bảng lương kế toán (gross, BHXH/BHYT/BHTN, taxableIncome, PIT, net)
- **Bảng lương** (`src/routes/payroll.ts`, model `PayrollRecord` `schema:1307`):
  - `GET /api/payroll` (8), `GET /api/payroll/history` (34), `POST /api/payroll` (49, upsert cả tháng), `PUT /:id/status` (126), `PUT /bulk-status` (147)
  - Lưu đầy đủ: grossSalary, BHXH/BHYT/BHTN (emp + er), pit, netSalary, totalCost, dependents — nguồn cho quyết toán TNCN (mục 1.5)

---

## TÓM TẮT ĐỘ PHỦ (Coverage)

| Nhóm | Trạng thái | Ghi chú |
|------|-----------|---------|
| **Thuế GTGT/VAT** (01_GTGT, 01_CNKD, bổ sung, XML) | ✅ Đầy đủ | ct21–ct40b, ngưỡng 500tr, VAT 1%/PIT 0.5% (HKD) |
| **Thuế TNDN/CIT** (03_TNDN + PL01-1/PL01-2) | ✅ Có | rate 20% |
| **Thuế TNCN/PIT** (05_QTT-TNCN) | ✅ Có | biểu lũy tiến 5–35%, giảm trừ 11tr/4.4tr |
| **Bút toán + sổ cái + cân đối + khóa sổ** | ✅ Đầy đủ | double-entry, kết chuyển 911→421 |
| **Hạch toán tự động** | ✅ Đầy đủ | 7 nguồn, idempotent (`autoJournal.ts`) |
| **Chart of Accounts** (CRUD + cây + seed TT200) | ✅ Đầy đủ | ~63 TK, xóa mềm, bảo vệ TK hệ thống |
| **BCTC** (CĐKT, KQKD, LCTT) | ✅ Có (2 hệ) | hệ sổ kép `/tax/*` + hệ ước tính `/reports/financial` |
| **Tiền mặt/Ngân hàng** (phiếu thu/chi, sổ quỹ) | ✅ Có | mirror BankTransaction tự động |
| **TSCĐ + khấu hao** | ✅ Có | straight-line + declining-balance, post 214 |
| **Công nợ + tuổi nợ** | ✅ Có | buckets 0/30/60/90/>90, phải thu & phải trả |
| **Hóa đơn điện tử** | ⚠️ Một phần | **Chỉ MISA tích hợp thật**; FPT/BKAV/VNPT/EasyInvoice/Viettel là stub |
| **Đối soát ngân hàng (bank reconciliation)** | ❌ Không có | chỉ có sổ + mirror, không có import/matching sao kê |
| **Frontend (pages/components)** | ❌ Không có trong repo | repo là backend-only |

### File path tham chiếu nhanh
- Trung tâm kế toán/thuế: `src/routes/tax.ts` (121 endpoints)
- Engine hạch toán: `src/lib/autoJournal.ts`
- Báo cáo tài chính (BQ/Prisma): `src/routes/financialReports.ts`
- Phiếu thu/chi/ngân hàng/công nợ: `src/routes/{cashReceipts,expenses,bankAccounts,debts}.ts`
- Hóa đơn điện tử: `src/routes/einvoice.ts` + `src/services/einvoice/*`
- Lương: `src/routes/payroll.ts`
- Models: `prisma/schema-store.prisma` (Expense:483, CashReceipt:505, TaxConfig:781, BankAccount:792, BankTransaction:805, TaxDeclaration:824, DebtEntry:986, JournalEntry:1477, FixedAsset:1502, EInvoiceConfig:1529, EInvoice:1544, AdjustmentInvoice:1565, HKDRevenueEntry:1629, InventoryCount:1815, ZReport:1869, ChartOfAccount:1916, ExchangeRate:1939, TaxDeadline:1957, TaxAuditLog:1979, TaxBudget:1998, PayrollRecord:1307)
