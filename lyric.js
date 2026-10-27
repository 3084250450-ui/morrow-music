/**
 * 歌词引擎 —— 给 Morrow 听歌页用的那一段
 *
 * 做的事就三件：
 *   1. 把网易云的 lrc 拆成 {t: 毫秒, s: 这一句}
 *   2. 按当前播放秒数，算出该亮哪一行
 *   3. 告诉页面该把哪一行推到中间
 *
 * 为什么单独拎出来：这段逻辑跟 UI 无关，换到别的播放器里也能直接用。
 */

/* ========== 一、解析 ========== */

/**
 * lrc 一行长这样： [00:25.237]这一路上走走停停
 * 也有一行带多个时间戳的： [00:10.00][01:22.50]副歌歌词
 * 还有 [offset:500] 这种元信息 —— 我们直接跳过不带文字的。
 *
 * 返回按时间升序排好的数组。
 */
function lyrParse(txt) {
  if (!txt) return [];
  const out = [];
  const rows = String(txt).split('\n');
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  for (const row of rows) {
    let m;
    re.lastIndex = 0;
    const times = [];

    // 一行里可能挂着好几个时间戳，每个都要收
    while ((m = re.exec(row)) !== null) {
      const mm = parseInt(m[1], 10) || 0;
      const ss = parseInt(m[2], 10) || 0;
      let frac = m[3] ? parseInt(m[3], 10) : 0;

      // 毫秒可能是 2 位也可能是 3 位，要按位数补
      if (m[3]) {
        const len = String(m[3]).length;
        if (len === 1) frac = frac * 100;
        else if (len === 2) frac = frac * 10;
      }
      times.push(mm * 60000 + ss * 1000 + frac);
    }

    if (!times.length) continue;

    // 把方括号全剪掉，剩下的才是歌词本身
    const text = row.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;

    for (const t of times) out.push({ t, s: text });
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}

/* ========== 二、算当前是哪一句 ========== */

/**
 * @param {Array} lines  lyrParse 的结果
 * @param {number} curSec 当前播放到第几秒（audio.currentTime）
 * @returns {number} 应该高亮的行号，还没唱到第一句时返回 -1
 *
 * 加 120ms 的提前量：歌词标记的时刻通常比人嘴稍晚，
 * 提前一点切过去，看起来才"跟着唱"而不是"慢半拍"。
 */
function lyrIndexOf(lines, curSec) {
  if (!lines || !lines.length) return -1;
  const ms = curSec * 1000 + 120;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= ms) idx = i;
    else break;
  }
  return idx;
}

/* ========== 三、给 DOM 用 ========== */

/**
 * 一次把 DOM 更新干净：谁亮、谁暗、谁已经唱过去了。
 *
 * @param {HTMLElement} scrollEl 歌词滚动容器（里面一行一个 .lyr-line）
 * @param {HTMLElement} boxEl    外框（用来量高度，好让当前句居中）
 * @param {number} idx           当前行号
 */
function lyrApply(scrollEl, boxEl, idx) {
  if (!scrollEl) return;

  const all = scrollEl.children;
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (!el || !el.classList) continue;
    el.classList.toggle('on', i === idx);
    el.classList.toggle('past', i < idx);
  }

  if (!boxEl) return;
  const aim = idx < 0 ? 0 : idx;
  const line = all[aim];
  if (!line) return;

  // 让这一行的垂直中心，对上外框的垂直中心
  const offset = line.offsetTop + line.offsetHeight / 2 - boxEl.clientHeight / 2;
  scrollEl.style.transform = 'translateY(' + (-offset) + 'px)';
}

/* ========== 四、取歌词 ========== */

/**
 * 走我们自己的服务拿词，不直连网易云（那边要 Referer，浏览器会拦）。
 *
 * @param {string} baseUrl 例如 ''（同源）或 'http://1.14.63.100:8010/music'
 * @param {number} songId
 * @returns {Promise<Array>} 解析好的行；拿不到就是空数组，不抛错
 */
async function lyrFetch(baseUrl, songId) {
  try {
    const r = await fetch(baseUrl + '/api/lyric?id=' + encodeURIComponent(songId));
    const j = await r.json();
    const raw = j && j.lrc && j.lrc.lyric ? j.lrc.lyric : '';
    return lyrParse(raw);
  } catch (e) {
    return [];
  }
}

/* 给浏览器直接用 */
if (typeof window !== 'undefined') {
  window.LYR = { lyrParse, lyrIndexOf, lyrApply, lyrFetch };
}

/* 给 Node 里测试用 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lyrParse, lyrIndexOf, lyrApply, lyrFetch };
}
