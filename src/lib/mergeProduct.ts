// ═══════════════════════════════════════════════════════════════════════════════
//  GỘP 2 MÃ HÀNG + ĐỒNG HOÁ SỐ LƯỢNG theo hệ số quy đổi.
//
//  Dùng khi cùng một món hàng bị tách thành 2 mã vì khác quy cách đóng gói:
//  nhập theo VỈ (mã A) nhưng bán theo CÁI (mã B). Hai mã tách rời làm chứng từ
//  đầu vào và số bán ra không bao giờ gặp nhau → tồn kho thuế luôn báo thiếu.
//
//  Nguyên tắc:
//   • rate = số đơn vị GỐC của mã ĐÍCH trong 1 đơn vị mã NGUỒN (1 vỉ = 10 cái).
//   • Số lượng ×rate, đơn giá ÷rate → THÀNH TIỀN TỪNG DÒNG KHÔNG ĐỔI.
//   • Phải sửa CẢ chuỗi mã/tên snapshot trong từng dòng (sku/productSku/
//     productName) — tồn kho thuế đối chiếu theo chuỗi đó, không theo khoá ngoại.
//   • Mã nguồn KHÔNG bị xoá: đổi tên __MERGED + ngừng bán + tồn 0 (giữ dấu vết).
//   • Tự tạo/nhân hệ số ánh xạ SKU để hoá đơn NCC ghi mã cũ vẫn tự quy đổi.
// ═══════════════════════════════════════════════════════════════════════════════

export interface MergePlan {
    from: { sku: string; name: string; stock: number; costPrice: number; baseUnit: string }
    to: { sku: string; name: string; stock: number; costPrice: number; baseUnit: string }
    rate: number
    rowsByTable: Record<string, number>
    onlineProductLinks: number
    stockSau: number
    after?: { sku: string; stock: number; costPrice: number } | null
    /** Cảnh báo nghi gộp NGƯỢC CHIỀU (chặn chạy thật trừ khi force) */
    warning?: string
    /** Cặp này đã gộp từ trước — chạy lại chỉ để đặt lại ĐVT chính */
    daGop?: boolean
}

export async function mergeProduct(
    sp: any,
    opts: {
        fromSku: string; toSku: string; rate: number; dryRun: boolean; force?: boolean
        /** ĐVT CHÍNH để kê thuế: 'source' = đơn vị mã nguồn (vd Vỉ), 'target' = đơn vị mã đích (Cái) */
        mainUnit?: 'source' | 'target'
        /** Tên đơn vị của mã nguồn (mặc định lấy ĐVT của chính nó) */
        unitName?: string
    },
): Promise<MergePlan> {
    const { fromSku, toSku, rate, dryRun } = opts

    const src = await sp.product.findFirst({ where: { sku: fromSku } })
    const dst = await sp.product.findFirst({ where: { sku: toSku } })
    if (!src) throw new Error(`Không có mã nguồn ${fromSku}`)
    if (!dst) throw new Error(`Không có mã đích ${toSku}`)
    if (src.id === dst.id) throw new Error('Hai mã trùng nhau')

    // Dò ĐỘNG các bảng có productId + cột liên quan, tránh sót bảng hoặc gọi nhầm
    // cột không tồn tại khi schema đổi.
    const cols = await sp.$queryRawUnsafe(`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND column_name IN ('productId','quantity','baseQuantity','costPrice','unitPrice','price','sku','productSku','productName','localProductId')`)
    const byTable: Record<string, Set<string>> = {}
    for (const c of cols as any[]) (byTable[c.table_name] ||= new Set()).add(c.column_name)

    // UnitConversion/ProductImage thuộc riêng mã nguồn → không mang sang
    const tables = Object.entries(byTable)
        .filter(([t, cs]) => cs.has('productId') && t !== 'UnitConversion' && t !== 'ProductImage')
        .map(([t]) => t)

    const rowsByTable: Record<string, number> = {}
    for (const t of tables) {
        const r = await sp.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}" WHERE "productId" = $1`, src.id)
        const n = (r as any[])[0]?.n || 0
        if (n > 0) rowsByTable[t] = n
    }
    const onlineProductLinks = byTable['OnlineProduct']?.has('localProductId')
        ? ((await sp.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "OnlineProduct" WHERE "localProductId" = $1`, src.id) as any[])[0]?.n || 0)
        : 0

    const plan: MergePlan = {
        from: { sku: src.sku, name: src.name, stock: src.stock, costPrice: src.costPrice, baseUnit: src.baseUnit },
        to: { sku: dst.sku, name: dst.name, stock: dst.stock, costPrice: dst.costPrice, baseUnit: dst.baseUnit },
        rate,
        rowsByTable,
        onlineProductLinks,
        stockSau: (dst.stock || 0) + (src.stock || 0) * rate,
    }

    // ── CHỐT CHẶN GỘP NGƯỢC CHIỀU ──────────────────────────────────────────
    // Gộp đúng chiều thì giá vốn nguồn ÷ hệ số ≈ giá vốn đích (84.530÷10 = 8.453).
    // Ngược chiều thì lệch hàng chục lần — chạy vào là số lượng bị thổi ×10 và
    // tồn kho/giá vốn hỏng, rất khó lùi. Chặn trừ khi người dùng ép chạy.
    const sc = Number(src.costPrice) || 0
    const dc = Number(dst.costPrice) || 0
    if (rate !== 1 && sc > 0 && dc > 0) {
        const expected = sc / rate
        const lech = Math.abs(expected - dc) / dc
        const lechNeuDao = Math.abs(dc / rate - sc) / sc
        if (lech > 0.25) {
            plan.warning = lechNeuDao <= 0.25
                ? `NGHI GỘP NGƯỢC CHIỀU: giá vốn ${src.sku} (${Math.round(sc).toLocaleString('vi-VN')}₫) ÷ ${rate} = ${Math.round(expected).toLocaleString('vi-VN')}₫ nhưng ${dst.sku} là ${Math.round(dc).toLocaleString('vi-VN')}₫. Nhiều khả năng phải gộp NGƯỢC LẠI: từ ${dst.sku} vào ${src.sku}.`
                : `Giá vốn không khớp hệ số: ${Math.round(sc).toLocaleString('vi-VN')}₫ ÷ ${rate} = ${Math.round(expected).toLocaleString('vi-VN')}₫, trong khi ${dst.sku} là ${Math.round(dc).toLocaleString('vi-VN')}₫. Kiểm tra lại hệ số quy đổi.`
        }
    }
    // Tồn nguồn ÂM = mã đó đang bán ra chứ không phải mã nhập vào → gần như chắc
    // chắn chọn nhầm chiều.
    if (!plan.warning && (src.stock || 0) < 0 && (dst.stock || 0) >= 0) {
        plan.warning = `NGHI GỘP NGƯỢC CHIỀU: ${src.sku} đang tồn ÂM (${src.stock}) — đây là mã BÁN RA, thường phải là mã ĐÍCH chứ không phải mã nguồn.`
    }

    // Cặp ĐÃ GỘP rồi: chạy lại không còn dòng nào để chuyển, nhưng vẫn hữu ích để
    // ĐẶT/SỬA ĐVT CHÍNH (các cặp gộp trước khi có tuỳ chọn này chưa có đơn vị nào).
    plan.daGop = (src as any).mergedIntoId === dst.id

    if (dryRun) return plan
    if (plan.warning && !opts.force) throw new Error(plan.warning + ' — nếu vẫn muốn chạy, tick "Tôi chắc chắn".')

    // Bảng nào có RÀNG BUỘC DUY NHẤT chứa productId (vd WarehouseStock theo
    // warehouseId+productId) thì KHÔNG chuyển thẳng được: mã đích thường đã có
    // sẵn dòng trong cùng kho → đụng khoá trùng (23505). Phải CỘNG DỒN vào dòng
    // sẵn có rồi xoá dòng nguồn, phần còn lại mới chuyển bình thường.
    const uniqRows = await sp.$queryRawUnsafe(`
        SELECT t.relname AS table_name, array_agg(a.attname ORDER BY k.ord) AS cols
        FROM pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE ix.indisunique AND n.nspname = current_schema()
        GROUP BY 1, i.relname
        HAVING 'productId' = ANY(array_agg(a.attname))`)
    const uniqByTable: Record<string, string[][]> = {}
    for (const r of uniqRows as any[]) {
        (uniqByTable[r.table_name] ||= []).push((r.cols as string[]).filter(c => c !== 'productId'))
    }

    await sp.$transaction(async (tx: any) => {
        // Gộp dòng đụng khoá trùng TRƯỚC khi chuyển hàng loạt
        for (const [t, keysets] of Object.entries(uniqByTable)) {
            if (!tables.includes(t)) continue
            const cs = byTable[t]!
            for (const others of keysets) {
                if (others.length === 0) continue
                const on = others.map(c => `d."${c}" = s."${c}"`).join(' AND ')
                if (cs.has('quantity')) {
                    await tx.$executeRawUnsafe(
                        `UPDATE "${t}" d SET "quantity" = d."quantity" + s."quantity" * ${rate}
                         FROM "${t}" s
                         WHERE s."productId" = $1 AND d."productId" = $2 AND ${on}`,
                        src.id, dst.id)
                }
                await tx.$executeRawUnsafe(
                    `DELETE FROM "${t}" s
                     WHERE s."productId" = $1
                       AND EXISTS (SELECT 1 FROM "${t}" d WHERE d."productId" = $2 AND ${on})`,
                    src.id, dst.id)
            }
        }
        for (const t of tables) {
            const cs = byTable[t]!
            const sets: string[] = [`"productId" = $1`]
            // Ánh xạ SKU trỏ vào mã nguồn: hệ số phải NHÂN THÊM rate, nếu không
            // hoá đơn sau này vẫn nhập 5 (vỉ) thay vì 50 (cái).
            if (t === 'SkuMapping') sets.push(`"conversionRate" = COALESCE("conversionRate",1) * ${rate}`)
            if (cs.has('quantity')) sets.push(`"quantity" = "quantity" * ${rate}`)
            if (cs.has('baseQuantity')) sets.push(`"baseQuantity" = "baseQuantity" * ${rate}`)
            if (cs.has('costPrice')) sets.push(`"costPrice" = "costPrice" / ${rate}`)
            if (cs.has('unitPrice')) sets.push(`"unitPrice" = "unitPrice" / ${rate}`)
            if (cs.has('price')) sets.push(`"price" = "price" / ${rate}`)
            if (cs.has('sku')) sets.push(`"sku" = $3`)
            if (cs.has('productSku')) sets.push(`"productSku" = $3`)
            if (cs.has('productName')) sets.push(`"productName" = $4`)
            await tx.$executeRawUnsafe(
                `UPDATE "${t}" SET ${sets.join(', ')} WHERE "productId" = $2`,
                dst.id, src.id, dst.sku, dst.name)
        }
        if (onlineProductLinks > 0) {
            await tx.$executeRawUnsafe(`UPDATE "OnlineProduct" SET "localProductId" = $1 WHERE "localProductId" = $2`, dst.id, src.id)
        }
        await tx.$executeRawUnsafe(
            `UPDATE "Product" SET stock = stock + $1 WHERE id = $2`, Math.round((src.stock || 0) * rate), dst.id)
        // KHÔNG dùng ON CONFLICT: ràng buộc (platformSku, platform) vô hiệu khi
        // platform = NULL (Postgres coi mọi NULL là khác nhau) → chạy gộp lần 2 là
        // đẻ thêm dòng trùng, đơn về lấy nhằm dòng nào thì theo hệ số dòng đó.
        const daCo = await tx.$queryRawUnsafe(
            `SELECT id FROM "SkuMapping" WHERE LOWER(TRIM("platformSku")) = LOWER(TRIM($1)) AND platform IS NULL LIMIT 1`,
            src.sku)
        if ((daCo as any[]).length > 0) {
            await tx.$executeRawUnsafe(
                `UPDATE "SkuMapping" SET "productId" = $1, "conversionRate" = $2, note = $3, "updatedAt" = NOW() WHERE id = $4`,
                dst.id, rate, `Gộp từ ${src.sku} (×${rate})`, (daCo as any[])[0].id)
        } else {
            await tx.$executeRawUnsafe(
                `INSERT INTO "SkuMapping" (id, "platformSku", "productId", platform, note, "conversionRate", "createdAt", "updatedAt")
                 VALUES ($1, $2, $3, NULL, $4, $5, NOW(), NOW())`,
                'skm' + Math.random().toString(36).slice(2, 12), src.sku, dst.id, `Gộp từ ${src.sku} (×${rate})`, rate)
        }
        // KHÔNG đổi mã: sàn dò sản phẩm theo SKU, đổi mã là gãy đẩy tồn của phân
        // loại cũ. Chỉ gắn CON TRỎ sang mã đích + hệ số; đơn về và đẩy tồn đều đi
        // theo con trỏ này. Tên có nhãn để người nhìn biết ngay.
        // ĐVT chính: khai luôn quy đổi trên mã đích (1 Vỉ = 10 Cái) và, nếu chọn
        // đơn vị mã nguồn làm chính, đặt luôn ĐVT ghi trên hoá đơn + BẢNG KÊ THIẾU
        // theo đơn vị đó — mua hàng theo vỉ thì bảng kê phải nói "thiếu 2 vỉ".
        const unitLabel = String(opts.unitName || src.baseUnit || 'Vỉ').trim()
        // BẪY ĐÃ DÍNH: mã vỉ thường mang ĐVT mặc định "Cái" y hệt mã đích → tên đơn
        // vị chính trùng đơn vị mã đích, khối dưới bị bỏ qua IM LẶNG và bảng kê vẫn
        // ra đơn vị nhỏ. Chọn "theo đơn vị mã gộp" mà không đặt tên khác = lỗi rõ.
        if (opts.mainUnit === 'source' && rate !== 1
            && unitLabel.toLowerCase() === String(dst.baseUnit || '').toLowerCase()) {
            throw new Error(
                `Phải đặt TÊN đơn vị chính khác "${dst.baseUnit}" (vd Vỉ, Lố, Thùng) — ` +
                `hiện mã ${src.sku} đang mang đơn vị "${src.baseUnit}" giống mã đích nên không phân biệt được.`)
        }
        if (rate !== 1 && unitLabel && unitLabel.toLowerCase() !== String(dst.baseUnit || '').toLowerCase()) {
            const existed = await tx.$queryRawUnsafe(
                `SELECT id FROM "UnitConversion" WHERE "productId" = $1 AND LOWER("toUnit") = LOWER($2) LIMIT 1`,
                dst.id, unitLabel)
            if ((existed as any[]).length === 0) {
                await tx.$executeRawUnsafe(
                    `INSERT INTO "UnitConversion" (id, "productId", "fromUnit", "toUnit", "conversionRate")
                     VALUES ($1, $2, $3, $4, $5)`,
                    'uc' + Math.random().toString(36).slice(2, 12), dst.id, dst.baseUnit || 'Cái', unitLabel, rate)
            }
            if (opts.mainUnit === 'source') {
                await tx.$executeRawUnsafe(`UPDATE "Product" SET "invoiceUnit" = $1 WHERE id = $2`, unitLabel, dst.id)
                // Ghi ĐVT vào CHÍNH mã gộp: mã vỉ mang đơn vị "Vỉ" là sự thật hiển
                // nhiên, khỏi phải suy ra từ hệ số (và phân biệt được vỉ với lố khi
                // hai thứ cùng hệ số).
                await tx.$executeRawUnsafe(`UPDATE "Product" SET "baseUnit" = $1 WHERE id = $2`, unitLabel, src.id)
            }
        }
        // KHÔNG đổi mã (sàn dò theo SKU) và KHÔNG đổi TÊN — tên là dữ liệu gốc,
        // dùng để in hoá đơn/tem và đối chiếu với sàn. Chỉ gắn CON TRỎ; giao diện
        // tự hiện nhãn "đã gộp" từ con trỏ đó.
        await tx.$executeRawUnsafe(
            `UPDATE "Product" SET stock = 0, "mergedIntoId" = $1, "mergedRate" = $2 WHERE id = $3`,
            dst.id, rate, src.id)
    }, { timeout: 120000 })

    plan.after = await sp.product.findFirst({ where: { id: dst.id }, select: { sku: true, stock: true, costPrice: true } })
    return plan
}
