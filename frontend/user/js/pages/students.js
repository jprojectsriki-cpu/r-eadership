/* R-eadership 「学生名簿」の画面
 * - 学校管理者はすべての学生、教員は担当クラスの学生だけが表示される（GASが選んで返す）
 * - 上部に在籍状態ごとの人数（しぼりこみの条件に合わせて数える。押すとその在籍状態でしぼりこむ）
 * - しぼりこみ：学科・学年・クラス・在籍状態・卒業予定年度・名前などの検索
 * - 表示は「基本情報」「取得資格（資格ごとの ✓ の表）」のタブで切り替える。30人ずつのページ送り
 * - チェックで選んだ学生を、まとめてクラス移動・在籍状態の変更ができる（進級・卒業のときなど。理由は必須）
 * - 学生を押すと詳しい画面が開き、クラス移動・在籍状態の変更（理由は必須）・取得資格とメモ・変更履歴を扱える
 * - 学科とクラスは、学生ごとにそれぞれ選ぶ。学年はクラスで決まる（学年を変えるときは、その学年のクラスへ移動する）
 * - 卒業予定年度は、今年度＋学校の修業年限−クラスの学年（自動。留年などのときは学校管理者が直す）
 * - 学校管理者だけ：学生の登録、CSVでまとめて登録、基本情報（生年月日・性別・国籍・電話・メールをふくむ）の変更、削除
 * - 希望進路（就職希望・進学希望・帰国希望・未定）・取得資格・メモは、担当の教員も変えられる
 * - クラス・資格は「ラベル」で表示する（ラベルがなければ名前）
 */
(window.RPages = window.RPages || {}).students = (function () {
    'use strict';

    var el = function () { return RUI.el.apply(null, arguments); };
    var ENROLL = ['在籍', '休学', '退学', '除籍', '卒業'];
    var CSV_HEADERS = ['学籍番号', '名前', 'ふりがな', '生年月日', '性別', '国籍', '電話番号', 'メールアドレス', '希望進路', '進学予定先', '学科', 'クラス', '卒業予定年度'];
    var CSV_KEYS = ['studentNo', 'name', 'kana', 'birth', 'gender', 'nation', 'tel', 'mail', 'course', 'school', 'dept', 'cls', 'gradYear'];
    var CSV_REQUIRED = ['学籍番号', '名前', 'クラス'];
    var GENDERS = ['男性', '女性', 'その他', '回答しない'];
    var COURSES = ['就職希望', '進学希望', '帰国希望', '未定'];
    var KEEP_YEARS = 3; // 卒業生のデータを残す年数（GASの KEEP_YEARS_AFTER_GRADUATION と同じ）
    var data = { students: [], schoolYears: 2, departments: [], classes: [], qualifications: [], fiscalYear: 0 };
    var filters = { dept: '', grade: '', cls: '', enroll: '在籍', course: '', year: '', q: '' };
    var admin = false;
    var filtersOpen = false;
    var PAGE_SIZE = 30;
    var page = 1;
    var view = 'basic';      // 'basic'（基本情報）／'quals'（取得資格）
    var qualFilter = '';
    var selected = new Set(); // まとめて変更するために選んだ学生ID
    var root = null;
    var listBox = null;
    var summaryBox = null;

    /* ---------- 名前を引く ---------- */
    function cls(code) { return data.classes.find(function (c) { return c.code === code; }) || null; }
    function dept(id) { return data.departments.find(function (d) { return d.id === id; }) || null; }
    function qual(id) { return data.qualifications.find(function (q) { return q.id === id; }) || null; }
    function short(x, fallback) { return x ? (x.label || x.name) : (fallback || '（不明）'); }
    function classText(code) { var c = cls(code); return c ? short(c) : code + '（削除されたクラス）'; }
    function deptText(id) { if (!id) return '—'; var d = dept(id); return d ? short(d) : id + '（削除された学科）'; }
    function autoYear(classCode) {
        var c = cls(classCode);
        return c ? String(data.fiscalYear + data.schoolYears - c.grade) : '';
    }
    function deptOptions(first) {
        return [{ value: '', label: first || '選んでください' }].concat(data.departments.map(function (d) { return { value: d.id, label: d.name }; }));
    }
    function replaceItem(item) {
        var i = data.students.findIndex(function (s) { return s.id === item.id; });
        if (i >= 0) data.students[i] = item; else data.students.push(item);
    }
    // クラスの選択肢（学年ごとにまとめる）
    function classOptions(first) {
        var opts = [{ value: '', label: first || '選んでください' }];
        data.classes.forEach(function (c) {
            opts.push({ value: c.code, label: c.name, group: c.grade + '年' });
        });
        return opts;
    }

    /* ---------- 札（タグ） ---------- */
    function enrollTag(v) { return el('span', { class: 'st-tag enroll-' + ENROLL.indexOf(v), text: v }); }
    function jobTag(v) {
        var k = { '未着手': 0, '選考中': 1, '内定': 2, '選考終了': 3, '就職先決定': 4 }[v];
        return el('span', { class: 'st-tag job-' + (k == null ? 0 : k), text: v });
    }
    function courseTag(v) { return el('span', { class: 'st-tag course-' + COURSES.indexOf(v), text: v }); }
    function qualTags(ids) {
        if (!ids.length) return el('span', { class: 'muted', text: '—' });
        return el('div', { class: 'tag-row' }, ids.map(function (id) { return el('span', { class: 'label-tag', text: short(qual(id), id) }); }));
    }

    /* =========================================================
     * 一覧
     * ========================================================= */
    // ignoreEnroll が true なら、在籍状態のしぼりこみだけを使わない（上部の人数の表示で使う）
    function filtered(ignoreEnroll) {
        var q = filters.q.trim().toLowerCase();
        return data.students.filter(function (s) {
            var c = cls(s.classCode);
            if (filters.dept && s.deptId !== filters.dept) return false;
            if (filters.grade && (!c || String(c.grade) !== filters.grade)) return false;
            if (filters.cls && s.classCode !== filters.cls) return false;
            if (!ignoreEnroll && filters.enroll && s.enroll !== filters.enroll) return false;
            if (filters.year && s.gradYear !== filters.year) return false;
            if (filters.course && s.course !== filters.course) return false;
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
                if (key === 'grade') filters.cls = '';
                page = 1;
                draw();
            });
            return el('label', { class: 'filter filter-more' }, [el('span', { text: label }), sel]);
        };
        var grades = [{ value: '', label: 'すべて' }];
        for (var g = 1; g <= data.schoolYears; g++) grades.push({ value: String(g), label: g + '年' });
        var classes = [{ value: '', label: 'すべて' }].concat(data.classes.filter(function (c) {
            return !filters.grade || String(c.grade) === filters.grade;
        }).map(function (c) { return { value: c.code, label: short(c) }; }));
        var years = data.students.map(function (s) { return s.gradYear; }).filter(function (y, i, a) { return y && a.indexOf(y) === i; }).sort();
        var search = el('input', { type: 'search', placeholder: '名前・ふりがな・学籍番号', 'aria-label': '検索', value: filters.q });
        search.addEventListener('input', function () { filters.q = search.value; page = 1; drawList(); });

        // スマホでは、しぼりこみを「しぼりこみ」ボタンで開閉する
        var active = ['dept', 'grade', 'cls', 'enroll', 'course', 'year'].filter(function (k) { return filters[k]; }).length;
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
            mkSelect('course', '希望進路', [{ value: '', label: 'すべて' }].concat(COURSES.map(function (v) { return { value: v, label: v }; }))),
            mkSelect('year', '卒業予定年度', [{ value: '', label: 'すべて' }].concat(years.map(function (y) { return { value: y, label: y + '年度' }; })))
        );
        return bar;
    }

    /* 上部の人数（在籍状態ごと）。押すと、その在籍状態でしぼりこむ */
    function drawSummary() {
        var base = filtered(true);
        var count = function (v) { return base.filter(function (s) { return !v || s.enroll === v; }).length; };
        summaryBox.replaceChildren();
        [''].concat(ENROLL).forEach(function (v, i) {
            var on = filters.enroll === v;
            var b = el('button', { type: 'button', class: 'stat' + (on ? ' is-active' : '') + (i ? ' stat-' + (i - 1) : ' stat-all'), 'aria-pressed': String(on) }, [
                el('span', { class: 'stat-label', text: v || 'すべて' }),
                el('span', { class: 'stat-num' }, [document.createTextNode(String(count(v))), el('small', { text: '人' })])
            ]);
            b.addEventListener('click', function () { filters.enroll = v; page = 1; draw(); });
            summaryBox.append(b);
        });
    }

    /* ---------- ページ送り ---------- */
    function pager(total) {
        var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (page > pages) page = pages;
        var from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
        var to = Math.min(total, page * PAGE_SIZE);
        var nav = el('nav', { class: 'pager', 'aria-label': 'ページ送り' });
        var go = function (p) { page = p; drawList(); listBox.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
        var btn = function (label, p, disabled, current, aria) {
            return el('button', { type: 'button', class: 'page-btn' + (current ? ' is-current' : ''), disabled: disabled || current,
                'aria-label': aria || (p + 'ページ目'), 'aria-current': current ? 'page' : null, text: label, onclick: function () { go(p); } });
        };
        nav.append(el('p', { class: 'pager-info', text: total ? from + '〜' + to + '人目（' + total + '人中）' : '0人' }));
        if (pages > 1) {
            var box = el('div', { class: 'pager-btns' });
            box.append(btn('‹', page - 1, page === 1, false, '前のページ'));
            var nums = [];
            for (var i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
            nums.forEach(function (n, k) {
                if (k && n - nums[k - 1] > 1) box.append(el('span', { class: 'page-gap', text: '…' }));
                box.append(btn(String(n), n, false, n === page));
            });
            box.append(btn('›', page + 1, page === pages, false, '次のページ'));
            nav.append(box);
        }
        return nav;
    }

    /* ---------- 選んだ学生（まとめて変更するため） ---------- */
    function selectionBar(list) {
        var n = selected.size;
        var bar = el('div', { class: 'select-bar' + (n ? ' is-on' : '') });
        if (!n) {
            bar.append(el('p', { class: 'muted select-hint', text: '左のチェックで学生を選ぶと、まとめてクラス移動・在籍状態の変更ができます（進級・卒業のときなど）。' }));
            return bar;
        }
        var allIn = list.length && list.every(function (s) { return selected.has(s.id); });
        [
            el('p', { class: 'select-count', text: n + '人を選んでいます' }),
            allIn ? null : el('button', { type: 'button', class: 'text-btn', text: '条件に合う ' + list.length + '人をすべて選ぶ', onclick: function () { list.forEach(function (s) { selected.add(s.id); }); drawList(); } }),
            el('span', { class: 'spacer' }),
            el('button', { type: 'button', class: 'btn btn-sm', onclick: function () { openMove(selectedStudents()); } }, [RUI.icon('i-move'), el('span', { text: 'まとめてクラス移動' })]),
            el('button', { type: 'button', class: 'btn btn-sm', onclick: function () { openEnroll(selectedStudents()); } }, [RUI.icon('i-flag'), el('span', { text: 'まとめて在籍状態の変更' })]),
            el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: '選ぶのをやめる', onclick: function () { selected.clear(); drawList(); } })
        ].forEach(function (x) { if (x) bar.append(x); });
        return bar;
    }
    function selectedStudents() { return data.students.filter(function (s) { return selected.has(s.id); }); }

    /* ---------- 一覧（基本情報／取得資格のタブ） ---------- */
    function viewTabs() {
        var tabs = el('div', { class: 'tabs view-tabs', role: 'tablist', 'aria-label': '表示する情報' });
        [['basic', '基本情報'], ['quals', '取得資格']].forEach(function (t) {
            tabs.append(el('button', { type: 'button', role: 'tab', class: 'tab' + (view === t[0] ? ' is-active' : ''), 'aria-selected': String(view === t[0]), text: t[1],
                onclick: function () { view = t[0]; drawList(); } }));
        });
        if (view === 'quals' && data.qualifications.length) {
            var sel = el('select', { 'aria-label': '資格でしぼりこむ' });
            RUI.setOptions(sel, [{ value: '', label: 'すべての学生' }, { value: '__none', label: '資格なしの学生' }].concat(sortedQuals().map(function (q) { return { value: q.id, label: short(q) + 'を持つ学生' }; })), qualFilter);
            sel.addEventListener('change', function () { qualFilter = sel.value; page = 1; drawList(); });
            tabs.append(el('span', { class: 'spacer' }), el('label', { class: 'qual-filter' }, [el('span', { text: '資格：' }), sel]));
        }
        return tabs;
    }
    function sortedQuals() {
        return data.qualifications.slice().sort(function (a, b) { return (a.category || '').localeCompare(b.category || '', 'ja') || a.name.localeCompare(b.name, 'ja'); });
    }
    function checkCell(s) {
        var cb = el('input', { type: 'checkbox', 'aria-label': s.name + 'を選ぶ' });
        cb.checked = selected.has(s.id);
        cb.addEventListener('click', function (e) { e.stopPropagation(); });
        cb.addEventListener('change', function () { if (cb.checked) selected.add(s.id); else selected.delete(s.id); drawList(); });
        return el('td', { class: 'col-check' }, [cb]);
    }
    function nameCell(s) {
        return el('td', { class: 'cell-main cell-student', 'data-label': '名前' }, [el('span', { class: 'st-name', text: s.name }), s.kana ? el('span', { class: 'kana', text: s.kana }) : null]);
    }

    function drawList() {
        drawSummary();
        var all = filtered();
        if (view === 'quals' && qualFilter) {
            all = all.filter(function (s) { return qualFilter === '__none' ? !s.quals.length : s.quals.indexOf(qualFilter) >= 0; });
        }
        var pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
        if (page > pages) page = pages;
        var list = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        listBox.replaceChildren(viewTabs());
        if (view === 'basic') listBox.append(selectionBar(all));

        if (!all.length) {
            listBox.append(el('p', { class: 'empty', text: data.students.length
                ? '条件に合う学生はいません。しぼりこみを変えてください。'
                : (admin ? '学生はまだ登録されていません。「学生を登録」か「CSVで登録」から登録してください。' : '担当クラスの学生は、まだ登録されていません。') }));
            return;
        }

        var headers, rowOf, tableClass;
        if (view === 'basic') {
            var pageAll = list.every(function (s) { return selected.has(s.id); });
            var headCb = el('input', { type: 'checkbox', 'aria-label': 'このページの学生をすべて選ぶ' });
            headCb.checked = pageAll;
            headCb.addEventListener('change', function () { list.forEach(function (s) { if (headCb.checked) selected.add(s.id); else selected.delete(s.id); }); drawList(); });
            headers = [el('th', { class: 'col-check' }, [headCb])].concat(['学籍番号', '名前', '学科', 'クラス', '学年', '卒業予定', '在籍', '希望進路', '就活', '資格'].map(function (h) { return el('th', { scope: 'col', text: h }); }));
            tableClass = 'data-table student-table compact';
            rowOf = function (s) {
                var c = cls(s.classCode);
                return [
                    checkCell(s),
                    el('td', { class: 'cell-mono', 'data-label': '学籍番号', text: s.studentNo }),
                    nameCell(s),
                    el('td', { 'data-label': '学科', text: deptText(s.deptId) }),
                    el('td', { 'data-label': 'クラス' }, [el('span', { class: 'label-tag', text: classText(s.classCode) })]),
                    el('td', { 'data-label': '学年', text: c ? c.grade + '年' : '—' }),
                    el('td', { 'data-label': '卒業予定', text: s.gradYear ? s.gradYear + '年度' : '—' }),
                    el('td', { 'data-label': '在籍' }, [enrollTag(s.enroll)]),
                    el('td', { 'data-label': '希望進路' }, [courseTag(s.course)]),
                    el('td', { 'data-label': '就活' }, [jobTag(s.job)]),
                    el('td', { class: 'cell-num', 'data-label': '資格', text: s.quals.length ? s.quals.length + '件' : '—' })
                ];
            };
        } else {
            // 取得資格：資格ごとに列を作り、持っている資格に ✓ を付ける
            var qs = sortedQuals();
            headers = ['学籍番号', '名前', 'クラス', '取得数'].map(function (h, i) { return el('th', { scope: 'col', class: i < 2 ? 'sticky-col sticky-' + i : '', text: h }); })
                .concat(qs.map(function (q) { return el('th', { scope: 'col', class: 'qual-col', title: q.name }, [el('span', { text: short(q) })]); }));
            tableClass = 'data-table qual-table compact';
            rowOf = function (s) {
                return [
                    el('td', { class: 'cell-mono sticky-col sticky-0', 'data-label': '学籍番号', text: s.studentNo }),
                    el('td', { class: 'cell-main sticky-col sticky-1', 'data-label': '名前', text: s.name }),
                    el('td', { 'data-label': 'クラス' }, [el('span', { class: 'label-tag', text: classText(s.classCode) })]),
                    el('td', { class: 'cell-num', 'data-label': '取得数', text: s.quals.length + '件' })
                ].concat(qs.map(function (q) {
                    var has = s.quals.indexOf(q.id) >= 0;
                    return el('td', { class: 'qual-cell' + (has ? ' has' : ''), 'data-label': short(q), 'aria-label': short(q) + (has ? '：取得' : '：なし'), text: has ? '✓' : '' });
                }));
            };
            if (!qs.length) listBox.append(el('p', { class: 'muted select-hint', text: '資格がまだ登録されていません。学校管理者が「学科・クラス・資格」で登録します。' }));
        }

        var tbody = el('tbody');
        list.forEach(function (s) {
            var tr = el('tr', { class: 'row-click' + (selected.has(s.id) ? ' is-selected' : ''), tabindex: '0', 'aria-label': s.name + 'の詳しい情報を開く' }, rowOf(s));
            tr.addEventListener('click', function () { openDetail(s.id); });
            tr.addEventListener('keydown', function (e) { if (e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(s.id); } });
            tbody.append(tr);
        });
        listBox.append(
            el('div', { class: 'table-wrap' }, [el('table', { class: tableClass }, [el('thead', {}, [el('tr', {}, headers)]), tbody])]),
            pager(all.length)
        );
    }

    function draw() {
        root.replaceChildren();
        var actions = admin ? el('div', { class: 'head-actions' }, [
            el('button', { type: 'button', class: 'btn', onclick: exportCsv }, [RUI.icon('i-download'), el('span', { text: 'CSVで書き出し' })]),
            el('button', { type: 'button', class: 'btn', onclick: openImport }, [RUI.icon('i-upload'), el('span', { text: 'CSVで登録' })]),
            el('button', { type: 'button', class: 'btn btn-primary', onclick: function () { openBasicForm(null); } }, [RUI.icon('i-plus'), el('span', { text: '学生を登録' })])
        ]) : null;
        listBox = el('div', { class: 'list-box' });
        summaryBox = el('div', { class: 'stat-row', role: 'group', 'aria-label': '在籍状態ごとの人数（押すとしぼりこみます）' });
        root.append(
            summaryBox,
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
    // 応募・指導記録・変更履歴を先に読み込み、そろってから詳しい画面を開く（読み込み中の表示を出さないため）
    function openDetail(id) {
        if (!data.students.some(function (x) { return x.id === id; })) return;
        RApi.all([['records', { studentId: id }], ['studentLogs', { studentId: id }]], '学生の情報を読み込んでいます').then(function (res) {
            showDetail(id, res[0], res[1]);
        }).catch(function (err) {
            console.error(err);
            RUI.toast('通信に失敗しました。時間をおいてもう一度お試しください。', 'error');
        });
    }

    function showDetail(id, recRes, logRes) {
        var s = data.students.find(function (x) { return x.id === id; });
        if (!s) return;
        var c = cls(s.classCode);
        var logBox = el('div', { class: 'log-box' });
        var entryBox = el('div', {});
        var recordBox = el('div', {});
        var myEntries = [];
        var body = el('div', { class: 'modal-body student-detail' }, [
            el('p', { class: 'detail-kana', text: s.kana || '' }),
            el('dl', { class: 'detail-list' }, [
                el('dt', { text: '学籍番号' }), el('dd', { text: s.studentNo }),
                el('dt', { text: '学科' }), el('dd', { text: s.deptId ? (dept(s.deptId) ? dept(s.deptId).name : deptText(s.deptId)) : '—' }),
                el('dt', { text: 'クラス' }), el('dd', { text: c ? c.name + '（' + c.grade + '年）' : classText(s.classCode) }),
                el('dt', { text: '卒業予定' }), el('dd', { text: s.gradYear ? s.gradYear + '年度' : '—' }),
                el('dt', { text: '生年月日' }), el('dd', { text: s.birth ? s.birth + '（' + age(s.birth) + '歳）' : '—' }),
                el('dt', { text: '性別' }), el('dd', { text: s.gender || '—' }),
                el('dt', { text: '国籍' }), el('dd', { text: s.nation || '—' }),
                el('dt', { text: '電話番号' }), el('dd', {}, [s.tel ? el('a', { href: 'tel:' + s.tel.replace(/[^0-9+]/g, ''), text: s.tel }) : document.createTextNode('—')]),
                el('dt', { text: 'メール' }), el('dd', {}, [s.mail ? el('a', { href: 'mailto:' + s.mail, text: s.mail }) : document.createTextNode('—')]),
                el('dt', { text: '在籍状態' }), el('dd', {}, [enrollTag(s.enroll), purgeNote(s)]),
                el('dt', { text: '希望進路' }), el('dd', {}, [courseTag(s.course), s.course === '進学希望' ? el('span', { class: 'detail-note', text: '進学予定先：' + (s.school || '（未入力）') }) : null]),
                el('dt', { text: '就活の状況' }), el('dd', {}, [jobTag(s.job), el('span', { class: 'muted detail-note', text: '応募の結果から自動で決まります（応募管理）' })]),
                el('dt', { text: '取得資格' }), el('dd', {}, [qualTags(s.quals)]),
                el('dt', { text: 'メモ' }), el('dd', { class: 'detail-memo', text: s.memo || '—' })
            ]),
            el('h3', { class: 'detail-h' }, [document.createTextNode('応募'),
                window.REntries ? el('button', { type: 'button', class: 'btn btn-sm h-btn', onclick: function () {
                    dlg.close();
                    REntries.useClasses(data.classes);
                    REntries.openEntryForm(null, s, function (res) { if (res.jobStatus) { s.job = res.jobStatus; draw(); } setTimeout(function () { openDetail(s.id); }, 60); });
                } }, [RUI.icon('i-plus'), el('span', { text: '応募を登録' })]) : null,
                el('a', { href: '#entries?student=' + encodeURIComponent(s.id), class: 'h-link', onclick: function () { dlg.close(); } }, [el('span', { text: '応募管理で見る' })])
            ]),
            entryBox,
            el('h3', { class: 'detail-h' }, [document.createTextNode('指導記録'),
                el('button', { type: 'button', class: 'btn btn-sm h-btn', onclick: function () {
                    dlg.close();
                    REntries.openRecordForm(s, null, myEntries, '', function () { setTimeout(function () { openDetail(s.id); }, 60); });
                } }, [RUI.icon('i-plus'), el('span', { text: '記録を追加' })])
            ]),
            recordBox,
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
            btn('希望進路・資格・メモ', 'i-edit', '', openNotes),
            admin ? btn('基本情報の変更', 'i-user', '', openBasicForm) : null,
            admin ? btn('削除', 'i-trash', 'btn-danger-line', removeStudent) : null
        ]);
        var dlg = RUI.modal(s.name, body, foot);
        dlg.classList.add('r-modal-wide');

        // 応募と指導記録
        (function (res) {
            if (!res || !res.ok) { entryBox.replaceChildren(el('p', { class: 'muted', text: (res && res.message) || '読み込めませんでした。' })); recordBox.replaceChildren(); return; }
            myEntries = res.entries;
            entryBox.replaceChildren(res.entries.length ? el('ul', { class: 'mini-entries' }, res.entries.map(function (e) {
                return el('li', {}, [el('span', { class: 'mini-company', text: e.company }), REntries.stageTag(e.stage), REntries.resultTag(e.result),
                    e.nextDate ? el('span', { class: 'muted', text: '次：' + e.nextDate.slice(5).replace('-', '/') + (e.nextTime ? ' ' + e.nextTime : '') + (e.nextNote ? ' ' + e.nextNote : '') }) : null]);
            })) : el('p', { class: 'muted', text: 'まだ応募はありません。' }));
            recordBox.replaceChildren(REntries.recordList(res.records, s, res.entries, function () { dlg.close(); setTimeout(function () { openDetail(s.id); }, 60); }));
        })(recRes);

        (function (res) {
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
        })(logRes);
    }

    function age(birth) {
        var m = String(birth).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return '—';
        var t = new Date(), a = t.getFullYear() - Number(m[1]);
        if (t.getMonth() + 1 < Number(m[2]) || (t.getMonth() + 1 === Number(m[2]) && t.getDate() < Number(m[3]))) a--;
        return a;
    }
    // 卒業生は、卒業から3年後の4月に自動で削除されることを知らせる
    function purgeNote(s) {
        if (s.enroll !== '卒業' || !/^\d{4}$/.test(s.gradYear)) return null;
        return el('span', { class: 'muted detail-note', text: (Number(s.gradYear) + 1 + KEEP_YEARS) + '年4月に、この学生のデータは自動で削除されます' });
    }

    function afterSave(res, reopenId) {
        if (res && res.ok) {
            (res.items || (res.item ? [res.item] : [])).forEach(replaceItem);
            // 担当クラスの外に移した教員には、もう表示しない
            if (!admin) {
                var mine = (window.RApp && RApp.user && RApp.user.classes) || [];
                var before = data.students.length;
                data.students = data.students.filter(function (x) { return mine.indexOf(x.classCode) >= 0; });
                if (data.students.length !== before) reopenId = null;
            }
            selected.clear();
            draw();
            RUI.toast(res.message);
            if (reopenId) setTimeout(function () { openDetail(reopenId); }, 60);
        }
        return res;
    }
    function toList(x) { return Array.isArray(x) ? x : [x]; }
    function whoText(list) { return list.length === 1 ? list[0].name + 'さん' : list.length + '人'; }

    /* ---------- クラス移動（1人でも、まとめてでも） ---------- */
    function openMove(target) {
        var list = toList(target);
        var single = list.length === 1;
        var nowText = single ? (cls(list[0].classCode) || { name: list[0].classCode }).name
            : list.map(function (s) { return classText(s.classCode); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join('、');
        RUI.form({
            title: whoText(list) + 'のクラス移動',
            fields: [
                { name: 'now', label: single ? 'いまのクラス' : 'いまのクラス（' + list.length + '人）', type: 'static', value: nowText },
                { name: 'toClass', label: '移動先のクラス', type: 'select', required: true, options: classOptions().filter(function (o) { return !single || o.value !== list[0].classCode; }),
                  hint: '学年は、移動先のクラスの学年になります。卒業予定年度が自動のままの学生は、移動先に合わせて直ります。' },
                { name: 'reason', label: '移動の理由', type: 'textarea', required: true, maxlength: 200, placeholder: single ? '例：学科の変更のため' : '例：2027年度 進級', hint: '変更履歴に残ります。' + (single ? '' : 'まとめて変更すると、全員に同じ理由が残ります。') }
            ],
            submitLabel: single ? '移動する' : list.length + '人を移動する',
            onSubmit: function (v) {
                return RApi.post('moveStudents', { studentIds: list.map(function (s) { return s.id; }), toClass: v.toClass, reason: v.reason }, '移動しています')
                    .then(function (res) { return afterSave(res, single ? list[0].id : null); });
            }
        });
    }

    /* ---------- 在籍状態の変更（1人でも、まとめてでも） ---------- */
    function openEnroll(target) {
        var list = toList(target);
        var single = list.length === 1;
        var options = ENROLL.filter(function (v) { return !single || v !== list[0].enroll; }).map(function (v) { return { value: v, label: v }; });
        RUI.form({
            title: whoText(list) + 'の在籍状態の変更',
            fields: [
                { name: 'now', label: single ? 'いまの在籍状態' : 'いまの在籍状態（' + list.length + '人）', type: 'static',
                  value: single ? list[0].enroll : ENROLL.map(function (v) { var n = list.filter(function (s) { return s.enroll === v; }).length; return n ? v + ' ' + n + '人' : ''; }).filter(String).join('、') },
                { name: 'status', label: '新しい在籍状態', type: 'select', required: true, options: [{ value: '', label: '選んでください' }].concat(options) },
                { name: 'reason', label: '変更の理由', type: 'textarea', required: true, maxlength: 200, placeholder: single ? '例：病気療養のため休学' : '例：2026年度 卒業', hint: '変更履歴に残ります。' + (single ? '' : 'まとめて変更すると、全員に同じ理由が残ります。') }
            ],
            submitLabel: single ? '変更する' : list.length + '人を変更する',
            onSubmit: function (v) {
                return RApi.post('setEnrollStatuses', { studentIds: list.map(function (s) { return s.id; }), status: v.status, reason: v.reason }, '変更しています')
                    .then(function (res) { return afterSave(res, single ? list[0].id : null); });
            }
        });
    }

    /* ---------- 取得資格・メモ ---------- */
    function openNotes(s) {
        var opts = data.qualifications.slice().sort(function (a, b) { return (a.category || '').localeCompare(b.category || '', 'ja') || a.name.localeCompare(b.name, 'ja'); })
            .map(function (q) { return { value: q.id, label: short(q) + (q.label ? '（' + q.name + '）' : ''), group: q.category || 'その他' }; });
        RUI.form({
            title: s.name + 'さんの希望進路・取得資格・メモ',
            fields: [
                { name: 'course', label: '希望進路', type: 'select', required: true, value: s.course, options: COURSES.map(function (v) { return { value: v, label: v }; }), hint: '変えると変更履歴に残ります。' },
                { name: 'school', label: '進学予定先', value: s.school, maxlength: 50, placeholder: '例：〇〇大学 経済学部', hint: '希望進路が「進学希望」のときに入れます。ダッシュボードの進学先のグラフに使います。' },
                { name: 'quals', label: '取得資格', type: 'checks', value: s.quals, options: opts, emptyText: '資格がまだありません。学校管理者が「学科・クラス・資格」で登録します。' },
                { name: 'memo', label: 'メモ', type: 'textarea', value: s.memo, maxlength: 1000, placeholder: '指導のメモなど' }
            ],
            submitLabel: '保存する',
            onChange: function (form) { form.elements.school.disabled = form.elements.course.value !== '進学希望'; },
            onSubmit: function (v) {
                return RApi.post('updateStudentNotes', { studentId: s.id, quals: v.quals, memo: v.memo, course: v.course, school: v.school }, '保存しています').then(function (res) { return afterSave(res, s.id); });
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
            { name: 'kana', label: 'ふりがな', value: s.kana, maxlength: 50, placeholder: '例：ひが たろう' },
            { name: 'birth', label: '生年月日', value: s.birth, type: 'date' },
            { name: 'gender', label: '性別', value: s.gender, type: 'select', options: [{ value: '', label: '（入れない）' }].concat(GENDERS.map(function (v) { return { value: v, label: v }; })) },
            { name: 'nation', label: '国籍', value: s.nation, maxlength: 30, placeholder: '例：日本／ベトナム' },
            { name: 'tel', label: '電話番号', value: s.tel, type: 'tel', maxlength: 20, placeholder: '例：090-1234-5678', autocomplete: 'off' },
            { name: 'mail', label: 'メールアドレス', value: s.mail, type: 'email', maxlength: 100, placeholder: '例：taro@example.com', autocomplete: 'off' },
            { name: 'deptId', label: '学科', value: s.deptId, type: 'select', required: data.departments.length > 0, options: deptOptions(data.departments.length ? '選んでください' : '（学科がまだ登録されていません）') }
        ];
        if (isNew) {
            fields.push({ name: 'classCode', label: 'クラス', type: 'select', required: true, options: classOptions(), hint: '学年は、選んだクラスの学年になります。' });
            fields.push({ name: 'gradeView', label: '学年', type: 'static', value: 'クラスを選ぶと表示されます' });
        } else {
            var c0 = cls(s.classCode);
            fields.push({ name: 'clsView', label: 'クラス・学年', type: 'static', value: classText(s.classCode) + (c0 ? '（' + c0.grade + '年）' : '') + '　※ クラス・学年は「クラス移動」で変えます' });
        }
        fields.push({ name: 'gradYear', label: '卒業予定年度', value: s.gradYear, maxlength: 6, placeholder: '例：2027',
            hint: isNew ? 'クラスを選ぶと、学校の修業年限（' + data.schoolYears + '年制）とクラスの学年から自動で入ります。留年などのときは直してください。' : '留年などのときに直します。変更履歴に残ります。' });
        var lastAuto = '';
        RUI.form({
            title: isNew ? '学生を登録' : s.name + 'さんの基本情報の変更',
            fields: fields,
            submitLabel: isNew ? '登録する' : '変更を保存する',
            onChange: isNew ? function (form, name) {
                if (name !== 'classCode') return;
                var c = cls(form.elements.classCode.value);
                var gv = form.querySelector('.static-value');
                if (gv) gv.textContent = c ? c.grade + '年' : 'クラスを選ぶと表示されます';
                var y = form.elements.gradYear;
                if (!y.value || y.value === lastAuto) { lastAuto = autoYear(form.elements.classCode.value); y.value = lastAuto; }
            } : null,
            onSubmit: function (v) {
                var item = { id: s.id, studentNo: v.studentNo, name: v.name, kana: v.kana, birth: v.birth, gender: v.gender, nation: v.nation, tel: v.tel, mail: v.mail, deptId: v.deptId, classCode: v.classCode, gradYear: v.gradYear };
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

    /* ---------- CSVで書き出し（学校管理者だけ）。いましぼりこんでいる学生を、すべてのページの分まとめて ---------- */
    function exportCsv() {
        var list = filtered();
        if (view === 'quals' && qualFilter) list = list.filter(function (s) { return qualFilter === '__none' ? !s.quals.length : s.quals.indexOf(qualFilter) >= 0; });
        if (!list.length) { RUI.toast('書き出す学生がいません。しぼりこみを変えてください。', 'error'); return; }
        RUI.confirm({
            title: 'CSVで書き出し', okLabel: list.length + '人分を書き出す',
            message: 'いまの条件に合う ' + list.length + '人分の学生名簿を、CSVファイルで保存します。個人情報がふくまれるので、学校のルールに従って保管し、使い終わったら削除してください。'
        }).then(function (yes) {
            if (!yes) return;
            var headers = ['学籍番号', '名前', 'ふりがな', '生年月日', '性別', '国籍', '電話番号', 'メールアドレス', '学科', '学年', 'クラス', '卒業予定年度', '在籍状態', '希望進路', '進学予定先', '就活の状況', '取得資格', 'メモ'];
            var rows = list.map(function (s) {
                var c = cls(s.classCode), d = dept(s.deptId);
                return [s.studentNo, s.name, s.kana, s.birth, s.gender, s.nation, s.tel, s.mail, d ? d.name : s.deptId, c ? c.grade : '', c ? c.name : s.classCode,
                    s.gradYear, s.enroll, s.course, s.school, s.job, s.quals.map(function (q) { return short(qual(q), q); }).join('・'), s.memo];
            });
            RUI.downloadCsv('readership_students_' + RUI.todayStamp() + '.csv', headers, rows);
            RUI.toast(list.length + '人分を書き出しました。');
        });
    }

    /* =========================================================
     * CSVでまとめて登録（学校管理者だけ）
     * ========================================================= */
    function csvEscape(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    function downloadTemplate() {
        var sample = data.classes[0];
        var sampleDept = data.departments[0];
        var lines = [CSV_HEADERS.join(','), ['2026001', '比嘉 太郎', 'ひが たろう', '2006-04-01', '男性', '日本', '090-1234-5678', 'taro@example.com', '就職希望', '', sampleDept ? short(sampleDept) : '', sample ? short(sample) : 'クラスのラベル', ''].map(csvEscape).join(',')];
        var blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' });
        var a = el('a', { href: URL.createObjectURL(blob), download: 'readership_students_template.csv' });
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
                el('li', { text: '必ず入れるのは「学籍番号」「名前」「学科」「クラス」です（学科がまだ登録されていなければ、「学科」は空でかまいません）。「学科」には学科のラベル・学科名・学科IDのどれか、「クラス」にはクラスのラベル・クラス名・クラスコードのどれかを入れます。ほかの列は空でもかまいません（卒業予定年度は自動で入ります。希望進路は「就職希望・進学希望・帰国希望・未定」、進学予定先は進学希望のときの学校名、性別は「男性・女性・その他・回答しない」、生年月日は「2006-04-01」の形）。' }),
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
                var missing = CSV_REQUIRED.filter(function (h) { return head.indexOf(h) < 0; });
                if (missing.length) { showErrors('1行目の見出しに「' + missing.join('」「') + '」がありません。ひな形の見出しを使ってください。'); return; }
                var get = function (r, i) { return idx[i] >= 0 ? String(r[idx[i]] || '').trim() : ''; };
                var items = rows.slice(1).map(function (r) {
                    var o = {};
                    CSV_KEYS.forEach(function (k, i) { o[k] = get(r, i); });
                    return o;
                });
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
        RApi.all([['students'], ['masters']], '学生名簿を読み込んでいます').then(function (res) {
            if (!res[0] || !res[0].ok || !res[1] || !res[1].ok) { RUI.toast('読み込めませんでした。', 'error'); return; }
            data.students = res[0].students;
            data.fiscalYear = res[0].fiscalYear;
            data.schoolYears = res[1].schoolYears || 2;
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
