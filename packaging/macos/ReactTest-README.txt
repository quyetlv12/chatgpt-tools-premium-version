SHOPTAIKHOAN REACT TEST — macOS Apple Silicon

Cài đặt
1. Giải nén Shoptaikhoan-React-Test-macOS-arm64.zip.
2. Kéo Shoptaikhoan React Test.app vào Applications.
3. Mở app có icon cam và chữ TEST. App hiện trên Dock và thanh menu.
   Giao diện mở bằng Brave Browser với profile riêng của tool.
   Bấm icon app trên Dock để mở lại giao diện.
4. Để thoát, chọn “Thoát Shoptaikhoan React Test” ở biểu tượng trên thanh menu.

Yêu cầu: máy Mac Apple Silicon (M1 trở lên), macOS 15.0 trở lên.
Máy cần cài Brave Browser để mở giao diện.
Đã kèm Python, Node và Chromium; không cần cài môi trường phát triển.
App được ký cục bộ, chưa notarize bằng Apple Developer ID. Nếu macOS chặn,
vào System Settings > Privacy & Security và chọn Open Anyway cho app này.

Tách biệt với bản cũ
- Tên: Shoptaikhoan React Test.
- Bundle ID: com.shoptaikhoan.suite.react-test.
- Giao diện và backend: http://127.0.0.1:5250/.
- Không dùng các cổng 5050, 5150, 5151 hay 5173 của bản khác.
- Dữ liệu mới, socket và log nằm trong:
  ~/Library/Application Support/Shoptaikhoan React Test/
- Keychain dùng service riêng. App không sao chép dữ liệu tài khoản bản cũ.
- Profile Brave được lưu bền tại thư mục Brave Profile bên trong thư mục dữ liệu
  trên, tách khỏi profile Brave cá nhân; các lần mở tool dùng lại profile này.
- Nếu cổng 5250 đang được ứng dụng khác sử dụng, app báo lỗi thay vì dừng ứng dụng đó.

Lưu ý khi dùng đồng thời
Luồng Browser OAuth dùng callback đã đăng ký http://localhost:1455.
Tránh chạy đồng thời luồng đăng nhập dùng callback 1455 ở hai bản app.
Kho Passkey của macOS/iCloud vẫn là kho chung của hệ điều hành.

Phạm vi kiểm tra
Đã kiểm tra khởi động bốn backend, mở năm màn hình React, tài nguyên/font,
Node/Chromium đi kèm, mở trùng cổng, thoát app và chữ ký gói cài đặt.
Bản build này không thực hiện đổi 2FA hay thao tác trên tài khoản thật để kiểm tra đóng gói.
