/**
 * R-eadership API - ログイン・ログアウト・ログイン状態の確認
 * - 入力：学校コード・教員ID・パスワード
 * - ログインの有効期間は6時間（CacheService の上限）
 * - 同じ教員IDで別の端末からログインすると、あとからログインした端末が優先され、前の端末はログアウトする
 * - 失敗が5回続くと、その教員IDは15分ログインできない
 * ※ findTeacher_・verifyPassword_・getSchoolInfo_ などは Auth.gs のものを使う
 */

const SESSION_TTL_SEC = 6 * 60 * 60;
const MAX_LOGIN_FAILS = 5;
const LOCK_SEC = 15 * 60;
const LOGIN_NG_MESSAGE = '学校コード、教員ID、またはパスワードが正しくありません。';

/** 権限を、画面で使う短い名前にする */
function roleKey_(role) {
  return role === ROLE_ADMIN ? 'admin' : 'teacher';
}

/** ログイン：成功したらトークンを発行し、前の端末のトークンは無効にする */
function login_(schoolCode, teacherId, password) {
  schoolCode = String(schoolCode || '').trim().toUpperCase();
  teacherId = String(teacherId || '').trim();
  password = String(password || '');
  if (!schoolCode || !teacherId || !password) {
    return { ok: false, message: '学校コード、教員ID、パスワードを入力してください。' };
  }

  const cache = CacheService.getScriptCache();
  const failKey = 'loginfail_' + teacherId.toLowerCase();
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_LOGIN_FAILS) {
    return { ok: false, message: 'ログインの失敗が続いたため、15分ほど時間をおいてからお試しください。' };
  }

  const school = getSchoolInfo_();
  const teacher = findTeacher_(teacherId);
  const okSchool = school.code && school.code.toUpperCase() === schoolCode;
  if (!okSchool || !teacher || !verifyPassword_(password, teacher.salt, teacher.passwordHash)) {
    cache.put(failKey, String(fails + 1), LOCK_SEC);
    return { ok: false, message: LOGIN_NG_MESSAGE };
  }
  if (teacher.status !== STATUS_ACTIVE) {
    return { ok: false, message: 'このアカウントは現在ご利用いただけません。学校管理者にお問い合わせください。' };
  }

  cache.remove(failKey);

  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const user = {
    teacherId: teacher.teacherId,
    name: teacher.name,
    role: roleKey_(teacher.role),
    classes: teacher.classes,
    schoolName: school.name,
    schoolCode: school.code
  };
  cache.put('session_' + token, JSON.stringify(user), SESSION_TTL_SEC);
  // 「この教員の今有効なトークン」を記録する（前の端末のトークンは、これで無効になる）
  cache.put('current_' + teacher.teacherId.toLowerCase(), token, SESSION_TTL_SEC);

  getSheet_(SHEETS.teachers.name).getRange(teacher.row, 9).setValue(new Date()); // 最終ログイン日時

  return { ok: true, token: token, user: user };
}

/**
 * トークンを確認する
 * 戻り値：{ ok: true, user } または { ok: false, reason: 'expired' | 'replaced' | 'stopped', message }
 */
function checkSession_(token) {
  const cache = CacheService.getScriptCache();
  const raw = token ? cache.get('session_' + token) : null;
  if (!raw) {
    return { ok: false, reason: 'expired', message: 'ログインの有効期限が切れました。もう一度ログインしてください。' };
  }
  const user = JSON.parse(raw);
  const current = cache.get('current_' + user.teacherId.toLowerCase());
  if (current === 'stopped') {
    cache.remove('session_' + token);
    return { ok: false, reason: 'stopped', message: 'このアカウントは現在ご利用いただけません。学校管理者にお問い合わせください。' };
  }
  if (current !== token) {
    cache.remove('session_' + token);
    return { ok: false, reason: 'replaced', message: '別の端末でログインされたため、ログアウトしました。' };
  }
  return { ok: true, user: user };
}

/** 学校管理者だけが使える操作のための確認 */
function requireAdmin_(token) {
  const s = checkSession_(token);
  if (!s.ok) return s;
  if (s.user.role !== 'admin') return { ok: false, reason: 'forbidden', message: 'この操作は学校管理者だけが行えます。' };
  return s;
}

/** ログアウト：トークンを無効にする */
function logout_(token) {
  if (!token) return { ok: true };
  const cache = CacheService.getScriptCache();
  const raw = cache.get('session_' + token);
  if (raw) {
    const user = JSON.parse(raw);
    const key = 'current_' + user.teacherId.toLowerCase();
    if (cache.get(key) === token) cache.remove(key);
  }
  cache.remove('session_' + token);
  return { ok: true };
}

/**
 * 【テスト用】ログインの動作確認
 * 事前に、スクリプト プロパティに TEST_PASSWORD（R-eadership デモ校の学校管理者パスワード）を入れておくこと
 */
function testLogin() {
  const props = PropertiesService.getScriptProperties();
  const password = props.getProperty('TEST_PASSWORD');
  if (!password) throw new Error('スクリプト プロパティに TEST_PASSWORD（R-eadership デモ校の学校管理者パスワード）を設定してください。');
  const school = getSchoolInfo_();
  const cache = CacheService.getScriptCache();

  // ① 学校コードがちがう
  Logger.log('① 学校コードがちがう → ' + JSON.stringify(login_('WRONG', 'admin', password)));
  // ② パスワードがちがう
  Logger.log('② パスワードがちがう → ' + JSON.stringify(login_(school.code, 'admin', 'wrong-password')));
  cache.remove('loginfail_admin'); // テストで増えた失敗の回数を0にもどす

  // ③ 正しくログイン（学校コードは小文字でも通る）
  const a = login_(school.code.toLowerCase(), 'admin', password);
  if (!a.ok) throw new Error('ログインに失敗しました：' + a.message + '（TEST_PASSWORD に R-eadership デモ校の学校管理者パスワードが入っているか確認してください）');
  Logger.log('③ ログイン → ok:' + a.ok + ' / ' + JSON.stringify(a.user));
  Logger.log('   トークンの確認 → ' + JSON.stringify(checkSession_(a.token)));

  // ④ 別の端末でログイン → 前の端末は無効
  const b = login_(school.code, 'admin', password);
  Logger.log('④ 別の端末でログイン → 前の端末：' + JSON.stringify(checkSession_(a.token)) + ' / 新しい端末：ok:' + checkSession_(b.token).ok);

  // ⑤ ログアウト → 無効
  logout_(b.token);
  Logger.log('⑤ ログアウト後 → ' + JSON.stringify(checkSession_(b.token)));

  props.deleteProperty('TEST_PASSWORD');
  Logger.log('TEST_PASSWORD を削除しました');
}
