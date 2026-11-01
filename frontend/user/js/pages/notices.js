/* R-eadership 「お知らせ」の画面（連絡・要望・意見）
 * - 学校管理者も一般の教員も投稿できる。公開範囲：全体／学校管理者／個人（宛先の先生を何人でも選べる）
 * - 見えるのは、公開範囲に入る人と投稿した本人だけ（GASが選んで返す）
 * - 要望・意見は、公開範囲「学校管理者」で送る
 * - 一覧：未読に印。しぼりこみ（すべて・未読・重要・学校管理者あて・自分の投稿）。30件ずつ
 * - 詳しい画面：本文・返信・（投稿した本人には）だれが読んだか。開くと既読になる
 */
(window.RPages = window.RPages || {}).notices = (function () {
    'use strict';

    var el = function () { return RUI.el.apply(null, arguments); };
    var AUD = { all: '全体', admin: '学校管理者', people: '個人' };
    var PAGE_SIZE = 30;
    var data = { notices: [], teachers: [] };
    var filter = 'all';
    var page = 1;
    var me = null;
    var root = null;

    function isMine(n) { return me && n.by.toLowerCase() === me.teacherId.toLowerCase(); }
    function audienceText(n) { return n.audience === 'people' ? '個人：' + n.toNames.join('、') : AUD[n.audience]; }
    function when(t) { return String(t || '').slice(0, 16); }
    function updateBadge() { if (window.RApp && RApp.setUnread) RApp.setUnread(data.notices.filter(function (n) { return n.unread; }).length); }

    var FILTERS = [
        ['all', 'すべて', function () { return true; }],
        ['unread', '未読', function (n) { return n.unread; }],
        ['important', '重要', function (n) { return n.important; }],
        ['toAdmin', '学校管理者あて（要望・意見）', function (n) { return n.audience === 'admin'; }],
        ['mine', '自分の投稿', function (n) { return isMine(n); }]
    ];

    /* ---------- 書く・書き直す ---------- */
    function openForm(n) {
        var isNew = !n;
        n = n || { audience: 'all', to: [], important: false };
        var teacherOpts = data.teachers.map(function (t) { return { value: t.id, label: t.name + '（' + t.id + '）', group: t.role === 'admin' ? '学校管理者' : '教員' }; });
        RUI.form({
            title: isNew ? 'お知らせを書く' : 'お知らせを書き直す',
            fields: [
                { name: 'title', label: 'タイトル', value: n.title, required: true, maxlength: 50, placeholder: '例：来週の職員会議について／名簿の印刷についての要望' },
                { name: 'body', label: '本文', value: n.body, required: true, type: 'textarea', maxlength: 3000 },
                { name: 'important', label: '重要', type: 'select', value: n.important ? '1' : '', options: [{ value: '', label: '通常' }, { value: '1', label: '重要（一覧で目立たせる）' }] },
                { name: 'audience', label: '公開範囲', type: 'select', required: true, value: n.audience, options: [
                    { value: 'all', label: '全体（すべての先生）' },
                    { value: 'admin', label: '学校管理者（要望・意見はこちら）' },
                    { value: 'people', label: '個人（宛先の先生を選ぶ）' }
                ], hint: '見えるのは、公開範囲に入る先生と、あなただけです。「個人」は、宛先に入っていなければ学校管理者にも見えません。' },
                { name: 'to', label: '宛先の先生', type: 'checks', value: n.to, options: teacherOpts, emptyText: 'ほかの先生のアカウントがありません。' }
            ],
            submitLabel: isNew ? '投稿する' : '書き直す',
            onChange: function (form) {
                var off = form.elements.audience.value !== 'people';
                form.querySelectorAll('input[name="to"]').forEach(function (cb) { cb.disabled = off; });
                var box = form.querySelector('.check-list');
                if (box) box.classList.toggle('is-disabled', off);
            },
            onSubmit: function (v) {
                var item = { id: n.id, title: v.title, body: v.body, important: v.important === '1', audience: v.audience, to: v.audience === 'people' ? v.to : [] };
                return RApi.post('saveNotice', { item: item }, isNew ? '投稿しています' : '保存しています').then(function (res) {
                    if (res && res.ok) { RUI.toast(res.message); reload(); }
                    return res;
                });
            }
        });
    }

    /* ---------- 詳しい画面 ---------- */
    function openDetail(id) {
        RApi.all([['noticeDetail', { noticeId: id }]], 'お知らせを読み込んでいます').then(function (res) {
            var r = res[0];
            if (!r || !r.ok) { RUI.toast((r && r.message) || '読み込めませんでした。', 'error'); return; }
            var item = data.notices.find(function (x) { return x.id === id; });
            if (item && item.unread) { item.unread = false; draw(); updateBadge(); }
            showDetail(r);
        });
    }

    function showDetail(r) {
        var n = r.notice;
        var meAdmin = me && me.role === 'admin';
        var replyInput = el('textarea', { rows: 3, maxlength: 3000, placeholder: '返信を書く', 'aria-label': '返信' });
        var sendBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '返信する' });
        var body = el('div', { class: 'modal-body notice-detail' }, [
            el('div', { class: 'notice-meta' }, [
                n.important ? el('span', { class: 'st-tag notice-important', text: '重要' }) : null,
                el('span', { class: 'st-tag aud-' + n.audience, text: audienceText(n) }),
                el('span', { class: 'muted', text: n.byName + '　' + when(n.createdAt) + (n.updatedAt !== n.createdAt ? '（最後の書きこみ ' + when(n.updatedAt) + '）' : '') })
            ]),
            el('p', { class: 'notice-body', text: n.body }),
            r.readers ? el('div', { class: 'readers' }, [
                el('p', { class: 'readers-head', text: '読んだ人 ' + r.readers.filter(function (x) { return x.readAt; }).length + ' ／ ' + r.readers.length + '人' }),
                el('div', { class: 'tag-row' }, r.readers.map(function (x) {
                    return el('span', { class: 'reader ' + (x.readAt ? 'is-read' : ''), title: x.readAt ? when(x.readAt) + ' に既読' : 'まだ読んでいません', text: (x.readAt ? '✓ ' : '') + x.name });
                }))
            ]) : null,
            el('h3', { class: 'detail-h', text: '返信（' + r.replies.length + '件）' }),
            r.replies.length ? el('ol', { class: 'record-list' }, r.replies.map(function (p) {
                var canDel = meAdmin || p.by.toLowerCase() === me.teacherId.toLowerCase();
                return el('li', {}, [
                    el('p', { class: 'record-head' }, [el('b', { text: p.byName }), el('span', { class: 'record-by', text: when(p.at) })]),
                    el('p', { class: 'record-body', text: p.body }),
                    canDel ? el('div', { class: 'record-actions' }, [el('button', { type: 'button', class: 'text-btn text-danger', text: '削除', onclick: function () {
                        dlg.close();
                        RUI.confirm({ title: '返信を削除', danger: true, okLabel: '削除する', message: 'この返信を削除します。もとに戻せません。' }).then(function (yes) {
                            if (!yes) { openDetail(n.id); return; }
                            RApi.post('deleteReply', { replyId: p.id }, '削除しています').then(function (res) {
                                RUI.toast(res.message, res.ok ? '' : 'error');
                                openDetail(n.id);
                                reload(true);
                            });
                        });
                    } })]) : null
                ]);
            })) : el('p', { class: 'muted', text: 'まだ返信はありません。' }),
            el('div', { class: 'reply-box' }, [replyInput, el('div', { class: 'reply-actions' }, [sendBtn])])
        ]);
        sendBtn.addEventListener('click', function () {
            if (!replyInput.value.trim()) { RUI.toast('返信を入力してください。', 'error'); return; }
            sendBtn.disabled = true;
            RApi.post('replyNotice', { noticeId: n.id, body: replyInput.value }, '返信しています').then(function (res) {
                if (!res || !res.ok) { sendBtn.disabled = false; RUI.toast((res && res.message) || '返信できませんでした。', 'error'); return; }
                RUI.toast(res.message);
                dlg.close();
                openDetail(n.id);
                reload(true);
            });
        });
        var foot = el('div', { class: 'modal-foot detail-foot' }, [
            isMine(n) ? el('button', { type: 'button', class: 'btn btn-sm', onclick: function () { dlg.close(); openForm(n); } }, [RUI.icon('i-edit'), el('span', { text: '書き直す' })]) : null,
            (isMine(n) || meAdmin) ? el('button', { type: 'button', class: 'btn btn-sm btn-danger-line', onclick: function () {
                dlg.close();
                RUI.confirm({ title: 'お知らせを削除', danger: true, okLabel: '削除する', message: '「' + n.title + '」を削除します。返信もすべて消えます。もとに戻せません。' }).then(function (yes) {
                    if (!yes) return;
                    RApi.post('deleteNotice', { noticeId: n.id }, '削除しています').then(function (res) {
                        RUI.toast(res.message, res.ok ? '' : 'error');
                        if (res.ok) reload();
                    });
                });
            } }, [RUI.icon('i-trash'), el('span', { text: '削除' })]) : null
        ]);
        var dlg = RUI.modal(n.title, body, foot);
        dlg.classList.add('r-modal-wide');
    }

    /* ---------- 一覧 ---------- */
    function draw() {
        root.replaceChildren();
        var f = FILTERS.find(function (x) { return x[0] === filter; }) || FILTERS[0];
        var list = data.notices.filter(f[2]);
        var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        if (page > pages) page = pages;
        var shown = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        var unread = data.notices.filter(function (n) { return n.unread; }).length;

        var chips = el('div', { class: 'chip-row', role: 'group', 'aria-label': 'しぼりこみ' }, FILTERS.map(function (x) {
            var n = data.notices.filter(x[2]).length;
            return el('button', { type: 'button', class: 'chip' + (filter === x[0] ? ' is-active' : ''), 'aria-pressed': String(filter === x[0]), onclick: function () { filter = x[0]; page = 1; draw(); } },
                [el('span', { text: x[1] }), el('b', { text: String(n) })]);
        }));
        var listEl = shown.length ? el('ul', { class: 'notice-list' }, shown.map(function (n) {
            var li = el('li', { class: 'notice-item' + (n.unread ? ' is-unread' : '') + (n.important ? ' is-important' : ''), tabindex: '0', role: 'button', 'aria-label': n.title + (n.unread ? '（未読）' : '') }, [
                el('span', { class: 'unread-dot', 'aria-hidden': 'true' }),
                el('div', { class: 'notice-main' }, [
                    el('p', { class: 'notice-title' }, [n.important ? el('span', { class: 'st-tag notice-important', text: '重要' }) : null, el('span', { text: n.title })]),
                    el('p', { class: 'notice-snippet', text: n.body.replace(/\n/g, ' ') }),
                    el('p', { class: 'notice-sub' }, [
                        el('span', { class: 'st-tag aud-' + n.audience, text: audienceText(n) }),
                        el('span', { text: n.byName }),
                        el('span', { text: when(n.updatedAt) }),
                        n.replyCount ? el('span', { text: '返信 ' + n.replyCount + '件' }) : null
                    ])
                ])
            ]);
            li.addEventListener('click', function () { openDetail(n.id); });
            li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(n.id); } });
            return li;
        })) : el('p', { class: 'empty', text: data.notices.length ? '条件に合うお知らせはありません。' : 'まだお知らせはありません。「お知らせを書く」から投稿できます。' });

        var pager = el('nav', { class: 'pager' }, [el('p', { class: 'pager-info', text: list.length ? ((page - 1) * PAGE_SIZE + 1) + '〜' + Math.min(list.length, page * PAGE_SIZE) + '件目（' + list.length + '件中）' : '0件' })]);
        if (pages > 1) {
            var box = el('div', { class: 'pager-btns' });
            for (var p = 1; p <= pages; p++) {
                (function (p) { box.append(el('button', { type: 'button', class: 'page-btn' + (p === page ? ' is-current' : ''), disabled: p === page, text: String(p), onclick: function () { page = p; draw(); } })); })(p);
            }
            pager.append(box);
        }
        root.append(el('section', { class: 'panel panel-flush' }, [
            el('div', { class: 'list-head' }, [
                el('p', { class: 'list-count', text: 'お知らせ' + (unread ? '（未読 ' + unread + '件）' : '') }),
                el('button', { type: 'button', class: 'btn btn-primary', onclick: function () { openForm(null); } }, [RUI.icon('i-plus'), el('span', { text: 'お知らせを書く' })])
            ]),
            chips, listEl, pager
        ]));
    }

    function reload(quiet) {
        var p = quiet ? Promise.all([RApi.post('notices', {}), RApi.post('teacherDirectory', {})]) : RApi.all([['notices'], ['teacherDirectory']], 'お知らせを読み込んでいます');
        return p.then(function (res) {
            if (!res[0] || !res[0].ok) { RUI.toast('読み込めませんでした。', 'error'); return; }
            data.notices = res[0].notices;
            data.teachers = (res[1] && res[1].teachers) || [];
            draw();
            updateBadge();
        });
    }

    function render(body, ctx) {
        me = ctx.user;
        page = 1;
        root = el('div', { class: 'page-notices' });
        body.append(root);
        reload();
    }

    return { render: render };
})();
