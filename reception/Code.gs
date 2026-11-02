/**
 * R-eadership 受付API（お申し込みの受付。学校ごとのGASとは別に、1つだけ用意する）
 * スプレッドシート「R-eadership_受付」に入れて使う
 *
 * - LPのお申し込み画面から { action: 'apply', ... } を受け取り、「申込一覧」シートに記録する
 * - 申込者に受付メール（請求書のPDFを添付）を送り、中村に知らせのメールを送る
 * - スプレッドシートのメニュー「R-eadership受付」から、入金の確認・発行済み・キャンセルを記録する
 *
 * スクリプト プロパティ（コードには書かない）
 *   ADMIN_EMAIL … お知らせを受け取る中村のメールアドレス（受付メールの返信先にもなる）
 *   BANK_INFO   … 振込先（例：「〇〇銀行 〇〇支店 普通 1234567 ナカムラ チカラ」。改行してもよい）
 */

const PLANS = {
  small:  { label: '学生数 〜199人', price: 22000, min: 1, max: 199 },
  medium: { label: '学生数 200〜499人', price: 55000, min: 200, max: 499 },
  large:  { label: '学生数 500人以上', price: 88000, min: 500, max: 999999 }
};
const PAY_DAYS = 14; // 支払期限：お申し込みから14日
const SHEET_NAME = '申込一覧';
const HEADERS = ['申込番号', '申込日時', '状態', 'プラン', '金額（税込）', '学生数', '学校名', '郵便番号', '所在地', '担当者名', '部署・役職',
  'メールアドレス', '電話番号', '支払期限', '入金確認日', '学校コード', '発行日', 'メモ'];
const STATES = ['入金待ち', '入金確認', '発行済み', 'キャンセル'];
const C = { no: 0, at: 1, state: 2, plan: 3, price: 4, students: 5, school: 6, zip: 7, addr: 8, name: 9, dept: 10, mail: 11, tel: 12, due: 13, paid: 14, code: 15, issued: 16, memo: 17 };

const ISSUER = {
  name: 'ReicherRick',
  rep: '中村 力',
  zip: '〒902-0062',
  addr: '沖縄県那覇市字松川362番地9　シティテラス松川402号',
  service: 'R-eadership（専門学校向け 就職進路管理システム）',
  contact: 'https://jprojectsriki-cpu.github.io/rikis_collection/#contact'
};

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return json_({ ok: true, message: 'R-eadership 受付API is running' }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, message: 'リクエストの形式が正しくありません。' }); }
  try {
    if (req.action === 'apply') return json_(apply_(req));
    return json_({ ok: false, message: '不明な操作です。' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, message: 'エラーが発生しました。時間をおいてもう一度お試しいただくか、お問い合わせフォームからご連絡ください。' });
  }
}

function sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('「' + SHEET_NAME + '」シートがありません。setupReception を実行してください。');
  return sh;
}
function fmt_(d, f) { return Utilities.formatDate(d, 'Asia/Tokyo', f || 'yyyy-MM-dd HH:mm'); }
function clean_(v, n) { return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n); }
function yen_(n) { return '¥' + Number(n).toLocaleString('ja-JP'); }

/** お申し込みの受付 */
function apply_(req) {
  // ロボットよけ：画面には出していない欄に入力があれば、受け付けたふりをして何もしない
  if (clean_(req.website, 100)) return { ok: true, applyNo: '' };

  const p = {
    plan: String(req.plan || ''),
    students: Number(req.students),
    school: clean_(req.schoolName, 100),
    zip: clean_(req.zip, 8).replace(/[ー－‐−]/g, '-'),
    addr: clean_(req.address, 200),
    name: clean_(req.name, 50),
    dept: clean_(req.department, 100),
    mail: clean_(req.email, 200).toLowerCase(),
    tel: clean_(req.tel, 20)
  };
  const plan = PLANS[p.plan];
  if (!plan) return { ok: false, message: 'プランを選んでください。' };
  if (!(p.students >= 1 && Math.floor(p.students) === p.students)) return { ok: false, message: '学生の人数を確認してください。' };
  if (p.students < plan.min || p.students > plan.max) return { ok: false, message: '学生数と選んだプランが合っていません。プランを選び直してください。' };
  if (!p.school) return { ok: false, message: '学校名を入力してください。' };
  if (!/^\d{3}-?\d{4}$/.test(p.zip)) return { ok: false, message: '郵便番号を確認してください。' };
  if (!p.addr) return { ok: false, message: '所在地を入力してください。' };
  if (!p.name) return { ok: false, message: 'ご担当者のお名前を入力してください。' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.mail)) return { ok: false, message: 'メールアドレスを確認してください。' };
  if (!/^[0-9０-９\-－()（）+ ]{10,20}$/.test(p.tel)) return { ok: false, message: '電話番号を確認してください。' };
  if (req.agree !== true) return { ok: false, message: '利用規約とプライバシーポリシーへの同意が必要です。' };

  // 同じメールアドレスからの続けての申し込みと、短い時間に大量の申し込みを止める
  const cache = CacheService.getScriptCache();
  const mailKey = 'apply_' + Utilities.base64EncodeWebSafe(p.mail).slice(0, 200);
  if (cache.get(mailKey)) return { ok: false, message: 'このメールアドレスからのお申し込みを受け付けたばかりです。受付メールをご確認ください。届いていない場合は、10分ほどたってからお試しください。' };
  const count = Number(cache.get('apply_count') || 0);
  if (count >= 20) return { ok: false, message: 'ただいまお申し込みが集中しています。時間をおいてお試しください。' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let row;
  try {
    const props = PropertiesService.getScriptProperties();
    const seq = Number(props.getProperty('SEQ_APPLY') || 0) + 1;
    props.setProperty('SEQ_APPLY', String(seq));
    const now = new Date();
    const due = new Date(now.getTime() + PAY_DAYS * 86400000);
    row = new Array(HEADERS.length).fill('');
    row[C.no] = 'RD' + fmt_(now, 'yyyy') + '-' + String(seq).padStart(4, '0');
    row[C.at] = fmt_(now); row[C.state] = '入金待ち'; row[C.plan] = plan.label; row[C.price] = plan.price;
    row[C.students] = p.students; row[C.school] = p.school; row[C.zip] = p.zip; row[C.addr] = p.addr;
    row[C.name] = p.name; row[C.dept] = p.dept; row[C.mail] = p.mail; row[C.tel] = p.tel;
    row[C.due] = fmt_(due, 'yyyy-MM-dd');
    sheet_().appendRow(row);
  } finally {
    lock.releaseLock();
  }
  cache.put(mailKey, '1', 600);
  cache.put('apply_count', String(count + 1), 3600);

  sendReceipt_(row);
  notifyAdmin_('【R-eadership】お申し込みがありました（' + row[C.no] + '）',
    row[C.school] + '（' + row[C.plan] + '・' + yen_(row[C.price]) + '）\n担当：' + row[C.name] + '　' + row[C.mail] + '　' + row[C.tel] +
    '\n支払期限：' + row[C.due] + '\n\nスプレッドシート「R-eadership_受付」の「申込一覧」を確認してください。');
  return { ok: true, applyNo: row[C.no], email: row[C.mail], due: row[C.due] };
}

/** 振込先（スクリプト プロパティ BANK_INFO） */
function bankInfo_() {
  const b = String(PropertiesService.getScriptProperties().getProperty('BANK_INFO') || '').trim();
  if (!b) throw new Error('スクリプト プロパティに BANK_INFO（振込先）を入れてください。');
  return b;
}
function notifyAdmin_(subject, body) {
  const to = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if (to) MailApp.sendEmail({ to: to, subject: subject, body: body, name: 'R-eadership 受付' });
}
function replyTo_() { return PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || ''; }

/** 受付メール（請求書のPDFを添付） */
function sendReceipt_(row) {
  const no = row[C.no];
  const body = [
    row[C.school],
    (row[C.dept] ? row[C.dept] + '　' : '') + row[C.name] + ' 様',
    '',
    'このたびは、' + ISSUER.service + 'にお申し込みいただき、ありがとうございます。',
    '以下の内容でお申し込みを受け付けました。',
    '',
    '■ 申込番号：' + no,
    '■ プラン　：' + row[C.plan] + '（お申し込み時の学生数 ' + row[C.students] + '人）',
    '■ 金額　　：' + yen_(row[C.price]) + '（税込・買い切り）',
    '■ 支払期限：' + row[C.due],
    '',
    '■ お振込先',
    bankInfo_(),
    '',
    '※ お振込みの際は、振込名義の前に申込番号の数字4けた（' + no.slice(-4) + '）を付けてください。',
    '　（例：' + no.slice(-4) + ' ○○センモンガッコウ）',
    '※ 振込手数料は、ご負担をお願いいたします。',
    '※ 請求書（PDF）を添付しています。',
    '',
    'ご入金を確認したのち、学校専用の環境をご用意し、学校コードと学校管理者のアカウントをメールでお送りします。',
    '支払期限までにご入金が確認できない場合は、お申し込みを取り消させていただくことがあります。',
    '',
    'ご不明な点は、このメールにご返信いただくか、お問い合わせフォームからご連絡ください。',
    ISSUER.contact,
    '',
    '――――――――――――――――',
    ISSUER.name + '（代表 ' + ISSUER.rep + '）',
    ISSUER.service,
    '――――――――――――――――'
  ].join('\n');
  MailApp.sendEmail({
    to: row[C.mail],
    subject: '【R-eadership】お申し込みを受け付けました（申込番号 ' + no + '）',
    body: body,
    name: 'R-eadership（' + ISSUER.name + '）',
    replyTo: replyTo_(),
    attachments: [invoicePdf_(row)]
  });
}

/* =========================================================
 * スプレッドシートのメニュー（中村が使う）
 * ========================================================= */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('R-eadership受付')
    .addItem('選んだ申込の「入金を確認した」（学校にメールを送る）', 'menuPaid')
    .addItem('選んだ申込を「発行済み」にする', 'menuIssued')
    .addItem('選んだ申込を「キャンセル」にする', 'menuCancel')
    .addSeparator()
    .addItem('請求書を作り直して送る（選んだ申込）', 'menuResendInvoice')
    .addItem('テスト：見本の請求書を自分に送る', 'testInvoice')
    .addToUi();
}

/** 選んでいる行の申込を取り出す */
function selected_() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEET_NAME) { ui.alert('「' + SHEET_NAME + '」シートで、申込の行を選んでから使ってください。'); return null; }
  const r = sh.getActiveRange().getRow();
  if (r < 2) { ui.alert('申込の行（2行目から下）を選んでから使ってください。'); return null; }
  const row = sh.getRange(r, 1, 1, HEADERS.length).getValues()[0];
  if (!String(row[C.no]).trim()) { ui.alert('選んだ行に申込がありません。'); return null; }
  return { sheet: sh, r: r, row: row };
}

function menuPaid() {
  const s = selected_(); if (!s) return;
  const ui = SpreadsheetApp.getUi();
  if (s.row[C.state] !== '入金待ち') { ui.alert('この申込の状態は「' + s.row[C.state] + '」です。「入金待ち」の申込だけ、入金を確認できます。'); return; }
  if (ui.alert('入金の確認', s.row[C.no] + '　' + s.row[C.school] + '（' + yen_(s.row[C.price]) + '）の入金を確認しましたか？\n「はい」を押すと、状態を「入金確認」にして、学校に確認のメールを送ります。', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  s.sheet.getRange(s.r, C.state + 1).setValue('入金確認');
  s.sheet.getRange(s.r, C.paid + 1).setValue(fmt_(new Date(), 'yyyy-MM-dd'));
  MailApp.sendEmail({
    to: s.row[C.mail],
    subject: '【R-eadership】ご入金を確認しました（申込番号 ' + s.row[C.no] + '）',
    body: [s.row[C.school], s.row[C.name] + ' 様', '', 'R-eadershipのご入金（' + yen_(s.row[C.price]) + '）を確認しました。ありがとうございます。',
      'ただいま学校専用の環境をご用意しています。準備ができしだい（3営業日以内をめやすに）、学校コードと学校管理者のアカウントを、別のメールでお送りします。',
      '', '――――――――――――――――', ISSUER.name + '（代表 ' + ISSUER.rep + '）', ISSUER.service].join('\n'),
    name: 'R-eadership（' + ISSUER.name + '）', replyTo: replyTo_()
  });
  ui.alert('「入金確認」にして、学校にメールを送りました。次は、発行の手順書に沿って学校の環境を用意してください。');
}

function menuIssued() {
  const s = selected_(); if (!s) return;
  const ui = SpreadsheetApp.getUi();
  if (s.row[C.state] !== '入金確認') { ui.alert('この申込の状態は「' + s.row[C.state] + '」です。「入金確認」の申込だけ、発行済みにできます。'); return; }
  const res = ui.prompt('発行済みにする', s.row[C.school] + ' に発行した学校コード（英大文字と数字）を入れてください。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const code = String(res.getResponseText() || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,10}$/.test(code)) { ui.alert('学校コードは、英大文字と数字の3〜10文字です。'); return; }
  s.sheet.getRange(s.r, C.state + 1).setValue('発行済み');
  s.sheet.getRange(s.r, C.code + 1).setValue(code);
  s.sheet.getRange(s.r, C.issued + 1).setValue(fmt_(new Date(), 'yyyy-MM-dd'));
  ui.alert('「発行済み」にしました（学校コード ' + code + '）。');
}

function menuCancel() {
  const s = selected_(); if (!s) return;
  const ui = SpreadsheetApp.getUi();
  if (s.row[C.state] === '発行済み' || s.row[C.state] === 'キャンセル') { ui.alert('この申込は「' + s.row[C.state] + '」のため、キャンセルにできません。'); return; }
  if (ui.alert('キャンセル', s.row[C.no] + '　' + s.row[C.school] + ' の申込を「キャンセル」にしますか？（メールは送りません）', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  s.sheet.getRange(s.r, C.state + 1).setValue('キャンセル');
  ui.alert('「キャンセル」にしました。必要なら、学校に連絡してください。');
}

function menuResendInvoice() {
  const s = selected_(); if (!s) return;
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('請求書を送る', s.row[C.mail] + ' に、受付メール（請求書のPDFつき）をもう一度送りますか？', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const row = s.row.map(function (v, i) { return (i === C.due && v instanceof Date) ? fmt_(v, 'yyyy-MM-dd') : v; });
  sendReceipt_(row);
  ui.alert('送りました。');
}

/** 【テスト】見本の請求書を ADMIN_EMAIL に送る（申込一覧には記録しない） */
function testInvoice() {
  const to = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if (!to) throw new Error('スクリプト プロパティに ADMIN_EMAIL を入れてください。');
  const row = new Array(HEADERS.length).fill('');
  row[C.no] = 'RD' + fmt_(new Date(), 'yyyy') + '-0000'; row[C.at] = fmt_(new Date()); row[C.plan] = PLANS.small.label; row[C.price] = PLANS.small.price;
  row[C.students] = 180; row[C.school] = 'テスト専門学校'; row[C.zip] = '900-0000'; row[C.addr] = '沖縄県那覇市テスト町 1-2-3';
  row[C.name] = 'テスト 担当'; row[C.dept] = '就職対策室'; row[C.mail] = to; row[C.due] = fmt_(new Date(Date.now() + PAY_DAYS * 86400000), 'yyyy-MM-dd');
  sendReceipt_(row);
  Logger.log('見本の受付メール（請求書のPDFつき）を ' + to + ' に送りました');
}

/* =========================================================
 * 準備
 * ========================================================= */

/** 【1回だけ実行】「申込一覧」シートを作る */
function setupReception() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#FFDE00');
  sh.setFrozenRows(1);
  sh.getRange(2, 1, sh.getMaxRows() - 1, HEADERS.length).setNumberFormat('@');
  sh.getRange(2, C.state + 1, sh.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATES, true).setAllowInvalid(false).build());
  [110, 130, 80, 130, 90, 70, 200, 90, 260, 120, 140, 220, 120, 100, 100, 90, 100, 200].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  // 支払期限を過ぎた「入金待ち」の行を、赤くする
  const range = sh.getRange(2, 1, sh.getMaxRows() - 1, HEADERS.length);
  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($C2="入金待ち",$N2<>"",$N2<TEXT(TODAY(),"yyyy-mm-dd"))')
    .setBackground('#FFE3E9').setRanges([range]).build();
  sh.setConditionalFormatRules([rule]);
  ['シート1', 'Sheet1'].forEach(function (n) { const s = ss.getSheetByName(n); if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s); });
  const props = PropertiesService.getScriptProperties();
  Logger.log('「' + SHEET_NAME + '」シートを準備しました');
  Logger.log('ADMIN_EMAIL：' + (props.getProperty('ADMIN_EMAIL') ? '入っています' : 'まだです（スクリプト プロパティに入れてください）'));
  Logger.log('BANK_INFO：' + (props.getProperty('BANK_INFO') ? '入っています' : 'まだです（スクリプト プロパティに入れてください）'));
}
