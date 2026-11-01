/* R-eadership 「ダッシュボード」の画面
 * - 学校管理者はすべて、教員は担当クラスの学生だけで集計する（GASが選んで返したデータを使う）
 * - しぼりこみ：卒業予定年度・学科（最初は、今年度に卒業する学年）
 * - 数える学生：在籍・卒業の学生（休学・退学・除籍は、人数だけ別に表示）
 * - 表示：お知らせ（未読・重要を先に3件）／学生数／就職希望／就職決定率・内定率のメーター／就活の状況と希望進路の割合／
 *         会社ごとの人数（エントリーと就職決定）／進学先ごとの人数／クラスごとの就職決定率／3日以内の予定
 * - 数字は0から増え、メーターと棒は左から伸びる（動きを減らす設定の人には動かさない）
 */
(window.RPages = window.RPages || {}).dashboard = (function () {
    'use strict';

    var el = function () { return RUI.el.apply(null, arguments); };
    var JOBS = ['未着手', '選考中', '内定', '就職先決定', '選考終了'];
    var JOB_COLORS = { '未着手': '#D9D2C7', '選考中': '#2B50FF', '内定': '#E8336B', '就職先決定': '#E0A400', '選考終了': '#8A837B' };
    var COURSES = ['就職希望', '進学希望', '帰国希望', '未定'];
    var COURSE_COLORS = { '就職希望': '#2B50FF', '進学希望': '#1FA35A', '帰国希望': '#8B5CF6', '未定': '#D9D2C7' };
    var COUNTED = ['在籍', '卒業'];
    var TOP = 10;
    var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var data = { students: [], entries: [], classes: [], departments: [], notices: [], fiscalYear: 0, today: '' };
    var filters = { year: '', dept: '' };
    var showAll = { company: false, school: false };
    var root = null;
    var tip = null;

    function cls(code) { return data.classes.find(function (c) { return c.code === code; }) || null; }
    function short(x) { return x ? (x.label || x.name) : ''; }
    function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }

    /* ---------- 動き ---------- */
    // 数字を0から増やす
    function countUp(node, to, suffix) {
        suffix = suffix || '';
        var fmt = function (v) { return (Math.round(v * 10) / 10).toLocaleString('ja-JP') + suffix; };
        if (REDUCED) { node.textContent = fmt(to); return; }
        var start = null, dur = 900;
        var step = function (t) {
            if (start === null) start = t;
            var k = Math.min(1, (t - start) / dur);
            var e = 1 - Math.pow(1 - k, 3);
            node.textContent = fmt(String(to).indexOf('.') >= 0 || to % 1 ? to * e : Math.round(to * e));
            if (k < 1) requestAnimationFrame(step);
        };
        node.textContent = fmt(0);
        requestAnimationFrame(step);
    }
    // 幅・メーターを、描いたあとで目標の値にする（CSSの transition で伸びる）
    function grow(fn) { if (REDUCED) fn(); else requestAnimationFrame(function () { requestAnimationFrame(fn); }); }

    /* ---------- ツールチップ（棒・メーターにマウスを当てたとき） ---------- */
    function bindTip(node, text) {
        node.setAttribute('aria-label', text);
        node.addEventListener('mouseenter', function () { tip.textContent = text; tip.hidden = false; });
        node.addEventListener('mousemove', function (e) {
            tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 14) + 'px';
            tip.style.top = (e.clientY + 14) + 'px';
        });
        node.addEventListener('mouseleave', function () { tip.hidden = true; });
    }

    /* ---------- 部品 ---------- */
    function card(title, sub, body, extraClass) {
        return el('section', { class: 'panel dash-card ' + (extraClass || '') }, [
            el('div', { class: 'dash-card-head' }, [el('h2', { class: 'dash-title', text: title }), sub ? el('p', { class: 'dash-sub', text: sub }) : null]),
            body
        ]);
    }
    function kpi(label, value, suffix, note) {
        var num = el('span', { class: 'kpi-num' });
        countUp(num, value, '');
        return el('div', { class: 'panel kpi' }, [
            el('p', { class: 'kpi-label', text: label }),
            el('p', { class: 'kpi-value' }, [num, el('small', { text: suffix })]),
            note ? el('p', { class: 'kpi-note', text: note }) : null
        ]);
    }
    // 半円のメーター
    function gauge(label, value, total, color, note) {
        var p = pct(value, total);
        var R = 70, len = Math.PI * R;
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 180 104');
        svg.setAttribute('class', 'gauge-svg');
        svg.setAttribute('aria-hidden', 'true');
        var mk = function (stroke, cl) {
            var path = document.createElementNS(ns, 'path');
            path.setAttribute('d', 'M20 92 A70 70 0 0 1 160 92');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', stroke);
            path.setAttribute('stroke-width', '16');
            path.setAttribute('stroke-linecap', 'round');
            if (cl) path.setAttribute('class', cl);
            svg.append(path);
            return path;
        };
        mk('#EEE8DE');
        var bar = mk(color, 'gauge-bar');
        bar.style.strokeDasharray = len;
        bar.style.strokeDashoffset = len;
        var num = el('span', { class: 'gauge-num' });
        countUp(num, p, '%');
        grow(function () { bar.style.strokeDashoffset = len * (1 - Math.min(p, 100) / 100); });
        var box = el('div', { class: 'panel kpi gauge' }, [
            el('p', { class: 'kpi-label', text: label }),
            el('div', { class: 'gauge-wrap' }, [svg, num]),
            el('p', { class: 'kpi-note', text: value + '人 ／ ' + total + '人' + (note ? '　' + note : '') })
        ]);
        bindTip(box, label + '：' + p + '%（' + value + '人 ／ ' + total + '人）');
        return box;
    }
    // 1本の棒を、いくつかの区切りに分けて表示する（割合）
    function segmentBar(parts, total, unit) {
        var bar = el('div', { class: 'seg-bar', role: 'img' });
        var legend = el('ul', { class: 'seg-legend' });
        var segs = [];
        parts.forEach(function (p) {
            var share = total ? p.value / total * 100 : 0;
            if (p.value) {
                var seg = el('div', { class: 'seg', style: 'background:' + p.color + ';width:0' }, [share >= 9 ? el('span', { class: 'seg-label' + (p.light ? ' is-dark' : '') }, [
                    document.createTextNode(p.value + unit), share >= 14 ? el('small', { text: Math.round(share) + '%' }) : null
                ]) : null]);
                bindTip(seg, p.name + '：' + p.value + unit + '（' + Math.round(share) + '%）');
                bar.append(seg);
                segs.push([seg, share]);
            }
            legend.append(el('li', {}, [el('span', { class: 'swatch', style: 'background:' + p.color }), el('span', { text: p.name }), el('b', { text: p.value + unit }),
                el('span', { class: 'seg-pct', text: total ? Math.round(share * 10) / 10 + '%' : '—' })]));
        });
        if (!total) bar.append(el('p', { class: 'seg-empty', text: 'まだデータがありません' }));
        bar.setAttribute('aria-label', parts.map(function (p) { return p.name + ' ' + p.value + unit; }).join('、'));
        grow(function () { segs.forEach(function (s) { s[0].style.width = s[1] + '%'; }); });
        return el('div', {}, [bar, legend]);
    }
    // 横の棒グラフ（多い順）。rows：[{ name, value, value2? }]。value2 があれば、value の中に濃い色で重ねる
    function rankBars(rows, opt) {
        var max = Math.max.apply(null, [1].concat(rows.map(function (r) { return r.value; })));
        var list = el('ol', { class: 'rank-list' });
        var anims = [];
        rows.forEach(function (r) {
            var track = el('div', { class: 'rank-track' });
            var b1 = el('div', { class: 'rank-bar', style: 'background:' + opt.color1 + ';width:0' });
            track.append(b1);
            anims.push([b1, r.value / max * 100]);
            if (opt.color2) {
                var b2 = el('div', { class: 'rank-bar rank-bar2', style: 'background:' + opt.color2 + ';width:0' });
                track.append(b2);
                anims.push([b2, (r.value2 || 0) / max * 100]);
            }
            var li = el('li', { class: 'rank-row' }, [
                el('span', { class: 'rank-name', text: r.name, title: r.name }),
                track,
                el('span', { class: 'rank-val' }, opt.color2
                    ? [el('b', { text: String(r.value2 || 0) }), document.createTextNode(' ／ ' + r.value + '人')]
                    : [el('b', { text: String(r.value) }), document.createTextNode('人')])
            ]);
            bindTip(li, opt.tip(r));
            list.append(li);
        });
        grow(function () { anims.forEach(function (a) { a[0].style.width = a[1] + '%'; }); });
        return list;
    }

    /* ---------- 集計 ---------- */
    function targetStudents() {
        return data.students.filter(function (s) {
            var c = cls(s.classCode);
            if (filters.year && s.gradYear !== filters.year) return false;
            if (filters.dept && (!c || c.deptId !== filters.dept)) return false;
            return true;
        });
    }

    function draw() {
        root.replaceChildren();
        var scope = targetStudents();
        var counted = scope.filter(function (s) { return COUNTED.indexOf(s.enroll) >= 0; });
        var others = scope.length - counted.length;
        var ids = {};
        counted.forEach(function (s) { ids[s.id] = s; });
        var entries = data.entries.filter(function (e) { return ids[e.studentId]; });
        var jobWish = counted.filter(function (s) { return s.course === '就職希望'; });
        var decided = jobWish.filter(function (s) { return s.job === '就職先決定'; }).length;
        var offered = jobWish.filter(function (s) { return s.job === '内定' || s.job === '就職先決定'; }).length;

        // しぼりこみ
        var years = data.students.map(function (s) { return s.gradYear; }).filter(function (y, i, a) { return y && a.indexOf(y) === i; }).sort();
        var yearSel = el('select', { 'aria-label': '卒業予定年度' });
        RUI.setOptions(yearSel, [{ value: '', label: 'すべての学年' }].concat(years.map(function (y) { return { value: y, label: y + '年度 卒業予定' + (Number(y) === data.fiscalYear ? '（今年度）' : '') }; })), filters.year);
        yearSel.addEventListener('change', function () { filters.year = yearSel.value; draw(); });
        var deptSel = el('select', { 'aria-label': '学科' });
        RUI.setOptions(deptSel, [{ value: '', label: 'すべての学科' }].concat(data.departments.map(function (d) { return { value: d.id, label: d.name }; })), filters.dept);
        deptSel.addEventListener('change', function () { filters.dept = deptSel.value; draw(); });
        root.append(el('div', { class: 'dash-filter' }, [
            el('label', { class: 'filter' }, [el('span', { text: '卒業予定年度' }), yearSel]),
            el('label', { class: 'filter' }, [el('span', { text: '学科' }), deptSel]),
            el('p', { class: 'dash-scope', text: (window.RApp && RApp.user && RApp.user.role !== 'admin') ? '担当クラスの学生で集計しています' : 'すべてのクラスの学生で集計しています' })
        ]));

        // 上の数字とメーター
        root.append(el('div', { class: 'kpi-row' }, [
            kpi('学生数', counted.length, '人', others ? '休学・退学・除籍の ' + others + '人は除く' : '在籍・卒業の学生'),
            kpi('就職希望', jobWish.length, '人', '希望進路が「就職希望」'),
            gauge('就職決定率', decided, jobWish.length, '#E0A400', '内定承諾'),
            gauge('内定率', offered, jobWish.length, '#E8336B', '内定＋就職先決定')
        ]));

        // お知らせ（未読と重要を先に、3件まで）
        var ns = data.notices.slice().sort(function (a, b) {
            return (b.unread - a.unread) || (b.important - a.important) || b.updatedAt.localeCompare(a.updatedAt);
        }).slice(0, 3);
        var unreadN = data.notices.filter(function (n) { return n.unread; }).length;
        root.append(card('お知らせ', unreadN ? '未読 ' + unreadN + '件' : '未読はありません', el('div', {}, [
            ns.length ? el('ul', { class: 'dash-notices' }, ns.map(function (n) {
                return el('li', { class: n.unread ? 'is-unread' : '' }, [
                    el('span', { class: 'unread-dot', 'aria-hidden': 'true' }),
                    n.important ? el('span', { class: 'st-tag notice-important', text: '重要' }) : null,
                    el('a', { href: '#notices', class: 'dash-notice-title', text: n.title }),
                    el('span', { class: 'muted', text: n.byName + '　' + String(n.updatedAt).slice(5, 16).replace('-', '/') })
                ]);
            })) : el('p', { class: 'muted dash-empty', text: 'お知らせはありません。' }),
            el('a', { href: '#notices', class: 'h-link more-btn', text: 'お知らせを開く' })
        ]), 'dash-notice-card'));

        // 就活の状況・希望進路
        var jobParts = JOBS.map(function (j) { return { name: j, value: counted.filter(function (s) { return s.job === j; }).length, color: JOB_COLORS[j], light: j === '未着手' || j === '就職先決定' }; });
        var courseParts = COURSES.map(function (c) { return { name: c, value: counted.filter(function (s) { return s.course === c; }).length, color: COURSE_COLORS[c], light: c === '未定' }; });
        root.append(el('div', { class: 'dash-grid' }, [
            card('就活の状況', '応募の結果から自動で決まります', segmentBar(jobParts, counted.length, '人')),
            card('希望進路', '学生ごとの希望進路', segmentBar(courseParts, counted.length, '人'))
        ]));

        // 会社ごと
        var byCompany = {};
        entries.forEach(function (e) {
            var k = e.company;
            if (!byCompany[k]) byCompany[k] = { name: k, entered: {}, decided: {} };
            byCompany[k].entered[e.studentId] = true;
            if (e.result === '内定承諾') byCompany[k].decided[e.studentId] = true;
        });
        var companies = Object.keys(byCompany).map(function (k) {
            var c = byCompany[k];
            return { name: k, value: Object.keys(c.entered).length, value2: Object.keys(c.decided).length };
        }).sort(function (a, b) { return b.value2 - a.value2 || b.value - a.value || a.name.localeCompare(b.name, 'ja'); });
        var compBody = companies.length
            ? el('div', {}, [
                el('ul', { class: 'seg-legend' }, [
                    el('li', {}, [el('span', { class: 'swatch', style: 'background:#2B50FF' }), el('span', { text: '就職決定（内定承諾）' })]),
                    el('li', {}, [el('span', { class: 'swatch', style: 'background:#C7D1FF' }), el('span', { text: 'エントリーした人数' })])
                ]),
                rankBars(showAll.company ? companies : companies.slice(0, TOP), { color1: '#C7D1FF', color2: '#2B50FF', tip: function (r) { return r.name + '：就職決定 ' + r.value2 + '人／エントリー ' + r.value + '人'; } }),
                companies.length > TOP ? el('button', { type: 'button', class: 'text-btn more-btn', text: showAll.company ? '上位' + TOP + '社だけ表示' : 'すべての会社を表示（' + companies.length + '社）', onclick: function () { showAll.company = !showAll.company; draw(); } }) : null
            ])
            : el('p', { class: 'muted dash-empty', text: 'まだ応募はありません。' });

        // 進学先ごと
        var bySchool = {};
        counted.filter(function (s) { return s.course === '進学希望'; }).forEach(function (s) {
            var k = s.school || '（進学予定先が未入力）';
            bySchool[k] = (bySchool[k] || 0) + 1;
        });
        var schools = Object.keys(bySchool).map(function (k) { return { name: k, value: bySchool[k] }; })
            .sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name, 'ja'); });
        var schoolBody = schools.length
            ? el('div', {}, [
                rankBars(showAll.school ? schools : schools.slice(0, TOP), { color1: '#1FA35A', tip: function (r) { return r.name + '：' + r.value + '人'; } }),
                schools.length > TOP ? el('button', { type: 'button', class: 'text-btn more-btn', text: showAll.school ? '上位' + TOP + '校だけ表示' : 'すべて表示（' + schools.length + '校）', onclick: function () { showAll.school = !showAll.school; draw(); } }) : null
            ])
            : el('p', { class: 'muted dash-empty', text: '進学希望の学生はいません。' });

        root.append(el('div', { class: 'dash-grid' }, [
            card('会社ごとの人数', companies.length + '社。就職決定の多い順', compBody),
            card('進学先ごとの人数', '希望進路が「進学希望」の学生の進学予定先', schoolBody)
        ]));

        // クラスごとの就職決定率
        var classRows = data.classes.filter(function (c) { return !filters.dept || c.deptId === filters.dept; }).map(function (c) {
            var wish = jobWish.filter(function (s) { return s.classCode === c.code; });
            if (!wish.length) return null;
            var d = wish.filter(function (s) { return s.job === '就職先決定'; }).length;
            var o = wish.filter(function (s) { return s.job === '内定'; }).length;
            return { c: c, wish: wish.length, decided: d, offered: o };
        }).filter(Boolean);
        var meterList = el('ul', { class: 'meter-list' });
        var meterAnims = [];
        classRows.forEach(function (r) {
            var b1 = el('div', { class: 'meter-fill', style: 'background:#E0A400;width:0' });
            var b2 = el('div', { class: 'meter-fill meter-fill2', style: 'background:#E8336B;width:0' });
            meterAnims.push([b1, r.decided / r.wish * 100], [b2, (r.decided + r.offered) / r.wish * 100]);
            var li = el('li', { class: 'meter-row' }, [
                el('span', { class: 'meter-name', text: r.c.grade + '年 ' + short(r.c) }),
                el('div', { class: 'meter-track' }, [b2, b1]),
                el('span', { class: 'meter-val' }, [el('b', { text: pct(r.decided, r.wish) + '%' }), document.createTextNode(' ' + r.decided + '／' + r.wish + '人')])
            ]);
            bindTip(li, short(r.c) + '：就職決定 ' + r.decided + '人・内定 ' + r.offered + '人／就職希望 ' + r.wish + '人');
            meterList.append(li);
        });
        grow(function () { meterAnims.forEach(function (a) { a[0].style.width = a[1] + '%'; }); });

        // 3日以内の予定
        var today = data.today;
        var soon = data.entries.filter(function (e) {
            if (!e.nextDate || !ids[e.studentId]) return false;
            var d = Math.round((new Date(e.nextDate + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
            e._days = d;
            return d >= 0 && d <= 3;
        }).sort(function (a, b) { return (a.nextDate + a.nextTime).localeCompare(b.nextDate + b.nextTime); });
        var SOON_MAX = 8;
        var soonList = soon.length ? el('ol', { class: 'soon-list' }, soon.slice(0, SOON_MAX).map(function (e) {
            var s = ids[e.studentId];
            var w = '日月火水木金土'.charAt(new Date(e.nextDate + 'T00:00:00').getDay());
            return el('li', { class: e._days === 0 ? 'is-today' : '' }, [
                el('span', { class: 'soon-when' }, [el('b', { text: e._days === 0 ? '今日' : e._days === 1 ? '明日' : e._days + '日後' }), document.createTextNode(e.nextDate.slice(5).replace('-', '/') + '（' + w + '）' + (e.nextTime ? ' ' + e.nextTime : ''))]),
                el('span', { class: 'soon-what' }, [el('b', { text: s.name }), document.createTextNode('　' + e.company + (e.nextNote ? '：' + e.nextNote : ''))])
            ]);
        })) : el('p', { class: 'muted dash-empty', text: '3日以内の予定はありません。' });

        root.append(el('div', { class: 'dash-grid' }, [
            card('クラスごとの就職決定率', '就職希望の学生のうち。黄色＝就職決定、赤＝内定', classRows.length ? meterList : el('p', { class: 'muted dash-empty', text: '就職希望の学生はいません。' })),
            card('3日以内の予定', soon.length + '件。面接・試験など（応募管理の「次の予定」）', el('div', {}, [
                soonList,
                el('a', { href: '#entries', class: 'h-link more-btn', text: soon.length > SOON_MAX ? 'ほかの ' + (soon.length - SOON_MAX) + '件を応募管理で見る' : '応募管理を開く' })
            ]))
        ]));
    }

    function render(body) {
        root = el('div', { class: 'page-dashboard' });
        body.append(root);
        if (!tip) { tip = el('div', { class: 'chart-tip', role: 'tooltip', hidden: true }); document.body.append(tip); }
        RApi.all([['students'], ['entries'], ['masters'], ['notices']], 'ダッシュボードを読み込んでいます').then(function (res) {
            // どのデータが読み込めなかったかを、画面に出す（原因を調べやすくするため）
            var names = ['学生名簿（students）', '応募（entries）', '学科・クラス・資格（masters）', 'お知らせ（notices）'];
            var bad = res.map(function (r, i) { return r && r.ok ? null : names[i] + '：' + ((r && r.message) || '返事がありません'); }).filter(Boolean);
            if (bad.length) {
                RUI.toast('読み込めませんでした。', 'error');
                root.replaceChildren(el('section', { class: 'panel' }, [
                    el('p', { class: 'empty', text: 'ダッシュボードのデータを読み込めませんでした。' }),
                    el('ul', { class: 'import-error' }, bad.map(function (m) { return el('li', { text: m }); }))
                ]));
                return;
            }
            data.students = res[0].students;
            data.fiscalYear = res[0].fiscalYear;
            data.entries = res[1].entries;
            data.today = res[1].today;
            data.departments = res[2].departments || [];
            data.notices = res[3].notices || [];
            data.classes = (res[2].classes || []).slice().sort(function (a, b) { return a.grade - b.grade || a.name.localeCompare(b.name, 'ja', { numeric: true }); });
            // 最初は、今年度に卒業する学年（いなければ、すべて）
            var fy = String(data.fiscalYear);
            filters.year = data.students.some(function (s) { return s.gradYear === fy; }) ? fy : '';
            draw();
        }).catch(function (err) {
            console.error(err);
            root.replaceChildren(el('section', { class: 'panel' }, [el('p', { class: 'empty', text: '通信に失敗しました。画面を読み込み直してください。' })]));
        });
    }

    return { render: render };
})();
