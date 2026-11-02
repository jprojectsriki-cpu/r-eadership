/**
 * R-eadership API - 学生名簿
 * - 見る：学校管理者はすべての学生、教員は担当クラスの学生だけ
 * - 基本情報（学籍番号・名前・ふりがな・卒業予定年度）の登録・変更・削除、CSVでのまとめて登録：学校管理者だけ
 * - クラスの移動・在籍状態の変更：学校管理者と、その学生の担当の教員。理由は必須で、変更履歴に残す
 * - 取得資格・メモ：学校管理者と、その学生の担当の教員
 * - 学科とクラスは、学生ごとにそれぞれ選ぶ（学科とクラスは関係しない）
 * - 卒業予定年度は、入れなければ 学校の修業年限とクラスの学年から自動で決める（年度は4月はじまり）
 */

const ENROLL_STATUSES = ['在籍', '休学', '退学', '除籍', '卒業'];
const JOB_STATUS_DEFAULT = '未着手';
const MAX_REASON_LEN = 200;
const MAX_MEMO_LEN = 1000;
const MAX_IMPORT_ROWS = 500;

// 学生シートの列（0から数える）。Setup.gs の SHEETS.students.headers と同じ順番
const ST = {
  id: 0, no: 1, name: 2, kana: 3, birth: 4, gender: 5, nation: 6, tel: 7, mail: 8,
  dept: 9, cls: 10, grad: 11, enroll: 12, course: 13, school: 14, job: 15, quals: 16, memo: 17, created: 18, updated: 19
};
const GENDERS = ['男性', '女性', 'その他', '回答しない'];
const COURSES = ['就職希望', '進学希望', '帰国希望', '未定'];
const KEEP_YEARS_AFTER_GRADUATION = 3; // 卒業生のデータを残す年数（卒業から3年後の4月以降に削除）

function studentFromRow_(r) {
  const text = function (v) {
    if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
    return String(v == null ? '' : v).trim();
  };
  return {
    id: text(r[ST.id]),
    studentNo: text(r[ST.no]),
    name: text(r[ST.name]),
    kana: text(r[ST.kana]),
    birth: text(r[ST.birth]),
    gender: text(r[ST.gender]),
    nation: text(r[ST.nation]),
    tel: text(r[ST.tel]),
    mail: text(r[ST.mail]),
    deptId: text(r[ST.dept]),
    classCode: text(r[ST.cls]),
    gradYear: text(r[ST.grad]),
    enroll: text(r[ST.enroll]) || '在籍',
    course: text(r[ST.course]) || '未定',
    school: text(r[ST.school]),
    job: text(r[ST.job]) || JOB_STATUS_DEFAULT,
    quals: String(r[ST.quals]).split(',').map(function (x) { return x.trim(); }).filter(String),
    memo: String(r[ST.memo] == null ? '' : r[ST.memo]),
    updatedAt: r[ST.updated] instanceof Date ? Utilities.formatDate(r[ST.updated], 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') : String(r[ST.updated] || '')
  };
}

/** 新しい学生の1行を作る（p は確かめ済みの値） */
function newStudentRow_(id, p, deptId, classCode, gradYear, now) {
  const row = new Array(SHEETS.students.headers.length).fill('');
  row[ST.id] = id; row[ST.no] = p.studentNo; row[ST.name] = p.name; row[ST.kana] = p.kana;
  row[ST.birth] = p.birth; row[ST.gender] = p.gender; row[ST.nation] = p.nation; row[ST.tel] = p.tel; row[ST.mail] = p.mail;
  row[ST.dept] = deptId; row[ST.cls] = classCode; row[ST.grad] = gradYear; row[ST.enroll] = '在籍'; row[ST.course] = p.course || '未定'; row[ST.school] = p.school || '';
  row[ST.job] = JOB_STATUS_DEFAULT; row[ST.created] = now; row[ST.updated] = now;
  return row;
}

/**
 * 基本情報（学籍番号・名前・ふりがな・生年月日・性別・国籍・電話番号・メールアドレス）を確かめて整える
 * 戻り値：{ value: {...} } または { error: '…' }
 */
function cleanBasic_(item) {
  const v = {
    studentNo: cleanText_(item.studentNo, 20),
    name: cleanText_(item.name, MAX_NAME_LEN),
    kana: cleanText_(item.kana, MAX_NAME_LEN),
    birth: cleanText_(item.birth, 10).replace(/\//g, '-'),
    gender: cleanText_(item.gender, 10),
    nation: cleanText_(item.nation, 30),
    tel: cleanText_(item.tel, 20).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/[ー－‐−]/g, '-'),
    mail: cleanText_(item.mail, 100),
    course: cleanText_(item.course, 10),
    school: cleanText_(item.school, MAX_NAME_LEN)
  };
  if (!v.studentNo) return { error: '学籍番号を入力してください。' };
  if (!v.name) return { error: '名前を入力してください。' };
  if (v.birth) {
    const m = v.birth.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const d = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!m || d.getMonth() !== Number(m[2]) - 1 || Number(m[1]) < 1900) return { error: '生年月日は「2005-04-01」のように入力してください。' };
    v.birth = m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  }
  if (v.gender && GENDERS.indexOf(v.gender) < 0) return { error: '性別は「' + GENDERS.join('・') + '」から選んでください。' };
  if (v.tel && !/^[0-9+()\- ]{10,20}$/.test(v.tel)) return { error: '電話番号を確認してください（数字とハイフン）。' };
  if (v.mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.mail)) return { error: 'メールアドレスを確認してください。' };
  if (v.course && COURSES.indexOf(v.course) < 0) return { error: '希望進路は「' + COURSES.join('・') + '」から選んでください。' };
  return { value: v };
}

/** いまの年度（4月はじまり） */
function currentFiscalYear_() {
  const now = new Date();
  const y = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy'));
  const m = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'M'));
  return m >= 4 ? y : y - 1;
}

/** 学校の修業年限とクラスの学年から、卒業予定年度を決める（例：2年制の1年生、2026年度 → 2027年度） */
function autoGradYear_(classInfo) {
  if (!classInfo || !classInfo.years || !classInfo.grade) return '';
  return String(currentFiscalYear_() + classInfo.years - classInfo.grade);
}

/** クラスコード → { code, name, label, grade, years } の表（years は学校の修業年限） */
function classMap_() {
  const years = getSchoolYears_();
  const map = {};
  readRows_(SHEETS.classes).forEach(function (r) {
    const c = classFromRow_(r);
    if (!c.code) return;
    c.years = years;
    map[c.code] = c;
  });
  return map;
}

/** 学科ID → { id, name, label } の表 */
function deptMap_() {
  const map = {};
  readRows_(SHEETS.departments).forEach(function (r) {
    const d = deptFromRow_(r);
    if (d.id) map[d.id] = d;
  });
  return map;
}

/**
 * 学科を確かめる（学科ID・学科名・ラベルのどれでもよい）
 * 学科が1つも登録されていなければ、空でよい。登録されていれば必須
 * 戻り値：{ value: '学科ID' } または { error: '…' }
 */
function findDept_(depts, v) {
  v = String(v == null ? '' : v).trim();
  const ids = Object.keys(depts);
  if (!v) return ids.length ? { error: '学科を選んでください。' } : { value: '' };
  if (depts[v]) return { value: v };
  for (let i = 0; i < ids.length; i++) {
    const d = depts[ids[i]];
    if (d.name === v || (d.label && d.label === v)) return { value: d.id };
  }
  return { error: '学科「' + v + '」が見つかりません。' };
}

/**
 * クラスの学年・学校の修業年限が変わったとき、そのクラスの学生の卒業予定年度を自動で直す
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
  const c = cleanBasic_(item);
  if (c.error) return { ok: false, message: c.error };
  const p = c.value;
  const year = cleanYear_(item.gradYear);
  if (year.error) return { ok: false, message: year.error };

  return withLock_(function () {
    const dept = findDept_(deptMap_(), item.deptId);
    if (dept.error) return { ok: false, message: dept.error };
    const sheet = getSheet_(SHEETS.students.name);
    const rows = readRows_(SHEETS.students);
    const id = String(item.id || '').trim();
    const dup = rows.some(function (r) { return String(r[ST.id]).trim() !== id && String(r[ST.no]).trim() === p.studentNo; });
    if (dup) return { ok: false, message: '学籍番号「' + p.studentNo + '」の学生は、すでに登録されています。' };
    const now = nowText_();

    if (id) {
      const i = findStudentIndex_(rows, id);
      if (i < 0) return { ok: false, message: 'この学生は見つかりません。画面を読み込み直してください。' };
      const r = rows[i];
      const before = String(r[ST.grad]).trim();
      const beforeDept = String(r[ST.dept]).trim();
      const gradYear = year.value || before;
      r[ST.no] = p.studentNo; r[ST.name] = p.name; r[ST.kana] = p.kana;
      r[ST.birth] = p.birth; r[ST.gender] = p.gender; r[ST.nation] = p.nation; r[ST.tel] = p.tel; r[ST.mail] = p.mail;
      r[ST.dept] = dept.value; r[ST.grad] = gradYear; r[ST.updated] = now;
      sheet.getRange(i + 2, 1, 1, r.length).setValues([r]);
      if (dept.value !== beforeDept) {
        const depts = deptMap_();
        const nameOf = function (d) { return d ? (depts[d] ? depts[d].name : d) + '（' + d + '）' : '（なし）'; };
        addStudentLog_(id, '学科', nameOf(beforeDept), nameOf(dept.value), '学校管理者が基本情報を変更', s.user.teacherId);
      }
      if (gradYear !== before) addStudentLog_(id, '卒業予定年度', before, gradYear, '学校管理者が基本情報を変更', s.user.teacherId);
      return { ok: true, item: studentFromRow_(r), message: '学生の情報を変更しました。' };
    }

    const classCode = String(item.classCode || '').trim();
    const cls = classMap_()[classCode];
    if (!cls) return { ok: false, message: 'クラスを選んでください。' };
    const row = newStudentRow_(nextId_(rows, 'S'), p, dept.value, classCode, year.value || autoGradYear_(cls), now);
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
 * rows：[{ studentNo, name, kana, birth, gender, nation, tel, mail, course, school, dept, cls, gradYear }]
 *   （dept は学科ID・学科名・ラベル、cls はクラスコード・クラス名・ラベルのどれでもよい）
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
    const depts = deptMap_();
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
      const c = cleanBasic_(src);
      const p = c.value || { studentNo: cleanText_(src.studentNo, 20) };
      const studentNo = p.studentNo;
      const cls = findClass(src.cls);
      const dept = findDept_(depts, src.dept);
      const year = cleanYear_(src.gradYear);
      if (c.error) errors.push(line + '行目：' + c.error);
      if (studentNo && existing[studentNo]) errors.push(line + '行目：学籍番号「' + studentNo + '」は、すでに登録されています。');
      else if (studentNo && seen[studentNo]) errors.push(line + '行目：学籍番号「' + studentNo + '」が、ファイルの中で重なっています。');
      if (dept.error) errors.push(line + '行目：' + dept.error);
      if (!cls) errors.push(line + '行目：クラス「' + String(src.cls || '') + '」が見つかりません。');
      if (year.error) errors.push(line + '行目：' + year.error);
      if (studentNo) seen[studentNo] = true;
      return { p: p, cls: cls, deptId: dept.value, gradYear: year.value };
    });
    if (errors.length) return { ok: false, errors: errors.slice(0, 50), errorCount: errors.length, message: 'CSVに直すところが ' + errors.length + ' か所あります。' };
    if (dryRun) return { ok: true, count: ready.length, message: ready.length + '人を登録できます。' };

    const sheet = getSheet_(SHEETS.students.name);
    const now = nowText_();
    let all = readRows_(SHEETS.students);
    const out = ready.map(function (x) {
      const row = newStudentRow_(nextId_(all, 'S'), x.p, x.deptId, x.cls.code, x.gradYear || autoGradYear_(x.cls), now);
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

/**
 * 変更履歴をまとめて足す（1回の書き込みで行う）
 * logs：[[学生ID, 項目, 変更前, 変更後, 理由, 教員ID], ...]
 */
function appendStudentLogs_(logs) {
  if (!logs.length) return;
  const sheet = getSheet_(SHEETS.studentLogs.name);
  const props = PropertiesService.getScriptProperties();
  const first = Number(nextId_(readRows_(SHEETS.studentLogs), 'H').slice(1));
  const now = nowText_();
  const out = logs.map(function (l, i) {
    return ['H' + String(first + i).padStart(3, '0'), l[0], now, l[1], l[2], l[3], l[4], l[5]];
  });
  props.setProperty('SEQ_H', String(first + logs.length - 1));
  sheet.getRange(sheet.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
}

/**
 * 共通：対象の学生（1人でも、まとめてでも）を読み込み、全員を扱えるかを確かめる
 * 1人でも扱えない学生がいれば、だれも変更しない
 */
function loadTargets_(user, ids) {
  ids = (Array.isArray(ids) ? ids : [ids]).map(function (x) { return String(x || '').trim(); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  if (!ids.length) return { error: '学生を選んでください。' };
  if (ids.length > MAX_IMPORT_ROWS) return { error: '1回に変更できるのは ' + MAX_IMPORT_ROWS + '人までです。' };
  const rows = readRows_(SHEETS.students);
  const targets = [];
  for (let k = 0; k < ids.length; k++) {
    const i = findStudentIndex_(rows, ids[k]);
    if (i < 0) return { error: '見つからない学生がいます。画面を読み込み直してください。' };
    const st = studentFromRow_(rows[i]);
    if (!canHandle_(user, st)) return { error: '「' + st.name + '」さんは、あなたの担当クラスではないため変更できません。' };
    targets.push({ index: i, student: st });
  }
  return { rows: rows, targets: targets };
}

/** 共通：学生シートのデータ部分をまとめて書き戻す */
function writeStudentRows_(rows) {
  if (!rows.length) return;
  getSheet_(SHEETS.students.name).getRange(2, 1, rows.length, SHEETS.students.headers.length).setValues(rows);
}

/**
 * クラスの移動（1人でも、まとめてでも。理由は必須）
 * 卒業予定年度が自動の値のままの学生は、移動先のクラスに合わせて直す（手で直してあれば、そのまま）
 */
function moveStudents_(token, ids, toClass, reason) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  reason = cleanText_(reason, MAX_REASON_LEN);
  toClass = String(toClass || '').trim();
  if (!reason) return { ok: false, message: '移動の理由を入力してください。' };

  return withLock_(function () {
    const t = loadTargets_(s.user, ids);
    if (t.error) return { ok: false, message: t.error };
    const classes = classMap_();
    if (!classes[toClass]) return { ok: false, message: '移動先のクラスを選んでください。' };
    const moving = t.targets.filter(function (x) { return x.student.classCode !== toClass; });
    if (!moving.length) return { ok: false, message: '選んだ学生は、みな移動先と同じクラスです。' };

    const now = nowText_();
    const nameOf = function (code) { const c = classes[code]; return c ? c.name + '（' + code + '）' : code; };
    const newAuto = autoGradYear_(classes[toClass]);
    const logs = [];
    let yearFixed = 0;
    moving.forEach(function (x) {
      const r = t.rows[x.index];
      const st = x.student;
      r[ST.cls] = toClass;
      r[ST.updated] = now;
      logs.push([st.id, 'クラス', nameOf(st.classCode), nameOf(toClass), reason, s.user.teacherId]);
      const oldAuto = autoGradYear_(classes[st.classCode]);
      if (newAuto && st.gradYear !== newAuto && (!st.gradYear || st.gradYear === oldAuto)) {
        r[ST.grad] = newAuto;
        logs.push([st.id, '卒業予定年度', st.gradYear || '（なし）', newAuto, 'クラス移動による自動更新', s.user.teacherId]);
        yearFixed++;
      }
    });
    writeStudentRows_(t.rows);
    appendStudentLogs_(logs);
    const items = moving.map(function (x) { return studentFromRow_(t.rows[x.index]); });
    let message = moving.length === 1 ? 'クラスを移動しました。' : moving.length + '人のクラスを移動しました。';
    if (yearFixed) message += moving.length === 1 ? '卒業予定年度を ' + newAuto + '年度に直しました。' : '卒業予定年度を ' + yearFixed + '人分、自動で直しました。';
    const skipped = t.targets.length - moving.length;
    if (skipped) message += '（すでに移動先のクラスだった ' + skipped + '人は、そのままです）';
    return { ok: true, items: items, item: items[0], message: message };
  });
}

/** 在籍状態の変更（1人でも、まとめてでも。理由は必須） */
function setEnrollStatuses_(token, ids, status, reason) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  reason = cleanText_(reason, MAX_REASON_LEN);
  status = String(status || '').trim();
  if (ENROLL_STATUSES.indexOf(status) < 0) return { ok: false, message: '在籍状態を選んでください。' };
  if (!reason) return { ok: false, message: '変更の理由を入力してください。' };

  return withLock_(function () {
    const t = loadTargets_(s.user, ids);
    if (t.error) return { ok: false, message: t.error };
    const changing = t.targets.filter(function (x) { return x.student.enroll !== status; });
    if (!changing.length) return { ok: false, message: t.targets.length === 1 ? 'いまと同じ在籍状態です。' : '選んだ学生は、みな「' + status + '」です。' };
    const now = nowText_();
    const logs = [];
    changing.forEach(function (x) {
      const r = t.rows[x.index];
      r[ST.enroll] = status;
      r[ST.updated] = now;
      logs.push([x.student.id, '在籍状態', x.student.enroll, status, reason, s.user.teacherId]);
    });
    writeStudentRows_(t.rows);
    appendStudentLogs_(logs);
    const items = changing.map(function (x) { return studentFromRow_(t.rows[x.index]); });
    let message = (changing.length === 1 ? '' : changing.length + '人の') + '在籍状態を「' + status + '」にしました。';
    const skipped = t.targets.length - changing.length;
    if (skipped) message += '（すでに「' + status + '」だった ' + skipped + '人は、そのままです）';
    return { ok: true, items: items, item: items[0], message: message };
  });
}

/* 1人用（前からある呼び方） */
function moveStudent_(token, studentId, toClass, reason) { return moveStudents_(token, [studentId], toClass, reason); }
function setEnrollStatus_(token, studentId, status, reason) { return setEnrollStatuses_(token, [studentId], status, reason); }

/** 希望進路（進学予定先）・取得資格・メモの変更（担当の教員もできる） */
function updateStudentNotes_(token, studentId, quals, memo, course, school) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  course = String(course || '').trim();
  school = cleanText_(school, MAX_NAME_LEN);
  if (course && COURSES.indexOf(course) < 0) return { ok: false, message: '希望進路を選んでください。' };
  const known = readRows_(SHEETS.qualifications).map(function (r) { return String(r[0]).trim(); });
  const list = (Array.isArray(quals) ? quals : []).map(function (q) { return String(q).trim(); }).filter(function (q, i, a) { return q && a.indexOf(q) === i; });
  if (list.some(function (q) { return known.indexOf(q) < 0; })) return { ok: false, message: '見つからない資格があります。画面を読み込み直してください。' };
  memo = String(memo == null ? '' : memo).replace(/\r\n?/g, '\n').trim().slice(0, MAX_MEMO_LEN);

  return withLock_(function () {
    const f = loadStudentFor_(s.user, studentId);
    if (f.error) return { ok: false, message: f.error };
    const now = nowText_();
    const r = f.row;
    if (course && course !== f.student.course) {
      r[ST.course] = course;
      addStudentLog_(f.student.id, '希望進路', f.student.course, course, '希望進路の変更', s.user.teacherId);
    }
    // 進学予定先は、希望進路が「進学希望」のときだけ持つ
    const nextCourse = course || f.student.course;
    const nextSchool = nextCourse === '進学希望' ? school : '';
    if (nextSchool !== f.student.school) {
      addStudentLog_(f.student.id, '進学予定先', f.student.school || '（なし）', nextSchool || '（なし）', '進学予定先の変更', s.user.teacherId);
      r[ST.school] = nextSchool;
    }
    r[ST.quals] = list.join(','); r[ST.memo] = memo; r[ST.updated] = now;
    getSheet_(SHEETS.students.name).getRange(f.index + 2, 1, 1, r.length).setValues([r]);
    return { ok: true, item: studentFromRow_(r), message: '希望進路・取得資格・メモを保存しました。' };
  });
}

/* =========================================================
 * 卒業生のデータの削除（毎日の自動処理）
 * ========================================================= */

/**
 * 卒業から3年たった学生のデータを削除する（在籍状態が「卒業」の学生だけ）
 * 卒業予定年度が 2026 の学生は、2027年3月に卒業 → 2030年4月（2030年度）から削除の対象
 * いっしょに、その学生の変更履歴・応募・選考の履歴・指導記録も削除する
 * 戻り値：削除した人数
 */
function purgeOldGraduates_() {
  const fy = currentFiscalYear_();
  return withLock_(function () {
    const sheet = getSheet_(SHEETS.students.name);
    const rows = readRows_(SHEETS.students);
    const ids = [];
    const keep = rows.filter(function (r) {
      const y = Number(String(r[ST.grad]).trim());
      const old = String(r[ST.enroll]).trim() === '卒業' && y && fy >= y + 1 + KEEP_YEARS_AFTER_GRADUATION;
      if (old) ids.push(String(r[ST.id]).trim());
      return !old;
    });
    if (!ids.length) return 0;
    // 学生シートを書き直す（残す学生だけ）
    if (rows.length) sheet.getRange(2, 1, rows.length, SHEETS.students.headers.length).clearContent();
    if (keep.length) sheet.getRange(2, 1, keep.length, SHEETS.students.headers.length).setValues(keep);
    // 学生IDが2列目にあるシートから、その学生の行を消す
    [SHEETS.studentLogs, SHEETS.entries, SHEETS.entryLogs, SHEETS.records].forEach(function (def) {
      const all = readRows_(def);
      const rest = all.filter(function (r) { return ids.indexOf(String(r[1]).trim()) < 0; });
      if (rest.length === all.length) return;
      const sh = getSheet_(def.name);
      sh.getRange(2, 1, all.length, def.headers.length).clearContent();
      if (rest.length) sh.getRange(2, 1, rest.length, def.headers.length).setValues(rest);
    });
    return ids.length;
  });
}

/** 毎日の自動処理（トリガーから呼ばれる） */
function dailyJobs() {
  const n = purgeOldGraduates_();
  Logger.log('卒業から' + KEEP_YEARS_AFTER_GRADUATION + '年たった学生のデータを削除しました：' + n + '人');
}

/** 【1回だけ実行】毎日の自動処理（午前3時ごろ）を登録する。すでにあれば作り直す */
function setupDailyJobs() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyJobs') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyJobs').timeBased().everyDays(1).atHour(3).create();
  Logger.log('毎日の自動処理（dailyJobs・午前3時ごろ）を登録しました');
  dailyJobs();
}
