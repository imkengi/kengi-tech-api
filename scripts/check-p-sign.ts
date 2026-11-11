/**
 * check-p-sign — bộ kiểm P-Sign (lib/pSign.ts), 11/11/2026.
 * THUẦN: MISA eSign giả (thay global fetch) + CSDL giả trong RAM; không gọi mạng, không đụng DB.
 * ⚠ MISA giả dựng theo TÀI LIỆU, chưa phải MISA thật ⇒ bộ này canh lỗi của Kengi (thứ tự bước, bí mật, quyền theo người,
 * đọc hỏng không đoán), KHÔNG chứng minh hình dữ liệu thật của MISA.
 *
 * Chạy: npm run check:p-sign
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'a'.repeat(64)

import {
    LoiPSign, docTraVe, docDangNhap, docChungThu, tachDsChungThu, kiemViTri, kiemPdf, thanBam, docKetQuaBam, thanKy, docTrangThaiKy,
    thanGan, docTepDaKy, cheMa, luuKetNoi, docKetNoi, xoaKetNoi, dangNhap, xacThucOtp, docPhien, dsChungThu, chungThuGon, batDauKy,
    hoiTrangThai, hoanTat, dsNhatKy, trangThai, PDF_TOI_DA,
} from '../src/lib/pSign'

/** Chứng thư thử tự ký (chỉ phần công khai): CN=NGUYEN VAN THU, O=CONG TY THU NGHIEM, UID=MST:0123456789, hết hạn 2036 */
const CERT = 'MIIDpzCCAo+gAwIBAgIUeDw1bsHZWgHd2mKXr38Cl4oFQbcwDQYJKoZIhvcNAQELBQAwYzEXMBUGA1UEAwwOTkdVWUVOIFZBTiBUSFUxGzAZBgNVBAoMEkNPTkcgVFkgVEhVIE5HSElFTTEeMBwGCgmSJomT8ixkAQEMDk1TVDowMTIzNDU2Nzg5MQswCQYDVQQGEwJWTjAeFw0yNjExMTEwNDIyMDFaFw0zNjExMDgwNDIyMDFaMGMxFzAVBgNVBAMMDk5HVVlFTiBWQU4gVEhVMRswGQYDVQQKDBJDT05HIFRZIFRIVSBOR0hJRU0xHjAcBgoJkiaJk/IsZAEBDA5NU1Q6MDEyMzQ1Njc4OTELMAkGA1UEBhMCVk4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC9ustTBO8UCp+qreE2u4cRcYROESdho2jRcN8R/JJW49WzlAuiV7ARfAxo/olosYCJBzWwi+dqK4ZwcH9mZdKej2iGEh04sJI/S8/dBTWAW26V0gGWD1wuw1y6ShP6xmVVoIl58gfbHA+j/S0pljDEZWbnaFUaQYvZYhEGe5ZuxVRGeHgqxKxGWN7nveesBv0D0xlc8NcliH0NLYoFvcDurPuqj/U5MpKjfucQAugvwlRAsz8VQuuwVurgBzLsI2Bz18rutZ32D/aej1C7NgA/DUPZvvqfFQvGtjDuryJ1vMNxP5o/qkO6yDr8Jj7uheQj/0w7yr8zvIG9xgbZm6PJAgMBAAGjUzBRMB0GA1UdDgQWBBS/2vMfHoCPv5VE5ISiRucmoQm6QjAfBgNVHSMEGDAWgBS/2vMfHoCPv5VE5ISiRucmoQm6QjAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBr4KZ+ThWCUZZbhmTtYJf4OLaP+7eFhLkIQ3hgoQtJs9iah1j1ZgZXdevK7uZzwGa9XH/5Z5Fyy/Y6beDO4Px4eMp/QuL90DAZrOsEl3kYnyXypcHPh4zSTeUubf2NeTyQI2giNyjGzS29fMvjjrtvGM6VUMXMVk2EdvO0lwxL4RA8rMnaChg/dauMZfUOL3A8xdMk2o1n4vH9Q85tYFUVEAgrh64CvqCd0XfvOpbfzWlMYsDisEmGY7Whpbe7JOzxUnGRWnL82nHMA5cuEm34HIJxUnmC+OebMgZRwH8/bKA3T8wH8o9ih+jgftnuJ4WAEBKc3wv08rxBQKua2Myl'

let dat = 0, hong = 0
function ca(ten: string, dung: boolean, them = '') {
    if (dung) dat++
    else { hong++; console.log(`  ✗ ${ten}${them ? ` — ${them}` : ''}`) }
}
async function nem(ten: string, f: () => Promise<any>, khop: RegExp, ma?: string) {
    try { await f(); ca(ten, false, 'không ném') } catch (e: any) {
        ca(ten, e instanceof LoiPSign && khop.test(e.message) && (ma === undefined || e.ma === ma), `${e?.name}: ${e?.message} [${e?.ma}]`)
    }
}

// ─── CSDL giả ─────────────────────────────────────────────────────────────────
function taoSp() {
    const kn = new Map<string, any>(), phien = new Map<string, any>(), nk = new Map<string, any>()
    const sp: any = {
        __schema: 'thu_' + Math.random().toString(36).slice(2),
        _kn: kn, _phien: phien, _nk: nk,
        async $executeRawUnsafe(sql: string, ...a: any[]) {
            if (/^\s*CREATE /i.test(sql)) return 0
            if (/INSERT INTO "PSignKetNoi"/.test(sql)) { kn.set(a[0], { id: a[0], clientId: a[1], clientSecret: a[2], nguoiLuu: a[3], capNhatLuc: a[4] }); return 1 }
            if (/DELETE FROM "PSignKetNoi"/.test(sql)) return kn.delete(a[0]) ? 1 : 0
            if (/DELETE FROM "PSignPhien" WHERE/.test(sql)) return phien.delete(a[0]) ? 1 : 0
            if (/DELETE FROM "PSignPhien"/.test(sql)) { const n = phien.size; phien.clear(); return n }
            if (/INSERT INTO "PSignPhien"/.test(sql)) { phien.set(a[0], { userId: a[0], taiKhoan: a[1], misaUserId: a[2], ten: a[3], token: a[4], refreshToken: a[5], han: a[6], capNhatLuc: a[7] }); return 1 }
            if (/INSERT INTO "PSignNhatKy"/.test(sql)) { nk.set(a[0], { id: a[0], userId: a[1], nguoi: a[2], taiKhoan: a[3], tenTep: a[4], kichThuoc: a[5], certAlias: a[6], chuThe: a[7], transactionId: a[8], trangThai: 'cho', loi: null, taoLuc: a[9], xongLuc: null }); return 1 }
            if (/UPDATE "PSignNhatKy"/.test(sql)) {
                const d = nk.get(a[0])
                if (!d || d.userId !== a[1] || d.trangThai !== 'cho') return 0
                d.trangThai = a[2]; d.loi = a[3]; d.xongLuc = a[4]; return 1
            }
            throw new Error('CSDL giả: lệnh lạ ' + sql.slice(0, 80))
        },
        async $queryRawUnsafe(sql: string, ...a: any[]) {
            if (/FROM "PSignKetNoi"/.test(sql)) return kn.has(a[0]) ? [kn.get(a[0])] : []
            if (/FROM "PSignPhien"/.test(sql)) return phien.has(a[0]) ? [phien.get(a[0])] : []
            if (/SELECT "tenTep","trangThai" FROM "PSignNhatKy"/.test(sql)) { const d = nk.get(a[0]); return d && d.userId === a[1] && d.transactionId === a[2] ? [d] : [] }
            if (/FROM "PSignNhatKy"/.test(sql)) return [...nk.values()].sort((x, y) => y.taoLuc - x.taoLuc)
            throw new Error('CSDL giả: truy vấn lạ ' + sql.slice(0, 80))
        },
    }
    return sp
}

// ─── MISA eSign giả (theo tài liệu V1.0.0) ────────────────────────────────────
const M = {
    canOtp: false, tokenSong: 'tk-1', refreshSong: 'rf-1', tokenChet: false, refreshChet: false,
    trangThaiKy: 'PENDING' as string, certStatus: 'ACTIVE', hinhChungThuLa: false, hinhBamLa: false,
    goi: [] as { duong: string; method: string; headers: any; body: any }[],
}
const TX = '11111111-2222-3333-4444-555555555555'
const PDF_DA_KY = Buffer.from('%PDF-1.7 da ky').toString('base64')
const ok = (data: any) => ({ status: { type: 'success', code: 200, error: false, errorCode: 0 }, data })
const loi = (errorCode: number, userMsg: string, data: any = null) => ({ status: { type: 'fail', code: 200, error: true, errorCode, userMsg }, data })
const tokenData = (tk: string, rf: string) => ({ accessToken: 'misaid', remoteSigningAccessToken: tk, tokenType: 'Bearer', expiresIn: 2592000, refreshToken: rf, user: { id: 'u-misa-1', email: 'thu@example.test', firstName: 'Nguyễn', lastName: 'Thử', username: 'thu@example.test' } })

;(globalThis as any).fetch = async (url: string, init: any) => {
    const duong = String(url).replace('https://developer.misa.vn/apis/esign/v1', '')
    const body = init?.body ? JSON.parse(init.body) : undefined
    const h = init?.headers || {}
    M.goi.push({ duong, method: init?.method, headers: h, body })
    const tra = (status: number, j: any) => ({ status, text: async () => JSON.stringify(j) })
    if (!h.ClientID) return tra(401, { Success: false, Error: 'MISSING_CLIENT_ID', DescriptionError: 'ClientID header is required' })
    if (h.ClientID !== 'client-dung' || h.ClientSecret !== 'bi-mat-dung') return tra(401, { success: false, error: 'INVALID_CLIENT_ID', descriptionError: 'ClientID is not valid for product esign' })
    if (duong === '/auth/login-api') {
        if (body.password !== 'mk-dung') return tra(200, loi(101, 'Tên đăng nhập hoặc mật khẩu không đúng'))
        if (M.canOtp) return tra(200, loi(122, 'Cần xác thực 2 lớp', { default: { email: true, phoneNumber: false, appAuthenticator: false } }))
        return tra(200, ok(tokenData(M.tokenSong, M.refreshSong)))
    }
    if (duong === '/auth/two-factor-auth') return body.code === '123456' ? tra(200, ok(tokenData(M.tokenSong, M.refreshSong))) : tra(200, loi(123, 'Mã OTP không đúng'))
    if (duong === '/auth/refreshtoken') {
        if (M.refreshChet || body.refreshToken !== M.refreshSong) return tra(401, loi(3, 'Refresh token không hợp lệ'))
        M.tokenSong = 'tk-2'; M.refreshSong = 'rf-2'; M.tokenChet = false
        return tra(200, ok({ remoteSigningAccessToken: 'tk-2', refreshToken: 'rf-2', expiresIn: 2592000 }))
    }
    // từ đây cần token
    const canToken = !/^\/documents\//.test(duong)
    if (canToken && (M.tokenChet || h.AuthorizationRM !== `Bearer ${M.tokenSong}`)) return tra(401, loi(2, 'Token không hợp lệ'))
    if (duong === '/certificates/by-userId') {
        if (M.hinhChungThuLa) return tra(200, ok({ laLung: true }))
        return tra(200, ok([{ userId: 'u-misa-1', keyAlias: 'alias-1', appName: 'eSign', keyStatus: M.certStatus, certificate: CERT, certiticateChain: [CERT, 'TRUNGGIAN', 'GOC'] }]))
    }
    if (duong === '/documents/hash') {
        if (M.hinhBamLa) return tra(200, ok({ pdfDocs: [{ documentId: body.pdfDocs[0].documentId }] }))
        const d = body.pdfDocs[0]
        return tra(200, ok({ pdfDocs: [{ documentId: d.documentId, documentBytes: 'BYTES', digest: 'DIGEST', sh: 'SH', documentHash: 'HASH', signatureName: d.signatureInfo.signatureName }] }))
    }
    if (duong === '/signing/hash') return tra(200, ok({ transactionId: TX }))
    if (duong === `/signing/status/${TX}`) {
        const docId = M.goi.find(g => g.duong === '/documents/hash')?.body?.pdfDocs?.[0]?.documentId
        if (M.trangThaiKy === 'SUCCESS') return tra(200, ok({ status: 'SUCCESS', signatures: [{ documentId: docId, signature: 'CHU-KY' }] }))
        if (M.trangThaiKy === 'FAILED') return tra(200, ok({ status: 'FAILED', errorCode: 'USER_REJECTED', errorDescription: 'Người dùng từ chối ký' }))
        if (M.trangThaiKy === 'LA') return tra(200, ok({ status: 'DANG_LAM_GI_DO' }))
        return tra(200, ok({ status: 'PENDING' }))
    }
    if (duong === '/documents/attachment') return tra(200, ok({ pdfDocs: [{ documentId: body.pdfDocs[0].documentId, document: PDF_DA_KY }] }))
    return tra(404, { message: 'khong co' })
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64')
const VI_TRI = { trang: 1, x: 380, y: 60, rong: 180, cao: 70 }
const HIEN_THI = { nguoiKy: '', noiKy: 'TP.HCM', lyDo: 'Ký hợp đồng', lienHe: '', hienNgay: true }

async function main() {
    console.log('▶ check-p-sign')

    // ── A. Đọc trả về ──
    {
        const a = docTraVe(401, { Success: false, Error: 'MISSING_CLIENT_ID', DescriptionError: 'ClientID header is required' }, '')
        ca('A1 lỗi cổng: không ok, giữ nguyên chữ MISA', !a.ok && /ClientID header is required/.test(a.loi) && /MISSING_CLIENT_ID/.test(a.loi))
        const b = docTraVe(200, loi(122, 'Cần xác thực 2 lớp', { default: { email: true } }), '')
        ca('A2 HTTP 200 mà status.error ⇒ KHÔNG ok', !b.ok && b.maLoi === 122)
        ca('A3 mã 122 không token ⇒ cần OTP', docDangNhap(b).canOtp && docDangNhap(b).kenhOtp.email)
        const c = docDangNhap(docTraVe(200, ok(tokenData('t', 'r')), ''))
        ca('A4 đăng nhập đọc token + tên + mã người dùng', c.token === 't' && c.refreshToken === 'r' && c.misaUserId === 'u-misa-1' && c.ten === 'Nguyễn Thử' && !c.canOtp && c.songMs === 2592000_000)
        ca('A5 sai mật khẩu KHÔNG bị coi là cần OTP', !docDangNhap(docTraVe(200, loi(101, 'sai'), '')).canOtp)
        ca('A6 thân không phải JSON ⇒ không ok, có chữ', !docTraVe(502, null, 'Bad gateway').ok && docTraVe(502, null, 'Bad gateway').loi === 'Bad gateway')
        ca('A7 trả về không bọc data ⇒ thân là dữ liệu', docTraVe(200, { transactionId: TX }, '').data.transactionId === TX)
    }
    // ── B. Chứng thư ──
    {
        const c = docChungThu({ userId: 'u', keyAlias: 'k', keyStatus: 'ACTIVE', certificate: CERT, certiticateChain: [CERT] })
        ca('B1 đọc chủ thể / tổ chức / MST từ chính chứng thư', c.chuThe === 'NGUYEN VAN THU' && c.toChuc === 'CONG TY THU NGHIEM' && c.mst === '0123456789', JSON.stringify(chungThuGon(c)))
        ca('B2 ACTIVE + còn hạn ⇒ dùng được; chuỗi đọc từ trường viết sai chính tả của MISA', c.dungDuoc && c.chain.length === 1)
        ca('B3 INACTIVE ⇒ không dùng được, có lý do', !docChungThu({ keyAlias: 'k', keyStatus: 'INACTIVE', certificate: CERT }).dungDuoc)
        ca('B4 hết hạn ⇒ không dùng được', /hết hạn/.test(docChungThu({ keyAlias: 'k', keyStatus: 'ACTIVE', certificate: CERT }, Date.parse('2040-01-01')).lyDoKhongDung))
        ca('B5 thiếu nội dung chứng thư ⇒ không dùng được', !docChungThu({ keyAlias: 'k', keyStatus: 'ACTIVE' }).dungDuoc)
        ca('B6 chứng thư rác vẫn liệt kê (không ném)', docChungThu({ keyAlias: 'k', keyStatus: 'ACTIVE', certificate: 'AAAA' }).keyAlias === 'k')
        ca('B7 bản gọn KHÔNG mang nội dung chứng thư', !('certificate' in chungThuGon(c)) && !('chain' in chungThuGon(c)))
        ca('B8 hình lạ ⇒ docDuoc=false (không ra "0 chứng thư")', !tachDsChungThu({ laLung: 1 }).docDuoc && tachDsChungThu([]).docDuoc && tachDsChungThu({ certificates: [{}] }).ds.length === 1)
    }
    // ── C. Ô chữ ký, PDF, thân gửi ──
    {
        ca('C1 ô hợp lệ được làm tròn', kiemViTri({ trang: 1, x: 10.4, y: 20.6, rong: 150, cao: 50 }).y === 21)
        for (const [ten, v] of [['trang 0', { ...VI_TRI, trang: 0 }], ['x âm', { ...VI_TRI, x: -1 }], ['ô quá nhỏ', { ...VI_TRI, rong: 10 }], ['thiếu số', { trang: 1 }], ['chuỗi', { ...VI_TRI, x: '380' }]] as [string, any][]) {
            let nemRa = false
            try { kiemViTri(v) } catch (e) { nemRa = e instanceof LoiPSign }
            ca(`C2 ô sai (${ten}) ⇒ từ chối`, nemRa)
        }
        ca('C3 PDF hợp lệ', kiemPdf(PDF).bytes > 10 && kiemPdf('data:application/pdf;base64,' + PDF).b64 === PDF)
        let n1 = false, n2 = false, n3 = false
        try { kiemPdf(Buffer.from('PK\u0003\u0004 docx').toString('base64')) } catch (e: any) { n1 = /không phải PDF/.test(e.message) }
        try { kiemPdf('%%%') } catch (e: any) { n2 = e instanceof LoiPSign }
        try { kiemPdf(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(PDF_TOI_DA + 10)]).toString('base64')) } catch (e: any) { n3 = /tối đa/.test(e.message) }
        ca('C4 không phải PDF / rác / quá nặng ⇒ từ chối', n1 && n2 && n3)
        const ct = docChungThu({ userId: 'u', keyAlias: 'k', keyStatus: 'ACTIVE', certificate: CERT, certiticateChain: [CERT] })
        const tb: any = thanBam(ct, 'doc-1', PDF, VI_TRI, { ...HIEN_THI, nguoiKy: 'A' })
        const si = tb.pdfDocs[0].signatureInfo
        ca('C5 thân băm đúng tên trường tài liệu', tb.certificate === CERT && tb.certificateChain.length === 1 && tb.pdfDocs[0].FileToSign === PDF && si.positionX === 380 && si.positionY === 60 && si.width === 180 && si.height === 70 && si.page === 1 && si.renderingMode === 0 && si.signatureDescription.signedBy === 'A' && /^kengi/.test(si.signatureName))
        ca('C6 có ảnh chữ ký ⇒ renderingMode 1', (thanBam(ct, 'd', PDF, VI_TRI, { ...HIEN_THI, anhChuKy: 'AAAA' }) as any).pdfDocs[0].signatureInfo.renderingMode === 1)
        ca('C7 băm thiếu digest ⇒ null (không ký mù)', docKetQuaBam({ pdfDocs: [{ documentId: 'x' }] }) === null && docKetQuaBam({ pdfDocs: [{ documentId: 'x', digest: 'D' }] })?.digest === 'D')
        const tk: any = thanKy('u', 'alias', { documentId: 'doc-1', digest: 'DIG' }, 'a.pdf', 'x')
        ca('C8 thân ký: FileToSign = digest', tk.UserId === 'u' && tk.CertAlias === 'alias' && tk.Documents[0].FileToSign === 'DIG' && tk.Documents[0].DocumentId === 'doc-1')
        ca('C9 trạng thái lạ ⇒ null (không quay mãi)', docTrangThaiKy({ status: 'XYZ' }) === null && docTrangThaiKy({ status: 'pending' })?.trangThai === 'cho')
        const tg: any = thanGan(ct, { documentId: 'd', documentBytes: 'B', digest: 'D', sh: 'S', documentHash: 'H', signatureName: 'n' }, 'SIG')
        ca('C10 thân gắn giữ nguyên dữ liệu băm + chữ ký', tg.pdfDocs[0].signature === 'SIG' && tg.pdfDocs[0].sh === 'S' && tg.pdfDocs[0].documentBytes === 'B' && tg.CertificateChain.length === 1)
        ca('C11 đọc tệp đã ký', docTepDaKy({ pdfDocs: [{ documentId: 'd', document: 'QUJD' }] }) === 'QUJD' && docTepDaKy({}) === '')
        ca('C12 che ClientID', cheMa('0123456789abcdef') === '012345…cdef' && !cheMa('abcdefghijkl').includes('ghijkl'))
    }

    // ── D. Trọn luồng với MISA giả ──
    const sp = taoSp()
    await nem('D1 chưa kết nối ⇒ đăng nhập báo chua_ket_noi', () => dangNhap(sp, 'nv1', 'thu@example.test', 'mk-dung'), /Client ID/, 'chua_ket_noi')
    await nem('D2 lưu kết nối thiếu secret ⇒ từ chối', () => luuKetNoi(sp, { clientId: 'client-dung' }, 'chu'), /Client Secret/)
    await luuKetNoi(sp, { clientId: 'client-dung', clientSecret: 'bi-mat-dung' }, 'chu@x')
    ca('D3 Client Secret lưu MÃ HOÁ', !String(sp._kn.get('mac-dinh').clientSecret).includes('bi-mat-dung') && (await docKetNoi(sp))!.clientSecret === 'bi-mat-dung')
    const tt0: any = await trangThai(sp, 'nv1')
    ca('D4 trạng thái KHÔNG lộ secret, ClientID bị che', !JSON.stringify(tt0).includes('bi-mat-dung') && !JSON.stringify(tt0).includes('client-dung') && tt0.ketNoi.coKetNoi && !tt0.phien.dangNhap)
    await nem('D5 sai mật khẩu ⇒ lỗi nguyên văn MISA', () => dangNhap(sp, 'nv1', 'thu@example.test', 'sai'), /mật khẩu không đúng/)
    M.canOtp = true
    const dn1: any = await dangNhap(sp, 'nv1', 'thu@example.test', 'mk-dung')
    ca('D6 MISA đòi OTP ⇒ trả canOtp, CHƯA có phiên', dn1.canOtp === true && dn1.kenhOtp.email && (await docPhien(sp, 'nv1')) === null)
    await nem('D7 OTP sai ⇒ từ chối', () => xacThucOtp(sp, 'nv1', 'thu@example.test', '000000', 0), /OTP/)
    const otp: any = await xacThucOtp(sp, 'nv1', 'thu@example.test', '123456', 0)
    M.canOtp = false
    const p1 = await docPhien(sp, 'nv1')
    ca('D8 OTP đúng ⇒ có phiên, token lưu MÃ HOÁ', otp.daVao && p1?.token === 'tk-1' && !String(sp._phien.get('nv1').token).includes('tk-1') && !String(sp._phien.get('nv1').refreshToken).includes('rf-1'))
    ca('D9 KHÔNG lưu mật khẩu ở đâu', !JSON.stringify([...sp._phien.values(), ...sp._kn.values()]).includes('mk-dung'))
    ca('D10 mật khẩu chỉ đi tới /auth/login-api', M.goi.filter(g => JSON.stringify(g.body || {}).includes('mk-dung')).every(g => g.duong === '/auth/login-api'))
    await nem('D11 người KHÁC chưa đăng nhập ⇒ không mượn phiên nv1', () => dsChungThu(sp, 'nv2'), /Chưa đăng nhập/, 'can_dang_nhap')

    const ds = await dsChungThu(sp, 'nv1')
    ca('D12 đọc chứng thư', ds.length === 1 && ds[0].keyAlias === 'alias-1' && ds[0].dungDuoc && ds[0].chain.length === 3)
    M.hinhChungThuLa = true
    await nem('D13 chứng thư hình lạ ⇒ báo chưa đọc được (không ra rỗng)', () => dsChungThu(sp, 'nv1'), /chưa đọc được/)
    M.hinhChungThuLa = false

    // token chết ⇒ tự làm mới một lần
    M.tokenChet = true
    const ds2 = await dsChungThu(sp, 'nv1')
    ca('D14 token chết ⇒ làm mới bằng refreshToken rồi gọi lại', ds2.length === 1 && (await docPhien(sp, 'nv1'))?.token === 'tk-2' && (await docPhien(sp, 'nv1'))?.refreshToken === 'rf-2')

    // ký
    await nem('D15 chứng thư không thuộc tài khoản ⇒ từ chối', () => batDauKy(sp, { userId: 'nv1', nguoi: 'nv1@x' }, { tenTep: 'a.pdf', pdf: PDF, certAlias: 'alias-la', viTri: VI_TRI, hienThi: HIEN_THI }), /Không thấy chứng thư/)
    M.certStatus = 'INACTIVE'
    await nem('D16 chứng thư INACTIVE ⇒ không gửi yêu cầu ký', () => batDauKy(sp, { userId: 'nv1', nguoi: 'nv1@x' }, { tenTep: 'a.pdf', pdf: PDF, certAlias: 'alias-1', viTri: VI_TRI, hienThi: HIEN_THI }), /INACTIVE/)
    ca('D16b …và chưa gọi băm / ký', !M.goi.some(g => g.duong === '/documents/hash' || g.duong === '/signing/hash'))
    M.certStatus = 'ACTIVE'
    M.hinhBamLa = true
    await nem('D17 băm thiếu digest ⇒ dừng, KHÔNG gửi yêu cầu ký', () => batDauKy(sp, { userId: 'nv1', nguoi: 'nv1@x' }, { tenTep: 'a.pdf', pdf: PDF, certAlias: 'alias-1', viTri: VI_TRI, hienThi: HIEN_THI }), /chưa đọc được/)
    ca('D17b …và chưa gọi /signing/hash, chưa ghi nhật ký', !M.goi.some(g => g.duong === '/signing/hash') && sp._nk.size === 0)
    M.hinhBamLa = false
    M.goi.length = 0

    const k: any = await batDauKy(sp, { userId: 'nv1', nguoi: 'nv1@x' }, { tenTep: 'hop/dong:so 1', pdf: PDF, certAlias: 'alias-1', viTri: VI_TRI, hienThi: HIEN_THI })
    const gBam = M.goi.find(g => g.duong === '/documents/hash')!, gKy = M.goi.find(g => g.duong === '/signing/hash')!
    ca('D18 ký: trả mã giao dịch + dữ liệu băm, tên tệp sạch', k.transactionId === TX && k.docBam.digest === 'DIGEST' && k.tenTep === 'hop_dong_so 1.pdf' && k.hanGiay === 120)
    ca('D19 băm trước ký, ký gửi digest + mã người dùng + alias', M.goi.indexOf(gBam) < M.goi.indexOf(gKy) && gKy.body.Documents[0].FileToSign === 'DIGEST' && gKy.body.UserId === 'u-misa-1' && gKy.body.CertAlias === 'alias-1' && gKy.headers.AuthorizationRM === 'Bearer tk-2')
    ca('D20 người ký mặc định = chủ thể chứng thư', gBam.body.pdfDocs[0].signatureInfo.signatureDescription.signedBy === 'NGUYEN VAN THU')
    ca('D21 nhật ký ghi "cho", không có nội dung tệp', sp._nk.get(k.nhatKyId).trangThai === 'cho' && !JSON.stringify([...sp._nk.values()]).includes(PDF))

    ca('D22 đang chờ ⇒ cho', (await hoiTrangThai(sp, 'nv1', TX, k.nhatKyId)).trangThai === 'cho')
    await nem('D23 hoàn tất khi chưa xác nhận ⇒ từ chối, không gắn', () => hoanTat(sp, 'nv1', { transactionId: TX, nhatKyId: k.nhatKyId, certAlias: 'alias-1', docBam: k.docBam }), /Chưa xác nhận/, 'chua_xac_nhan')
    ca('D23b …chưa gọi /documents/attachment', !M.goi.some(g => g.duong === '/documents/attachment'))
    M.trangThaiKy = 'LA'
    await nem('D24 trạng thái lạ ⇒ báo chưa đọc được', () => hoiTrangThai(sp, 'nv1', TX, k.nhatKyId), /chưa đọc được/)
    M.trangThaiKy = 'SUCCESS'
    await nem('D25 người KHÁC không hoàn tất được lượt ký của nv1', async () => {
        sp._phien.set('nv2', { ...sp._phien.get('nv1'), userId: 'nv2' })
        await hoanTat(sp, 'nv2', { transactionId: TX, nhatKyId: k.nhatKyId, certAlias: 'alias-1', docBam: k.docBam })
    }, /Không thấy lượt ký/)
    await nem('D26 thiếu dữ liệu băm ⇒ từ chối', () => hoanTat(sp, 'nv1', { transactionId: TX, nhatKyId: k.nhatKyId, certAlias: 'alias-1', docBam: {} }), /dữ liệu băm/)
    const kt = await hoiTrangThai(sp, 'nv1', TX, k.nhatKyId)
    ca('D27 trạng thái xong KHÔNG trả chữ ký ra trình duyệt', kt.trangThai === 'xong' && !JSON.stringify(kt).includes('CHU-KY'))
    const xong: any = await hoanTat(sp, 'nv1', { transactionId: TX, nhatKyId: k.nhatKyId, certAlias: 'alias-1', docBam: k.docBam })
    const gGan = M.goi.find(g => g.duong === '/documents/attachment')!
    ca('D28 hoàn tất: gắn chữ ký LẤY TỪ MISA + dữ liệu băm, trả PDF', xong.pdf === PDF_DA_KY && xong.tenTep === 'hop_dong_so 1-da-ky.pdf' && gGan.body.pdfDocs[0].signature === 'CHU-KY' && gGan.body.pdfDocs[0].documentBytes === 'BYTES' && gGan.body.certificate === CERT)
    ca('D29 nhật ký chốt "xong"', sp._nk.get(k.nhatKyId).trangThai === 'xong')
    const nkDs = await dsNhatKy(sp)
    ca('D30 danh sách nhật ký không mang mã giao dịch / alias', nkDs.length === 1 && nkDs[0].trangThai === 'xong' && !('transactionId' in nkDs[0]) && !('certAlias' in nkDs[0]))

    // từ chối trên app
    M.trangThaiKy = 'PENDING'
    const k2: any = await batDauKy(sp, { userId: 'nv1', nguoi: 'nv1@x' }, { tenTep: 'b.pdf', pdf: PDF, certAlias: 'alias-1', viTri: VI_TRI, hienThi: HIEN_THI })
    M.trangThaiKy = 'FAILED'
    const tc = await hoiTrangThai(sp, 'nv1', TX, k2.nhatKyId)
    ca('D31 từ chối trên app ⇒ loi + lý do MISA, nhật ký chốt "loi"', tc.trangThai === 'loi' && /từ chối/.test(tc.moTa) && sp._nk.get(k2.nhatKyId).trangThai === 'loi' && /USER_REJECTED/.test(sp._nk.get(k2.nhatKyId).loi))
    M.trangThaiKy = 'SUCCESS'
    await hoiTrangThai(sp, 'nv1', TX, k2.nhatKyId)
    ca('D32 kết cục đã chốt không bị lật lại', sp._nk.get(k2.nhatKyId).trangThai === 'loi')

    // nhật ký treo quá hạn
    sp._nk.set('treo', { id: 'treo', userId: 'nv1', nguoi: '', taiKhoan: '', tenTep: 'c.pdf', kichThuoc: 1, chuThe: '', trangThai: 'cho', loi: null, taoLuc: Date.now() - 600_000, xongLuc: null })
    ca('D33 lượt "cho" quá hạn ký hiện "het_han"', (await dsNhatKy(sp)).find(x => x.id === 'treo')?.trangThai === 'het_han')

    // refresh cũng chết ⇒ xoá phiên, báo đăng nhập lại
    M.tokenChet = true; M.refreshChet = true
    await nem('D34 token + refresh đều chết ⇒ can_dang_nhap', () => dsChungThu(sp, 'nv1'), /đăng nhập lại/, 'can_dang_nhap')
    ca('D34b …và phiên đã xoá', (await docPhien(sp, 'nv1')) === null)
    M.tokenChet = false; M.refreshChet = false

    // đổi ClientID ⇒ xoá mọi phiên; xoá kết nối
    await dangNhap(sp, 'nv1', 'thu@example.test', 'mk-dung')
    await luuKetNoi(sp, { clientId: 'client-khac' }, 'chu@x')
    ca('D35 đổi ClientID ⇒ xoá mọi phiên, giữ secret cũ khi để trống', sp._phien.size === 0 && (await docKetNoi(sp))!.clientSecret === 'bi-mat-dung')
    await nem('D36 ClientID sai ⇒ lỗi cổng nguyên văn, KHÔNG coi là hết phiên', () => dangNhap(sp, 'nv1', 'thu@example.test', 'mk-dung'), /not valid for product/)
    ca('D37 xoá kết nối', (await xoaKetNoi(sp)) === true && (await docKetNoi(sp)) === null)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
