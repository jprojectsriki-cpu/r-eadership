/**
 * R-eadership API - 学生名簿
 * - 見る：学校管理者はすべての学生、教員は担当クラスの学生だけ
 * - 基本情報（学籍番号・名前・ふりがな・卒業予定年度）の登録・変更・削除、CSVでのまとめて登録：学校管理者だけ
 * - クラスの移動・在籍状態の変更：学校管理者と、その学生の担当の教員。理由は必須で、変更履歴に残す
 * - 取得資格・メモ：学校管理者と、その学生の担当の教員
 * - 卒業予定年度は、入れなければ クラスの学年と学科の修業年限から自動で決める（年度は4月はじまり）
 */

const ENROLL_STATUSES = ['在籍', '休学', '退学', '除籍', '卒業'];
const JOB_STATUS_DEFAULT = '未着手';
const MAX_REASON_LEN = 200;
const MAX_MEMO_LEN = 1000;
const MAX_IMPORT_ROWS = 500;

// 学生シートの列（0から数える）
const ST = { id: 0, no: 1, name: 2, kana: 3, cls: 4, grad: 5, enroll: 6, job: 7, quals: 8, memo: 9, created: 10, updated: 11 };

function studentFromRow_(r) {
  return {
    id: String(r[ST.id]).trim(),
    studentNo: String(r[ST.no]).trim(),
    name: String(r[ST.name]).trim(),
    kana: String(r[ST.kana]).trim(),
    classCode: String(r[ST.cls]).trim(),
    gradYear: String(r[ST.grad]).trim(),
    enroll: String(r[ST.enroll]).trim() || '在籍',
    job: String(r[ST.job]).trim() || JOB_STATUS_DEFAULT,
    quals: String(r[ST.quals]).split(',').map(function (x) { return x.trim(); }).filter(String),
    memo: String(r[ST.memo]),
    updatedAt: r[ST.updated] instanceof Date ? Utilities.formatDate(r[ST.updated], 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') : String(r[ST.updated] || '')
  };
}

/** いまの年度（4月はじまり） */
function currentFiscalYear_() {
  const now = new Date();
  const y = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy'));
  const m = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'M'));
  return m >= 4 ? y : y - 1;
}

/** クラスの学年と学科の修業年限から、卒業予定年度を決める（例：2年制の1年生、2026年度 → 2027年度） */
function autoGradYear_(classInfo) {
  if (!classInfo || !classInfo.years || !classInfo.grade) return '';
  return String(currentFiscalYear_() + classInfo.years - classInfo.grade);
}

/** クラスコード → { code, name, label, grade, years } の表 */
function classMap_() {
  const years = {};
  readRows_(SHEETS.departments).forEach(function (r) { years[String(r[0]).trim()] = Number(r[3]) || 0; });
  const map = {};
  readRows_(SHEETS.classes).forEach(function (r) {
    const c = classFromRow_(r);
    if (!c.code) return;
    c.years = years[c.deptId] || 0;
    map[c.code] = c;
  });
  return map;
}

/**
 * クラスの学年・学科の修業年限が変わったとき、そのクラスの学生の卒業予定年度を自動で直す
 * - 直すのは、いまの卒業予定年度が「変更前のクラスで自動計算した年度」と同じ学生だけ
 *   （留年などで学校管理者が手で直した学生は、そのままにする）
 * - 直したら変更履歴に残す。戻り値は画面に出す一言（直した人がいなければ空）
 * ※ withLock_ の中から呼ぶこと
 */
function recalcGradYears_(classCodes, before, after, teacherId, reason) {
  if (!classCodes.length) return '';
  const sheet = getSheet_(SHEETS.students.name);
  const rows = readRows_(SHEETS.students);
  const now = nowText_();
  let changed = 0;
  let kept = 0;
  rows.forEach(function (r, i) {
    const code = String(r[ST.cls]).trim();
    if (classCodes.indexOf(code) < 0) return;
    const current = String(r[ST.grad]).trim();
    const oldAuto = autoGradYear_(before[code]);
    const newAuto = autoGradYear_(after[code]);
    if (!newAuto || current === newAuto) return;
    if (current && current !== oldAuto) { kept++; return; }
    sheet.getRange(i + 2, ST.grad + 1).setValue(newAuto);
    sheet.getRange(i + 2, ST.updated + 1).setValue(now);
    addStudentLog_(String(r[ST.id]).trim(), '卒業予定年度', current || '（なし）', newAuto, reason + 'による自動更新', teacherId);
    changed++;
  });
  if (!changed && !kept) return '';
  return '学生の卒業予定年度を ' + changed + '人分、自動で直しました。' + (kept ? '（手で直してある ' + kept + '人は、そのままにしました）' : '');
}

/** その学生を、この人が扱えるか（学校管理者はすべて、教員は担当クラスの学生だけ） */
function canHandle_(user, student) {
  return user.role === 'admin' || (user.classes || []).indexOf(student.classCode) >= 0;
}

/** 卒業予定年度の形を確かめる（空はOK） */
function cleanYear_(v) {
  const s = String(v == null ? '' : v).trim().replace(/年度$/, '');
  if (!s) return { value: '' };
  if (!/^\d{4}$/.test(s) || Number(s) < 2000 || Number(s) > 2100) return { error: '卒業予定年度は「2027」のように4けたの年で入力してください。' };
  return { value: s };
}

/** 変更履歴を1行足す */
function addStudentLog_(studentId, field, before, after, reason, teacherId) {
  const sheet = getSheet_(SHEETS.studentLogs.name);
  const id = nextId_(readRows_(SHEETS.studentLogs), 'H');
  sheet.appendRow([id, studentId, nowText_(), field, before, after, reason, teacherId]);
}

/** 学生を探す（rows の何番目か） */
function findStudentIndex_(rows, id) {
  return rows.findIndex(function (r) { return String(r[ST.id]).trim() === String(id || '').trim(); });
}

/* =========================================================
 * 一覧・履歴
 * ========================================================= */

/** 学生の一覧（学校管理者はすべて、教員は担当クラスだけ） */
function listStudents_(token) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  const list = readRows_(SHEETS.students)
    .filter(function (r) { return String(r[ST.id]).trim(); })
    .map(studentFromRow_)
    .filter(function (st) { return canHandle_(s.user, st); });
  return { ok: true, students: list, fiscalYear: currentFiscalYear_() };
}

/** その学生の変更履歴（新しい順） */
function studentLogs_(token, studentId) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  const rows = readRows_(SHEETS.students);
  const i = findStudentIndex_(rows, studentId);
  if (i < 0) return { ok: false, message: 'この学生は見つかりません。画面を読み込み直してください。' };
  if (!canHandle_(s.user, studentFromRow_(rows[i]))) return { ok: false, message: 'この学生の情報は見られません。' };
  const logs = readRows_(SHEETS.studentLogs)
    .filter(function (r) { return String(r[1]).trim() === String(studentId).trim(); })
    .map(function (r) {
      return { at: String(r[2]), field: String(r[3]), before: String(r[4]), after: String(r[5]), reason: String(r[6]), by: String(r[7]) };
    })
    .reverse();
  return { ok: true, logs: logs };
}

/* =========================================================
 * 学校管理者：登録・変更・削除
 * ========================================================= */

/** 学生の登録・基本情報の変更（学校管理者だけ）。item.id があれば変更、なければ登録 */
function saveStudent_(token, item) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  item = item || {};
  const studentNo = cleanText_(item.studentNo, 20);
  const name = cleanText_(item.name, MAX_NAME_LEN);
  const kana = cleanText_(item.kana, MAX_NAME_LEN);
  const year = cleanYear_(item.gradYear);
  if (!studentNo) return { ok: false, message: '学籍番号を入力してください。' };
  if (!name) return { ok: false, message: '名前を入力してください。' };
  if (year.error) return { ok: false, message: year.error };

  return withLock_(function () {
    const sheet = getSheet_(SHEETS.students.name);
    const rows = readRows_(SHEETS.students);
    const id = String(item.id || '').trim();
    const dup = rows.some(function (r) { return String(r[ST.id]).trim() !== id && String(r[ST.no]).trim() === studentNo; });
    if (dup) return { ok: false, message: '学籍番号「' + studentNo + '」の学生は、すでに登録されています。' };
    const now = nowText_();

    if (id) {
      const i = findStudentIndex_(rows, id);
      if (i < 0) return { ok: false, message: 'この学生は見つかりません。画面を読み込み直してください。' };
      const r = rows[i];
      const before = String(r[ST.grad]).trim();
      const gradYear = year.value || before;
      sheet.getRange(i + 2, ST.no + 1, 1, 3).setValues([[studentNo, name, kana]]);
      sheet.getRange(i + 2, ST.grad + 1).setValue(gradYear);
      sheet.getRange(i + 2, ST.updated + 1).setValue(now);
      if (gradYear !== before) addStudentLog_(id, '卒業予定年度', before, gradYear, '学校管理者が基本情報を変更', s.user.teacherId);
      r[ST.no] = studentNo; r[ST.name] = name; r[ST.kana] = kana; r[ST.grad] = gradYear; r[ST.updated] = now;
      return { ok: true, item: studentFromRow_(r), message: '学生の情報を変更しました。' };
    }

    const classCode = String(item.classCode || '').trim();
    const cls = classMap_()[classCode];
    if (!cls) return { ok: false, message: 'クラスを選んでください。' };
    const gradYear = year.value || autoGradYear_(cls);
    const newId = nextId_(rows, 'S');
    const row = [newId, studentNo, name, kana, classCode, gradYear, '在籍', JOB_STATUS_DEFAULT, '', '', now, now];
    sheet.appendRow(row);
    return { ok: true, item: studentFromRow_(row), message: '学生を登録しました。' };
  });
}

/** 学生の削除（学校管理者だけ）。応募・指導記録がある学生は削除しない（退学・除籍などは在籍状態で表す） */
function deleteStudent_(token, studentId) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  return withLock_(function () {
    const rows = readRows_(SHEETS.students);
    const i = findStudentIndex_(rows, studentId);
    if (i < 0) return { ok: false, message: 'この学生は見つかりません。画面を読み込み直してください。' };
    const id = String(rows[i][ST.id]).trim();
    const entries = readRows_(SHEETS.entries).filter(function (r) { return String(r[1]).trim() === id; }).length;
    const records = readRows_(SHEETS.records).filter(function (r) { return String(r[1]).trim() === id; }).length;
    if (entries || records) {
      return { ok: false, message: 'この学生には応募や指導記録があるため、削除できません。退学・卒業などのときは「在籍状態の変更」を使ってください。' };
    }
    getSheet_(SHEETS.students.name).deleteRow(i + 2);
    return { ok: true, message: '学生を削除しました。' };
  });
}

/**
 * CSVでまとめて登録（学校管理者だけ）
 * rows：[{ studentNo, name, kana, cls, gradYear }]（cls はクラスコード・クラス名・ラベルのどれでもよい）
 * dryRun が true なら、確かめるだけで登録しない。1件でもまちがいがあれば、1件も登録しない
 */
function importStudents_(token, rows, dryRun) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) return { ok: false, message: '登録する学生がありません。' };
  if (rows.length > MAX_IMPORT_ROWS) return { ok: false, message: '1回に登録できるのは ' + MAX_IMPORT_ROWS + '人までです。ファイルを分けてください。' };

  return withLock_(function () {
    const classes = classMap_();
    const findClass = function (v) {
      v = String(v || '').trim();
      if (classes[v]) return classes[v];
      const keys = Object.keys(classes);
      for (let i = 0; i < keys.length; i++) {
        const c = classes[keys[i]];
        if (c.name === v || (c.label && c.label === v)) return c;
      }
      return null;
    };
    const existing = {};
    readRows_(SHEETS.students).forEach(function (r) { existing[String(r[ST.no]).trim()] = true; });

    const errors = [];
    const seen = {};
    const ready = rows.map(function (src, n) {
      const line = n + 2; // 1行目は見出し
      const studentNo = cleanText_(src.studentNo, 20);
      const name = cleanText_(src.name, MAX_NAME_LEN);
      const kana = cleanText_(src.kana, MAX_NAME_LEN);
      const cls = findClass(src.cls);
      const year = cleanYear_(src.gradYear);
      if (!studentNo) errors.push(line + '行目：学籍番号がありません。');
      else if (existing[studentNo]) errors.push(line + '行目：学籍番号「' + studentNo + '」は、すでに登録されています。');
      else if (seen[studentNo]) errors.push(line + '行目：学籍番号「' + studentNo + '」が、ファイルの中で重なっています。');
      if (!name) errors.push(line + '行目：名前がありません。');
      if (!cls) errors.push(line + '行目：クラス「' + String(src.cls || '') + '」が見つかりません。');
      if (year.error) errors.push(line + '行目：' + year.error);
      seen[studentNo] = true;
      return { studentNo: studentNo, name: name, kana: kana, cls: cls, gradYear: year.value };
    });
    if (errors.length) return { ok: false, errors: errors.slice(0, 50), errorCount: errors.length, message: 'CSVに直すところが ' + errors.length + ' か所あります。' };
    if (dryRun) return { ok: true, count: ready.length, message: ready.length + '人を登録できます。' };

    const sheet = getSheet_(SHEETS.students.name);
    const now = nowText_();
    let all = readRows_(SHEETS.students);
    const out = ready.map(function (x) {
      const id = nextId_(all, 'S');
      const row = [id, x.studentNo, x.name, x.kana, x.cls.code, x.gradYear || autoGradYear_(x.cls), '在籍', JOB_STATUS_DEFAULT, '', '', now, now];
      all.push(row);
      return row;
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
    return { ok: true, count: out.length, items: out.map(studentFromRow_), message: out.length + '人の学生を登録しました。' };
  });
}

/* =========================================================
 * 学校管理者・担当の教員：クラス移動・在籍状態・資格とメモ
 * ========================================================= */

/** 共通：学生を探して、扱えるかを確かめる */
function loadStudentFor_(user, studentId) {
  const rows = readRows_(SHEETS.students);
  const i = findStudentIndex_(rows, studentId);
  if (i < 0) return { error: 'この学生は見つかりません。画面を読み込み直してください。' };
  const st = studentFromRow_(rows[i]);
  if (!canHandle_(user, st)) return { error: 'この学生は、あなたの担当クラスではないため変更できません。' };
  return { index: i, row: rows[i], student: st };
}

/** クラスの移動（理由は必須） */
function moveStudent_(token, studentId, toClass, reason) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  reason = cleanText_(reason, MAX_REASON_LEN);
  toClass = String(toClass || '').trim();
  if (!reason) return { ok: false, message: '移動の理由を入力してください。' };

  return withLock_(function () {
    const f = loadStudentFor_(s.user, studentId);
    if (f.error) return { ok: false, message: f.error };
    const classes = classMap_();
    if (!classes[toClass]) return { ok: false, message: '移動先のクラスを選んでください。' };
    if (toClass === f.student.classCode) return { ok: false, message: 'いまと同じクラスです。' };
    const now = nowText_();
    const sheet = getSheet_(SHEETS.students.name);
    sheet.getRange(f.index + 2, ST.cls + 1).setValue(toClass);
    sheet.getRange(f.index + 2, ST.updated + 1).setValue(now);
    const nameOf = function (code) { const c = classes[code]; return c ? c.name + '（' + code + '）' : code; };
    addStudentLog_(f.student.id, 'クラス', nameOf(f.student.classCode), nameOf(toClass), reason, s.user.teacherId);
    f.row[ST.cls] = toClass; f.row[ST.updated] = now;
    // 卒業予定年度が自動の値のままなら、移動先のクラスに合わせて直す（手で直してあれば、そのまま）
    let message = 'クラスを移動しました。';
    const oldAuto = autoGradYear_(classes[f.student.classCode]);
    const newAuto = autoGradYear_(classes[toClass]);
    if (newAuto && f.student.gradYear !== newAuto && (!f.student.gradYear || f.student.gradYear === oldAuto)) {
      sheet.getRange(f.index + 2, ST.grad + 1).setValue(newAuto);
      addStudentLog_(f.student.id, '卒業予定年度', f.student.gradYear || '（なし）', newAuto, 'クラス移動による自動更新', s.user.teacherId);
      f.row[ST.grad] = newAuto;
      message += '卒業予定年度を ' + newAuto + '年度に直しました。';
    }
    return { ok: true, item: studentFromRow_(f.row), message: message };
  });
}

/** 在籍状態の変更（理由は必須） */
function setEnrollStatus_(token, studentId, status, reason) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  reason = cleanText_(reason, MAX_REASON_LEN);
  status = String(status || '').trim();
  if (ENROLL_STATUSES.indexOf(status) < 0) return { ok: false, message: '在籍状態を選んでください。' };
  if (!reason) return { ok: false, message: '変更の理由を入力してください。' };

  return withLock_(function () {
    const f = loadStudentFor_(s.user, studentId);
    if (f.error) return { ok: false, message: f.error };
    if (status === f.student.enroll) return { ok: false, message: 'いまと同じ在籍状態です。' };
    const now = nowText_();
    const sheet = getSheet_(SHEETS.students.name);
    sheet.getRange(f.index + 2, ST.enroll + 1).setValue(status);
    sheet.getRange(f.index + 2, ST.updated + 1).setValue(now);
    addStudentLog_(f.student.id, '在籍状態', f.student.enroll, status, reason, s.user.teacherId);
    f.row[ST.enroll] = status; f.row[ST.updated] = now;
    return { ok: true, item: studentFromRow_(f.row), message: '在籍状態を「' + status + '」にしました。' };
  });
}

/** 取得資格とメモの変更 */
function updateStudentNotes_(token, studentId, quals, memo) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  const known = readRows_(SHEETS.qualifications).map(function (r) { return String(r[0]).trim(); });
  const list = (Array.isArray(quals) ? quals : []).map(function (q) { return String(q).trim(); }).filter(function (q, i, a) { return q && a.indexOf(q) === i; });
  if (list.some(function (q) { return known.indexOf(q) < 0; })) return { ok: false, message: '見つからない資格があります。画面を読み込み直してください。' };
  memo = String(memo == null ? '' : memo).replace(/\r\n?/g, '\n').trim().slice(0, MAX_MEMO_LEN);

  return withLock_(function () {
    const f = loadStudentFor_(s.user, studentId);
    if (f.error) return { ok: false, message: f.error };
    const now = nowText_();
    const sheet = getSheet_(SHEETS.students.name);
    sheet.getRange(f.index + 2, ST.quals + 1, 1, 2).setValues([[list.join(','), memo]]);
    sheet.getRange(f.index + 2, ST.updated + 1).setValue(now);
    f.row[ST.quals] = list.join(','); f.row[ST.memo] = memo; f.row[ST.updated] = now;
    return { ok: true, item: studentFromRow_(f.row), message: '取得資格とメモを保存しました。' };
  });
}
