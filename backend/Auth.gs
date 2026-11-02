/**
 * R-eadership API - 学校の登録と、パスワードの暗号化（ハッシュ化）
 * ※ getSheet_ と SHEETS は Setup.gs のものを使う
 */

const HASH_ITERATIONS = 1000;            // ハッシュを繰り返す回数（R-anguage と同じ）
const ROLE_ADMIN = '学校管理者';
const ROLE_TEACHER = '教員';
const STATUS_ACTIVE = '利用中';
const STATUS_STOPPED = '停止中';

/** ランダムなソルトを作る（32文字の英数字） */
function generateSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

/** パスワード + ソルト を SHA-256 で繰り返しハッシュ化し、16進数の文字列で返す */
function hashPassword_(password, salt) {
  const saltBytes = Utilities.newBlob(salt).getBytes();
  let bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  for (let i = 1; i < HASH_ITERATIONS; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes.concat(saltBytes));
  }
  return bytes.map(function (b) {
    return ((b + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

/** 入力されたパスワードが正しいかを確認する */
function verifyPassword_(password, salt, storedHash) {
  return hashPassword_(password, salt) === storedHash;
}

/** 教員IDの形を確かめる（英数字と - _ だけ、3〜20文字） */
function isValidTeacherId_(id) {
  return /^[A-Za-z0-9_-]{3,20}$/.test(String(id || ''));
}

/** パスワードの形を確かめる（8〜64文字） */
function isValidPassword_(pw) {
  pw = String(pw || '');
  return pw.length >= 8 && pw.length <= 64;
}

/** 設定シートから学校の情報を読む */
function getSchoolInfo_() {
  const rows = getSheet_(SHEETS.settings.name).getDataRange().getValues();
  const info = {};
  rows.slice(1).forEach(function (r) { info[String(r[0]).trim()] = String(r[1]).trim(); });
  return { name: info['学校名'] || '', code: info['学校コード'] || '', startedAt: info['利用開始日'] || '' };
}

/** 設定シートの「項目」の値を書きかえる（なければ行を足す） */
function setSetting_(key, value) {
  const sheet = getSheet_(SHEETS.settings.name);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

/** 教員IDで教員を探す（大文字・小文字は区別しない。見つからなければ null） */
function findTeacher_(teacherId) {
  const sheet = getSheet_(SHEETS.teachers.name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const key = String(teacherId || '').trim().toLowerCase();
  const rows = sheet.getRange(2, 1, lastRow - 1, SHEETS.teachers.headers.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]).trim().toLowerCase() === key) {
      return {
        row: i + 2,
        teacherId: String(r[0]).trim(),
        passwordHash: String(r[1]),
        salt: String(r[2]),
        name: String(r[3]),
        role: String(r[4]),
        classes: String(r[5]).split(',').map(function (s) { return s.trim(); }).filter(String),
        status: String(r[6]),
        createdAt: r[7] || null,
        lastLoginAt: r[8] || null
      };
    }
  }
  return null;
}

const LOGIN_URL = 'https://jprojectsriki-cpu.github.io/r-eadership/frontend/user/login.html';

/**
 * 【学校ごとに1回だけ実行】学校の情報と、最初の学校管理者を登録し、学校管理者に発行メールを送る
 * 事前に、スクリプト プロパティに次の5つを入れておく
 *   SCHOOL_NAME … 学校名
 *   SCHOOL_CODE … 学校コード（英大文字と数字、3〜10文字）
 *   ADMIN_ID    … 学校管理者の教員ID（英数字と - _、3〜20文字）
 *   ADMIN_NAME  … 学校管理者の名前
 *   ADMIN_EMAIL … 発行メールを送るメールアドレス（お申し込みのときのメールアドレス）
 * 仮のパスワードは自動で作り、発行メールにだけ書く（シートには暗号化したものだけ。ログにも出さない）
 * 実行が終わったら、ADMIN_EMAIL はスクリプト プロパティから自動で消す
 * ※ 開発用に ADMIN_PASSWORD を入れたときは、そのパスワードを使い、メールは送らない
 */
function setupSchool() {
  const props = PropertiesService.getScriptProperties();
  const schoolName = String(props.getProperty('SCHOOL_NAME') || '').trim();
  const schoolCode = String(props.getProperty('SCHOOL_CODE') || '').trim().toUpperCase();
  const adminId = String(props.getProperty('ADMIN_ID') || '').trim();
  const adminName = String(props.getProperty('ADMIN_NAME') || '').trim();
  const adminEmail = String(props.getProperty('ADMIN_EMAIL') || '').trim();
  const devPassword = String(props.getProperty('ADMIN_PASSWORD') || '');

  if (!schoolName || !schoolCode || !adminId || !adminName) {
    throw new Error('スクリプト プロパティに SCHOOL_NAME・SCHOOL_CODE・ADMIN_ID・ADMIN_NAME・ADMIN_EMAIL の5つを入れてください。');
  }
  if (!devPassword && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('ADMIN_EMAIL（発行メールを送るメールアドレス）を入れてください。');
  if (!/^[A-Z0-9]{3,10}$/.test(schoolCode)) throw new Error('SCHOOL_CODE は、英大文字と数字の3〜10文字にしてください（例：DEMO）。');
  if (!isValidTeacherId_(adminId)) throw new Error('ADMIN_ID は、英数字と - _ の3〜20文字にしてください（例：admin）。');
  if (devPassword && !isValidPassword_(devPassword)) throw new Error('ADMIN_PASSWORD は、8〜64文字にしてください。');
  const password = devPassword || makeTempPassword_();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (findTeacher_(adminId)) {
      throw new Error('教員ID「' + adminId + '」は、すでに教員シートにあります。パスワードを設定し直すときは resetAdminPassword を使ってください。');
    }
    setSetting_('学校名', schoolName);
    setSetting_('学校コード', schoolCode);
    if (!getSchoolInfo_().startedAt) setSetting_('利用開始日', Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'));
    const salt = generateSalt_();
    getSheet_(SHEETS.teachers.name).appendRow([
      adminId, hashPassword_(password, salt), salt, adminName,
      ROLE_ADMIN, '', STATUS_ACTIVE, new Date(), ''
    ]);
  } finally {
    lock.releaseLock();
  }

  props.deleteProperty('ADMIN_PASSWORD');
  Logger.log('学校を登録しました：' + schoolName + '（学校コード：' + schoolCode + '）／学校管理者：' + adminName + '（教員ID：' + adminId + '）');
  if (devPassword) {
    Logger.log('ADMIN_PASSWORD を使いました（開発用）。発行メールは送っていません。ADMIN_PASSWORD は削除しました');
    return;
  }
  sendIssueMail_(adminEmail, schoolName, schoolCode, adminId, adminName, password);
  props.deleteProperty('ADMIN_EMAIL');
  Logger.log('発行メールを ' + adminEmail + ' に送りました（仮のパスワードはメールにだけ書きました）。ADMIN_EMAIL は削除しました');
}

/** 学校管理者への発行メール */
function sendIssueMail_(to, schoolName, schoolCode, adminId, adminName, password) {
  const body = [
    schoolName,
    adminName + ' 様',
    '',
    'R-eadership（専門学校向け 就職進路管理システム）のご利用の準備ができました。',
    '次の内容でログインしてください。',
    '',
    '■ ログイン画面',
    LOGIN_URL,
    '',
    '■ 学校コード　　　：' + schoolCode,
    '■ 教員ID　　　　　：' + adminId,
    '■ 仮のパスワード　：' + password,
    '',
    '【はじめにお願いしたいこと】',
    '1. ログインしたら、画面右上の「パスワード変更」で、仮のパスワードをご自分のパスワードに変えてください。',
    '2. 「学科・クラス・資格」で、学校の修業年限（何年制か）を確かめてから、学科・クラス・資格を登録してください。',
    '3. 「教員アカウント」で、先生方のアカウントを発行してください（仮のパスワードが表示されます）。',
    '4. 「学生名簿」で、学生を登録してください（CSVでまとめて登録できます）。',
    '',
    '※ このメールには仮のパスワードが書かれています。パスワードを変えたあとは、このメールを削除してください。',
    '※ 学校管理者のパスワードを忘れたときは、お問い合わせフォームからご連絡ください。',
    'https://jprojectsriki-cpu.github.io/rikis_collection/#contact',
    '',
    '――――――――――――――――',
    'ReicherRick（代表 中村 力）',
    'R-eadership（専門学校向け 就職進路管理システム）',
    '――――――――――――――――'
  ].join('\n');
  MailApp.sendEmail({ to: to, subject: '【R-eadership】ご利用の準備ができました（学校コード ' + schoolCode + '）', body: body, name: 'R-eadership（ReicherRick）' });
}

/**
 * 【ひな形を作るときだけ実行】このスプレッドシートのデータを全部消して、新しい学校用のひな形にする
 * - すべてのシートの2行目から下を消す（見出しは残す）。設定シートは学校名・学校コード・利用開始日を空にする
 * - スクリプト プロパティとトリガーを消す
 * - まちがえて開発用・学校用のスプレッドシートで動かさないよう、スクリプト プロパティ RESET_OK に「はい」と入れたときだけ動く
 */
function resetForTemplate() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('RESET_OK') !== 'はい') {
    throw new Error('この関数は、データを全部消します。ひな形用にコピーしたスプレッドシートでだけ、スクリプト プロパティ RESET_OK に「はい」と入れてから実行してください。');
  }
  Object.keys(SHEETS).forEach(function (key) {
    const def = SHEETS[key];
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.name);
    if (!sheet) return;
    const last = sheet.getLastRow();
    if (key === 'settings') { if (last >= 2) sheet.getRange(2, 2, last - 1, 1).clearContent(); return; }
    if (last >= 2) sheet.deleteRows(2, last - 1);
  });
  props.deleteAllProperties();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('データ・スクリプト プロパティ・トリガーをすべて消しました。このスプレッドシートは、新しい学校用のひな形として使えます');
}

/**
 * 【必要なときだけ実行】学校管理者のパスワードを設定し直す（学校管理者がパスワードを忘れたとき）
 * 事前に、スクリプト プロパティに ADMIN_ID（設定し直す学校管理者の教員ID）と ADMIN_PASSWORD（新しいパスワード）を入れておく
 */
function resetAdminPassword() {
  const props = PropertiesService.getScriptProperties();
  const adminId = String(props.getProperty('ADMIN_ID') || '').trim();
  const password = String(props.getProperty('ADMIN_PASSWORD') || '');
  if (!adminId || !password) throw new Error('スクリプト プロパティに ADMIN_ID と ADMIN_PASSWORD を入れてください。');
  if (!isValidPassword_(password)) throw new Error('ADMIN_PASSWORD は、8〜64文字にしてください。');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = findTeacher_(adminId);
    if (!t) throw new Error('教員ID「' + adminId + '」が、教員シートに見つかりません。');
    if (t.role !== ROLE_ADMIN) throw new Error('教員ID「' + adminId + '」は学校管理者ではありません。教員のパスワードは、学校管理者が画面から設定し直します。');
    const salt = generateSalt_();
    getSheet_(SHEETS.teachers.name).getRange(t.row, 2, 1, 2).setValues([[hashPassword_(password, salt), salt]]);
  } finally {
    lock.releaseLock();
  }

  props.deleteProperty('ADMIN_PASSWORD');
  Logger.log('教員ID「' + adminId + '」のパスワードを設定し直しました。ADMIN_PASSWORD をスクリプト プロパティから削除しました');
}

/** 【確認用】学校の情報と、登録されている教員をログに出す（パスワードは出さない） */
function testSchool() {
  const info = getSchoolInfo_();
  Logger.log('学校名：' + info.name + '／学校コード：' + info.code + '／利用開始日：' + info.startedAt);
  const sheet = getSheet_(SHEETS.teachers.name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('教員：まだ登録されていません'); return; }
  sheet.getRange(2, 1, lastRow - 1, 7).getValues().forEach(function (r) {
    Logger.log('教員：' + r[0] + '／' + r[3] + '／' + r[4] + '／' + r[6] + '／パスワード（暗号化）の長さ ' + String(r[1]).length + '文字');
  });
  const props = PropertiesService.getScriptProperties();
  Logger.log('ADMIN_PASSWORD がスクリプト プロパティに残っていないか：' + (props.getProperty('ADMIN_PASSWORD') ? '残っています（削除してください）' : '残っていません'));
}
