/* R-eadership 画面の共通部品（ログイン後の画面で使う）
 *   RUI.el('div', { class: 'x', text: '...' }, [子要素])  … 要素を作る（文字は textContent で入れるので安全）
 *   RUI.toast('保存しました')  /  RUI.toast('エラー', 'error')  … 右下に短いお知らせ
 *   RUI.confirm({ title, message, okLabel, danger }) → Promise<true/false>  … 確認の画面
 *   RUI.form({ title, fields, submitLabel, onSubmit, deleteLabel, onDelete }) … 入力の画面
 *      fields: [{ name, label, value, required, placeholder, maxlength, hint, type }]
 *      onSubmit(values) / onDelete() は Promise を返す。結果が { ok: false, message } なら画面にエラーを出して閉じない
 */
window.RUI = (function () {
    'use strict';

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            var v = attrs[k];
            if (v == null || v === false) return;
            if (k === 'text') node.textContent = v;
            else if (k === 'class') node.className = v;
            else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? '' : v);
        });
        (children || []).forEach(function (c) { if (c) node.append(c); });
        return node;
    }
    function icon(id) {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'icon');
        var use = document.createElementNS(ns, 'use');
        use.setAttribute('href', '#' + id);
        svg.append(use);
        return svg;
    }

    /* ---------- 右下のお知らせ ---------- */
    var toastBox = null;
    function toast(text, type) {
        if (!toastBox) { toastBox = el('div', { class: 'toast-box', 'aria-live': 'polite' }); document.body.append(toastBox); }
        var t = el('div', { class: 'toast' + (type === 'error' ? ' is-error' : ''), role: type === 'error' ? 'alert' : 'status', text: text });
        toastBox.append(t);
        setTimeout(function () { t.classList.add('is-leaving'); setTimeout(function () { t.remove(); }, 250); }, type === 'error' ? 5000 : 2800);
    }

    /* ---------- ダイアログの土台 ---------- */
    function modal(title, body, footer, danger) {
        var dlg = el('dialog', { class: 'r-modal' + (danger ? ' is-danger' : ''), 'aria-label': title });
        var closeBtn = el('button', { type: 'button', class: 'icon-btn modal-x', 'aria-label': '閉じる' }, [icon('i-x')]);
        dlg.append(el('div', { class: 'modal-head' }, [el('h2', { text: title }), closeBtn]), body, footer);
        closeBtn.addEventListener('click', function () { dlg.close(); });
        dlg.addEventListener('close', function () { setTimeout(function () { dlg.remove(); }, 0); });
        document.body.append(dlg);
        dlg.showModal();
        return dlg;
    }

    function confirm(opt) {
        return new Promise(function (resolve) {
            var result = false;
            var ok = el('button', { type: 'button', class: 'btn ' + (opt.danger ? 'btn-danger' : 'btn-primary'), text: opt.okLabel || 'OK' });
            var cancel = el('button', { type: 'button', class: 'btn', text: 'キャンセル' });
            var dlg = modal(opt.title || '確認', el('div', { class: 'modal-body' }, [el('p', { class: 'confirm-text', text: opt.message || '' })]),
                el('div', { class: 'modal-foot' }, [cancel, ok]), opt.danger);
            ok.addEventListener('click', function () { result = true; dlg.close(); });
            cancel.addEventListener('click', function () { dlg.close(); });
            dlg.addEventListener('close', function () { resolve(result); });
            cancel.focus();
        });
    }

    function form(opt) {
        var f = el('form', { class: 'modal-form', novalidate: true });
        (opt.fields || []).forEach(function (fd, i) {
            var id = 'ff-' + Date.now() + '-' + i;
            var input = el(fd.type === 'textarea' ? 'textarea' : 'input', {
                id: id, name: fd.name, type: fd.type === 'textarea' ? null : (fd.type || 'text'),
                placeholder: fd.placeholder, maxlength: fd.maxlength, rows: fd.type === 'textarea' ? 3 : null
            });
            input.value = fd.value || '';
            f.append(el('div', { class: 'form-field' }, [
                el('label', { for: id }, [document.createTextNode(fd.label), fd.required ? el('em', { class: 'req', text: '必須' }) : el('em', { text: '任意' })]),
                input,
                fd.hint ? el('p', { class: 'field-hint', text: fd.hint }) : null
            ]));
        });
        var msg = el('p', { class: 'form-error', role: 'alert' });
        f.append(msg);

        var submit = el('button', { type: 'submit', class: 'btn btn-primary', text: opt.submitLabel || '保存する' });
        var cancel = el('button', { type: 'button', class: 'btn', text: 'キャンセル' });
        var del = opt.onDelete ? el('button', { type: 'button', class: 'btn btn-danger-ghost', text: opt.deleteLabel || '削除する' }) : null;
        var foot = el('div', { class: 'modal-foot' }, [del, el('span', { class: 'spacer' }), cancel, submit]);
        var dlg = modal(opt.title, el('div', { class: 'modal-body' }, [f]), foot);

        function run(promise) {
            msg.textContent = '';
            foot.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
            return promise.then(function (res) {
                if (res && res.ok === false) { msg.textContent = res.message || 'うまくいきませんでした。'; return; }
                dlg.close();
            }).catch(function (err) {
                console.error(err);
                msg.textContent = '通信に失敗しました。時間をおいてもう一度お試しください。';
            }).then(function () {
                foot.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
            });
        }

        cancel.addEventListener('click', function () { dlg.close(); });
        submit.addEventListener('click', function (e) { e.preventDefault(); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); });
        f.addEventListener('submit', function (e) {
            e.preventDefault();
            var values = {};
            var missing = null;
            (opt.fields || []).forEach(function (fd) {
                values[fd.name] = f.elements[fd.name].value.trim();
                if (fd.required && !values[fd.name] && !missing) missing = fd;
            });
            if (missing) { msg.textContent = missing.label + 'を入力してください。'; f.elements[missing.name].focus(); return; }
            run(opt.onSubmit(values));
        });
        if (del) del.addEventListener('click', function () { run(opt.onDelete()); });
        var first = f.querySelector('input, textarea');
        if (first) first.focus();
        return dlg;
    }

    return { el: el, icon: icon, toast: toast, confirm: confirm, form: form };
})();
