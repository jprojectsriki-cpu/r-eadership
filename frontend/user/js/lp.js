/* R-eadership LP
 * - 利用規約・プライバシーポリシー・特定商取引法に基づく表記のダイアログを開く／閉じる
 */
(function () {
    'use strict';

    document.addEventListener('click', function (e) {
        var opener = e.target.closest('[data-open]');
        if (opener) {
            var dlg = document.getElementById(opener.getAttribute('data-open'));
            if (dlg && typeof dlg.showModal === 'function') {
                if (!dlg.open) dlg.showModal();
                var body = dlg.querySelector('.modal-box');
                if (body) body.scrollTop = 0;
            }
            return;
        }
        if (e.target.closest('[data-close]')) {
            var d = e.target.closest('dialog');
            if (d) d.close();
            return;
        }
        // ダイアログの外側（暗いところ）を押したら閉じる
        if (e.target.tagName === 'DIALOG' && e.target.open) e.target.close();
    });
})();
