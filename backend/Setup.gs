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
  departments: {
    name: '学科',
    headers: ['学科ID', '学科名', 'ラベル', '作成日時'],
    widths: [90, 220, 110, 140],
    textCols: 3
  },
  classes: {
    name: 'クラス',
    headers: ['クラスコード', 'クラス名', 'ラベル', '学年', '作成日時'],
    widths: [110, 200, 110, 70, 140],
    textCols: 3
  },
  qualifications: {
    name: '資格',
    headers: ['資格ID', '資格名', 'ラベル', '分類', '説明', '作成日時'],
    widths: [110, 220, 110, 120, 280, 140],
    textCols: 5
  },
  students: {
    name: '学生',
    headers: ['学生ID', '学籍番号', '名前', 'ふりがな', '生年月日', '性別', '国籍', '電話番号', 'メールアドレス',
              '学科ID', 'クラスコード', '卒業予定年度', '在籍状態', '希望進路', '進学予定先', '状況', '取得資格', 'メモ', '登録日時', '更新日時'],
    widths: [90, 100, 140, 160, 100, 70, 100, 120, 200, 90, 100, 100, 80, 90, 160, 90, 200, 240, 140, 140],
    textCols: 20,
    lists: {
      6: ['男性', '女性', 'その他', '回答しない'],
      13: ['在籍', '休学', '退学', '除籍', '卒業'],
      14: ['就職希望', '進学希望', '帰国希望', '未定'],
      16: ['未着手', '選考中', '内定', '就職先決定', '選考終了']
    },
    // 列を足したときに、登録済みの学生に入れる値
    defaults: { '在籍状態': '在籍', '希望進路': '未定' }
  },
  studentLogs: {
    name: '学生の変更履歴',
    headers: ['履歴ID', '学生ID', '日時', '項目', '変更前', '変更後', '理由', '変更した教員'],
    widths: [90, 90, 140, 100, 160, 160, 300, 110],
    textCols: 8
  },
  entries: {
    name: '応募',
    headers: ['応募ID', '学生ID', '会社名', '職種', '勤務地', '給与', '選考の段階', '結果', '応募日', '次の予定日', '次の予定の時刻', '次の予定の内容', 'メモ', '作成日時', '更新日時', '更新した教員'],
    widths: [90, 90, 200, 140, 120, 110, 120, 90, 100, 100, 90, 180, 240, 140, 140, 110],
    textCols: 16,
    lists: {
      7: ['エントリー', '書類選考', '筆記・適性検査', '一次面接', '二次面接', '最終面接'],
      8: ['選考中', '内定', '内定承諾', '不採用', '辞退']
    }
  },
  entryLogs: {
    name: '選考の履歴',
    headers: ['履歴ID', '学生ID', '応募ID', '日時', '選考の段階', '結果', '更新した教員'],
    widths: [90, 90, 90, 140, 120, 90, 110],
    textCols: 7
  },
  records: {
    name: '指導記録',
    headers: ['記録ID', '学生ID', '応募ID', '日付', '内容', '記録した教員', '作成日時'],
    widths: [110, 110, 110, 100, 360, 110, 140],
    textCols: 6
  },
  notices: {
    name: 'お知らせ',
    headers: ['お知らせID', 'タイトル', '本文', '重要', '公開範囲', '宛先の教員ID', '投稿した教員', '作成日時', '更新日時', '最後に書きこんだ教員'],
    widths: [90, 220, 360, 70, 100, 200, 110, 140, 140, 120],
    textCols: 10,
    lists: { 4: ['通常', '重要'], 5: ['全体', '学校管理者', '個人'] }
  },
  noticeReplies: {
    name: 'お知らせの返信',
    headers: ['返信ID', 'お知らせID', '本文', '投稿した教員', '作成日時'],
    widths: [90, 90, 360, 110, 140],
    textCols: 5
  },
  noticeReads: {
    name: 'お知らせの既読',
    headers: ['お知らせID', '教員ID', '既読日時'],
    widths: [90, 110, 140],
    textCols: 3
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

    // プルダウンを付けなおす。プルダウンのない列は、入力の決まり（データの入力規則）を消す
    // （列を足したとき、となりの列のプルダウンが引きつがれて、入力できなくなるのを防ぐため）
    for (let col = 1; col <= cols; col++) {
      const list = (def.lists || {})[col];
      const range = sheet.getRange(2, col, rows, 1);
      if (list) {
        range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
      } else {
        range.clearDataValidations();
      }
    }

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
  // 学校の修業年限（何年制か）の欄。なければ「2」で用意する（あとで画面から変えられる）
  const keys = settings.getRange(1, 1, Math.max(settings.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  if (keys.indexOf('修業年限') < 0) settings.appendRow(['修業年限', String(DEFAULT_SCHOOL_YEARS)]);

  // シートの並び順をそろえる
  Object.keys(SHEETS).forEach(function (key, i) {
    const s = ss.getSheetByName(SHEETS[key].name);
    ss.setActiveSheet(s);
    ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(settings);

  Logger.log('シートを準備しました（全' + Object.keys(SHEETS).length + 'シート）。新しく作ったシート：' + (made.length ? made.join('、') : 'なし'));
}

/**
 * 【シートの形を新しくするときに実行】学生シートに足りない列を足し、「学生の変更履歴」シートを作る（L-8）
 * - 見出しの順番どおりに、足りない列をその場所に入れる（入力済みのデータは右にずれるだけで消えない）
 * - 足した列には、登録済みの学生に初めの値を入れる（在籍状態＝在籍、希望進路＝未定）
 * - もう直してあるときは何もしないので、2回実行しても大丈夫
 */
function upgradeStudents() {
  addMissingColumns_(SHEETS.students);
  setupSheets();
  testSheets();
}

/**
 * 【シートの形を新しくするときに実行】応募シートに足りない列（次の予定の時刻）を足し、「選考の履歴」シートを作る（L-9）
 * もう直してあるときは何もしないので、2回実行しても大丈夫
 */
function upgradeEntries() {
  addMissingColumns_(SHEETS.entries);
  setupSheets();
  testSheets();
}

/**
 * 【シートの形を新しくするときに実行】お知らせのシートを新しい形にし、「お知らせの返信」「お知らせの既読」シートを作る（L-11）
 * お知らせシートにデータがあるときは、消さないように止める
 */
function upgradeNotices() {
  const sheet = getSheet_(SHEETS.notices.name);
  const head = String(sheet.getRange(1, 5).getValue()).trim();
  if (head !== '公開範囲' && sheet.getLastRow() >= 2) {
    throw new Error('お知らせシートにデータが入っているため、形を変えられません。中身を確認して、2行目以降を消してから実行してください。');
  }
  if (head !== '公開範囲') {
    sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), SHEETS.notices.headers.length)).clearContent();
    Logger.log('お知らせ：見出しを新しい形にしました');
  } else {
    Logger.log('お知らせ：すでに新しい形です');
  }
  setupSheets();
  testSheets();
}

/**
 * 【1回だけ実行】学科・クラスをシンプルな形にする（L-13）
 * - 修業年限（何年制か）を、学科ごとではなく学校で1つにする（設定シートの「修業年限」。いまの学科でいちばん長い年数を入れる）
 * - 学科を、クラスではなく学生に持たせる（学生シートの「クラスコード」の左に「学科ID」の列を足し、いまのクラスの学科を写す）
 * - 「クラス」シートの学科IDの列と、「学科」シートの修業年限の列を消す
 * - 卒業予定年度は変えない
 * もう直してあるところは何もしないので、2回実行しても大丈夫
 */
function upgradeSimpleStructure() {
  const deptSheet = getSheet_(SHEETS.departments.name);
  const classSheet = getSheet_(SHEETS.classes.name);
  const head = function (sheet, col) { return String(sheet.getRange(1, col).getValue()).trim(); };
  const deptOld = head(deptSheet, 4) === '修業年限';
  const classOld = head(classSheet, 4) === '学科ID';

  // 1. 学校の修業年限
  const settingRows = getSheet_(SHEETS.settings.name).getDataRange().getValues();
  const hasYears = settingRows.some(function (r) { return String(r[0]).trim() === '修業年限' && String(r[1]).trim(); });
  if (!hasYears) {
    let years = DEFAULT_SCHOOL_YEARS;
    if (deptOld && deptSheet.getLastRow() >= 2) {
      const list = deptSheet.getRange(2, 4, deptSheet.getLastRow() - 1, 1).getValues().map(function (r) { return Number(r[0]) || 0; });
      years = Math.min(MAX_YEARS, Math.max.apply(null, list.concat([1])));
    }
    setSetting_('修業年限', String(years));
    Logger.log('学校の修業年限を ' + years + '年制にしました（あとで画面から変えられます）');
  } else {
    Logger.log('学校の修業年限：すでにあります（' + getSchoolYears_() + '年制）');
  }
  // クラスの学年が修業年限より上なら、修業年限をそのクラスの学年に合わせる
  if (classSheet.getLastRow() >= 2) {
    const gradeCol = classOld ? 5 : 4;
    const top = Math.min(MAX_YEARS, Math.max.apply(null, classSheet.getRange(2, gradeCol, classSheet.getLastRow() - 1, 1).getValues().map(function (r) { return Number(r[0]) || 0; })));
    if (top > getSchoolYears_()) {
      setSetting_('修業年限', String(top));
      Logger.log('いちばん上の学年のクラスに合わせて、学校の修業年限を ' + top + '年制にしました');
    }
  }

  // 2. 学生シートに「学科ID」の列を足す
  addMissingColumns_(SHEETS.students);

  // 3. いまのクラスの学科を、学生に写してから、クラスシートの学科IDの列を消す
  if (classOld) {
    const deptOf = {};
    if (classSheet.getLastRow() >= 2) {
      classSheet.getRange(2, 1, classSheet.getLastRow() - 1, 4).getValues().forEach(function (r) {
        deptOf[String(r[0]).trim()] = String(r[3]).trim();
      });
    }
    const stSheet = getSheet_(SHEETS.students.name);
    const last = stSheet.getLastRow();
    let copied = 0;
    if (last >= 2) {
      const rows = stSheet.getRange(2, 1, last - 1, SHEETS.students.headers.length).getValues();
      const col = rows.map(function (r) {
        const now = String(r[ST.dept]).trim();
        if (now) return [now];
        const d = deptOf[String(r[ST.cls]).trim()] || '';
        if (d) copied++;
        return [d];
      });
      stSheet.getRange(2, ST.dept + 1, col.length, 1).setValues(col);
    }
    Logger.log('学生 ' + copied + '人に、いまのクラスの学科を写しました');
    classSheet.deleteColumn(4);
    Logger.log('クラス：学科IDの列を消しました');
  } else {
    Logger.log('クラス：すでに新しい形です');
  }

  // 4. 学科シートの修業年限の列を消す
  if (deptOld) {
    deptSheet.deleteColumn(4);
    Logger.log('学科：修業年限の列を消しました');
  } else {
    Logger.log('学科：すでに新しい形です');
  }

  setupSheets();
  testSheets();
}

/** 見出しの順番どおりに、足りない列をその場所に入れる（入力済みのデータは右にずれるだけ） */
function addMissingColumns_(def) {
  const sheet = getSheet_(def.name);
  def.headers.forEach(function (h, k) {
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const now = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x).trim(); });
    if (now[k] === h) return;
    if (now.indexOf(h) >= 0) throw new Error(def.name + 'シートの列「' + h + '」の場所が、思っていた場所とちがいます。列を手で動かしていないか確認してください。');
    if (k === 0) sheet.insertColumnBefore(1); else sheet.insertColumnAfter(k);
    sheet.getRange(1, k + 1).setValue(h);
    const last = sheet.getLastRow();
    const v = (def.defaults || {})[h];
    if (v && last >= 2) sheet.getRange(2, k + 1, last - 1, 1).setValue(v);
    Logger.log(def.name + '：' + (k + 1) + '列目に「' + h + '」の列を足しました' + (v && last >= 2 ? '（登録済みの ' + (last - 1) + '行は「' + v + '」）' : ''));
  });
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
