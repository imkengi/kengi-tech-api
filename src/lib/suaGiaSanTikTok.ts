/**
 * SỬA GIÁ SÀN CHO ĐƠN TIKTOK CŨ — chủ shop duyệt 06/09/2026
 * ("sửa luôn giá trên sàn cho mấy đơn tiktok cũ đi")
 *
 * VẤN ĐỀ. `sale_price` TikTok trả về là SỐ KHÁCH TRẢ, đã trừ cả phần TikTok tài
 * trợ. Nhưng phần đó TikTok HOÀN LẠI cho shop khi quyết toán, nên doanh thu của
 * shop là giá sau giảm giá shop, TRƯỚC giảm giá sàn. Bản vá b547f40 đã sửa hàm
 * ánh xạ nhưng CHỈ CHO ĐƠN VỀ SAU; đơn cũ vẫn mang số khách trả ⇒ doanh thu ghi
 * thiếu ~20%, và "phí 27%" thật ra là 22,4% chia cho mẫu số thiếu.
 *
 * CÁCH DỰNG LẠI SỐ ĐÚNG. Gọi lại `getOrderDetail` của chính TikTokService —
 * dùng ĐÚNG hàm ánh xạ đang chạy, không chép lại công thức (chép lại là hai bản
 * công thức trôi khỏi nhau lúc nào không biết).
 *
 * HAI NGUỒN ĐỘC LẬP ĐỂ ĐỐI CHIẾU. Đơn đã đối soát có `netRevenue + platformFee`
 * = doanh thu sàn ghi nhận trong statement. Số dựng lại từ order detail phải
 * khớp con số đó. Bộ này ĐO độ khớp và báo ra, KHÔNG tự ý lấy cái này chữa cái
 * kia — hai nguồn lệch nhau là tín hiệu cần người đọc, không phải chỗ để đoán.
 *
 * NHỮNG THỨ BỊ ĐỤNG TỚI (mỗi nhóm một công tắc riêng):
 *   1. OnlineOrder.subtotal/total + OnlineOrderItem.unitPrice/lineTotal/discount
 *   2. Transaction `ONLINE-<mã đơn>` (phiếu bán) + dòng hàng + phiếu thanh toán
 *   3. MỘT bút toán điều chỉnh `ADJ-SALE-<số phiếu>`: Nợ 131-TIKTOK / Có 511
 *      phần doanh thu ghi thiếu.
 *
 * VÌ SAO ĐIỀU CHỈNH CHỨ KHÔNG SỬA BÚT TOÁN CŨ. Sửa đè số trên bút toán đã ghi là
 * viết lại lịch sử — sổ mất dấu vết. Bút toán điều chỉnh mang `reference` riêng
 * nên chạy lại bao nhiêu lần cũng không đẻ thêm, và người soát sổ thấy được
 * đúng ngày nào sửa, sửa bao nhiêu.
 *
 * ⛔ ĐƠN ĐÃ XUẤT HOÁ ĐƠN THÌ KHÔNG ĐỤNG. Hoá đơn đã phát hành chỉ sửa được bằng
 * hoá đơn điều chỉnh — đó là việc pháp lý của chủ shop, không phải của bộ vá dữ
 * liệu. Những đơn này được ĐẾM và LIỆT KÊ để chủ shop quyết riêng.
 */

const TRANG_THAI_HD_DA_PHAT_HANH = ['ISSUING', 'issued', 'SIGNED', 'SENT']

export interface KetQuaSuaGiaSan {
    cheDo: string
    quet: number
    dungRoi: number            // số dựng lại trùng số đang lưu → chỉ đánh dấu
    suaDuoc: number
    chenhTong: number          // tổng doanh thu ghi thiếu đã bù (đồng)
    boQuaHoaDon: number        // đã xuất HĐĐT → không đụng
    loiSan: number             // TikTok không trả đơn / lỗi gọi
    khongCoDong: number        // sàn trả đơn nhưng không có dòng hàng
    khongTyLeDuoc: number      // đơn đang lưu 0đ → không suy ra tỉ lệ cho phiếu bán
    phieuLa: number            // có phiếu bán nhưng doanh thu phiếu = 0 → không đụng phiếu
    coPhieuBan: number         // trong số sửa được, bao nhiêu đơn có phiếu bán
    daGhiButToan: number
    khoaSo: number             // kỳ đã khoá → chứng từ sửa, bút toán bỏ qua
    loiGhi: number
    // Đối chiếu với quyết toán (chỉ đơn đã có phí thật)
    doiChieu: { soDon: number; khop: number; lech: number; lechTrungBinh: number }
    viDu: any[]
    donDaXuatHoaDon: string[]
    loiMau: string[]
    dungVi240s: boolean
    conCho: number
    giay: number
}

const lam = (n: any) => Math.round(Number(n) || 0)

/** Chia lại `tong` cho các dòng theo tỉ lệ cũ, phần dư dồn vào dòng LỚN NHẤT
 *  để tổng khớp tuyệt đối (chia đều rồi làm tròn từng dòng là lệch vài đồng). */
function chiaTheoTiLe(dong: { lineTotal: number }[], tong: number): number[] {
    const tongCu = dong.reduce((s, d) => s + (Number(d.lineTotal) || 0), 0)
    if (tongCu <= 0) return dong.map(() => 0)
    const ra = dong.map(d => lam((Number(d.lineTotal) || 0) / tongCu * tong))
    const du = tong - ra.reduce((s, v) => s + v, 0)
    if (du !== 0) {
        let iMax = 0
        for (let i = 1; i < ra.length; i++) if ((ra[i] ?? 0) > (ra[iMax] ?? 0)) iMax = i
        ra[iMax] = (ra[iMax] ?? 0) + du
    }
    return ra
}

export async function suaGiaSanTikTok(
    sp: any,
    svc: any,
    opts: {
        take: number
        apply: boolean
        keCaHoaDon: boolean
        ghiSo: boolean
        channelId: string
        hanChot: number       // Date.now() phải nhỏ hơn mốc này
    },
): Promise<KetQuaSuaGiaSan> {
    const batDau = Date.now()
    const k: KetQuaSuaGiaSan = {
        cheDo: opts.apply ? 'GHI THẬT' : 'CHỈ CHẠY THỬ (không ghi)',
        quet: 0, dungRoi: 0, suaDuoc: 0, chenhTong: 0, boQuaHoaDon: 0,
        loiSan: 0, khongCoDong: 0, khongTyLeDuoc: 0, phieuLa: 0,
        coPhieuBan: 0, daGhiButToan: 0, khoaSo: 0, loiGhi: 0,
        doiChieu: { soDon: 0, khop: 0, lech: 0, lechTrungBinh: 0 },
        viDu: [], donDaXuatHoaDon: [], loiMau: [], dungVi240s: false, conCho: 0, giay: 0,
    }

    /* KHÔNG ĐỤNG ĐƠN HUỶ / HOÀN. Đơn huỷ đã có bút toán ĐẢO theo số cũ; sửa số
     * trên phiếu mà bút toán đảo giữ nguyên là để lại phần dư treo ở 131-TIKTOK.
     * Đơn huỷ cũng không có doanh thu để mà ghi thiếu — sửa chúng chỉ tốn lượt
     * gọi sàn và thêm rủi ro. */
    const TRANG_THAI_KHONG_DUNG = ['cancelled', 'CANCELLED', 'UNPAID', 'returned', 'TO_RETURN', 'IN_CANCEL', 'cancelling']
    const whereCho: any = {
        channelId: opts.channelId,
        giaSanSuaLuc: null,
        status: { notIn: TRANG_THAI_KHONG_DUNG },
    }
    const tongCho = await sp.onlineOrder.count({ where: whereCho })

    /* CŨ NHẤT TRƯỚC: đơn cũ chắc chắn nằm trước bản vá, và chạy nhiều lượt thì
     * mốc tự tiến (đơn đã xử lý mang dấu `giaSanSuaLuc`). */
    const orders: any[] = await sp.onlineOrder.findMany({
        where: whereCho,
        orderBy: { createdAt: 'asc' },
        take: opts.take,
        select: {
            id: true, orderNumber: true, externalOrderId: true, status: true,
            subtotal: true, total: true, discount: true, shippingFee: true,
            platformFee: true, netRevenue: true,
            items: { select: { id: true, externalItemId: true, sku: true, quantity: true, unitPrice: true, discount: true, lineTotal: true } },
        },
    })

    /* ĐƯỜNG QUAY LẠI. Sửa tiền trên sổ thật thì phải có cách trả về số cũ —
     * ghi số TRƯỚC/SAU của từng đơn vào một dòng SyncLog cho mỗi mẻ. Không nhét
     * vào `OnlineOrder.note` vì đó là ghi chú người dùng nhìn thấy. */
    const nhatKy: any[] = []

    let tongLech = 0
    for (const o of orders) {
        if (Date.now() > opts.hanChot) { k.dungVi240s = true; break }
        k.quet++

        // ── 1. Dựng lại số bằng CHÍNH hàm ánh xạ đang chạy ──────────────────
        let moi: any = null
        try {
            moi = await svc.getOrderDetail(String(o.externalOrderId || ''))
        } catch (e: any) {
            k.loiSan++
            if (k.loiMau.length < 3) k.loiMau.push(`${o.orderNumber}: ${String(e?.message || e).slice(0, 160)}`)
            continue
        }
        if (!moi) { k.loiSan++; continue }
        const dongMoi: any[] = moi.items || []
        if (!dongMoi.length) { k.khongCoDong++; continue }

        const subCu = lam(o.subtotal)
        const subMoi = lam(moi.subtotal)

        // ── 2. Đối chiếu với quyết toán (nguồn ĐỘC LẬP) ─────────────────────
        const theoQuyetToan = lam(o.netRevenue) > 0 ? lam(o.netRevenue) + lam(o.platformFee) : 0
        if (theoQuyetToan > 0) {
            k.doiChieu.soDon++
            const hieu = Math.abs(subMoi - theoQuyetToan)
            tongLech += hieu
            // Ngưỡng 2%: statement gộp cả phần phí/ship làm tròn theo đơn, không
            // bao giờ khớp đến từng đồng với tổng dòng hàng.
            if (hieu <= Math.max(2000, theoQuyetToan * 0.02)) k.doiChieu.khop++
            else k.doiChieu.lech++
        }

        /* ── 3a. Đơn đang lưu doanh thu 0 thì KHÔNG nhân tỉ lệ được ──────────
         * Không có mẫu số để suy ra phiếu bán phải đổi bao nhiêu. Đơn kiểu này
         * bất thường (0đ mà có dòng hàng) — đếm và để người xem, đừng đoán. */
        if (subCu <= 0) {
            k.khongTyLeDuoc++
            if (k.loiMau.length < 3) k.loiMau.push(`${o.orderNumber}: đang lưu 0đ, sàn trả ${subMoi}đ — không suy ra tỉ lệ, bỏ qua`)
            continue
        }

        // ── 3. Đã đúng rồi thì chỉ đánh dấu ─────────────────────────────────
        if (Math.abs(subMoi - subCu) <= 1) {
            k.dungRoi++
            if (opts.apply) await sp.onlineOrder.update({ where: { id: o.id }, data: { giaSanSuaLuc: new Date() } }).catch(() => { })
            continue
        }

        // ── 4. Đã xuất hoá đơn thì KHÔNG đụng ───────────────────────────────
        const soPhieu = `ONLINE-${o.orderNumber}`
        const phieu = await sp.transaction.findFirst({
            where: { receiptNumber: soPhieu },
            select: { id: true, subtotal: true, total: true, amountReceived: true, branchId: true, createdAt: true, transactionDate: true, items: { select: { id: true, lineTotal: true, quantity: true } }, payments: { select: { id: true, amount: true } } },
        })
        if (phieu) {
            const hd = await sp.eInvoice.count({
                where: { transactionId: phieu.id, status: { in: TRANG_THAI_HD_DA_PHAT_HANH } },
            }).catch(() => 0)
            if (hd > 0 && !opts.keCaHoaDon) {
                k.boQuaHoaDon++
                if (k.donDaXuatHoaDon.length < 50) k.donDaXuatHoaDon.push(o.orderNumber)
                continue   // KHÔNG đánh dấu — còn chờ chủ shop quyết
            }
        }

        const chenh = subMoi - subCu
        k.suaDuoc++
        k.chenhTong += chenh
        if (phieu) k.coPhieuBan++
        if (k.viDu.length < 5) {
            k.viDu.push({
                ma: o.orderNumber, cu: subCu, moi: subMoi, chenh,
                theoQuyetToan: theoQuyetToan || null,
                coPhieuBan: !!phieu,
            })
        }
        if (!opts.apply) continue

        // ── 5. GHI ──────────────────────────────────────────────────────────
        try {
            // 5a. Dòng hàng của ĐƠN SÀN — số chính xác từ sàn, khớp theo mã dòng
            const conLai = [...dongMoi]
            for (const dCu of o.items) {
                let i = conLai.findIndex((d: any) => d.externalItemId && String(d.externalItemId) === String(dCu.externalItemId))
                if (i < 0) i = conLai.findIndex((d: any) => d.sku && String(d.sku) === String(dCu.sku))
                if (i < 0) continue
                const dMoi = conLai.splice(i, 1)[0]
                await sp.onlineOrderItem.update({
                    where: { id: dCu.id },
                    data: {
                        unitPrice: lam(dMoi.unitPrice),
                        lineTotal: lam(dMoi.lineTotal),
                        discount: lam(dMoi.discount),
                    },
                })
            }

            // 5b. Đơn sàn. GIỮ NGUYÊN khoảng cách total − subtotal (ship/giảm giá
            //     đơn) thay vì gán cả hai bằng nhau — gán bừa là xoá mất phần đó.
            await sp.onlineOrder.update({
                where: { id: o.id },
                data: {
                    subtotal: subMoi,
                    total: subMoi + (lam(o.total) - subCu),
                    giaSanSuaLuc: new Date(),
                },
            })

            /* 5c. Phiếu bán + dòng hàng: NHÂN THEO TỈ LỆ của chính phiếu, KHÔNG
             *     gán số của sàn.
             *
             *  · Dòng phiếu bán tính theo ĐƠN VỊ KHO (đã quy đổi vỉ/cái) và có thể
             *    thiếu dòng (SKU chưa nối) — gán thẳng số của sàn là hỏng đơn giá
             *    quy đổi và làm tổng phiếu khác tổng dòng.
             *  · Lấy tỉ lệ chứ không gán bằng subMoi: phiếu có thể đã bị sửa tay
             *    lệch khỏi đơn; nhân tỉ lệ giữ nguyên quan hệ vốn có của phiếu.
             *  · Bút toán điều chỉnh phải bằng ĐÚNG phần doanh thu đổi TRÊN PHIẾU
             *    (bút toán SALE ghi theo `tx.subtotal`), không phải chênh của đơn sàn. */
            if (phieu && lam(phieu.subtotal) > 0) {
                const tySo = subMoi / subCu
                const txSubCu = lam(phieu.subtotal)
                const txTotalCu = lam(phieu.total)
                const subPhieuMoi = lam(txSubCu * tySo)
                const chenhSo = subPhieuMoi - txSubCu
                const phanBo = chiaTheoTiLe(phieu.items as any[], subPhieuMoi)
                nhatKy.push({
                    ma: o.orderNumber, donCu: subCu, donMoi: subMoi,
                    phieu: phieu.id, phieuSubCu: txSubCu, phieuSubMoi: subPhieuMoi,
                    phieuTotalCu: txTotalCu,
                    dong: (phieu.items as any[]).map((it: any, i: number) => ({ id: it.id, cu: lam(it.lineTotal), moi: phanBo[i] ?? 0 })),
                })
                for (let i = 0; i < phieu.items.length; i++) {
                    const it: any = phieu.items[i]
                    const lt = phanBo[i] ?? 0
                    const sl = Number(it.quantity) || 1
                    await sp.transactionItem.update({
                        where: { id: it.id },
                        data: { lineTotal: lt, unitPrice: lam(lt / sl) },
                    })
                }
                const totalPhieuMoi = lam(txTotalCu * tySo)
                await sp.transaction.update({
                    where: { id: phieu.id },
                    data: { subtotal: subPhieuMoi, total: totalPhieuMoi, amountReceived: totalPhieuMoi },
                })
                /* Đơn sàn chỉ có MỘT dòng thanh toán bằng đúng tổng đơn (orderSync
                 * tạo vậy). Nhiều dòng thì chia theo tỉ lệ, đừng gán mỗi dòng bằng
                 * cả tổng — làm thế là nhân đôi số tiền đã thu. */
                const tongTraCu = (phieu.payments as any[]).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0)
                if ((phieu.payments as any[]).length === 1) {
                    await sp.payment.update({ where: { id: (phieu.payments as any[])[0].id }, data: { amount: totalPhieuMoi } }).catch(() => { })
                } else if (tongTraCu > 0) {
                    for (const p of phieu.payments as any[]) {
                        await sp.payment.update({
                            where: { id: p.id },
                            data: { amount: lam((Number(p.amount) || 0) / tongTraCu * totalPhieuMoi) },
                        }).catch(() => { })
                    }
                }

                // 5d. Bút toán điều chỉnh — MỘT dòng, khoá theo reference riêng
                if (opts.ghiSo && chenhSo !== 0) {
                    const { khoaSoChan } = await import('./periodLock')
                    const ngay = String(phieu.transactionDate || phieu.createdAt || new Date()).slice(0, 10)
                    const khoa = await khoaSoChan(sp, phieu.branchId ?? null, ngay).catch(() => null)
                    if (khoa) {
                        k.khoaSo++
                    } else {
                        try {
                            await sp.journalEntry.create({
                                data: {
                                    date: ngay,
                                    description: `Điều chỉnh doanh thu TikTok ${o.orderNumber} — ghi theo giá bán trên sàn (trước giảm giá do sàn tài trợ)`,
                                    debitAccount: '131-TIKTOK', debitAccountName: 'Phải thu Công ty TikTok',
                                    creditAccount: '511', creditAccountName: 'Doanh thu bán hàng',
                                    amount: chenhSo,
                                    reference: `ADJ-SALE-${soPhieu}`,
                                    referenceType: 'sale',
                                    branchId: phieu.branchId ?? null,
                                    notes: `Doanh thu trên phiếu ${txSubCu.toLocaleString('vi-VN')}đ → ${subPhieuMoi.toLocaleString('vi-VN')}đ`
                                        + ` (đơn sàn ${subCu.toLocaleString('vi-VN')}đ → ${subMoi.toLocaleString('vi-VN')}đ)`,
                                },
                            })
                            k.daGhiButToan++
                        } catch (e: any) {
                            // Trùng khoá = đã điều chỉnh lần trước, không phải lỗi
                            if (!String(e?.code || '').includes('P2002')) {
                                k.loiGhi++
                                if (k.loiMau.length < 3) k.loiMau.push(`bút toán ${o.orderNumber}: ${String(e?.message || e).slice(0, 140)}`)
                            }
                        }
                    }
                }
            } else if (phieu) {
                /* Có phiếu bán nhưng doanh thu phiếu = 0: không có mẫu số để nhân
                 * tỉ lệ. Đơn sàn đã sửa xong ở trên; phiếu và sổ để nguyên và ĐẾM
                 * ra — im lặng bỏ qua là để sổ lệch mà không ai biết. */
                k.phieuLa++
                if (k.loiMau.length < 3) k.loiMau.push(`${o.orderNumber}: phiếu bán ghi doanh thu 0đ — đã sửa đơn, KHÔNG đụng phiếu/sổ`)
            }
        } catch (e: any) {
            k.loiGhi++
            if (k.loiMau.length < 3) k.loiMau.push(`${o.orderNumber}: ${String(e?.message || e).slice(0, 160)}`)
        }
    }

    /* Một dòng nhật ký cho cả mẻ — đủ để dựng lại số cũ nếu phải quay đầu.
     * Ghi hỏng thì NÓI RA: mất nhật ký nghĩa là mất đường về, dù dữ liệu đã sửa. */
    if (opts.apply && nhatKy.length) {
        try {
            await sp.syncLog.create({
                data: {
                    channelId: opts.channelId,
                    action: 'sua_gia_san_tiktok',
                    status: 'success',
                    ordersCount: nhatKy.length,
                    details: JSON.stringify({ luc: new Date().toISOString(), don: nhatKy }).slice(0, 900_000),
                },
            })
        } catch (e: any) {
            k.loiGhi++
            k.loiMau.push(`KHÔNG ghi được nhật ký hoàn tác (${nhatKy.length} đơn): ${String(e?.message || e).slice(0, 140)}`)
        }
    }

    k.doiChieu.lechTrungBinh = k.doiChieu.soDon > 0 ? lam(tongLech / k.doiChieu.soDon) : 0
    k.conCho = opts.apply ? await sp.onlineOrder.count({ where: whereCho }) : tongCho
    k.giay = Math.round((Date.now() - batDau) / 1000)
    return k
}
