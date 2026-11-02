/**
 * R-eadership 受付API - 請求書のPDF
 * HTMLで請求書を作り、PDFに変える（Googleの変換を使う）
 */

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 請求書のPDF（Blob）を作る */
function invoicePdf_(row) {
  const issued = String(row[C.at]).slice(0, 10);
  const bank = esc_(bankInfo_()).replace(/\n/g, '<br>');
  const html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><style>' +
    'body{font-family:"Noto Sans JP","Hiragino Sans","Meiryo",sans-serif;color:#1E1B18;font-size:11pt;margin:0;padding:28pt 34pt;}' +
    'h1{font-size:22pt;letter-spacing:8pt;text-align:center;margin:0 0 18pt;padding-bottom:6pt;border-bottom:3pt solid #1E1B18;}' +
    '.meta{text-align:right;font-size:9.5pt;line-height:1.7;}' +
    '.to{font-size:13pt;margin:10pt 0 2pt;border-bottom:1pt solid #1E1B18;display:inline-block;padding-right:40pt;}' +
    '.from{float:right;text-align:right;font-size:9.5pt;line-height:1.7;margin-top:-30pt;}' +
    '.total{margin:22pt 0 14pt;padding:10pt 14pt;background:#FFF6BF;border:1.5pt solid #1E1B18;font-size:14pt;}' +
    '.total b{font-size:20pt;margin-left:14pt;}' +
    'table{width:100%;border-collapse:collapse;margin-top:6pt;}th,td{border:1pt solid #1E1B18;padding:6pt 8pt;font-size:10pt;}' +
    'th{background:#F4EFE6;}td.n{text-align:right;}' +
    '.box{margin-top:14pt;padding:8pt 12pt;border:1pt solid #B5ADA2;font-size:9.5pt;line-height:1.75;}' +
    '.box h2{font-size:10.5pt;margin:0 0 4pt;}' +
    '</style></head><body>' +
    '<h1>請 求 書</h1>' +
    '<div class="meta">請求番号：' + esc_(row[C.no]) + '<br>発行日：' + esc_(issued) + '</div>' +
    '<div class="to">' + esc_(row[C.school]) + '　御中</div>' +
    '<div style="font-size:9.5pt;margin-top:2pt;">' + '〒' + esc_(row[C.zip]) + '　' + esc_(row[C.addr]) + '<br>' + esc_(row[C.dept] ? row[C.dept] + '　' : '') + esc_(row[C.name]) + ' 様</div>' +
       '<div class="from">' + esc_(ISSUER.name) + '<br>代表　' + esc_(ISSUER.rep) + '<br>' + esc_(ISSUER.zip) + '<br>' + ISSUER.addr.split('　').map(esc_).join('<br>') + '</div>' +
    '<p style="margin-top:20pt;">下記のとおりご請求申し上げます。</p>' +
    '<div class="total">ご請求金額（税込）<b>' + esc_(yen_(row[C.price])) + '</b></div>' +
    '<table><tr><th style="width:52%">品目</th><th>数量</th><th>単価（税込）</th><th>金額（税込）</th></tr>' +
    '<tr><td>' + esc_(ISSUER.service) + '<br><span style="font-size:9pt;">' + esc_(row[C.plan]) + '（買い切り）</span></td><td class="n">1</td><td class="n">' + esc_(yen_(row[C.price])) + '</td><td class="n">' + esc_(yen_(row[C.price])) + '</td></tr>' +
    '<tr><td colspan="3" class="n"><b>合計（税込）</b></td><td class="n"><b>' + esc_(yen_(row[C.price])) + '</b></td></tr></table>' +
    '<div class="box"><h2>お支払い期限</h2>' + esc_(row[C.due]) + '</div>' +
    '<div class="box"><h2>お振込先</h2>' + bank + '<br>※ 振込名義の前に、請求番号の数字4けた（' + esc_(String(row[C.no]).slice(-4)) + '）を付けてください。<br>※ 振込手数料は、ご負担をお願いいたします。</div>' +
    '<div class="box"><h2>備考</h2>ご入金を確認したのち、学校専用の環境をご用意し、学校コードと学校管理者のアカウントを発行します。</div>' +
    '</body></html>';
  return Utilities.newBlob(html, 'text/html', 'invoice.html').getAs(MimeType.PDF).setName('R-eadership_請求書_' + row[C.no] + '.pdf');
}
