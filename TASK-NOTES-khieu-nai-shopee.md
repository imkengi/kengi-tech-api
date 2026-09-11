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

- [x] `deebb8f` lên prod. Chạy thử `nop-bang-chung-thu` (không apply) trên vụ
      `2609080FMFRT1EM`: ảnh 48KB lên được, Shopee trả **đúng hai khoá `url` và
      `thumbnail`** (host `fileproxy.scsusercontent.com`).
- [x] BE `8398a64`: `GET/POST /online-orders/returns/:id/bang-chung` (có auth,
      dùng cho web). Nạp từng ảnh, ảnh nào hỏng báo riêng; nghiệm thu bằng
      `query_proof` sau khi nộp; ghi `auditLog upload_return_proof`.
- [x] FE `4f4055b`: `BangChungKhieuNaiModal` + nút trong tab Trả hàng (chỉ vụ
      Shopee có `returnSn`). Ảnh tự thu về 1600px/JPEG 0.82 ở trình duyệt.
      `npx tsc --noEmit` = **157 lỗi, đúng baseline, 0 lỗi mới**.
      Đã deploy; đối chứng gói thật trên prod: chuỗi `bang-chung` có trong
      `/_next/static/chunks/1042-8c6d433b4d305768.js` (1/39 chunk).
- [x] BE `ecd591f` + đo: **358 phiếu trả Shopee, 0 phiếu thiếu `channelId`**
      ⇒ nút bấm được ở tất cả, không phiếu nào rơi vào nhánh báo lỗi.

## Vòng 2 (11/09 chiều) — chủ shop: "bằng chứng mỗi lí do mỗi kiểu mà"
- Đọc tài liệu Shopee bằng trình duyệt trong app (WebFetch bị chặn domain
  open.shopee.com): `get_return_dispute_reason` trả `evidence_module_list` theo từng
  lý do; `dispute` nhận `image_list[{module_index, requirement, image_url≤3}]`.
- **Luồng dispute cũ chết 07/05/2024** (announcement 883). Code cũ gửi
  `dispute_reason || 2` + `image`; web chưa từng gửi `disputeEmail` ⇒ nút Từ chối vụ
  Shopee luôn 400.
- Đo 4 vụ thật (bộ đo phải sửa: `findFirst` bốc nhầm gian Kengi Electric): 5 lý
  do/vụ, 0–2 ô/lý do, mã lý do khác nhau giữa các vụ, cả 4 `NOT_NEEDED`.
- BE `67c41cb`: `khieuNaiVuTra` (luồng mới, so lỗi đã trim), GET `/bang-chung` đủ
  lý do+ô+hạn+khách kêu gì, POST `/anh-khieu-nai`, POST `/khieu-nai`, process
  reject Shopee → 400 rõ, upload_proof chặn NOT_NEEDED.
- FE `1512e3b`: `KhieuNaiModal` + nút Khiếu nại thay Từ chối (vụ Shopee). 157 lỗi
  = baseline. Deploy xong, chunk trang `page-aa9d165ca1fc8c44.js` có mã mới.
- **Chưa gửi khiếu nại thật lần nào** — không có tham số chạy thử được tài liệu hoá.

## Đang làm / Tiếp theo
- [ ] **Chưa nộp thật lần nào.** Nộp bằng chứng là thao tác ra ngoài, người mua và
      Shopee nhìn thấy, gỡ không được ⇒ chủ shop tự bấm. Vụ đang treo để thử:
      `2609080FMFRT1EM`, `2609100NK6HF2CC`.
- [ ] Chưa xem được giao diện chạy thật (phải đăng nhập bằng tài khoản chủ shop —
      không tự đăng nhập). Mới đối chứng tới mức gói JS trên prod có mã mới.
- [ ] Mã lý do khiếu nại vẫn gõ cứng `reason || 2` ở `disputeReturn`. Đã có
      `getReturnDisputeReasons` và GET `/bang-chung` trả kèm `lyDoHopLe`, nhưng
      **chưa nối vào nút Từ chối** — làm sau nếu chủ shop cần.
- [ ] TikTok: chưa có đường nộp bằng chứng, nút tự ẩn.

## Bẫy đã gặp
- Máy không có `php` (cả Windows lẫn WSL) ⇒ không kiểm được cú pháp cục bộ.
  Cách vòng: scp sang **tên tạm**, ping, đạt mới `mv` đè lên file thật.
- `grep -oP` chết vì locale (`-P supports only unibyte and UTF-8 locales`) — dùng
  `sed -n "s/.../\1/p"` thay thế.
- `scp -i /root/deploy_key` phải chạy `wsl -u root`, không thì "Permission denied".
