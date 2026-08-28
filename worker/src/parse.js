// 坐标解析: 接受地图链接(苹果地图 / 高德, 含短链), 抠出经纬度+名称。
// 高德为 GCJ-02; 苹果地图在中国大陆同为 GCJ-02。两者都转 WGS84 再喂给 wloc;
// gcj02ToWgs84 内含 out_of_china 判断, 境外坐标原样返回(无操作)。

export function safeDecode(s) {
  if (!s) return "";
  try {
    return decodeURIComponent(String(s).replace(/\+/g, " "));
  } catch (e) {
    return String(s);
  }
}

// 从一段字符串里提取经纬度+名称。兼容:
//  苹果地图 coordinate=/ll=/sll=纬度,经度  (名称在 name=...)
//  高德 ?p=POIID,纬度,经度,名称,城市  (逗号或 %2C)
//  高德 ?q=纬度,经度,名称           (新版分享链, 逗号或 %2C)
//  纯文本 纬度,经度
//  高德 URI ?lnglat=/?position=经度,纬度  (与上面几条顺序相反)
// opts.allowBare=false 时不启用"两个裸小数"兜底。扫描页面正文必须关掉它:
// 正文里任何一对小数都会命中(百度页面的 "view_dir":"-0.8477,0.0000" 就是如此),
// 结果是静默返回一个错误坐标 —— 比解析失败危险得多。
export function extractFromString(s, opts) {
  const hit = extractRaw(s, opts);
  // 值域是最后一道闸。上面的兜底规则不带语义, 匹配到什么就返回什么, 经纬颠倒
  // (lat=113.9)或纯粹的垃圾数字都能一路走到调用方。这里拦掉的是"解析成了错的",
  // 它比"解析失败"危险得多 —— 后者会提示用户, 前者会把设备定位挪到别处。
  return hit && inRange(hit.lat, hit.lon) ? hit : null;
}

// 纬度绝对值 <= 90, 经度 <= 180; NaN / Infinity 一并挡掉。
export function inRange(lat, lon) {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  );
}

function extractRaw(s, opts) {
  if (!s) return null;
  const allowBare = !opts || opts.allowBare !== false;
  const str = String(s);
  let m;
  // 前缀 (?:^|[?&]) 是必需的: 无锚定时 "ll=" 会匹配任何以 ll 结尾的参数名,
  // 例如 scroll=1.5,2.5 / pull=... 都会被当成坐标。
  m = str.match(/(?:^|[?&])(?:coordinate|ll|sll)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
  if (m) return { lat: +m[1], lon: +m[2], name: queryName(str), src: "apple" };
  // Google: !3d<lat>!4d<lon> 是地点针脚的真实坐标, 必须优先于 @lat,lon —— 后者是
  // 相机视口中心, 与缩放级别绑定, 可以离目标十几公里。
  m = str.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (m) return { lat: +m[1], lon: +m[2], name: googleName(str), src: "google" };
  m = str.match(
    /[?&]p=[^,&%]*(?:,|%2C)(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i
  );
  if (m) return { lat: +m[1], lon: +m[2], name: m[3] ? safeDecode(m[3]) : "", src: "amap" };
  m = str.match(
    /[?&]q=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i
  );
  if (m) return { lat: +m[1], lon: +m[2], name: m[3] ? safeDecode(m[3]) : "", src: "amap" };
  // 高德 URI API 的 lnglat= / position= 是「经度,纬度」序, 与上面所有规则相反。
  // 不要照搬旧页面里的 location=/center= 规则: 那条也按 lon,lat 解, 但百度的
  // location= 实际是 lat,lng, 搬过来会把百度链接解颠倒。宁可少认一种也不要认错。
  m = str.match(/(?:^|[?&])(?:lnglat|position)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
  if (m) return { lat: +m[2], lon: +m[1], name: queryName(str), src: "amap" };
  // 百度网页版把 BD09MC 米制坐标写进路径: /poi/名称/@12709535.375,2529761.45,19z
  // 位数(6~9)本身就把它和经纬度形式的 @ 区分开了。
  // 这是港澳台百度链接在服务端唯一能拿到坐标的形式 —— 那些地区的分享短链展开后
  // 正文里没有坐标, 得由页面脚本带反爬令牌去查 detailConInfo, Worker 复现不了。
  m = str.match(/baidu\.com\/[^\s]*?@(-?\d{6,9}(?:\.\d+)?)(?:,|%2C)(-?\d{6,9}(?:\.\d+)?)/i);
  if (m) {
    const bd = bd09mcToBd09(+m[1], +m[2]);
    if (bd) return { lat: bd.lat, lon: bd.lon, name: baiduPathName(str), src: "baidu" };
  }
  // 只有在没有针脚坐标时才退而求其次用视口中心。
  m = str.match(/\/maps\/[^\s]*@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: +m[1], lon: +m[2], name: googleName(str), src: "google" };
  if (allowBare) {
    m = str.match(/(-?\d{1,3}\.\d{4,})\s*(?:,|%2C)\s*(-?\d{1,3}\.\d{4,})/);
    if (m) return { lat: +m[1], lon: +m[2], name: "", src: "text" };
  }
  return null;
}

// 查询串里的 ?name=/ &name= —— 苹果地图和高德 URI 都用这个键。
function queryName(str) {
  const m = str.match(/[?&]name=([^&]+)/i);
  return m ? safeDecode(m[1]) : "";
}

// 百度网页版的地名在路径里: /poi/Apple台北101/@...
function baiduPathName(str) {
  const m = str.match(/\/poi\/([^/@?]+)/);
  return m ? safeDecode(m[1]).trim() : "";
}

// Google 的地名在路径里: /maps/place/Apple+Park/@...
function googleName(str) {
  const m = str.match(/\/maps\/place\/([^/@?]+)/);
  return m ? safeDecode(m[1]).replace(/\+/g, " ").trim() : "";
}

// /api/parse 会去 fetch 调用方给的任意 URL。Workers 出网到不了内网, 所以经典的
// SSRF(打内网/元数据服务)基本不成立, 剩下的风险是资源耗尽 —— 一个永不结束的响应
// 能把子请求挂死, 一个几百 MB 的响应能把 128 MB 的 Worker 内存打爆。下面两个常量
// 和 isFetchable() 挡的就是这个, 而不是"防止访问某些站点"。
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 512 * 1024;

function isFetchable(u) {
  let url;
  try {
    url = new URL(u);
  } catch (e) {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const h = url.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[")) return false; // IP 字面量
  return true;
}

// 只读前 MAX_BODY_BYTES, 读满就掐掉连接。坐标总在页面靠前的位置, 读全文没有收益。
async function readCapped(resp) {
  if (!resp.body || typeof resp.body.getReader !== "function") {
    return (await resp.text()).slice(0, MAX_BODY_BYTES);
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  try {
    await reader.cancel();
  } catch (e) {}
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

function isBaiduHost(u) {
  try {
    return /(^|\.)baidu\.com$/i.test(new URL(u).hostname);
  } catch (e) {
    return false;
  }
}

// 接受原文(可能含中文地名+链接), 抠出 URL, 必要时跟随重定向展开短链, 提取坐标。
export async function parseCoords(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("空输入");

  const urlMatch = text.match(/https?:\/\/[^\s'"<>]+/i);
  let target = urlMatch ? urlMatch[0] : text;

  let hit = extractFromString(target);
  if (hit) return hit;

  if (urlMatch) {
    let cur = target;
    for (let i = 0; i < 5; i++) {
      if (!isFetchable(cur)) break;
      let resp;
      try {
        resp = await fetch(cur, {
          redirect: "manual",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {
            "user-agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/24A5370h Safari/604.1",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "zh-CN,zh-Hans;q=0.9",
          },
        });
      } catch (e) {
        break;
      }
      const loc = resp.headers.get("location");
      if (loc) {
        hit = extractFromString(loc);
        if (hit) return hit;
        cur = new URL(loc, cur).toString();
        hit = extractFromString(cur);
        if (hit) return hit;
        continue;
      }
      hit = extractFromString(resp.url);
      if (hit) return hit;
      try {
        const body = await readCapped(resp);
        hit = extractFromString(body, { allowBare: false });
        if (hit) return hit;
        // 百度分享链展开后 URL 里只有 uid, 坐标以 BD09MC 墨卡托米制藏在正文中。
        if (isBaiduHost(cur)) {
          hit = extractBaiduFromBody(body);
          if (hit) return hit;
        }
      } catch (e) {}
      break;
    }
  }
  // 百度对大陆 POI 会把坐标直出在移动版页面里, 港澳台的则不会 —— 那边要靠页面
  // 脚本带 auth/seckey 反爬令牌去查 detailConInfo, 服务端无法复现。与其只说一句
  // "解析不了", 不如告诉用户那条确实走得通的路。
  if (urlMatch && isBaiduHost(target)) {
    throw new Error(
      "百度这条链接的坐标要靠网页脚本才能取到(港澳台的 POI 多为此类)。" +
        "请在浏览器打开该链接, 等地址栏变成 map.baidu.com/poi/名称/@数字,数字,19z 之后, 复制整条地址再粘贴。"
    );
  }
  throw new Error("未能从链接中解析出经纬度");
}

export function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

// ---- 百度: BD09MC(墨卡托米制) -> BD09(经纬度) ----
// 百度用的不是标准 Web 墨卡托, 而是按纬度分 6 段的高次多项式拟合。
// 用标准墨卡托逆算会差约 10 公里, 必须用下面这张系数表。
const MCBAND = [12890594.86, 8362377.87, 5591021, 3481989.83, 1678043.12, 0];
const MC2LL = [
  [1.410526172116255e-8, 8.98305509648872e-6, -1.9939833816331, 200.9824383106796, -187.2403703815547, 91.6087516669843, -23.38765649603339, 2.57121317296198, -0.03801003308653, 1.73379812e7],
  [-7.435856389565537e-9, 8.983055097726239e-6, -0.78625201886289, 96.32687599759846, -1.85204757529826, -59.36935905485877, 47.40033549296737, -16.50741931063887, 2.28786674699375, 1.026014486e7[...]
