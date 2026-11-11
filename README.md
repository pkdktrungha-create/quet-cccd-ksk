# Quét CCCD – giấy khám sức khỏe lái xe

Kho này chứa bản vá giao diện (`p.js`) mà phần mềm tải về mỗi lần mở, mã nguồn giao diện (`web/`) và mã nguồn ScanBridge (`scanbridge/`).

Kho chỉ chứa mã chương trình, không chứa dữ liệu bệnh nhân.

## Cách hoạt động

Phần mềm đã cài (v1.1.4 trở lên) nạp `p.js` từ `https://cdn.jsdelivr.net/gh/pkdktrungha-create/quet-cccd-ksk@main/p.js` mỗi lần mở. Sửa `p.js` rồi đẩy lên nhánh `main` là phần mềm nhận bản mới ở lần mở sau; bộ nhớ đệm của jsDelivr có thể giữ bản cũ tới 12 giờ nếu không xóa (purge).
