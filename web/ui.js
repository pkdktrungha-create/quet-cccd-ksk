/* ===== Giao diện: quét thẻ, điền giấy khám, lưu lựa chọn sửa tay, cập nhật dữ liệu ===== */
'use strict';
const $ = id => document.getElementById(id);
const T = new URLSearchParams(location.search).get('t') || '';
const api = (path, opt) => fetch(path, Object.assign({ headers: { 'X-Token': T } }, opt || {}));
const scan = $('scan');
let RULES = {};                 // các lựa chọn sửa tay đã lưu (khóa: tỉnh|huyện|xã cũ|thôn-tổ)
let cur = { detail: '', ward: null, addr: '', parsed: null, saved: null, res: null };
let ready = false;

function setState(t) { $('state').textContent = t; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtDate(iso) { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('vi-VN', { hour12: false }); }

function render() {
  $('o_name').textContent = $('f_name').value.toUpperCase();
  $('o_nam').textContent = $('f_gender').value === 'Nam' ? 'X' : '';
  $('o_nu').textContent = $('f_gender').value === 'Nữ' ? 'X' : '';
  const p = $('f_dob').value.split('/');
  $('o_d').textContent = p[0] || ''; $('o_m').textContent = p[1] || ''; $('o_y').textContent = p[2] || '';
  $('o_age').textContent = $('f_age').value;
  $('o_cccd').textContent = $('f_cccd').value;
  $('o_issue').textContent = $('f_issue').value;
  $('o_place').textContent = $('f_place').value;
  $('o_addr').textContent = $('f_addr').value;
  $('o_class').textContent = $('f_class').value;
  $('o_so').textContent = $('f_so').value;
  $('o_name').classList.toggle('lostmark', $('f_name').classList.contains('lostmark'));
  $('o_addr').classList.toggle('lostmark', $('f_addr').classList.contains('lostmark') || $('f_old').classList.contains('lostmark'));
  fitLines('ln_addr', 'o_addr');
  const h = dateHtml();
  document.querySelectorAll('[data-date=hp]').forEach(el => { el.innerHTML = h; });
}

/* chỗ ở dài hơn một dòng: để chữ xuống dòng và bỏ dòng chấm thừa bên dưới, tránh tràn trang */
function fitLines(rowId, valId) {
  const row = $(rowId), el = $(valId);
  row.classList.remove('wrap2');
  const r = document.createRange(); r.selectNodeContents(el);
  const tops = new Set(Array.from(r.getClientRects()).filter(q => q.width > 0).map(q => Math.round(q.top / 4)));
  if (tops.size > 1) row.classList.add('wrap2');
}

/* "Hải Phòng, ngày … tháng … năm 20…" – để trống thì giữ dấu chấm cho viết tay */
function dateHtml() {
  const m = ($('f_exam').value || '').match(/^\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(20\d{2})\s*$/);
  const d = m ? m[1].padStart(2, '0') : '', mo = m ? m[2].padStart(2, '0') : '', y = m ? m[3].slice(2) : '';
  return 'Hải Phòng, ngày <span class="fl w10">' + d + '</span> tháng <span class="fl w10">' + mo + '</span> năm 20<span class="fl w8">' + y + '</span>';
}

function badge(cls, text) { const b = $('adBadge'); b.className = 'badge ' + cls; b.textContent = text; }

/* ---------- địa chỉ ---------- */
function chooseWard(idx, fillAddr) {
  cur.ward = idx;
  const w = Core.DATA.wards[idx], p = Core.provByCode(w[2]);
  $('adNew').innerHTML =
    '<dt>Xã/phường mới</dt><dd>' + esc(w[1]) + ' <span class="code">' + esc(w[0]) + '</span></dd>' +
    '<dt>Tỉnh/TP mới</dt><dd>' + esc(p[1]) + ' <span class="code">' + esc(p[0]) + '</span></dd>' +
    '<dt>Địa chỉ mới</dt><dd>' + esc(Core.newAddressText(cur.detail, idx)) + '</dd>';
  if (fillAddr) { $('f_addr').value = Core.newAddressText(cur.detail, idx); render(); }
}

function fillWardList(pcodes) {
  $('wardlist').innerHTML = Core.DATA.wards.map(w => (!pcodes || pcodes.includes(w[2])) ?
    '<option value="' + esc(w[1] + ' – ' + Core.provByCode(w[2])[1] + ' [' + w[0] + ']') + '">' : '').join('');
}

function canSave() { return !!(cur.parsed && cur.parsed.tinh && cur.parsed.xa); }

function showSaveBox(saved) {
  const box = $('saveBox');
  // chỉ hiện khi có gì để nhớ: đã có lựa chọn lưu, hoặc kết quả tự động chưa chắc chắn
  if (!canSave() || cur.ward == null || (!saved && cur.res && cur.res.status === 'high')) { box.hidden = true; return; }
  box.hidden = false;
  $('btnForget').hidden = !saved;
  $('wide').checked = !!(saved && saved.wide);
  const dk = Core.detailKey(cur.parsed.detail);
  $('saveInfo').textContent = saved
    ? 'Đang dùng lựa chọn đã lưu ' + (saved.wide ? 'cho cả xã/phường cũ này' : (dk ? 'cho “' + dk + '”' : 'cho địa chỉ không ghi thôn/tổ')) +
      (RULES[saved.key] && RULES[saved.key].at ? ' (lưu ' + fmtDate(RULES[saved.key].at) + ')' : '') + '. Lần sau gặp lại sẽ tự điền.'
    : '';
}

async function persistRules() {
  $('dRules').textContent = Object.keys(RULES).length;
  try {
    const r = await api('/api/corrections', { method: 'POST', headers: { 'X-Token': T, 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, rules: RULES }) });
    if (!r.ok) throw new Error(r.status);
    return true;
  } catch (e) { setState('⚠ Không lưu được lựa chọn vào máy (' + e.message + ').'); return false; }
}

/* người dùng tự chọn xã/phường -> ghi nhớ để lần sau tự điền */
async function userPick(idx) {
  chooseWard(idx, true);
  if (!canSave()) { badge('b-ok', 'chọn tay'); return; }
  const wide = $('wide').checked, a = cur.parsed;
  const key = Core.ruleKey(a, wide);
  if (wide) delete RULES[Core.ruleKey(a, false)]; // lựa chọn riêng cho thôn/tổ sẽ che mất lựa chọn cả xã
  RULES[key] = { code: Core.DATA.wards[idx][0], label: Core.ruleLabel(a), at: new Date().toISOString() };
  cur.saved = { idx, key, wide };
  const ok = await persistRules();
  badge('b-ok', ok ? 'đã chọn – đã lưu' : 'chọn tay');
  showSaveBox(cur.saved);
}

function showAddress(addr) {
  $('cands').innerHTML = ''; $('adNew').innerHTML = ''; $('adParts').innerHTML = ''; $('manual').value = '';
  cur = { detail: '', ward: null, addr: addr, parsed: null, saved: null, res: null };
  $('saveBox').hidden = true;
  if (!addr.trim()) { badge('b-idle', 'chưa quét'); return; }
  const r = Core.resolveAddress(addr, RULES), a = r.parsed;
  cur.detail = a.detail; cur.parsed = a; cur.res = r; cur.saved = r.saved;
  $('adParts').innerHTML =
    '<dt>Thôn/tổ, số nhà</dt><dd>' + esc(a.detail || '—') + '</dd>' +
    '<dt>Xã/phường cũ</dt><dd>' + esc(a.xa ? a.xa.raw : '—') + '</dd>' +
    '<dt>Quận/huyện cũ</dt><dd>' + esc(a.huyen ? a.huyen.raw : '— (không có)') + '</dd>' +
    '<dt>Tỉnh/TP trên thẻ</dt><dd>' + esc(a.tinh ? a.tinh.raw : '—') + '</dd>' +
    (r.via ? '<dt>Bước trung gian</dt><dd>' + esc(r.via) + '</dd>' : '');
  fillWardList(r.provinces ? r.provinces.map(p => p[0]) : null);

  if (r.status === 'confirm' || (r.saved && r.candidates.length > 1)) {
    const why = (r.partial || (r.via && r.candidates.length > 1)) ? 'Xã/phường cũ này bị <b>chia</b> sang nhiều đơn vị mới – hỏi người khám thôn/tổ thuộc đơn vị nào.' :
      (r.candidates.length > 1 ? 'Có nhiều xã/phường cũ <b>trùng tên</b> trong tỉnh – chọn đúng đơn vị theo quận/huyện cũ.' : 'Chú thích quận/huyện trong dữ liệu không khớp thẻ – kiểm tra lại.');
    $('cands').innerHTML = '<div class="hint">' + why + '</div>' + r.candidates.map(i =>
      '<label class="cand"><input type="radio" name="cand" value="' + i + '"' + (r.saved && r.saved.idx === i ? ' checked' : '') + '><span><b>' + esc(Core.DATA.wards[i][1]) +
      '</b> <span class="code">' + esc(Core.DATA.wards[i][0]) + '</span><small>Gồm: ' + esc(Core.DATA.wards[i][3]) + '</small></span></label>').join('');
    document.querySelectorAll('input[name=cand]').forEach(el => el.addEventListener('change', () => userPick(+el.value)));
  }
  if (r.saved) {
    badge('b-ok', 'theo lựa chọn đã lưu');
    chooseWard(r.saved.idx, true);
  } else if (r.status === 'high') {
    badge('b-ok', r.alreadyNew ? 'đã là địa chỉ mới' : 'khớp duy nhất');
    chooseWard(r.candidates[0], true);
  } else if (r.status === 'confirm') {
    badge('b-warn', 'cần xác nhận');
    $('f_addr').value = addr; render();
  } else {
    badge('b-bad', 'không tìm thấy');
    $('cands').innerHTML = '<div class="hint">' + esc(r.note) + '</div>';
    $('f_addr').value = addr; render();
  }
  showSaveBox(r.saved);
}

/* ---------- quét thẻ ---------- */
function process(raw) {
  if (!ready) { setState('Dữ liệu chưa nạp xong, quét lại sau giây lát.'); return; }
  const q = Core.parseQR(raw);
  if (!q.ok) { setState('⚠ ' + q.error); scan.select(); return; }
  $('f_name').value = q.name;
  $('f_gender').value = (q.gender === 'Nam' || q.gender === 'Nữ') ? q.gender : '';
  $('f_dob').value = q.dob ? [q.dob.d, q.dob.m, q.dob.y].filter(Boolean).join('/') : '';
  $('f_age').value = Core.calcAge(q.dob);
  $('f_cccd').value = q.cccd; $('f_cmnd').value = q.cmnd || '';
  $('f_issue').value = q.issue ? [q.issue.d, q.issue.m, q.issue.y].filter(Boolean).join('/') : '';
  if (!$('f_place').value) $('f_place').value = 'Cục Cảnh sát QLHC về TTXH';
  $('f_old').value = q.address;
  $('warns').innerHTML = q.warnings.map(w => '<li>' + esc(w) + '</li>').join('');
  showAddress(q.address);
  markLost(!!q.lostMarks);
  render();
  setState('Đã đọc thẻ: ' + q.name + ' – ' + q.cccd + (q.warnings.length ? ' (có ' + q.warnings.length + ' cảnh báo)' : ''));
  scan.value = ''; scan.focus({ preventScroll: true });
  $('w1').scrollIntoView({ block: 'start' });
}

/* chữ có dấu bị máy quét nuốt mất: tô đỏ các ô phải gõ lại (chỉ trên màn hình, không in) */
function markLost(on) {
  $('lostBar').hidden = !on;
  ['f_name', 'f_old', 'f_addr'].forEach(id => $(id).classList.toggle('lostmark', on));
}
$('f_name').addEventListener('input', () => $('f_name').classList.remove('lostmark'));
$('f_addr').addEventListener('input', () => $('f_addr').classList.remove('lostmark'));
$('f_old').addEventListener('input', () => $('f_old').classList.remove('lostmark'));
$('f_old').addEventListener('change', () => $('f_addr').classList.remove('lostmark'));
$('btnLostHelp').addEventListener('click', () => { $('helpScan').open = true; $('helpScan').scrollIntoView({ block: 'center' }); });

/* ---------- bắt chuỗi quét: con trỏ đang ở ô nào cũng được ----------
   Máy quét gõ rất nhanh (vài ms/ký tự), người gõ không thể nhanh như vậy. Khi nhận ra một “đợt gõ nhanh”
   hoặc có dấu | liên tiếp, ta giữ chuỗi lại, trả ô đang đứng về nguyên trạng và tách chuỗi vào đúng từng mục. */
const burst = { el: null, val: '', s: '', t: 0, fast: 0, swallow: false };
let burstTimer = null;
const pipes = x => (x.match(/\|/g) || []).length;
function resetBurst() { clearTimeout(burstTimer); burst.el = null; burst.s = ''; burst.fast = 0; burst.swallow = false; }
function finishBurst() {
  const raw = burst.s;
  resetBurst();
  process(raw);
}
function startSwallow() {
  if (burst.swallow) return;
  burst.swallow = true;
  if (burst.el && 'value' in burst.el) burst.el.value = burst.val; // trả lại nội dung ô như trước khi quét
}
document.addEventListener('beforeinput', e => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  let data = e.data;
  if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') {
    data = data || (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '';
    if (pipes(data) >= 6) { e.preventDefault(); resetBurst(); process(data); }
    return;
  }
  if (e.inputType !== 'insertText' || !data) return;
  const now = performance.now();
  if (burst.el !== el || now - burst.t > 100) { resetBurst(); burst.el = el; burst.val = el.value; }
  else if (now - burst.t < 45) burst.fast++;
  burst.t = now;
  burst.s += data;
  if (!burst.swallow && (burst.fast >= 3 || pipes(burst.s) >= 2)) startSwallow();
  if (burst.swallow) e.preventDefault();
  clearTimeout(burstTimer);
  burstTimer = setTimeout(() => {
    if (!burst.swallow) return;
    if (pipes(burst.s) >= 6) finishBurst();          // máy quét không gửi Enter
    else if (burst.s.length >= 12) { setState('⚠ Chuỗi quét chưa đủ các trường (' + pipes(burst.s) + '/6 dấu |). Quét lại.'); resetBurst(); }
    else resetBurst();
  }, 300);
}, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && burst.swallow && burst.s.length >= 8) { e.preventDefault(); e.stopPropagation(); finishBurst(); }
}, true);
/* ---------- máy quét đặt ở chế độ cổng COM ảo: nhận nguyên chữ có dấu (UTF-8), không qua bàn phím ---------- */
const ser = { port: null, on: false, reader: null, buf: '', timer: null };
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } }
function serUI(msg, kind) {
  $('serBadge').className = 'badge ' + (kind || (ser.on ? 'b-ok' : 'b-idle'));
  $('serBadge').textContent = ser.on ? 'cổng COM' : 'bàn phím';
  $('btnSerial').textContent = ser.on ? 'Ngắt cổng COM' : 'Nối máy quét qua cổng COM';
  $('serMsg').textContent = msg || '';
}
function serFlush() {
  clearTimeout(ser.timer);
  let m;
  while ((m = ser.buf.search(/[\r\n]/)) >= 0) {
    const line = ser.buf.slice(0, m); ser.buf = ser.buf.slice(m + 1);
    if (line.trim()) process(line);
  }
  if (ser.buf) ser.timer = setTimeout(() => { // máy quét không gửi xuống dòng
    const l = ser.buf; ser.buf = '';
    if (pipes(l) >= 6) process(l);
  }, 400);
}
async function serLoop(port) {
  const dec = new TextDecoder('utf-8');
  try {
    while (ser.on && port.readable) {
      const reader = port.readable.getReader(); ser.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          ser.buf += dec.decode(value, { stream: true });
          serFlush();
        }
      } finally { reader.releaseLock(); ser.reader = null; }
    }
  } catch (e) { if (ser.on) setState('⚠ Mất kết nối cổng COM: ' + e.message); }
  try { await port.close(); } catch (e) { /* bỏ qua */ }
  ser.on = false; ser.port = null; serUI('Đã ngắt cổng COM.');
}
async function serOpen(port) {
  await port.open({ baudRate: +$('serBaud').value || 9600 });
  ser.port = port; ser.on = true; ser.buf = '';
  serUI('Đã nối cổng COM – quét thẻ như bình thường.', 'b-ok');
  setState('Đã nối máy quét qua cổng COM. Quét thẻ để bắt đầu.');
  serLoop(port);
}
async function serToggle() {
  if (ser.on) {
    lsSet('qc_ser', '0'); ser.on = false;
    try { if (ser.reader) await ser.reader.cancel(); } catch (e) { /* bỏ qua */ }
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    await serOpen(port); lsSet('qc_ser', '1');
  } catch (e) {
    if (e.name === 'NotFoundError') return; // người dùng bấm Hủy
    serUI('⚠ Không mở được cổng COM: ' + e.message + ' (cổng đang bị chương trình khác dùng, hoặc chọn sai cổng).', 'b-bad');
  }
}
if ('serial' in navigator) {
  $('serialBox').hidden = false;
  $('btnSerial').addEventListener('click', serToggle);
  const auto = async () => { // lần sau tự nối lại cổng đã cho phép
    if (ser.on || lsGet('qc_ser') !== '1') return;
    try { const ps = await navigator.serial.getPorts(); if (ps.length) await serOpen(ps[0]); } catch (e) { serUI('Chưa tự nối lại được cổng COM: ' + e.message); }
  };
  navigator.serial.addEventListener('connect', auto);
  navigator.serial.addEventListener('disconnect', () => { if (ser.on) { ser.on = false; serUI('Máy quét đã bị rút ra.', 'b-warn'); } });
  window.__serAuto = auto;
}

/* gõ tay vào ô quét rồi Enter (hoặc dán) vẫn dùng được */
scan.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (scan.value.trim()) process(scan.value); } });
/* nếu con trỏ không nằm trong ô nào (đang đứng ở nút bấm…), phím gõ đầu tiên được dồn về ô quét */
document.addEventListener('keydown', e => {
  const t = document.activeElement, tag = t && t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) scan.focus({ preventScroll: true });
});

['f_name', 'f_gender', 'f_dob', 'f_age', 'f_cccd', 'f_issue', 'f_place', 'f_addr', 'f_class', 'f_so', 'f_exam'].forEach(id => {
  $(id).addEventListener('input', render); $(id).addEventListener('change', render);
});
$('f_dob').addEventListener('change', () => {
  const p = $('f_dob').value.split('/');
  if (p.length === 3) { $('f_age').value = Core.calcAge({ d: p[0], m: p[1], y: p[2] }); render(); }
});
$('f_old').addEventListener('change', () => showAddress($('f_old').value));
$('manual').addEventListener('change', () => {
  const m = $('manual').value.match(/\[(\d{5})\]\s*$/);
  if (!m) return;
  const idx = Core.wardIdxByCode(m[1]);
  if (idx !== undefined) userPick(idx);
});
$('wide').addEventListener('change', async () => {
  if (cur.ward == null || !canSave()) return;
  if (!$('wide').checked) delete RULES[Core.ruleKey(cur.parsed, true)]; // bỏ áp dụng cho cả xã
  await userPick(cur.ward);
});
$('btnForget').addEventListener('click', async () => {
  if (!cur.saved) return;
  delete RULES[cur.saved.key];
  await persistRules();
  showAddress(cur.addr);
  setState('Đã bỏ lựa chọn đã lưu cho địa chỉ này.');
});
/* ---------- in: tờ A3 (2 mặt) hoặc 4 trang A4 ---------- */
function doPrint(mode) {
  render();
  document.body.classList.add('p' + mode);
  const st = document.createElement('style');
  st.textContent = mode === 'a3' ? '@page{size:A3 landscape;margin:0}' : '@page{size:A4 portrait;margin:0}';
  document.head.appendChild(st);
  let cleaned = false;
  const done = () => { if (cleaned) return; cleaned = true; document.body.classList.remove('pa3', 'pa4'); st.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  done();
}
$('btnPrintA3').addEventListener('click', () => doPrint('a3'));
$('btnPrintA4').addEventListener('click', () => doPrint('a4'));

/* ---------- chuyển mặt, thu phóng ---------- */
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => $('w' + b.dataset.go).scrollIntoView({ block: 'start' })));
let zoom = 1, zoomAuto = true;
function setZoom(z) { zoom = Math.max(0.4, Math.min(1.6, z)); $('sheets').style.zoom = zoom; $('zVal').textContent = Math.round(zoom * 100) + '%'; }
function fitZoom() { zoomAuto = true; setZoom(Math.min(1, (document.querySelector('.stage').clientWidth - 24) / (210 / 25.4 * 96))); }
$('zIn').addEventListener('click', () => { zoomAuto = false; setZoom(zoom + 0.1); });
$('zOut').addEventListener('click', () => { zoomAuto = false; setZoom(zoom - 0.1); });
$('zFit').addEventListener('click', fitZoom);
window.addEventListener('resize', () => { if (zoomAuto) fitZoom(); });
$('btnToday').addEventListener('click', () => {
  const n = new Date(), p = x => String(x).padStart(2, '0');
  $('f_exam').value = p(n.getDate()) + '/' + p(n.getMonth() + 1) + '/' + n.getFullYear(); render();
});
$('btnClear').addEventListener('click', () => {
  document.querySelectorAll('.side input[type=text], .side textarea').forEach(el => { el.value = ''; });
  $('f_gender').value = ''; $('warns').innerHTML = '';
  showAddress(''); markLost(false); render(); setState('Sẵn sàng quét thẻ tiếp theo.'); scan.value = ''; scan.focus({ preventScroll: true });
});
$('btnCopy').addEventListener('click', () => {
  const w = cur.ward != null ? Core.DATA.wards[cur.ward] : null;
  const lines = [
    'Họ và tên: ' + $('f_name').value.toUpperCase(), 'Giới: ' + $('f_gender').value,
    'Ngày sinh: ' + $('f_dob').value + ' (' + $('f_age').value + ' tuổi)',
    'Số CCCD: ' + $('f_cccd').value, 'Cấp ngày: ' + $('f_issue').value + ' tại ' + $('f_place').value,
    'Thường trú (trên thẻ): ' + $('f_old').value, 'Chỗ ở hiện tại: ' + $('f_addr').value
  ];
  if (w) lines.push('Mã xã/phường: ' + w[0] + ' – Mã tỉnh/TP: ' + w[2]);
  const txt = lines.join('\n');
  const done = () => setState('Đã sao chép thông tin.');
  const fallback = () => { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback); else fallback();
});

/* ---------- dữ liệu: nạp, cập nhật, xuất/nhập lựa chọn đã lưu ---------- */
function showInfo(meta, state) {
  const d = Core.DATA;
  $('dVer').textContent = (meta.DatasetVersion || '?') + (meta.GeneratedAt ? ' · ' + meta.GeneratedAt.slice(0, 10).split('-').reverse().join('/') : '') +
    ' · ' + d.wards.length + ' xã/phường, ' + d.prov.length + ' tỉnh/thành';
  $('dCheck').textContent = state && state.lastCheck ? fmtDate(state.lastCheck) : 'chưa kiểm tra';
  $('dMsg').textContent = (state && state.lastResult) || '';
  $('dRules').textContent = Object.keys(RULES).length;
}

async function loadData() {
  const res = await api('/api/data');
  if (!res.ok) throw new Error('máy chủ nội bộ trả lời ' + res.status);
  const j = await res.json();
  Core.setData(Core.buildData(j.main, j.donvi, j.meta || {}));
  if (!Core.DATA.wards.length) throw new Error('dữ liệu địa giới trống');
  RULES = (j.corrections && j.corrections.rules) || {};
  showInfo(j.meta || {}, j.state || {});
  $('ver').textContent = 'Phiên bản chương trình ' + j.app + '.';
  if ($('appVer')) $('appVer').textContent = 'v' + j.app;
  fillWardList(null);
  ready = true;
}

async function checkUpdate(auto) {
  $('btnUpdate').disabled = true;
  if (!auto) $('dMsg').textContent = 'Đang kiểm tra…';
  try {
    const r = await api('/api/update' + (auto ? '?auto=1' : ''), { method: 'POST' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    if (j.updated) {
      await loadData();
      if ($('f_old').value.trim()) showAddress($('f_old').value);
      setState(j.message);
    }
    $('dCheck').textContent = j.state && j.state.lastCheck ? fmtDate(j.state.lastCheck) : 'chưa kiểm tra';
    $('dMsg').textContent = j.message || '';
  } catch (e) { if (!auto) $('dMsg').textContent = 'Không kiểm tra được (' + e.message + ').'; }
  $('btnUpdate').disabled = false;
}
$('btnUpdate').addEventListener('click', () => checkUpdate(false));

$('btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ type: 'quetcccd-lua-chon', version: 1, exportedAt: new Date().toISOString(), rules: RULES }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'QuetCCCD_lua-chon-da-luu_' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
$('btnImport').addEventListener('click', () => $('fileImport').click());
$('fileImport').addEventListener('change', async () => {
  const f = $('fileImport').files[0]; $('fileImport').value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j || typeof j.rules !== 'object' || j.rules === null) throw new Error('không phải file lựa chọn đã lưu');
    const m = Core.mergeRules(RULES, j.rules);
    RULES = m.rules;
    if (await persistRules()) $('dMsg').textContent = 'Đã nhập: thêm ' + m.added + ', thay ' + m.replaced + ' mục mới hơn, giữ nguyên ' + m.kept + '.';
    if ($('f_old').value.trim()) showAddress($('f_old').value);
  } catch (e) { $('dMsg').textContent = 'Không nhập được file: ' + e.message; }
});

/* ---------- giữ chương trình chạy khi cửa sổ còn mở ---------- */
let miss = 0;
setInterval(async () => {
  try { const r = await api('/api/ping'); if (!r.ok) throw 0; miss = 0; $('gone').style.display = 'none'; }
  catch (e) { if (++miss >= 3) $('gone').style.display = 'block'; }
}, 10000);
window.addEventListener('pagehide', () => { try { navigator.sendBeacon('/api/bye?t=' + encodeURIComponent(T)); } catch (e) { /* bỏ qua */ } });

(async function init() {
  render(); fitZoom();
  try {
    await loadData();
    setState('Sẵn sàng. Tắt Unikey (bàn phím tiếng Anh) trước khi quét để không sai dấu.');
    scan.focus();
    if (window.__serAuto) window.__serAuto();
    checkUpdate(true);
  } catch (e) { setState('⚠ Không nạp được dữ liệu: ' + e.message + '. Đóng cửa sổ và mở lại chương trình.'); }
})();
