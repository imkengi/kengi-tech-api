/**
 * check:nuotloi — bắt chỗ NUỐT LỖI ĐỌC rồi đem giá trị đó đi CỘNG TIỀN hoặc CHỐNG TRÙNG.
 *
 * `.catch(() => [])` không phải lúc nào cũng sai: rất nhiều chỗ chỉ làm giàu dữ liệu,
 * hỏng thì thiếu vài cột chứ không sai kết luận. Nguy hiểm là khi giá trị nuốt được
 * đem `.reduce()` ra tiền, đem so lệch, hay đem làm CHỐT CHỐNG TRÙNG — lúc đó
 * "không đọc được" biến thành "chưa có", và cái "chưa có" đó sinh ra bản ghi thứ hai.
 *
 * Bộ soát KHÔNG quét cả repo (119 chỗ chỉ riêng 24 file tiền — báo hết thì người ta
 * tắt bộ soát chứ không sửa bệnh). Nó soi NHÓM FILE TIỀN và chỉ kêu khi giá trị vừa
 * nuốt được (a) đem cộng/so ngay sau đó, hoặc (b) đứng làm chốt chống trùng.
 *
 * Chạy: npm run check:nuotloi
 */
import fs from 'fs'
import path from 'path'

const GOC = path.resolve(__dirname, '..')

/** File quyết định con số tiền hoặc kết luận kế toán. */
const FILE_TIEN = [
    'src/lib/auditPack.ts', 'src/lib/reconcile.ts', 'src/lib/cashForecast.ts',
    'src/lib/congNoNcc.ts', 'src/lib/tuoiNoFifo.ts', 'src/lib/donDuocXoa.ts',
    'src/routes/tax.ts', 'src/routes/taxAudit.ts', 'src/routes/debts.ts',
    'src/routes/mcpFinanceTools.ts', 'src/routes/importReceipts.ts',
    'src/routes/suppliers.ts', 'src/routes/customers.ts',
    // Mở rộng 20/08 tối: nơi tiền được SINH RA hoặc GHI SỔ, không chỉ nơi hiển thị
    'src/routes/transactions.ts', 'src/routes/onlineOrders.ts', 'src/routes/einvoice.ts',
    'src/routes/expenses.ts', 'src/lib/autoJournal.ts', 'src/lib/autoJournalPurchase.ts',
    'src/lib/onlineOrderProfit.ts', 'src/lib/warehouseHelper.ts',
    'src/services/orderSync.ts', 'src/services/kiotvietSync.ts',
    // Mở rộng lần 2: sổ tài sản / CCDC / lương — mỗi bản ghi trùng là một khoản chi phí đôi
    'src/routes/ccdc.ts', 'src/routes/fixedAssets.ts', 'src/routes/payroll.ts',
    'src/routes/accounts.ts', 'src/routes/ebanking.ts',
    // Mở rộng lần 3: MISA sync cũng ghi tồn kho + bút toán
    'src/services/misaSync.ts', 'src/routes/webhooks.ts', 'src/cron/autoSync.ts',
    // Mở rộng lần 4 (đã soi tay tối 20/08): trả hàng, phiếu thu, kho
    'src/routes/returns.ts', 'src/routes/cashReceipts.ts', 'src/routes/inventory.ts',
    /* Mở rộng lần 5 (21/08): mặt MCP — số ở đây đi thẳng vào miệng trợ lý AI rồi tới chủ shop.
     * Sai ở đây không có ai nhìn thấy bảng để mà nghi ngờ. */
    'src/routes/mcp.ts', 'src/routes/mcpReportTools.ts', 'src/routes/mcpAgent.ts',
]

/** Đã soi tay và chấp nhận.
 *  `mau` = mẩu chuỗi BẮT BUỘC phải có trong đoạn code đó thì lời duyệt mới áp dụng —
 *  không có nó thì một lời duyệt cho `existing` sẽ che luôn mọi `existing` viết sau này
 *  trong cùng file, đúng kiểu danh sách miễn trừ nuốt mất bệnh mới. */
const DA_DUYET: Record<string, { mau: string; ly: string }> = {
    'src/lib/reconcile.ts:supplier': {
        mau: 'payable: true',
        ly: 'chỉ dùng để NÊU RIÊNG số dư đầu kỳ, không vào phép so lệch; đã kèm câu "chưa đọc được" khi hỏng',
    },
    'src/routes/transactions.ts:nv': {
        mau: 'prisma.user.findMany',
        ly: 'chỉ lấy TÊN nhân viên để hiển thị; hỏng thì lùi về tên đã lưu trên phiếu, không đụng số tiền',
    },
    'src/routes/transactions.ts:p': {
        mau: 'salespersonName',
        ly: 'tra tên nhân viên cũ trên phiếu — thuần hiển thị',
    },
    'src/routes/transactions.ts:cust': {
        mau: 'customer.findUnique',
        ly: 'chỉ đắp thêm mã/điện thoại khách vào payload webhook; thiếu thì webhook vẫn đúng tiền',
    },
    'src/routes/tax.ts:existing': {
        mau: 'chartOfAccount.findUnique',
        ly: 'cột ChartOfAccount.code có @unique nên DB chặn trùng thật; nuốt lỗi chỉ đổi kiểu thông báo',
    },
    'src/services/kiotvietSync.ts:hienTai': {
        mau: 'customer.findUnique',
        ly: 'ĐÃ xử lý đúng: `if (!hienTai) return` kèm chú thích "đọc sổ hỏng ≠ sổ đang 0" — không ghi đè nợ',
    },
    'src/routes/accounts.ts:existing': {
        mau: 'chartOfAccount.findUnique',
        ly: 'ChartOfAccount.code có @unique — DB chặn trùng thật, nuốt lỗi chỉ đổi kiểu thông báo',
    },
    'src/routes/ccdc.ts:existing': {
        mau: 'cCDC.findFirst',
        ly: 'CCDC.code có @unique nên DB chặn; chốt phân bổ theo kỳ (cCDCAllocation) thì ĐÃ bỏ .catch',
    },
    'src/routes/ccdc.ts:dup': {
        mau: 'cCDC.findFirst',
        ly: 'nhập hàng loạt CCDC — cột code @unique, DB chặn trùng',
    },
    'src/routes/fixedAssets.ts:existing': {
        mau: 'fixedAsset.findFirst',
        ly: 'FixedAsset.code có @unique; chốt khấu hao theo kỳ thì ĐÃ bỏ .catch',
    },
    'src/routes/fixedAssets.ts:dup': {
        mau: 'fixedAsset.findFirst',
        ly: 'nhập hàng loạt tài sản — cột code @unique, DB chặn trùng',
    },
    'src/lib/onlineOrderProfit.ts:rows': {
        mau: 'costPrice: true',
        ly: 'thiếu giá vốn thành phần ⇒ bundleUnitCost = null ⇒ đơn được GẮN CỜ missingCost, không tính giá vốn 0',
    },
}

/* Nhận cả fallback là VẬT THỂ/MẢNG TOÀN SỐ 0 — `catch(() => [{ cnt: 0, total: 0 }])`. Bỏ sót dạng
 * này là bỏ sót nguyên một tab đếm đơn của trang bán online (tìm ra 20/08 khi soi tay). */
const NUOT = /\.catch\(\(\)\s*=>\s*(\[\]|0|null|\{\}|\(\{\}\)|\(?\[?\{[^}]*:\s*0[^}]*\}\]?\)?)\)/
/** Dấu hiệu giá trị được đem đi cộng/so ngay sau đó.
 *  `\|\| 0\)\s*[+-]` là mẫu `(Number(cur?.quantity) || 0) + delta` — CHÍNH LÀ hình dạng của hai lỗi
 *  ghi đè tồn kho (kiotvietSync và misaSync) mà bản đầu bộ soát BỎ SÓT, vì nó chỉ tìm `.reduce(`
 *  và `+=`. Thử ngược 20/08 mới lộ ra: cả hai lỗi đó là do đọc tay tìm thấy, không phải do bộ soát. */
const DUNG_DE_CONG = /\.reduce\(|\+=|_sum|Math\.abs\(|>= *1000|lech|tong[A-Z]|(\|\||\?\?)\s*0\s*\)\s*[+\-*]/
/** Đọc rồi GHI LẠI: giá trị nuốt được chảy thẳng vào upsert/update là ghi đè bằng số bịa. */
const DUNG_DE_GHI = /\.(upsert|update)\(/
/** Tên biến hay dùng cho chốt chống trùng / bản ghi hiện có. */
const TEN_CHOT_TRUNG = /^(existing|daCo|dup|trung|cur|current|hienTai)$/i

const nghiNgo: { file: string; dong: number; bien: string; trich: string }[] = []
let soCho = 0

for (const rel of FILE_TIEN) {
    const p = path.join(GOC, rel)
    if (!fs.existsSync(p)) { console.log(`· bỏ qua ${rel} (không có file)`); continue }
    const dong = fs.readFileSync(p, 'utf8').split('\n')
    for (let i = 0; i < dong.length; i++) {
        // Bỏ qua dòng chú thích: chính câu giải thích "KHÔNG .catch(() => null)" cũng khớp mẫu
        // và làm bộ soát tự báo mình (20/08/2026).
        if (/^\s*(\/\/|\/\*|\*)/.test(dong[i])) continue
        if (!NUOT.test(dong[i])) continue
        soCho++
        // Tên biến: tìm ngược tối đa 12 dòng để gặp `const <tên> ... = await`
        let bien = ''
        let iKhai = i
        for (let j = i; j >= Math.max(0, i - 12); j--) {
            const m = dong[j].match(/const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*await/)
            if (m) { bien = m[1]; iKhai = j; break }
        }
        if (!bien) continue
        const truoc = dong.slice(iKhai, i + 1).join('\n')       // cả câu lệnh đọc
        const sau = dong.slice(i + 1, i + 26).join('\n')        // 25 dòng kế
        const dungBien = new RegExp(`\\b${bien}\\b`).test(sau)
        /* CHỐT CHỐNG TRÙNG cũng phải soi, dù giá trị không hề được đem cộng: nuốt lỗi ở đó ⇒ tưởng
         * "chưa có" ⇒ tạo bản ghi THỨ HAI. Bốn ca nặng nhất tối 20/08 thuộc loại này, và bản đầu
         * của bộ soát bỏ sót một cái (chốt trùng trong cron xuất hoá đơn) vì chỉ tìm dấu cộng tiền. */
        const laChotTrung = TEN_CHOT_TRUNG.test(bien) && new RegExp(`if\\s*\\(\\s*!?${bien}\\b`).test(sau)
        /* DUNG_DE_GHI (bất kỳ .update/.upsert nào ở gần) từng được thử: ra 37 chỗ, phần lớn là ghi
         * không liên quan tới giá trị vừa đọc — đúng kiểu bộ soát ồn rồi bị tắt. Giữ lại nhưng chỉ
         * tính khi giá trị nuốt được CHẢY THẲNG vào phép tính rồi mới ghi (mẫu `|| 0) + delta`),
         * tức là đã nằm trong DUNG_DE_CONG. */
        if (!dungBien || (!DUNG_DE_CONG.test(sau) && !laChotTrung)) continue
        const duyet = DA_DUYET[`${rel}:${bien}`]
        if (duyet && (truoc.includes(duyet.mau) || sau.includes(duyet.mau))) continue
        nghiNgo.push({ file: rel, dong: i + 1, bien, trich: dong[i].trim().slice(0, 90) })
    }
}

console.log('=== check:nuotloi — nuốt lỗi đọc rồi đem cộng tiền / chống trùng ===')
console.log(`   Đã soi ${FILE_TIEN.length} file tiền, gặp ${soCho} chỗ nuốt lỗi.`)
if (nghiNgo.length) {
    console.error(`\n⚠  ${nghiNgo.length} chỗ đáng ngờ:`)
    for (const x of nghiNgo) console.error(`   - ${x.file}:${x.dong}  biến \`${x.bien}\`  → ${x.trich}`)
    console.error('\n   Soi tay từng chỗ. Vô hại thì khai vào DA_DUYET kèm `mau` + LÝ DO;')
    console.error('   có hại thì bỏ .catch (bên gọi bắt và bỏ lượt) hoặc gắn cờ "chưa đọc được".')
} else {
    console.log('\n✅ Không chỗ nào nuốt lỗi rồi đem số đó đi cộng tiền hay làm chốt chống trùng.')
}
for (const [k, v] of Object.entries(DA_DUYET)) console.log(`   · đã duyệt ${k} [${v.mau}]: ${v.ly}`)
process.exit(0)   // cảnh báo, không chặn — bộ soát này đoán ý code, đừng cho nó quyền chặn merge
