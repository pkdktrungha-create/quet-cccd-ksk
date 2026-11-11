/* ===== Lõi xử lý: dựng bảng địa giới, tách QR CCCD, tách địa chỉ, đổi sang địa chỉ hành chính mới =====
   File này không đụng tới giao diện, chạy được cả trong trình duyệt lẫn Node (để kiểm thử). */
'use strict';

function vkey(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ---------- A. Dựng bảng tra từ dữ liệu gốc (danh mục xã/phường + bảng "trước sáp nhập") ---------- */
const PFX = '(thành phố|thủ đô|thị trấn|thị xã|đặc khu|phường|huyện|quận|tỉnh|xã|tp\\.?)';
const NB = '(?<![\\p{L}\\p{N}_])', NA = '(?![\\p{L}\\p{N}_])';
const TYPE_MAP = { 'xã': 'x', 'phường': 'p', 'thị trấn': 't', 'đặc khu': 'd', 'huyện': 'h', 'quận': 'h', 'thị xã': 'h',
  'thành phố': 'h', 'tp': 'h', 'tp.': 'h', 'tỉnh': 'h', 'thủ đô': 'h' };
const NOISE = ['một phần diện tích tự nhiên', 'một phần diện tích tn', 'một phần diện tích', 'quy mô dân số', 'phần còn lại',
  'sau khi sắp xếp', 'sau khi sáp nhập', 'toàn bộ diện tích tự nhiên', 'toàn bộ', 'diện tích tự nhiên',
  NB + 'của các' + NA, NB + 'của' + NA, NB + 'các' + NA, NB + 'và' + NA, NB + 'vào' + NA].map(s => new RegExp(s, 'giu'));
const RE_PFX_ANY = new RegExp(PFX + '\\s+', 'giu');
const RE_PFX_HEAD = new RegExp('^\\s*' + PFX + '\\s+', 'iu');
const RE_PFX_FULL = new RegExp('^' + PFX + '\\s+(.+)$', 'iu');
const RE_PFX_CLEAN = new RegExp('^' + PFX + '\\s', 'iu');
const RE_AND = new RegExp(',|' + NB + 'và' + NA, 'u');

function splitTop(text) {
  const out = []; let depth = 0, cur = '';
  for (const ch of String(text || '')) {
    if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(t => t.trim()).filter(Boolean);
}

/* "Phường A, một phần diện tích của các phường B, C (quận X)" -> [[loại, tên, chú thích quận/huyện, chỉ-một-phần]] */
function parseOld(text) {
  const items = []; let ctxPartial = false, ctxType = '?';
  for (const tok of splitTop(text)) {
    const low = tok.toLowerCase();
    let partial = /một phần|phần còn lại/.test(low);
    let qual = '';
    for (const m of tok.matchAll(/\(([^)]*)\)/g)) {
      const q = m[1];
      if (/phần còn lại|sau khi/.test(q.toLowerCase())) partial = true;
      else qual = q.trim().replace(RE_PFX_HEAD, '');
    }
    let t = tok.replace(/\([^)]*\)/g, ' ');
    for (const n of NOISE) t = t.replace(n, ' ');
    t = t.replace(/\s+/g, ' ').replace(/^[ .;]+|[ .;]+$/g, '');
    if (!t) { if (partial) ctxPartial = true; continue; }
    const m = t.match(RE_PFX_FULL);
    let typ, name, isPartial;
    if (m) {
      typ = TYPE_MAP[m[1].toLowerCase()] || '?';
      name = m[2].trim();
      ctxType = typ;
      if (partial) ctxPartial = true;
      else if (RE_PFX_CLEAN.test(tok.trim())) ctxPartial = false; // "Phường X" đứng riêng -> hết ngữ cảnh "một phần"
      isPartial = partial || ctxPartial;
    } else { // tên không có tiền tố, vd "Điện Biên" trong "các phường Cửa Nam, Điện Biên"
      typ = ctxType; name = t;
      isPartial = partial || ctxPartial;
      if (partial) ctxPartial = true;
    }
    if (typ === 'h' || !name) continue;
    items.push([typ, name, qual, isPartial]);
  }
  return items;
}

const pick = (o, k) => (o && o[k] !== undefined) ? o[k] : (o ? o[k[0].toLowerCase() + k.slice(1)] : undefined);

/* main: danh mục tỉnh + xã/phường hiện hành; donvi: bảng "trước sáp nhập" (có thể rỗng) */
function buildData(main, donvi, meta) {
  donvi = Array.isArray(donvi) ? donvi : [];
  const dvProv = {}, dvWard = {}, dvWardByName = {};
  for (const x of donvi) {
    if (!x || typeof x.ma !== 'string') continue;
    if (x.ma.length === 2) dvProv[x.ma] = x;
    else if (x.ma.length === 5) dvWard[x.ma] = x;
  }
  for (const k of Object.keys(dvWard)) {
    const x = dvWard[k], nk = x.magoc + '|' + vkey(x.ten);
    if (!(nk in dvWardByName)) dvWardByName[nk] = x;
  }
  const prov = [], wards = [], old = [];
  for (const p of main) {
    const pc = pick(p, 'Code'), full = pick(p, 'FullName') || '', short = pick(p, 'Name') || full;
    const txt = (dvProv[pc] && dvProv[pc].truocsapnhap) || 'giữ nguyên';
    const olds = new Set([vkey(full.replace(RE_PFX_ANY, ''))]);
    if (!txt.toLowerCase().includes('giữ nguyên')) {
      for (let part of txt.replace(/TPHCM/g, 'thành phố Hồ Chí Minh').split(RE_AND)) {
        part = part.trim().replace(RE_PFX_HEAD, '');
        if (part) olds.add(vkey(part));
      }
    }
    olds.add(vkey(short));
    olds.delete('');
    prov.push([pc, full, [...olds].sort()]);
    for (const w of (pick(p, 'Wards') || [])) {
      const wi = wards.length, code = pick(w, 'Code'), wfull = pick(w, 'FullName') || '';
      let src = dvWard[code];
      if (!src || src.magoc !== pc) src = dvWardByName[pc + '|' + vkey(wfull)];
      const before = src ? String(src.truocsapnhap || '') : '';
      wards.push([code, wfull, pc, before.replace(/\s+/g, ' ').trim()]);
      if (!src) continue;
      for (const [typ, name, qual, part] of parseOld(before)) old.push([vkey(name), typ, vkey(qual), wi, part ? 1 : 0]);
    }
  }
  return { prov, wards, old, meta: meta || {} };
}

/* ---------- B. Bảng tra đang dùng ---------- */
let DATA = { prov: [], wards: [], old: [], meta: {} };
let PROV_BY_OLD = {}, PROV_BY_CODE = {}, OLD_BY_KEY = {}, WARD_KEYS = [], WARD_BY_CODE = {};

function setData(d) {
  DATA = d; PROV_BY_OLD = {}; PROV_BY_CODE = {}; OLD_BY_KEY = {}; WARD_BY_CODE = {};
  d.prov.forEach(p => { PROV_BY_CODE[p[0]] = p; p[2].forEach(k => { (PROV_BY_OLD[k] = PROV_BY_OLD[k] || []).push(p[0]); }); });
  d.old.forEach(o => { (OLD_BY_KEY[o[0]] = OLD_BY_KEY[o[0]] || []).push(o); });
  WARD_KEYS = d.wards.map(w => vkey(w[1].replace(/^(Phường|Xã|Đặc khu)\s+/i, '')));
  d.wards.forEach((w, i) => { WARD_BY_CODE[w[0]] = i; });
}

/* Bước trung gian riêng cho Hải Phòng: sắp xếp có hiệu lực 01/01/2025 (NQ 1232/NQ-UBTVQH15).
   Thẻ cấp trước 2025 còn ghi tên xã cũ hơn một bước so với bảng sáp nhập 01/7/2025. */
const STEP_2025 = { 'hai phong': {
  'thuy nguyen': { 'ngu lao': ['Phạm Ngũ Lão'], 'tan duong': ['Dương Quan'], 'lam dong': ['Hoàng Lâm'], 'hoang dong': ['Hoàng Lâm'],
    'kien bai': ['Lê Hồng Phong'], 'my dong': ['Lê Hồng Phong'], 'dong son': ['Trần Hưng Đạo'], 'kenh giang': ['Trần Hưng Đạo'],
    'luu ky': ['Lưu Kiếm'], 'nui deo': ['Thủy Đường'], 'thuy son': ['Thủy Đường'], 'trung ha': ['Thủy Hà'], 'thuy trieu': ['Thủy Hà'],
    'phuc le': ['Nam Triệu Giang'], 'pha le': ['Nam Triệu Giang'], 'gia minh': ['Bạch Đằng'], 'gia duc': ['Bạch Đằng'], 'minh tan': ['Bạch Đằng'],
    'lien khe': ['Liên Xuân'], 'lai xuan': ['Liên Xuân'], 'an son': ['Ninh Sơn'], 'ky son': ['Ninh Sơn'], 'phu ninh': ['Ninh Sơn'],
    'hop thanh': ['Quang Trung'], 'cao nhan': ['Quang Trung'], 'chinh my': ['Quang Trung'] },
  'an duong': { 'an duong': ['Lê Lợi'], 'bac son': ['Nam Sơn', 'Tân Tiến'], 'dang cuong': ['An Hải'], 'quoc tuan': ['An Hải'] },
  'hong bang': { 'ha ly': ['Thượng Lý'], 'trai chuoi': ['Thượng Lý'] },
  'tien lang': { 'toan thang': ['Tân Minh'], 'bach dang': ['Tân Minh'], 'quang phuc': ['Tân Minh'] },
  'vinh bao': { 'vinh long': ['Vĩnh Hòa'], 'hiep hoa': ['Vĩnh Hòa'], 'an hoa': ['Vĩnh Hòa'], 'nhan hoa': ['Vĩnh Hưng'], 'tam da': ['Vĩnh Hưng'],
    'vinh quang': ['Vĩnh Hưng'], 'hung nhan': ['Vĩnh Hải'], 'thanh luong': ['Vĩnh Hải'], 'dong minh': ['Vĩnh Hải'],
    'vinh phong': ['Tiền Phong'], 'cong hien': ['Tiền Phong'], 'co am': ['Tam Cường'], 'vinh tien': ['Tam Cường'] },
  'kien thuy': { 'dai ha': ['Kiến Hưng'], 'thuy huong': ['Kiến Hưng'], 'ngu doan': ['Kiến Hưng'] },
  'ngo quyen': { 'dong quoc binh': ['Lạch Tray'], 'le loi': ['Lạch Tray'], 'lac vien': ['Gia Viên'], 'may to': ['Gia Viên'] },
  'le chan': { 'lam son': ['An Biên'], 'cat dai': ['An Biên'], 'ho nam': ['Trần Nguyên Hãn'], 'du hang': ['Trần Nguyên Hãn'],
    'trai cau': ['Hàng Kênh'], 'dong hai': ['Hàng Kênh'], 'niem nghia': ['An Dương'], 'nghia xa': ['An Dương'] },
  'kien an': { 'phu lien': ['Bắc Hà'], 'trang minh': ['Bắc Hà'], 'quan tru': ['Đồng Hòa'], 'lam ha': ['Đồng Hòa'] }
} };

/* ---------- C. Tách chuỗi QR của CCCD ---------- */
/* từ tiếng Việt nào cũng có nguyên âm; từ chỉ toàn phụ âm (“VN”, “THN”, “PHC”) là dấu hiệu chữ có dấu đã bị máy quét nuốt mất */
const ABBR_OK = /^(tdp|kp|tp|tt|ql|tl|dt|cc|q|p|h|x|st|bv|ubnd)$/;
const VOWEL_RE = /[aeiouyàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/;
function brokenWords(text) {
  return String(text).split(/[\s,.;:\-\/()]+/).filter(w => {
    if (!w || /\d/.test(w)) return false;
    const l = w.toLowerCase();
    return !VOWEL_RE.test(l) && !ABBR_OK.test(l);
  });
}

function parseQR(raw) {
  const s = String(raw || '').replace(/[\r\n\t]+/g, '').trim();
  const f = s.split('|').map(x => x.trim());
  const res = { ok: false, warnings: [], raw: s };
  if (f.length < 7) { res.error = 'Chuỗi quét không đúng định dạng QR CCCD (cần 7 trường ngăn cách bằng dấu |).'; return res; }
  const [cccd, cmnd, name, dobRaw, gender, address, issueRaw] = f;
  if (!/^\d{12}$/.test(cccd)) res.warnings.push('Số CCCD không đủ 12 chữ số: "' + cccd + '".');
  res.cccd = cccd; res.cmnd = cmnd; res.name = name; res.address = address;
  res.gender = /^n(?:[uữ]|$)/i.test(gender) ? 'Nữ' : (/^nam/i.test(gender) ? 'Nam' : gender); // “N” = “Nữ” bị mất dấu
  const d = x => {
    const m = String(x).replace(/\D/g, '');
    if (m.length === 8) return { d: m.slice(0, 2), m: m.slice(2, 4), y: m.slice(4) };
    if (m.length === 4) return { d: '', m: '', y: m };
    return null;
  };
  res.dob = d(dobRaw); res.issue = d(issueRaw);
  if (!res.dob) res.warnings.push('Không đọc được ngày sinh: "' + dobRaw + '".');
  if (!res.issue) res.warnings.push('Không đọc được ngày cấp: "' + issueRaw + '".');
  const broken = brokenWords(name + ' ' + address);
  if (broken.length) {
    res.lostMarks = true;
    res.warnings.unshift('Máy quét đã làm MẤT chữ có dấu tiếng Việt (còn lại những từ như ' + broken.slice(0, 3).map(w => '“' + w + '”').join(', ') + '). Họ tên và địa chỉ đọc được KHÔNG đầy đủ – không phải lỗi của chương trình. Hãy gõ lại họ tên và địa chỉ theo mặt thẻ, rồi xem hướng dẫn chỉnh máy quét ở khung “Máy quét”.');
  }
  if (/[?�]/.test(name) || /[?�]/.test(address)) res.warnings.push('Tên/địa chỉ có ký tự lạ (?) – có thể máy quét gõ sai dấu tiếng Việt. Tắt Unikey/chuyển bàn phím sang tiếng Anh rồi quét lại.');
  // kiểm tra chéo: chữ số thứ 4 = giới tính + thế kỷ, 2 số tiếp = năm sinh
  if (/^\d{12}$/.test(cccd) && res.dob) {
    const g = +cccd[3], yy = cccd.slice(4, 6), century = 1900 + Math.floor(g / 2) * 100;
    const genderCode = g % 2 === 0 ? 'Nam' : 'Nữ';
    if (genderCode !== res.gender) res.warnings.push('Giới tính trong số CCCD (' + genderCode + ') khác giới tính trên QR (' + res.gender + ').');
    if (yy !== res.dob.y.slice(2) || String(century).slice(0, 2) !== res.dob.y.slice(0, 2))
      res.warnings.push('Năm sinh trong số CCCD không khớp ngày sinh trên QR.');
  }
  res.ok = true;
  return res;
}

function calcAge(dob, today) {
  if (!dob || !dob.y) return '';
  today = today || new Date();
  let age = today.getFullYear() - +dob.y;
  if (dob.m && dob.d) {
    const bd = new Date(+dob.y, +dob.m - 1, +dob.d);
    const had = today.getMonth() > bd.getMonth() || (today.getMonth() === bd.getMonth() && today.getDate() >= bd.getDate());
    if (!had) age--;
  }
  return age;
}

/* ---------- D. Tách địa chỉ thành thôn/tổ – xã – huyện – tỉnh ---------- */
const K_PREFIX_RE = /^(thanh pho|thu do|thi tran|thi xa|dac khu|phuong|huyen|quan|tinh|xa|tp)\s+/;
const TYPE_OF = { 'xa': 'x', 'phuong': 'p', 'thi tran': 't', 'dac khu': 'd' };
const DISTRICT_PREFIX = ['huyen', 'quan', 'thi xa', 'thanh pho', 'tp'];
const UNIT_PREFIX = ['xa', 'phuong', 'thi tran', 'dac khu'];

function splitPrefix(raw) {
  raw = String(raw).trim();
  const k = vkey(raw), m = k.match(K_PREFIX_RE);
  if (!m) return { prefix: '', key: k, name: raw, raw };
  return { prefix: m[1], key: k.slice(m[0].length), name: raw.replace(RE_PFX_HEAD, ''), raw };
}

/* tên này có phải một xã/phường (cũ hoặc mới) đã biết trong tỉnh không */
function knownUnit(key, tinhKey, pcodes) {
  if (!key) return false;
  if ((OLD_BY_KEY[key] || []).some(o => pcodes.includes(DATA.wards[o[3]][2]))) return true;
  if (WARD_KEYS.some((k, i) => k === key && pcodes.includes(DATA.wards[i][2]))) return true;
  const st = STEP_2025[tinhKey];
  return !!st && Object.keys(st).some(h => key in st[h]);
}

function parseAddress(addr) {
  const seg = String(addr || '').split(',').map(x => x.trim()).filter(Boolean);
  const out = { detail: '', xa: null, huyen: null, tinh: null, segments: seg };
  if (!seg.length) return out;
  let i = seg.length - 1;
  out.tinh = splitPrefix(seg[i]); i--;
  const pcodes = PROV_BY_OLD[out.tinh.key] || [];
  if (i >= 0) {
    const p = splitPrefix(seg[i]);
    if (DISTRICT_PREFIX.includes(p.prefix)) { out.huyen = p; i--; }
    else if (!UNIT_PREFIX.includes(p.prefix)) {
      // Thẻ thường ghi "Thôn 3, Tân Dương, Thủy Nguyên, Hải Phòng" (không có chữ Xã/Huyện):
      // coi là quận/huyện nếu mục đứng trước nó là một xã/phường đã biết.
      const prev = i >= 1 ? splitPrefix(seg[i - 1]) : null;
      const prevIsUnit = !!prev && (UNIT_PREFIX.includes(prev.prefix) || knownUnit(prev.key, out.tinh.key, pcodes));
      if (prevIsUnit || (i >= 2 && !knownUnit(p.key, out.tinh.key, pcodes))) { out.huyen = p; i--; }
    }
  }
  if (i >= 0) { out.xa = splitPrefix(seg[i]); i--; }
  out.detail = seg.slice(0, i + 1).join(', ');
  return out;
}

/* ---------- E. Đổi sang địa chỉ hành chính mới ---------- */
function matchOld(nameKey, xaType, huyenKey, pcodes) {
  let c = (OLD_BY_KEY[nameKey] || []).filter(o => pcodes.includes(DATA.wards[o[3]][2]));
  const m = { wards: [], partial: false, qualMismatch: false };
  if (!c.length) return m;
  // Nhiều xã đã đổi thành phường trước 2025, nên KHÔNG lọc cứng theo loại xã/phường; chỉ dùng để xếp thứ tự.
  if (huyenKey) {
    const withQ = c.filter(o => o[2] && o[2] === huyenKey);
    const noQ = c.filter(o => !o[2]);
    if (withQ.length) c = withQ;
    else if (noQ.length) c = noQ;
    else m.qualMismatch = true; // chỉ có bản ghi chú thích quận/huyện khác -> hạ độ tin cậy
  }
  c = c.slice().sort((x, y) => (y[1] === xaType) - (x[1] === xaType));
  m.wards = [...new Set(c.map(o => o[3]))];
  m.partial = c.some(o => o[4] === 1);
  return m;
}

/* khóa của một "lựa chọn đã lưu": theo thôn/tổ, hoặc cho cả xã/phường cũ (wide) */
function ruleKey(a, wide) {
  return [a.tinh.key, a.huyen ? a.huyen.key : '', a.xa.key, wide ? '*' : detailKey(a.detail)].join('|');
}
/* Chỉ giữ tên thôn/tổ/đường (mục sát xã/phường nhất), bỏ số nhà – để không lưu địa chỉ riêng của người khám. */
function detailKey(detail) {
  const seg = String(detail || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!seg.length) return '';
  return vkey(seg[seg.length - 1]).replace(/^((so nha|so|sn) )?((\d+[a-z]?)( |$))+/, '').trim();
}
function ruleLabel(a) {
  return [detailKey(a.detail), [a.xa.raw, a.huyen ? a.huyen.raw : '', a.tinh.raw].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
}

function resolveAddress(addr, rules) {
  const a = typeof addr === 'string' ? parseAddress(addr) : addr;
  const r = { parsed: a, status: 'none', candidates: [], note: '', saved: null };
  if (!a.tinh || !a.xa) { r.note = 'Địa chỉ không đủ cấp tỉnh/xã để đổi.'; return r; }
  if (rules) {
    for (const wide of [false, true]) {
      const k = ruleKey(a, wide), rule = rules[k];
      if (rule && WARD_BY_CODE[rule.code] !== undefined) { r.saved = { idx: WARD_BY_CODE[rule.code], key: k, wide }; break; }
    }
  }
  const pcodes = PROV_BY_OLD[a.tinh.key] || [];
  if (!pcodes.length) { r.note = 'Không nhận ra tỉnh/thành "' + a.tinh.name + '".'; return r; }
  r.provinces = pcodes.map(c => PROV_BY_CODE[c]);
  const xaType = TYPE_OF[a.xa.prefix] || '?';
  const huyenKey = a.huyen ? a.huyen.key : '';
  const grade = () => { r.status = (r.candidates.length === 1 && !r.partial && !r.qualMismatch) ? 'high' : 'confirm'; return r; };

  // 0) bước trung gian 01/01/2025 (Hải Phòng)
  const st = STEP_2025[a.tinh.key];
  const step = huyenKey && st && st[huyenKey] && st[huyenKey][a.xa.key];
  if (step) {
    const set = []; let partial = step.length > 1, qm = false;
    step.forEach(n => { const m = matchOld(vkey(n), '?', huyenKey, pcodes); m.wards.forEach(w => { if (!set.includes(w)) set.push(w); }); partial = partial || m.partial; qm = qm || m.qualMismatch; });
    if (set.length) {
      r.via = a.xa.name + ' → ' + step.join(' / ') + ' (sắp xếp 01/01/2025)';
      r.candidates = set; r.partial = partial; r.qualMismatch = qm;
      return grade();
    }
  }
  // a) đơn vị cũ nằm trong tỉnh mới
  const m = matchOld(a.xa.key, xaType, huyenKey, pcodes);
  if (m.wards.length) { r.candidates = m.wards; r.partial = m.partial; r.qualMismatch = m.qualMismatch; return grade(); }
  // b) địa chỉ đã là địa chỉ mới (tên khớp xã/phường mới trong tỉnh)
  const direct = [];
  DATA.wards.forEach((w, i) => { if (pcodes.includes(w[2]) && WARD_KEYS[i] === a.xa.key) direct.push(i); });
  if (direct.length) { r.candidates = direct; r.alreadyNew = true; r.status = direct.length === 1 ? 'high' : 'confirm'; return r; }
  r.note = 'Không tìm thấy xã/phường "' + a.xa.name + '" trong bảng sáp nhập của tỉnh này. Chọn tay bên dưới.';
  return r;
}

function newAddressText(detail, wardIdx) {
  const w = DATA.wards[wardIdx], p = PROV_BY_CODE[w[2]];
  return [detail, w[1], p[1]].filter(Boolean).join(', ');
}

/* gộp hai bảng "lựa chọn đã lưu": mục nào mới hơn (theo thời điểm lưu) thì giữ */
function mergeRules(mine, theirs) {
  const out = Object.assign({}, mine); let added = 0, replaced = 0, kept = 0;
  for (const k of Object.keys(theirs || {})) {
    const t = theirs[k];
    if (!t || typeof t.code !== 'string' || !/^\d{5}$/.test(t.code)) continue;
    const rule = { code: t.code, label: String(t.label || '').slice(0, 300), at: String(t.at || '').slice(0, 40) };
    if (!out[k]) { out[k] = rule; added++; }
    else if (out[k].code !== rule.code && rule.at > (out[k].at || '')) { out[k] = rule; replaced++; }
    else kept++;
  }
  return { rules: out, added, replaced, kept };
}

const Core = { brokenWords, vkey, buildData, setData, parseOld, parseQR, calcAge, parseAddress, resolveAddress, newAddressText, ruleKey, detailKey, ruleLabel, mergeRules,
  get DATA() { return DATA; }, provByCode: c => PROV_BY_CODE[c], wardIdxByCode: c => WARD_BY_CODE[c] };
if (typeof module !== 'undefined') module.exports = Core;
