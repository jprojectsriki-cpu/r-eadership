/**
 * R-eadership API - シートの準備
 * 1つの学校に、1つのスプレッドシートとGASを用意する。
 * 新しい学校を始めるときは、このスプレッドシートを「コピーを作成」して使う（GASも一緒にコピーされる）。
 */

// シートの名前と見出し（スプレッドシートのタブ名・1行目と完全に同じにする）
const SHEETS = {
  settings: {
    name: '設定',
    headers: ['項目', '値'],
    widths: [160, 320],
    textCols: 2
  },
  teachers: {
    name: '教員',
    headers: ['教員ID', 'パスワード（暗号化）', 'ソルト', '名前', '権限', '担当クラス', '状態', '作成日時', '最終ログイン日時'],
    widths: [110, 160, 160, 140, 110, 180, 80, 140, 140],
    textCols: 7, // A〜G列は「書式なしテキスト」にする
    lists: { 5: ['学校管理者', '教員'], 7: ['利用中', '停止中'] }
  },
  classes: {
    name: 'クラス',
    headers: ['クラスコード', 'クラス名', '学科', '学年', '作成日時'],
    widths: [110, 180, 160, 70, 140],
    textCols: 4
  },
  qualifications: {
    name: '資格',
    headers: ['資格ID', '資格名', '分類', '説明', '作成日時'],
    widths: [110, 220, 120, 280, 140],
    textCols: 4
  },
  students: {
    name: '学生',
    headers: ['学生ID', '学籍番号', '名前', 'ふりがな', 'クラスコード', '卒業予定年度', '状況', '取得資格', 'メモ', '登録日時', '更新日時'],
    widths: [110, 100, 140, 160, 110, 100, 90, 200, 240, 140, 140],
    textCols: 9,
    lists: { 7: ['未着手', '選考中', '内定', '選考終了'] }
  },
  entries: {
    name: '応募',
    headers: ['応募ID', '学生ID', '会社名', '職種', '勤務地', '給与', '選考の段階', '結果', '応募日', '次の予定日', '次の予定の内容', 'メモ', '作成日時', '更新日時', '更新した教員'],
    widths: [110, 110, 200, 140, 120, 110, 170, 100, 100, 100, 160, 240, 140, 140, 110],
    textCols: 12,
    lists: {
      7: ['書類送付済', '一次面接日程調整中', '二次面接日程調整中', '最終面接日程調整中', '選考終了'],
      8: ['選考中', '内定獲得', '不採用', '辞退']
    }
  },
  records: {
    name: '指導記録',
    headers: ['記録ID', '学生ID', '応募ID', '日付', '内容', '記録した教員', '作成日時'],
    widths: [110, 110, 110, 100, 360, 110, 140],
    textCols: 6
  },
  notices: {
    name: 'お知らせ',
    headers: ['お知らせID', 'タイトル', '本文', '重要', '表示開始日', '表示終了日', '作成した教員', '作成日時'],
    widths: [110, 220, 360, 70, 100, 100, 110, 140],
    textCols: 7,
    lists: { 4: ['通常', '重要'] }
  }
};

/**
 * 【1回だけ実行】すべてのシートを作り、見出し・プルダウン・書式を設定する
 * すでにあるシートは、見出しとプルダウンだけを設定し直す（入力済みのデータは消えない）
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const made = [];

  Object.keys(SHEETS).forEach(function (key) {
    const def = SHEETS[key];
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
      made.push(def.name);
    }
    const cols = def.headers.length;
    sheet.getRange(1, 1, 1, cols).setValues([def.headers]).setFontWeight('bold').setBackground('#FFDE00');
    sheet.setFrozenRows(1);

    const rows = sheet.getMaxRows() - 1;
    if (def.textCols) sheet.getRange(2, 1, rows, def.textCols).setNumberFormat('@');
    sheet.getRange(2, 1, rows, cols).setVerticalAlignment('top');

    Object.keys(def.lists || {}).forEach(function (col) {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(def.lists[col], true)
        .setAllowInvalid(false)
        .build();
      sheet.getRange(2, Number(col), rows, 1).setDataValidation(rule);
    });

    def.widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  });

  // 最初からある空の「シート1」は消す
  ['シート1', 'Sheet1'].forEach(function (name) {
    const s = ss.getSheetByName(name);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  // 設定シートに、学校の情報を書く欄を用意する（値はあとで setupSchool で入れる）
  const settings = ss.getSheetByName(SHEETS.settings.name);
  if (settings.getLastRow() < 2) {
    settings.getRange(2, 1, 3, 2).setValues([['学校名', ''], ['学校コード', ''], ['利用開始日', '']]);
  }

  // シートの並び順をそろえる
  Object.keys(SHEETS).forEach(function (key, i) {
    const s = ss.getSheetByName(SHEETS[key].name);
    ss.setActiveSheet(s);
    ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(settings);

  Logger.log('シートを準備しました（全' + Object.keys(SHEETS).length + 'シート）。新しく作ったシート：' + (made.length ? made.join('、') : 'なし'));
}

/** シートを名前で取得する（なければエラー） */
function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(name + ' シートが見つかりません。setupSheets を実行してください。');
  return sheet;
}

/** 確認用：すべてのシートの見出しをログに出す */
function testSheets() {
  Object.keys(SHEETS).forEach(function (key) {
    const def = SHEETS[key];
    const sheet = getSheet_(def.name);
    const headers = sheet.getRange(1, 1, 1, def.headers.length).getValues()[0];
    const ok = headers.join('|') === def.headers.join('|');
    Logger.log((ok ? 'OK  ' : 'NG  ') + def.name + '（' + headers.length + '列）: ' + headers.join(', '));
  });
}
