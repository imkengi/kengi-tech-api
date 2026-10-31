# MCP Server — Kengi Open-Retail

Cho AI agent (Claude, Cursor, agent tự viết…) **vận hành cửa hàng và fanpage** bằng công cụ thay vì bấm tay.

- **Endpoint:** `POST https://api.kengi.vn/api/mcp`
- **Giao thức:** JSON-RPC 2.0 — Streamable HTTP **stateless**, trả `application/json` (không SSE).
  Hỗ trợ `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
  `GET` / `DELETE` → 405 (không có session để giữ).
- **Cài đặt:** tự viết trong `src/routes/mcp.ts`, **không dùng `@modelcontextprotocol/sdk`** — bundle esbuild CJS (`--packages=external`) rất dễ vỡ với dependency ESM-only.

## Xác thực

Gửi kèm **mọi** request, chọn 1 trong 2 cách:

| Cách | Headers | Quyền |
|---|---|---|
| API key per-store | `X-API-Key: <secret>` + `x-store-code: <MÃ STORE>` | theo scope của key (`read` / `write`) |
| Admin nội bộ | `x-admin-key: <admin key>` + `x-store-code: <MÃ STORE>` | full |

API key tạo ở **kengi.vn/fanpage-manager → Trợ lý AI → Nối AI ngoài (MCP)** (nhiều key có tên + scope `read` / `read,write`, thu hồi từng cái — `GET /api/api-keys/list`, `POST /api/api-keys`, `DELETE /api/api-keys/:id`), hoặc **Dashboard → Cài đặt → API Keys** (đường cũ: 1 key scope admin, tạo mới = xoá hết key cũ). Key kiểu mới có dạng `ak_xxx.<random>` — auth tra thẳng theo `keyId` trước dấu chấm nên không tốn bcrypt cho mọi key. Mọi tool chỉ chạy trong phạm vi **một store** — store nào do header `x-store-code` quyết định.

Tool có cột `ghi` đòi scope chứa `write`; key chỉ `read` gọi vào sẽ bị từ chối.

## Kết nối từ Claude Code

```bash
claude mcp add --transport http kengi-retail https://api.kengi.vn/api/mcp --header "X-API-Key: <secret>" --header "x-store-code: KENGISTORE"
```

## Danh sách công cụ (80 — 40 bán lẻ/tài chính + 29 fanpage + 11 marketing)

Tham số **in đậm** là bắt buộc.

| Tool | Loại | Việc | Tham số |
|---|---|---|---|
| `get_store_overview` | đọc | Tổng quan hôm nay: doanh thu, đơn POS, đơn online chờ xử lý, hàng sắp hết. | — |
| `search_products` | đọc | Tìm hàng hoá theo tên / SKU / barcode. | **query**, limit |
| `get_product` | đọc | Chi tiết 1 hàng hoá (kèm nhóm hàng, tồn từng kho). | **sku_or_id** |
| `create_product` | ghi | Tạo hàng hoá mới. | **name**, **sellingPrice**, costPrice, sku, barcode, baseUnit, categoryName |
| `update_product_price` | ghi | Cập nhật giá bán / giá vốn. | **sku_or_id**, sellingPrice, costPrice |
| `low_stock_products` | đọc | Hàng sắp hết (tồn ≤ tồn tối thiểu). | limit |
| `sales_report` | đọc | Báo cáo bán hàng theo khoảng ngày + top 5 bán chạy. | from, to |
| `revenue_by_day` | đọc | Doanh thu từng ngày, tách kênh online/direct. | **from**, **to** |
| `online_orders_by_day` | đọc | Đếm đơn online theo ngày đặt, đã/chưa chuyển thành phiếu bán. | **from**, **to** |
| `list_recent_orders` | đọc | Phiếu bán hàng gần nhất. | limit, channel |
| `list_online_orders` | đọc | Đơn Shopee/TikTok/web gần nhất. | status, limit |
| `search_customers` | đọc | Tìm khách theo tên / SĐT / mã KH, kèm công nợ. | **query**, limit |
| `create_sale` | ghi | **Lên đơn bán hàng** — tạo phiếu, trừ kho, ghi công nợ + bút toán. | **items**, customer_query, amount_received, payment_type, discount, note |
| `create_customer` | ghi | Tạo khách hàng mới. | **name**, **phone**, address, email |
| `record_debt_payment` | ghi | **Thu nợ khách** — giảm dư nợ, ghi sổ công nợ + bút toán. | **customer_query**, amount, payment_type, note |
| `update_online_order_status` | ghi | Đổi trạng thái đơn online. | **order_number**, **status** |
| `top_customers` | đọc | Khách mua nhiều nhất, kèm công nợ. | limit |
| `inventory_value` | đọc | Giá trị tồn kho theo giá vốn và giá bán. | — |
| `list_categories` | đọc | Nhóm hàng + số mặt hàng mỗi nhóm. | — |
| `profit_report` | đọc | Lãi/lỗ: doanh thu − giá vốn − chi phí, biên lãi gộp. | from, to |
| `expense_report` | đọc | Chi phí theo nhóm + khoản lớn nhất. | from, to |
| `supplier_debt` | đọc | Công nợ phải trả NCC, phiếu quá hạn. | only_overdue, limit |
| `list_import_receipts` | đọc | Lịch sử nhập hàng, đã trả bao nhiêu, có HĐ VAT không. | from, to, limit |
| `stock_by_warehouse` | đọc | Tồn theo từng kho / xe bán lưu động. | product_query, limit |
| `fanpage_list_pages` | đọc | Fanpage đã kết nối + trạng thái token / webhook / auto-reply. | — |
| `fanpage_list_comments` | đọc | Bình luận mới, mặc định **chỉ trả cái chưa được trả lời**. | page_id, post_limit, only_unanswered |
| `fanpage_list_posts` | đọc | Bài đã đăng + lượt tương tác (lấy `post_id` để chạy ads). | page_id, limit |
| `fanpage_list_scheduled` | đọc | Bài đã lên lịch chưa đăng (kèm bài lỗi). | page_id |
| `fanpage_insights` | đọc | Lượt tiếp cận / tương tác theo ngày. | page_id, days |
| `fanpage_list_rules` | đọc | Quy tắc auto-reply bình luận. | page_id |
| `fanpage_auto_reply_log` | đọc | Nhật ký auto-reply (kiểm tra engine chạy đúng không). | page_id, limit |
| `fanpage_reply_comment` | ghi | Trả lời bình luận (kèm tuỳ chọn nhắn riêng / ẩn sau khi trả lời). | **comment_id**, **message**, page_id, private_reply, hide_after |
| `fanpage_hide_comment` | ghi | Ẩn / bỏ ẩn bình luận. | **comment_id**, hidden, page_id |
| `fanpage_create_post` | ghi | Đăng ngay hoặc lên lịch (chữ / ảnh / video / nhiều ảnh / link). | **message**, page_id, scheduled_at, media_urls, media_type, link_url |
| `fanpage_manage_scheduled_post` | ghi | Đăng ngay / đổi giờ / huỷ bài đã hẹn. | **id**, **action**, scheduled_at |
| `fanpage_create_rule` | ghi | Tạo quy tắc auto-reply (từ khoá → câu trả lời). | **keyword**, **reply_text**, page_id, match_type, name, private_reply, hide_comment, priority |
| `fanpage_update_rule` | ghi | Sửa hoặc bật/tắt một quy tắc đã có. | **id**, keyword, reply_text, match_type, enabled, private_reply, hide_comment, priority, name |
| `fanpage_delete_rule` | ghi | Xoá hẳn một quy tắc. | **id** |
| `fanpage_subscribe_webhook` | ghi | Bật webhook để bình luận về server tức thì. | page_id |
| `fanpage_set_auto_reply` | ghi | Bật / tắt engine auto-reply cho fanpage. | **enabled**, page_id |

### Thuế (thêm 2026-10-22 — `src/routes/mcpTaxTools.ts`)

Mỗi tool gọi ĐÚNG hàm mà màn hình Thuế dùng (AI không nói số khác màn hình). Tất cả chỉ đọc.

| Tool | Loại | Việc | Tham số |
|---|---|---|---|
| `tax_vat_return` | đọc | Tờ khai GTGT 01/GTGT của kỳ: đầu ra (Có 3331), đầu vào (Nợ 133), phải nộp, còn được khấu trừ + tờ khai đã lập. Bỏ trống kỳ = kỳ đang diễn ra theo cách cửa hàng kê khai. | year, month, quarter |
| `tax_deadlines` | đọc* | Lịch nghĩa vụ thuế: quá hạn / sắp đến hạn / sắp tới + số tiền từng mốc + căn cứ; số dư TK 3331/3334/3335. *Gieo mốc thiếu + đánh dấu quá hạn y như mở trang. | year |
| `einvoice_status` | đọc | HĐĐT bán ra: phiếu chờ xuất (theo sàn/ngày), đã gửi / lỗi trong N ngày + lỗi gần nhất, HĐ cần điều chỉnh / thay thế vì trả hàng. | days |
| `tax_stock` | đọc | Tồn kho thuế theo mã (nhập có HĐ − đã xuất HĐ + trả lại đã điều chỉnh); mã âm. | q, limit |
| `tax_pit` | đọc | Quyết toán TNCN năm: tổng + từng nhân viên (bản đã lưu, không thì tự tính). Năm ≥ 2026 cảnh báo nếu bộ tính còn mức giảm trừ cũ. | year |

Trợ lý trong dashboard có chế độ **Hỏi AI về thuế**: `POST /api/mcp-agent/chat` với `chuDe: "thue"` chỉ nạp bộ `TEN_TOOL_THUE` (5 tool trên + soát thanh tra/đối chiếu/TNDN + `accounting_*` + `data_health_check`), prompt riêng cho thuế, không có quyền ghi. Kiểm: `npm run check:mcp-thue`.

### Fanpage — bài đã đăng & bình luận theo bài (thêm 2026-08-15)

| Tool | Loại | Việc | Tham số |
|---|---|---|---|
| `fanpage_post_comments` | đọc | Toàn bộ bình luận của MỘT bài (kể cả đã trả lời, kèm cờ đã trả lời tự động / đã ẩn). | **post_id**, page_id, limit |
| `fanpage_edit_post` | ghi | Sửa nội dung chữ bài đã đăng hoặc đã hẹn (nhận fb post id hoặc id bài hẹn nội bộ). | **post_id**, **message**, page_id |
| `fanpage_delete_post` | ghi | Xoá vĩnh viễn bài đã đăng — bắt buộc `confirm=true`. | **post_id**, **confirm**, page_id |
| `fanpage_like_comment` | ghi | Like / bỏ like bình luận bằng danh nghĩa page. | **comment_id**, like, page_id |
| `fanpage_delete_comment` | ghi | Xoá hẳn bình luận (spam/lừa đảo). Tiêu cực thường → dùng hide. | **comment_id**, page_id |

### Fanpage — Messenger inbox (page token cần `pages_messaging`)

| Tool | Loại | Việc | Tham số |
|---|---|---|---|
| `fanpage_list_conversations` | đọc | Hội thoại mới nhất: khách, tin cuối, số chưa đọc; trả `conversation_id` + `customer_id`. | page_id, limit, only_unread |
| `fanpage_read_conversation` | đọc | Tin nhắn trong 1 hội thoại + cờ còn trong cửa sổ 24h không. | **conversation_id**, page_id, limit |
| `fanpage_send_message` | ghi | Gửi tin cho khách (PSID). Ngoài 24h phải kèm `tag` đúng mục đích. | **customer_id**, **message**, page_id, tag |

REST tương ứng: `GET /api/fanpage/pages/:pageId/conversations`, `GET /api/fanpage/conversations/:id/messages?pageId=`, `POST /api/fanpage/pages/:pageId/messages`.

### Fanpage — quảng cáo (Marketing API; cần **user token** có `ads_management` — store chỉ dán page token sẽ bị báo rõ)

| Tool | Loại | Việc | Tham số |
|---|---|---|---|
| `fanpage_ads_accounts` | đọc | Tài khoản quảng cáo: trạng thái, tiền tệ, đã chi, số dư. | — |
| `fanpage_ads_campaigns` | đọc | Chiến dịch trong 1 tài khoản + hiệu quả 30 ngày (tuần tự, tối đa 50). Bỏ trống `ad_account_id` nếu chỉ có 1 hoặc page đã gán mặc định. | ad_account_id, page_id, with_insights |
| `fanpage_ads_insights` | đọc | Số liệu 1 đối tượng (act_/campaign/adset/ad) theo `date_preset`. | **object_id**, date_preset |
| `fanpage_ads_set_campaign_status` | ghi | ACTIVE / PAUSED một chiến dịch — ACTIVE = tiêu tiền thật. | **campaign_id**, **status** |
| `fanpage_boost_post` | ghi | Tạo boost (campaign+adset+ad) ở trạng thái PAUSED để duyệt; bật bằng tool trên. | **post_id**, **daily_budget_vnd**, days, ad_account_id, page_id, age_min, age_max, countries |

Các tool `fanpage_edit_post / delete_post / delete_comment / like_comment / send_message / ads_set_campaign_status / boost_post` nằm trong `TOOL_NHAY_CAM` — tác vụ tự động phải khai đích danh mới được dùng.

### Shopee — AI tự quản một gian (thêm 2026-10-31 — `src/routes/mcpShopeeTools.ts`)

AI tự đăng sản phẩm từ kho lên một gian Shopee, tự tính giá theo **phí sàn thật** của gian, rồi soát/đổi giá. Đơn về, trừ kho, đẩy tồn, chat khách vẫn đi đường sẵn có (autoSync / `dayTonLenSan` / chatbot Shopee) — `item_sku` = SKU kho nên đơn tự khớp, không phải nối listing tay.

| Tool | Loại | Việc | Tham số |
|---|---|---|---|
| `shopee_shop_info` | đọc | Gọi đầu tiên: các gian, token, số listing + lần đồng bộ cuối, **mô hình phí** đo từ đơn, kênh vận chuyển đang bật, giới hạn đăng. | kenh |
| `shopee_sync_listings` | ghi (nội bộ) | Kéo lại sản phẩm đang bán của gian vào `OnlineProduct` (chung hàm với nút Đồng bộ web) — chống đăng trùng. | kenh |
| `shopee_listing_candidates` | đọc | Hàng kho chưa có trên gian, còn tồn; kèm giá vốn, ảnh, mô tả, `thieu`. | kenh, query, nhom_hang, chi_du_dieu_kien, limit |
| `shopee_suggest_price` | đọc | Giá đề xuất / **giá sàn** / hoà vốn / lãi dự kiến + giá đang bán nơi khác. | **sku**, kenh, gia_thu, category_id, bien_loi_nhuan, bien_toi_thieu, phi_dong_goi, phi_quang_cao, lam_tron |
| `shopee_category_suggest` | đọc | Ngành Shopee gợi ý theo tên + tìm trong cây ngành. | ten, tu_khoa, kenh |
| `shopee_category_attributes` | đọc | Thuộc tính bắt buộc (kèm giá trị có sẵn), thương hiệu, giới hạn của ngành. | **category_id**, tim_thuong_hieu, day_du, kenh |
| `shopee_create_listing` | ghi* | Đăng sản phẩm: nạp ảnh, khai tồn bán được, kênh vận chuyển, giá (bỏ trống = đề xuất). `chay_thu=true` xem trước. | **sku**, **category_id**, **can_nang_gram**, kenh, gia, ten, mo_ta, thuoc_tinh, brand_id, ten_thuong_hieu, dai/rong/cao_cm, kenh_van_chuyen, so_luong_dang, an_sau_khi_dang, chay_thu, +tham số giá |
| `shopee_review_listings` | đọc | Soát giá listing đang bán: lãi/biên mỗi đơn, cờ dưới sàn / dưới mục tiêu / 14 ngày không bán, giá đề xuất. | kenh, chi_van_de, limit, +tham số giá |
| `shopee_update_price` | ghi* | Đổi giá một listing (item_id hoặc sku). | **gia_moi**, item_id, sku, kenh, ly_do, bien_toi_thieu, phi_dong_goi, phi_quang_cao |
| `shopee_toggle_listing` | ghi* | Ẩn / hiện lại một listing. | **item_id**, **an**, kenh, ly_do |

\* nằm trong `TOOL_NHAY_CAM` — tác vụ tự động phải khai đích danh trong `allowedTools`.

**Tính giá** (`src/lib/giaShopee.ts`): phí một đơn = `tyLe × giá + coDinh`. Hai tham số **đo từ đơn đã đối soát 90 ngày** của gian (`platformFee` = giá bán − thực nhận, lấy từ escrow): ≥ 15 đơn giá trải rộng → hồi quy tách phí cố định/đơn; ≥ 8 đơn → tỷ lệ tổng; gian mới chưa đủ đơn → **mượn số đo các gian Shopee khác của cửa hàng**; vẫn không có → `commissionRate` của kênh (kèm cảnh báo — mặc định 6% thường thấp hơn phí thật).
`giá = (giá vốn + phí cố định + đóng gói) / (1 − tỷ lệ phí − biên mục tiêu − quảng cáo%)`, làm tròn lên. Tính cho đơn 1 sản phẩm.

**Rào an toàn** (máy chủ chặn, không phụ thuộc AI tự giác):
- Giá **dưới giá sàn** (biên tối thiểu, mặc định 5%, không nhận số âm) → `shopee_create_listing` / `shopee_update_price` từ chối. Thiếu giá vốn → không đăng, không đổi giá.
- Đăng trùng: chặn nếu gian đã có listing nối hàng đó / cùng SKU / SKU ánh xạ về hàng đó. Danh mục gian cũ quá 2 ngày → `shopee_shop_info` nhắc `shopee_sync_listings`.
- Hàng mã đã gộp, combo, dịch vụ, hết hàng, chưa có ảnh → từ chối kèm lý do. Tồn khai lên theo đúng luật đẩy tồn (kho mẹ − đơn treo nếu cửa hàng mượn kho).
- `can_nang_gram` bắt buộc; prompt dặn AI không đoán cân nặng / thuộc tính / thông số.
- Ảnh tải từ link sản phẩm (chặn link mạng nội bộ), chỉ JPG/PNG ≤ 10MB, nạp qua `v2.media_space.upload_image` (qua Tino: `file_field=image`).

**Mẫu tác vụ tự động** (`POST /api/ai-jobs`). Một lượt agent tối đa **20 bước**, đăng một mặt hàng tốn ~4 bước (ngành → thuộc tính → đăng…) nên tách HAI tác vụ; chủ shop sửa chính sách giá ngay trong chỉ thị.

Đăng hàng — mỗi 3 giờ, 2 mặt hàng/lượt:

```json
{
  "name": "Shopee AI — đăng hàng",
  "prompt": "Gian Shopee \"Kengi AI Shop\". Chính sách giá: biên lãi mục tiêu 18%, tối thiểu 8%, đóng gói 3.000đ/đơn, quảng cáo 3%. Gọi shopee_shop_info (có canhBaoDanhMuc thì shopee_sync_listings). shopee_listing_candidates chi_du_dieu_kien=true limit=5, đăng tối đa 2 mặt hàng: shopee_category_suggest → shopee_category_attributes → shopee_create_listing với đúng chính sách giá trên. Chỉ khai thuộc tính chắc chắn đúng; cân nặng lấy trong mô tả sản phẩm, không có thì BỎ QUA mặt hàng và ghi vào báo cáo. Báo cáo: đã đăng gì (link, giá, lãi dự kiến), mặt hàng nào cần chủ shop bổ sung thông tin.",
  "scheduleKind": "interval", "intervalMinutes": 180,
  "allowWrite": true,
  "allowedTools": ["shopee_shop_info", "shopee_sync_listings", "shopee_listing_candidates", "shopee_suggest_price", "shopee_category_suggest", "shopee_category_attributes", "shopee_create_listing"],
  "maxSteps": 20
}
```

Soát giá — mỗi sáng:

```json
{
  "name": "Shopee AI — soát giá",
  "prompt": "Gian Shopee \"Kengi AI Shop\". Chính sách giá: biên lãi mục tiêu 18%, tối thiểu 8%, đóng gói 3.000đ/đơn, quảng cáo 3%. shopee_sync_listings rồi shopee_review_listings với đúng chính sách đó. Hàng DƯỚI GIÁ SÀN: shopee_update_price lên giaDeXuat. Hàng 14 ngày không bán mà biên > 25%: giảm về giaDeXuat. Tối đa 8 lần đổi giá. Báo cáo từng thay đổi (giá cũ → mới, lý do) và hàng thiếu giá vốn.",
  "scheduleKind": "daily", "atHour": 7, "atMinute": 40,
  "allowWrite": true,
  "allowedTools": ["shopee_sync_listings", "shopee_review_listings", "shopee_suggest_price", "shopee_update_price"],
  "maxSteps": 15
}
```

Kiểm: `npm run check:shopee-ai` (tính giá, thân add_item, chọn vận chuyển, chặn link nội bộ, và chạy thật tool đăng/đổi giá trên prisma + Shopee giả).

**Chưa đo trên gian thật** (31/10/2026): `category_recommend`, `get_attribute_tree`, `media_space.upload_image`, `add_item` viết theo tài liệu Shopee v2 — lần đầu nên chạy `shopee_create_listing` với `chay_thu=true`, rồi đăng thật một mặt hàng với `an_sau_khi_dang=true` để soát trên Seller Center trước khi giao cho tác vụ tự động.

**Lấy API key + cấu hình nối Claude/Cursor:** kengi.vn/fanpage-manager → Trợ lý AI → tab **"Nối AI ngoài (MCP)"** (tạo key, chép config, nút kiểm tra kết nối gọi thẳng `tools/list`).

## Quy ước quan trọng

- **Lỗi nghiệp vụ** (hết tồn, không tìm thấy khách, token FB hết hạn…) trả **trong** `result` dạng `{content, isError: true}`, **không** phải JSON-RPC error — đúng spec MCP. Agent đọc được và tự xử lý.
- **`create_sale`** dùng chung helper với POS: `decrementSellableStock` (race-safe, giữ `Product.stock` ↔ `WarehouseStock`) + `createJournalEntriesForTransaction`, tất cả trong 1 transaction. Mặc định: đơn **có khách** → ghi nợ toàn bộ; khách **lẻ** → thu đủ. Ép mức thu bằng `amount_received`.
- **Nhóm `fanpage_*`** bỏ trống `page_id` được **khi store chỉ có 1 fanpage**; nhiều page mà không nói rõ thì tool báo lỗi kèm danh sách để agent chọn lại. Token page nằm ở server (`FbPage.accessToken`), agent không bao giờ thấy.
- **`profit_report` là ƯỚC TÍNH**: `TransactionItem` không chụp giá vốn lúc bán nên COGS dùng giá vốn **hiện tại** của hàng. Hàng chưa có giá vốn bị **đếm riêng**, không lặng lẽ tính bằng 0 — agent phải đọc `canhBaoThieuGiaVon` ra cho chủ shop. Ngày truyền vào nhóm tài chính hiểu theo **giờ VN**.
- **Lên lịch bài** phải cách hiện tại **≥ 10 phút** (quy định Facebook). Chuỗi giờ **không kèm múi giờ được hiểu là giờ Việt Nam (+07:00)**, không phải giờ máy chủ — Cloud Run chạy UTC nên nếu không quy ước thì `2026-08-01T09:00:00` sẽ thành 16h giờ VN. Tool trả lại `hendang` (cách hiểu) và `hendangUTC` để agent đọc lại và xác nhận với chủ shop.
- **Hạn token:** `fanpage_list_pages` trả `hanToken` + `tuGiaHanDuoc`. Page nối bằng page token dán tay **không tự gia hạn được** — khi còn ≤ 7 ngày, tool trả thêm `canhBaoChuShop` để agent chủ động nhắc dán token mới.
- **Auto-reply** chỉ chạy khi bật `fanpage_set_auto_reply` **và** có quy tắc đang bật. Có webhook → phản hồi tức thì; chưa có → cron quét lại mỗi 5 phút.
- Trợ lý AI trong dashboard (`/api/mcp-agent`, Gemini) dùng **chung** danh sách tool này — thêm tool ở `TOOLS` là cả hai nơi có ngay.

## Trợ lý AI tự động (chạy theo lịch)

Cùng bộ 40 tool, nhưng **không cần người hỏi**: chủ shop đặt tác vụ bằng tiếng Việt + lịch chạy, cron đánh thức agent làm rồi ghi báo cáo lại.

`POST /api/ai-jobs` — tạo tác vụ:

```json
{
  "name": "Chăm bình luận sáng",
  "prompt": "Xem các bình luận chưa trả lời trên fanpage. Ai hỏi giá hoặc còn hàng thì tra sản phẩm rồi trả lời lịch sự, kèm giá. Ai chê thì đừng trả lời, ghi vào báo cáo.",
  "scheduleKind": "daily", "atHour": 8, "atMinute": 0,
  "allowWrite": true,
  "allowedTools": ["fanpage_list_comments", "fanpage_reply_comment", "search_products"],
  "maxSteps": 10
}
```

| Endpoint | Việc |
|---|---|
| `GET /api/ai-jobs` | danh sách tác vụ + lần chạy gần nhất |
| `GET /api/ai-jobs/tools` | bảng chọn tool (kèm cờ `ghiDuLieu`, `nhayCam`) |
| `POST /api/ai-jobs` · `PATCH /:id` · `DELETE /:id` | quản lý tác vụ |
| `POST /api/ai-jobs/:id/run` | chạy thử ngay, không đợi lịch |
| `GET /api/ai-jobs/:id/runs` | nhật ký: báo cáo, từng tool đã gọi, lỗi |

**An toàn** — agent chạy khi không ai ngồi xem, nên mặc định bị bó chặt:
- Không bật `allowWrite` → **0 tool ghi**, chỉ đọc.
- Tool đẩy ra ngoài hoặc động vào tiền/kho (`create_sale`, `record_debt_payment`, `fanpage_create_post`, `fanpage_reply_comment`, `fanpage_hide_comment`, `fanpage_manage_scheduled_post`) phải được gọi **đích danh** trong `allowedTools`. Bật `allowWrite` chung chung là **chưa đủ** — một job "quét bình luận" hiểu sai chỉ thị cũng không thể tự lên đơn.
- Trần số bước mỗi lượt; mọi tool đã gọi + báo cáo đều lưu vào `AiAgentRun`.

`atHour`/`atMinute` là **giờ Việt Nam**. Cron quét mỗi 5 phút, chỉ chạm store có tác vụ (cờ `Store.hasAiJobs`).

## Kiểm chứng nhanh

```bash
curl -s https://api.kengi.vn/api/mcp -H "x-admin-key: <admin key>" -H "x-store-code: KENGISTORE" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Không gửi header → phải trả **401**. Gửi đúng → `tools/list` trả đủ 40 tool.
