/* R-eadership 「学生名簿」の画面
 * - 学校管理者はすべての学生、教員は担当クラスの学生だけが表示される（GASが選んで返す）
 * - しぼりこみ：学科・学年・クラス・在籍状態・卒業予定年度・名前などの検索
 * - 学生を押すと詳しい画面が開き、クラス移動・在籍状態の変更（理由は必須）・取得資格とメモ・変更履歴を扱える
 * - 学校管理者だけ：学生の登録、CSVでまとめて登録、基本情報の変更、削除
 * - クラス・資格は「ラベル」で表示する（ラベルがなければ名前）
 */
(window.RPages = window.RPages || {}).students = (function () {
    'use strict';

    var el = function () { return RUI.el.apply(null, arguments); };
    var ENROLL = ['在籍', '休学', '退学', '除籍', '卒業'];
    var CSV_HEADERS = ['学籍番号', '名前', 'ふりがな', 'クラス', '卒業予定年度'];
    var data = { students: [], departments: [], classes: [], qualifications: [], fiscalYear: 0 };
    var filters = { dept: '', grade: '', cls: '', enroll: '在籍', year: '', q: '' };
    var admin = false;
    var filtersOpen = false;
    var root = null;
    var listBox = null;

    /* ---------- 名前を引く ---------- */
    function cls(code) { return data.classes.find(function (c) { return c.code === code; }) || null; }
    function dept(id) { return data.departments.find(function (d) { return d.id === id; }) || null; }
    function qual(id) { return data.qualifications.find(function (q) { return q.id === id; }) || null; }
    function short(x, fallback) { return x ? (x.label || x.name) : (fallback || '（不明）'); }
    function classText(code) { var c = cls(code); return c ? short(c) : code + '（削除されたクラス）'; }
    function autoYear(classCode) {
        var c = cls(classCode); var d = c && dept(c.deptId);
        return c && d ? String(data.fiscalYear + d.years - c.grade) : '';
    }
    function replaceItem(item) {
        var i = data.students.findIndex(function (s) { return s.id === item.id; });
        if (i >= 0) data.students[i] = item; else data.students.push(item);
    }
    // クラスの選択肢（学科ごとにまとめる）
    function classOptions(first) {
        var opts = [{ value: '', label: first || '選んでください' }];
        data.departments.forEach(function (d) {
            data.classes.filter(function (c) { return c.deptId === d.id; }).forEach(function (c) {
                opts.push({ value: c.code, label: c.name + '（' + c.grade + '年）', group: d.name });
            });
        });
        return opts;
    }

    /* ---------- 札（タグ） ---------- */
    function enrollTag(v) { return el('span', { class: 'st-tag enroll-' + ENROLL.indexOf(v), text: v }); }
    function jobTag(v) {
        var k = { '未着手': 0, '選考中': 1, '内定': 2, '選考終了': 3 }[v];
        return el('span', { class: 'st-tag job-' + (k == null ? 0 : k), text: v });
    }
    function qualTags(ids) {
        if (!ids.length) return el('span', { class: 'muted', text: '—' });
        return el('div', { class: 'tag-row' }, ids.map(function (id) { return el('span', { class: 'label-tag', text: short(qual(id), id) }); }));
    }

    /* =========================================================
     * 一覧
     * ========================================================= */
    function filtered() {
        var q = filters.q.trim().toLowerCase();
        return data.students.filter(function (s) {
            var c = cls(s.classCode);
            if (filters.dept && (!c || c.deptId !== filters.dept)) return false;
            if (filters.grade && (!c || String(c.grade) !== filters.grade)) return false;
            if (filters.cls && s.classCode !== filters.cls) return false;
            if (filters.enroll && s.enroll !== filters.enroll) return false;
            if (filters.year && s.gradYear !== filters.year) return false;
            if (q && (s.name + ' ' + s.kana + ' ' + s.studentNo).toLowerCase().indexOf(q) < 0) return false;
            return true;
        }).sort(function (a, b) {
            return a.studentNo.localeCompare(b.studentNo, 'ja', { numeric: true });
        });
    }

    function toolbar() {
        var bar = el('div', { class: 'filter-bar' });
        var mkSelect = function (key, label, options) {
            var sel = el('select', { 'aria-label': label });
            RUI.setOptions(sel, options, filters[key]);
            sel.addEventListener('change', function () {
                filters[key] = sel.value;
                if (key === 'dept') { filters.grade = ''; filters.cls = ''; }
                if (key === 'grade') filters.cls = '';
                draw();
            });
            return el('label', { class: 'filter filter-more' }, [el('span', { text: label }), sel]);
        };
        var maxYears = 0;
        data.departments.forEach(function (d) { if (!filters.dept || d.id === filters.dept) maxYears = Math.max(maxYears, d.years); });
        var grades = [{ value: '', label: 'すべて' }];
        for (var g = 1; g <= maxYears; g++) grades.push({ value: String(g), label: g + '年' });
        var classes = [{ value: '', label: 'すべて' }].concat(data.classes.filter(function (c) {
            return (!filters.dept || c.deptId === filters.dept) && (!filters.grade || String(c.grade) === filters.grade);
        }).map(function (c) { return { value: c.code, label: short(c) }; }));
        var years = data.students.map(function (s) { return s.gradYear; }).filter(function (y, i, a) { return y && a.indexOf(y) === i; }).sort();
        var search = el('input', { type: 'search', placeholder: '名前・ふりがな・学籍番号', 'aria-label': '検索', value: filters.q });
        search.addEventListener('input', function () { filters.q = search.value; drawList(); });

        // スマホでは、しぼりこみを「しぼりこみ」ボタンで開閉する
        var active = ['dept', 'grade', 'cls', 'enroll', 'year'].filter(function (k) { return filters[k]; }).length;
        var toggle = el('button', { type: 'button', class: 'btn btn-sm filter-toggle', 'aria-expanded': String(filtersOpen) }, [
            RUI.icon('i-filter'), el('span', { text: 'しぼりこみ' + (active ? '（' + active + '）' : '') })
        ]);
        toggle.addEventListener('click', function () {
            filtersOpen = !filtersOpen;
            bar.classList.toggle('is-open', filtersOpen);
            toggle.setAttribute('aria-expanded', String(filtersOpen));
        });
        bar.classList.toggle('is-open', filtersOpen);
        bar.append(
            el('label', { class: 'filter filter-search' }, [el('span', { text: '検索' }), search]),
            toggle,
            mkSelect('dept', '学科', [{ value: '', label: 'すべて' }].concat(data.departments.map(function (d) { return { value: d.id, label: short(d) }; }))),
            mkSelect('grade', '学年', grades),
            mkSelect('cls', 'クラス', classes),
            mkSelect('enroll', '在籍状態', [{ value: '', label: 'すべて' }].concat(ENROLL.map(function (v) { return { value: v, label: v }; }))),
            mkSelect('year', '卒業予定年度', [{ value: '', label: 'すべて' }].concat(years.map(function (y) { return { value: y, label: y + '年度' }; })))
        );
        return bar;
    }

    function drawList() {
        var list = filtered();
        listBox.replaceChildren();
        listBox.append(el('p', { class: 'list-sub', text: list.length + '人' + (list.length !== data.students.length ? '（全 ' + data.students.length + '人中）' : '') }));
        if (!list.length) {
            listBox.append(el('p', { class: 'empty', text: data.students.length
                ? '条件に合う学生はいません。しぼりこみを変えてください。'
                : (admin ? '学生はまだ登録されていません。「学生を登録」か「CSVで登録」から登録してください。' : '担当クラスの学生は、まだ登録されていません。') }));
            return;
        }
        var tbody = el('tbody');
        list.forEach(function (s) {
            var tr = el('tr', { class: 'row-click', tabindex: '0', 'aria-label': s.name + 'の詳しい情報を開く' }, [
                el('td', { class: 'cell-mono', 'data-label': '学籍番号', text: s.studentNo }),
                el('td', { class: 'cell-main cell-student', 'data-label': '名前' }, [el('span', { text: s.name }), s.kana ? el('small', { class: 'kana', text: s.kana }) : null]),
                el('td', { 'data-label': 'クラス' }, [el('span', { class: 'label-tag', text: classText(s.classCode) })]),
                el('td', { 'data-label': '卒業予定', text: s.gradYear ? s.gradYear + '年度' : '—' }),
                el('td', { 'data-label': '在籍' }, [enrollTag(s.enroll)]),
                el('td', { 'data-label': '就活' }, [jobTag(s.job)]),
                el('td', { 'data-label': '取得資格' }, [qualTags(s.quals)])
            ]);
            tr.addEventListener('click', function () { openDetail(s.id); });
            tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(s.id); } });
            tbody.append(tr);
        });
        var thead = el('tr', {}, ['学籍番号', '名前', 'クラス', '卒業予定', '在籍', '就活', '取得資格'].map(function (h) { return el('th', { scope: 'col', text: h }); }));
        listBox.append(el('div', { class: 'table-wrap' }, [el('table', { class: 'data-table student-table' }, [el('thead', {}, [thead]), tbody])]));
    }

    function draw() {
        root.replaceChildren();
        var actions = admin ? el('div', { class: 'head-actions' }, [
            el('button', { type: 'button', class: 'btn', onclick: openImport }, [RUI.icon('i-upload'), el('span', { text: 'CSVで登録' })]),
            el('button', { type: 'button', class: 'btn btn-primary', onclick: function () { openBasicForm(null); } }, [RUI.icon('i-plus'), el('span', { text: '学生を登録' })])
        ]) : null;
        listBox = el('div', { class: 'list-box' });
        root.append(
            el('section', { class: 'panel panel-flush' }, [
                el('div', { class: 'list-head' }, [el('p', { class: 'list-count', text: admin ? '学生名簿（すべてのクラス）' : '学生名簿（担当クラス）' }), actions]),
                toolbar(),
                listBox
            ])
        );
        drawList();
    }

    /* =========================================================
     * 詳しい画面
     * ========================================================= */
    function openDetail(id) {
        var s = data.students.find(function (x) { return x.id === id; });
        if (!s) return;
        var c = cls(s.classCode);
        var d = c && dept(c.deptId);
        var logBox = el('div', { class: 'log-box' }, [el('p', { class: 'muted', text: '変更履歴を読み込んでいます…' })]);
        var body = el('div', { class: 'modal-body student-detail' }, [
            el('p', { class: 'detail-kana', text: s.kana || '' }),
            el('dl', { class: 'detail-list' }, [
                el('dt', { text: '学籍番号' }), el('dd', { text: s.studentNo }),
                el('dt', { text: 'クラス' }), el('dd', { text: c ? c.name + '（' + (d ? d.name : '') + '・' + c.grade + '年）' : classText(s.classCode) }),
                el('dt', { text: '卒業予定' }), el('dd', { text: s.gradYear ? s.gradYear + '年度' : '—' }),
                el('dt', { text: '在籍状態' }), el('dd', {}, [enrollTag(s.enroll)]),
                el('dt', { text: '就活の状況' }), el('dd', {}, [jobTag(s.job), el('span', { class: 'muted detail-note', text: '応募の結果から自動で決まります' })]),
                el('dt', { text: '取得資格' }), el('dd', {}, [qualTags(s.quals)]),
                el('dt', { text: 'メモ' }), el('dd', { class: 'detail-memo', text: s.memo || '—' })
            ]),
            el('h3', { class: 'detail-h', text: '変更履歴（クラス・在籍状態など）' }),
            logBox
        ]);
        var close = function () { dlg.close(); };
        var btn = function (label, iconId, cls2, fn) {
            return el('button', { type: 'button', class: 'btn btn-sm ' + (cls2 || ''), onclick: function () { close(); fn(s); } }, [RUI.icon(iconId), el('span', { text: label })]);
        };
        var foot = el('div', { class: 'modal-foot detail-foot' }, [
            btn('クラス移動', 'i-move', '', openMove),
            btn('在籍状態の変更', 'i-flag', '', openEnroll),
            btn('取得資格・メモ', 'i-edit', '', openNotes),
            admin ? btn('基本情報の変更', 'i-user', '', openBasicForm) : null,
            admin ? btn('削除', 'i-trash', 'btn-danger-line', removeStudent) : null
        ]);
        var dlg = RUI.modal(s.name, body, foot);
        dlg.classList.add('r-modal-wide');

        RApi.post('studentLogs', { studentId: s.id }).then(function (res) {
            logBox.replaceChildren();
            if (!res || !res.ok) { logBox.append(el('p', { class: 'muted', text: (res && res.message) || '読み込めませんでした。' })); return; }
            if (!res.logs.length) { logBox.append(el('p', { class: 'muted', text: 'まだ変更はありません。' })); return; }
            logBox.append(el('ol', { class: 'log-list' }, res.logs.map(function (l) {
                return el('li', {}, [
                    el('p', { class: 'log-head' }, [el('span', { class: 'log-field', text: l.field }), el('span', { text: l.before + ' → ' + l.after })]),
                    el('p', { class: 'log-reason', text: '理由：' + l.reason }),
                    el('p', { class: 'log-meta', text: l.at + '　' + l.by })
                ]);
            })));
        }).catch(function () { logBox.replaceChildren(el('p', { class: 'muted', text: '読み込めませんでした。' })); });
    }

    function afterSave(res, reopenId) {
        if (res && res.ok) {
            if (res.item) replaceItem(res.item);
            draw();
            RUI.toast(res.message);
            // 担当クラスの外に移した教員には、もう表示しない
            if (res.item && !admin) {
                var still = (window.RApp && RApp.user && RApp.user.classes || []).indexOf(res.item.classCode) >= 0;
                if (!still) { data.students = data.students.filter(function (x) { return x.id !== res.item.id; }); draw(); return res; }
            }
            if (reopenId) setTimeout(function () { openDetail(reopenId); }, 60);
        }
        return res;
    }

    /* ---------- クラス移動 ---------- */
    function openMove(s) {
        RUI.form({
            title: s.name + 'さんのクラス移動',
            fields: [
                { name: 'now', label: 'いまのクラス', type: 'static', value: (cls(s.classCode) || { name: s.classCode }).name },
                { name: 'toClass', label: '移動先のクラス', type: 'select', required: true, options: classOptions().filter(function (o) { return o.value !== s.classCode; }) },
                { name: 'reason', label: '移動の理由', type: 'textarea', required: true, maxlength: 200, placeholder: '例：進級のため／学科の変更のため', hint: '変更履歴に残ります。' }
            ],
            submitLabel: '移動する',
            onSubmit: function (v) {
                return RApi.post('moveStudent', { studentId: s.id, toClass: v.toClass, reason: v.reason }, '移動しています').then(function (res) { return afterSave(res, s.id); });
            }
        });
    }

    /* ---------- 在籍状態の変更 ---------- */
    function openEnroll(s) {
        RUI.form({
            title: s.name + 'さんの在籍状態の変更',
            fields: [
                { name: 'now', label: 'いまの在籍状態', type: 'static', value: s.enroll },
                { name: 'status', label: '新しい在籍状態', type: 'select', required: true, options: [{ value: '', label: '選んでください' }].concat(ENROLL.filter(function (v) { return v !== s.enroll; }).map(function (v) { return { value: v, label: v }; })) },
                { name: 'reason', label: '変更の理由', type: 'textarea', required: true, maxlength: 200, placeholder: '例：病気療養のため休学／本人の申し出により退学', hint: '変更履歴に残ります。' }
            ],
            submitLabel: '変更する',
            onSubmit: function (v) {
                return RApi.post('setEnrollStatus', { studentId: s.id, status: v.status, reason: v.reason }, '変更しています').then(function (res) { return afterSave(res, s.id); });
            }
        });
    }

    /* ---------- 取得資格・メモ ---------- */
    function openNotes(s) {
        var opts = data.qualifications.slice().sort(function (a, b) { return (a.category || '').localeCompare(b.category || '', 'ja') || a.name.localeCompare(b.name, 'ja'); })
            .map(function (q) { return { value: q.id, label: short(q) + (q.label ? '（' + q.name + '）' : ''), group: q.category || 'その他' }; });
        RUI.form({
            title: s.name + 'さんの取得資格・メモ',
            fields: [
                { name: 'quals', label: '取得資格', type: 'checks', value: s.quals, options: opts, emptyText: '資格がまだありません。学校管理者が「学科・クラス・資格」で登録します。' },
                { name: 'memo', label: 'メモ', type: 'textarea', value: s.memo, maxlength: 1000, placeholder: '指導のメモなど' }
            ],
            submitLabel: '保存する',
            onSubmit: function (v) {
                return RApi.post('updateStudentNotes', { studentId: s.id, quals: v.quals, memo: v.memo }, '保存しています').then(function (res) { return afterSave(res, s.id); });
            }
        });
    }

    /* ---------- 学校管理者：登録・基本情報の変更 ---------- */
    function openBasicForm(s) {
        var isNew = !s;
        if (isNew && !data.classes.length) { RUI.toast('先に「学科・クラス・資格」でクラスを登録してください。', 'error'); return; }
        s = s || {};
        var fields = [
            { name: 'studentNo', label: '学籍番号', value: s.studentNo, required: true, maxlength: 20, placeholder: '例：2026001' },
            { name: 'name', label: '名前', value: s.name, required: true, maxlength: 50, placeholder: '例：比嘉 太郎' },
            { name: 'kana', label: 'ふりがな', value: s.kana, maxlength: 50, placeholder: '例：ひが たろう' }
        ];
        if (isNew) fields.push({ name: 'classCode', label: 'クラス', type: 'select', required: true, options: classOptions() });
        else fields.push({ name: 'clsView', label: 'クラス', type: 'static', value: classText(s.classCode) + '（クラスは「クラス移動」で変えます）' });
        fields.push({ name: 'gradYear', label: '卒業予定年度', value: s.gradYear, maxlength: 6, placeholder: '例：2027',
            hint: isNew ? 'クラスを選ぶと、学年と修業年限から自動で入ります。留年などのときは直してください。' : '留年などのときに直します。変更履歴に残ります。' });
        var lastAuto = '';
        RUI.form({
            title: isNew ? '学生を登録' : s.name + 'さんの基本情報の変更',
            fields: fields,
            submitLabel: isNew ? '登録する' : '変更を保存する',
            onChange: isNew ? function (form, name) {
                if (name !== 'classCode') return;
                var y = form.elements.gradYear;
                if (!y.value || y.value === lastAuto) { lastAuto = autoYear(form.elements.classCode.value); y.value = lastAuto; }
            } : null,
            onSubmit: function (v) {
                var item = { id: s.id, studentNo: v.studentNo, name: v.name, kana: v.kana, classCode: v.classCode, gradYear: v.gradYear };
                return RApi.post('saveStudent', { item: item }, isNew ? '登録しています' : '保存しています').then(function (res) { return afterSave(res, isNew ? null : s.id); });
            }
        });
    }

    function removeStudent(s) {
        RUI.confirm({
            title: '学生を削除', danger: true, okLabel: '削除する',
            message: '「' + s.name + '」さん（' + s.studentNo + '）を名簿から削除します。もとに戻せません。まちがえて登録したとき以外は、「在籍状態の変更」（退学・卒業など）を使ってください。'
        }).then(function (yes) {
            if (!yes) return;
            RApi.post('deleteStudent', { studentId: s.id }, '削除しています').then(function (res) {
                if (!res || !res.ok) { RUI.toast((res && res.message) || '削除できませんでした。', 'error'); return; }
                data.students = data.students.filter(function (x) { return x.id !== s.id; });
                draw();
                RUI.toast(res.message);
            });
        });
    }

    /* =========================================================
     * CSVでまとめて登録（学校管理者だけ）
     * ========================================================= */
    function csvEscape(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    function downloadTemplate() {
        var sample = data.classes[0];
        var lines = [CSV_HEADERS.join(','), ['2026001', '比嘉 太郎', 'ひが たろう', sample ? short(sample) : 'クラスのラベル', ''].map(csvEscape).join(',')];
        var blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' });
        var a = el('a', { href: URL.createObjectURL(blob), download: '学生名簿_ひな形.csv' });
        document.body.append(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
    // CSVの文字を、行と列に分ける（"" で囲んだ中の , と改行に対応）
    function parseCsv(text) {
        var rows = [], row = [], cur = '', q = false;
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (q) {
                if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
                else cur += ch;
            } else if (ch === '"') q = true;
            else if (ch === ',') { row.push(cur); cur = ''; }
            else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && text[i + 1] === '\n') i++;
                row.push(cur); rows.push(row); row = []; cur = '';
            } else cur += ch;
        }
        if (cur || row.length) { row.push(cur); rows.push(row); }
        return rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
    }
    // Excelで保存したCSV（Shift_JIS）と、UTF-8の両方を読めるようにする
    function readFileText(file) {
        return file.arrayBuffer().then(function (buf) {
            try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
            catch (e) { return new TextDecoder('shift_jis').decode(buf); }
        });
    }

    function openImport() {
        var parsed = null;
        var fileInput = el('input', { type: 'file', accept: '.csv,text/csv', id: 'csvFile' });
        var result = el('div', { class: 'import-result', 'aria-live': 'polite' });
        var submit = el('button', { type: 'button', class: 'btn btn-primary', text: '登録する', disabled: true });
        var cancel = el('button', { type: 'button', class: 'btn', text: 'キャンセル' });
        var body = el('div', { class: 'modal-body' }, [
            el('ol', { class: 'import-steps' }, [
                el('li', {}, [document.createTextNode('ひな形をダウンロードして、Excelなどで学生を入力します。'), el('button', { type: 'button', class: 'btn btn-sm', onclick: downloadTemplate }, [RUI.icon('i-download'), el('span', { text: 'ひな形（CSV）' })])]),
                el('li', { text: '「クラス」には、クラスのラベル・クラス名・クラスコードのどれかを入れます。「卒業予定年度」は空でもかまいません（自動で入ります）。' }),
                el('li', { text: 'CSV形式で保存したファイルを選びます。まず内容を確かめ、まちがいがなければ「登録する」を押します。' })
            ]),
            el('div', { class: 'form-field' }, [el('label', { for: 'csvFile', class: 'field-label', text: 'CSVファイル' }), fileInput]),
            result
        ]);
        var dlg = RUI.modal('CSVで学生をまとめて登録', body, el('div', { class: 'modal-foot' }, [cancel, submit]));
        cancel.addEventListener('click', function () { dlg.close(); });

        var showErrors = function (title, list, more) {
            result.replaceChildren(el('div', { class: 'import-error' }, [
                el('p', { class: 'import-title', text: title }),
                list && list.length ? el('ul', {}, list.map(function (m) { return el('li', { text: m }); })) : null,
                more ? el('p', { class: 'muted', text: more }) : null
            ]));
        };

        fileInput.addEventListener('change', function () {
            parsed = null; submit.disabled = true; result.replaceChildren();
            var file = fileInput.files[0];
            if (!file) return;
            readFileText(file).then(function (text) {
                var rows = parseCsv(text);
                if (rows.length < 2) { showErrors('学生の行がありません。1行目に見出し、2行目から学生を入れてください。'); return; }
                var head = rows[0].map(function (h) { return String(h).trim(); });
                var idx = CSV_HEADERS.map(function (h) { return head.indexOf(h); });
                var missing = CSV_HEADERS.filter(function (h, i) { return idx[i] < 0 && h !== 'ふりがな' && h !== '卒業予定年度'; });
                if (missing.length) { showErrors('1行目の見出しに「' + missing.join('」「') + '」がありません。ひな形の見出しを使ってください。'); return; }
                var get = function (r, i) { return idx[i] >= 0 ? String(r[idx[i]] || '').trim() : ''; };
                var items = rows.slice(1).map(function (r) { return { studentNo: get(r, 0), name: get(r, 1), kana: get(r, 2), cls: get(r, 3), gradYear: get(r, 4) }; });
                return RApi.post('importStudents', { rows: items, dryRun: true }, 'CSVの内容を確かめています').then(function (res) {
                    if (!res || !res.ok) {
                        showErrors(res.message || '確かめられませんでした。', res.errors, res.errorCount > (res.errors || []).length ? 'ほかに ' + (res.errorCount - res.errors.length) + ' か所あります。' : '');
                        return;
                    }
                    parsed = items;
                    submit.disabled = false;
                    result.replaceChildren(el('p', { class: 'import-ok', text: res.message + '「登録する」を押してください。' }));
                });
            }).catch(function (err) {
                console.error(err);
                showErrors('ファイルを読み込めませんでした。CSV形式で保存したファイルを選んでください。');
            });
        });

        submit.addEventListener('click', function () {
            if (!parsed) return;
            submit.disabled = true;
            RApi.post('importStudents', { rows: parsed }, '登録しています').then(function (res) {
                if (!res || !res.ok) { showErrors(res.message || '登録できませんでした。', res.errors); return; }
                res.items.forEach(replaceItem);
                dlg.close();
                draw();
                RUI.toast(res.message);
            }).catch(function () { submit.disabled = false; showErrors('通信に失敗しました。時間をおいてもう一度お試しください。'); });
        });
    }

    /* =========================================================
     * 開いたとき
     * ========================================================= */
    function render(body, ctx) {
        admin = ctx.isAdmin;
        root = el('div', { class: 'page-students' });
        body.append(root);
        root.append(el('section', { class: 'panel' }, [el('p', { class: 'empty', text: '読み込んでいます…' })]));
        Promise.all([RApi.post('students', {}, '学生名簿を読み込んでいます'), RApi.post('masters', {})]).then(function (res) {
            if (!res[0] || !res[0].ok || !res[1] || !res[1].ok) { RUI.toast('読み込めませんでした。', 'error'); return; }
            data.students = res[0].students;
            data.fiscalYear = res[0].fiscalYear;
            data.departments = res[1].departments || [];
            data.classes = (res[1].classes || []).slice().sort(function (a, b) { return a.grade - b.grade || a.name.localeCompare(b.name, 'ja', { numeric: true }); });
            data.qualifications = res[1].qualifications || [];
            draw();
        }).catch(function (err) {
            console.error(err);
            root.replaceChildren(el('section', { class: 'panel' }, [el('p', { class: 'empty', text: '通信に失敗しました。画面を読み込み直してください。' })]));
        });
    }

    return { render: render };
})();
