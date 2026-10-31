/* R-eadership ログインページ
 * - 学校コードから、その学校のGAS（API）のURLを探す（js/schools.js）
 * - ログイン（成功したら、トークンと学校コードをこのブラウザに保存）
 * - すでにログイン中なら、その状態を表示
 * - 「?reason=replaced」「?reason=expired」付きで開かれたら、理由を表示
 */
(function () {
    'use strict';

    var SCHOOLS = window.READERSHIP_SCHOOLS || {};
    var TOKEN_KEY = 'readership_token';
    var SCHOOL_KEY = 'readership_school';
    var NG_MESSAGE = '学校コード、教員ID、またはパスワードが正しくありません。';

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
    function setBusy(btn, busy, label) {
        btn.disabled = busy;
        btn.querySelector('span').textContent = label;
    }

    /* ---------- 表示の切り替え ---------- */
    function showLogin() {
        $('checkCard').hidden = true;
        $('doneCard').hidden = true;
        $('loginCard').hidden = false;
    }
    function showDone(user) {
        $('doneSchool').textContent = user.schoolName + '（' + user.schoolCode + '）';
        $('doneName').textContent = user.name + '（' + user.teacherId + '）';
        $('doneRole').textContent = user.role === 'admin' ? '学校管理者' : '教員';
        $('checkCard').hidden = true;
        $('loginCard').hidden = true;
        $('doneCard').hidden = false;
        // ※ ダッシュボード（L-5〜）ができたら、ここで移動する
    }

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
            setBusy(btn, true, 'ログインしています…');
            apiPost(url, { action: 'login', schoolCode: code, teacherId: id, password: pw })
                .then(function (res) {
                    if (res && res.ok) {
                        store(TOKEN_KEY, res.token);
                        store(SCHOOL_KEY, code);
                        f.password.value = '';
                        f.password.type = 'password';
                        showDone(res.user);
                    } else {
                        setMsg((res && res.message) || 'ログインに失敗しました。', true);
                    }
                })
                .catch(function (err) {
                    console.error(err);
                    setMsg('通信に失敗しました。時間をおいてもう一度お試しください。', true);
                })
                .then(function () { setBusy(btn, false, 'ログイン'); });
        });

        $('logoutBtn').addEventListener('click', function () {
            var token = load(TOKEN_KEY);
            var url = apiUrl(load(SCHOOL_KEY));
            store(TOKEN_KEY, '');
            showLogin();
            setMsg('ログアウトしました。');
            if (token && url) apiPost(url, { action: 'logout', token: token }).catch(function () {});
        });
    }

    /* ---------- 開いたとき ---------- */
    function start() {
        var reason = new URLSearchParams(location.search).get('reason');
        if (reason === 'replaced') alertBox('別の端末でログインされたため、ログアウトしました。');
        if (reason === 'expired') alertBox('ログインの有効期限が切れました。もう一度ログインしてください。');

        var token = load(TOKEN_KEY);
        var url = apiUrl(load(SCHOOL_KEY));
        if (!token || !url) { showLogin(); return; }

        // すでにログインしているかを確認する
        apiPost(url, { action: 'me', token: token })
            .then(function (res) {
                if (res && res.ok) { showDone(res.user); return; }
                store(TOKEN_KEY, '');
                showLogin();
                if (res && res.message && res.reason !== 'expired') alertBox(res.message);
            })
            .catch(function () { showLogin(); });
    }

    initForm();
    start();
})();
