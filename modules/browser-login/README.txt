shoptaikhoan auto tool - Import 9router Tool v2.2
==============================================

Yeu cau truoc khi chay:
- Windows 10/11 64-bit.
- May phai co cai san Python 3.11 tro len (64-bit).
- Luc cai PHAI tick: Add python.exe to PATH.
- Da cai va dang nhap 9router tren may.

Tinh nang:
- Auto Login OAuth Codex hang loat, chay song song nhieu tai khoan.
- Tu nhap so luong ngay tren giao dien (mac dinh 3, khong gioi han cung).
- Callback OAuth dung localhost:1455 va tu phan luong theo state, tranh lan ket qua giua cac nick.
- Ho tro email|password|2FA (Tich hop 2fa.live chuan NTP quoc te + fallback pyotp).
- Tu dong convert dinh dang paste tu file/tab/comma/space.
- Moi tai khoan chay browser rieng, sach session.
- Realtime logs, tien do va danh sach nick dang chay tren giao dien.
- Luu lich su dang nhap ChatGPT Web qua cac lan khoi dong (chi email, ket qua va thoi gian; khong luu password/2FA/session).
- Tu xu ly man hinh "Choose a workspace" bang Personal account va hien ro buoc dang bi ket tren realtime log.
- Link moi workspace ChatGPT co `wId`: sau khi tab phu tai xong, doc session va accounts/check trong dung browser, doi chieu email va ID workspace dich. Chi xac minh khi backend tra account dich khong bi vo hieu hoa; khong dung chu Personal account lam bang chung da tham gia. Trang thai workspace dang dung lay rieng tu header ChatGPT-Account-Id cua request main tab, co the la "chua xac minh". Khong tu bam chap nhan loi moi, merge du lieu, chuyen workspace hay luu token/response. Neu backend thay doi shape/tu choi truy cap, hien canh bao va giu browser. Bat reload de thu lai khi chua co quyen truy cap; luong link thuong/khong link va Codex van giu nguyen.
- Workspace chi duoc xac minh khi `account.is_deactivated` la boolean false; co bao deactivated o account/record thi dung retry va canh bao. Flag thieu/sai kieu/mau thuan khong duoc coi la active. Ket qua chi phan anh thoi diem kiem tra, khong bao dam OpenAI khong deactive workspace ve sau.
- Tai khoan loi se tu dong dua ve hang doi va mo lai bang browser sach cho den khi thanh cong; delay tang dan toi da 30 giay. Bam "Huy phien hien tai" de dung.
- Cac cua so Chrome duoc sap xep theo luong hien co. Moi account retry giu nguyen vi tri cua so; login van dung viewport desktop. Mobile chi ap dung sau login neu duoc bat trong hop xac nhan truoc khi chay.
- Tren macOS nhieu man hinh, tool chi dung kich thuoc man hinh chinh thay vi gop tat ca man hinh. Mot account dung gan tron man hinh chinh nhung chua khoang trong ro rang cho menu bar va Dock; hai account xep tren/duoi; ba account luon xep thanh ba hang full-width nhu layout tham chieu.
- Moi ket qua thanh cong co nut "Mo tab" de dua dung cua so ChatGPT len truoc. Nut "Sap xep lai tab" ap lai cac vi tri worker de giu chieu cao de doc, ke ca khi co nhieu browser dang duoc giu mo.
- Co nut Tam dung/Tiep tuc va Huy phien luon theo dung trang thai. Log, tien do, retry va ket qua phien hien tai duoc luu an toan xuong dia de khoi phuc sau khi reload/khoi dong lai server; khong luu password, 2FA hay link tab phu.
- Khi server chap nhan mot phien moi, bang "Ket qua phien hien tai" duoc xoa sach va chi nhan ket qua dung `runId` moi; lich su tai khoan dai han van duoc giu rieng.
- Import refresh token vao 9router va kiem chung SQLite sau khi ghi.
- Co tab rieng dang nhap truc tiep ChatGPT web; khong dung Codex OAuth va khong import token.
- ChatGPT Web cho chon Brave, Chrome, Edge, Chromium da cai tren may (macOS/Windows/Linux); Brave duoc chon lan dau neu co, lua chon duoc nho tren giao dien. Moi tai khoan dung cua so an danh va context khong persistent rieng, khong dung profile ca nhan; tab phu cung context, giu mo sau login. Chon ro trinh duyet thi khong tu fallback neu loi. Che do Tu dong van thu Chrome roi Chromium. OAuth/Codex khong thay doi.
- URL tab phu sau dang nhap co the bat/tat tren giao dien; khi tat, tool bo qua noi dung/kiem tra URL, chi mo ChatGPT va khong tao tab phu.
- Sau khi mo tab phu va reload ChatGPT, tool cho giao dien render roi tim nhan hien thi chinh xac `Personal account` theo noi dung DOM, khong phu thuoc vao class CSS dung chung cua ChatGPT. Ket qua phien, realtime log va lich su hien ro da xac minh hay chua xac minh; chi luu ket qua boolean, khong luu noi dung DOM/session.
- Nhan Personal duoc chuan hoa khoang trang/NBSP va xuong dong, ke ca khi tach qua cac the con. Chi chap nhan chu hien thi: bo qua nhan an, transparent, Business va chu chi chua mot phan `Personal account`; khong luu noi dung DOM.
- Khi bam "Bat dau chay" voi du lieu hop le, hop thoai hoi co bat tu dong reload cho lan chay nay khong. Mac dinh tat voi URL thuong, cho 1-3600 giay (mac dinh 10); Huy/Esc khong khoi chay va giu nguyen danh sach nhap. Khi bat va co tab phu, neu chua thay Personal account: reload tab phu, cho tai xong, quay lai tab chinh, cho theo setting, reload va kiem tra lai; lap khong gioi han so vong den khi thay Personal. Dung khi bam Dung, dong tab/Chrome hoac loi tai trang; khong dang nhap lai hay tao them tab. Xac minh xong giu nguyen tab cho nguoi dung; khong ap dung cho Codex OAuth.
- Cung hop xac nhan co "Che do mobile (DevTools)", mac dinh BAT moi lan; co the tat rieng, khong phu thuoc reload. Sau login va truoc khi tao tab phu, tool mo DevTools that cua dung tab chinh qua Target.openDevTools, cho nut Device Toolbar san sang roi click va xac nhan da bat. Khong gui phim tat toan he thong (tranh tranh focus/crash Brave khi chay nhieu cua so); goi lai khong tat mobile da bat. CDP chi dung de mo/dieu khien giao dien DevTools, khong tu ep viewport bang Emulation.setDeviceMetricsOverride, khong doi cookie, kich thuoc cua so hay viewport tab phu. Can trinh duyet Chromium/Chrome/Brave moi co Target.openDevTools; neu khong ho tro hoac Device Toolbar that bai, giu phien va canh bao, khong fallback phim tat, khong mo tab phu hay tu login lai. Chi ap dung ChatGPT Web; Codex/OAuth, 2FA va Chat Backup khong doi. API POST /api/web-login/start nhan mobileEnabled boolean; UI gui true mac dinh, client cu thieu field van giu desktop (false); kieu sai tra 400 truoc khi chay. Worker CLI dung --mobile de bat; khong co flag van giu desktop. Khong luu lua chon nay vao lich su/session.
- Test hoi quy DevTools that (noi dung gia, khong login): BROWSER_MOBILE_TEST=1 python -m unittest discover -s . -p test_web_mobile.py -v. Chay 3 cua so dong thoi tren Brave/Chrome da cai va Chromium dong goi; kiem tra mobile tab chinh, tab phu desktop, reload va bat lai khong dao trang thai.
- Neu "URL mo sau dang nhap" dang BAT va URL la https://chatgpt.com/k12-invite (chap nhan dau / cuoi va query), hop xac nhan tu bat reload 10 giay + mobile. Van cho phep tat/chinh truoc khi bam chay; Huy/Esc khong chay. Khong ap dung cho URL thuong, domain gia, port khac 443, URL co username/password hay khi tat mo tab phu. Chi doi mac dinh tren UI, khong thay doi API/CLI hay tu chap nhan loi moi.

Cach chay (tu setup tu dong):
1. Giai nen file ZIP vao mot thu muc rieng.
2. Double-click: khoi_dong_o_day.bat.
3. Lan dau file bat tu dong:
   - Kiem tra Python va pip.
   - Cai/cap nhat pyotp + playwright.
   - Tai Chromium cho Playwright.
   - Khoi dong server tool.
4. Trinh duyet se tu mo tai: http://localhost:9876
5. Vao tab Auto Login, dan danh sach nick va nhap so luong muon chay.
6. Vao tab "ChatGPT Web", dan tai khoan, nhap link muon mo o tab phu (mac dinh `https://chatgpt.com/api/auth/session`) va bam "Login vao ChatGPT Web". Bam "Dong Chrome" de dong cac cua so do tool mo.

Neu bao khong tim thay Python:
- Cai Python 3.11 64-bit tro len, sau do dong va mo lai khoi_dong_o_day.bat.

Luu y:
- Can internet khi cai lan dau va trong luc dang nhap OAuth.
- Nhieu luong hon se ton RAM/CPU va co the gap captcha/xac minh nhieu hon.
- Khong nen xoa auto_login.py, server.py hoac index.html trong thu muc da giai nen.
- Khong can cai thu cong neu khoi_dong_o_day.bat chay thanh cong.

Cai dat tren macOS (Apple Silicon):
1. Mo thu muc `dist` va double-click `shoptaikhoan auto tool-macOS-arm64.dmg`.
2. Keo `shoptaikhoan auto tool` vao thu muc Applications.
3. Mo app; giao dien se tu mo tai http://localhost:9876.
4. App chay tren thanh menu voi bieu tuong ST. Tai day co the mo lai giao dien, huy cac phien Chrome hoac thoat app.
5. Neu macOS canh bao ung dung chua notarize, right-click app -> Open trong lan dau, hoac chon Open Anyway tai System Settings -> Privacy & Security.

Du lieu runtime va log macOS duoc luu tai:
`~/Library/Application Support/shoptaikhoan-auto-tool/`

Chay nhanh tren macOS tu thu muc source:
- Double-click `khoi_dong_tool.command`.
- File luon chay truc tiep `python3 server.py`, khong mo ban `.app`; neu thieu thu vien, file se tu cai dat o lan chay dau.
- Neu tool dang chay, file chi mo lai http://localhost:9876 de tranh trung cong.

Build lai ban macOS:
`./build_macos.sh`
