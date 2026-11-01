/**
 * R-eadership API - お知らせ（連絡・要望・意見）
 * - 学校管理者も一般の教員も投稿できる
 * - 公開範囲：全体（すべての教員）／学校管理者／個人（宛先の教員を何人でも選べる）
 *   見えるのは、公開範囲に入る人と、投稿した本人だけ（「個人」は、学校管理者でも宛先に入っていなければ見えない）
 * - 一般の教員からの要望・意見は、公開範囲「学校管理者」で送る
 * - 返信：その投稿が見える人ならだれでも。返信の削除は、書いた本人と学校管理者
 * - 既読：詳しい画面を開くと既読になる。新しい返信がつくと、ほかの人にはまた「未読」になる
 *   投稿した本人は、だれが読んだかを見られる
 * - 投稿の書き直しは本人だけ。削除は本人と学校管理者（学校管理者は、見える投稿だけ）
 */

const AUDIENCES = { all: '全体', admin: '学校管理者', people: '個人' };
const MAX_NOTICE_BODY = 3000;
// お知らせシートの列（0から数える）
/** 秒まで入れた日時（既読と書きこみの前後を正しく比べるため） */
function nowSec_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}

const NT = { id: 0, title: 1, body: 2, important: 3, audience: 4, to: 5, by: 6, created: 7, updated: 8, lastBy: 9 };

function audienceKey_(label) {
  const keys = Object.keys(AUDIENCES);
  for (let i = 0; i < keys.length; i++) if (AUDIENCES[keys[i]] === label) return keys[i];
  return 'all';
}

/** 教員ID → { name, role, active } の表 */
function teacherMap_() {
  const map = {};
  readRows_(SHEETS.teachers).forEach(function (r) {
    const id = String(r[0]).trim();
    if (id) map[id.toLowerCase()] = { id: id, name: String(r[3]).trim(), role: String(r[4]).trim() === ROLE_ADMIN ? 'admin' : 'teacher', active: String(r[6]).trim() !== STATUS_STOPPED };
  });
  return map;
}

function noticeFromRow_(r, teachers) {
  const nameOf = function (id) { const t = teachers[String(id).toLowerCase()]; return t ? t.name : String(id); };
  const to = String(r[NT.to]).split(',').map(function (x) { return x.trim(); }).filter(String);
  return {
    id: String(r[NT.id]).trim(),
    title: String(r[NT.title]).trim(),
    body: String(r[NT.body] == null ? '' : r[NT.body]),
    important: String(r[NT.important]).trim() === '重要',
    audience: audienceKey_(String(r[NT.audience]).trim()),
    to: to,
    toNames: to.map(nameOf),
    by: String(r[NT.by]).trim(),
    byName: nameOf(r[NT.by]),
    createdAt: String(r[NT.created] || ''),
    updatedAt: String(r[NT.updated] || ''),
    lastBy: String(r[NT.lastBy] || '').trim()
  };
}

/** この人に、このお知らせが見えるか */
function canSeeNotice_(user, n) {
  const me = user.teacherId.toLowerCase();
  if (n.by.toLowerCase() === me) return true;
  if (n.audience === 'all') return true;
  if (n.audience === 'admin') return user.role === 'admin';
  return n.to.some(function (t) { return t.toLowerCase() === me; });
}

/** 既読の表：「お知らせID|教員ID（小文字）」→ 既読日時 */
function readMap_() {
  const map = {};
  readRows_(SHEETS.noticeReads).forEach(function (r) { map[String(r[0]).trim() + '|' + String(r[1]).trim().toLowerCase()] = String(r[2]); });
  return map;
}

/** 未読か（最後の書きこみが自分でなく、そのあとに読んでいない） */
function isUnread_(n, user, reads) {
  const me = user.teacherId.toLowerCase();
  if ((n.lastBy || n.by).toLowerCase() === me) return false;
  const at = reads[n.id + '|' + me];
  return !at || at < n.updatedAt;
}

/** 見えるお知らせの一覧（新しい順）と、未読の数 */
function listNotices_(token) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  const teachers = teacherMap_();
  const reads = readMap_();
  const replies = {};
  readRows_(SHEETS.noticeReplies).forEach(function (r) { const k = String(r[1]).trim(); replies[k] = (replies[k] || 0) + 1; });
  const list = readRows_(SHEETS.notices).filter(function (r) { return String(r[NT.id]).trim(); })
    .map(function (r) { return noticeFromRow_(r, teachers); })
    .filter(function (n) { return canSeeNotice_(s.user, n); })
    .map(function (n) { n.unread = isUnread_(n, s.user, reads); n.replyCount = replies[n.id] || 0; n.body = n.body.slice(0, 120); return n; })
    .sort(function (a, b) { return b.updatedAt.localeCompare(a.updatedAt); });
  return { ok: true, notices: list, unread: list.filter(function (n) { return n.unread; }).length };
}

/** 未読の数だけ（メニューの数字に使う） */
function unreadNotices_(token) {
  const r = listNotices_(token);
  if (!r.ok) return r;
  return { ok: true, unread: r.unread };
}

/** 宛先に選べる教員（利用中の教員。自分はのぞく） */
function teacherDirectory_(token) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  const me = s.user.teacherId.toLowerCase();
  const list = Object.keys(teacherMap_()).map(function (k) { return teacherMap_()[k]; });
  return {
    ok: true,
    teachers: list.filter(function (t) { return t.active && t.id.toLowerCase() !== me; })
      .map(function (t) { return { id: t.id, name: t.name, role: t.role }; })
      .sort(function (a, b) { return (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1) || a.name.localeCompare(b.name, 'ja'); })
  };
}

/** 1件のお知らせ（本文・返信・既読の人）。開いたら既読にする */
function noticeDetail_(token, id) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  const teachers = teacherMap_();
  const rows = readRows_(SHEETS.notices);
  const i = indexOfId_(rows, String(id || '').trim());
  if (i < 0) return { ok: false, message: 'このお知らせは見つかりません。削除された可能性があります。' };
  const n = noticeFromRow_(rows[i], teachers);
  if (!canSeeNotice_(s.user, n)) return { ok: false, message: 'このお知らせは見られません。' };
  const nameOf = function (tid) { const t = teachers[String(tid).toLowerCase()]; return t ? t.name : String(tid); };
  const replies = readRows_(SHEETS.noticeReplies).filter(function (r) { return String(r[1]).trim() === n.id; })
    .map(function (r) { return { id: String(r[0]).trim(), body: String(r[2]), by: String(r[3]).trim(), byName: nameOf(r[3]), at: String(r[4]) }; });

  // 既読にする
  withLock_(function () {
    const sheet = getSheet_(SHEETS.noticeReads.name);
    const all = readRows_(SHEETS.noticeReads);
    const me = s.user.teacherId.toLowerCase();
    const k = all.findIndex(function (r) { return String(r[0]).trim() === n.id && String(r[1]).trim().toLowerCase() === me; });
    const now = nowSec_();
    if (k >= 0) sheet.getRange(k + 2, 3).setValue(now); else sheet.appendRow([n.id, s.user.teacherId, now]);
  });

  // 投稿した本人には、だれが読んだかを見せる
  let readers = null;
  if (n.by.toLowerCase() === s.user.teacherId.toLowerCase()) {
    const reads = readMap_();
    let audience;
    if (n.audience === 'people') audience = n.to;
    else audience = Object.keys(teachers).map(function (k) { return teachers[k]; })
      .filter(function (t) { return t.active && (n.audience === 'all' || t.role === 'admin'); }).map(function (t) { return t.id; });
    readers = audience.filter(function (t) { return t.toLowerCase() !== n.by.toLowerCase(); }).map(function (t) {
      const at = reads[n.id + '|' + t.toLowerCase()] || '';
      return { id: t, name: nameOf(t), readAt: at };
    });
  }
  return { ok: true, notice: n, replies: replies, readers: readers };
}

/** 投稿・書き直し（書き直しは本人だけ） */
function saveNotice_(token, item) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  item = item || {};
  const title = cleanText_(item.title, MAX_NAME_LEN);
  const body = String(item.body == null ? '' : item.body).replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTICE_BODY);
  const audience = AUDIENCES[item.audience] ? item.audience : '';
  if (!title) return { ok: false, message: 'タイトルを入力してください。' };
  if (!body) return { ok: false, message: '本文を入力してください。' };
  if (!audience) return { ok: false, message: '公開範囲を選んでください。' };
  const teachers = teacherMap_();
  let to = [];
  if (audience === 'people') {
    to = (Array.isArray(item.to) ? item.to : []).map(function (x) { return String(x).trim(); })
      .filter(function (x, i, a) { return x && a.indexOf(x) === i && x.toLowerCase() !== s.user.teacherId.toLowerCase(); });
    if (!to.length) return { ok: false, message: '宛先の先生を選んでください。' };
    if (to.some(function (t) { return !teachers[t.toLowerCase()]; })) return { ok: false, message: '見つからない先生がいます。画面を読み込み直してください。' };
  }

  return withLock_(function () {
    const sheet = getSheet_(SHEETS.notices.name);
    const rows = readRows_(SHEETS.notices);
    const now = nowSec_();
    const id = String(item.id || '').trim();
    if (id) {
      const i = indexOfId_(rows, id);
      if (i < 0) return { ok: false, message: 'このお知らせは見つかりません。' };
      if (String(rows[i][NT.by]).trim().toLowerCase() !== s.user.teacherId.toLowerCase()) return { ok: false, message: 'ほかの先生の投稿は書き直せません。' };
      const r = rows[i];
      r[NT.title] = title; r[NT.body] = body; r[NT.important] = item.important ? '重要' : '通常';
      r[NT.audience] = AUDIENCES[audience]; r[NT.to] = to.join(','); r[NT.updated] = now; r[NT.lastBy] = s.user.teacherId;
      sheet.getRange(i + 2, 1, 1, r.length).setValues([r]);
      return { ok: true, item: noticeFromRow_(r, teachers), message: 'お知らせを書き直しました。' };
    }
    const row = [nextId_(rows, 'N'), title, body, item.important ? '重要' : '通常', AUDIENCES[audience], to.join(','), s.user.teacherId, now, now, s.user.teacherId];
    sheet.appendRow(row);
    return { ok: true, item: noticeFromRow_(row, teachers), message: 'お知らせを投稿しました。' };
  });
}

/** 削除（本人と、見えている学校管理者）。返信と既読もいっしょに消す */
function deleteNotice_(token, id) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  return withLock_(function () {
    const teachers = teacherMap_();
    const rows = readRows_(SHEETS.notices);
    const i = indexOfId_(rows, String(id || '').trim());
    if (i < 0) return { ok: false, message: 'このお知らせは見つかりません。' };
    const n = noticeFromRow_(rows[i], teachers);
    const mine = n.by.toLowerCase() === s.user.teacherId.toLowerCase();
    if (!mine && !(s.user.role === 'admin' && canSeeNotice_(s.user, n))) return { ok: false, message: 'ほかの先生の投稿は削除できません。' };
    getSheet_(SHEETS.notices.name).deleteRow(i + 2);
    [SHEETS.noticeReplies, SHEETS.noticeReads].forEach(function (def) {
      const col = def === SHEETS.noticeReplies ? 1 : 0;
      const all = readRows_(def);
      for (let k = all.length - 1; k >= 0; k--) if (String(all[k][col]).trim() === n.id) getSheet_(def.name).deleteRow(k + 2);
    });
    return { ok: true, message: 'お知らせを削除しました。' };
  });
}

/** 返信（見える人ならだれでも）。お知らせの更新日時を新しくして、ほかの人に未読にする */
function replyNotice_(token, id, body) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  body = String(body == null ? '' : body).replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTICE_BODY);
  if (!body) return { ok: false, message: '返信を入力してください。' };
  return withLock_(function () {
    const teachers = teacherMap_();
    const rows = readRows_(SHEETS.notices);
    const i = indexOfId_(rows, String(id || '').trim());
    if (i < 0) return { ok: false, message: 'このお知らせは見つかりません。' };
    const n = noticeFromRow_(rows[i], teachers);
    if (!canSeeNotice_(s.user, n)) return { ok: false, message: 'このお知らせには返信できません。' };
    const now = nowSec_();
    getSheet_(SHEETS.noticeReplies.name).appendRow([nextId_(readRows_(SHEETS.noticeReplies), 'P'), n.id, body, s.user.teacherId, now]);
    getSheet_(SHEETS.notices.name).getRange(i + 2, NT.updated + 1, 1, 2).setValues([[now, s.user.teacherId]]);
    return { ok: true, message: '返信しました。' };
  });
}

/** 返信の削除（書いた本人と学校管理者） */
function deleteReply_(token, replyId) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  return withLock_(function () {
    const rows = readRows_(SHEETS.noticeReplies);
    const i = indexOfId_(rows, String(replyId || '').trim());
    if (i < 0) return { ok: false, message: 'この返信は見つかりません。' };
    if (s.user.role !== 'admin' && String(rows[i][3]).trim().toLowerCase() !== s.user.teacherId.toLowerCase()) return { ok: false, message: 'ほかの先生の返信は削除できません。' };
    getSheet_(SHEETS.noticeReplies.name).deleteRow(i + 2);
    return { ok: true, message: '返信を削除しました。' };
  });
}
