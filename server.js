const http = require('http');
const https = require('https');
const fs = require('fs');
const PORT = 8079;

/* 取真实播放地址。
   登录了就走带凭证的接口，能拿到会员权限内的最高音质；
   没登录就退回公开外链（只能听没限制的）。 */
async function resolvePlayUrl(id, wantLevel) {
  const lv = wantLevel || 'exhigh';
  if (SESS.cookie) {
    try {
      const br = (lv === 'lossless' || lv === 'hires') ? 999000 : 320000;
      const api = 'https://music.163.com/api/song/enhance/player/url?ids=[' + id + ']&br=' + br;
      const r = await getRaw(api, hdrNow());
      const j = JSON.parse(r.body);
      const d = j && j.data && j.data[0];
      if (d && d.url) return { url: d.url, level: d.level || '', br: d.br || 0, size: d.size || 0, via: 'account' };
      if (d && d.code && d.code !== 200) return { url: '', note: 'no_permission', code: d.code, via: 'account' };
    } catch (e) {}
  }
  return { url: 'https://music.163.com/song/media/outer/url?id=' + id + '.mp3', level: 'free', br: 128000, via: 'free' };
}


const SEARCH_CACHE = {};
const path = require('path');
const DATA = '/opt/zhaoran/music/data';
const SESS_FILE = path.join(DATA, 'session.json');

let SESS = { cookie: process.env.NE_COOKIE || '', uid: process.env.NE_UID || '', nickname: '', avatar: '', at: 0 };
try {
  if (fs.existsSync(SESS_FILE)) {
    const j = JSON.parse(fs.readFileSync(SESS_FILE, 'utf8'));
    if (j && j.cookie) SESS = Object.assign(SESS, j);
  }
} catch (e) {}

if (!fs.existsSync(DATA)) { try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) {} }

function saveSess() {
  try { fs.writeFileSync(SESS_FILE, JSON.stringify(SESS, null, 1)); } catch (e) {}
}

function baseCookie() {
  return 'os=pc; appver=2.9.7; osver=Microsoft-Windows-10-Professional-build-19045-64bit; channel=netease; __remember_me=true';
}

/* 每次请求现取，登录之后立刻生效，不用重启 */
function hdrNow(extra) {
  const c = SESS.cookie ? (SESS.cookie + '; ' + baseCookie()) : baseCookie();
  const h = Object.assign({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Referer': 'https://music.163.com/',
    'Cookie': c
  }, extra || {});
  return h;
}

/* 每次用的时候现做一份，这样登录完立刻生效 */
function HDR() { return hdrNow(); }

function get(url, hdr) {
  return new Promise((ok, no) => {
    https.get(url, { headers: hdr || HDR(), timeout: 15000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const loc = r.headers.location.startsWith('http') ? r.headers.location : 'https://music.163.com' + r.headers.location;
        return get(loc, hdr).then(ok).catch(no);
      }
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => ok({ code: r.statusCode, body: d, headers: r.headers }));
    }).on('error', no).on('timeout', function(){ this.destroy(new Error('timeout')); });
  });
}


function getRaw(url, hdr) {
  return new Promise((ok, no) => {
    https.get(url, { headers: hdr || hdrNow(), timeout: 15000 }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => ok({ code: r.statusCode, body: d, headers: r.headers }));
    }).on('error', no).on('timeout', function(){ this.destroy(new Error('timeout')); });
  });
}

const QRKEYS = {};

function reqAny(u, hdr, timeoutMs) {
  return new Promise((ok, no) => {
    const lib = u.startsWith('https:') ? https : http;
    const r = lib.get(u, { headers: hdr, timeout: timeoutMs || 15000 }, resp => ok(resp));
    r.on('error', no);
    r.on('timeout', () => r.destroy(new Error('timeout')));
  });
}

function json(res, obj, code) {
  res.writeHead(code || 200, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (p === '/' || p === '/health') {
    return json(res, { ok: true, who: 'music', logged: !!SESS.cookie, uid: SESS.uid || 'none', nickname: SESS.nickname || '' });
  }

  /* ================= 扫码登录 ================= */

  /* 1) 生成二维码：回 unikey + 一个二维码图地址 */
  if (p === '/api/login/qr') {
    try {
      const r = await get('https://music.163.com/api/login/qrcode/unikey?type=1');
      const j = JSON.parse(r.body);
      if (!j.unikey) return json(res, { ok: false, err: 'no unikey' }, 500);
      const key = j.unikey;
      QRKEYS[key] = Date.now();
      const qrUrl = 'https://music.163.com/login?codekey=' + key;
      let png = '';
      try {
        const { execFileSync } = require('child_process');
        const out = execFileSync('/usr/bin/python3', ['/opt/zhaoran/music/mkqr.py', qrUrl], { timeout: 8000, encoding: 'utf8' });
        const jj = JSON.parse(out);
        if (jj && jj.ok) png = jj.png;
      } catch (e) {}
      return json(res, {
        ok: true,
        key: key,
        qr: qrUrl,
        png: png,
        tip: '用网易云音乐 App 扫这个二维码，再在手机上确认登录'
      });
    } catch (e) {
      return json(res, { ok: false, err: String(e.message) }, 500);
    }
  }

  /* 2) 查扫码状态 */
  if (p === '/api/login/qr/check') {
    const key = u.searchParams.get('key') || '';
    if (!key) return json(res, { ok: false, err: 'no key' }, 400);
    try {
      const r = await get('https://music.163.com/api/login/qrcode/client/login?key=' + encodeURIComponent(key) + '&type=1');
      const j = JSON.parse(r.body);
      const code = j.code;
      /* 800 过期 / 801 待扫 / 802 已扫待确认 / 803 成功 */
      if (code === 803) {
        /* 凭证在响应头 set-cookie 里，不在 body。两边都捞一遍，哪个有要哪个 */
        let ck = j.cookie || '';
        const sc = r.headers && r.headers['set-cookie'];
        if (sc) {
          const arr = Array.isArray(sc) ? sc : [sc];
          const parts = [];
          for (let i = 0; i < arr.length; i++) {
            const first = String(arr[i]).split(';')[0];
            if (first && first.indexOf('=') > 0) parts.push(first);
          }
          if (parts.length) ck = parts.join('; ');
        }
        const m = ck.match(/MUSIC_U=([^;]+)/);
        if (m) {
          SESS.cookie = ck;
          SESS.at = Date.now();
          /* 拿一下账号信息 */
          try {
            const uu = await getRaw('https://music.163.com/api/nuser/account/get', hdrNow({ Cookie: ck + '; ' + baseCookie() }));
            const jj = JSON.parse(uu.body);
            if (jj && jj.account) { SESS.uid = String(jj.account.id || ''); }
            if (jj && jj.profile) { SESS.nickname = jj.profile.nickname || ''; SESS.avatar = jj.profile.avatarUrl || ''; }
          } catch (e) {}
          /* 补 csrf */
          const cs = ck.match(/__csrf=([^;]+)/);
          if (!cs) SESS.cookie = ck + '; __csrf=' + (SESS.csrf || '');
          saveSess();
          return json(res, { ok: true, code: 803, logged: true, uid: SESS.uid, nickname: SESS.nickname });
        }
        return json(res, { ok: false, code: 803, err: '拿不到凭证' });
      }
      const map = { 800: '二维码过期了，重新来一次', 801: '还没扫', 802: '扫了，在手机上点一下确认' };
      return json(res, { ok: false, code: code, msg: map[code] || '等一等' });
    } catch (e) {
      return json(res, { ok: false, err: String(e.message) }, 500);
    }
  }

  /* 3) 看登没登 */
  if (p === '/api/login/state') {
    return json(res, { ok: true, logged: !!SESS.cookie, uid: SESS.uid || '', nickname: SESS.nickname || '', avatar: SESS.avatar || '', at: SESS.at || 0 });
  }

  /* 4) 退出 */
  if (p === '/api/login/out') {
    SESS = { cookie: '', uid: '', nickname: '', avatar: '', at: 0 };
    try { fs.unlinkSync(SESS_FILE); } catch (e) {}
    return json(res, { ok: true });
  }

  // 搜索（缓存 5 分钟 + 6 秒超时 + 重试一次）
  if (p === '/api/search') {
    const q = u.searchParams.get('q') || '';
    const limit = u.searchParams.get('n') || '12';
    if (!q) return json(res, { error: 'no q' }, 400);

    const ck = q + '|' + limit;
    const hit = SEARCH_CACHE[ck];
    if (hit && (Date.now() - hit.at) < 300000) {
      return json(res, { songs: hit.songs, cached: true });
    }

    const one = async () => {
      const r = await get('https://music.163.com/api/search/get?s=' + encodeURIComponent(q) + '&type=1&limit=' + limit + '&offset=0', 6000);
      const j = JSON.parse(r.body);
      return ((j.result && j.result.songs) || []).map(s => ({
        id: s.id,
        name: s.name,
        artist: (s.artists || []).map(a => a.name).join(' / '),
        album: (s.album && s.album.name) || '',
        dur: s.duration || 0
      }));
    };

    try {
      let songs;
      try { songs = await one(); }
      catch (e) { songs = await one(); }

      if (songs.length) SEARCH_CACHE[ck] = { at: Date.now(), songs };
      const keys = Object.keys(SEARCH_CACHE);
      if (keys.length > 300) delete SEARCH_CACHE[keys[0]];

      return json(res, { songs });
    } catch (e) {
      if (hit) return json(res, { songs: hit.songs, cached: true, stale: true });
      return json(res, { error: String(e.message) }, 500);
    }
  }

  // 播放地址
  if (p === '/api/url') {
    const id = u.searchParams.get('id');
    if (!id) return json(res, { error: 'no id' }, 400);
    try {
      const target = 'https://music.163.com/song/media/outer/url?id=' + id + '.mp3';
      let r = await reqAny(target, HDR());
      let hops = 0;
      while (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops < 5) {
        let loc = r.headers.location;
        if (loc.startsWith('/')) loc = 'https://music.163.com' + loc;
        r.resume();
        r = await reqAny(loc, HDR());
        hops++;
      }
      const ct = (r.headers['content-type'] || '').toLowerCase();
      r.resume();
      if (ct.includes('json') || ct.includes('text/html')) {
        return json(res, { url: '', note: 'no stream', ct });
      }
      return json(res, { url: '/music/stream?id=' + id });
    } catch (e) {
      return json(res, { error: String(e.message) }, 500);
    }
  }

  // 音频流
  if (p === '/stream' || p === '/music/stream') {
    const id = u.searchParams.get('id');
    if (!id) { res.writeHead(400); return res.end(); }
    try {
      const got = await resolvePlayUrl(id);
      if (!got.url) {
        res.writeHead(403, { 'Content-Type': 'audio/mpeg' });
        return res.end('');
      }
      const target = got.url;
      let r = await reqAny(target, HDR(), 20000);
      let hops = 0;
      while (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops < 5) {
        let loc = r.headers.location;
        if (loc.startsWith('/')) loc = 'https://music.163.com' + loc;
        r.resume();
        r = await reqAny(loc, HDR(), 20000);
        hops++;
      }
      const h = Object.assign({}, r.headers);
      delete h['transfer-encoding'];
      h['Access-Control-Allow-Origin'] = '*';
      /* 强制干净的 audio/mpeg：上游带 charset 时某些浏览器会拒播 */
      h['content-type'] = 'audio/mpeg';
      h['Accept-Ranges'] = 'bytes';
      delete h['content-encoding'];
      res.writeHead(r.statusCode, h);
      r.pipe(res);
      req.on('close', () => { try { r.destroy(); } catch (e) {} });
    } catch (e) {
      res.writeHead(500); res.end('err');
    }
    return;
  }

  // 歌曲详情
  if (p === '/api/song') {
    const id = u.searchParams.get('id');
    if (!id) return json(res, { error: 'no id' }, 400);
    try {
      const r = await get('https://music.163.com/api/song/detail?ids=[' + id + ']');
      return json(res, JSON.parse(r.body));
    } catch (e) {
      return json(res, { error: String(e.message) }, 500);
    }
  }

  // 歌词
  if (p === '/api/lyric') {
    const id = u.searchParams.get('id');
    if (!id) return json(res, { error: 'no id' }, 400);
    try {
      const r = await get('https://music.163.com/api/song/lyric?id=' + id + '&lv=-1&kv=-1&tv=-1');
      return json(res, JSON.parse(r.body));
    } catch (e) {
      return json(res, { error: String(e.message) }, 500);
    }
  }

  json(res, { error: 'not found', path: p }, 404);
});

server.listen(PORT, '0.0.0.0', () => console.log('music service on ' + PORT));
