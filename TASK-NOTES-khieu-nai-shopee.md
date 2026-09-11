# Nộp bằng chứng khiếu nại Shopee (ảnh + ghi chú) — 11/09/2026

## Mục tiêu
Chủ shop chốt phạm vi: **"đúng rồi ảnh thôi với ghi chú"** — nộp bằng chứng cho vụ
trả hàng Shopee ngay trong app, không phải sang seller center.

## Đã chốt
- Chỉ làm **ảnh + ghi chú** (`upload_proof`). KHÔNG làm video, KHÔNG tự bấm
  dispute/confirm thay chủ shop.
- Mã lý do khiếu nại phải **hỏi Shopee** (`get_return_dispute_reason`), không gõ cứng
  như bản cũ (`reason || 2`).

## Facts đắt tiền (đừng tìm lại)
- File trung chuyển Tino: `kengi.vn/ai-livestream/shopee-forward-upload.php`
  - Nguồn thật: `scratch/ai-livestream-studio/public/shopee-forward-upload.php`
    (deploy studio làm `rm -rf` rồi giải nén lại ⇒ sửa trên server sẽ bị nuốt).
  - Backup trên server: `shopee-forward-upload.php.bak-truoc-khieu-nai` (bản 08/09).
  - Ping giới hạn: upload 32M, post 32M, exec 200s, mem 256M.
  - Từ 11/09 nhận thêm `file_field` / `file_name` / `file_mime` trong thân JSON;
    **không khai thì y nguyên mặc định cũ** `part_content`/`part.bin`/octet-stream.
  - `file_mime` có danh sách trắng: octet-stream, image/jpeg, image/png.
- BE: `ShopeeService.guiFileMultipart()` (tách từ `taiKhoiMedia`) là chỗ duy nhất
  dựng multipart. `convertReturnImage()` + `uploadReturnProof()` dùng chung nó.
- `v2.returns.*` ký **có token** (`apiUrl()`), khác `v2.media.*` ký PARTNER (`urlCong()`).
- Bộ đo: `POST /admin/nop-bang-chung-thu` — chạy thử = chỉ `convert_image`
  (ảnh lên kho Shopee, chưa gắn vào vụ nào); `apply:true` mới `upload_proof`.
- Ảnh dùng để thử: `https://kengi.vn/logo.png` (PNG 48KB, có thật).

## Đo được trước khi viết (11/09)
- Gian hàng KENGISTORE **gọi được** nhóm khiếu nại:
  `get_return_dispute_reason` → `{}` (vụ đã duyệt), `query_proof` → lỗi nghiệp vụ
  `GENERAL_PARAM_ERROR - dispute proof not exist` — **không phải** lỗi quyền.
- 14 ngày có 5 vụ trả, 2 vụ đang treo: `2609080FMFRT1EM`, `2609100NK6HF2CC`.

## Đã làm
- [x] Sửa + deploy `shopee-forward-upload.php` lên Tino (qua tên tạm rồi mới thay,
      nên đường tải video không đứt phút nào). Nghiệm thu: ping OK; cả đường video
      (không khai `file_field`) lẫn đường ảnh (khai) đều đi tới bước kiểm host.
- [x] BE `deebb8f`: `guiFileMultipart` + `convertReturnImage` + `uploadReturnProof`
      + `POST /admin/nop-bang-chung-thu`. `npx tsc --noEmit` sạch.

## Đang làm / Tiếp theo
- [ ] Chờ CI deploy `deebb8f`, đối chứng `build.sha` ở `/api/health`.
- [ ] Chạy thử `nop-bang-chung-thu` (không apply) để **đo tên khoá** `convert_image`
      trả về — hàm bóc khoá hiện chấp nhận `url|image_url|image.url` và
      `thumbnail|thumbnail_url|image.thumbnail`; lạ hơn thì phải sửa theo số thật.
- [ ] Có cặp url/thumbnail rồi mới tính tới nút trên web.

## Bẫy đã gặp
- Máy không có `php` (cả Windows lẫn WSL) ⇒ không kiểm được cú pháp cục bộ.
  Cách vòng: scp sang **tên tạm**, ping, đạt mới `mv` đè lên file thật.
- `grep -oP` chết vì locale (`-P supports only unibyte and UTF-8 locales`) — dùng
  `sed -n "s/.../\1/p"` thay thế.
- `scp -i /root/deploy_key` phải chạy `wsl -u root`, không thì "Permission denied".
