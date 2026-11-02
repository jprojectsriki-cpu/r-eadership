/**
 * R-eadership API - 学科・クラス・資格
 * - 一覧（masters）：ログインしている人ならだれでも（学生名簿のプルダウン・クラス移動・資格の選択で使う）
 * - 追加・変更・削除：学校管理者だけ
 * - 学科ID（D001〜）・クラスコード（C001〜）・資格ID（Q001〜）は自動で付ける。あとから変えない。削除した番号は使い回さない
 * - 修業年限（何年制か）は、学校で1つ（設定シートの「修業年限」）。クラスの学年は、1年からその年数までの中から選ぶ
 * - 学科とクラスは関係しない（学科もクラスも、学生ごとに選ぶ）
 * - 名前・ラベルは、それぞれ同じものを登録できない。ラベルは学生名簿などで表示する短い名前（空なら名前を表示）
 * - 使われているものは削除できない（学科→学生、クラス→学生・教員の担当クラス、資格→学生の取得資格）
 */

const MAX_NAME_LEN = 50;
const MAX_TEXT_LEN = 200;
const MAX_LABEL_LEN = 20;
const MAX_YEARS = 4; // 修業年限の上限（1年制〜4年制）
const DEFAULT_SCHOOL_YEARS = 2; // 修業年限がまだ決まっていないときの値

/** 文字を整える（改行を空白にし、前後の空白を取り、長さをそろえる） */
function cleanText_(value, maxLen) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLen);
}

/** シートの2行目以降を、見出しの数だけ読む */
function readRows_(def) {
  const sheet = getSheet_(def.name);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, def.headers.length).getValues();
}

/**
 * 次のID（D001・C001・Q001 のような形）を作る
 * 削除したIDを使い回さないよう、これまでで一番大きい番号をスクリプト プロパティ（SEQ_D など）に覚えておく
 */
function nextId_(rows, prefix) {
  const props = PropertiesService.getScriptProperties();
  let max = Number(props.getProperty('SEQ_' + prefix) || 0);
  rows.forEach(function (r) {
    const m = String(r[0]).match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  props.setProperty('SEQ_' + prefix, String(max + 1));
  return prefix + String(max + 1).padStart(3, '0');
}

function nowText_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
}

function deptFromRow_(r) {
  return { id: String(r[0]).trim(), name: String(r[1]).trim(), label: String(r[2]).trim() };
}
function classFromRow_(r) {
  return { code: String(r[0]).trim(), name: String(r[1]).trim(), label: String(r[2]).trim(), grade: Number(r[3]) || 0 };
}

/** 学校の修業年限（何年制か）。設定シートの「修業年限」。なければ 2 */
function getSchoolYears_() {
  const rows = getSheet_(SHEETS.settings.name).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === '修業年限') {
      const y = Number(rows[i][1]);
      if (y >= 1 && y <= MAX_YEARS) return Math.floor(y);
    }
  }
  return DEFAULT_SCHOOL_YEARS;
}
function qualFromRow_(r) {
  return { id: String(r[0]).trim(), name: String(r[1]).trim(), label: String(r[2]).trim(), category: String(r[3]).trim(), note: String(r[4]).trim() };
}

/** 名前・ラベルが、ほかの行と同じでないかを確かめる（同じならエラーの文を返す） */
function findDuplicate_(rows, id, name, label, what) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]).trim() === id) continue;
    if (String(r[1]).trim() === name) return '同じ名前の' + what + '「' + name + '」がすでにあります。';
    if (label && String(r[2]).trim() === label) return '同じラベル「' + label + '」の' + what + 'がすでにあります。';
  }
  return '';
}

/** IDが rows の何番目かを探す（なければ -1）。シートの行番号は、これに2を足したもの */
function indexOfId_(rows, id) {
  return rows.findIndex(function (r) { return String(r[0]).trim() === id; });
}

/** 書き込みを順番に行うための共通の形 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================
 * 一覧
 * ========================================================= */

/** 学科・クラス・資格の一覧（ログインしている人ならだれでも） */
function listMasters_(token) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  const hasId = function (r) { return String(r[0]).trim(); };
  return {
    ok: true,
    schoolYears: getSchoolYears_(),
    departments: readRows_(SHEETS.departments).filter(hasId).map(deptFromRow_),
    classes: readRows_(SHEETS.classes).filter(hasId).map(classFromRow_),
    qualifications: readRows_(SHEETS.qualifications).filter(hasId).map(qualFromRow_)
  };
}

/* =========================================================
 * 学校の修業年限
 * ========================================================= */

/**
 * 学校の修業年限（何年制か）を変える（学校管理者だけ）
 * - その年数より上の学年のクラスがあれば変えない
 * - 学生の卒業予定年度を自動で直す（手で直してある学生は、そのまま）
 */
function saveSchoolYears_(token, years) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  years = Number(years);
  if (!(years >= 1 && years <= MAX_YEARS && Math.floor(years) === years)) return { ok: false, message: '修業年限を選んでください。' };

  return withLock_(function () {
    const old = getSchoolYears_();
    if (old === years) return { ok: true, schoolYears: years, message: 'いまと同じ修業年限です。' };
    const over = readRows_(SHEETS.classes).filter(function (r) { return String(r[0]).trim() && Number(r[3]) > years; }).length;
    if (over) return { ok: false, message: (years + 1) + '年以上のクラスが ' + over + ' つあるため、' + years + '年制にできません。先にクラスの学年を変えるか、削除してください。' };
    const before = classMap_();
    setSetting_('修業年限', String(years));
    const message = '学校の修業年限を ' + years + '年制にしました。' + recalcGradYears_(Object.keys(before), before, classMap_(), s.user.teacherId, '学校の修業年限の変更（' + old + '年制 → ' + years + '年制）');
    return { ok: true, schoolYears: years, message: message };
  });
}

/* =========================================================
 * 学科
 * ========================================================= */

/** 学科の追加・変更（学校管理者だけ）。item.id があれば変更、なければ追加 */
function saveDepartment_(token, item) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  item = item || {};
  const name = cleanText_(item.name, MAX_NAME_LEN);
  const label = cleanText_(item.label, MAX_LABEL_LEN);
  if (!name) return { ok: false, message: '学科名を入力してください。' };

  return withLock_(function () {
    const sheet = getSheet_(SHEETS.departments.name);
    const rows = readRows_(SHEETS.departments);
    const id = String(item.id || '').trim();
    const dup = findDuplicate_(rows, id, name, label, '学科');
    if (dup) return { ok: false, message: dup };

    const result = { id: id, name: name, label: label };
    if (id) {
      const i = indexOfId_(rows, id);
      if (i < 0) return { ok: false, message: 'この学科は見つかりません。画面を読み込み直してください。' };
      sheet.getRange(i + 2, 2, 1, 2).setValues([[name, label]]);
      return { ok: true, item: result, message: '学科を変更しました。' };
    }
    result.id = nextId_(rows, 'D');
    sheet.appendRow([result.id, name, label, nowText_()]);
    return { ok: true, item: result, message: '学科を追加しました。' };
  });
}

/** 学科の削除（学校管理者だけ）。学生に使われていたら削除しない */
function deleteDepartment_(token, id) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  id = String(id || '').trim();

  return withLock_(function () {
    const rows = readRows_(SHEETS.departments);
    const i = indexOfId_(rows, id);
    if (i < 0) return { ok: false, message: 'この学科は見つかりません。画面を読み込み直してください。' };
    const used = readRows_(SHEETS.students).filter(function (r) { return String(r[ST.dept]).trim() === id; }).length;
    if (used) return { ok: false, message: 'この学科には学生が ' + used + ' 人登録されているため、削除できません。先に学生の学科を変更してください。' };
    getSheet_(SHEETS.departments.name).deleteRow(i + 2);
    return { ok: true, message: '学科を削除しました。' };
  });
}

/* =========================================================
 * クラス
 * ========================================================= */

/** クラスの追加・変更（学校管理者だけ）。item.code があれば変更、なければ追加 */
function saveClass_(token, item) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  item = item || {};
  const name = cleanText_(item.name, MAX_NAME_LEN);
  const label = cleanText_(item.label, MAX_LABEL_LEN);
  const grade = Number(item.grade);
  if (!name) return { ok: false, message: 'クラス名を入力してください。' };

  return withLock_(function () {
    const years = getSchoolYears_();
    if (!(grade >= 1 && grade <= years && Math.floor(grade) === grade)) return { ok: false, message: '学年を選んでください（この学校は ' + years + '年制です）。' };

    const sheet = getSheet_(SHEETS.classes.name);
    const rows = readRows_(SHEETS.classes);
    const code = String(item.code || '').trim();
    const dup = findDuplicate_(rows, code, name, label, 'クラス');
    if (dup) return { ok: false, message: dup };

    const result = { code: code, name: name, label: label, grade: grade };
    if (code) {
      const i = indexOfId_(rows, code);
      if (i < 0) return { ok: false, message: 'このクラスは見つかりません。画面を読み込み直してください。' };
      const before = classMap_(); // 変更前の学年
      sheet.getRange(i + 2, 2, 1, 3).setValues([[name, label, grade]]);
      let message = 'クラスを変更しました。';
      const old = before[code];
      if (old && old.grade !== grade) {
        message += recalcGradYears_([code], before, classMap_(), s.user.teacherId, 'クラスの学年の変更（' + old.grade + '年 → ' + grade + '年）');
      }
      return { ok: true, item: result, message: message };
    }
    result.code = nextId_(rows, 'C');
    sheet.appendRow([result.code, name, label, grade, nowText_()]);
    return { ok: true, item: result, message: 'クラスを追加しました。' };
  });
}

/** クラスの削除（学校管理者だけ）。学生や教員の担当クラスで使われていたら削除しない */
function deleteClass_(token, code) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  code = String(code || '').trim();

  return withLock_(function () {
    const rows = readRows_(SHEETS.classes);
    const i = indexOfId_(rows, code);
    if (i < 0) return { ok: false, message: 'このクラスは見つかりません。画面を読み込み直してください。' };

    const students = readRows_(SHEETS.students).filter(function (r) { return String(r[ST.cls]).trim() === code; }).length;
    if (students) return { ok: false, message: 'このクラスには学生が ' + students + ' 人登録されているため、削除できません。先に学生のクラスを移動してください。' };
    const teachers = readRows_(SHEETS.teachers).filter(function (r) {
      return String(r[5]).split(',').map(function (x) { return x.trim(); }).indexOf(code) >= 0;
    }).length;
    if (teachers) return { ok: false, message: 'このクラスは教員 ' + teachers + ' 人の担当クラスになっているため、削除できません。先に教員アカウントの担当クラスを変えてください。' };

    getSheet_(SHEETS.classes.name).deleteRow(i + 2);
    return { ok: true, message: 'クラスを削除しました。' };
  });
}

/* =========================================================
 * 資格
 * ========================================================= */

/** 資格の追加・変更（学校管理者だけ）。item.id があれば変更、なければ追加 */
function saveQualification_(token, item) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  item = item || {};
  const name = cleanText_(item.name, MAX_NAME_LEN);
  const label = cleanText_(item.label, MAX_LABEL_LEN);
  const category = cleanText_(item.category, MAX_NAME_LEN);
  const note = cleanText_(item.note, MAX_TEXT_LEN);
  if (!name) return { ok: false, message: '資格名を入力してください。' };

  return withLock_(function () {
    const sheet = getSheet_(SHEETS.qualifications.name);
    const rows = readRows_(SHEETS.qualifications);
    const id = String(item.id || '').trim();
    const dup = findDuplicate_(rows, id, name, label, '資格');
    if (dup) return { ok: false, message: dup };

    const result = { id: id, name: name, label: label, category: category, note: note };
    if (id) {
      const i = indexOfId_(rows, id);
      if (i < 0) return { ok: false, message: 'この資格は見つかりません。画面を読み込み直してください。' };
      sheet.getRange(i + 2, 2, 1, 4).setValues([[name, label, category, note]]);
      return { ok: true, item: result, message: '資格を変更しました。' };
    }
    result.id = nextId_(rows, 'Q');
    sheet.appendRow([result.id, name, label, category, note, nowText_()]);
    return { ok: true, item: result, message: '資格を追加しました。' };
  });
}

/** 資格の削除（学校管理者だけ）。学生の取得資格で使われていたら削除しない */
function deleteQualification_(token, id) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  id = String(id || '').trim();

  return withLock_(function () {
    const rows = readRows_(SHEETS.qualifications);
    const i = indexOfId_(rows, id);
    if (i < 0) return { ok: false, message: 'この資格は見つかりません。画面を読み込み直してください。' };

    const used = readRows_(SHEETS.students).filter(function (r) {
      return String(r[ST.quals]).split(',').map(function (x) { return x.trim(); }).indexOf(id) >= 0;
    }).length;
    if (used) return { ok: false, message: 'この資格は学生 ' + used + ' 人の取得資格に登録されているため、削除できません。' };

    getSheet_(SHEETS.qualifications.name).deleteRow(i + 2);
    return { ok: true, message: '資格を削除しました。' };
  });
}
