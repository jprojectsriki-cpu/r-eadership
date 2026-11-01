/* R-eadership 「学科・クラス・資格」の画面（学校管理者だけ）
 * - タブで「学科」「クラス」「資格」を切り替える
 * - 学科：修業年限（1〜4年制）を登録する。クラスの学年は、その範囲から選ぶ
 * - クラス：学科と学年をプルダウンで選ぶ
 * - 追加・変更は入力の画面で、削除は一覧の「削除」ボタンから（確認してから）
 * - ラベル：学生名簿などで表示する短い名前（空なら名前を表示）
 */
(window.RPages = window.RPages || {}).classes = (function () {
    'use strict';

    var el = function () { return RUI.el.apply(null, arguments); };
    var data = { departments: [], classes: [], qualifications: [] };
    var tab = 'departments';
    var root = null;
    var MAX_YEARS = 4;
    var LABEL_HINT = '学生名簿などに表示する短い名前です。空のときは、名前をそのまま表示します。';

    function deptById(id) { return data.departments.find(function (d) { return d.id === id; }) || null; }
    function shortName(x) { return x ? (x.label || x.name) : ''; }
    function countClasses(deptId) { return data.classes.filter(function (c) { return c.deptId === deptId; }).length; }

    var KINDS = {
        departments: {
            label: '学科', key: 'id', saveAction: 'saveDepartment', deleteAction: 'deleteDepartment', deleteParam: 'id',
            columns: [
                { label: '学科名', main: true, value: function (x) { return x.name; } },
                { label: 'ラベル', tag: true, value: function (x) { return x.label; } },
                { label: '修業年限', value: function (x) { return x.years + '年制'; } },
                { label: 'クラス数', value: function (x) { return countClasses(x.id) + 'クラス'; } },
                { label: '学科ID', mono: true, value: function (x) { return x.id; } }
            ],
            fields: function (item) {
                var years = [{ value: '', label: '選んでください' }];
                for (var y = 1; y <= MAX_YEARS; y++) years.push({ value: y, label: y + '年制' });
                return [
                    { name: 'name', label: '学科名', value: item.name, required: true, maxlength: 50, placeholder: '例：情報システム科' },
                    { name: 'label', label: 'ラベル', value: item.label, maxlength: 20, placeholder: '例：情報', hint: LABEL_HINT },
                    { name: 'years', label: '修業年限', value: item.years, required: true, type: 'select', options: years, hint: 'クラスの学年は、1年からこの年数までの中から選べます。' }
                ];
            },
            empty: '学科はまだありません。「学科を追加」から登録してください。クラスを登録する前に、学科の登録が必要です。'
        },
        classes: {
            label: 'クラス', key: 'code', saveAction: 'saveClass', deleteAction: 'deleteClass', deleteParam: 'code',
            columns: [
                { label: 'クラス名', main: true, value: function (x) { return x.name; } },
                { label: 'ラベル', tag: true, value: function (x) { return x.label; } },
                { label: '学科', value: function (x) { return shortName(deptById(x.deptId)) || '（不明）'; } },
                { label: '学年', value: function (x) { return x.grade + '年'; } },
                { label: 'クラスコード', mono: true, value: function (x) { return x.code; } }
            ],
            fields: function (item) {
                var depts = [{ value: '', label: '選んでください' }].concat(data.departments.map(function (d) {
                    return { value: d.id, label: d.name + '（' + d.years + '年制）' };
                }));
                return [
                    { name: 'name', label: 'クラス名', value: item.name, required: true, maxlength: 50, placeholder: '例：情報システム科 3年A組' },
                    { name: 'label', label: 'ラベル', value: item.label, maxlength: 20, placeholder: '例：情報3A', hint: LABEL_HINT },
                    { name: 'deptId', label: '学科', value: item.deptId, required: true, type: 'select', options: depts },
                    { name: 'grade', label: '学年', value: item.grade, required: true, type: 'select', options: [] }
                ];
            },
            // 学科を選んだら、その学科の修業年限に合わせて学年の選択肢を変える
            onChange: function (form, name, item) {
                if (name && name !== 'deptId') return;
                var d = deptById(form.elements.deptId.value);
                var current = form.elements.grade.value || (item && item.grade) || '';
                var opts = [{ value: '', label: d ? '選んでください' : '先に学科を選んでください' }];
                for (var g = 1; d && g <= d.years; g++) opts.push({ value: g, label: g + '年' });
                RUI.setOptions(form.elements.grade, opts, current);
                form.elements.grade.disabled = !d;
            },
            empty: 'クラスはまだありません。「クラスを追加」から登録してください。'
        },
        qualifications: {
            label: '資格', key: 'id', saveAction: 'saveQualification', deleteAction: 'deleteQualification', deleteParam: 'id',
            columns: [
                { label: '資格名', main: true, value: function (x) { return x.name; } },
                { label: 'ラベル', tag: true, value: function (x) { return x.label; } },
                { label: '分類', value: function (x) { return x.category; } },
                { label: '説明', value: function (x) { return x.note; } },
                { label: '資格ID', mono: true, value: function (x) { return x.id; } }
            ],
            fields: function (item) {
                return [
                    { name: 'name', label: '資格名', value: item.name, required: true, maxlength: 50, placeholder: '例：全経簿記能力検定試験 2級' },
                    { name: 'label', label: 'ラベル', value: item.label, maxlength: 20, placeholder: '例：簿記2級', hint: LABEL_HINT },
                    { name: 'category', label: '分類', value: item.category, maxlength: 50, placeholder: '例：簿記・会計' },
                    { name: 'note', label: '説明', value: item.note, maxlength: 200, type: 'textarea' }
                ];
            },
            empty: '資格はまだありません。「資格を追加」から登録してください。'
        }
    };

    function sortAll() {
        var jp = function (a, b) { return String(a || '').localeCompare(String(b || ''), 'ja', { numeric: true }); };
        data.departments.sort(function (a, b) { return jp(a.id, b.id); });
        var deptOrder = function (id) { var i = data.departments.findIndex(function (d) { return d.id === id; }); return i < 0 ? 999 : i; };
        data.classes.sort(function (a, b) { return deptOrder(a.deptId) - deptOrder(b.deptId) || a.grade - b.grade || jp(a.name, b.name); });
        data.qualifications.sort(function (a, b) { return jp(a.category, b.category) || jp(a.name, b.name); });
    }

    function openForm(kind, item) {
        var k = KINDS[kind];
        var isNew = !item;
        if (kind === 'classes' && !data.departments.length) {
            RUI.toast('先に「学科」タブで学科を登録してください。', 'error');
            return;
        }
        item = item || {};
        RUI.form({
            title: isNew ? k.label + 'を追加' : k.label + 'を変更',
            fields: k.fields(item),
            submitLabel: isNew ? '追加する' : '変更を保存する',
            onChange: k.onChange ? function (form, name) { k.onChange(form, name, item); } : null,
            onSubmit: function (values) {
                if (!isNew) values[k.key] = item[k.key];
                return RApi.post(k.saveAction, { item: values }, '保存しています').then(function (res) {
                    if (res && res.ok) {
                        var list = data[kind];
                        var i = list.findIndex(function (x) { return x[k.key] === res.item[k.key]; });
                        if (i >= 0) list[i] = res.item; else list.push(res.item);
                        sortAll();
                        draw();
                        RUI.toast(res.message);
                    }
                    return res;
                });
            }
        });
    }

    /* 削除：確認してから削除する。使われていて削除できないときは、理由を右下に出す */
    function remove(kind, item) {
        var k = KINDS[kind];
        RUI.confirm({
            title: k.label + 'を削除', danger: true, okLabel: '削除する',
            message: '「' + item.name + '」を削除します。もとに戻せません。よろしいですか？'
        }).then(function (yes) {
            if (!yes) return;
            var params = {};
            params[k.deleteParam] = item[k.key];
            RApi.post(k.deleteAction, params, '削除しています').then(function (res) {
                if (!res || !res.ok) { RUI.toast((res && res.message) || '削除できませんでした。', 'error'); return; }
                data[kind] = data[kind].filter(function (x) { return x[k.key] !== item[k.key]; });
                draw();
                RUI.toast(res.message);
            }).catch(function (err) {
                console.error(err);
                RUI.toast('通信に失敗しました。時間をおいてもう一度お試しください。', 'error');
            });
        });
    }

    function cell(c, item) {
        var v = c.value(item);
        if (c.tag) {
            return el('td', { 'data-label': c.label }, [v ? el('span', { class: 'label-tag', text: v }) : el('span', { class: 'muted', text: '（名前を表示）' })]);
        }
        return el('td', { 'data-label': c.label, class: (c.main ? 'cell-main' : '') + (c.mono ? ' cell-mono' : ''), text: v || '—' });
    }

    function draw() {
        var k = KINDS[tab];
        var list = data[tab];
        root.replaceChildren();

        var tabs = el('div', { class: 'tabs', role: 'tablist' });
        Object.keys(KINDS).forEach(function (key) {
            tabs.append(el('button', {
                type: 'button', class: 'tab' + (key === tab ? ' is-active' : ''), role: 'tab', 'aria-selected': String(key === tab),
                text: KINDS[key].label + '（' + data[key].length + '）',
                onclick: function () { tab = key; draw(); }
            }));
        });

        var head = el('div', { class: 'list-head' }, [
            el('p', { class: 'list-count', text: k.label + 'の一覧' }),
            el('button', { type: 'button', class: 'btn btn-primary', onclick: function () { openForm(tab, null); } }, [RUI.icon('i-plus'), el('span', { text: k.label + 'を追加' })])
        ]);

        var panel = el('section', { class: 'panel panel-flush' }, [head]);
        if (!list.length) {
            panel.append(el('p', { class: 'empty', text: k.empty }));
        } else {
            var thead = el('tr', {}, k.columns.map(function (c) { return el('th', { scope: 'col', text: c.label }); })
                .concat([el('th', { scope: 'col', class: 'col-action' }, [el('span', { class: 'sr-only', text: '操作' })])]));
            var tbody = el('tbody');
            list.forEach(function (item) {
                tbody.append(el('tr', {}, k.columns.map(function (c) { return cell(c, item); }).concat([el('td', { class: 'col-action' }, [
                    el('div', { class: 'row-actions' }, [
                        el('button', { type: 'button', class: 'btn btn-sm', 'aria-label': item.name + 'を変更', onclick: function () { openForm(tab, item); } }, [RUI.icon('i-edit'), el('span', { text: '変更' })]),
                        el('button', { type: 'button', class: 'btn btn-sm btn-danger-line', 'aria-label': item.name + 'を削除', onclick: function () { remove(tab, item); } }, [RUI.icon('i-trash'), el('span', { text: '削除' })])
                    ])
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
        RApi.post('masters', {}, '学科・クラス・資格を読み込んでいます').then(function (res) {
            if (!res || !res.ok) { RUI.toast((res && res.message) || '読み込めませんでした。', 'error'); return; }
            data.departments = res.departments || [];
            data.classes = res.classes || [];
            data.qualifications = res.qualifications || [];
            sortAll();
            draw();
        }).catch(function (err) {
            console.error(err);
            root.replaceChildren(el('section', { class: 'panel' }, [el('p', { class: 'empty', text: '通信に失敗しました。画面を読み込み直してください。' })]));
        });
    }

    return { render: render };
})();
