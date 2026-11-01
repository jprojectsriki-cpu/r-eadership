/**
 * R-eadership API - 学科・クラス・資格
 * - 一覧（masters）：ログインしている人ならだれでも（学生名簿のプルダウン・クラス移動・資格の選択で使う）
 * - 追加・変更・削除：学校管理者だけ
 * - 学科ID（D001〜）・クラスコード（C001〜）・資格ID（Q001〜）は自動で付ける。あとから変えない。削除した番号は使い回さない
 * - 学科には修業年限（1〜4年）を持たせ、クラスの学年はその範囲から選ぶ
 * - 名前・ラベルは、それぞれ同じものを登録できない。ラベルは学生名簿などで表示する短い名前（空なら名前を表示）
 * - 使われているものは削除できない（学科→クラス、クラス→学生・教員の担当クラス、資格→学生の取得資格）
 */

const MAX_NAME_LEN = 50;
const MAX_TEXT_LEN = 200;
const MAX_LABEL_LEN = 20;
const MAX_YEARS = 4; // 修業年限の上限（1年制〜4年制）

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
  return { id: String(r[0]).trim(), name: String(r[1]).trim(), label: String(r[2]).trim(), years: Number(r[3]) || 0 };
}
function classFromRow_(r) {
  return { code: String(r[0]).trim(), name: String(r[1]).trim(), label: String(r[2]).trim(), deptId: String(r[3]).trim(), grade: Number(r[4]) || 0 };
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
    departments: readRows_(SHEETS.departments).filter(hasId).map(deptFromRow_),
    classes: readRows_(SHEETS.classes).filter(hasId).map(classFromRow_),
    qualifications: readRows_(SHEETS.qualifications).filter(hasId).map(qualFromRow_)
  };
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
  const years = Number(item.years);
  if (!name) return { ok: false, message: '学科名を入力してください。' };
  if (!(years >= 1 && years <= MAX_YEARS && Math.floor(years) === years)) return { ok: false, message: '修業年限を選んでください。' };

  return withLock_(function () {
    const sheet = getSheet_(SHEETS.departments.name);
    const rows = readRows_(SHEETS.departments);
    const id = String(item.id || '').trim();
    const dup = findDuplicate_(rows, id, name, label, '学科');
    if (dup) return { ok: false, message: dup };

    const result = { id: id, name: name, label: label, years: years };
    if (id) {
      const i = indexOfId_(rows, id);
      if (i < 0) return { ok: false, message: 'この学科は見つかりません。画面を読み込み直してください。' };
      // 修業年限を短くするとき、その年より上の学年のクラスがあれば変更しない
      const over = readRows_(SHEETS.classes).filter(function (r) {
        return String(r[3]).trim() === id && Number(r[4]) > years;
      }).length;
      if (over) return { ok: false, message: 'この学科には ' + (years + 1) + '年以上のクラスが ' + over + ' つあるため、修業年限を ' + years + '年にできません。先にクラスを変更・削除してください。' };
      sheet.getRange(i + 2, 2, 1, 3).setValues([[name, label, years]]);
      return { ok: true, item: result, message: '学科を変更しました。' };
    }
    result.id = nextId_(rows, 'D');
    sheet.appendRow([result.id, name, label, years, nowText_()]);
    return { ok: true, item: result, message: '学科を追加しました。' };
  });
}

/** 学科の削除（学校管理者だけ）。クラスで使われていたら削除しない */
function deleteDepartment_(token, id) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  id = String(id || '').trim();

  return withLock_(function () {
    const rows = readRows_(SHEETS.departments);
    const i = indexOfId_(rows, id);
    if (i < 0) return { ok: false, message: 'この学科は見つかりません。画面を読み込み直してください。' };
    const used = readRows_(SHEETS.classes).filter(function (r) { return String(r[3]).trim() === id; }).length;
    if (used) return { ok: false, message: 'この学科にはクラスが ' + used + ' つあるため、削除できません。先にクラスを削除してください。' };
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
  const deptId = String(item.deptId || '').trim();
  const grade = Number(item.grade);
  if (!name) return { ok: false, message: 'クラス名を入力してください。' };
  if (!deptId) return { ok: false, message: '学科を選んでください。' };

  return withLock_(function () {
    const depts = readRows_(SHEETS.departments);
    const d = indexOfId_(depts, deptId);
    if (d < 0) return { ok: false, message: '選んだ学科が見つかりません。画面を読み込み直してください。' };
    const years = Number(depts[d][3]) || 0;
    if (!(grade >= 1 && grade <= years && Math.floor(grade) === grade)) return { ok: false, message: '学年を選んでください（この学科は ' + years + '年制です）。' };

    const sheet = getSheet_(SHEETS.classes.name);
    const rows = readRows_(SHEETS.classes);
    const code = String(item.code || '').trim();
    const dup = findDuplicate_(rows, code, name, label, 'クラス');
    if (dup) return { ok: false, message: dup };

    const result = { code: code, name: name, label: label, deptId: deptId, grade: grade };
    if (code) {
      const i = indexOfId_(rows, code);
      if (i < 0) return { ok: false, message: 'このクラスは見つかりません。画面を読み込み直してください。' };
      sheet.getRange(i + 2, 2, 1, 4).setValues([[name, label, deptId, grade]]);
      return { ok: true, item: result, message: 'クラスを変更しました。' };
    }
    result.code = nextId_(rows, 'C');
    sheet.appendRow([result.code, name, label, deptId, grade, nowText_()]);
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

    const students = readRows_(SHEETS.students).filter(function (r) { return String(r[4]).trim() === code; }).length;
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
      return String(r[8]).split(',').map(function (x) { return x.trim(); }).indexOf(id) >= 0; // 取得資格（I列）
    }).length;
    if (used) return { ok: false, message: 'この資格は学生 ' + used + ' 人の取得資格に登録されているため、削除できません。' };

    getSheet_(SHEETS.qualifications.name).deleteRow(i + 2);
    return { ok: true, message: '資格を削除しました。' };
  });
}
