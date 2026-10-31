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
        dashboard: { title: 'ダッシュボード', desc: '3日以内の予定、内定率などの集計、お知らせを表示します。', step: 'L-10' },
        students:  { title: '学生名簿', desc: '学生の一覧と、就職活動の状況を確認します。', step: 'L-8' },
        entries:   { title: '応募管理', desc: '学生ごとの応募（エントリー）と、選考の流れを記録します。', step: 'L-9' },
        notices:   { title: 'お知らせ', desc: '全体・学校管理者・個人の先生に向けて連絡します。要望・意見は「学校管理者」あてに送ります。', step: 'L-11' },
        teachers:  { title: '教員アカウント', desc: '教員アカウントの発行・停止、担当クラス、パスワードの再設定を行います。', step: 'L-7', admin: true },
        classes:   { title: 'クラス・資格', desc: 'クラスと資格を登録します。', step: 'L-6', admin: true }
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
    function drawPage(key, page) {
        var body = $('pageBody');
        body.replaceChildren();
        var mod = (window.RPages || {})[key];
        if (mod && typeof mod.render === 'function') {
            mod.render(body, { user: user, isAdmin: isAdmin() });
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
        var key = location.hash.replace('#', '');
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
        drawPage(key, page);
        document.title = page.title + ' | R-eadership';
        setMenu(false);
        $('main').focus({ preventScroll: true });
        window.scrollTo(0, 0);
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
        window.addEventListener('hashchange', route);

        RApi.post('me', {}, 'ログイン状態を確認しています')
            .then(function (res) {
                if (!res || !res.ok) { RApi.toLogin('expired'); return; }
                user = res.user;
                showUser();
                $('app').hidden = false;
                route();
            })
            .catch(function (err) {
                console.error(err);
                RApi.toLogin('error');
            });
    }

    start();
})();
