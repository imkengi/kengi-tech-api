/**
 * ĐỒNG BỘ CÂY DANH MỤC KIOTVIET → KENGI (2026-08-21)
 *
 * Vì sao có file này: KiotViet để danh mục **3 cấp**, còn Kengi chỉ nhận về **1 cấp**.
 * Gốc lỗi nằm ở `resolveCategory()` trong `kiotvietSync.ts`: nó chỉ đọc **một chuỗi tên phẳng**
 * (`kv.categoryName`) rồi `category.create({ name, description })` — không `parentId`, không
 * `level`. Trong khi đó model `Category` của Kengi **đã có sẵn** `parentId`/`level`/`children`,
 * và client KiotViet **đã có sẵn** `KV.categories()`. Hàm ấy chỉ chưa bao giờ được gọi.
 *
 * NGUYÊN TẮC:
 *
 *  1. **KHÔNG ĐẺ DANH MỤC TRÙNG.** Danh mục phẳng do bản cũ tạo (khớp theo TÊN) phải được
 *     NHẬN LẠI và nối cha cho nó, chứ không tạo bản sao. Tra theo `KiotVietMap` trước, rồi
 *     mới tới tên.
 *  2. **KHÔNG ĐỔI TÊN** danh mục Kengi đang có, trừ khi bật `overwriteNames` — cùng quy ước
 *     với phần còn lại của cổng.
 *  3. **KHÔNG TỰ NỐI CHA ĐÈ LÊN NGƯỜI DÙNG.** Danh mục đã có cha (do người dùng tự xếp) thì
 *     giữ nguyên; chỉ điền `parentId` khi đang trống.
 *  4. **CHỐNG VÒNG LẶP CHA-CON.** Dữ liệu KiotViet hỏng có thể tạo A→B→A; nối mù là treo mọi
 *     truy vấn đọc cây về sau.
 *  5. **Đọc hỏng ≠ rỗng.** Không lấy được danh mục thì báo lỗi, KHÔNG coi là "KiotViet không
 *     có danh mục nào" rồi bỏ qua êm.
 *
 * ⛔ PROD `PRISMA_POOL_SIZE=1` — mọi truy vấn ở đây TUẦN TỰ, không `Promise.all`.
 */

export interface DanhMucPhang {
    kvId: string
    ten: string
    kvParentId: string | null
    capDo: number          // 1 = gốc
}

/**
 * KiotViet trả danh mục theo HAI kiểu tuỳ tham số: lồng nhau (`children`) hoặc phẳng kèm
 * `parentId`. Nhận cả hai — đoán sai kiểu thì mất sạch cấp con mà vẫn "thành công".
 */
export function lamPhangDanhMuc(raw: any): DanhMucPhang[] {
    const ds: any[] = Array.isArray(raw) ? raw
        : Array.isArray(raw?.data) ? raw.data
            : Array.isArray(raw?.data?.data) ? raw.data.data
                : []
    const ra: DanhMucPhang[] = []
    const daThay = new Set<string>()

    const di = (nut: any, chaId: string | null, cap: number) => {
        if (!nut || cap > 10) return                       // 10: chặn dữ liệu lồng vô hạn
        const kvId = String(nut.categoryId ?? nut.id ?? '').trim()
        const ten = String(nut.categoryName ?? nut.name ?? '').trim()
        if (!kvId || !ten) return
        if (daThay.has(kvId)) return                       // KiotViet có lặp mục ở vài bản
        daThay.add(kvId)

        // parentId của chính bản ghi được ưu tiên hơn vị trí lồng — bản phẳng chỉ có nó
        const cha = nut.parentId != null && String(nut.parentId).trim() && String(nut.parentId) !== '0'
            ? String(nut.parentId).trim()
            : chaId
        ra.push({ kvId, ten, kvParentId: cha, capDo: cap })

        const con = Array.isArray(nut.children) ? nut.children : []
        for (const c of con) di(c, kvId, cap + 1)
    }

    for (const n of ds) di(n, null, 1)

    // Bản PHẲNG: cấp độ ở trên đều = 1 vì không lồng. Tính lại theo chuỗi cha.
    const theoId = new Map(ra.map(x => [x.kvId, x]))
    for (const x of ra) {
        let cap = 1, p = x.kvParentId, vong = 0
        while (p && vong++ < 10) {
            const cha = theoId.get(p)
            if (!cha) break
            cap++
            p = cha.kvParentId
        }
        x.capDo = cap
    }
    return ra
}

export interface KetQuaDanhMuc {
    layVe: number
    taoMoi: number
    noiCha: number        // danh mục đã có sẵn, nay được điền cha
    giuNguyen: number     // đã đúng rồi hoặc người dùng tự xếp — không đụng
    boQua: number
    loi: string[]
    capSau: Record<number, number>   // phân bố cấp SAU khi đồng bộ, để nhìn là biết còn phẳng không
    mau: Array<{ ten: string; cap: number; cha: string | null; hanhDong: string }>
}

/**
 * @param sp    Prisma client của cửa hàng
 * @param raw   Kết quả thô từ `KV.categories(creds)`
 * @param opts  apply=false ⇒ chỉ đếm, không ghi
 */
export async function dongBoCayDanhMuc(
    sp: any,
    raw: any,
    opts: { apply: boolean; overwriteNames?: boolean },
): Promise<KetQuaDanhMuc> {
    const kq: KetQuaDanhMuc = {
        layVe: 0, taoMoi: 0, noiCha: 0, giuNguyen: 0, boQua: 0,
        loi: [], capSau: {}, mau: [],
    }
    const dm = lamPhangDanhMuc(raw)
    kq.layVe = dm.length
    if (!dm.length) {
        kq.loi.push('KHÔNG đọc được danh mục nào từ KiotViet — kiểm lại quyền hoặc dạng trả về. '
            + 'KHÔNG được hiểu là "KiotViet không có danh mục".')
        return kq
    }

    const ghiMau = (m: KetQuaDanhMuc['mau'][number]) => { if (kq.mau.length < 12) kq.mau.push(m) }

    /* ── Vòng 1: tìm hoặc tạo từng danh mục (chưa nối cha) ─────────────────
     * Tra ánh xạ trước, rồi tới TÊN — để nhận lại đúng những danh mục phẳng mà bản cũ
     * đã tạo, thay vì đẻ thêm một bộ mới bên cạnh. TUẦN TỰ, pool prod = 1. */
    const localTheoKv = new Map<string, string>()
    /* ID Kengi ĐÃ bị một nhóm KiotViet nhận trong lượt này.
     *
     * KiotViet CHO PHÉP TRÙNG TÊN: đo HUTI 22/08/2026 có hai nhóm cùng tên "CC-DM-ĐB" nằm
     * dưới hai cha khác nhau. Bước dò dự phòng tra theo TÊN, nên cả hai cùng trỏ về MỘT
     * danh mục Kengi: cái thứ nhất nối cha xong, cái thứ hai thấy đã có cha nên báo
     * "người dùng đã xếp cha khác" và bỏ qua — nhìn ra ngoài thì y như thiếu danh mục.
     * Giữ sổ này để tên trùng thì tạo danh mục RIÊNG thay vì tranh nhau một chỗ. */
    const idDaChiem = new Set<string>()

    for (const x of dm) {
        try {
            let localId: string | null = null

            const anhXa = await sp.kiotVietMap.findUnique({
                where: { entity_kvId: { entity: 'category', kvId: x.kvId } },
                select: { localId: true },
            }).catch(() => null)
            /* Bỏ qua ánh xạ nếu danh mục đó ĐÃ bị một nhóm KiotViet khác nhận trong lượt
             * này. Lượt chạy trước (khi chưa có sổ idDaChiem) đã ghi ÁNH XẠ SAI: hai mã
             * KiotViet trùng tên cùng trỏ MỘT danh mục Kengi. Chỉ chặn ở đường dò-theo-tên
             * là không đủ — ánh xạ hỏng sẵn vẫn lọt, rồi cái thứ hai báo "người dùng đã xếp
             * cha khác", tức ĐỔ LỖI NHẦM cho người dùng trong khi họ không xếp gì cả.
             * Bỏ qua ở đây thì nó rơi xuống nhánh tạo mới và ánh xạ được ghi lại cho đúng. */
            if (anhXa?.localId && !idDaChiem.has(anhXa.localId)) {
                const con = await sp.category.findUnique({ where: { id: anhXa.localId }, select: { id: true } }).catch(() => null)
                if (con) localId = con.id      // ánh xạ có thể trỏ danh mục đã xoá
            }

            if (!localId) {
                // Lấy danh mục cùng tên ĐẦU TIÊN CHƯA BỊ CHIẾM — trùng tên thì cái sau tự tạo mới.
                const cungTen: Array<{ id: string }> = await sp.category
                    .findMany({ where: { name: x.ten }, select: { id: true }, take: 20 })
                    .catch(() => [])
                const chuaChiem = cungTen.find(c => !idDaChiem.has(c.id))
                if (chuaChiem) localId = chuaChiem.id
            }

            if (!localId) {
                if (!opts.apply) {
                    kq.taoMoi++
                    ghiMau({ ten: x.ten, cap: x.capDo, cha: null, hanhDong: 'sẽ tạo' })
                    continue                    // chạy thử: không có id thật để nối ở vòng 2
                }
                const moi = await sp.category.create({
                    data: { name: x.ten, level: x.capDo, description: 'Đồng bộ từ KiotViet' },
                    select: { id: true },
                })
                localId = moi.id
                kq.taoMoi++
                ghiMau({ ten: x.ten, cap: x.capDo, cha: null, hanhDong: 'tạo mới' })
            }

            // TS chưa suy được là nhánh trên luôn gán — chốt lại, và nếu thật sự rỗng thì
            // BỎ QUA có khai báo, không im lặng nhét null vào bảng tra.
            if (!localId) { kq.boQua++; continue }
            idDaChiem.add(localId)
            localTheoKv.set(x.kvId, localId)

            if (opts.apply) {
                await sp.kiotVietMap.upsert({
                    where: { entity_kvId: { entity: 'category', kvId: x.kvId } },
                    create: { entity: 'category', kvId: x.kvId, localId, syncedAt: new Date() },
                    update: { localId, syncedAt: new Date() },
                }).catch(() => { /* ánh xạ hỏng không được làm hỏng cả đợt */ })
            }
        } catch (e: any) {
            kq.boQua++
            if (kq.loi.length < 20) kq.loi.push(`${x.ten}: ${String(e?.message || e).slice(0, 160)}`)
        }
    }

    if (!opts.apply) {
        for (const x of dm) kq.capSau[x.capDo] = (kq.capSau[x.capDo] || 0) + 1
        return kq
    }

    /* ── Vòng 2: nối cha + đặt cấp ────────────────────────────────────────
     * Tách hẳn khỏi vòng 1 vì cha có thể xuất hiện SAU con trong danh sách KiotViet. */
    for (const x of dm) {
        const localId = localTheoKv.get(x.kvId)
        if (!localId) continue
        try {
            const hienTai = await sp.category.findUnique({
                where: { id: localId }, select: { id: true, name: true, parentId: true, level: true },
            }).catch(() => null)
            if (!hienTai) { kq.boQua++; continue }

            const chaLocal = x.kvParentId ? (localTheoKv.get(x.kvParentId) || null) : null

            // Không tự nối đè lên cách xếp của người dùng
            if (hienTai.parentId && hienTai.parentId !== chaLocal) {
                kq.giuNguyen++
                ghiMau({ ten: x.ten, cap: x.capDo, cha: null, hanhDong: 'giữ nguyên (người dùng đã xếp cha khác)' })
                continue
            }
            if (hienTai.parentId === chaLocal && hienTai.level === x.capDo) { kq.giuNguyen++; continue }

            // Chống vòng: cha không được là chính nó, cũng không được là con cháu của nó
            if (chaLocal && (await taoVong(sp, localId, chaLocal))) {
                kq.boQua++
                if (kq.loi.length < 20) kq.loi.push(`${x.ten}: bỏ nối cha vì sẽ tạo vòng cha-con`)
                continue
            }

            const data: any = { level: x.capDo }
            if (chaLocal !== hienTai.parentId) data.parentId = chaLocal
            if (opts.overwriteNames && hienTai.name !== x.ten) data.name = x.ten

            await sp.category.update({ where: { id: localId }, data })
            kq.noiCha++
            ghiMau({
                ten: x.ten, cap: x.capDo,
                cha: chaLocal ? (dm.find(d => localTheoKv.get(d.kvId) === chaLocal)?.ten ?? null) : null,
                hanhDong: 'nối cha',
            })
        } catch (e: any) {
            kq.boQua++
            if (kq.loi.length < 20) kq.loi.push(`${x.ten} (nối cha): ${String(e?.message || e).slice(0, 160)}`)
        }
    }

    // Phân bố cấp ĐỌC LẠI TỪ SỔ, không phải từ ý định — nhìn là biết còn phẳng hay đã có cây
    try {
        const nhom = await sp.category.groupBy({ by: ['level'], _count: true })
        for (const g of nhom) kq.capSau[Number(g.level)] = g._count
    } catch { /* không đọc được thì để trống, KHÔNG bịa số 0 */ }

    return kq
}

/** true nếu đặt `chaId` làm cha của `id` sẽ tạo vòng. Đi ngược lên tối đa 20 bậc. */
async function taoVong(sp: any, id: string, chaId: string): Promise<boolean> {
    if (id === chaId) return true
    let p: string | null = chaId
    for (let i = 0; i < 20 && p; i++) {
        if (p === id) return true
        const n: { parentId: string | null } | null =
            await sp.category.findUnique({ where: { id: p }, select: { parentId: true } }).catch(() => null)
        p = n?.parentId ?? null
    }
    return false
}
