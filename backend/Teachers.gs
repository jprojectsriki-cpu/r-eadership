/**
 * R-eadership API - 教員アカウント
 * - 一覧・発行・変更・停止／再開・パスワードの再設定：学校管理者だけ
 * - 自分のパスワードの変更：ログインしている人ならだれでも
 * - 発行と再設定のときは、仮のパスワードを自動で作り、その場で1回だけ画面に表示する（シートには暗号化したものだけを保存）
 * - 自分自身の停止・権限の変更はできない。利用中の学校管理者が0人になる操作もできない
 * - 停止・パスワードの再設定をすると、その教員はすぐにログアウトされる
 */

const TEMP_PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // まぎらわしい 0 O 1 l I は使わない
const TEMP_PW_LEN = 10;

/** 仮のパスワードを作る（英大文字・小文字・数字をそれぞれ1文字以上ふくむ10文字） */
function makeTempPassword_() {
  while (true) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
    let pw = '';
    for (let i = 0; i < TEMP_PW_LEN; i++) pw += TEMP_PW_CHARS.charAt(((bytes[i] + 256) % 256) % TEMP_PW_CHARS.length);
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)) return pw;
  }
}

/** 教員シートの行を、画面に返す形にする（パスワード・ソルトはふくめない） */
function teacherFromRow_(r) {
  const fmt = function (v) {
    if (!v) return '';
    if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    return String(v);
  };
  return {
    teacherId: String(r[0]).trim(),
    name: String(r[3]).trim(),
    role: String(r[4]).trim() === ROLE_ADMIN ? 'admin' : 'teacher',
    classes: String(r[5]).split(',').map(function (x) { return x.trim(); }).filter(String),
    status: String(r[6]).trim() === STATUS_STOPPED ? 'stopped' : 'active',
    createdAt: fmt(r[7]),
    lastLoginAt: fmt(r[8])
  };
}

/**
 * その教員のログインを終わらせる
 * mode：'stopped'（停止した）／'changed'（権限・担当クラス・パスワードが変わった）／'resume'（再開した：記録を消すだけ）
 */
function endSessions_(teacherId, mode) {
  const key = 'current_' + String(teacherId).toLowerCase();
  const cache = CacheService.getScriptCache();
  if (mode === 'resume') cache.remove(key); else cache.put(key, mode, SESSION_TTL_SEC);
}

/** 担当クラスのコードを確かめて、正しいものだけにする（ない番号があればエラーの文を返す） */
function checkClassCodes_(codes) {
  const list = (Array.isArray(codes) ? codes : []).map(function (c) { return String(c).trim(); }).filter(String);
  const known = readRows_(SHEETS.classes).map(function (r) { return String(r[0]).trim(); });
  const unknown = list.filter(function (c) { return known.indexOf(c) < 0; });
  if (unknown.length) return { error: '担当クラスに、見つからないクラスがあります。画面を読み込み直してください。' };
  return { codes: list.filter(function (c, i) { return list.indexOf(c) === i; }) };
}

/** 利用中の学校管理者の人数（except の教員IDは数えない） */
function activeAdminCount_(rows, except) {
  return rows.filter(function (r) {
    return String(r[0]).trim().toLowerCase() !== String(except || '').toLowerCase()
      && String(r[4]).trim() === ROLE_ADMIN && String(r[6]).trim() !== STATUS_STOPPED;
  }).length;
}

/** 教員IDの行（rows の何番目か）を探す。大文字・小文字は区別しない */
function indexOfTeacher_(rows, teacherId) {
  const key = String(teacherId || '').trim().toLowerCase();
  return rows.findIndex(function (r) { return String(r[0]).trim().toLowerCase() === key; });
}

/** 一覧（学校管理者だけ） */
function listTeachers_(token) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  return { ok: true, teachers: readRows_(SHEETS.teachers).filter(function (r) { return String(r[0]).trim(); }).map(teacherFromRow_) };
}

/** 発行（学校管理者だけ）。仮のパスワードを返す */
function createTeacher_(token, item) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  item = item || {};
  const teacherId = String(item.teacherId || '').trim();
  const name = cleanText_(item.name, MAX_NAME_LEN);
  const role = item.role === 'admin' ? ROLE_ADMIN : ROLE_TEACHER;
  if (!isValidTeacherId_(teacherId)) return { ok: false, message: '教員IDは、英数字と - _ の3〜20文字で入力してください。' };
  if (!name) return { ok: false, message: '名前を入力してください。' };

  return withLock_(function () {
    const rows = readRows_(SHEETS.teachers);
    if (indexOfTeacher_(rows, teacherId) >= 0) return { ok: false, message: '教員ID「' + teacherId + '」は、すでに使われています。' };
    const cls = checkClassCodes_(item.classes);
    if (cls.error) return { ok: false, message: cls.error };

    const password = makeTempPassword_();
    const salt = generateSalt_();
    getSheet_(SHEETS.teachers.name).appendRow([
      teacherId, hashPassword_(password, salt), salt, name, role, cls.codes.join(','), STATUS_ACTIVE, nowText_(), ''
    ]);
    const t = teacherFromRow_([teacherId, '', '', name, role, cls.codes.join(','), STATUS_ACTIVE, nowText_(), '']);
    return { ok: true, item: t, tempPassword: password, message: '教員アカウントを発行しました。' };
  });
}

/** 名前・権限・担当クラスの変更（学校管理者だけ） */
function updateTeacher_(token, item) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;
  item = item || {};
  const name = cleanText_(item.name, MAX_NAME_LEN);
  const role = item.role === 'admin' ? ROLE_ADMIN : ROLE_TEACHER;
  if (!name) return { ok: false, message: '名前を入力してください。' };

  return withLock_(function () {
    const sheet = getSheet_(SHEETS.teachers.name);
    const rows = readRows_(SHEETS.teachers);
    const i = indexOfTeacher_(rows, item.teacherId);
    if (i < 0) return { ok: false, message: 'この教員は見つかりません。画面を読み込み直してください。' };
    const r = rows[i];
    const isSelf = String(r[0]).trim().toLowerCase() === s.user.teacherId.toLowerCase();
    if (isSelf && role !== String(r[4]).trim()) return { ok: false, message: '自分の権限は変更できません。ほかの学校管理者に変更してもらってください。' };
    if (String(r[4]).trim() === ROLE_ADMIN && role !== ROLE_ADMIN && activeAdminCount_(rows, r[0]) === 0) {
      return { ok: false, message: '利用中の学校管理者がいなくなるため、権限を「教員」にできません。' };
    }
    const cls = checkClassCodes_(item.classes);
    if (cls.error) return { ok: false, message: cls.error };

    sheet.getRange(i + 2, 4, 1, 3).setValues([[name, role, cls.codes.join(',')]]);
    // 権限・担当クラスが変わったので、ログインし直してもらう（本人以外）
    if (!isSelf) endSessions_(r[0], 'changed');
    r[3] = name; r[4] = role; r[5] = cls.codes.join(',');
    return { ok: true, item: teacherFromRow_(r), message: '教員アカウントを変更しました。' };
  });
}

/** 停止・再開（学校管理者だけ）。stop が true なら停止 */
function setTeacherStatus_(token, teacherId, stop) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;

  return withLock_(function () {
    const sheet = getSheet_(SHEETS.teachers.name);
    const rows = readRows_(SHEETS.teachers);
    const i = indexOfTeacher_(rows, teacherId);
    if (i < 0) return { ok: false, message: 'この教員は見つかりません。画面を読み込み直してください。' };
    const r = rows[i];
    if (stop) {
      if (String(r[0]).trim().toLowerCase() === s.user.teacherId.toLowerCase()) return { ok: false, message: '自分のアカウントは停止できません。' };
      if (String(r[4]).trim() === ROLE_ADMIN && activeAdminCount_(rows, r[0]) === 0) return { ok: false, message: '利用中の学校管理者がいなくなるため、停止できません。' };
    }
    sheet.getRange(i + 2, 7).setValue(stop ? STATUS_STOPPED : STATUS_ACTIVE);
    endSessions_(r[0], stop ? 'stopped' : 'resume');
    r[6] = stop ? STATUS_STOPPED : STATUS_ACTIVE;
    return { ok: true, item: teacherFromRow_(r), message: stop ? 'アカウントを停止しました。' : 'アカウントを再開しました。' };
  });
}

/** パスワードの再設定（学校管理者だけ）。新しい仮のパスワードを返す */
function resetTeacherPassword_(token, teacherId) {
  const s = requireAdmin_(token);
  if (!s.ok) return s;

  return withLock_(function () {
    const rows = readRows_(SHEETS.teachers);
    const i = indexOfTeacher_(rows, teacherId);
    if (i < 0) return { ok: false, message: 'この教員は見つかりません。画面を読み込み直してください。' };
    if (String(rows[i][0]).trim().toLowerCase() === s.user.teacherId.toLowerCase()) {
      return { ok: false, message: '自分のパスワードは、右上の「パスワード変更」から変更してください。' };
    }
    const password = makeTempPassword_();
    const salt = generateSalt_();
    getSheet_(SHEETS.teachers.name).getRange(i + 2, 2, 1, 2).setValues([[hashPassword_(password, salt), salt]]);
    endSessions_(rows[i][0], String(rows[i][6]).trim() === STATUS_STOPPED ? 'stopped' : 'changed');
    return { ok: true, tempPassword: password, message: 'パスワードを再設定しました。' };
  });
}

/** 自分のパスワードの変更（ログインしている人ならだれでも） */
function changeMyPassword_(token, currentPassword, newPassword) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  if (!isValidPassword_(newPassword)) return { ok: false, message: '新しいパスワードは、8〜64文字で入力してください。' };
  if (currentPassword === newPassword) return { ok: false, message: '新しいパスワードは、いまのパスワードと別のものにしてください。' };

  return withLock_(function () {
    const t = findTeacher_(s.user.teacherId);
    if (!t) return { ok: false, message: 'アカウントが見つかりません。' };
    if (!verifyPassword_(String(currentPassword || ''), t.salt, t.passwordHash)) return { ok: false, message: 'いまのパスワードが正しくありません。' };
    const salt = generateSalt_();
    getSheet_(SHEETS.teachers.name).getRange(t.row, 2, 1, 2).setValues([[hashPassword_(newPassword, salt), salt]]);
    return { ok: true, message: 'パスワードを変更しました。' };
  });
}
