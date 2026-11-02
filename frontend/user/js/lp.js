/* R-eadership LP
 * - ダイアログ（お申し込み・利用規約・プライバシーポリシー・特定商取引法に基づく表記）を開く／閉じる
 * - お申し込み：プランの選択、学生数からのプランの確認、入力チェック、送信
 */
(function () {
    'use strict';

    var CONFIG = window.READERSHIP_CONFIG || {};
    var PLANS = {
        small:  { label: '学生数 〜199人', price: 22000, min: 1, max: 199 },
        medium: { label: '学生数 200〜499人', price: 55000, min: 200, max: 499 },
        large:  { label: '学生数 500人以上', price: 88000, min: 500, max: Infinity }
    };

    function $(id) { return document.getElementById(id); }
    function apiReady() { return /^https:\/\//.test(CONFIG.APPLY_API_URL || ''); }
    function planForStudents(n) {
        var keys = Object.keys(PLANS);
        for (var i = 0; i < keys.length; i++) {
            if (n >= PLANS[keys[i]].min && n <= PLANS[keys[i]].max) return keys[i];
        }
        return '';
    }
    function setMsg(text, isError) {
        var el = $('applyMsg');
        el.textContent = text || '';
        el.classList.toggle('is-error', !!isError);
    }

    // 受付完了の表示を、もとのお申し込みの画面にもどす（もう一度申し込むとき）
    function resetDone() {
        var f = $('applyForm');
        var done = f && f.querySelector('.apply-done');
        if (!done) return;
        done.remove();
        Array.prototype.forEach.call(f.children, function (c) { c.hidden = false; });
        f.reset();
        var hint = $('planHint');
        if (hint) hint.textContent = '';
    }

    function openDialog(id) {
        var dlg = $(id);
        if (!dlg || typeof dlg.showModal !== 'function') return;
        if (!dlg.open) dlg.showModal();
        var body = dlg.querySelector('.modal-box');
        if (body) body.scrollTop = 0;
    }

    /* ---------- ダイアログを開く／閉じる ---------- */
    document.addEventListener('click', function (e) {
        // 「このプランで申し込む」：プランを選んだ状態で、お申し込みを開く
        var applyBtn = e.target.closest('[data-apply]');
        if (applyBtn) {
            resetDone();
            var radio = document.querySelector('#applyForm input[name="plan"][value="' + applyBtn.getAttribute('data-apply') + '"]');
            if (radio) radio.checked = true;
            setMsg('');
            updatePlanHint();
            openDialog('applyDialog');
            return;
        }
        var opener = e.target.closest('[data-open]');
        if (opener) {
            openDialog(opener.getAttribute('data-open'));
            return;
        }
        if (e.target.closest('[data-close]')) {
            var d = e.target.closest('dialog');
            if (d) d.close();
            return;
        }
        // ダイアログの外側（暗いところ）を押したら閉じる
        if (e.target.tagName === 'DIALOG' && e.target.open) e.target.close();
    });

    /* ---------- お申し込み ---------- */
    var form = $('applyForm');
    if (!form) return;

    // 入力された学生数と、選んだプランが合っているかを知らせる
    function updatePlanHint() {
        var hint = $('planHint');
        var n = parseInt(form.elements.students.value, 10);
        var chosen = (form.querySelector('input[name="plan"]:checked') || {}).value || '';
        hint.classList.remove('is-error');
        if (!n || n < 1) { hint.textContent = ''; return; }
        var fit = planForStudents(n);
        if (!chosen) {
            hint.textContent = n + '人の学校は「' + PLANS[fit].label + '」のプランです。';
        } else if (chosen !== fit) {
            hint.textContent = n + '人の学校は「' + PLANS[fit].label + '」のプランになります。プランを選び直してください。';
            hint.classList.add('is-error');
        } else {
            hint.textContent = n + '人の学校に合ったプランです。';
        }
    }
    form.elements.students.addEventListener('input', function () {
        var n = parseInt(form.elements.students.value, 10);
        var chosen = form.querySelector('input[name="plan"]:checked');
        // まだプランを選んでいないときは、学生数に合うプランを自動で選ぶ
        if (n > 0 && !chosen) {
            var fit = form.querySelector('input[name="plan"][value="' + planForStudents(n) + '"]');
            if (fit) fit.checked = true;
        }
        updatePlanHint();
    });
    form.querySelectorAll('input[name="plan"]').forEach(function (r) { r.addEventListener('change', updatePlanHint); });

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var f = form.elements;
        var plan = (form.querySelector('input[name="plan"]:checked') || {}).value || '';
        var students = parseInt(f.students.value, 10);
        var zip = f.zip.value.trim().replace(/[ー－‐−]/g, '-');

        if (!plan) return setMsg('プランを選んでください。', true);
        if (!f.schoolName.value.trim()) return setMsg('学校名を入力してください。', true);
        if (!students || students < 1) return setMsg('在籍している学生の人数を入力してください。', true);
        if (planForStudents(students) !== plan) return setMsg('学生数と選んだプランが合っていません。プランを選び直してください。', true);
        if (!/^\d{3}-?\d{4}$/.test(zip)) return setMsg('郵便番号は「902-0062」のように7けたで入力してください。', true);
        if (!f.address.value.trim()) return setMsg('所在地を入力してください。', true);
        if (!f.name.value.trim()) return setMsg('ご担当者のお名前を入力してください。', true);
        if (!f.email.value || !f.email.checkValidity()) return setMsg('メールアドレスを確認してください。', true);
        if (!/^[0-9０-９\-－()（）+ ]{10,20}$/.test(f.tel.value.trim())) return setMsg('電話番号を確認してください。', true);
        if (!f.agree.checked) return setMsg('利用規約とプライバシーポリシーへの同意が必要です。', true);

        if (!apiReady()) {
            setMsg('現在、お申し込みの受付を準備中です。お急ぎの場合は、お問い合わせフォームからご連絡ください。');
            return;
        }

        var data = {
            action: 'apply', plan: plan, students: students, schoolName: f.schoolName.value.trim(), zip: zip,
            address: f.address.value.trim(), name: f.name.value.trim(), department: f.department.value.trim(),
            email: f.email.value.trim(), tel: f.tel.value.trim(), agree: f.agree.checked,
            website: f.website ? f.website.value : '' // ロボットよけ（画面には出していない欄）
        };
        var btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        setMsg('');
        var req = fetch(CONFIG.APPLY_API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(data) })
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
        (window.RLoading ? window.RLoading.wrap('お申し込みを送っています', req) : req).then(function (res) {
            if (!res || !res.ok) { setMsg((res && res.message) || 'お申し込みを送れませんでした。', true); return; }
            showDone(res);
        }).catch(function (err) {
            console.error(err);
            setMsg('通信に失敗しました。時間をおいてもう一度お試しいただくか、お問い合わせフォームからご連絡ください。', true);
        }).then(function () { btn.disabled = false; });
    });

    // 受け付けたら、お申し込みの画面を「受付完了」の表示にかえる
    function showDone(res) {
        var box = form.querySelector('.modal-box') || form;
        var head = form.querySelector('.modal-head');
        Array.prototype.forEach.call(form.children, function (c) { if (c !== head) c.hidden = true; });
        var done = document.createElement('div');
        done.className = 'apply-done';
        var p = function (cls, text) { var x = document.createElement('p'); if (cls) x.className = cls; x.textContent = text; return x; };
        done.append(
            p('apply-done-title', 'お申し込みを受け付けました'),
            res.applyNo ? p('apply-done-no', '申込番号：' + res.applyNo) : document.createTextNode(''),
            p('', (res.email || 'ご入力のメールアドレス') + ' に、受付メールと請求書（PDF）をお送りしました。'),
            p('', '支払期限' + (res.due ? '（' + res.due + '）' : '') + 'までに、請求書に書かれた口座へお振込みください。ご入金を確認したのち、学校コードと学校管理者のアカウントをお送りします。'),
            p('note-small', 'メールが届かないときは、迷惑メールのフォルダもご確認ください。それでも見つからないときは、お問い合わせフォームからご連絡ください。')
        );
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'pop-btn btn-white btn-block';
        close.setAttribute('data-close', '');
        close.textContent = '閉じる';
        done.append(close);
        form.append(done);
        box.scrollTop = 0;
    }
})();
