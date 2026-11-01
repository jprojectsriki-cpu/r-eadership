/* R-eadership 「教員アカウント」の画面（学校管理者だけ）
 * - 一覧：名前・教員ID・権限・担当クラス・状態・最終ログイン
 * - 発行：教員ID・名前・権限・担当クラスを入れると、仮のパスワードを1回だけ表示する
 * - 変更：名前・権限・担当クラス（教員IDは変えられない）
 * - 停止／再開、パスワードの再設定（新しい仮のパスワードを1回だけ表示する）
 */
(window.RPages = window.RPages || {}).teachers = (function () {
    'use strict';

    var el = function () { return RUI.el.apply(null, arguments); };
    var data = { teachers: [], departments: [], classes: [] };
    var me = null;
    var root = null;

    function classLabel(code) {
        var c = data.classes.find(function (x) { return x.code === code; });
        return c ? (c.label || c.name) : code;
    }
    function isMe(t) { return me && t.teacherId.toLowerCase() === me.teacherId.toLowerCase(); }

    // 担当クラスのチェックの一覧（学科ごとにまとめる）
    function classOptions() {
        return data.classes.map(function (c) {
            var d = data.departments.find(function (x) { return x.id === c.deptId; });
            return { value: c.code, label: (c.label || c.name) + '（' + c.grade + '年）', group: d ? d.name : 'その他' };
        });
    }

    function replaceItem(item) {
        var i = data.teachers.findIndex(function (t) { return t.teacherId === item.teacherId; });
        if (i >= 0) data.teachers[i] = item; else data.teachers.push(item);
    }

    /* 仮のパスワードを見せる（この画面を閉じると、もう表示できない） */
    function showTempPassword(teacher, password, isReset) {
        var pwBox = el('p', { class: 'temp-pw', text: password });
        var copyBtn = el('button', { type: 'button', class: 'btn btn-sm' }, [RUI.icon('i-copy'), el('span', { text: 'コピー' })]);
        copyBtn.addEventListener('click', function () {
            RUI.copyText(password).then(function (ok) { RUI.toast(ok ? 'コピーしました。' : 'コピーできませんでした。文字を選んでコピーしてください。', ok ? '' : 'error'); });
        });
        return RUI.notice(isReset ? 'パスワードを再設定しました' : '教員アカウントを発行しました', [
            el('dl', { class: 'temp-info' }, [
                el('dt', { text: '名前' }), el('dd', { text: teacher.name }),
                el('dt', { text: '教員ID' }), el('dd', { text: teacher.teacherId }),
                el('dt', { text: '仮のパスワード' }), el('dd', {}, [el('div', { class: 'temp-pw-row' }, [pwBox, copyBtn])])
            ]),
            el('p', { class: 'temp-warn', text: 'この画面を閉じると、仮のパスワードはもう表示できません。' }),
            el('p', { class: 'temp-note', text: '学校コード・教員ID・仮のパスワードを本人に伝え、ログインしたら右上の「パスワード変更」で、自分のパスワードに変えてもらってください。' })
        ], '伝えたので閉じる');
    }

    function openForm(t) {
        var isNew = !t;
        t = t || { role: 'teacher', classes: [] };
        var fields = [];
        if (isNew) {
            fields.push({ name: 'teacherId', label: '教員ID', required: true, maxlength: 20, placeholder: '例：yamada', autocomplete: 'off', hint: 'ログインに使います。英数字と - _ の3〜20文字。あとから変えられません。' });
        } else {
            fields.push({ name: 'teacherIdView', label: '教員ID', type: 'static', value: t.teacherId });
        }
        fields.push(
            { name: 'name', label: '名前', value: t.name, required: true, maxlength: 50, placeholder: '例：山田 花子' },
            { name: 'role', label: '権限', value: t.role, required: true, type: 'select', options: [
                { value: 'teacher', label: '教員（担当クラスの学生だけ）' },
                { value: 'admin', label: '学校管理者（すべての学生・管理メニュー）' }
            ], hint: !isNew && isMe(t) ? '自分の権限は変更できません。' : '' },
            { name: 'classes', label: '担当クラス', value: t.classes, type: 'checks', options: classOptions(),
              emptyText: 'クラスがまだありません。「学科・クラス・資格」で登録してください。' }
        );
        var dlg = RUI.form({
            title: isNew ? '教員アカウントを発行' : '教員アカウントを変更',
            fields: fields,
            submitLabel: isNew ? '発行する' : '変更を保存する',
            onSubmit: function (values) {
                var item = { teacherId: isNew ? values.teacherId : t.teacherId, name: values.name, role: values.role, classes: values.classes };
                if (isNew && !/^[A-Za-z0-9_-]{3,20}$/.test(item.teacherId)) {
                    return Promise.resolve({ ok: false, message: '教員IDは、英数字と - _ の3〜20文字で入力してください。' });
                }
                return RApi.post(isNew ? 'createTeacher' : 'updateTeacher', { item: item }, isNew ? '発行しています' : '保存しています').then(function (res) {
                    if (res && res.ok) {
                        replaceItem(res.item);
                        draw();
                        if (res.tempPassword) setTimeout(function () { showTempPassword(res.item, res.tempPassword, false); }, 50);
                        else RUI.toast(res.message);
                    }
                    return res;
                });
            }
        });
        if (!isNew && isMe(t)) dlg.querySelector('[name=role]').disabled = true;
    }

    function toggleStatus(t) {
        var stop = t.status !== 'stopped';
        RUI.confirm({
            title: stop ? 'アカウントを停止' : 'アカウントを再開', danger: stop, okLabel: stop ? '停止する' : '再開する',
            message: stop
                ? '「' + t.name + '」さんのアカウントを停止します。すぐにログアウトされ、再開するまでログインできなくなります。'
                : '「' + t.name + '」さんのアカウントを再開します。いまのパスワードで、またログインできるようになります。'
        }).then(function (yes) {
            if (!yes) return;
            RApi.post('setTeacherStatus', { teacherId: t.teacherId, stop: stop }, stop ? '停止しています' : '再開しています').then(function (res) {
                if (!res || !res.ok) { RUI.toast((res && res.message) || 'うまくいきませんでした。', 'error'); return; }
                replaceItem(res.item);
                draw();
                RUI.toast(res.message);
            });
        });
    }

    function resetPassword(t) {
        RUI.confirm({
            title: 'パスワードを再設定', danger: true, okLabel: '再設定する',
            message: '「' + t.name + '」さんのパスワードを、新しい仮のパスワードに変えます。いまのパスワードは使えなくなり、すぐにログアウトされます。'
        }).then(function (yes) {
            if (!yes) return;
            RApi.post('resetTeacherPassword', { teacherId: t.teacherId }, '再設定しています').then(function (res) {
                if (!res || !res.ok) { RUI.toast((res && res.message) || 'うまくいきませんでした。', 'error'); return; }
                showTempPassword(t, res.tempPassword, true);
            });
        });
    }

    function draw() {
        root.replaceChildren();
        var list = data.teachers.slice().sort(function (a, b) {
            return (a.status === b.status ? 0 : a.status === 'stopped' ? 1 : -1)
                || (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1)
                || a.name.localeCompare(b.name, 'ja');
        });
        var active = list.filter(function (t) { return t.status !== 'stopped'; }).length;
        var head = el('div', { class: 'list-head' }, [
            el('p', { class: 'list-count', text: '教員アカウント（利用中 ' + active + '人／全 ' + list.length + '人）' }),
            el('button', { type: 'button', class: 'btn btn-primary', onclick: function () { openForm(null); } }, [RUI.icon('i-plus'), el('span', { text: '教員アカウントを発行' })])
        ]);
        var panel = el('section', { class: 'panel panel-flush' }, [head]);

        var tbody = el('tbody');
        list.forEach(function (t) {
            var stopped = t.status === 'stopped';
            var actions = [
                el('button', { type: 'button', class: 'btn btn-sm', 'aria-label': t.name + 'を変更', onclick: function () { openForm(t); } }, [RUI.icon('i-edit'), el('span', { text: '変更' })])
            ];
            if (!isMe(t)) {
                actions.push(
                    el('button', { type: 'button', class: 'btn btn-sm', 'aria-label': t.name + 'のパスワードを再設定', title: 'パスワードを再設定', onclick: function () { resetPassword(t); } }, [RUI.icon('i-key'), el('span', { text: 'PW再設定' })]),
                    el('button', { type: 'button', class: 'btn btn-sm ' + (stopped ? '' : 'btn-danger-line'), 'aria-label': t.name + (stopped ? 'を再開' : 'を停止'), onclick: function () { toggleStatus(t); } },
                        [RUI.icon(stopped ? 'i-play' : 'i-pause'), el('span', { text: stopped ? '再開' : '停止' })])
                );
            }
            var classes = t.classes.length
                ? el('div', { class: 'tag-row' }, t.classes.map(function (c) { return el('span', { class: 'label-tag', text: classLabel(c) }); }))
                : el('span', { class: 'muted', text: t.role === 'admin' ? '（すべてのクラス）' : '（なし）' });
            tbody.append(el('tr', { class: stopped ? 'is-stopped' : '' }, [
                el('td', { class: 'cell-main cell-nowrap', 'data-label': '名前' }, [document.createTextNode(t.name), isMe(t) ? el('span', { class: 'me-tag', text: 'あなた' }) : null]),
                el('td', { class: 'cell-mono', 'data-label': '教員ID', text: t.teacherId }),
                el('td', { 'data-label': '権限' }, [el('span', { class: 'role-tag' + (t.role === 'admin' ? ' is-admin' : ''), text: t.role === 'admin' ? '学校管理者' : '教員' })]),
                el('td', { 'data-label': '担当クラス' }, [classes]),
                el('td', { 'data-label': '状態' }, [el('span', { class: 'status-tag ' + (stopped ? 'is-stopped' : 'is-active'), text: stopped ? '停止中' : '利用中' })]),
                el('td', { 'data-label': '最終ログイン', text: t.lastLoginAt || '—' }),
                el('td', { class: 'col-action' }, [el('div', { class: 'row-actions' }, actions)])
            ]));
        });
        var thead = el('tr', {}, ['名前', '教員ID', '権限', '担当クラス', '状態', '最終ログイン'].map(function (h) { return el('th', { scope: 'col', text: h }); })
            .concat([el('th', { scope: 'col', class: 'col-action' }, [el('span', { class: 'sr-only', text: '操作' })])]));
        panel.append(el('div', { class: 'table-wrap' }, [el('table', { class: 'data-table actions-bottom' }, [el('thead', {}, [thead]), tbody])]));
        root.append(panel);
    }

    function render(body, ctx) {
        me = ctx.user;
        root = el('div', { class: 'page-teachers' });
        body.append(root);
        RApi.all([['teachers'], ['masters']], '教員アカウントを読み込んでいます').then(function (res) {
            if (!res[0] || !res[0].ok) { RUI.toast((res[0] && res[0].message) || '読み込めませんでした。', 'error'); return; }
            data.teachers = res[0].teachers;
            data.departments = (res[1] && res[1].departments) || [];
            data.classes = (res[1] && res[1].classes) || [];
            draw();
        }).catch(function (err) {
            console.error(err);
            root.replaceChildren(el('section', { class: 'panel' }, [el('p', { class: 'empty', text: '通信に失敗しました。画面を読み込み直してください。' })]));
        });
    }

    return { render: render };
})();
