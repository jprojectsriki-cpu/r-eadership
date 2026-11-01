/**
 * R-eadership API - 応募（エントリー）と指導記録
 * - 見る・追加・変更・削除：学校管理者と、その学生の担当の教員
 * - 選考の段階は順番どおりでなくてよい（二次面接がない会社は、一次面接から最終面接へ進めてよい）
 *   段階や結果を変えるたびに「選考の履歴」に残し、その会社で実際に通った段階を表示できるようにする
 * - 結果：選考中／内定／内定承諾（就職先の決定。1人1社まで）／不採用／辞退
 * - 学生の「状況」は応募から自動で決める：
 *   内定承諾あり → 就職先決定、内定あり → 内定、選考中あり → 選考中、応募はあるが全部終わった → 選考終了、応募なし → 未着手
 * - 指導記録：担当の教員ならだれでも追加できる。書き直し・削除は、書いた本人と学校管理者だけ
 */

const STAGES = ['エントリー', '書類選考', '筆記・適性検査', '一次面接', '二次面接', '最終面接'];
const RESULTS = ['選考中', '内定', '内定承諾', '不採用', '辞退'];
const MAX_RECORD_LEN = 2000;

// 応募シートの列（0から数える）
const EN = {
  id: 0, student: 1, company: 2, job: 3, place: 4, salary: 5, stage: 6, result: 7, applied: 8,
  nextDate: 9, nextTime: 10, nextNote: 11, memo: 12, created: 13, updated: 14, by: 15
};
// 指導記録シートの列
const RC = { id: 0, student: 1, entry: 2, date: 3, content: 4, by: 5, created: 6 };

function dateText_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}
function timeText_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Tokyo', 'HH:mm');
  return String(v == null ? '' : v).trim();
}

function entryFromRow_(r) {
  return {
    id: String(r[EN.id]).trim(),
    studentId: String(r[EN.student]).trim(),
    company: String(r[EN.company]).trim(),
    job: String(r[EN.job]).trim(),
    place: String(r[EN.place]).trim(),
    salary: String(r[EN.salary]).trim(),
    stage: String(r[EN.stage]).trim() || STAGES[0],
    result: String(r[EN.result]).trim() || RESULTS[0],
    applied: dateText_(r[EN.applied]),
    nextDate: dateText_(r[EN.nextDate]),
    nextTime: timeText_(r[EN.nextTime]),
    nextNote: String(r[EN.nextNote]).trim(),
    memo: String(r[EN.memo] == null ? '' : r[EN.memo]),
    updatedAt: String(r[EN.updated] || ''),
    updatedBy: String(r[EN.by] || '')
  };
}

function recordFromRow_(r) {
  return {
    id: String(r[RC.id]).trim(),
    studentId: String(r[RC.student]).trim(),
    entryId: String(r[RC.entry]).trim(),
    date: dateText_(r[RC.date]),
    content: String(r[RC.content] == null ? '' : r[RC.content]),
    by: String(r[RC.by]).trim(),
    createdAt: String(r[RC.created] || '')
  };
}

/** 日付（yyyy-MM-dd）を確かめる。空はOK */
function cleanDate_(v, label) {
  const s = String(v == null ? '' : v).trim().replace(/\//g, '-');
  if (!s) return { value: '' };
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const d = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!m || d.getMonth() !== Number(m[2]) - 1) return { error: label + 'は「2026-11-01」のように入力してください。' };
  return { value: m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0') };
}
/** 時刻（HH:mm）を確かめる。空はOK */
function cleanTime_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return { value: '' };
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: '時刻は「10:00」のように入力してください。' };
  return { value: String(m[1]).padStart(2, '0') + ':' + m[2] };
}

/** 学生IDから、その学生を扱えるかを確かめる（学生の情報も返す） */
function studentFor_(user, studentId) {
  const rows = readRows_(SHEETS.students);
  const i = findStudentIndex_(rows, studentId);
  if (i < 0) return { error: 'この学生は見つかりません。画面を読み込み直してください。' };
  const st = studentFromRow_(rows[i]);
  if (!canHandle_(user, st)) return { error: 'この学生は、あなたの担当クラスではありません。' };
  return { student: st, index: i, rows: rows };
}

/** 学生の「状況」を、応募から決めなおして書きこむ */
function refreshJobStatus_(studentId) {
  const list = readRows_(SHEETS.entries).filter(function (r) { return String(r[EN.student]).trim() === studentId; })
    .map(function (r) { return String(r[EN.result]).trim() || '選考中'; });
  let job = '未着手';
  if (list.indexOf('内定承諾') >= 0) job = '就職先決定';
  else if (list.indexOf('内定') >= 0) job = '内定';
  else if (list.indexOf('選考中') >= 0) job = '選考中';
  else if (list.length) job = '選考終了';
  const rows = readRows_(SHEETS.students);
  const i = findStudentIndex_(rows, studentId);
  if (i >= 0 && String(rows[i][ST.job]).trim() !== job) getSheet_(SHEETS.students.name).getRange(i + 2, ST.job + 1).setValue(job);
  return job;
}

/** 選考の履歴を1行足す */
function addEntryLog_(studentId, entryId, stage, result, teacherId) {
  const id = nextId_(readRows_(SHEETS.entryLogs), 'L');
  getSheet_(SHEETS.entryLogs.name).appendRow([id, studentId, entryId, nowText_(), stage, result, teacherId]);
}

/* =========================================================
 * 応募
 * ========================================================= */

/** 応募の一覧（学校管理者はすべて、教員は担当クラスの学生の分だけ） */
function listEntries_(token) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  const visible = {};
  readRows_(SHEETS.students).forEach(function (r) {
    const st = studentFromRow_(r);
    if (st.id && canHandle_(s.user, st)) visible[st.id] = true;
  });
  const entries = readRows_(SHEETS.entries)
    .filter(function (r) { return visible[String(r[EN.student]).trim()]; })
    .map(entryFromRow_);
  return { ok: true, entries: entries, today: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd') };
}

/** 1件の応募の、選考の履歴と指導記録 */
function entryDetail_(token, entryId) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  const rows = readRows_(SHEETS.entries);
  const i = indexOfId_(rows, String(entryId || '').trim());
  if (i < 0) return { ok: false, message: 'この応募は見つかりません。画面を読み込み直してください。' };
  const e = entryFromRow_(rows[i]);
  const f = studentFor_(s.user, e.studentId);
  if (f.error) return { ok: false, message: f.error };
  const logs = readRows_(SHEETS.entryLogs).filter(function (r) { return String(r[2]).trim() === e.id; })
    .map(function (r) { return { at: String(r[3]), stage: String(r[4]), result: String(r[5]), by: String(r[6]) }; });
  const records = readRows_(SHEETS.records).filter(function (r) { return String(r[RC.entry]).trim() === e.id; }).map(recordFromRow_).reverse();
  return { ok: true, entry: e, logs: logs, records: records };
}

/** 応募の追加・会社などの情報の変更。item.id があれば変更、なければ追加 */
function saveEntry_(token, item) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  item = item || {};
  const company = cleanText_(item.company, MAX_NAME_LEN);
  const job = cleanText_(item.job, MAX_NAME_LEN);
  const place = cleanText_(item.place, MAX_NAME_LEN);
  const salary = cleanText_(item.salary, MAX_NAME_LEN);
  const memo = String(item.memo == null ? '' : item.memo).replace(/\r\n?/g, '\n').trim().slice(0, MAX_MEMO_LEN);
  const applied = cleanDate_(item.applied, '応募日');
  if (!company) return { ok: false, message: '会社名を入力してください。' };
  if (applied.error) return { ok: false, message: applied.error };

  return withLock_(function () {
    const sheet = getSheet_(SHEETS.entries.name);
    const rows = readRows_(SHEETS.entries);
    const now = nowText_();
    const id = String(item.id || '').trim();
    if (id) {
      const i = indexOfId_(rows, id);
      if (i < 0) return { ok: false, message: 'この応募は見つかりません。画面を読み込み直してください。' };
      const r = rows[i];
      const f = studentFor_(s.user, String(r[EN.student]).trim());
      if (f.error) return { ok: false, message: f.error };
      r[EN.company] = company; r[EN.job] = job; r[EN.place] = place; r[EN.salary] = salary;
      r[EN.applied] = applied.value; r[EN.memo] = memo; r[EN.updated] = now; r[EN.by] = s.user.teacherId;
      sheet.getRange(i + 2, 1, 1, r.length).setValues([r]);
      return { ok: true, item: entryFromRow_(r), message: '応募の情報を変更しました。' };
    }
    const f = studentFor_(s.user, item.studentId);
    if (f.error) return { ok: false, message: f.error };
    const dup = rows.some(function (r) {
      return String(r[EN.student]).trim() === f.student.id && String(r[EN.company]).trim() === company && String(r[EN.result]).trim() === '選考中';
    });
    if (dup) return { ok: false, message: f.student.name + 'さんは「' + company + '」に、すでに選考中の応募があります。' };
    const row = new Array(SHEETS.entries.headers.length).fill('');
    row[EN.id] = nextId_(rows, 'E'); row[EN.student] = f.student.id; row[EN.company] = company; row[EN.job] = job;
    row[EN.place] = place; row[EN.salary] = salary; row[EN.stage] = STAGES[0]; row[EN.result] = RESULTS[0];
    row[EN.applied] = applied.value || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    row[EN.memo] = memo; row[EN.created] = now; row[EN.updated] = now; row[EN.by] = s.user.teacherId;
    sheet.appendRow(row);
    addEntryLog_(f.student.id, row[EN.id], row[EN.stage], row[EN.result], s.user.teacherId);
    const jobStatus = refreshJobStatus_(f.student.id);
    return { ok: true, item: entryFromRow_(row), jobStatus: jobStatus, message: '応募を登録しました。' };
  });
}

/** 選考の進み具合（段階・結果・次の予定）の更新 */
function updateEntryProgress_(token, entryId, p) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  p = p || {};
  const stage = String(p.stage || '').trim();
  const result = String(p.result || '').trim();
  const nextDate = cleanDate_(p.nextDate, '次の予定日');
  const nextTime = cleanTime_(p.nextTime);
  const nextNote = cleanText_(p.nextNote, MAX_NAME_LEN);
  if (STAGES.indexOf(stage) < 0) return { ok: false, message: '選考の段階を選んでください。' };
  if (RESULTS.indexOf(result) < 0) return { ok: false, message: '結果を選んでください。' };
  // 次の予定は「選考中」のときだけ使う（それ以外では消すので、確かめない）
  if (result === '選考中') {
    if (nextDate.error) return { ok: false, message: nextDate.error };
    if (nextTime.error) return { ok: false, message: nextTime.error };
    if (nextTime.value && !nextDate.value) return { ok: false, message: '時刻を入れるときは、次の予定日も入れてください。' };
  }

  return withLock_(function () {
    const sheet = getSheet_(SHEETS.entries.name);
    const rows = readRows_(SHEETS.entries);
    const i = indexOfId_(rows, String(entryId || '').trim());
    if (i < 0) return { ok: false, message: 'この応募は見つかりません。画面を読み込み直してください。' };
    const r = rows[i];
    const studentId = String(r[EN.student]).trim();
    const f = studentFor_(s.user, studentId);
    if (f.error) return { ok: false, message: f.error };
    // 内定承諾（就職先の決定）は1人1社まで
    if (result === '内定承諾') {
      const other = rows.find(function (x, k) { return k !== i && String(x[EN.student]).trim() === studentId && String(x[EN.result]).trim() === '内定承諾'; });
      if (other) return { ok: false, message: f.student.name + 'さんは、すでに「' + String(other[EN.company]).trim() + '」で内定承諾しています。先にそちらの結果を変えてください。' };
    }
    const changed = String(r[EN.stage]).trim() !== stage || String(r[EN.result]).trim() !== result;
    const done = result !== '選考中';
    r[EN.stage] = stage; r[EN.result] = result;
    // 選考が終わったら、次の予定は消す
    r[EN.nextDate] = done ? '' : nextDate.value;
    r[EN.nextTime] = done ? '' : nextTime.value;
    r[EN.nextNote] = done ? '' : nextNote;
    r[EN.updated] = nowText_(); r[EN.by] = s.user.teacherId;
    sheet.getRange(i + 2, 1, 1, r.length).setValues([r]);
    if (changed) addEntryLog_(studentId, String(r[EN.id]).trim(), stage, result, s.user.teacherId);
    const jobStatus = refreshJobStatus_(studentId);
    return { ok: true, item: entryFromRow_(r), jobStatus: jobStatus, message: '選考の進み具合を更新しました。' };
  });
}

/** 応募の削除（その応募の選考の履歴も消す。応募につけた指導記録は、学生の記録として残す） */
function deleteEntry_(token, entryId) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  return withLock_(function () {
    const rows = readRows_(SHEETS.entries);
    const id = String(entryId || '').trim();
    const i = indexOfId_(rows, id);
    if (i < 0) return { ok: false, message: 'この応募は見つかりません。画面を読み込み直してください。' };
    const studentId = String(rows[i][EN.student]).trim();
    const f = studentFor_(s.user, studentId);
    if (f.error) return { ok: false, message: f.error };
    getSheet_(SHEETS.entries.name).deleteRow(i + 2);
    const logs = readRows_(SHEETS.entryLogs);
    for (let k = logs.length - 1; k >= 0; k--) {
      if (String(logs[k][2]).trim() === id) getSheet_(SHEETS.entryLogs.name).deleteRow(k + 2);
    }
    const recSheet = getSheet_(SHEETS.records.name);
    readRows_(SHEETS.records).forEach(function (r, k) {
      if (String(r[RC.entry]).trim() === id) recSheet.getRange(k + 2, RC.entry + 1).setValue('');
    });
    const jobStatus = refreshJobStatus_(studentId);
    return { ok: true, jobStatus: jobStatus, studentId: studentId, message: '応募を削除しました。' };
  });
}

/* =========================================================
 * 指導記録
 * ========================================================= */

/** 学生の指導記録（新しい順） */
function listRecords_(token, studentId) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  const f = studentFor_(s.user, studentId);
  if (f.error) return { ok: false, message: f.error };
  const records = readRows_(SHEETS.records).filter(function (r) { return String(r[RC.student]).trim() === f.student.id; })
    .map(recordFromRow_)
    .sort(function (a, b) { return (b.date + b.createdAt).localeCompare(a.date + a.createdAt); });
  const entries = readRows_(SHEETS.entries).filter(function (r) { return String(r[EN.student]).trim() === f.student.id; }).map(entryFromRow_);
  return { ok: true, records: records, entries: entries };
}

/** 指導記録の追加・書き直し。item.id があれば書き直し（書いた本人と学校管理者だけ） */
function saveRecord_(token, item) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  item = item || {};
  const content = String(item.content == null ? '' : item.content).replace(/\r\n?/g, '\n').trim().slice(0, MAX_RECORD_LEN);
  const date = cleanDate_(item.date, '日付');
  if (!content) return { ok: false, message: '内容を入力してください。' };
  if (date.error) return { ok: false, message: date.error };

  return withLock_(function () {
    const sheet = getSheet_(SHEETS.records.name);
    const rows = readRows_(SHEETS.records);
    const id = String(item.id || '').trim();
    let studentId = String(item.studentId || '').trim();
    let i = -1;
    if (id) {
      i = indexOfId_(rows, id);
      if (i < 0) return { ok: false, message: 'この記録は見つかりません。画面を読み込み直してください。' };
      studentId = String(rows[i][RC.student]).trim();
      const author = String(rows[i][RC.by]).trim().toLowerCase();
      if (s.user.role !== 'admin' && author !== s.user.teacherId.toLowerCase()) return { ok: false, message: 'ほかの先生が書いた記録は書き直せません。' };
    }
    const f = studentFor_(s.user, studentId);
    if (f.error) return { ok: false, message: f.error };
    const entryId = String(item.entryId || '').trim();
    if (entryId) {
      const e = readRows_(SHEETS.entries).find(function (r) { return String(r[EN.id]).trim() === entryId; });
      if (!e || String(e[EN.student]).trim() !== f.student.id) return { ok: false, message: '選んだ応募が見つかりません。' };
    }
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    if (id) {
      const r = rows[i];
      r[RC.entry] = entryId; r[RC.date] = date.value || today; r[RC.content] = content;
      sheet.getRange(i + 2, 1, 1, r.length).setValues([r]);
      return { ok: true, item: recordFromRow_(r), message: '指導記録を書き直しました。' };
    }
    const row = [nextId_(rows, 'R'), f.student.id, entryId, date.value || today, content, s.user.teacherId, nowText_()];
    sheet.appendRow(row);
    return { ok: true, item: recordFromRow_(row), message: '指導記録を追加しました。' };
  });
}

/** 指導記録の削除（書いた本人と学校管理者だけ） */
function deleteRecord_(token, recordId) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  return withLock_(function () {
    const rows = readRows_(SHEETS.records);
    const i = indexOfId_(rows, String(recordId || '').trim());
    if (i < 0) return { ok: false, message: 'この記録は見つかりません。画面を読み込み直してください。' };
    const f = studentFor_(s.user, String(rows[i][RC.student]).trim());
    if (f.error) return { ok: false, message: f.error };
    if (s.user.role !== 'admin' && String(rows[i][RC.by]).trim().toLowerCase() !== s.user.teacherId.toLowerCase()) {
      return { ok: false, message: 'ほかの先生が書いた記録は削除できません。' };
    }
    getSheet_(SHEETS.records.name).deleteRow(i + 2);
    return { ok: true, message: '指導記録を削除しました。' };
  });
}
