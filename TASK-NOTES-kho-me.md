# KHO MẸ — KENGISTORE mượn tồn của HUTI — 10/09/2026

## Mục tiêu (nguyên văn chủ shop)
"HUTI sẽ là tồn kho mẹ. KENGISTORE lấy data từ tồn kho mẹ đẩy lên Shopee, khi hoàn về
thì báo cho HUTI hoàn trả lại sản phẩm, có đơn thì trừ ra. Nó KHÔNG liên quan tới kho
hàng của thuế. Nó mượn kho HUTI để đẩy data lên cho sàn, mượn danh nghĩa tồn kho."

## Đã chốt (chủ shop chọn 10/09 — KHÔNG được tự đổi)
1. **Trừ CẢ HAI kho** khi có đơn sàn KENGISTORE (tôi đã nêu lo ngại tồn con đang âm,
   chủ shop vẫn chọn — làm đúng lựa chọn đó).
2. **CÓ ghi phiếu xuất nội bộ ở HUTI** — giải thích được vì sao tồn HUTI giảm.
3. **Đẩy lên sàn = tồn HUTI − đơn treo bên KENGISTORE** (đơn đã có mà CHƯA trừ kho).

## Facts đắt tiền (đo thật, đừng tìm lại)
- Bộ đo: `GET /admin/do-kho-me?me=HUTI&con=KENGISTORE` (admin key)
- HUTI 3.594 hàng / 3.594 SKU **riêng biệt** — không mã nào trùng
- KENGISTORE 3.274 hàng, 709 listing; khớp SKU con→mẹ **3.273/3.274**, **0 mã mập mờ**
- Listing tra tới kho mẹ: **503/503** listing có SKU (71% tổng). 206 listing tắc vì
  `sku = null` — đã tắc từ trước, không phải do việc này
- Tồn KENGISTORE thực tế là 0 / âm; HUTI mới có hàng thật ⇒ đúng là "mượn kho"
- `adjustSellableStock(client, productId, branchId, delta, reason)` ở `lib/warehouseHelper.ts`
  là cửa DUY NHẤT được đổi tồn (giữ bất biến WarehouseStock[kho main] = Product.stock)
- Trừ kho đơn sàn: `services/orderSync.ts` `convertOnlineOrderToTransaction`
- Hoàn kho: `services/onlineOrderReversal.ts` `reverseOnlineOrderEffects`
- Đẩy tồn lên sàn: `POST /online-orders/channels/:id/push-stock` (onlineOrders.ts ~5402)
- Đơn treo = `stockDeducted = false` + trạng thái chờ xác nhận
  (`TRANG_THAI_CHO_XAC_NHAN` ở `lib/donDuocXoa.ts`)

## Bẫy phải tránh
- **Hai schema Postgres khác nhau ⇒ KHÔNG chung transaction.** Ghi sang mẹ phải
  BEST-EFFORT + IDEMPOTENT, nếu không đứt giữa chừng là trừ hai lần.
- Idempotency: khoá duy nhất `(cuaHangCon, maDon, productId)` + cột trạng thái
  `da_xuat|da_hoan`, KHÔNG dùng "đã có bản ghi thì bỏ qua" — đơn reconvert sau khi
  hoàn sẽ không trừ lại được.
- PROD `PRISMA_POOL_SIZE=1` ⇒ tuần tự, không Promise.all, hai client càng phải cẩn thận.
- SKU ứng nhiều hàng bên mẹ ⇒ **BỎ QUA, không đoán** (hiện đo được 0 ca, nhưng luật
  phải có sẵn cho tương lai).
- Bảng MỚI ⇒ đi `POST /admin/sync-schemas`, KHÔNG phải `/admin/migrate`; nghiệm thu
  bằng nội dung chứ không bằng HTTP 200.
- Cột mới ⇒ `/admin/migrate` + viết THẲNG từng dòng ALTER (check:migrate dò bằng chuỗi).

## Đang làm / Tiếp theo
- [x] Bộ đo `do-kho-me` (commit 4d594d0, đã deploy, đã đo)
- [ ] Schema: `StoreSettings.khoMeMa` + bảng `KhoMeXuat` trên schema cửa hàng
- [ ] Đường trừ/hoàn sang kho mẹ (idempotent) + gắn vào orderSync và reversal
- [ ] push-stock đọc tồn mẹ − đơn treo
- [ ] Bộ đo chạy thử (dry-run) trước khi bật thật
