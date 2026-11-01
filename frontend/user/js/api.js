/* R-eadership 画面とGAS（API）のやりとり（ログイン後の画面で共通）
 *   RApi.post('action名', { ... }, 'ローディングに出す説明') → Promise（GASからの結果）
 *   - トークンは自動で付ける
 *   - ログインが切れた・別の端末でログインされた・停止された ときは、ログイン画面へ移る
 *   RApi.logout()                         → ログアウトしてログイン画面へ
 * 使う画面では、js/schools.js と js/loading.js のあとに読み込む
 */
window.RApi = (function () {
    'use strict';

    var TOKEN_KEY = 'readership_token';
    var SCHOOL_KEY = 'readership_school';
    var AUTH_REASONS = ['expired', 'replaced', 'stopped', 'changed'];

    function load(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
    function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 無視 */ } }
    function apiUrl() {
        var url = (window.READERSHIP_SCHOOLS || {})[load(SCHOOL_KEY).toUpperCase()] || '';
        return /^https:\/\//.test(url) ? url : '';
    }
    function toLogin(reason) {
        clearToken();
        location.replace('login.html' + (reason ? '?reason=' + encodeURIComponent(reason) : ''));
    }
    function hasSession() { return !!(load(TOKEN_KEY) && apiUrl()); }

    function rawPost(data) {
        return fetch(apiUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(data)
        }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        });
    }

    function post(action, data, loadingText) {
        if (!hasSession()) { toLogin('expired'); return new Promise(function () {}); }
        var body = Object.assign({}, data || {}, { action: action, token: load(TOKEN_KEY) });
        var p = rawPost(body);
        if (loadingText && window.RLoading) p = window.RLoading.wrap(loadingText, p);
        return p.then(function (res) {
            if (res && res.ok === false && AUTH_REASONS.indexOf(res.reason) >= 0) {
                toLogin(res.reason);
                return new Promise(function () {}); // 画面が移るので、このあとの処理はしない
            }
            return res;
        });
    }

    function logout() {
        var token = load(TOKEN_KEY);
        clearToken();
        var go = function () { location.replace('login.html?reason=logout'); };
        if (!token || !apiUrl()) { go(); return; }
        var p = rawPost({ action: 'logout', token: token });
        if (window.RLoading) p = window.RLoading.wrap('ログアウトしています', p);
        p.catch(function () { /* 画面ではログアウト済みにする */ }).then(go);
    }

    return { post: post, logout: logout, hasSession: hasSession, toLogin: toLogin };
})();
