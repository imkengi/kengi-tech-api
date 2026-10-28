/**
 * Kiểm "ĐỌC HỎNG ≠ KHÔNG CÓ" khi đồng bộ danh mục / thương hiệu KiotViet
 *   npx tsx scripts/check-kv-doc-hong-khong-tao.ts
 *
 * Đo HUTI 28/10/2026: 27 danh mục GỐC trùng tên với nhóm con có sẵn, không ánh xạ, 0 mặt hàng — tất cả sinh
 * đúng lúc hộp thư webhook chạy giữa cơn lỗi CSDL (P1001 "Can't reach database server", "Engine is not yet
 * connected" lúc máy chủ vừa khởi động). resolveCategory từng `.catch(() => null)` ba câu tra rồi coi "không
 * thấy" ⇒ TẠO MỚI. Thương hiệu cùng bệnh (một tên x5, một tên x2, bản thừa 0 mặt hàng). dongBoCayDanhMuc cũng vậy.
 *
 * Luật: tra mà LỖI thì phải lan ra (mã hàng đó ghi lỗi, lượt sau chạy lại) — tuyệt đối không tạo bản ghi mới.
 * Tra ra NULL thật (chưa có) thì vẫn tạo như cũ — bộ kiểm này giữ cả hai chiều.
 */
import { syncProducts, newCounters } from '../src/services/kiotvietSync'
import { dongBoCayDanhMuc } from '../src/services/kiotvietDanhMuc'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

const P1001 = () => Object.assign(new Error("Can't reach database server at `/cloudsql/x:5432`"), { code: 'P1001' })

type HanhVi = 'loi' | 'khong' | 'co'
/** Prisma giả: đếm create từng bảng; từng câu tra chọn ném lỗi / trả null / trả có. */
function taoSp(cfg: { mapDanhMuc?: HanhVi; tenDanhMuc?: HanhVi; thuongHieu?: HanhVi; findManyTen?: HanhVi } = {}) {
    const dem = { category: 0, brand: 0, product: 0, mapUpsert: 0 }
    const tra = (hv: HanhVi | undefined, co: any) => { if (hv === 'loi') throw P1001(); return hv === 'co' ? co : null }
    const sp: any = {
        _dem: dem,
        kiotVietMap: {
            findUnique: async (a: any) => a?.where?.entity_kvId?.entity === 'category' ? tra(cfg.mapDanhMuc, { localId: 'dm-co-san' }) : null,
            upsert: async () => { dem.mapUpsert++; return {} },
        },
        category: {
            findUnique: async (a: any) => a?.where?.id === 'dm-co-san' ? { id: 'dm-co-san', name: 'TOVÍT', parentId: 'deli', level: 2 } : null,
            findFirst: async () => tra(cfg.tenDanhMuc, { id: 'dm-co-san' }),
            findMany: async () => { const r = tra(cfg.findManyTen, [{ id: 'dm-co-san' }]); return r || [] },
            create: async (a: any) => { dem.category++; return { id: 'dm-moi', ...a.data } },
            update: async () => ({}),
        },
        brand: {
            findFirst: async () => tra(cfg.thuongHieu, { id: 'th-co-san' }),
            create: async () => { dem.brand++; return { id: 'th-moi' } },
        },
        product: {
            findUnique: async () => null, findFirst: async () => null,
            create: async (a: any) => { dem.product++; return { id: 'sp-moi', ...a.data } },
        },
    }
    return sp
}

const matHang = { id: 101, code: 'SP-THU', name: 'Hàng thử', categoryId: 555, categoryName: 'TOVÍT', tradeMarkName: 'Deli', inventories: [], basePrice: 1000 }
const opts: any = { apply: true, defaultCategoryId: null }

async function main() {
    console.log('\n▶ Đồng bộ KiotViet: đọc hỏng thì KHÔNG tạo danh mục / thương hiệu trùng\n')

    // 1 — tra ánh xạ danh mục ném P1001 ⇒ không tạo danh mục, không tạo hàng, ghi lỗi đúng mã
    {
        const sp = taoSp({ mapDanhMuc: 'loi' }); const c = newCounters()
        await syncProducts(sp, [matHang], opts, c)
        ok('1. ánh xạ danh mục lỗi ⇒ category.create = 0', sp._dem.category === 0, sp._dem)
        ok('1b. không tạo mặt hàng, failed = 1, lỗi nêu đúng mã', sp._dem.product === 0 && c.failed === 1 && /SP-THU/.test(c.errors[0] || '') && /Can't reach/.test(c.errors[0] || ''), c.errors)
    }
    // 2 — ánh xạ không có, tra TÊN ném lỗi ⇒ cũng không tạo
    {
        const sp = taoSp({ mapDanhMuc: 'khong', tenDanhMuc: 'loi' }); const c = newCounters()
        await syncProducts(sp, [matHang], opts, c)
        ok('2. tra tên danh mục lỗi ⇒ category.create = 0, failed = 1', sp._dem.category === 0 && sp._dem.product === 0 && c.failed === 1, { dem: sp._dem, c })
    }
    // 3 — ĐỐI CHỨNG: chưa có thật (null) ⇒ vẫn tạo danh mục + mặt hàng như cũ
    {
        const sp = taoSp({ mapDanhMuc: 'khong', tenDanhMuc: 'khong', thuongHieu: 'khong' }); const c = newCounters()
        await syncProducts(sp, [matHang], opts, c)
        ok('3. chưa có thật ⇒ tạo danh mục 1, thương hiệu 1, mặt hàng 1, failed 0',
            sp._dem.category === 1 && sp._dem.brand === 1 && sp._dem.product === 1 && c.failed === 0 && c.created === 1, { dem: sp._dem, c })
    }
    // 4 — danh mục tra được, THƯƠNG HIỆU tra lỗi ⇒ không tạo thương hiệu, không tạo hàng
    {
        const sp = taoSp({ mapDanhMuc: 'co', thuongHieu: 'loi' }); const c = newCounters()
        await syncProducts(sp, [matHang], opts, c)
        ok('4. tra thương hiệu lỗi ⇒ brand.create = 0, product.create = 0, failed = 1', sp._dem.brand === 0 && sp._dem.product === 0 && c.failed === 1, { dem: sp._dem, c })
    }
    // 5 — đối chứng thương hiệu: chưa có ⇒ tạo
    {
        const sp = taoSp({ mapDanhMuc: 'co', thuongHieu: 'khong' }); const c = newCounters()
        await syncProducts(sp, [matHang], opts, c)
        ok('5. thương hiệu chưa có thật ⇒ brand.create = 1, mặt hàng tạo được', sp._dem.brand === 1 && sp._dem.product === 1 && c.failed === 0, { dem: sp._dem, c })
    }
    // 6 — chạy thử (apply=false) mà tra lỗi: cũng phải ghi lỗi, không được "coi như sẽ tạo"
    {
        const sp = taoSp({ mapDanhMuc: 'loi' }); const c = newCounters()
        await syncProducts(sp, [matHang], { ...opts, apply: false }, c)
        ok('6. chạy thử mà tra lỗi ⇒ failed = 1, không đếm là tạo mới', c.failed === 1 && c.created === 0, c)
    }

    // 7 — dongBoCayDanhMuc: ánh xạ ném lỗi ⇒ không tạo, boQua + ghi lỗi
    const cay = [{ categoryId: 555, categoryName: 'TOVÍT', parentId: null }]
    {
        const sp = taoSp({ mapDanhMuc: 'loi' })
        const kq = await dongBoCayDanhMuc(sp, cay, { apply: true })
        ok('7. cây danh mục: ánh xạ lỗi ⇒ category.create = 0, boQua = 1, có dòng lỗi', sp._dem.category === 0 && kq.boQua === 1 && kq.loi.length === 1 && /Can't reach/.test(kq.loi[0] || ''), { dem: sp._dem, kq })
    }
    // 8 — ánh xạ không có, tra tên (findMany) ném lỗi ⇒ không tạo
    {
        const sp = taoSp({ mapDanhMuc: 'khong', findManyTen: 'loi' })
        const kq = await dongBoCayDanhMuc(sp, cay, { apply: true })
        ok('8. cây danh mục: tra tên lỗi ⇒ category.create = 0, boQua = 1', sp._dem.category === 0 && kq.boQua === 1 && kq.loi.length === 1, { dem: sp._dem, kq })
    }
    // 9 — đối chứng: chưa có thật ⇒ tạo 1 + ghi ánh xạ
    {
        const sp = taoSp({ mapDanhMuc: 'khong', findManyTen: 'khong' })
        const kq = await dongBoCayDanhMuc(sp, cay, { apply: true })
        ok('9. cây danh mục: chưa có thật ⇒ tạo mới 1, ghi ánh xạ 1, không lỗi', sp._dem.category === 1 && sp._dem.mapUpsert === 1 && kq.taoMoi === 1 && kq.loi.length === 0, { dem: sp._dem, kq })
    }
    // 10 — đối chứng: tên đã có (findMany trả 1) ⇒ nhận lại, không tạo
    {
        const sp = taoSp({ mapDanhMuc: 'khong', findManyTen: 'co' })
        const kq = await dongBoCayDanhMuc(sp, cay, { apply: true })
        ok('10. cây danh mục: tên đã có ⇒ không tạo, ghi ánh xạ', sp._dem.category === 0 && sp._dem.mapUpsert === 1 && kq.taoMoi === 0, { dem: sp._dem, kq })
    }

    console.log(`\n${hong ? '✗' : '✓'} ${dat} đạt · ${hong} hỏng\n`)
    process.exit(hong ? 1 : 0)
}
main().catch(e => { console.error('LỖI:', e); process.exit(1) })
