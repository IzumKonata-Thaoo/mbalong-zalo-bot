# Garage gà chiến qua Cloudflare Tunnel

Garage dùng chung SQLite với bot Zalo. Mỗi gà có một token quản lý ngẫu nhiên và một PIN số riêng. Token không chứa Zalo ID; cookie đăng nhập là `HttpOnly`, `SameSite=Strict` và tự bật `Secure` khi `PUBLIC_ORIGIN` dùng HTTPS.

## 1. Cấu hình bot chỉ nghe ở localhost

Trong `~/zl/.env`:

```env
PORT=8787
HOST=127.0.0.1
PUBLIC_ORIGIN=https://ga.example.com
```

Thay `ga.example.com` bằng hostname thật của bạn. Không đặt `HOST=0.0.0.0` và không mở cổng `8787` trên firewall/router. Sau khi sửa, build và chạy lại screen:

```bash
cd ~/zl
npm run build
screen -S zl -X quit 2>/dev/null || true
screen -dmS zl bash -lc 'cd ~/zl && npm start 2>&1 | tee -a logs/bot.log'
tail -f ~/zl/logs/bot.log
```

## 2. Cài `cloudflared` trên Ubuntu

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update
sudo apt-get install -y cloudflared
cloudflared --version
```

## 3. Tạo tunnel và hostname ổn định

Bạn cần một domain đang quản lý trên Cloudflare.

1. Mở Cloudflare Dashboard → **Networking → Tunnels** → **Create Tunnel**.
2. Đặt tên, ví dụ `mbalong`, rồi chọn Linux/Ubuntu.
3. Sao chép đúng lệnh `sudo cloudflared service install <TUNNEL_TOKEN>` mà Dashboard tạo và chạy trên VPS.
4. Trong tunnel, chọn **Routes → Add route → Published application**.
5. Hostname: `ga.example.com`; Service URL: `http://localhost:8787`.
6. Lưu route và kiểm tra trạng thái tunnel là `Healthy`.

Kiểm tra service:

```bash
sudo systemctl status cloudflared --no-pager
curl -I http://127.0.0.1:8787
curl -I https://ga.example.com
```

Cloudflare Tunnel tạo kết nối outbound từ VPS tới Cloudflare, nên web không cần cổng inbound công khai. Địa chỉ bot gửi trong `/ga` luôn lấy từ `PUBLIC_ORIGIN`, không tự ghép IP VPS.

## 4. Dùng garage

```text
@MbaLong /ga
```

Mở link trong caption ảnh. Lần đầu đặt PIN chỉ gồm 4–12 chữ số. Những lần sau nhập PIN đó để mở kho. Chọn một dòng để xem gà mang thử móng; chọn **Mua** để trừ số dư và sở hữu, hoặc **Trang bị** nếu đã mua.

Giữ link như một bí mật. Nếu link bị gửi lại cho người khác, PIN vẫn chặn truy cập, nhưng người nhận link trước lúc chủ gà đặt PIN có thể chiếm bước thiết lập đầu tiên; vì vậy chủ gà nên mở và đặt PIN ngay sau khi dùng `/ga` lần đầu.

Tài liệu Cloudflare chính thức: [cài cloudflared trên Ubuntu](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/), [tạo tunnel và published application](https://developers.cloudflare.com/tunnel/get-started/), [chạy tunnel như Linux service](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/as-a-service/linux/).
