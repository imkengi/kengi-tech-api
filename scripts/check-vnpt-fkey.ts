/**
 * Kiểm chứng XỬ LÝ "FKEY ĐÃ ĐƯỢC SỬ DỤNG" khi phát hành hoá đơn VNPT.
 *
 * Chạy:  npx tsx scripts/check-vnpt-fkey.ts
 *
 * Fkey là khoá chống trùng theo giao dịch. VNPT trả "Fkey đã được sử dụng"
 * nghĩa là hoá đơn NÀY ĐÃ PHÁT HÀNH RỒI — lần gửi trước đã tới đích, chỉ phản
 * hồi không về hoặc lưu DB hỏng giữa chừng.
 *
 * Ghi ERROR trong tình huống đó là sai kép: hoá đơn có thật bên cơ quan thuế mà
 * hệ thống coi như chưa có, và bấm "Xuất lại" sẽ hỏng mãi mãi vì Fkey vẫn trùng.
 *
 * Bộ test này ép ba điều:
 *   1. trùng Fkey + tra ra số  → phải trả THÀNH CÔNG kèm đúng số hoá đơn;
 *   2. trùng Fkey + tra không ra → phải báo đúng bản chất và CẤM phát hành lại;
 *   3. lỗi thật (chứng thư, timeout…) → vẫn phải là lỗi, không được nuốt.
 */

import { VnptProvider } from '../src/services/einvoice/vnpt'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const CONFIG: any = {
    templateId: '2', serialNo: 'C26MNH',
    extra: JSON.stringify({ typeCert: 'HSM', serialNumber: 'ABC123' }),
}
const DATA: any = {
    transactionId: 'tx-123', total: 110000, vatAmount: 10000, vatRate: 10,
    buyerName: 'Khách lẻ', items: [{ name: 'Hàng A', quantity: 1, unitPrice: 100000, amount: 100000 }],
}

/** Dựng provider với posApi/login/findByFkey giả — không chạm mạng. */
function dungProvider(opts: {
    phanHoi: { status: number; json?: any; raw?: string }
    traFkey?: { found: boolean; invoiceNumber?: string; lookupCode?: string }
}) {
    const p: any = new (VnptProvider as any)()
    let soLanTra = 0
    p.login = async () => ({ token: 'x' })
    p.fetchCert = async () => ({ type: 'HSM', serial: 'ABC123' })
    p.posApi = async () => ({ status: opts.phanHoi.status, json: opts.phanHoi.json, raw: opts.phanHoi.raw ?? '' })
    p.findByFkey = async () => { soLanTra++; return opts.traFkey ?? { found: false } }
    return { p, soLanTra: () => soLanTra }
}

/** Tên hàm phát hành có thể khác nhau giữa các bản — tìm đúng cái đang dùng. */
function timHamPhatHanh(p: any): string {
    for (const ten of ['issueInvoice', 'publishInvoice', 'issue', 'publish', 'createAndPublish']) {
        if (typeof p[ten] === 'function') return ten
    }
    throw new Error('Không tìm thấy hàm phát hành trên VnptProvider — sửa lại danh sách tên trong test')
}

async function main() {
    console.log('\n▶ Trùng Fkey + tra ra hoá đơn → PHẢI coi là thành công\n')

    {
        const { p, soLanTra } = dungProvider({
            phanHoi: { status: 400, json: { err_code: '1', message: 'Fkey đã được sử dụng trên hệ thống' } },
            traFkey: { found: true, invoiceNumber: '2162', lookupCode: 'M2-26-HA3TS-00100002162' },
        })
        const ten = timHamPhatHanh(p)
        const r: any = await p[ten](CONFIG, DATA)
        ok('trả về thành công thay vì lỗi', r.success === true, r)
        ok('lấy đúng số hoá đơn đã phát hành', r.invoiceNumber === '2162', r.invoiceNumber)
        ok('lấy cả mã tra cứu của cơ quan thuế', r.lookupCode === 'M2-26-HA3TS-00100002162', r.lookupCode)
        ok('có gọi tra theo Fkey', soLanTra() === 1, soLanTra())
    }

    console.log('\n▶ Trùng Fkey nhưng tra không ra → cấm phát hành lại\n')

    {
        const { p } = dungProvider({
            phanHoi: { status: 400, json: { err_code: '1', message: 'Fkey đã được sử dụng trên hệ thống' } },
            traFkey: { found: false },
        })
        const r: any = await p[timHamPhatHanh(p)](CONFIG, DATA)
        ok('vẫn là lỗi (không bịa thành công)', r.success === false, r)
        ok('nói rõ hoá đơn đã phát hành trước đó', /đã phát hành trước đó/.test(r.errorMessage || ''), r.errorMessage)
        ok('CẤM phát hành lại', /KHÔNG phát hành lại/.test(r.errorMessage || ''), r.errorMessage)
        ok('không để nguyên câu khó hiểu của VNPT',
            !/^Phát hành HĐ MTT lỗi/.test(r.errorMessage || ''), r.errorMessage)
    }

    console.log('\n▶ Lỗi THẬT → không được nuốt\n')

    for (const [ten, msg] of [
        ['sai chứng thư', 'Chứng thư truyền lên không đúng với chứng thư đăng ký trong hệ thống'],
        ['quá hạn đọc', 'Read timed out'],
        ['chưa có tờ khai', 'Không tồn tại tờ khai hoặc tờ khai chưa được duyệt'],
    ] as const) {
        const { p, soLanTra } = dungProvider({
            phanHoi: { status: 400, json: { err_code: '1', message: msg } },
            traFkey: { found: true, invoiceNumber: '9999' },
        })
        const r: any = await p[timHamPhatHanh(p)](CONFIG, DATA)
        ok(`${ten} → vẫn báo lỗi`, r.success === false, r)
        ok(`${ten} → KHÔNG đi tra Fkey (tránh nuốt lỗi thật)`, soLanTra() === 0, soLanTra())
        ok(`${ten} → giữ nguyên câu lỗi gốc để còn lần ra`, String(r.errorMessage || '').includes(msg.slice(0, 20)), r.errorMessage)
    }

    console.log('\n▶ Phát hành bình thường → vẫn chạy như cũ\n')

    {
        const { p, soLanTra } = dungProvider({
            phanHoi: { status: 200, json: { err_code: '0', data: [{ SHDon: '00002200', MCCQT: 'M2-26-XYZ' }] } },
        })
        const r: any = await p[timHamPhatHanh(p)](CONFIG, DATA)
        ok('thành công', r.success === true, r)
        ok('không gọi tra Fkey thừa', soLanTra() === 0, soLanTra())
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
