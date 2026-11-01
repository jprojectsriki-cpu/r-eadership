/* R-eadership 「応募管理」の画面と、応募・指導記録の入力画面（学生名簿からも使う）
 * - 学校管理者はすべて、教員は担当クラスの学生の応募だけが表示される（GASが選んで返す）
 * - 上部に結果ごとの件数（押すとしぼりこむ）。次の予定が近い順に並べ、今日・3日以内の予定を目立たせる
 * - 応募を押すと詳しい画面：選考の進み具合（実際に通った段階だけを表示）、履歴、この応募の指導記録
 * - 選考の段階は順番どおりでなくてよい（二次面接がない会社は、一次面接から最終面接へ）
 * - 「#entries?student=S001」で開くと、その学生の応募だけを表示する
 * - window.REntries：学生名簿の詳しい画面から、応募の登録・指導記録の入力を開くための関数
 */
(function () {
    'use strict';

    var el = function () { return RUI.el.apply(null, arguments); };
    var STAGES = ['エントリー', '書類選考', '筆記・適性検査', '一次面接', '二次面接', '最終面接'];
    var RESULTS = ['選考中', '内定', '内定承諾', '不採用', '辞退'];
    var PAGE_SIZE = 30;

    var data = { entries: [], students: [], classes: [], departments: [], today: '' };
    var filters = { result: '', stage: '', cls: '', q: '', upcoming: false, student: '' };
    var page = 1;
    var root = null, statBox = null, listBox = null;

    /* ---------- 共通 ---------- */
    function student(id) { return data.students.find(function (s) { return s.id === id; }) || null; }
    function cls(code) { return data.classes.find(function (c) { return c.code === code; }) || null; }
    function short(x) { return x ? (x.label || x.name) : ''; }
    function today() {
        if (data.today) return data.today;
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function daysUntil(date) {
        if (!date) return null;
        var a = new Date(today() + 'T00:00:00'), b = new Date(date + 'T00:00:00');
        return Math.round((b - a) / 86400000);
    }
    function stageTag(v) { return el('span', { class: 'st-tag stage-tag', text: v }); }
    function resultTag(v) { return el('span', { class: 'st-tag result-' + RESULTS.indexOf(v), text: v }); }
    function nextText(e) {
        if (!e.nextDate) return '';
        var w = '日月火水木金土'.charAt(new Date(e.nextDate + 'T00:00:00').getDay());
        return e.nextDate.slice(5).replace('-', '/') + '（' + w + '）' + (e.nextTime ? ' ' + e.nextTime : '');
    }
    function nextCell(e) {
        if (!e.nextDate) return el('span', { class: 'muted', text: '—' });
        var d = daysUntil(e.nextDate);
        var cls2 = d < 0 ? 'is-past' : d === 0 ? 'is-today' : d <= 3 ? 'is-soon' : '';
        var badge = d < 0 ? '過ぎています' : d === 0 ? '今日' : d === 1 ? '明日' : d <= 3 ? d + '日後' : '';
        return el('div', { class: 'next-cell ' + cls2 }, [
            el('span', { class: 'next-date', text: nextText(e) }),
            badge ? el('span', { class: 'next-badge', text: badge }) : null,
            e.nextNote ? el('span', { class: 'next-note', text: e.nextNote }) : null
        ]);
    }
    function replaceEntry(item) {
        var i = data.entries.findIndex(function (e) { return e.id === item.id; });
        if (i >= 0) data.entries[i] = item; else data.entries.push(item);
    }
    function setJob(studentId, job) {
        var s = student(studentId);
        if (s && job) s.job = job;
    }
    var PICK_MAX = 50; // 選択肢に出す最大の人数（多いときは、しぼりこんでもらう）

    /** 学生の表示名：「1年 情報1A 比嘉 太郎（2026001）」。同姓同名でも区別できるように学年・クラス・学籍番号を付ける */
    function studentLabel(s) {
        var c = cls(s.classCode);
        return (c ? c.grade + '年 ' + short(c) + ' ' : '') + s.name + '（' + s.studentNo + '）' + (s.enroll === '在籍' ? '' : '［' + s.enroll + '］');
    }

    /**
     * 学生の選択肢
     * f：{ grade, cls, q }（学年・クラス・名前などの検索）。在籍の学生を先に、学年・クラス・学籍番号の順に並べる
     * 当てはまる学生が PICK_MAX 人より多いときは、最初の PICK_MAX 人だけを出し、しぼりこむよう知らせる
     */
    function studentOptions(f) {
        f = f || {};
        var q = String(f.q || '').trim().toLowerCase();
        var list = data.students.filter(function (s) {
            var c = cls(s.classCode);
            if (f.grade && (!c || String(c.grade) !== String(f.grade))) return false;
            if (f.cls && s.classCode !== f.cls) return false;
            return !q || (s.name + ' ' + s.kana + ' ' + s.studentNo).toLowerCase().indexOf(q) >= 0;
        });
        var order = function (s) { var c = cls(s.classCode); return c ? data.classes.indexOf(c) : 9999; };
        list.sort(function (a, b) {
            return (a.enroll === '在籍' ? 0 : 1) - (b.enroll === '在籍' ? 0 : 1) || order(a) - order(b) || a.studentNo.localeCompare(b.studentNo, 'ja', { numeric: true });
        });
        var head = !list.length ? '当てはまる学生がいません'
            : list.length > PICK_MAX ? list.length + '人います。学年・クラス・名前でしぼりこんでください（最初の' + PICK_MAX + '人を表示）'
            : '選んでください（' + list.length + '人）';
        return [{ value: '', label: head }].concat(list.slice(0, PICK_MAX).map(function (s) { return { value: s.id, label: studentLabel(s) }; }));
    }
    // 学年の選択肢（登録されているクラスの学年）
    function gradeOptions() {
        var gs = data.classes.map(function (c) { return c.grade; }).filter(function (g, i, a) { return a.indexOf(g) === i; }).sort();
        return [{ value: '', label: 'すべての学年' }].concat(gs.map(function (g) { return { value: String(g), label: g + '年' }; }));
    }
    function classOptionsFor(grade) {
        return [{ value: '', label: 'すべてのクラス' }].concat(data.classes.filter(function (c) { return !grade || String(c.grade) === String(grade); })
            .map(function (c) { return { value: c.code, label: c.grade + '年 ' + short(c) }; }));
    }

    /* =========================================================
     * 入力画面（学生名簿からも使う）
     * ========================================================= */

    /** しぼりこみに合わせて、学生の選択肢を入れかえる（1人だけになったら、その学生を選ぶ） */
    function refreshPick(form) {
        var opts = studentOptions({ grade: form.elements.pickGrade.value, cls: form.elements.pickClass.value, q: form.elements.pickQ.value });
        var keep = form.elements.studentId.value;
        if (opts.length === 2) keep = opts[1].value;
        RUI.setOptions(form.elements.studentId, opts, keep);
    }

    /** 応募の登録・会社などの情報の変更。fixedStudent を渡すと、その学生で登録する */
    function openEntryForm(entry, fixedStudent, onDone) {
        var isNew = !entry;
        entry = entry || {};
        var fields = [];
        if (isNew && !fixedStudent) {
            fields.push(
                { name: 'pickGrade', label: '学年でしぼる', type: 'select', options: gradeOptions() },
                { name: 'pickClass', label: 'クラスでしぼる', type: 'select', options: classOptionsFor('') },
                { name: 'pickQ', label: '名前・学籍番号でさがす', maxlength: 30, placeholder: '名前・ふりがな・学籍番号の一部', autocomplete: 'off' },
                { name: 'studentId', label: '学生', type: 'select', required: true, options: studentOptions(),
                  hint: data.students.length ? '「学年 クラス 名前（学籍番号）」で表示しています。在籍している学生が先です。' : '学生名簿に学生が登録されていません。' }
            );
        }
        else {
            var st = fixedStudent || student(entry.studentId) || {};
            fields.push({ name: 'studentView', label: '学生', type: 'static', value: st.id ? studentLabel(st) : '' });
        }
        fields.push(
            { name: 'company', label: '会社名', value: entry.company, required: true, maxlength: 50, placeholder: '例：株式会社沖縄商事' },
            { name: 'job', label: '職種', value: entry.job, maxlength: 50, placeholder: '例：営業／ホテルフロント' },
            { name: 'place', label: '勤務地', value: entry.place, maxlength: 50, placeholder: '例：那覇市' },
            { name: 'salary', label: '給与', value: entry.salary, maxlength: 50, placeholder: '例：月給20万円' },
            { name: 'applied', label: '応募日', value: entry.applied || today(), type: 'date' },
            { name: 'memo', label: 'メモ', value: entry.memo, type: 'textarea', maxlength: 1000 }
        );
        var picker = isNew && !fixedStudent;
        var dlg = RUI.form({
            title: isNew ? '応募を登録' : '応募の情報を変更',
            fields: fields,
            // クラスや「さがす」に入れた文字で、学生の選択肢をしぼる
            onChange: picker ? function (form, name) {
                if (name === 'pickGrade') RUI.setOptions(form.elements.pickClass, classOptionsFor(form.elements.pickGrade.value), form.elements.pickClass.value);
                if (name === 'pickGrade' || name === 'pickClass') refreshPick(form);
            } : null,
            submitLabel: isNew ? '登録する' : '変更を保存する',
            onSubmit: function (v) {
                var item = { id: entry.id, studentId: fixedStudent ? fixedStudent.id : (entry.studentId || v.studentId), company: v.company, job: v.job, place: v.place, salary: v.salary, applied: v.applied, memo: v.memo };
                return RApi.post('saveEntry', { item: item }, isNew ? '登録しています' : '保存しています').then(function (res) {
                    if (res && res.ok) { RUI.toast(res.message); if (onDone) onDone(res); }
                    return res;
                });
            }
        });
        if (picker) {
            var f = dlg.querySelector('form');
            f.elements.pickQ.addEventListener('input', function () { refreshPick(f); });
        }
    }

    /** 選考の進み具合（段階・結果・次の予定）の更新 */
    function openProgressForm(entry, onDone) {
        RUI.form({
            title: entry.company + '：進み具合を更新',
            fields: [
                { name: 'stage', label: '選考の段階', type: 'select', required: true, value: entry.stage, options: STAGES.map(function (v) { return { value: v, label: v }; }),
                  hint: '順番どおりでなくてかまいません（二次面接がない会社は、一次面接の次に最終面接を選びます）。' },
                { name: 'result', label: '結果', type: 'select', required: true, value: entry.result, options: RESULTS.map(function (v) { return { value: v, label: v + (v === '内定承諾' ? '（就職先に決めた）' : '') }; }) },
                { name: 'nextDate', label: '次の予定日', type: 'date', value: entry.nextDate },
                { name: 'nextTime', label: '時刻', type: 'time', value: entry.nextTime },
                { name: 'nextNote', label: '次の予定の内容', value: entry.nextNote, maxlength: 50, placeholder: '例：一次面接（本社）／書類の提出しめきり' }
            ],
            submitLabel: '更新する',
            // 結果が「選考中」以外のときは、次の予定は入れない
            onChange: function (form) {
                var off = form.elements.result.value !== '選考中';
                ['nextDate', 'nextTime', 'nextNote'].forEach(function (n) { form.elements[n].disabled = off; });
            },
            onSubmit: function (v) {
                return RApi.post('updateEntryProgress', { entryId: entry.id, progress: v }, '更新しています').then(function (res) {
                    if (res && res.ok) { RUI.toast(res.message); if (onDone) onDone(res); }
                    return res;
                });
            }
        });
    }

    /** 指導記録の追加・書き直し。entries はその学生の応募（どの応募の記録かを選ぶため） */
    function openRecordForm(st, record, entries, fixedEntryId, onDone) {
        var isNew = !record;
        record = record || {};
        var entryOpts = [{ value: '', label: '（特定の応募ではない）' }].concat((entries || []).map(function (e) { return { value: e.id, label: e.company + '（' + e.stage + '・' + e.result + '）' }; }));
        RUI.form({
            title: (isNew ? '指導記録を追加' : '指導記録を書き直す') + '：' + st.name + 'さん',
            fields: [
                { name: 'date', label: '日付', type: 'date', value: record.date || today(), required: true },
                { name: 'entryId', label: '関係する応募', type: 'select', value: record.entryId || fixedEntryId || '', options: entryOpts },
                { name: 'content', label: '内容', type: 'textarea', value: record.content, required: true, maxlength: 2000, placeholder: '例：面接練習。志望動機を具体的にするよう助言した。' }
            ],
            submitLabel: isNew ? '追加する' : '保存する',
            onSubmit: function (v) {
                var item = { id: record.id, studentId: st.id, entryId: v.entryId, date: v.date, content: v.content };
                return RApi.post('saveRecord', { item: item }, '保存しています').then(function (res) {
                    if (res && res.ok) { RUI.toast(res.message); if (onDone) onDone(res); }
                    return res;
                });
            }
        });
    }

    function deleteRecord(record, onDone) {
        RUI.confirm({ title: '指導記録を削除', danger: true, okLabel: '削除する', message: record.date + ' の指導記録を削除します。もとに戻せません。' }).then(function (yes) {
            if (!yes) return;
            RApi.post('deleteRecord', { recordId: record.id }, '削除しています').then(function (res) {
                if (!res || !res.ok) { RUI.toast((res && res.message) || '削除できませんでした。', 'error'); return; }
                RUI.toast(res.message);
                if (onDone) onDone(res);
            });
        });
    }

    /** 指導記録の一覧（要素を返す）。書いた本人と学校管理者だけに「書き直す」「削除」を出す */
    function recordList(records, st, entries, onChange) {
        var me = (window.RApp && RApp.user) || {};
        if (!records.length) return el('p', { class: 'muted', text: 'まだ指導記録はありません。' });
        return el('ol', { class: 'record-list' }, records.map(function (r) {
            var mine = me.role === 'admin' || String(r.by).toLowerCase() === String(me.teacherId || '').toLowerCase();
            var e = (entries || []).find(function (x) { return x.id === r.entryId; });
            return el('li', {}, [
                el('p', { class: 'record-head' }, [
                    el('span', { class: 'record-date', text: r.date }),
                    e ? el('span', { class: 'label-tag', text: e.company }) : null,
                    el('span', { class: 'record-by', text: r.by })
                ]),
                el('p', { class: 'record-body', text: r.content }),
                mine ? el('div', { class: 'record-actions' }, [
                    el('button', { type: 'button', class: 'text-btn', text: '書き直す', onclick: function () { openRecordForm(st, r, entries, '', onChange); } }),
                    el('button', { type: 'button', class: 'text-btn text-danger', text: '削除', onclick: function () { deleteRecord(r, onChange); } })
                ]) : null
            ]);
        }));
    }

    window.REntries = {
        STAGES: STAGES, RESULTS: RESULTS,
        stageTag: stageTag, resultTag: resultTag,
        openEntryForm: openEntryForm, openRecordForm: openRecordForm, recordList: recordList,
        // 学生名簿から使うとき、クラスの情報を渡す（学生の表示名「学年 クラス 名前」を作るため）
        useClasses: function (classes) { if (!data.classes.length) data.classes = classes.slice(); }
    };

    /* =========================================================
     * 応募管理の画面
     * ========================================================= */
    function filtered(ignoreResult) {
        var q = filters.q.trim().toLowerCase();
        return data.entries.filter(function (e) {
            var s = student(e.studentId);
            if (filters.student && e.studentId !== filters.student) return false;
            if (!ignoreResult && filters.result && e.result !== filters.result) return false;
            if (filters.stage && e.stage !== filters.stage) return false;
            if (filters.cls && (!s || s.classCode !== filters.cls)) return false;
            if (filters.upcoming && !e.nextDate) return false;
            if (q && ((e.company + ' ' + e.job + ' ' + (s ? s.name + ' ' + s.kana + ' ' + s.studentNo : '')).toLowerCase().indexOf(q) < 0)) return false;
            return true;
        }).sort(function (a, b) {
            // 次の予定がある応募を、近い順に先に。そのあとは更新が新しい順
            if (a.nextDate && b.nextDate) return (a.nextDate + a.nextTime).localeCompare(b.nextDate + b.nextTime);
            if (a.nextDate) return -1;
            if (b.nextDate) return 1;
            return String(b.updatedAt).localeCompare(String(a.updatedAt));
        });
    }

    function drawStats() {
        var base = filtered(true);
        statBox.replaceChildren();
        [''].concat(RESULTS).forEach(function (v, i) {
            var n = base.filter(function (e) { return !v || e.result === v; }).length;
            var on = filters.result === v;
            var b = el('button', { type: 'button', class: 'stat' + (on ? ' is-active' : '') + (i ? ' rstat-' + (i - 1) : ' stat-all'), 'aria-pressed': String(on) }, [
                el('span', { class: 'stat-label', text: v || 'すべて' }),
                el('span', { class: 'stat-num' }, [document.createTextNode(String(n)), el('small', { text: '件' })])
            ]);
            b.addEventListener('click', function () { filters.result = v; page = 1; draw(); });
            statBox.append(b);
        });
    }

    function toolbar() {
        var bar = el('div', { class: 'filter-bar is-open entry-filter' });
        var search = el('input', { type: 'search', placeholder: '会社名・職種・学生の名前・学籍番号', 'aria-label': '検索', value: filters.q });
        search.addEventListener('input', function () { filters.q = search.value; page = 1; drawList(); });
        var mkSelect = function (key, label, options) {
            var sel = el('select', { 'aria-label': label });
            RUI.setOptions(sel, options, filters[key]);
            sel.addEventListener('change', function () { filters[key] = sel.value; page = 1; draw(); });
            return el('label', { class: 'filter' }, [el('span', { text: label }), sel]);
        };
        var up = el('input', { type: 'checkbox' });
        up.checked = filters.upcoming;
        up.addEventListener('change', function () { filters.upcoming = up.checked; page = 1; draw(); });
        bar.append(
            el('label', { class: 'filter filter-search' }, [el('span', { text: '検索' }), search]),
            mkSelect('cls', 'クラス', [{ value: '', label: 'すべて' }].concat(data.classes.map(function (c) { return { value: c.code, label: short(c) }; }))),
            mkSelect('stage', '選考の段階', [{ value: '', label: 'すべて' }].concat(STAGES.map(function (v) { return { value: v, label: v }; }))),
            el('label', { class: 'filter filter-check' }, [up, el('span', { text: '次の予定がある応募だけ' })])
        );
        return bar;
    }

    function pager(total) {
        var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        var nav = el('nav', { class: 'pager', 'aria-label': 'ページ送り' });
        var from = total ? (page - 1) * PAGE_SIZE + 1 : 0, to = Math.min(total, page * PAGE_SIZE);
        nav.append(el('p', { class: 'pager-info', text: total ? from + '〜' + to + '件目（' + total + '件中）' : '0件' }));
        if (pages > 1) {
            var box = el('div', { class: 'pager-btns' });
            var go = function (p) { page = p; drawList(); listBox.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
            var btn = function (label, p, disabled, current, aria) {
                return el('button', { type: 'button', class: 'page-btn' + (current ? ' is-current' : ''), disabled: disabled || current, 'aria-label': aria || p + 'ページ目', text: label, onclick: function () { go(p); } });
            };
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

    function drawList() {
        drawStats();
        var all = filtered();
        var pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
        if (page > pages) page = pages;
        var list = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        listBox.replaceChildren();
        if (filters.student) {
            var st = student(filters.student);
            listBox.append(el('div', { class: 'select-bar is-on' }, [
                el('p', { class: 'select-count', text: (st ? st.name + 'さん' : 'この学生') + 'の応募だけを表示しています' }),
                el('span', { class: 'spacer' }),
                el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: 'すべての学生を表示', onclick: function () { filters.student = ''; history.replaceState(null, '', '#entries'); page = 1; draw(); } })
            ]));
        }
        if (!all.length) {
            listBox.append(el('p', { class: 'empty', text: data.entries.length ? '条件に合う応募はありません。' : 'まだ応募は登録されていません。「応募を登録」から登録してください。' }));
            return;
        }
        var tbody = el('tbody');
        list.forEach(function (e) {
            var s = student(e.studentId) || { name: '（不明）', studentNo: '', classCode: '' };
            var tr = el('tr', { class: 'row-click', tabindex: '0', 'aria-label': s.name + '・' + e.company + 'の詳しい情報を開く' }, [
                el('td', { class: 'cell-student', 'data-label': '学生' }, [el('span', { class: 'st-name', text: s.name }), el('span', { class: 'kana', text: s.studentNo })]),
                el('td', { 'data-label': 'クラス' }, [el('span', { class: 'label-tag', text: short(cls(s.classCode)) || '—' })]),
                el('td', { class: 'cell-main', 'data-label': '会社名' }, [el('span', { text: e.company }), e.job ? el('span', { class: 'kana', text: e.job }) : null]),
                el('td', { 'data-label': '段階' }, [stageTag(e.stage)]),
                el('td', { 'data-label': '結果' }, [resultTag(e.result)]),
                el('td', { 'data-label': '次の予定' }, [nextCell(e)]),
                el('td', { 'data-label': '更新', class: 'cell-mono', text: String(e.updatedAt).slice(0, 10) })
            ]);
            tr.addEventListener('click', function () { openDetail(e.id); });
            tr.addEventListener('keydown', function (ev) { if (ev.target === tr && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openDetail(e.id); } });
            tbody.append(tr);
        });
        var thead = el('tr', {}, ['学生', 'クラス', '会社名・職種', '段階', '結果', '次の予定', '更新'].map(function (h) { return el('th', { scope: 'col', text: h }); }));
        listBox.append(el('div', { class: 'table-wrap' }, [el('table', { class: 'data-table entry-table compact' }, [el('thead', {}, [thead]), tbody])]), pager(all.length));
    }

    function draw() {
        root.replaceChildren();
        statBox = el('div', { class: 'stat-row', role: 'group', 'aria-label': '結果ごとの件数（押すとしぼりこみます）' });
        listBox = el('div', { class: 'list-box' });
        root.append(statBox, el('section', { class: 'panel panel-flush' }, [
            el('div', { class: 'list-head' }, [
                el('p', { class: 'list-count', text: '応募の一覧（次の予定が近い順）' }),
                el('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
                    if (!data.students.length) { RUI.toast('先に学生名簿で学生を登録してください。', 'error'); return; }
                    var fixed = filters.student ? student(filters.student) : null;
                    openEntryForm(null, fixed, function (res) { replaceEntry(res.item); setJob(res.item.studentId, res.jobStatus); draw(); });
                } }, [RUI.icon('i-plus'), el('span', { text: '応募を登録' })])
            ]),
            toolbar(),
            listBox
        ]));
        drawList();
    }

    /* ---------- 詳しい画面 ---------- */
    function openDetail(id) {
        var e = data.entries.find(function (x) { return x.id === id; });
        if (!e) return;
        var s = student(e.studentId) || { id: e.studentId, name: '（不明）', studentNo: '' };
        var progressBox = el('div', { class: 'progress-box' }, [el('p', { class: 'muted', text: '読み込んでいます…' })]);
        var recordBox = el('div', {}, [el('p', { class: 'muted', text: '読み込んでいます…' })]);
        var reopen = function () { setTimeout(function () { openDetail(id); }, 60); };
        var body = el('div', { class: 'modal-body student-detail' }, [
            el('dl', { class: 'detail-list' }, [
                el('dt', { text: '学生' }), el('dd', { text: s.id ? studentLabel(s) : s.name }),
                el('dt', { text: '職種' }), el('dd', { text: e.job || '—' }),
                el('dt', { text: '勤務地' }), el('dd', { text: e.place || '—' }),
                el('dt', { text: '給与' }), el('dd', { text: e.salary || '—' }),
                el('dt', { text: '応募日' }), el('dd', { text: e.applied || '—' }),
                el('dt', { text: '段階・結果' }), el('dd', {}, [stageTag(e.stage), document.createTextNode(' '), resultTag(e.result)]),
                el('dt', { text: '次の予定' }), el('dd', {}, [nextCell(e)]),
                el('dt', { text: 'メモ' }), el('dd', { class: 'detail-memo', text: e.memo || '—' })
            ]),
            el('h3', { class: 'detail-h', text: '選考の進み具合' }),
            progressBox,
            el('h3', { class: 'detail-h' }, [document.createTextNode('この応募の指導記録'),
                el('button', { type: 'button', class: 'btn btn-sm h-btn', onclick: function () { dlg.close(); openRecordForm(s, null, data.entries.filter(function (x) { return x.studentId === s.id; }), e.id, reopen); } }, [RUI.icon('i-plus'), el('span', { text: '記録を追加' })])]),
            recordBox
        ]);
        var foot = el('div', { class: 'modal-foot detail-foot' }, [
            el('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: function () { dlg.close(); openProgressForm(e, function (res) { replaceEntry(res.item); setJob(res.item.studentId, res.jobStatus); draw(); reopen(); }); } }, [RUI.icon('i-flag'), el('span', { text: '進み具合を更新' })]),
            el('button', { type: 'button', class: 'btn btn-sm', onclick: function () { dlg.close(); openEntryForm(e, null, function (res) { replaceEntry(res.item); draw(); reopen(); }); } }, [RUI.icon('i-edit'), el('span', { text: '会社などの情報を変更' })]),
            el('button', { type: 'button', class: 'btn btn-sm btn-danger-line', onclick: function () {
                dlg.close();
                RUI.confirm({ title: '応募を削除', danger: true, okLabel: '削除する', message: s.name + 'さんの「' + e.company + '」の応募を削除します。選考の履歴も消えます（この応募につけた指導記録は、学生の記録として残ります）。もとに戻せません。' }).then(function (yes) {
                    if (!yes) return;
                    RApi.post('deleteEntry', { entryId: e.id }, '削除しています').then(function (res) {
                        if (!res || !res.ok) { RUI.toast((res && res.message) || '削除できませんでした。', 'error'); return; }
                        data.entries = data.entries.filter(function (x) { return x.id !== e.id; });
                        setJob(res.studentId, res.jobStatus);
                        draw();
                        RUI.toast(res.message);
                    });
                });
            } }, [RUI.icon('i-trash'), el('span', { text: '削除' })])
        ]);
        var dlg = RUI.modal(e.company, body, foot);
        dlg.classList.add('r-modal-wide');

        RApi.post('entryDetail', { entryId: e.id }).then(function (res) {
            if (!res || !res.ok) { progressBox.replaceChildren(el('p', { class: 'muted', text: (res && res.message) || '読み込めませんでした。' })); return; }
            // 実際に通った段階だけを、通った順に表示する（とばした段階は出さない）
            var passed = [];
            res.logs.forEach(function (l) { if (passed.indexOf(l.stage) < 0) passed.push(l.stage); });
            var steps = el('ol', { class: 'steps' }, passed.map(function (st, i) {
                var last = i === passed.length - 1;
                return el('li', { class: 'step' + (last ? ' is-current' : ' is-done') }, [el('span', { class: 'step-dot', text: String(i + 1) }), el('span', { class: 'step-label', text: st })]);
            }).concat(e.result !== '選考中' ? [el('li', { class: 'step is-result result-step-' + RESULTS.indexOf(e.result) }, [el('span', { class: 'step-dot', text: '●' }), el('span', { class: 'step-label', text: e.result })])] : []));
            var logList = el('ol', { class: 'log-list' }, res.logs.slice().reverse().map(function (l) {
                return el('li', {}, [
                    el('p', { class: 'log-head' }, [el('span', { class: 'log-field', text: l.stage }), el('span', { text: l.result })]),
                    el('p', { class: 'log-meta', text: l.at + '　' + l.by })
                ]);
            }));
            progressBox.replaceChildren(steps, el('details', { class: 'log-details' }, [el('summary', { text: '更新の履歴（' + res.logs.length + '件）' }), logList]));
            recordBox.replaceChildren(recordList(res.records, s, data.entries.filter(function (x) { return x.studentId === s.id; }), function () { dlg.close(); reopen(); }));
        }).catch(function () { progressBox.replaceChildren(el('p', { class: 'muted', text: '読み込めませんでした。' })); });
    }

    function render(body, ctx) {
        filters.student = (ctx.params && ctx.params.get('student')) || '';
        page = 1;
        root = el('div', { class: 'page-entries' });
        body.append(root);
        root.append(el('section', { class: 'panel' }, [el('p', { class: 'empty', text: '読み込んでいます…' })]));
        Promise.all([RApi.post('entries', {}, '応募を読み込んでいます'), RApi.post('students', {}), RApi.post('masters', {})]).then(function (res) {
            if (!res[0] || !res[0].ok || !res[1] || !res[1].ok || !res[2] || !res[2].ok) { RUI.toast('読み込めませんでした。', 'error'); return; }
            data.entries = res[0].entries;
            data.today = res[0].today;
            data.students = res[1].students;
            data.departments = res[2].departments || [];
            data.classes = (res[2].classes || []).slice().sort(function (a, b) { return a.grade - b.grade || a.name.localeCompare(b.name, 'ja', { numeric: true }); });
            draw();
        }).catch(function (err) {
            console.error(err);
            root.replaceChildren(el('section', { class: 'panel' }, [el('p', { class: 'empty', text: '通信に失敗しました。画面を読み込み直してください。' })]));
        });
    }

    (window.RPages = window.RPages || {}).entries = { render: render };
})();
