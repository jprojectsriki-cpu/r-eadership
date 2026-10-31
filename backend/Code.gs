/**
 * R-eadership API - 入口
 * 画面（GitHub Pages）から { action: '○○', ... } の形のJSONを POST で受け取り、JSONで返す
 * ※ getSheet_ と SHEETS は Setup.gs のものを使う
 */

/** GETの入口（動いているかの確認用） */
function doGet() {
  return json_({ ok: true, message: 'R-eadership API is running' });
}

/** オブジェクトをJSONで返す */
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** POSTの入口 */
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, message: 'リクエストの形式が正しくありません。' });
  }

  try {
    switch (req.action) {
      case 'ping':
        return json_({ ok: true, school: getSchoolInfo_().name });
      default:
        return json_({ ok: false, message: '不明な操作です。' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, message: 'エラーが発生しました。時間をおいてもう一度お試しください。' });
  }
}
