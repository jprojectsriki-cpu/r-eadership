/* R-eadership アプリ画面（ログイン後）
 * - 開いたら、ログインしているかを確認（していなければログイン画面へ）
 * - 上のバー：学校名・名前・権限・ログアウト
 * - 左のメニュー：画面の切り替え（#dashboard など）。学校管理者メニューは学校管理者だけに表示
 * - スマホでは、メニューのボタンで左から開く
 */
(function () {
    'use strict';

    // 画面の一覧（step は、作る予定のステップ）
    var PAGES = {
        dashboard: { title: 'ダッシュボード', desc: '就職決定率・内定率、就活の状況、会社・進学先ごとの人数、3日以内の予定を表示します。', step: 'L-10' },
        students:  { title: '学生名簿', desc: '学生の一覧と、就職活動の状況を確認します。', step: 'L-8' },
        entries:   { title: '応募管理', desc: '学生ごとの応募（エントリー）と、選考の進み具合・次の予定を記録します。', step: 'L-9' },
        notices:   { title: 'お知らせ', desc: '全体・学校管理者・個人の先生に向けて連絡します。要望・意見は公開範囲を「学校管理者」にして送ります。', step: 'L-11' },
        teachers:  { title: '教員アカウント', desc: '教員アカウントの発行・停止、担当クラス、パスワードの再設定を行います。', step: 'L-7', admin: true },
        classes:   { title: '学科・クラス・資格', desc: '学校の修業年限（何年制か）と、学科・クラス・資格を登録します。学生名簿のプルダウンで使います。', step: 'L-6', admin: true }
    };
    var user = null;

    function $(id) { return document.getElementById(id); }
    function isAdmin() { return user && user.role === 'admin'; }

    /* ---------- メニューの開閉（スマホ） ---------- */
    function setMenu(open) {
        document.body.classList.toggle('menu-open', open);
        $('menuBtn').setAttribute('aria-expanded', String(open));
        $('menuBtn').setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
        $('menuBtn').querySelector('use').setAttribute('href', open ? '#i-x' : '#i-menu');
        $('scrim').hidden = !open;
    }

    /* ---------- 画面の中身 ---------- */
    // js/pages/○○.js で作った画面があればそれを表示し、なければ「準備中」を表示する
    function drawPage(key, page, params) {
        var body = $('pageBody');
        body.replaceChildren();
        var mod = (window.RPages || {})[key];
        if (mod && typeof mod.render === 'function') {
            mod.render(body, { user: user, isAdmin: isAdmin(), params: params });
            return;
        }
        body.append(RUI.el('section', { class: 'panel soon-panel' }, [
            RUI.el('span', { class: 'soon-icon' }, [RUI.icon('i-tool')]),
            RUI.el('p', { class: 'soon-title', text: 'この画面は準備中です' }),
            RUI.el('p', { class: 'soon-text', text: 'このあとのステップ（' + page.step + '）で作ります。' })
        ]));
    }

    /* ---------- 画面の切り替え ---------- */
    function route() {
        // 「#entries?student=S001」のように、? のあとに条件を付けられる
        var parts = location.hash.replace('#', '').split('?');
        var key = parts[0];
        var params = new URLSearchParams(parts[1] || '');
        var page = PAGES[key];
        if (!page || (page.admin && !isAdmin())) {
            key = 'dashboard';
            page = PAGES[key];
            history.replaceState(null, '', '#dashboard');
        }
        document.querySelectorAll('.nav-item[data-page]').forEach(function (a) {
            var on = a.getAttribute('data-page') === key;
            a.classList.toggle('is-active', on);
            if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
        $('pageTitle').textContent = page.title;
        $('pageDesc').textContent = page.desc;
        drawPage(key, page, params);
        if (key !== 'notices') refreshUnread();
        document.title = page.title + ' | R-eadership';
        setMenu(false);
        $('main').focus({ preventScroll: true });
        window.scrollTo(0, 0);
    }

    /* ---------- お知らせの未読の数（メニューに数字を出す） ---------- */
    function setUnread(n) {
        var a = document.querySelector('.nav-item[data-page="notices"]');
        if (!a) return;
        var badge = a.querySelector('.nav-badge');
        if (!n) { if (badge) badge.remove(); return; }
        if (!badge) { badge = RUI.el('span', { class: 'nav-badge' }); a.append(badge); }
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.setAttribute('aria-label', '未読 ' + n + '件');
    }
    function refreshUnread() {
        RApi.post('unreadNotices', {}).then(function (res) { if (res && res.ok) setUnread(res.unread); }).catch(function () {});
    }

    /* ---------- 自分のパスワードの変更 ---------- */
    function changePassword() {
        setMenu(false);
        RUI.form({
            title: 'パスワード変更',
            fields: [
                { name: 'current', label: 'いまのパスワード', type: 'password', required: true, maxlength: 64, autocomplete: 'current-password', hint: '学校管理者から仮のパスワードを受け取ったときは、それを入力します。' },
                { name: 'next', label: '新しいパスワード', type: 'password', required: true, maxlength: 64, autocomplete: 'new-password', hint: '8〜64文字。ほかのサービスと同じものは使わないでください。' },
                { name: 'next2', label: '新しいパスワード（確認）', type: 'password', required: true, maxlength: 64, autocomplete: 'new-password' }
            ],
            submitLabel: '変更する',
            onSubmit: function (v) {
                if (v.next.length < 8) return Promise.resolve({ ok: false, message: '新しいパスワードは、8文字以上にしてください。' });
                if (v.next !== v.next2) return Promise.resolve({ ok: false, message: '新しいパスワードが、確認の欄と一致しません。' });
                return RApi.post('changeMyPassword', { currentPassword: v.current, newPassword: v.next }, '変更しています').then(function (res) {
                    if (res && res.ok) RUI.toast(res.message);
                    return res;
                });
            }
        });
    }

    /* ---------- 開いたとき ---------- */
    function showUser() {
        $('schoolName').textContent = user.schoolName;
        $('userName').textContent = user.name;
        $('userRole').textContent = isAdmin() ? '学校管理者' : '教員';
        $('userRole').classList.toggle('is-admin', isAdmin());
        // スマホのメニューの上にも表示する
        $('sideSchool').textContent = user.schoolName;
        $('sideName').textContent = user.name;
        $('sideRole').textContent = $('userRole').textContent;
        $('sideRole').classList.toggle('is-admin', isAdmin());
        document.querySelectorAll('[data-admin-only]').forEach(function (el) { el.hidden = !isAdmin(); });
    }

    function start() {
        if (!RApi.hasSession()) { RApi.toLogin(''); return; }

        $('menuBtn').addEventListener('click', function () { setMenu(!document.body.classList.contains('menu-open')); });
        $('scrim').addEventListener('click', function () { setMenu(false); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
        $('logoutBtn').addEventListener('click', RApi.logout);
        $('logoutBtn2').addEventListener('click', RApi.logout);
        $('pwBtn').addEventListener('click', changePassword);
        $('pwBtn2').addEventListener('click', changePassword);
        window.addEventListener('hashchange', route);

        // 最初の画面の読み込みが終わるまで、ローディングを出し続ける（画面の読み込みが自分のローディングを重ねるため）
        RLoading.show('ログイン状態を確認しています');
        RApi.post('me', {})
            .then(function (res) {
                if (!res || !res.ok) { RLoading.hide(); RApi.toLogin('expired'); return; }
                user = res.user;
                window.RApp = { user: user, setUnread: setUnread }; // 画面（js/pages）から、ログインしている人の情報を見るため
                showUser();
                $('app').hidden = false;
                route();
                RLoading.hide();
            })
            .catch(function (err) {
                console.error(err);
                RLoading.hide();
                RApi.toLogin('error');
            });
    }

    start();
})();
