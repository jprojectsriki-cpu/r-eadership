/* R-eadership 共通ローディング（すべての画面で共通）
 *   RLoading.show('ログインしています')  … 表示（画面の中央で、キューブが回る）
 *   RLoading.hide().then(...)            … 非表示（チラつかないよう、最低限の時間は表示してから消える）
 *   RLoading.wrap('ログインしています', promise) … promise が終わるまで表示する
 * いくつかの読み込みが重なったときは、すべて終わるまで表示し続ける（show の回数だけ hide されたら消える）
 * 使う画面では、css/loading.css と js/loading.js を読み込む
 * ※ show に渡す文字は、プログラムで決めた固定の文字だけにする（入力された値は渡さない）
 */
window.RLoading = (function () {
    'use strict';

    var MIN_SHOW_MS = 700;
    // ロゴの場所は、このファイル（js/loading.js）の場所から決める（どの階層の画面からでも使えるように）
    var LOGO = (function () {
        var s = document.currentScript;
        try { return new URL('../img/logo.png', s ? s.src : location.href).href; } catch (e) { return 'img/logo.png'; }
    })();
    var dlg = null;
    var label = null;
    var shownAt = 0;

    function build() {
        dlg = document.createElement('dialog');
        dlg.className = 'rl-loading';
        dlg.innerHTML =
            '<div class="rl-box" role="status" aria-live="polite">' +
                '<div class="rl-scene" aria-hidden="true">' +
                    '<div class="rl-cube">' +
                        '<div class="rl-face rl-front"><img src="' + LOGO + '" alt=""></div>' +
                        '<div class="rl-face rl-back"></div>' +
                        '<div class="rl-face rl-right"></div>' +
                        '<div class="rl-face rl-left"></div>' +
                        '<div class="rl-face rl-top"></div>' +
                        '<div class="rl-face rl-bottom"></div>' +
                    '</div>' +
                    '<div class="rl-shadow"></div>' +
                '</div>' +
                '<p class="rl-title">Loading<span class="rl-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p>' +
                '<p class="rl-text"></p>' +
            '</div>';
        // Esc キーで閉じられないようにする（処理中に消えると混乱するため）
        dlg.addEventListener('cancel', function (e) { e.preventDefault(); });
        document.body.appendChild(dlg);
        label = dlg.querySelector('.rl-text');
    }

    // 表示を頼まれている数。いくつかの読み込みが重なっても、全部終わるまで出し続ける
    var count = 0;

    function show(text) {
        if (!dlg) build();
        count++;
        label.textContent = text || '読み込んでいます';
        dlg.classList.remove('is-leaving');
        if (!dlg.open) {
            shownAt = Date.now();
            if (typeof dlg.showModal === 'function') dlg.showModal();
            else dlg.setAttribute('open', '');
        }
    }

    function hide() {
        count = Math.max(0, count - 1);
        return new Promise(function (resolve) {
            if (!dlg || !dlg.open || count > 0) { resolve(); return; }
            var wait = Math.max(0, MIN_SHOW_MS - (Date.now() - shownAt));
            window.setTimeout(function () {
                if (count > 0) { resolve(); return; } // 待っているあいだに、次の読み込みが始まった
                dlg.classList.add('is-leaving');
                window.setTimeout(function () {
                    if (count > 0) { dlg.classList.remove('is-leaving'); resolve(); return; }
                    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
                    dlg.classList.remove('is-leaving');
                    resolve();
                }, 200);
            }, wait);
        });
    }

    function wrap(text, promise) {
        show(text);
        return promise.then(
            function (res) { return hide().then(function () { return res; }); },
            function (err) { return hide().then(function () { throw err; }); }
        );
    }

    return { show: show, hide: hide, wrap: wrap };
})();
