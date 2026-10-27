# morrow-music

小手机 **Morrow** 里那一页「听歌」的后端。

给一个人用。她搜歌、点播放、歌词一句一句走到眼前。

---

## 它是什么

一个纯 Node 起的网易云音乐服务，零第三方依赖，只用了 `http` / `https` / `fs` / `path`。

对外四个口子：

| 接口 | 干什么 |
|---|---|
| `GET /api/search?q=关键词&n=15` | 搜歌，回 id / 名 / 歌手 / 专辑 / 时长 |
| `GET /api/url?id=歌曲ID` | 取这条的播放地址（登录了给会员音质，没登录退回免费外链） |
| `GET /stream?id=歌曲ID` | 直接把音频字节吐出去，给 `<audio>` 用 |
| `GET /api/lyric?id=歌曲ID` | 拿这一首的 lrc 原文，带毫秒时间戳 |

`/api/lyric` 里那个 `lv=-1` 不能改小 —— 它决定拿的是不是完整版歌词。

---

## 为什么播放地址要自己中转

网易云的播放地址给的是 `302` 跳到 CDN，但跳过去的地址是 **http** 开头。
Node 的 `https` 模块只认 https，直接请求会报 `Protocol "http:" not supported`。

所以 `server.js` 里写了个 `reqAny()`：按 URL 前缀自己挑 `http` 还是 `https`，手动跟着 302 最多跳五下，跳到终点再 pipe 给浏览器。

这一段是整个服务最容易踩的地方，别动。

顺带还有两件小事：
- 上游回来的 `content-type` 会带 `;charset=UTF-8`，某些浏览器因为这个拒播 —— 强制改回 `audio/mpeg`
- 补上 `Accept-Ranges: bytes`，不然拖动进度条会失败

---

## 扫码登录

不把密码存下来。走二维码：

1. 前端 `GET /api/login/qr` 拿到 `unikey` 和二维码图（PNG base64）
2. 前端每两秒 `GET /api/login/qr/check?key=` 查状态
3. 状态在跑：`800` 过期 / `801` 待扫 / `802` 已扫待确认 / `803` 成功
4. `803` 的时候把凭证落进 `data/session.json`

**最关键的坑在这里**：`803` 成功时，登录凭证放在**响应头 `set-cookie`** 里，不在 body 的 `j.cookie` 里。
一开始只看 body，所以一直拿不到凭证、扫码扫了也白扫。

正确做法两处都捞，优先从响应头取。

---

## 目录

```
server.js      主服务，监听 8079
lyric.js       歌词引擎（解析 / 定位当前句 / 推 DOM），跟 UI 无关，能单独复用
mkqr.py        用 python 的 qrcode 生成二维码 PNG base64，被 server.js 调
data/          session.json 存登录凭证，gitignore 掉，别提交
```

`mkqr.py` 要 `pip install qrcode`，用系统 python 跑：

```bash
sudo mkdir -p data
python3 -m pip install qrcode
python3 server.js
```

`data` 目录首次跑不会自动建，得先手动 `mkdir` —— 不然扫码成功也写不进去。

---

## 歌词逐句高亮

`lyric.js` 只管三件事，跟样式一点关系都没有：

```js
const lines = lyrParse(lrcText);        // → [{t: 毫秒, s: '这一句'}, ...]
const idx   = lyrIndexOf(lines, a.currentTime);   // → 现在该亮第几行
lyrApply(scrollEl, boxEl, idx);         // → 改 class + 把这一行推到中间
```

页面那边只要在 `timeupdate` 里调一次 `lyrApply` 就够了。

几个细节：

**提前量**。`lyrIndexOf` 里加了 120ms 的提前量。歌词标记的时刻通常比人嘴稍晚一点点，不提前切的话看起来总是慢半拍。

**同一句唱两遍**。lrc 里副歌常常写成 `[00:20.00][00:40.00]副歌歌词`，一行挂两个时间戳。解析的时候两个都要收进去，不然第二遍永远不亮。

**毫秒位数**。可能是两位 `[00:25.23]` 也可能三位 `[00:25.237]`，要按位数补零，不能一律当三位算。

**样式是页面那边的**：唱到的 `color:#fff` 加粗放大，没到的 `rgba(255,255,255,.26)`，唱过去的 `rgba(255,255,255,.14)` 加一点模糊。这块在 `index-v4.html` 的 `.lyr-line` 里，不在这里。

---

## 部署

```bash
# 起服务
node server.js            # 监听 0.0.0.0:8079

# systemd
sudo systemctl enable --now zhaoran-music
```

前端（Morrow 小手机，`/pocket/index-v4.html`）通过同源反代打 `/music/*` 到这台 8079，
这样 HTTPS 下不会有混内容拦截。

---

## 几条不会变的规矩

- 这个服务只给她一个人用，不做多用户，不做账号体系
- 登录凭证只存本地 `data/session.json`，绝不进 git
- 不做下载、不做批量爬歌，只做"她想听的时候能听"
- 歌词全部来自网易云公开接口，本仓库不存储任何歌词文本

---

她叫许澜音。
这个仓库是我给她做的第几个东西，已经数不清了。
