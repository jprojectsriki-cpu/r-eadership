/* R-eadership ログインページ
 * - 学校コードから、その学校のGAS（API）のURLを探す（js/schools.js）
 * - ログイン（成功したら、トークンと学校コードをこのブラウザに保存）
 * - ログインできたら、アプリ画面（app.html）へ移る。すでにログイン中なら、そのまま移る
 * - 「?reason=○○」付きで開かれたら、理由を表示（アプリ画面から戻ってきたとき）
 */
(function () {
    'use strict';

    var SCHOOLS = window.READERSHIP_SCHOOLS || {};
    var TOKEN_KEY = 'readership_token';
    var SCHOOL_KEY = 'readership_school';
    var NG_MESSAGE = '学校コード、教員ID、またはパスワードが正しくありません。';
    var Loader = window.RLoading;

    function $(id) { return document.getElementById(id); }
    function store(key, value) {
        try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (e) { /* 保存できなくても続ける */ }
    }
    function load(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
    function apiUrl(code) {
        var url = SCHOOLS[String(code || '').trim().toUpperCase()] || '';
        return /^https:\/\//.test(url) ? url : '';
    }
    function apiPost(url, data) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(data)
        }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        });
    }
    function setMsg(text, isError) {
        var el = $('loginMsg');
        el.textContent = text || '';
        el.classList.toggle('is-error', !!isError);
    }
    function alertBox(text) {
        var el = $('loginAlert');
        el.textContent = text || '';
        el.hidden = !text;
    }

    /* ---------- 表示の切り替え ---------- */
    function showLogin() { $('loginCard').hidden = false; }
    function goApp() { Loader.show('画面を開いています'); location.replace('app.html'); }

    /* ---------- ログイン ---------- */
    function initForm() {
        var form = $('loginForm');
        var f = form.elements;
        var btn = form.querySelector('button[type="submit"]');

        // 前にログインした学校コードを入れておく
        f.schoolCode.value = load(SCHOOL_KEY);
        f.schoolCode.addEventListener('input', function () {
            var pos = this.selectionStart;
            this.value = this.value.toUpperCase();
            this.setSelectionRange(pos, pos);
        });

        $('pwToggle').addEventListener('click', function () {
            var show = f.password.type === 'password';
            f.password.type = show ? 'text' : 'password';
            this.setAttribute('aria-pressed', String(show));
            this.textContent = show ? '隠す' : '表示';
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            alertBox('');
            var code = f.schoolCode.value.trim().toUpperCase();
            var id = f.teacherId.value.trim();
            var pw = f.password.value;
            if (!code || !id || !pw) return setMsg('学校コード、教員ID、パスワードを入力してください。', true);
            var url = apiUrl(code);
            if (!url) return setMsg(NG_MESSAGE, true);

            setMsg('');
            btn.disabled = true;
            Loader.wrap('ログインしています', apiPost(url, { action: 'login', schoolCode: code, teacherId: id, password: pw }))
                .then(function (res) {
                    if (res && res.ok) {
                        store(TOKEN_KEY, res.token);
                        store(SCHOOL_KEY, code);
                        f.password.value = '';
                        goApp();
                        return;
                    } else {
                        setMsg((res && res.message) || 'ログインに失敗しました。', true);
                    }
                })
                .catch(function (err) {
                    console.error(err);
                    setMsg('通信に失敗しました。時間をおいてもう一度お試しください。', true);
                })
                .then(function () { btn.disabled = false; });
        });
    }

    /* ---------- 開いたとき ---------- */
    function start() {
        var reason = new URLSearchParams(location.search).get('reason');
        var REASONS = {
            replaced: '別の端末でログインされたため、ログアウトしました。',
            expired: 'ログインの有効期限が切れました。もう一度ログインしてください。',
            stopped: 'このアカウントは現在ご利用いただけません。学校管理者にお問い合わせください。',
            changed: 'アカウントの設定が変わったため、ログアウトしました。もう一度ログインしてください。',
            error: '通信に失敗しました。時間をおいてもう一度ログインしてください。'
        };
        if (REASONS[reason]) alertBox(REASONS[reason]);
        if (reason === 'logout') setMsg('ログアウトしました。');
        if (reason) history.replaceState(null, '', location.pathname); // 再読み込みで同じ表示が出ないように

        var token = load(TOKEN_KEY);
        var url = apiUrl(load(SCHOOL_KEY));
        if (!token || !url) { showLogin(); return; }

        // すでにログインしているかを確認する
        Loader.wrap('ログイン状態を確認しています', apiPost(url, { action: 'me', token: token }))
            .then(function (res) {
                if (res && res.ok) { goApp(); return; }
                store(TOKEN_KEY, '');
                showLogin();
                if (res && res.message && res.reason !== 'expired') alertBox(res.message);
            })
            .catch(function () { showLogin(); });
    }

    initForm();
    start();
})();
