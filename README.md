# UPS Monitor

> **已下線（2026-10-25），本 repo 封存、不再維護。**
> UPS 的狀態、告警與用電統計改由 homelab 的 nut_exporter → Prometheus／Alertmanager／Grafana 負責；
> 斷電關機一直由主機上的 NUT upsmon 處理，不依賴本服務。

基於 NUT（Network UPS Tools）的現代化 UPS 狀態監控 Web 服務，支援即時儀表板、長期用電趨勢圖表、電費估算，透過 NotifySystem 轉送的通知（LINE 等平台）與瀏覽器推播，以及**門檻觸發的遠端 SSH 動作**（例如電量過低時自動關機）。

---

## 功能概覽

| 功能 | 說明 |
|------|------|
| **即時監控** | 透過 WebSocket 自動更新，無需手動刷新 |
| **狀態儀表板** | 電池電量環形圖、負載、電壓、續航時間等 8 張資訊卡 |
| **用電趨勢圖表** | 功率(W)、電池電量(%)、負載(%) 歷史趨勢，支援 1小時/24小時/7天/30天 |
| **電費估算** | 設定電費單價後自動計算今日/本週/本月用電量與費用 |
| **通知（NotifySystem）** | 市電中斷、電量低、電量嚴重不足、市電恢復、UPS 過載；送到 NotifySystem 後再依設定轉送到 LINE 等平台 |
| **頁面橫幅通知** | 切換電池供電時顯示動態警示橫幅 |
| **瀏覽器推播** | 授權後在後台分頁也能收到系統通知 |
| **遠端 SSH 動作** | 門檻觸發時於指定主機執行 sh 指令（如 `sudo shutdown`），可一個事件對應多個動作 |
| **主機憑證管理** | Web 介面輸入 SSH 帳號／位置／私鑰；**建立後唯讀只能刪除**，私鑰永不回傳顯示 |
| **分頁式設定 Modal** | 監控／通知／遠端主機／觸發動作，大型彈出視窗統一管理 |
| **Hook 網址隔離** | NotifySystem 的 hook 網址只存於環境變數，不進入 Web 介面、API 與日誌 |

---

## 系統需求

- **NUT (Network UPS Tools)** 已安裝並正常運行
- **Podman** 或 **Docker**（建議 Podman，支援 rootless 與 SELinux）
- **curl**（安裝腳本下載 Chart.js 時使用，非必要）
- 網路連線（首次建置下載 Chart.js；之後無需外部網路）

---

## 安裝

### 步驟 1：確認 NUT 正常運作

```bash
upsc <你的UPS名稱>
# 例如：upsc eaton5cs
```

看到 UPS 資料輸出即代表 NUT daemon（`upsd`）已在 localhost:3493 監聽。

### 步驟 2：下載專案

```bash
git clone <repo-url> upsd_client
cd upsd_client
```

### 步驟 3：執行安裝腳本

```bash
chmod +x install.sh
./install.sh
```

安裝腳本會依序詢問：

```
NotifySystem hook 網址（留空可稍後設定）: http://192.168.77.241:8000/hooks/<key>
UPS 名稱 [eaton5cs]: 
Web 介面埠號 [8080]: 
電費單價 元/kWh（0=不顯示費用）[0]: 3.5
```

完成後自動：
1. 寫入 `.env` 設定檔
2. 下載 Chart.js 靜態資源
3. 建置 Docker/Podman 映像
4. 啟動容器
5. 設定 systemd 使用者服務（Podman 環境，開機自動啟動）

### 步驟 4：開啟 Web 介面

```
http://localhost:8080
```

---

## 管理指令

```bash
./install.sh              # 首次安裝 / 重新設定（建 venv + 建 image + 啟動容器）
./install.sh venv         # 單獨建立 / 更新本機 Python 虛擬環境
./install.sh run-local    # 不用容器，直接以本機 venv 執行（含 --reload 熱更新）
./install.sh start        # 啟動容器服務
./install.sh stop         # 停止容器服務
./install.sh restart      # 重啟容器服務
./install.sh update       # 更新 venv 套件 + 重建映像 + 重啟容器
./install.sh status       # 查看容器狀態、venv 狀態與最近日誌
./install.sh logs         # 即時追蹤容器日誌（Ctrl+C 離開）
```

### 本機直接執行（不需 Docker）

```bash
# 建立 venv 並啟動（路徑自動指向本機 config/ 與 static/）
./install.sh run-local
```

適用於開發調試；支援程式碼修改後自動重載（`--reload`）。

---

## 設定說明

### 環境變數（`.env`）

> 這些設定屬於**系統/機密層級**，不會出現在 Web 介面。

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `NOTIFY_HOOK_URL` | _(空)_ | NotifySystem webhook 來源的網址（`http(s)://…/hooks/<key>`），key 等同密碼 |
| `NUT_HOST` | `localhost` | NUT daemon 位址 |
| `NUT_PORT` | `3493` | NUT daemon 埠號 |
| `UPS_NAME` | `eaton5cs` | `upsc -l` 列出的 UPS 名稱 |

修改 `.env` 後執行 `./install.sh update` 套用。

### Web 介面設定（`config/settings.json`）

點擊右上角 ⚙️ 圖示開啟**設定 Modal**，左側分為四個分頁：

| 分頁 | 內容 |
|------|------|
| **監控** | 輪詢間隔（建議 10～60 秒）、電費單價（元/kWh，0 則隱藏費用估算）|
| **通知** | 五種事件的通知訊息、冷卻時間、電量／過載閾值 |
| **遠端主機** | 新增／刪除 SSH 主機憑證（write-once）|
| **觸發動作** | 設定門檻觸發時要執行的遠端 sh 指令 |

「監控／通知／觸發動作」按底部「**儲存設定**」一次寫入 `settings.json`；
「遠端主機」則為即時操作（新增、刪除、測試連線各自立即生效）。

通知訊息內容支援以下變數：

```
{battery_charge}   → 目前電量百分比
{battery_runtime}  → 預估剩餘分鐘數
{ups_load}         → 目前負載百分比
```

---

## 遠端主機與觸發動作

當 UPS 觸發門檻事件（電量過低、過載等）時，除了發送通知，還可在指定主機上透過 SSH 執行 shell 指令——最常見的用途是**市電中斷且電量過低時，自動對下游伺服器下達 `sudo shutdown` 進行安全關機**。

### 新增遠端主機（憑證 write-once）

到設定 Modal 的「**遠端主機**」分頁 → 「＋ 新增主機」，填入：

| 欄位 | 說明 |
|------|------|
| **名稱** | 自訂顯示名稱，例如「NUT 主機」|
| **SSH 帳號** | 登入用帳號，例如 `root` |
| **位置** | 目標主機 IP 或主機名 |
| **連接埠** | SSH 埠（預設 22）|
| **SSH 私鑰** | 貼上 PEM / OpenSSH 格式私鑰 |

> **安全保護機制**：主機**建立後即無法修改，只能刪除後重建**。
> 私鑰會以 `0600` 權限寫入 `config/ssh_keys/<id>.key`，且**永遠不會再被任何 API 回傳或在介面顯示**，只露出公開指紋（fingerprint）供辨識。
> 對應主機的公鑰請自行先佈署到目標主機的 `~/.ssh/authorized_keys`。

新增後可點「**測試**」驗證 SSH 連線是否成功（會在遠端執行 `echo ok`）。

### 設定觸發動作

到「**觸發動作**」分頁 → 「＋ 新增動作」，設定：

| 欄位 | 說明 |
|------|------|
| **觸發條件** | 市電中斷／電池電量低／電池嚴重不足／市電恢復／過載警告 |
| **目標主機** | 從已新增的遠端主機中選擇 |
| **執行指令** | 任意 sh 指令，例如 `sudo shutdown -h +1` |
| **冷卻時間** | 同一動作的最短重複執行間隔（秒）|

> 觸發**門檻沿用「通知」分頁的設定**（例如「電池嚴重不足」即電量 ≤ 15%）。
> 動作需按「儲存設定」後才會生效；儲存後可用每張動作卡上的「**測試執行**」立即驗證指令。

> ⚠️ **請謹慎使用自動 `sudo` 指令**：門檻設太鬆或指令有誤，可能在誤判時關掉主機。建議先用「測試執行」確認指令、把冷卻時間設長一點，並在 NUT 端確保電量讀值穩定。

底層使用 [`asyncssh`](https://pypi.org/project/asyncssh/) 連線（key-only 驗證、不做 host key 驗證、逾時保護），任何連線／執行錯誤都會被捕捉記錄，不會中斷監控輪詢迴圈。

---

## 通知設定（NotifySystem）

通知不再直接呼叫 LINE，而是送到 NotifySystem（自架的通知整合平台）的 webhook 來源，
由 NotifySystem 決定送到哪些平台（LINE、Discord、Telegram…），並負責重試與發送紀錄。
LINE 的 Channel Access Token 和 User ID 改在 NotifySystem 的「通知平台」設定。

### 步驟 1：在 NotifySystem 建立來源

1. 「整合 → 通知平台」確認已有 LINE（或其他）通知平台
2. 「整合 → 來源」新增一個 **webhook** 來源（例如「UPS」），通知對象勾選要送達的平台
3. 複製來源的 `/hooks/<key>` 網址

### 步驟 2：填入 `.env`

```
NOTIFY_HOOK_URL=http://192.168.77.241:8000/hooks/<key>
```

執行 `./install.sh update` 套用。網址裡的 key 等同密碼，不要提交到 git 或貼到公開的地方。

### 步驟 3：測試通知

在 Web 介面設定面板底部點擊「**發送測試通知**」，確認目的平台收到訊息，
並可在 NotifySystem 的「投遞紀錄」看到這一筆。

### 送出的格式

每則通知帶有標題、等級和標籤（`ups` 加上事件名稱），可以在 NotifySystem 用規則依等級或標籤分送：

| 事件 | 標題 | 等級 |
|------|------|------|
| `on_battery` | UPS 改用電池供電 | warning |
| `battery_low` | UPS 電量偏低 | warning |
| `battery_critical` | UPS 電量嚴重不足 | critical |
| `overload` | UPS 過載 | error |
| `power_restored` | UPS 市電恢復 | info |
| 測試 | UPS 測試通知 | info |

---

## 通知事件說明

| 事件 | 觸發條件 | 預設冷卻 |
|------|---------|---------|
| 市電中斷 | UPS 切換至電池供電 | 300 秒 |
| 電池電量低 | 電量 ≤ 30%（可調） | 300 秒 |
| 電池嚴重不足 | 電量 ≤ 15%（可調） | 120 秒 |
| 市電恢復 | 恢復市電供電 | 60 秒 |
| 過載警告 | 負載 ≥ 90%（可調） | 300 秒 |

---

## 架構說明

```
upsd_client/
├── app/
│   ├── main.py          # FastAPI 應用程式、WebSocket、REST API
│   ├── nut_client.py    # NUT 協議客戶端（asyncio TCP）
│   ├── monitor.py       # 背景輪詢、事件偵測、通知與動作觸發
│   ├── notifier.py      # 送通知到 NotifySystem 的 webhook 來源
│   ├── ssh_hosts.py     # 遠端主機憑證存放（write-once，私鑰 0600）
│   ├── actions.py       # 遠端 SSH 指令執行（asyncssh）
│   ├── history.py       # SQLite 時序資料庫（aiosqlite）
│   └── requirements.txt
├── static/
│   ├── index.html       # 單頁儀表板 + 設定 Modal
│   ├── style.css        # 暗色主題樣式
│   ├── app.js           # WebSocket、Chart.js 圖表、瀏覽器通知、設定 Modal
│   └── chart.min.js     # Chart.js（安裝時自動下載）
├── config/              # 容器 Volume（自動建立）
│   ├── settings.json    # 監控／通知／動作設定（Web 介面可編輯）
│   ├── hosts.json       # 遠端主機 metadata（不含私鑰）
│   └── ssh_keys/        # 各主機 SSH 私鑰（0600）
├── data/                # 容器 Volume（自動建立）
│   └── history.db       # SQLite 歷史資料（保留 90 天）
├── Dockerfile
├── docker-compose.yml
├── install.sh           # 安裝與管理腳本
├── .env                 # 機密設定（不進版本控制）
└── .env.example         # 設定範本
```

### 技術堆疊

| 層級 | 技術 |
|------|------|
| 後端 | Python 3.12 · FastAPI · uvicorn · aiosqlite |
| 隔離 | Python venv（本機開發）/ venv in container（Docker）|
| 前端 | Vanilla JS · Chart.js 4 · CSS Grid |
| 資料 | SQLite（透過 aiosqlite 非同步存取） |
| 遠端執行 | asyncssh（非同步 SSH，key-only 驗證） |
| 容器 | Podman / Docker（`network_mode: host`） |
| 協議 | NUT over TCP 3493 · WebSocket · NotifySystem webhook · SSH |

---

## 進階用法

### 手動使用 Podman 啟動

```bash
podman run -d \
  --name ups-monitor \
  --network host \
  --env-file .env \
  -e HISTORY_DB=/data/history.db \
  -v ./config:/config:z \
  -v ./data:/data:z \
  --restart unless-stopped \
  ups-monitor
```

### 使用 docker-compose / podman-compose

```bash
# 複製並填寫 .env
cp .env.example .env
vi .env

# 啟動
podman-compose up -d

# 停止
podman-compose down
```

### 查看歷史資料（SQLite）

```bash
sqlite3 data/history.db "SELECT datetime(ts,'unixepoch','+8 hours'), realpower, battery_charge FROM readings ORDER BY ts DESC LIMIT 20;"
```

---

## 故障排除

### 容器啟動失敗：無法連線 NUT

```
UPS poll failed: [Errno 111] Connect call failed ('localhost', 3493)
```

確認 NUT daemon 正在運行：

```bash
systemctl status nut-server
# 或
upsc eaton5cs
```

由於容器使用 `network_mode: host`，localhost 即為宿主機。若 NUT 僅監聽 `127.0.0.1`（預設），此設定即可正常運作。

### 圖表未顯示

Chart.js 可能未正確下載。在容器內確認：

```bash
podman exec ups-monitor ls -lh /static/chart.min.js
```

若檔案為空，重新建置：

```bash
./install.sh update
```

或在宿主機手動下載後再 update：

```bash
curl -L https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js -o static/chart.min.js
./install.sh update
```

### 瀏覽器通知未出現

1. 點擊右上角鈴鐺圖示手動申請權限
2. 確認瀏覽器網址為 `http://localhost`（非 `http://IP`）或 HTTPS——瀏覽器 Notification API 僅允許安全來源
3. 確認系統通知未被靜音或勿擾模式封鎖

### 通知相關

| 現象 | 原因 | 解決方式 |
|---------|------|---------|
| `NOTIFY_HOOK_URL 尚未設定` | `.env` 缺少 hook 網址 | 填寫後執行 `./install.sh update` |
| 發送失敗，日誌為 `NotifySystem unreachable` | 連不到 NotifySystem | 確認 NotifySystem 有在跑、網址和埠號正確、防火牆有開 |
| 發送失敗，日誌為 `HTTP 404` | hook key 錯誤，或來源被刪除／重新產生網址 | 到 NotifySystem 重新複製網址 |
| 測試成功但平台收不到 | NotifySystem 那邊沒送出 | 看 NotifySystem 的「投遞紀錄」，確認來源的通知對象和平台設定 |

### SELinux 權限錯誤（config 目錄）

```
PermissionError: [Errno 13] Permission denied: '/config/settings.json'
```

確認 volume 掛載帶有 `:z` 標籤（`install.sh` 已自動處理）：

```bash
podman inspect ups-monitor | grep -A3 Mounts
# 應看到 "Destination": "/config" 搭配 selinux: "z"
```

---

## 資料保留與隱私

- 歷史資料儲存於 `data/history.db`，自動清除 90 天以前的記錄
- 所有資料留存於本機，不傳送至任何第三方（通知只送到你自己的 NotifySystem）
- NotifySystem 的 hook 網址只在容器環境變數中，不寫入資料庫或日誌（httpx 的請求日誌也已關閉）
- SSH 私鑰以 `0600` 權限存於 `config/ssh_keys/`，永不透過 API 回傳——但仍會持久化於 `config/` Volume，請妥善保護該目錄（建議搭配專用、最小權限的 SSH 金鑰）

---

## License

MIT
