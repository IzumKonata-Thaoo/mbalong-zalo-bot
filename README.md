# MbaLong — Zalo Group AI trên Ubuntu

Bot Zalo cá nhân bằng Node.js/TypeScript, chỉ trả lời trong group được admin cho phép và chỉ khi tài khoản bot được mention bằng đúng Zalo UID. Tin nhắn riêng bị loại bỏ trước khi đi vào AI.

> `zca-js` là API Zalo cá nhân không chính thức. Hãy dùng tài khoản bot riêng, không spam và chỉ vận hành trong các nhóm bạn được phép quản lý.

## Tính năng

- QR đăng nhập Zalo hiển thị trong terminal, session lưu tại `data/`.
- Web admin quản lý allowlist group, thành viên và audit log.
- Mời/xóa member; không cho xóa tài khoản bot, admin cấu hình hoặc admin thật của group.
- Nhập **API key, Base URL và Model trực tiếp trên web admin**.
- API key được mã hóa AES-256-GCM trong SQLite và không bao giờ được trả đầy đủ về frontend.
- Ba định dạng API: OpenAI-compatible, Anthropic native và Gemini native.
- Web research, tóm tắt hội thoại và ngữ cảnh giới hạn.
- Không có menu lệnh cho người dùng Zalo.

## Cài đặt trên Ubuntu

Yêu cầu Ubuntu 22.04/24.04 và Node.js 22 trở lên. Nếu chưa có Node.js:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
```

Trong thư mục dự án:

```bash
bash setup.sh
npm start
```

Script sẽ kiểm tra Node.js/npm/OpenSSL, tạo thư mục dữ liệu riêng tư, sinh mật khẩu admin/JWT secret, cài dependencies và build production.

Quét QR hiển thị trong terminal. Sau đó mở `http://IP_MAY_CHU:8787`.

Nếu truy cập qua domain/reverse proxy, chạy setup lần đầu như sau:

```bash
MBALONG_PUBLIC_ORIGIN=https://bot.example.com bash setup.sh
```

Hoặc sửa `PUBLIC_ORIGIN` trong `.env` rồi khởi động lại.

## Cấu hình AI trên web

Vào **Cấu hình → AI Provider** và nhập:

- **Định dạng API:** OpenAI-compatible, Anthropic native hoặc Gemini native.
- **Base URL:** ví dụ `https://api.openai.com/v1` hoặc `https://openrouter.ai/api/v1`.
- **Model:** tên model chính xác do provider cung cấp.
- **API key:** chỉ cần nhập lại khi muốn thay khóa.
- **System prompt:** phong cách và hành vi riêng của MbaLong.

Nhấn **Lưu & kiểm tra kết nối**. Cấu hình có hiệu lực ngay, không cần restart bot.

HTTP được chấp nhận cho localhost, IP LAN riêng và dải IP Tailscale `100.64.0.0/10`. Endpoint Internet công khai phải dùng HTTPS.

API key được mã hóa bằng `JWT_SECRET`. Không thay `JWT_SECRET` sau khi đã lưu key; nếu thay, hãy nhập lại API key trên web.

## Ollama local

```text
Base URL: http://127.0.0.1:11434/v1
Model: llama3.2
API key: ollama
```

## Web research

Search API vẫn là cấu hình hạ tầng trong `.env`:

```env
SEARCH_API_URL=https://api.tavily.com/search
SEARCH_API_KEY=tvly-...
```

Khởi động lại bot sau khi sửa Search API.

## Thêm group và lấy Zalo ID

1. Đăng nhập web admin.
2. Vào **Nhóm & thành viên**.
3. Nhập Group ID hoặc gửi một tin trong group để bot tự nhận diện.
4. Bật “Cho phép bot”.
5. Nhấn “Làm mới” để đồng bộ member và xem Zalo ID thật.

Khai báo admin hệ thống trong `.env`:

```env
ZALO_ADMIN_IDS=123456789,987654321
```

Trong group, thành viên chỉ cần tag tài khoản bot và đặt câu hỏi. Câu “@MbaLong hãy tóm tắt…” kích hoạt tóm tắt hội thoại.

Xoá ngữ cảnh (bộ nhớ hội thoại và bản tóm tắt của nhóm) để bot bắt đầu lại từ đầu; chỉ trưởng nhóm, phó nhóm hoặc `ZALO_ADMIN_IDS`:

```text
@MbaLong /xoacontext
@MbaLong /reset
@MbaLong /xóa ngữ cảnh
```

## Trò chơi tài xỉu

Số tiền cược và số dư được lưu chính xác theo Zalo UID bằng chuỗi số nguyên trong SQLite; bot dùng `BigInt` nên không giới hạn bởi kiểu số JavaScript và không dùng đơn vị tiền tệ. Người chơi phải có đủ số dư trước khi cược. Thắng được cộng đúng một lần mức cược, thua hoặc ra bộ ba bị trừ mức cược.
Các mức từ một triệu trở lên được hiển thị rút gọn, ví dụ `1 triệu`, `1,5 triệu`, `2 tỷ`.

```text
@MbaLong /sodu
@MbaLong /tx tài 1000
@MbaLong /tx xỉu 500
```

## Long/Short trên thị trường ảo

Long/Short dùng chung số dư với tài xỉu. Mỗi nhóm có một đường giá XAUUSDT mô phỏng được tạo trước và giữ nhất quán trong phiên 5 giờ; phía lệnh của người chơi không làm thay đổi thị trường. Người chơi chọn khung chốt mô phỏng từ 5 giây đến 5 phút, hoặc bỏ trống để dùng 5–7 giây ngẫu nhiên. Đây là thời gian chạy bên trong phiên để lấy giá chốt và tính PnL; bot vẫn trả kết quả ngoài Zalo sau khoảng 5–7 giây. Khung dài hơn có biên độ tiềm năng lớn hơn. Lỗ tối đa bằng tiền vào lệnh. Đây chỉ là trò chơi bằng điểm ảo, không phải dữ liệu hay giao dịch tài chính thật.

```text
@MbaLong /market
@MbaLong /trade
@MbaLong /long 10000 10x 30s
@MbaLong /short 5000 20x 2m
@MbaLong /bxh
```

Đòn bẩy nhận mọi số nguyên dương (`1x`, `100x`, `999999x` hoặc lớn hơn) và được tính bằng `BigInt`, không đặt mức tối đa. Lỗ vẫn bị giới hạn tối đa bằng tiền vào lệnh; lãi không đặt trần. `/market` gửi ảnh biểu đồ PNG 1280×720 trực tiếp lên Zalo.

Khi một vị thế thua, biên độ bất lợi được tăng theo khung mô phỏng để mức lỗ rõ hơn; khung càng dài thì biến động thua càng mạnh. Mức lỗ cuối cùng vẫn không vượt quá tiền vào lệnh.

Tham số cuối là khung thời gian mô phỏng, nhận giây (`30s`) hoặc phút (`2m`), trong khoảng 5 giây đến 5 phút. Dù chọn `5m`, kết quả vẫn được trả sau 5–7 giây thực tế. Không nhập thì cả khung mô phỏng lẫn thời gian trả kết quả dùng 5–7 giây ngẫu nhiên. Nếu wallet của người chơi về 0 trong lúc bot đang xử lý lệnh, bot tự đóng vị thế ngay và thông báo trong nhóm; vị thế đó không tính thắng/thua hay nổ hũ.

`/bxh` (hoặc `/top`) xếp hạng tổng tiền thắng từ tài xỉu và Long/Short. Tiền admin nạp/trừ không được tính. Dữ liệu bắt đầu tích lũy từ khi cài bản có bảng xếp hạng. Admin chỉnh tỉ lệ thắng riêng cho hai trò tại **Cấu hình → Tỉ lệ thắng trò chơi**; thay đổi có hiệu lực ngay với các ván mới.

Cả hai trò dùng chung tính năng nổ hũ. Admin cấu hình số tiền hũ và tỉ lệ nổ trong cùng trang. Hũ chỉ được quay sau khi người chơi đã thắng: nếu nổ, bot trả số tiền hũ đã đặt; nếu số tiền hũ thấp hơn tiền thắng bình thường, tiền thưởng được nâng thành gấp đôi tiền thắng bình thường. Mặc định là `1%` và `1 triệu`; đặt tỉ lệ `0%` để tắt.

Zalo UID có trong `ZALO_ADMIN_IDS` hoặc admin thật của group được cộng/trừ số dư. Không tag thêm ai thì lệnh áp dụng cho chính admin; muốn chỉnh thành viên khác, tag người đó hoặc nhập Zalo ID:

```text
@MbaLong /nap 10000
@MbaLong @NgườiDùng /nap 10000
@MbaLong /nap 123456789 10000
@MbaLong @NgườiDùng /tru 5000
```

### Tìm và phát nhạc

Tìm nhạc SoundCloud và tìm kiếm web là hai lệnh riêng:

```text
@MbaLong /music Nơi này có anh      ← tìm trên SoundCloud (/nhac, /sc cũng được)
@MbaLong /chon 2                    ← phát bài số 2 trong danh sách
@MbaLong /search giá vàng hôm nay   ← tìm web rồi AI trả lời kèm nguồn (/web, /timkiem)
```

Bot trả tối đa 6 kết quả. Trong 10 phút, bất kỳ ai trong nhóm cũng có thể `/chon` từ danh sách mới nhất, và chọn nhiều bài liên tiếp. Câu tự nhiên chỉ được hiểu là tìm nhạc khi có chữ SoundCloud (`tìm bài … trên soundcloud`); các câu khác đi vào AI. Bot dùng extractor SoundCloud công khai của `yt-dlp`, không cần tài khoản SoundCloud, Artist Pro, cookie, Client ID hoặc Client Secret. Bot chỉ xử lý track công khai và cắt tối đa 60 giây để gửi qua tin nhắn thoại Zalo; nếu nguồn chỉ cung cấp preview 30 giây thì bot không thể kéo dài thêm. Track private, DRM, giới hạn vùng hoặc yêu cầu đăng nhập sẽ bị bỏ qua hoặc báo không phát được.

Đặt đường dẫn công cụ trong `.env` (thường không cần sửa):

```env
YTDLP_PATH=yt-dlp
FFMPEG_PATH=ffmpeg
```

Ubuntu cần `ffmpeg` và bản `yt-dlp` mới. Cài bản phát hành chính thức:

```bash
sudo apt update && sudo apt install -y ffmpeg curl
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version
```

Đây là tích hợp không chính thức và phụ thuộc giao diện công khai của SoundCloud, nên cần cập nhật `yt-dlp` nếu SoundCloud thay đổi hệ thống.

Tin nhắn được phân thành ba luồng độc lập: trò chơi, nhạc và AI. Mỗi người dùng vẫn được xử lý FIFO trong từng luồng để lệnh `tìm nhạc` luôn đứng trước `chọn`, nhưng người khác trong cùng nhóm không còn phải đợi một lượt tải nhạc hoàn tất. Tìm kiếm chỉ lấy metadata; luồng audio được phân giải sau khi chọn và cache ngắn hạn. Tối đa bốn đoạn nhạc có thể được chuyển đổi đồng thời.

Bot đọc được ảnh JPEG, PNG, WEBP và GIF trong nhóm. Thành viên gửi ảnh kèm caption có tag `@MbaLong`, hoặc trả lời một ảnh rồi tag bot, để mô tả ảnh, hỏi đáp hoặc giải bài; model được chọn trong trang admin phải hỗ trợ vision/multimodal.

### DeepSeek

DeepSeek dùng định dạng `OpenAI-compatible`. Trong web admin, bấm **Điền nhanh DeepSeek** để đặt Base URL `https://api.deepseek.com`, model `deepseek-flash` và định dạng phù hợp. Dán API key vào ô bí mật rồi bấm **Lưu & kiểm tra kết nối**. Có thể đổi model nếu tài khoản DeepSeek cung cấp model khác; `deepseek-flash` hỗ trợ cả văn bản lẫn ảnh.

```text
@MbaLong /tx
@MbaLong /tx tài 1000
@MbaLong /tx xỉu 500
```

Ba xúc xắc giống nhau là bộ ba và nhà cái thắng. Các lượt của cùng một người được giữ đúng thứ tự trong từng luồng; nhiều thành viên trong nhóm vẫn được xử lý độc lập.

## Cập nhật VPS chạy bằng screen

Bot đang chạy ở `~/zl` trong screen `zl`: một lệnh tải bản mới, sao lưu rồi giữ nguyên `.env` và `data/` (session Zalo, database, ví), build lại và chạy lại trong screen.

```bash
curl -fsSL https://raw.githubusercontent.com/IzumKonata-Thaoo/mbalong-zalo-bot/main/deploy/update-vps.sh | bash
```

Thư mục hoặc tên screen khác: `... | BOT_DIR=~/bot SCREEN_NAME=bot bash`.

Quyền `/nap` và `/tru` được kiểm tra trực tiếp với Zalo (trưởng nhóm, phó nhóm qua `getGroupInfo` và link nhóm) hoặc `ZALO_ADMIN_IDS`, không phụ thuộc danh sách thành viên đã đồng bộ đủ hay chưa. Log `[members]` và `[admin]` trong screen cho biết từng nguồn trả về bao nhiêu ID.

## Chạy nền bằng systemd

Đăng nhập QR bằng `npm start` thủ công ít nhất một lần. Sau khi session đã lưu:

```bash
sudo mkdir -p /opt/nova-zalo
sudo cp -a . /opt/nova-zalo/
sudo chown -R ubuntu:ubuntu /opt/nova-zalo
sudo cp deploy/nova-zalo.service.example /etc/systemd/system/nova-zalo.service
sudo systemctl daemon-reload
sudo systemctl enable --now nova-zalo
sudo systemctl status nova-zalo
```

Nếu user hoặc đường dẫn khác, sửa `User`, `Group`, `WorkingDirectory` và `ReadWritePaths` trong unit file trước khi bật service.

Xem log:

```bash
journalctl -u nova-zalo -f
```

## Reverse proxy Nginx tối thiểu

```nginx
server {
    listen 443 ssl http2;
    server_name bot.example.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Đặt `PUBLIC_ORIGIN=https://bot.example.com` và chỉ mở cổng 443 ra Internet.

## Kiểm tra

```bash
npm run typecheck
npm test
npm run build
npm run security
```

Lưu ý: chỉ một Zalo Web listener được chạy cho một tài khoản tại một thời điểm. Mở Zalo Web cùng tài khoản có thể làm listener bot bị ngắt.
