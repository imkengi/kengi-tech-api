/**
 * DỌN VIDEO ĐÓNG HÀNG QUÁ 45 NGÀY — chạy TRONG tài khoản Google của chủ shop.
 *
 * Vì sao phải là Apps Script: file trong My Drive chỉ CHỦ SỞ HỮU xoá được.
 * Service account của backend dù được share Editor vẫn bị Google chặn
 * ("insufficient permissions") — đã đo thực tế 04/08/2026, 300/300 lỗi.
 * Script này chạy dưới danh nghĩa chính chủ nên xoá được hết.
 *
 * CÀI ĐẶT (một lần, ~2 phút):
 *  1. Mở https://script.google.com → New project → xoá code mẫu, dán file này
 *  2. Sửa FOLDER_ID bên dưới thành ID thư mục video (đoạn sau /folders/ trên URL)
 *  3. Bấm ▶ Run một lần → cấp quyền khi được hỏi (script chỉ đụng Drive của bạn)
 *  4. Trái màn hình → Triggers (đồng hồ) → Add Trigger →
 *     chọn hàm donVideoCu · Time-driven · Day timer · 2am-3am → Save
 *
 * AN TOÀN: chỉ CHO VÀO THÙNG RÁC (setTrashed) — 30 ngày sau Drive mới xoá thật,
 * trong thời gian đó khôi phục được. Mỗi lượt chạy tối đa ~4.5 phút (giới hạn
 * Apps Script 6'); tồn nhiều thì các đêm sau dọn tiếp.
 */

var FOLDER_ID = 'DAN_FOLDER_ID_VAO_DAY';
var SO_NGAY_GIU = 45;
var GIOI_HAN_MS = 4.5 * 60 * 1000; // dừng trước trần 6 phút của Apps Script

function donVideoCu() {
  var batDau = Date.now();
  var moc = new Date(Date.now() - SO_NGAY_GIU * 24 * 60 * 60 * 1000);
  var goc = DriveApp.getFolderById(FOLDER_ID);
  var daXoa = 0, daXem = 0;

  var hangDoi = [goc];
  while (hangDoi.length > 0) {
    if (Date.now() - batDau > GIOI_HAN_MS) break;
    var thuMuc = hangDoi.shift();

    // Xếp subfolder vào hàng đợi (DON/, HOAN/, thư mục theo ngày...)
    var subs = thuMuc.getFolders();
    while (subs.hasNext()) hangDoi.push(subs.next());

    var files = thuMuc.getFiles();
    while (files.hasNext()) {
      if (Date.now() - batDau > GIOI_HAN_MS) break;
      var f = files.next();
      daXem++;
      // Chỉ đụng file VIDEO — thư mục có thể chứa ghi chú/ảnh khác
      var mime = String(f.getMimeType() || '');
      if (mime.indexOf('video/') !== 0) continue;
      if (f.getDateCreated() < moc) {
        f.setTrashed(true);
        daXoa++;
      }
    }
  }

  Logger.log('Đã xem ' + daXem + ' file, cho vào thùng rác ' + daXoa +
    ' video quá ' + SO_NGAY_GIU + ' ngày' +
    (Date.now() - batDau > GIOI_HAN_MS ? ' (hết giờ lượt này — đêm sau dọn tiếp)' : ''));
}
