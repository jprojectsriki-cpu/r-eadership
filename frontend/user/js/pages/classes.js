/* R-eadership 「クラス・資格」の画面（学校管理者だけ）
 * - タブで「クラス」と「資格」を切り替える
 * - 追加・変更は入力の画面で、削除は変更の画面から（確認してから）
 */
(window.RPages = window.RPages || {}).classes = (function () {
    'use strict';

    var el = function () { return RUI.el.apply(null, arguments); };
    var data = { classes: [], qualifications: [] };
    var tab = 'classes';
    var root = null;

    var KINDS = {
        classes: {
            label: 'クラス', key: 'code', saveAction: 'saveClass', deleteAction: 'deleteClass', deleteParam: 'code',
            columns: [
                { key: 'name', label: 'クラス名', main: true },
                { key: 'dept', label: '学科' },
                { key: 'grade', label: '学年' },
                { key: 'code', label: 'クラスコード', mono: true }
            ],
            fields: function (item) {
                return [
                    { name: 'name', label: 'クラス名', value: item.name, required: true, maxlength: 50, placeholder: '例：情報システム科 3年A組' },
                    { name: 'dept', label: '学科', value: item.dept, maxlength: 50, placeholder: '例：情報システム科' },
                    { name: 'grade', label: '学年', value: item.grade, maxlength: 10, placeholder: '例：3' }
                ];
            },
            empty: 'クラスはまだありません。「クラスを追加」から登録してください。'
        },
        qualifications: {
            label: '資格', key: 'id', saveAction: 'saveQualification', deleteAction: 'deleteQualification', deleteParam: 'id',
            columns: [
                { key: 'name', label: '資格名', main: true },
                { key: 'category', label: '分類' },
                { key: 'note', label: '説明' },
                { key: 'id', label: '資格ID', mono: true }
            ],
            fields: function (item) {
                return [
                    { name: 'name', label: '資格名', value: item.name, required: true, maxlength: 50, placeholder: '例：基本情報技術者試験' },
                    { name: 'category', label: '分類', value: item.category, maxlength: 50, placeholder: '例：IT・国家資格' },
                    { name: 'note', label: '説明', value: item.note, maxlength: 200, type: 'textarea' }
                ];
            },
            empty: '資格はまだありません。「資格を追加」から登録してください。'
        }
    };

    function sortList(kind) {
        var list = data[kind];
        if (kind === 'classes') {
            list.sort(function (a, b) {
                return (a.dept || '').localeCompare(b.dept || '', 'ja') || (a.grade || '').localeCompare(b.grade || '', 'ja', { numeric: true }) || a.name.localeCompare(b.name, 'ja', { numeric: true });
            });
        } else {
            list.sort(function (a, b) { return (a.category || '').localeCompare(b.category || '', 'ja') || a.name.localeCompare(b.name, 'ja'); });
        }
    }

    function openForm(kind, item) {
        var k = KINDS[kind];
        var isNew = !item;
        item = item || {};
        RUI.form({
            title: isNew ? k.label + 'を追加' : k.label + 'を変更',
            fields: k.fields(item),
            submitLabel: isNew ? '追加する' : '変更を保存する',
            onSubmit: function (values) {
                if (!isNew) values[k.key] = item[k.key];
                return RApi.post(k.saveAction, { item: values }, '保存しています').then(function (res) {
                    if (res && res.ok) {
                        var list = data[kind];
                        var i = list.findIndex(function (x) { return x[k.key] === res.item[k.key]; });
                        if (i >= 0) list[i] = res.item; else list.push(res.item);
                        sortList(kind);
                        draw();
                        RUI.toast(res.message);
                    }
                    return res;
                });
            },
            deleteLabel: 'この' + k.label + 'を削除',
            onDelete: isNew ? null : function () {
                return RUI.confirm({
                    title: k.label + 'を削除', danger: true, okLabel: '削除する',
                    message: '「' + item.name + '」を削除します。もとに戻せません。よろしいですか？'
                }).then(function (yes) {
                    if (!yes) return { ok: false, message: '' };
                    var params = {};
                    params[k.deleteParam] = item[k.key];
                    return RApi.post(k.deleteAction, params, '削除しています').then(function (res) {
                        if (res && res.ok) {
                            data[kind] = data[kind].filter(function (x) { return x[k.key] !== item[k.key]; });
                            draw();
                            RUI.toast(res.message);
                        }
                        return res;
                    });
                });
            }
        });
    }

    function draw() {
        var k = KINDS[tab];
        var list = data[tab];
        root.replaceChildren();

        // タブ
        var tabs = el('div', { class: 'tabs', role: 'tablist' });
        Object.keys(KINDS).forEach(function (key) {
            tabs.append(el('button', {
                type: 'button', class: 'tab' + (key === tab ? ' is-active' : ''), role: 'tab', 'aria-selected': String(key === tab),
                text: KINDS[key].label + '（' + data[key].length + '）',
                onclick: function () { tab = key; draw(); }
            }));
        });

        // 見出しの行
        var head = el('div', { class: 'list-head' }, [
            el('p', { class: 'list-count', text: k.label + 'の一覧' }),
            el('button', { type: 'button', class: 'btn btn-primary', onclick: function () { openForm(tab, null); } }, [RUI.icon('i-plus'), el('span', { text: k.label + 'を追加' })])
        ]);

        var panel = el('section', { class: 'panel panel-flush' }, [head]);
        if (!list.length) {
            panel.append(el('p', { class: 'empty', text: k.empty }));
        } else {
            var thead = el('tr', {}, k.columns.map(function (c) { return el('th', { scope: 'col', text: c.label }); }).concat([el('th', { scope: 'col', class: 'col-action' }, [el('span', { class: 'sr-only', text: '操作' })])]));
            var tbody = el('tbody');
            list.forEach(function (item) {
                tbody.append(el('tr', {}, k.columns.map(function (c) {
                    return el('td', { 'data-label': c.label, class: (c.main ? 'cell-main' : '') + (c.mono ? ' cell-mono' : ''), text: item[c.key] || '—' });
                }).concat([el('td', { class: 'col-action' }, [
                    el('button', { type: 'button', class: 'btn btn-sm', onclick: function () { openForm(tab, item); } }, [RUI.icon('i-edit'), el('span', { text: '変更' })])
                ])])));
            });
            panel.append(el('div', { class: 'table-wrap' }, [el('table', { class: 'data-table' }, [el('thead', {}, [thead]), tbody])]));
        }
        root.append(tabs, panel);
    }

    function render(body) {
        root = el('div', { class: 'page-classes' });
        body.append(root);
        root.append(el('section', { class: 'panel' }, [el('p', { class: 'empty', text: '読み込んでいます…' })]));
        RApi.post('masters', {}, 'クラスと資格を読み込んでいます').then(function (res) {
            if (!res || !res.ok) { RUI.toast((res && res.message) || '読み込めませんでした。', 'error'); return; }
            data.classes = res.classes;
            data.qualifications = res.qualifications;
            sortList('classes');
            sortList('qualifications');
            draw();
        }).catch(function (err) {
            console.error(err);
            root.replaceChildren(el('section', { class: 'panel' }, [el('p', { class: 'empty', text: '通信に失敗しました。画面を読み込み直してください。' })]));
        });
    }

    return { render: render };
})();
