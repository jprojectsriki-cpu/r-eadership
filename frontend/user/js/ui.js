/* R-eadership 画面の共通部品（ログイン後の画面で使う）
 *   RUI.el('div', { class: 'x', text: '...' }, [子要素])  … 要素を作る（文字は textContent で入れるので安全）
 *   RUI.toast('保存しました')  /  RUI.toast('エラー', 'error')  … 右下に短いお知らせ
 *   RUI.confirm({ title, message, okLabel, danger }) → Promise<true/false>  … 確認の画面
 *   RUI.form({ title, fields, submitLabel, onSubmit, deleteLabel, onDelete }) … 入力の画面
 *      fields: [{ name, label, value, required, placeholder, maxlength, hint, autocomplete,
 *                 type（text／password／textarea／select／checks〈チェックの一覧・値は配列〉／static〈表示だけ〉／custom〈render・getValue〉）, options（select・checks のとき） }]
 *   RUI.notice(title, [要素], okLabel) → Promise  … OKだけのお知らせの画面
 *   RUI.copyText(text) → Promise<true/false>      … 文字をコピーする
 *   RUI.modal(title, body要素, footer要素, danger) → dialog … 自由な中身のダイアログ
 *   RUI.downloadCsv('名前.csv', [見出し], [[値, …], …])  … CSVを作って保存する（Excel用にBOM付き）
 *      onChange(form, name) … 入力が変わったときに呼ばれる（ほかの欄の選択肢を変えるときに使う）
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

    /* ---------- お知らせの画面（OKだけ） ---------- */
    // body：表示する要素の配列
    function notice(title, body, okLabel) {
        return new Promise(function (resolve) {
            var ok = el('button', { type: 'button', class: 'btn btn-primary', text: okLabel || 'OK' });
            var dlg = modal(title, el('div', { class: 'modal-body' }, body), el('div', { class: 'modal-foot' }, [ok]));
            ok.addEventListener('click', function () { dlg.close(); });
            dlg.addEventListener('close', function () { resolve(); });
            ok.focus();
        });
    }

    /* ---------- 文字をコピーする ---------- */
    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
        }
        return Promise.resolve(false);
    }

    /* ---------- CSVのファイルを作って保存する（Excelで文字化けしないよう、先頭にBOMを付ける） ---------- */
    function downloadCsv(filename, headers, rows) {
        var esc = function (v) { v = String(v == null ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var text = [headers].concat(rows).map(function (r) { return r.map(esc).join(','); }).join('\r\n') + '\r\n';
        var blob = new Blob(['\ufeff' + text], { type: 'text/csv' });
        var a = el('a', { href: URL.createObjectURL(blob), download: filename });
        document.body.append(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
    function todayStamp() {
        var d = new Date();
        return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    }

    /* ---------- プルダウンの選択肢を入れかえる ---------- */
    // options: [{ value, label }]。value が '' のものは「選んでください」などの見出しに使う
    function setOptions(select, options, value) {
        select.replaceChildren();
        var groupEl = null;
        options.forEach(function (o) {
            var op = el('option', { value: String(o.value), text: o.label });
            if (o.group) {
                if (!groupEl || groupEl.label !== o.group) { groupEl = el('optgroup', { label: o.group }); select.append(groupEl); }
                groupEl.append(op);
            } else {
                groupEl = null;
                select.append(op);
            }
        });
        if (value != null && options.some(function (o) { return String(o.value) === String(value); })) select.value = String(value);
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
            var input;
            if (fd.type === 'custom') {
                // 自由な部品：fd.render() が要素を返し、fd.getValue() で値を読む
                input = fd.render();
                input.id = id;
            } else if (fd.type === 'static') {
                input = el('p', { class: 'static-value', id: id, text: fd.value || '' });
            } else if (fd.type === 'checks') {
                // チェックボックスの一覧（group が同じものをまとめて表示する）。値は配列
                input = el('div', { class: 'check-list', id: id, 'data-name': fd.name, role: 'group' });
                var lastGroup = null;
                (fd.options || []).forEach(function (o) {
                    if (o.group && o.group !== lastGroup) { input.append(el('p', { class: 'check-group', text: o.group })); lastGroup = o.group; }
                    var cb = el('input', { type: 'checkbox', name: fd.name, value: String(o.value) });
                    cb.checked = (fd.value || []).indexOf(o.value) >= 0;
                    input.append(el('label', { class: 'check-item' }, [cb, el('span', { text: o.label })]));
                });
                if (!(fd.options || []).length) input.append(el('p', { class: 'muted', text: fd.emptyText || '選べるものがありません。' }));
            } else if (fd.type === 'select') {
                input = el('select', { id: id, name: fd.name });
                setOptions(input, fd.options || [], fd.value);
            } else {
                input = el(fd.type === 'textarea' ? 'textarea' : 'input', {
                    id: id, name: fd.name, type: fd.type === 'textarea' ? null : (fd.type || 'text'),
                    placeholder: fd.placeholder, maxlength: fd.maxlength, rows: fd.type === 'textarea' ? 3 : null,
                    autocomplete: fd.autocomplete
                });
                input.value = fd.value == null ? '' : fd.value;
            }
            f.append(el('div', { class: 'form-field' }, [
                el(fd.type === 'checks' || fd.type === 'custom' ? 'p' : 'label', { for: fd.type === 'checks' || fd.type === 'custom' ? null : id, class: 'field-label' }, [document.createTextNode(fd.label), fd.type === 'static' ? null : (fd.required ? el('em', { class: 'req', text: '必須' }) : el('em', { text: '任意' }))]),
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

        // 入力し直したら、エラーの文を消す
        f.addEventListener('input', function () { msg.textContent = ''; });
        f.addEventListener('change', function () { msg.textContent = ''; });
        cancel.addEventListener('click', function () { dlg.close(); });
        submit.addEventListener('click', function (e) { e.preventDefault(); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); });
        f.addEventListener('submit', function (e) {
            e.preventDefault();
            var values = {};
            var missing = null;
            (opt.fields || []).forEach(function (fd) {
                if (fd.type === 'checks') {
                    values[fd.name] = Array.prototype.map.call(f.querySelectorAll('input[type=checkbox][name="' + fd.name + '"]:checked'), function (x) { return x.value; });
                    return;
                }
                if (fd.type === 'static') return;
                if (fd.type === 'custom') {
                    values[fd.name] = fd.getValue();
                    if (fd.required && !values[fd.name] && !missing) missing = fd;
                    return;
                }
                var v = f.elements[fd.name].value;
                values[fd.name] = fd.type === 'password' ? v : v.trim();
                if (fd.required && !values[fd.name] && !missing) missing = fd;
            });
            if (missing) { msg.textContent = missing.label + (missing.type === 'select' || missing.type === 'custom' ? 'を選んでください。' : 'を入力してください。'); if (f.elements[missing.name]) f.elements[missing.name].focus(); return; }
            run(opt.onSubmit(values));
        });
        if (del) del.addEventListener('click', function () { run(opt.onDelete()); });
        // 入力に合わせて、ほかの欄を変えたいとき（例：学科を選んだら学年の選択肢を変える）
        if (typeof opt.onChange === 'function') {
            f.addEventListener('change', function (e) { opt.onChange(f, e.target.name); });
            opt.onChange(f, '');
        }
        var first = f.querySelector('input, textarea, select');
        if (first) first.focus();
        return dlg;
    }

    return { el: el, icon: icon, toast: toast, confirm: confirm, form: form, notice: notice, copyText: copyText, setOptions: setOptions, modal: modal, downloadCsv: downloadCsv, todayStamp: todayStamp };
})();
