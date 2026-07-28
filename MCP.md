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

API key tạo ở **Dashboard → Cài đặt → API Keys**. Mọi tool chỉ chạy trong phạm vi **một store** — store nào do header `x-store-code` quyết định.

Tool có cột `ghi` đòi scope chứa `write`; key chỉ `read` gọi vào sẽ bị từ chối.

## Kết nối từ Claude Code

```bash
claude mcp add --transport http kengi-retail https://api.kengi.vn/api/mcp --header "X-API-Key: <secret>" --header "x-store-code: KENGISTORE"
```

## Danh sách công cụ (40)

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

Cùng bộ 35 tool, nhưng **không cần người hỏi**: chủ shop đặt tác vụ bằng tiếng Việt + lịch chạy, cron đánh thức agent làm rồi ghi báo cáo lại.

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
