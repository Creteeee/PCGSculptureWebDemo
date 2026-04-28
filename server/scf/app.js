/**
 * Tencent Cloud SCF Web function (Express) - /chat + /image
 *
 * Env vars (as per your current setup):
 * - DeepSeekKey
 * - VOLC_ACCESS_KEY_ID
 * - VOLC_ACCESS_KEY_SECRET
 * Optional:
 * - PCG_CHAT_TOKEN  (Bearer token to protect endpoints)
 *
 * NOTE:
 * - /chat is fully implemented.
 * - /image contains an implementation skeleton for Jimeng + veImageX.
 *   You MUST fill in the Volcengine signing + endpoints based on docs/console,
 *   because Volcengine APIs require canonical request signing and product-specific
 *   paths/parameters.
 */

const express = require('express');
const crypto = require('crypto');
const { Buffer } = require('buffer');

const app = express();
app.use(express.json({ limit: '6mb' })); // screenshot dataURL can be large

// CRC32 for veImageX/TOS upload checksum (same as official SDK behavior).
const _crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = _crc32Table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCorsHeaders(headers) {
  const origin = headers?.origin || headers?.Origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST,OPTIONS,GET',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function corsExpress(req, res) {
  const h = buildCorsHeaders(req.headers || {});
  for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

function checkToken(req, res) {
  const required = process.env.PCG_CHAT_TOKEN;
  if (!required) return true;
  const auth = req.headers.authorization || '';
  const got = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!got || got !== required) {
    // support both express res and our plain res
    if (typeof res.status === 'function') return res.status(401).json({ error: 'Unauthorized' });
    res.statusCode = 401;
    res.body = { error: 'Unauthorized' };
    return false;
  }
  return true;
}

function jsonSafeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function deepseekChat({ systemPrompt, messages, apiKey }) {
  // Keep context short to reduce "protocol drift" (model stops obeying JSON-only rule)
  const MAX_TURNS = 16; // messages are already {role, content}
  const sliced = Array.isArray(messages) ? messages.slice(-MAX_TURNS) : [];

  const finalMessages = [];
  if (typeof systemPrompt === 'string' && systemPrompt.trim()) {
    finalMessages.push({ role: 'system', content: systemPrompt.trim() });
  }
  // Reinforce strict machine-readable output even when context grows.
  finalMessages.push({
    role: 'system',
    content:
      '再次强调：你必须且只能输出一个 JSON 对象（不要输出 Markdown/解释/代码块/多段文本）。' +
      '若需要生图，返回 type="render_image" + render_request；若需改参数，返回 type="update_state" + state_patch。',
  });

  // Hard constraints enforced server-side (avoid prompt drift / client tampering)
  finalMessages.push({
    role: 'system',
    content:
      '硬限制：效果图只能是室内展示场景（艺术馆/博物馆/画廊/高级写字楼大堂/室内展厅）。' +
      '若用户要求室外/奇异场景（公园/沙漠/火星/海边/雪山等），必须返回 type="chat" 并说明无法生成此类景观，建议改为室内艺术馆等。' +
      '任何 render_image 的 prompt/negative_prompt 都必须明确禁止地面网格/辅助网格/坐标网格（no ground grid）。' +
      '若用户提到海报/推文/小红书文案/文案/排版/字体等关键词，必须输出 type="render_image" 且 render_request.kind="poster"，并同时输出 poster_prompt(含字号层级) 与 tweet(含标题与 emoji)。',
  });
  for (const m of sliced) finalMessages.push(m);

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: finalMessages,
      // Lower temperature -> better format compliance
      temperature: 0.2,
    }),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`DeepSeek HTTP ${resp.status}: ${text}`);

  const data = jsonSafeParse(text) || {};
  const content = data?.choices?.[0]?.message?.content || '';
  return content;
}

async function handleChat(req, res) {
  if (!checkToken(req, res)) return;

  const deepseekKey = process.env.DeepSeekKey;
  if (!deepseekKey) {
    res.statusCode = 500;
    res.body = { error: 'Missing env DeepSeekKey' };
    return;
  }

  const { messages = [], systemPrompt = null, state = null } = req.body || {};
  if (!Array.isArray(messages)) {
    res.statusCode = 400;
    res.body = { error: '`messages` must be an array' };
    return;
  }

  try {
    const content = await deepseekChat({ systemPrompt, messages, apiKey: deepseekKey });

    // model is instructed to output strict JSON only
    const obj = jsonSafeParse(content);
    if (!obj || typeof obj !== 'object') {
      res.statusCode = 200;
      res.body = { type: 'chat', message: content || '（模型未返回可解析 JSON）' };
      return;
    }

    // Basic sanity filter (never trust model output blindly)
    const type = obj.type;
    if (!['chat', 'update_state', 'render_image'].includes(type)) {
      res.statusCode = 200;
      res.body = { type: 'chat', message: obj.message || '（无有效 type）' };
      return;
    }

    // Post-process: enforce "no ground grid" even if model forgets.
    if (type === 'render_image' && obj?.render_request && typeof obj.render_request === 'object') {
      const rr = obj.render_request;
      if (typeof rr.prompt === 'string' && rr.prompt.trim()) {
        const p = rr.prompt.trim();
        if (!/no\s+ground\s+grid|地面网格|辅助网格|坐标网格/i.test(p)) {
          rr.prompt = `${p}；禁止地面网格/辅助网格/坐标网格（no ground grid）`;
        }
      }
      if (typeof rr.negative_prompt === 'string') {
        const n = rr.negative_prompt;
        if (!/grid|网格/i.test(n)) rr.negative_prompt = `${n}, ground grid, floor grid, grid lines`;
      } else {
        rr.negative_prompt = 'ground grid, floor grid, grid lines, wireframe floor, coordinate grid';
      }
      obj.render_request = rr;
    }

    res.statusCode = 200;
    res.body = obj;
    return;
  } catch (e) {
    res.statusCode = 500;
    res.body = { error: 'chat failed', detail: String(e), stateHint: !!state };
  }
}

/**
 * =========================
 * Volcengine signing helpers (SignerV4)
 * =========================
 * Ported (minimally) from Volcengine SDK SignerV4:
 * - algorithm: HMAC-SHA256
 * - signed headers: Content-Type / Host / X-* (lowercased)
 * - headers: X-Date, X-Content-Sha256, Authorization
 */
function sha256Hex(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg).digest();
}

function utcNowXDate() {
  // YYYYMMDDTHHMMSSZ
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function encodeRfc3986(str) {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function normQuery(query) {
  const entries = Object.entries(query || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [String(k), String(v)]);
  entries.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return entries.map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join('&');
}

function normUri(path) {
  if (!path) return '/';
  // minimal normalization: ensure leading slash
  return path.startsWith('/') ? path : `/${path}`;
}

function buildCanonicalHeadersAndSignedHeaders(headers) {
  const signed = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = String(k);
    if (key === 'Content-Type' || key === 'Content-Md5' || key === 'Host' || key.startsWith('X-')) {
      signed[key.toLowerCase()] = String(v).trim();
    }
  }

  if (signed.host && signed.host.includes(':')) {
    const [h, p] = signed.host.split(':');
    if (p === '80' || p === '443') signed.host = h;
  }

  const keys = Object.keys(signed).sort();
  const canonical = keys.map((k) => `${k}:${signed[k]}\n`).join('');
  const signedHeaders = keys.join(';');
  return { canonical, signedHeaders };
}

function signingKey(sk, date8, region, service) {
  const kDate = hmacSha256(Buffer.from(sk, 'utf8'), date8);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'request');
}

function signVolcRequestV4({ method, host, path, query, headers, body, ak, sk, service, region }) {
  const xDate = utcNowXDate();
  const date8 = xDate.slice(0, 8);
  const finalHeaders = { ...(headers || {}) };
  finalHeaders.Host = host;
  finalHeaders['X-Date'] = xDate;

  const bodyStr = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const bodyHash = sha256Hex(Buffer.from(bodyStr, 'utf8'));
  finalHeaders['X-Content-Sha256'] = bodyHash;

  const { canonical: canonicalHeaders, signedHeaders } = buildCanonicalHeadersAndSignedHeaders(finalHeaders);
  const canonicalRequest = [
    method.toUpperCase(),
    normUri(path || '/'),
    normQuery(query || {}),
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n');

  const hashedCanonicalRequest = sha256Hex(Buffer.from(canonicalRequest, 'utf8'));
  const credentialScope = `${date8}/${region}/${service}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, hashedCanonicalRequest].join('\n');
  const key = signingKey(sk, date8, region, service);
  const signature = crypto.createHmac('sha256', key).update(stringToSign).digest('hex');
  finalHeaders.Authorization = `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers: finalHeaders, bodyStr };
}

async function volcRequestJson({ host, service, region = 'cn-north-1', action, version, method = 'POST', body, ak, sk }) {
  const query = { Action: action, Version: version };
  const path = '/';
  const headers = method === 'GET' ? {} : { 'Content-Type': 'application/json; charset=utf-8' };

  const { headers: signedHeaders, bodyStr } = signVolcRequestV4({
    method,
    host,
    path,
    query,
    headers,
    body,
    ak,
    sk,
    service,
    region,
  });

  const url = `https://${host}${path}?${normQuery(query)}`;
  const resp = await fetch(url, { method, headers: signedHeaders, body: method === 'GET' ? undefined : bodyStr });
  const text = await resp.text();
  const data = jsonSafeParse(text) || { raw: text };
  if (!resp.ok) {
    const code = data?.code ?? data?.status ?? null;
    const requestId = data?.request_id ?? data?.RequestId ?? null;
    const msg = data?.message ?? data?.Message ?? text;
    const e = new Error(`${host} ${action} HTTP ${resp.status}: ${msg}`);
    e._volc = { httpStatus: resp.status, code, requestId, raw: data };
    throw e;
  }
  return data;
}

function randHex(nBytes = 8) {
  return crypto.randomBytes(nBytes).toString('hex');
}

function ymd() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function extFromContentType(ct) {
  const c = (ct || '').toLowerCase();
  if (c.includes('png')) return 'png';
  if (c.includes('webp')) return 'webp';
  if (c.includes('gif')) return 'gif';
  if (c.includes('jpeg') || c.includes('jpg')) return 'jpg';
  return 'bin';
}

async function fetchBinary(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`download failed HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);
  const ct = resp.headers.get('content-type') || '';
  const ab = await resp.arrayBuffer();
  return { buf: Buffer.from(ab), contentType: ct || 'application/octet-stream' };
}

async function imagexApplyImageUpload({ ak, sk, serviceId, storeKey, contentType }) {
  // GET https://imagex.volcengineapi.com/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=...&StoreKeys=...
  // We sign only Action/Version via volcRequestJson; other params are appended here and included in signing.
  const host = 'imagex.volcengineapi.com';
  const method = 'GET';
  const version = '2018-08-01';
  const action = 'ApplyImageUpload';

  const query = {
    Action: action,
    Version: version,
    ServiceId: serviceId,
    UploadNum: '1',
    StoreKeys: storeKey,
    ContentTypes: contentType || 'image/jpeg',
  };

  const path = '/';
  const headers = {};
  const { headers: signedHeaders } = signVolcRequestV4({
    method,
    host,
    path,
    query,
    headers,
    body: '',
    ak,
    sk,
    service: 'imagex',
    region: 'cn-north-1',
  });

  const url = `https://${host}${path}?${normQuery(query)}`;
  const resp = await fetch(url, { method, headers: signedHeaders });
  const text = await resp.text();
  const data = jsonSafeParse(text) || { raw: text };
  if (!resp.ok) throw new Error(`imagex ApplyImageUpload HTTP ${resp.status}: ${text}`);

  const uploadAddress = data?.Result?.UploadAddress || data?.UploadAddress || data?.result?.uploadAddress || null;
  if (!uploadAddress) throw new Error(`ApplyImageUpload missing UploadAddress: ${text}`);
  return uploadAddress;
}

async function imagexPutObject({ uploadHost, storeUri, auth, contentType, buf }) {
  const url = `https://${uploadHost}/${storeUri.replace(/^\/+/, '')}`;
  // veImageX 官方 SDK 在 PUT 时使用 Content-CRC32（8位hex）。
  const crc = crc32(buf);
  const crcHex = crc.toString(16).padStart(8, '0');
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: auth,
      'Content-Type': contentType,
      'Content-CRC32': crcHex,
    },
    body: buf,
  });
  const text = await resp.text().catch(() => '');
  if (!resp.ok) throw new Error(`imagex PUT failed HTTP ${resp.status}: ${text}`);
  return true;
}

async function imagexCommitImageUpload({ ak, sk, serviceId, sessionKey, successOids, skipMeta = true }) {
  const host = 'imagex.volcengineapi.com';
  const action = 'CommitImageUpload';
  const version = '2018-08-01';
  const query = {
    Action: action,
    Version: version,
    ServiceId: serviceId,
    SkipMeta: String(!!skipMeta),
  };

  const body = {
    SessionKey: sessionKey,
    SuccessOids: successOids,
  };

  const { headers: signedHeaders, bodyStr } = signVolcRequestV4({
    method: 'POST',
    host,
    path: '/',
    query,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
    ak,
    sk,
    service: 'imagex',
    region: 'cn-north-1',
  });

  const url = `https://${host}/?${normQuery(query)}`;
  const resp = await fetch(url, { method: 'POST', headers: signedHeaders, body: bodyStr });
  const text = await resp.text();
  const data = jsonSafeParse(text) || { raw: text };
  if (!resp.ok) throw new Error(`imagex CommitImageUpload HTTP ${resp.status}: ${text}`);
  return data;
}

async function imagexGetResourceURL({
  ak,
  sk,
  serviceId,
  domain,
  uri,
  tpl,
  proto = 'https',
  format = 'image',
  timestampSec = 7 * 24 * 3600,
}) {
  // GET https://imagex.volcengineapi.com/?Action=GetResourceURL&Version=2023-05-01&ServiceId=...&Domain=...&URI=...&Tpl=...
  const host = 'imagex.volcengineapi.com';
  const method = 'GET';
  const action = 'GetResourceURL';
  const version = '2023-05-01';
  const query = {
    Action: action,
    Version: version,
    ServiceId: serviceId,
    Domain: domain,
    URI: uri,
    Proto: proto,
    Format: format,
  };
  if (tpl) query.Tpl = tpl;
  if (timestampSec) query.Timestamp = String(timestampSec);

  const { headers: signedHeaders } = signVolcRequestV4({
    method,
    host,
    path: '/',
    query,
    headers: {},
    body: '',
    ak,
    sk,
    service: 'imagex',
    region: 'cn-north-1',
  });

  const url = `https://${host}/?${normQuery(query)}`;
  const resp = await fetch(url, { method, headers: signedHeaders });
  const text = await resp.text();
  const data = jsonSafeParse(text) || { raw: text };
  if (!resp.ok) throw new Error(`imagex GetResourceURL HTTP ${resp.status}: ${text}`);

  const outUrl = data?.Result?.URL || data?.result?.url || data?.URL || null;
  if (!outUrl) throw new Error(`GetResourceURL missing URL: ${text}`);
  return outUrl;
}

async function imagexUploadBufferToService({ ak, sk, serviceId, publicDomain, buf, contentType }) {
  const ext = extFromContentType(contentType);
  const storeKey = `pcg/${ymd()}/${Date.now()}-${randHex(6)}.${ext}`;

  const uploadAddress = await imagexApplyImageUpload({
    ak,
    sk,
    serviceId,
    storeKey,
    contentType,
  });

  const sessionKey = uploadAddress?.SessionKey;
  const uploadHost = Array.isArray(uploadAddress?.UploadHosts) ? uploadAddress.UploadHosts[0] : null;
  const storeInfo = Array.isArray(uploadAddress?.StoreInfos) ? uploadAddress.StoreInfos[0] : null;
  const storeUri = storeInfo?.StoreUri;
  const auth = storeInfo?.Auth;

  if (!sessionKey || !uploadHost || !storeUri || !auth) {
    throw new Error(`ApplyImageUpload missing fields: ${JSON.stringify(uploadAddress)}`);
  }

  await imagexPutObject({ uploadHost, storeUri, auth, contentType, buf });
  await imagexCommitImageUpload({ ak, sk, serviceId, sessionKey, successOids: [storeUri], skipMeta: true });

  // Prefer official URL generation (may include tpl/sign and simplified path)
  const domain = publicDomain || `${serviceId}.veimagex-pub.cn-north-1.volces.com`;
  const finalUrl = `https://${domain}/${storeUri.replace(/^\/+/, '')}`;
  return { url: finalUrl, storeUri, storeKey, domain };
}

async function imagexMigrateFromUrlToService({ ak, sk, serviceId, publicDomain, sourceUrl, tpl }) {
  const { buf, contentType } = await fetchBinary(sourceUrl);
  const stored = await imagexUploadBufferToService({
    ak,
    sk,
    serviceId,
    publicDomain,
    buf,
    contentType,
  });
  const outUrl = await imagexGetResourceURL({
    ak,
    sk,
    serviceId,
    domain: stored.domain || publicDomain,
    uri: stored.storeUri,
    tpl: tpl || undefined,
    proto: 'https',
    format: 'image',
    timestampSec: 7 * 24 * 3600,
  });
  return { url: outUrl, storeUri: stored.storeUri };
}

async function handleMigrate(req, res) {
  if (!checkToken(req, res)) return;

  const AK = process.env.VOLC_ACCESS_KEY_ID;
  const SK = process.env.VOLC_ACCESS_KEY_SECRET;
  if (!AK || !SK) {
    res.statusCode = 500;
    res.body = { error: 'Missing VOLC_ACCESS_KEY_ID/SECRET' };
    return;
  }

  const serviceId = process.env.IMAGEX_SERVICE_ID || '97hsy4j2xz';
  const publicDomain = process.env.IMAGEX_PUBLIC_DOMAIN || '97hsy4j2xz.veimagex-pub.cn-north-1.volces.com';

  const { urls, tpl } = req.body || {};
  if (!Array.isArray(urls) || !urls.length) {
    res.statusCode = 400;
    res.body = { error: 'Missing urls: string[]' };
    return;
  }

  const results = [];
  for (const u of urls.slice(0, 50)) {
    try {
      const r = await imagexMigrateFromUrlToService({
        ak: AK,
        sk: SK,
        serviceId,
        publicDomain,
        sourceUrl: String(u),
        tpl: typeof tpl === 'string' ? tpl : null,
      });
      results.push({ src: String(u), ok: true, ...r });
    } catch (e) {
      results.push({ src: String(u), ok: false, error: String(e) });
    }
  }

  res.statusCode = 200;
  res.body = { total: urls.length, done: results.length, results };
}

function pickFirstImageUrl(resp) {
  // Handle common shapes from Visual APIs
  const urls =
    resp?.data?.image_urls ||
    resp?.data?.image_urls?.[0] ||
    resp?.data?.result?.image_urls ||
    resp?.data?.result?.images ||
    resp?.data?.result?.urls ||
    resp?.Data?.ImageUrls ||
    resp?.Result?.ImageUrls;
  if (Array.isArray(urls) && urls.length) return urls[0];
  if (typeof urls === 'string') return urls;
  // Sometimes: resp.data is array of { url }
  if (Array.isArray(resp?.data) && resp.data[0]?.url) return resp.data[0].url;
  return null;
}

function pickTaskId(resp) {
  return resp?.data?.task_id || resp?.data?.taskId || resp?.Data?.TaskId || resp?.Result?.TaskId || resp?.task_id || null;
}

function stripDataUrlPrefix(s) {
  if (typeof s !== 'string') return '';
  const idx = s.indexOf('base64,');
  if (idx !== -1) return s.slice(idx + 'base64,'.length).trim();
  return s.trim();
}

async function jimengSubmitTask({
  ak,
  sk,
  prompt,
  negative_prompt,
  style,
  strength,
  width,
  height,
  reference_image_base64,
  returnUrl = true,
}) {
  // Visual -> CVProcess (sync/async depending on req_key)
  const body = {
    req_key: 'jimeng_t2i_v40',
    prompt,
    positive_prompt: prompt, //兼容部分接口字段名
    return_url: !!returnUrl,
  };
  if (typeof negative_prompt === 'string' && negative_prompt.trim()) body.negative_prompt = negative_prompt.trim();
  if (typeof style === 'string' && style.trim()) body.style = style.trim();
  if (typeof strength === 'number' && Number.isFinite(strength)) body.strength = Math.max(0, Math.min(1, strength));
  if (Number.isFinite(width)) body.width = width;
  if (Number.isFinite(height)) body.height = height;
  if (typeof reference_image_base64 === 'string' && reference_image_base64.trim()) {
    const pure = stripDataUrlPrefix(reference_image_base64);
    // Visual 接口常用字段：binary_data_base64: [String]
    body.binary_data_base64 = [pure];
  }

  // CVProcess can sporadically return 50500; retry a couple times.
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await volcRequestJson({
        host: 'visual.volcengineapi.com',
        service: 'cv',
        region: 'cn-north-1',
        action: 'CVProcess',
        version: '2022-08-31',
        body,
        ak,
        sk,
      });
      return { resp, taskId: pickTaskId(resp), url: pickFirstImageUrl(resp) };
    } catch (e) {
      lastErr = e;
      const volc = e?._volc;
      const retryable = volc?.httpStatus === 500 && String(volc?.code) === '50500';
      if (!retryable || attempt === 3) break;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }

  throw lastErr || new Error('CVProcess failed');
}

async function jimengPollResult({ ak, sk, taskId, timeoutMs = 60000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await volcRequestJson({
      host: 'visual.volcengineapi.com',
      service: 'cv',
      region: 'cn-north-1',
      action: 'CVGetResult',
      version: '2022-08-31',
      body: { task_id: taskId, req_key: 'jimeng_t2i_v40', return_url: true },
      ak,
      sk,
    });

    const url = pickFirstImageUrl(resp);
    const status = resp?.data?.status || resp?.data?.task_status || resp?.data?.state || resp?.Data?.Status || null;
    if (url) return { url, resp, status: status || 'succeed' };
    if (typeof status === 'string' && ['failed', 'error'].includes(status.toLowerCase())) {
      throw new Error(`jimeng task failed: ${JSON.stringify(resp)}`);
    }
    // backoff
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error(`jimeng poll timeout after ${timeoutMs}ms, taskId=${taskId}`);
}

async function handleImage(req, res) {
  if (!checkToken(req, res)) return;

  const AK = process.env.VOLC_ACCESS_KEY_ID;
  const SK = process.env.VOLC_ACCESS_KEY_SECRET;
  if (!AK || !SK) {
    res.statusCode = 500;
    res.body = { error: 'Missing VOLC_ACCESS_KEY_ID/SECRET' };
    return;
  }

  const body = req.body || {};
  const render_request = body.render_request || body;
  const prompt = render_request?.prompt;
  if (!prompt) {
    res.statusCode = 400;
    res.body = { error: 'Missing prompt (or render_request.prompt)' };
    return;
  }

  const viewport_image_base64 = body.viewport_image_base64;
  if (!viewport_image_base64 || typeof viewport_image_base64 !== 'string') {
    res.statusCode = 400;
    res.body = { error: 'Missing viewport_image_base64 (dataURL/base64)' };
    return;
  }

  try {
    const width = Number.isFinite(render_request.width) ? render_request.width : undefined;
    const height = Number.isFinite(render_request.height) ? render_request.height : undefined;
    const negative_prompt = typeof render_request.negative_prompt === 'string' ? render_request.negative_prompt : undefined;
    const style = typeof render_request.style === 'string' ? render_request.style : undefined;
    const strength = typeof render_request.strength === 'number' ? render_request.strength : undefined;

    // 1) Submit Jimeng (CVProcess may return url or task_id)
    const { taskId, url: immediateUrl, resp: submitResp } = await jimengSubmitTask({
      ak: AK,
      sk: SK,
      prompt,
      negative_prompt,
      style,
      strength,
      width,
      height,
      reference_image_base64: viewport_image_base64,
      returnUrl: true,
    });

    let jimengUrl = immediateUrl;

    if (!taskId) {
      if (!jimengUrl) {
        res.statusCode = 200;
        res.body = { error: 'No url/taskId returned from CVProcess', raw: submitResp };
        return;
      }
    }

    // 2) Poll result when needed
    let status = 'succeed';
    let pollResp = null;
    if (!jimengUrl && taskId) {
      const polled = await jimengPollResult({ ak: AK, sk: SK, taskId });
      jimengUrl = polled.url;
      status = polled.status || status;
      pollResp = polled.resp;
    }

    // 3) Download result, upload to veImageX service
    const { buf, contentType } = await fetchBinary(jimengUrl);
    const serviceId = process.env.IMAGEX_SERVICE_ID || '97hsy4j2xz';
    const publicDomain = process.env.IMAGEX_PUBLIC_DOMAIN || '97hsy4j2xz.veimagex-pub.cn-north-1.volces.com';
    const stored = await imagexUploadBufferToService({
      ak: AK,
      sk: SK,
      serviceId,
      publicDomain,
      buf,
      contentType,
    });

    // 4) Generate an accessible URL (matching console "资源地址" behavior)
    const tpl = typeof body.imagex_template === 'string' ? body.imagex_template : null;
    let finalUrl = stored.url;
    try {
      finalUrl = await imagexGetResourceURL({
        ak: AK,
        sk: SK,
        serviceId,
        domain: stored.domain || publicDomain,
        uri: stored.storeUri,
        tpl: tpl || undefined,
        proto: 'https',
        format: 'image',
        timestampSec: 7 * 24 * 3600,
      });
    } catch {
      // fallback to constructed URL
    }

    res.statusCode = 200;
    res.body = {
      url: finalUrl,
      storeUri: stored.storeUri,
      taskId: taskId || null,
      status,
      raw: pollResp || submitResp,
    };
  } catch (e) {
    res.statusCode = 500;
    res.body = { error: 'image failed', detail: String(e) };
  }
}

async function handleTexture(req, res) {
  if (!checkToken(req, res)) return;

  const AK = process.env.VOLC_ACCESS_KEY_ID;
  const SK = process.env.VOLC_ACCESS_KEY_SECRET;
  if (!AK || !SK) {
    res.statusCode = 500;
    res.body = { error: 'Missing VOLC_ACCESS_KEY_ID/SECRET' };
    return;
  }

  const body = req.body || {};
  const render_request = body.render_request || body;
  const userPrompt = render_request?.prompt;
  if (!userPrompt) {
    res.statusCode = 400;
    res.body = { error: 'Missing render_request.prompt' };
    return;
  }

  // Force seamless tile texture prompt (no scene, no objects)
  const prompt =
    `无缝四方连续纹理（seamless tileable texture），平铺不出现接缝，适合作为投影花纹贴图。` +
    `要求：俯视平面纹理、无明显主体、无文字、无边框、细节清晰。` +
    `主题描述：${userPrompt}`;

  try {
    const width = 1024;
    const height = 1024;
    const negative_prompt =
      (typeof render_request.negative_prompt === 'string' && render_request.negative_prompt.trim()) ||
      '文字, watermark, logo, 边框, 拼贴, 透视, 复杂主体, 人物, 建筑';
    const style = typeof render_request.style === 'string' ? render_request.style : 'realistic';
    const strength = typeof render_request.strength === 'number' ? render_request.strength : 0.8;

    const { taskId, url: immediateUrl, resp: submitResp } = await jimengSubmitTask({
      ak: AK,
      sk: SK,
      prompt,
      negative_prompt,
      style,
      strength,
      width,
      height,
      reference_image_base64: null,
      returnUrl: true,
    });

    let jimengUrl = immediateUrl;
    let pollResp = null;
    if (!jimengUrl && taskId) {
      const polled = await jimengPollResult({ ak: AK, sk: SK, taskId });
      jimengUrl = polled.url;
      pollResp = polled.resp;
    }
    if (!jimengUrl) {
      res.statusCode = 200;
      res.body = { error: 'No url returned from jimeng', raw: pollResp || submitResp };
      return;
    }

    const { buf, contentType } = await fetchBinary(jimengUrl);
    const serviceId = process.env.IMAGEX_SERVICE_ID || '97hsy4j2xz';
    const publicDomain = process.env.IMAGEX_PUBLIC_DOMAIN || '97hsy4j2xz.veimagex-pub.cn-north-1.volces.com';
    const stored = await imagexUploadBufferToService({
      ak: AK,
      sk: SK,
      serviceId,
      publicDomain,
      buf,
      contentType,
    });

    const tpl = typeof body.imagex_template === 'string' ? body.imagex_template : null;
    let finalUrl = stored.url;
    try {
      finalUrl = await imagexGetResourceURL({
        ak: AK,
        sk: SK,
        serviceId,
        domain: stored.domain || publicDomain,
        uri: stored.storeUri,
        tpl: tpl || undefined,
        proto: 'https',
        format: 'image',
        timestampSec: 365 * 24 * 3600,
      });
    } catch {
      // ignore
    }

    res.statusCode = 200;
    res.body = {
      url: finalUrl,
      storeUri: stored.storeUri,
      taskId: taskId || null,
      raw: pollResp || submitResp,
    };
  } catch (e) {
    res.statusCode = 500;
    res.body = { error: 'texture failed', detail: String(e) };
  }
}

async function handleProxyImage(req, res) {
  if (!checkToken(req, res)) return;

  const body = req.body || {};
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    res.statusCode = 400;
    res.body = { error: 'Missing url (must be http/https)' };
    return;
  }

  try {
    const { buf, contentType } = await fetchBinary(url);
    // guard: prevent huge payloads
    if (buf.length > 6 * 1024 * 1024) {
      res.statusCode = 413;
      res.body = { error: 'Image too large to proxy' };
      return;
    }
    const ct = contentType || 'image/png';
    const b64 = buf.toString('base64');
    res.statusCode = 200;
    res.body = {
      contentType: ct,
      dataUrl: `data:${ct};base64,${b64}`,
    };
  } catch (e) {
    res.statusCode = 500;
    res.body = { error: 'proxy failed', detail: String(e) };
  }
}

// ==============
// Express routes (Tencent SCF Web mode)
// ==============
app.options('*', (req, res) => {
  corsExpress(req, res);
  res.status(204).send('');
});

app.get('/', (req, res) => {
  corsExpress(req, res);
  res.status(200).json({ ok: true, routes: ['/chat', '/image'] });
});

app.post('/chat', async (req, res) => {
  corsExpress(req, res);
  const plainRes = { statusCode: 200, body: null };
  await handleChat({ headers: req.headers, body: req.body }, plainRes);
  res.status(plainRes.statusCode || 200).json(plainRes.body ?? {});
});

app.post('/image', async (req, res) => {
  corsExpress(req, res);
  const plainRes = { statusCode: 200, body: null };
  await handleImage({ headers: req.headers, body: req.body }, plainRes);
  res.status(plainRes.statusCode || 200).json(plainRes.body ?? {});
});

app.post('/texture', async (req, res) => {
  corsExpress(req, res);
  const plainRes = { statusCode: 200, body: null };
  await handleTexture({ headers: req.headers, body: req.body }, plainRes);
  res.status(plainRes.statusCode || 200).json(plainRes.body ?? {});
});

app.post('/proxy-image', async (req, res) => {
  corsExpress(req, res);
  const plainRes = { statusCode: 200, body: null };
  await handleProxyImage({ headers: req.headers, body: req.body }, plainRes);
  res.status(plainRes.statusCode || 200).json(plainRes.body ?? {});
});

app.post('/migrate', async (req, res) => {
  corsExpress(req, res);
  const plainRes = { statusCode: 200, body: null };
  await handleMigrate({ headers: req.headers, body: req.body }, plainRes);
  res.status(plainRes.statusCode || 200).json(plainRes.body ?? {});
});

function makeReqResFromEvent(event) {
  const headersIn = event?.headers || {};
  const headers = {};
  for (const [k, v] of Object.entries(headersIn)) headers[String(k).toLowerCase()] = v;

  let body = event?.body;
  if (event?.isBase64Encoded && typeof body === 'string') {
    body = Buffer.from(body, 'base64').toString('utf8');
  }
  const json = typeof body === 'string' ? jsonSafeParse(body) : body;

  const req = {
    method: event?.httpMethod || event?.requestContext?.httpMethod || 'GET',
    path: event?.path || '/',
    headers,
    query: event?.queryStringParameters || {},
    body: json,
    rawBody: body,
  };

  const res = {
    statusCode: 200,
    headers: {},
    body: null,
  };
  return { req, res };
}

function finalizeResponse(event, res) {
  const corsHeaders = buildCorsHeaders(event?.headers || {});
  const headers = {
    ...corsHeaders,
    ...(res.headers || {}),
    'Content-Type': 'application/json; charset=utf-8',
  };
  const bodyStr = res.body == null ? '' : typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
  return {
    isBase64Encoded: false,
    statusCode: res.statusCode || 200,
    headers,
    body: bodyStr,
  };
}

async function route(event) {
  const { req, res } = makeReqResFromEvent(event);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.body = '';
    return finalizeResponse(event, res);
  }

  if (req.path === '/' && req.method === 'GET') {
    res.statusCode = 200;
    res.body = { ok: true, routes: ['/chat', '/image'] };
    return finalizeResponse(event, res);
  }

  if (req.path === '/chat' && req.method === 'POST') {
    await handleChat(req, res);
    return finalizeResponse(event, res);
  }

  if (req.path === '/image' && req.method === 'POST') {
    await handleImage(req, res);
    return finalizeResponse(event, res);
  }

  if (req.path === '/texture' && req.method === 'POST') {
    await handleTexture(req, res);
    return finalizeResponse(event, res);
  }

  if (req.path === '/proxy-image' && req.method === 'POST') {
    await handleProxyImage(req, res);
    return finalizeResponse(event, res);
  }

  if (req.path === '/migrate' && req.method === 'POST') {
    await handleMigrate(req, res);
    return finalizeResponse(event, res);
  }

  res.statusCode = 404;
  res.body = { error: 'Not Found', path: req.path, method: req.method };
  return finalizeResponse(event, res);
}

// Tencent Cloud SCF entry
exports.main_handler = async (event, context) => {
  return await route(event);
};

// Local debug (optional)
if (require.main === module) {
  const port = Number(process.env.PORT || 9000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`PCG_chat listening on ${port}`);
  });
}

