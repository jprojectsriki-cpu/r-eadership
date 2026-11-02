/* R-eadership 「学科・クラス・資格」の画面（学校管理者だけ）
 * - 上に「学校の修業年限（何年制か）」。クラスの学年は、1年からその年数までの中から選ぶ
 * - タブで「学科」「クラス」「資格」を切り替える（学科とクラスは関係しない。学生ごとに、学科とクラスをそれぞれ選ぶ）
 * - 追加・変更は入力の画面で、削除は一覧の「削除」ボタンから（確認してから）
 * - ラベル：学生名簿などで表示する短い名前（空なら名前を表示）
 */
(window.RPages = window.RPages || {}).classes = (function () {
    'use strict';

    var el = function () { return RUI.el.apply(null, arguments); };
    var data = { schoolYears: 2, departments: [], classes: [], qualifications: [] };
    var tab = 'departments';
    var root = null;
    var MAX_YEARS = 4;
    var LABEL_HINT = '学生名簿などに表示する短い名前です。空のときは、名前をそのまま表示します。';

    function gradeOptions(first) {
        var opts = [{ value: '', label: first }];
        for (var g = 1; g <= data.schoolYears; g++) opts.push({ value: g, label: g + '年' });
        return opts;
    }

    var KINDS = {
        departments: {
            label: '学科', key: 'id', saveAction: 'saveDepartment', deleteAction: 'deleteDepartment', deleteParam: 'id',
            columns: [
                { label: '学科名', main: true, value: function (x) { return x.name; } },
                { label: 'ラベル', tag: true, value: function (x) { return x.label; } },
                { label: '学科ID', mono: true, value: function (x) { return x.id; } }
            ],
            fields: function (item) {
                return [
                    { name: 'name', label: '学科名', value: item.name, required: true, maxlength: 50, placeholder: '例：会計学科' },
                    { name: 'label', label: 'ラベル', value: item.label, maxlength: 20, placeholder: '例：会計', hint: LABEL_HINT }
                ];
            },
            empty: '学科はまだありません。「学科を追加」から登録してください。'
        },
        classes: {
            label: 'クラス', key: 'code', saveAction: 'saveClass', deleteAction: 'deleteClass', deleteParam: 'code',
            columns: [
                { label: 'クラス名', main: true, value: function (x) { return x.name; } },
                { label: 'ラベル', tag: true, value: function (x) { return x.label; } },
                { label: '学年', value: function (x) { return x.grade + '年'; } },
                { label: 'クラスコード', mono: true, value: function (x) { return x.code; } }
            ],
            fields: function (item) {
                return [
                    { name: 'grade', label: '学年', value: item.grade, required: true, type: 'select', options: gradeOptions('選んでください'), hint: 'この学校は ' + data.schoolYears + '年制なので、1〜' + data.schoolYears + '年から選べます。' },
                    { name: 'name', label: 'クラス名', value: item.name, required: true, maxlength: 50, placeholder: '例：1年A組' },
                    { name: 'label', label: 'ラベル', value: item.label, maxlength: 20, placeholder: '例：1A', hint: LABEL_HINT }
                ];
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
        data.classes.sort(function (a, b) { return a.grade - b.grade || jp(a.name, b.name); });
        data.qualifications.sort(function (a, b) { return jp(a.category, b.category) || jp(a.name, b.name); });
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
                        sortAll();
                        draw();
                        RUI.toast(res.message);
                    }
                    return res;
                });
            }
        });
    }

    /* 学校の修業年限（何年制か）を変える */
    function openYears() {
        var opts = [];
        for (var y = 1; y <= MAX_YEARS; y++) opts.push({ value: y, label: y + '年制' });
        RUI.form({
            title: '学校の修業年限を変更',
            fields: [
                { name: 'years', label: '修業年限', value: data.schoolYears, required: true, type: 'select', options: opts,
                  hint: 'クラスの学年は、1年からこの年数までの中から選べます。変えると、学生の卒業予定年度を自動で直します（手で直してある学生は、そのままです）。' }
            ],
            submitLabel: '変更を保存する',
            onSubmit: function (values) {
                return RApi.post('saveSchoolYears', { years: Number(values.years) }, '保存しています').then(function (res) {
                    if (res && res.ok) {
                        data.schoolYears = res.schoolYears;
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

        var years = el('section', { class: 'panel school-years' }, [
            el('div', { class: 'school-years-text' }, [
                el('p', { class: 'school-years-label', text: '学校の修業年限' }),
                el('p', { class: 'school-years-value' }, [el('strong', { text: data.schoolYears + '年制' }), el('span', { class: 'muted', text: 'クラスの学年は 1〜' + data.schoolYears + '年から選べます' })])
            ]),
            el('button', { type: 'button', class: 'btn btn-sm', onclick: openYears }, [RUI.icon('i-edit'), el('span', { text: '変更' })])
        ]);

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
        root.append(years, tabs, panel);
    }

    function render(body) {
        root = el('div', { class: 'page-classes' });
        body.append(root);
        RApi.all([['masters']], '学科・クラス・資格を読み込んでいます').then(function (all) {
            var res = all[0];
            if (!res || !res.ok) { RUI.toast((res && res.message) || '読み込めませんでした。', 'error'); return; }
            data.schoolYears = res.schoolYears || 2;
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
