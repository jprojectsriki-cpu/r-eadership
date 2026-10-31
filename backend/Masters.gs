/**
 * R-eadership API - クラス・資格
 * - 一覧（masters）：ログインしている人ならだれでも（学生のクラス移動・資格の選択で使う）
 * - 追加・変更・削除：学校管理者だけ
 * - クラスコード（C001〜）・資格ID（Q001〜）は自動で付ける。あとから変えない
 * - 学生や教員の担当クラスで使われているものは削除できない
 */

const MAX_NAME_LEN = 50;
const MAX_TEXT_LEN = 200;

/** 文字を整える（前後の空白を取り、長さを確かめる） */
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
 * 次のID（C001・Q001 のような形）を作る
 * 削除したIDを使い回さないよう、これまでで一番大きい番号をスクリプト プロパティ（SEQ_C など）に覚えておく
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

function classFromRow_(r) {
  return { code: String(r[0]).trim(), name: String(r[1]).trim(), dept: String(r[2]).trim(), grade: String(r[3]).trim() };
}
function qualFromRow_(r) {
  return { id: String(r[0]).trim(), name: String(r[1]).trim(), category: String(r[2]).trim(), note: String(r[3]).trim() };
}

/** クラスと資格の一覧（ログインしている人ならだれでも） */
function listMasters_(token) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  return {
    ok: true,
    classes: readRows_(SHEETS.classes).filter(function (r) { return String(r[0]).trim(); }).map(classFromRow_),
    qualifications: readRows_(SHEETS.qualifications).filter(function (r) { return String(r[0]).trim(); }).map(qualFromRow_)
  };
}

/** クラスの追加・変更（学校管理者だけ）。item.code があれば変更、なければ追加 */
function saveClass_(token, item) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  item = item || {};
  const name = cleanText_(item.name, MAX_NAME_LEN);
  const dept = cleanText_(item.dept, MAX_NAME_LEN);
  const grade = cleanText_(item.grade, 10);
  if (!name) return { ok: false, message: 'クラス名を入力してください。' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_(SHEETS.classes.name);
    const rows = readRows_(SHEETS.classes);
    const code = String(item.code || '').trim();
    const dup = rows.some(function (r) {
      return String(r[0]).trim() !== code && String(r[1]).trim() === name && String(r[2]).trim() === dept;
    });
    if (dup) return { ok: false, message: '同じ学科に、同じ名前のクラスがすでにあります。' };

    if (code) {
      const i = rows.findIndex(function (r) { return String(r[0]).trim() === code; });
      if (i < 0) return { ok: false, message: 'このクラスは見つかりません。画面を読み込み直してください。' };
      sheet.getRange(i + 2, 2, 1, 3).setValues([[name, dept, grade]]);
      return { ok: true, item: { code: code, name: name, dept: dept, grade: grade }, message: 'クラスを変更しました。' };
    }
    const newCode = nextId_(rows, 'C');
    sheet.appendRow([newCode, name, dept, grade, nowText_()]);
    return { ok: true, item: { code: newCode, name: name, dept: dept, grade: grade }, message: 'クラスを追加しました。' };
  } finally {
    lock.releaseLock();
  }
}

/** クラスの削除（学校管理者だけ）。学生や教員の担当クラスで使われていたら削除しない */
function deleteClass_(token, code) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  code = String(code || '').trim();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = readRows_(SHEETS.classes);
    const i = rows.findIndex(function (r) { return String(r[0]).trim() === code; });
    if (i < 0) return { ok: false, message: 'このクラスは見つかりません。画面を読み込み直してください。' };

    const students = readRows_(SHEETS.students).filter(function (r) { return String(r[4]).trim() === code; }).length;
    if (students) return { ok: false, message: 'このクラスには学生が ' + students + ' 人登録されているため、削除できません。先に学生のクラスを移動してください。' };
    const teachers = readRows_(SHEETS.teachers).filter(function (r) {
      return String(r[5]).split(',').map(function (x) { return x.trim(); }).indexOf(code) >= 0;
    }).length;
    if (teachers) return { ok: false, message: 'このクラスは教員 ' + teachers + ' 人の担当クラスになっているため、削除できません。先に教員アカウントの担当クラスを変えてください。' };

    getSheet_(SHEETS.classes.name).deleteRow(i + 2);
    return { ok: true, message: 'クラスを削除しました。' };
  } finally {
    lock.releaseLock();
  }
}

/** 資格の追加・変更（学校管理者だけ）。item.id があれば変更、なければ追加 */
function saveQualification_(token, item) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  item = item || {};
  const name = cleanText_(item.name, MAX_NAME_LEN);
  const category = cleanText_(item.category, MAX_NAME_LEN);
  const note = cleanText_(item.note, MAX_TEXT_LEN);
  if (!name) return { ok: false, message: '資格名を入力してください。' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_(SHEETS.qualifications.name);
    const rows = readRows_(SHEETS.qualifications);
    const id = String(item.id || '').trim();
    const dup = rows.some(function (r) { return String(r[0]).trim() !== id && String(r[1]).trim() === name; });
    if (dup) return { ok: false, message: '同じ名前の資格がすでにあります。' };

    if (id) {
      const i = rows.findIndex(function (r) { return String(r[0]).trim() === id; });
      if (i < 0) return { ok: false, message: 'この資格は見つかりません。画面を読み込み直してください。' };
      sheet.getRange(i + 2, 2, 1, 3).setValues([[name, category, note]]);
      return { ok: true, item: { id: id, name: name, category: category, note: note }, message: '資格を変更しました。' };
    }
    const newId = nextId_(rows, 'Q');
    sheet.appendRow([newId, name, category, note, nowText_()]);
    return { ok: true, item: { id: newId, name: name, category: category, note: note }, message: '資格を追加しました。' };
  } finally {
    lock.releaseLock();
  }
}

/** 資格の削除（学校管理者だけ）。学生の取得資格で使われていたら削除しない */
function deleteQualification_(token, id) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  id = String(id || '').trim();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = readRows_(SHEETS.qualifications);
    const i = rows.findIndex(function (r) { return String(r[0]).trim() === id; });
    if (i < 0) return { ok: false, message: 'この資格は見つかりません。画面を読み込み直してください。' };

    const used = readRows_(SHEETS.students).filter(function (r) {
      return String(r[7]).split(',').map(function (x) { return x.trim(); }).indexOf(id) >= 0;
    }).length;
    if (used) return { ok: false, message: 'この資格は学生 ' + used + ' 人の取得資格に登録されているため、削除できません。' };

    getSheet_(SHEETS.qualifications.name).deleteRow(i + 2);
    return { ok: true, message: '資格を削除しました。' };
  } finally {
    lock.releaseLock();
  }
}
