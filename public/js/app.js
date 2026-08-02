/* 작은따옴표 ERP — 메인 애플리케이션 */
"use strict";

const DEPTS = ["대표", "경영지원본부", "오프라인사업부", "온라인사업부"];
const EMP_TYPES = ["정직원(사대보험)", "3.3% 사업소득", "아티스트"];
const PAY_CATS = ["사대보험", "3.3%", "아티스트"];
const LEAVE_TYPES = ["연차", "반차", "병가", "경조", "기타"];
const SESSION_KEY = "quote_erp_session_v1";

let db = null;
let me = null; // { id, ...employee fields }
let currentView = "home";
let payrollYM = null; // "YYYY-MM"

/* ───────── 유틸 ───────── */
const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmt(n) {
  const v = Number(n);
  return isNaN(v) ? "-" : v.toLocaleString("ko-KR");
}
function fmtTs(ts) {
  if (!ts) return "-";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => t.classList.add("hidden"), 2600);
}
function openModal(html) {
  $("#modal").innerHTML = html;
  $("#modal-backdrop").classList.remove("hidden");
}
function closeModal() {
  $("#modal-backdrop").classList.add("hidden");
  $("#modal").innerHTML = "";
}
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function isAdmin() { return me && me.role === "admin"; }
function canViewAll() { return me && (me.role === "admin" || me.role === "executive"); }
function roleForDept(dept) {
  if (dept === "경영지원본부") return "admin";
  if (dept === "대표") return "executive";
  return "member";
}
function roleLabel(role) {
  return { admin: "총괄 관리자", executive: "임원 열람", member: "일반" }[role] || role;
}
async function audit(action, detail) {
  try {
    await db.collection(COL.auditLogs).add({
      ts: firebase.firestore.FieldValue.serverTimestamp(),
      actorId: me ? me.id : "-",
      actorName: me ? me.name : "(로그인 전)",
      action,
      detail: detail || ""
    });
  } catch (e) { console.warn("audit fail", e); }
}

/* ───────── 초기화 ───────── */
async function boot() {
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();
  try {
    await firebase.auth().signInAnonymously();
  } catch (e) {
    alert("Firebase 연결에 실패했습니다. js/firebase-config.js 의 설정값과 익명 로그인 활성화 여부를 확인하세요.\n" + e.message);
    return;
  }

  // 세션 복원
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    const snap = await db.collection(COL.employees).doc(saved).get();
    if (snap.exists && snap.data().status === "재직") {
      me = { id: snap.id, ...snap.data() };
      enterApp();
      return;
    }
    localStorage.removeItem(SESSION_KEY);
  }
  showLogin();
}

/* ───────── 로그인 화면 ───────── */
async function showLogin() {
  $("#app-shell").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");

  const deptSel = $("#login-dept");
  deptSel.innerHTML = '<option value="" disabled selected>부서 선택</option>' +
    DEPTS.map((d) => `<option value="${d}">${d}</option>`).join("");

  // 직원이 한 명도 없으면 초기 설정 노출
  const any = await db.collection(COL.employees).limit(1).get();
  $("#bootstrap-box").classList.toggle("hidden", !any.empty);

  deptSel.onchange = async () => {
    const nameSel = $("#login-name");
    nameSel.disabled = true;
    nameSel.innerHTML = '<option value="" disabled selected>불러오는 중...</option>';
    const qs = await db.collection(COL.employees)
      .where("dept", "==", deptSel.value)
      .where("status", "==", "재직").get();
    const emps = qs.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    if (!emps.length) {
      nameSel.innerHTML = '<option value="" disabled selected>이 부서에 등록된 직원이 없습니다</option>';
      return;
    }
    nameSel.innerHTML = '<option value="" disabled selected>이름 선택</option>' +
      emps.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");
    nameSel.disabled = false;
  };

  $("#login-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $("#login-error");
    err.classList.add("hidden");
    const empId = $("#login-name").value;
    const pw = $("#login-password").value;
    if (!empId) { err.textContent = "이름을 선택하세요."; err.classList.remove("hidden"); return; }

    const snap = await db.collection(COL.employees).doc(empId).get();
    if (!snap.exists) { err.textContent = "직원 정보를 찾을 수 없습니다."; err.classList.remove("hidden"); return; }
    const emp = { id: snap.id, ...snap.data() };

    if (!emp.passwordHash) {
      // 최초 로그인: 비밀번호 설정 안내
      openSetPasswordModal(emp, pw);
      return;
    }
    const hash = await sha256(emp.salt + pw);
    if (hash !== emp.passwordHash) {
      err.textContent = "비밀번호가 일치하지 않습니다.";
      err.classList.remove("hidden");
      return;
    }
    await loginSuccess(emp);
  };

  $("#bootstrap-open").onclick = openBootstrapModal;
}

function openSetPasswordModal(emp, typedPw) {
  openModal(`
    <h3>비밀번호 설정</h3>
    <div class="modal-alert">설정된 비밀번호가 없습니다. <b>${esc(emp.name)}</b>님이 앞으로 사용할 비밀번호를 설정해주세요.<br/>설정한 비밀번호는 저장되어 계속 사용됩니다.</div>
    <form id="setpw-form">
      <label class="field"><span class="field-label">새 비밀번호 (4자 이상)</span>
        <input type="password" id="setpw-1" value="${esc(typedPw || "")}" required minlength="4" /></label>
      <label class="field"><span class="field-label">비밀번호 확인</span>
        <input type="password" id="setpw-2" required minlength="4" /></label>
      <p id="setpw-err" class="form-error hidden"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="setpw-cancel">취소</button>
        <button type="submit" class="btn btn-primary">비밀번호 설정 후 로그인</button>
      </div>
    </form>`);
  $("#setpw-cancel").onclick = closeModal;
  $("#setpw-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const p1 = $("#setpw-1").value, p2 = $("#setpw-2").value;
    const err = $("#setpw-err");
    if (p1.length < 4) { err.textContent = "비밀번호는 4자 이상이어야 합니다."; err.classList.remove("hidden"); return; }
    if (p1 !== p2) { err.textContent = "비밀번호와 비밀번호 확인이 일치하지 않습니다. 정확하게 다시 입력해주세요."; err.classList.remove("hidden"); return; }
    const salt = randSalt();
    const passwordHash = await sha256(salt + p1);
    await db.collection(COL.employees).doc(emp.id).update({
      salt, passwordHash,
      passwordSetAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    closeModal();
    const emp2 = { ...emp, salt, passwordHash };
    me = { id: emp2.id, ...emp2 };
    await audit("비밀번호 설정", `${emp.name} 최초 비밀번호 설정`);
    await loginSuccess(emp2);
  };
}

async function loginSuccess(emp) {
  me = { id: emp.id, ...emp };
  localStorage.setItem(SESSION_KEY, emp.id);
  await db.collection(COL.employees).doc(emp.id).update({
    lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await audit("로그인", `${emp.name} (${emp.dept})`);
  $("#login-password").value = "";
  enterApp();
}

function openBootstrapModal() {
  openModal(`
    <h3>시스템 초기 설정</h3>
    <p class="modal-desc">경영지원본부 최초 관리자를 등록합니다. 이 계정은 자동으로 총괄 관리자 권한을 가지며, 이후 [직원 관리]에서 전 직원을 등록할 수 있습니다.</p>
    <form id="bs-form">
      <label class="field"><span class="field-label">이름</span><input id="bs-name" required /></label>
      <label class="field"><span class="field-label">직급 (선택)</span><input id="bs-pos" placeholder="예: 본부장" /></label>
      <label class="field"><span class="field-label">이메일 (선택)</span><input id="bs-email" type="email" /></label>
      <label class="field"><span class="field-label">비밀번호 (4자 이상)</span><input id="bs-pw1" type="password" required minlength="4" /></label>
      <label class="field"><span class="field-label">비밀번호 확인</span><input id="bs-pw2" type="password" required minlength="4" /></label>
      <p id="bs-err" class="form-error hidden"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="bs-cancel">취소</button>
        <button type="submit" class="btn btn-primary">관리자 등록</button>
      </div>
    </form>`);
  $("#bs-cancel").onclick = closeModal;
  $("#bs-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $("#bs-err");
    const p1 = $("#bs-pw1").value, p2 = $("#bs-pw2").value;
    if (p1 !== p2) { err.textContent = "비밀번호가 일치하지 않습니다."; err.classList.remove("hidden"); return; }
    const any = await db.collection(COL.employees).limit(1).get();
    if (!any.empty) { err.textContent = "이미 직원이 등록되어 있어 초기 설정을 사용할 수 없습니다."; err.classList.remove("hidden"); return; }
    const salt = randSalt();
    const passwordHash = await sha256(salt + p1);
    const ref = await db.collection(COL.employees).add({
      name: $("#bs-name").value.trim(),
      dept: "경영지원본부",
      position: $("#bs-pos").value.trim(),
      email: $("#bs-email").value.trim(),
      joinDate: new Date().toISOString().slice(0, 10),
      empType: EMP_TYPES[0],
      status: "재직",
      role: "admin",
      salt, passwordHash,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      passwordSetAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const snap = await ref.get();
    closeModal();
    me = { id: ref.id, ...snap.data() };
    await audit("직원 등록", `초기 설정: 관리자 ${me.name} 등록`);
    await loginSuccess(me);
  };
}

/* ───────── 앱 셸 ───────── */
function enterApp() {
  $("#login-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  renderSidebar();
  navigate("home");

  $("#logout-btn").onclick = async () => {
    await audit("로그아웃", me.name);
    localStorage.removeItem(SESSION_KEY);
    me = null;
    location.reload();
  };
  $("#sidebar-toggle").onclick = () => $("#sidebar").classList.toggle("open");
}

function renderSidebar() {
  $("#user-card").innerHTML = `
    <div class="u-name">${esc(me.name)}</div>
    <span class="u-role">${roleLabel(me.role)}</span>
    <div class="u-meta">
      <span><b>부서</b> ${esc(me.dept)}</span>
      ${me.position ? `<span><b>직급</b> ${esc(me.position)}</span>` : ""}
      ${me.email ? `<span><b>메일</b> ${esc(me.email)}</span>` : ""}
      ${me.joinDate ? `<span><b>입사</b> ${esc(me.joinDate)}</span>` : ""}
      <span><b>구분</b> ${esc(me.empType || "-")}</span>
    </div>`;

  const items = [
    { id: "home", ico: "⌂", label: "홈" },
    { id: "payroll", ico: "₩", label: "급여대장" },
    { id: "leave", ico: "☀", label: "연차/휴가 관리" },
    { id: "settings", ico: "⚙", label: "설정" }
  ];
  let html = items.map((i) =>
    `<button class="nav-item" data-view="${i.id}"><span class="ico">${i.ico}</span>${i.label}</button>`).join("");
  if (isAdmin()) {
    html += `<div class="nav-label">관리자 (경영지원본부)</div>` + [
      { id: "employees", ico: "☰", label: "직원 관리" },
      { id: "monitor", ico: "◉", label: "권한 모니터링" }
    ].map((i) => `<button class="nav-item" data-view="${i.id}"><span class="ico">${i.ico}</span>${i.label}</button>`).join("");
  }
  const nav = $("#nav");
  nav.innerHTML = html;
  nav.querySelectorAll(".nav-item").forEach((b) => {
    b.onclick = () => { navigate(b.dataset.view); $("#sidebar").classList.remove("open"); };
  });
}

function navigate(view) {
  currentView = view;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  const render = {
    home: renderHome,
    payroll: renderPayroll,
    leave: renderLeave,
    settings: renderSettings,
    employees: renderEmployees,
    monitor: renderMonitor
  }[view];
  if (render) render();
}

function pageHead(eyebrow, title, desc, actionsHtml) {
  return `<div class="page-head">
    <div class="page-eyebrow">${eyebrow}</div>
    <h2 class="page-title">${title}</h2>
    ${desc ? `<p class="page-desc">${desc}</p>` : ""}
    ${actionsHtml ? `<div class="page-actions">${actionsHtml}</div>` : ""}
  </div>`;
}

/* ───────── 홈 ───────── */
async function renderHome() {
  const main = $("#main");
  main.innerHTML = pageHead("HOME", "홈",
    "자주 쓰는 사내 툴로 바로 이동하세요. 공용 바로가기 URL은 경영지원본부가 관리합니다.");

  const [pubSnap, myBtnSnap] = await Promise.all([
    db.collection(COL.homeButtons).get(),
    db.collection(COL.personalButtons).doc(me.id).get()
  ]);
  const pubBtns = pubSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const myBtns = myBtnSnap.exists ? (myBtnSnap.data().items || []) : [];

  const shortcut = (b, editHtml) => `
    <a class="shortcut" href="${esc(b.url)}" target="_blank" rel="noopener">
      ${editHtml || ""}
      <div class="sc-label">${esc(b.label)}</div>
      <div class="sc-desc">${esc(b.desc || b.url)}</div>
    </a>`;

  main.innerHTML += `
    <div class="card">
      <div class="card-title">공용 바로가기
        ${isAdmin() ? `<button class="btn btn-ghost btn-sm" id="pub-add">+ 버튼 추가</button>` : ""}
      </div>
      ${pubBtns.length
        ? `<div class="shortcut-grid">${pubBtns.map((b) => shortcut(b, isAdmin()
            ? `<span class="sc-edit"><button data-edit="${b.id}">수정</button><button data-del="${b.id}">삭제</button></span>` : "")).join("")}</div>`
        : `<div class="empty">등록된 공용 버튼이 없습니다.${isAdmin() ? " [+ 버튼 추가]로 사내 툴 URL을 등록하세요." : " 경영지원본부에 등록을 요청하세요."}</div>`}
    </div>
    <div class="card">
      <div class="card-title">내 바로가기 <button class="btn btn-ghost btn-sm" id="my-add">+ 버튼 추가</button></div>
      ${myBtns.length
        ? `<div class="shortcut-grid">${myBtns.map((b, i) => shortcut(b,
            `<span class="sc-edit"><button data-myedit="${i}">수정</button><button data-mydel="${i}">삭제</button></span>`)).join("")}</div>`
        : `<div class="empty">나만 쓰는 버튼을 자유롭게 추가할 수 있습니다.</div>`}
    </div>`;

  // 공용 버튼 (admin)
  if (isAdmin()) {
    $("#pub-add").onclick = () => openButtonModal(null, pubBtns.length);
    main.querySelectorAll("[data-edit]").forEach((b) => {
      b.onclick = (e) => { e.preventDefault(); openButtonModal(pubBtns.find((x) => x.id === b.dataset.edit)); };
    });
    main.querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = async (e) => {
        e.preventDefault();
        const btn = pubBtns.find((x) => x.id === b.dataset.del);
        if (!confirm(`공용 버튼 "${btn.label}"을(를) 삭제할까요?`)) return;
        await db.collection(COL.homeButtons).doc(btn.id).delete();
        await audit("공용 버튼 삭제", btn.label);
        renderHome();
      };
    });
  }

  // 개인 버튼
  $("#my-add").onclick = () => openMyButtonModal(myBtns, null);
  main.querySelectorAll("[data-myedit]").forEach((b) => {
    b.onclick = (e) => { e.preventDefault(); openMyButtonModal(myBtns, Number(b.dataset.myedit)); };
  });
  main.querySelectorAll("[data-mydel]").forEach((b) => {
    b.onclick = async (e) => {
      e.preventDefault();
      const idx = Number(b.dataset.mydel);
      if (!confirm(`내 버튼 "${myBtns[idx].label}"을(를) 삭제할까요?`)) return;
      myBtns.splice(idx, 1);
      await db.collection(COL.personalButtons).doc(me.id).set({ items: myBtns });
      renderHome();
    };
  });
}

function openButtonModal(btn, nextOrder) {
  openModal(`
    <h3>${btn ? "공용 버튼 수정" : "공용 버튼 추가"}</h3>
    <p class="modal-desc">공용 바로가기의 URL은 경영지원본부(관리자)만 편집할 수 있습니다.</p>
    <form id="btn-form">
      <label class="field"><span class="field-label">버튼 이름</span><input id="bf-label" required value="${esc(btn?.label || "")}" /></label>
      <label class="field"><span class="field-label">URL</span><input id="bf-url" type="url" required placeholder="https://..." value="${esc(btn?.url || "")}" /></label>
      <label class="field"><span class="field-label">설명 (선택)</span><input id="bf-desc" value="${esc(btn?.desc || "")}" /></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="bf-cancel">취소</button>
        <button type="submit" class="btn btn-primary">저장</button>
      </div>
    </form>`);
  $("#bf-cancel").onclick = closeModal;
  $("#btn-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = {
      label: $("#bf-label").value.trim(),
      url: $("#bf-url").value.trim(),
      desc: $("#bf-desc").value.trim()
    };
    if (btn) {
      await db.collection(COL.homeButtons).doc(btn.id).update(data);
      await audit("공용 버튼 수정", `${data.label} → ${data.url}`);
    } else {
      await db.collection(COL.homeButtons).add({ ...data, order: nextOrder || 0 });
      await audit("공용 버튼 추가", `${data.label} → ${data.url}`);
    }
    closeModal();
    renderHome();
  };
}

function openMyButtonModal(items, idx) {
  const btn = idx != null ? items[idx] : null;
  openModal(`
    <h3>${btn ? "내 버튼 수정" : "내 버튼 추가"}</h3>
    <form id="mybtn-form">
      <label class="field"><span class="field-label">버튼 이름</span><input id="mb-label" required value="${esc(btn?.label || "")}" /></label>
      <label class="field"><span class="field-label">URL</span><input id="mb-url" type="url" required placeholder="https://..." value="${esc(btn?.url || "")}" /></label>
      <label class="field"><span class="field-label">설명 (선택)</span><input id="mb-desc" value="${esc(btn?.desc || "")}" /></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="mb-cancel">취소</button>
        <button type="submit" class="btn btn-primary">저장</button>
      </div>
    </form>`);
  $("#mb-cancel").onclick = closeModal;
  $("#mybtn-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = { label: $("#mb-label").value.trim(), url: $("#mb-url").value.trim(), desc: $("#mb-desc").value.trim() };
    if (btn) items[idx] = data; else items.push(data);
    await db.collection(COL.personalButtons).doc(me.id).set({ items });
    closeModal();
    renderHome();
  };
}

/* ───────── 급여대장 ───────── */
function ymNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
async function renderPayroll() {
  if (!payrollYM) payrollYM = ymNow();
  const [year, month] = payrollYM.split("-").map(Number);
  const main = $("#main");

  const years = [year - 1, year, year + 1];
  const tabs = `
    <div class="month-tabs">
      <select id="pay-year">${years.map((y) => `<option value="${y}" ${y === year ? "selected" : ""}>${y}년</option>`).join("")}</select>
      ${Array.from({ length: 12 }, (_, i) => i + 1).map((m) =>
        `<button class="month-tab ${m === month ? "active" : ""}" data-m="${m}">${m}월</button>`).join("")}
    </div>`;

  main.innerHTML = pageHead("PAYROLL", "급여대장",
    canViewAll() ? "월별 급여 현황입니다. 탭으로 월을 이동하세요." : "본인 급여 내역만 표시됩니다.",
    isAdmin() ? `<button class="btn btn-primary btn-sm" id="pay-add">+ 급여 행 추가</button>` : "") + tabs + `<div id="pay-body"></div>`;

  $("#pay-year").onchange = () => { payrollYM = `${$("#pay-year").value}-${String(month).padStart(2, "0")}`; renderPayroll(); };
  main.querySelectorAll(".month-tab").forEach((b) => {
    b.onclick = () => { payrollYM = `${year}-${String(b.dataset.m).padStart(2, "0")}`; renderPayroll(); };
  });
  if (isAdmin()) $("#pay-add").onclick = () => openPayrollModal(null);

  const rowsSnap = await db.collection(COL.payroll).doc(payrollYM).collection("rows").get();
  let rows = rowsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!canViewAll()) rows = rows.filter((r) => r.empId === me.id || r.name === me.name);
  rows.sort((a, b) => PAY_CATS.indexOf(a.category) - PAY_CATS.indexOf(b.category) || a.name.localeCompare(b.name, "ko"));

  const total = rows.reduce((s, r) => s + (Number(r.gross) || 0) + (Number(r.meal) || 0) + (Number(r.extra) || 0), 0);
  const catCount = (c) => rows.filter((r) => r.category === c).length;
  const chip = (c) => `<span class="cat-chip ${c === "3.3%" ? "c33" : c === "사대보험" ? "c4" : "cart"}">${c}</span>`;

  $("#pay-body").innerHTML = `
    <div class="stat-row">
      <div class="stat accent"><div class="s-label">${month}월 총 인건비${canViewAll() ? "" : " (본인)"}</div><div class="s-value">${fmt(total)}원</div></div>
      <div class="stat"><div class="s-label">인원</div><div class="s-value">${rows.length}명</div></div>
      <div class="stat"><div class="s-label">사대보험 / 3.3% / 아티스트</div><div class="s-value">${catCount("사대보험")} / ${catCount("3.3%")} / ${catCount("아티스트")}</div></div>
    </div>
    <div class="card"><div class="table-wrap">
      ${rows.length ? `<table class="data">
        <thead><tr>
          <th>구분</th><th>이름</th><th class="num">세전금액</th><th class="num">식대</th><th class="num">추가 수당</th><th class="num">세후금액</th><th>비고</th>${isAdmin() ? "<th></th>" : ""}
        </tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${chip(r.category)}</td>
          <td><b>${esc(r.name)}</b></td>
          <td class="num">${fmt(r.gross)}</td>
          <td class="num">${r.meal ? fmt(r.meal) : "-"}</td>
          <td class="num">${r.extra ? fmt(r.extra) : "-"}</td>
          <td class="num">${r.net ? fmt(r.net) : "-"}</td>
          <td>${esc(r.note || "")}</td>
          ${isAdmin() ? `<td><button class="btn btn-ghost btn-sm" data-payedit="${r.id}">수정</button>
            <button class="btn btn-danger btn-sm" data-paydel="${r.id}">삭제</button></td>` : ""}
        </tr>`).join("")}</tbody>
      </table>` : `<div class="empty">${year}년 ${month}월 급여 데이터가 없습니다.${isAdmin() ? " [+ 급여 행 추가]로 입력하세요." : ""}</div>`}
    </div></div>`;

  if (isAdmin()) {
    $("#pay-body").querySelectorAll("[data-payedit]").forEach((b) => {
      b.onclick = () => openPayrollModal(rows.find((r) => r.id === b.dataset.payedit));
    });
    $("#pay-body").querySelectorAll("[data-paydel]").forEach((b) => {
      b.onclick = async () => {
        const r = rows.find((x) => x.id === b.dataset.paydel);
        if (!confirm(`${r.name}의 ${payrollYM} 급여 행을 삭제할까요?`)) return;
        await db.collection(COL.payroll).doc(payrollYM).collection("rows").doc(r.id).delete();
        await audit("급여 삭제", `${payrollYM} ${r.name}`);
        renderPayroll();
      };
    });
  }
}

async function openPayrollModal(row) {
  const empSnap = await db.collection(COL.employees).where("status", "==", "재직").get();
  const emps = empSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  openModal(`
    <h3>${row ? "급여 행 수정" : "급여 행 추가"} <small style="font-weight:400;font-size:.8rem;color:var(--ink-soft)">(${payrollYM})</small></h3>
    <form id="pay-form">
      <div class="grid-2">
        <label class="field"><span class="field-label">구분</span>
          <select id="pf-cat">${PAY_CATS.map((c) => `<option ${row?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <label class="field"><span class="field-label">직원 연결 (선택)</span>
          <select id="pf-emp"><option value="">직접 입력</option>
            ${emps.map((e) => `<option value="${e.id}" ${row?.empId === e.id ? "selected" : ""}>${esc(e.name)} (${esc(e.dept)})</option>`).join("")}
          </select></label>
      </div>
      <label class="field"><span class="field-label">이름</span><input id="pf-name" required value="${esc(row?.name || "")}" /></label>
      <div class="grid-2">
        <label class="field"><span class="field-label">세전금액</span><input id="pf-gross" type="number" min="0" required value="${row?.gross ?? ""}" /></label>
        <label class="field"><span class="field-label">식대</span><input id="pf-meal" type="number" min="0" value="${row?.meal ?? ""}" /></label>
        <label class="field"><span class="field-label">추가 수당</span><input id="pf-extra" type="number" min="0" value="${row?.extra ?? ""}" /></label>
        <label class="field"><span class="field-label">세후금액</span><input id="pf-net" type="number" min="0" value="${row?.net ?? ""}" /></label>
      </div>
      <label class="field"><span class="field-label">비고</span><input id="pf-note" value="${esc(row?.note || "")}" /></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="pf-cancel">취소</button>
        <button type="submit" class="btn btn-primary">저장</button>
      </div>
    </form>`);
  $("#pf-cancel").onclick = closeModal;
  $("#pf-emp").onchange = () => {
    const e = emps.find((x) => x.id === $("#pf-emp").value);
    if (e) $("#pf-name").value = e.name;
  };
  $("#pay-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = {
      category: $("#pf-cat").value,
      empId: $("#pf-emp").value || null,
      name: $("#pf-name").value.trim(),
      gross: Number($("#pf-gross").value) || 0,
      meal: Number($("#pf-meal").value) || 0,
      extra: Number($("#pf-extra").value) || 0,
      net: Number($("#pf-net").value) || 0,
      note: $("#pf-note").value.trim()
    };
    const col = db.collection(COL.payroll).doc(payrollYM).collection("rows");
    if (row) { await col.doc(row.id).update(data); await audit("급여 수정", `${payrollYM} ${data.name}`); }
    else { await col.add(data); await audit("급여 추가", `${payrollYM} ${data.name}`); }
    closeModal();
    renderPayroll();
  };
}

/* ───────── 연차/휴가 ───────── */
async function renderLeave() {
  const main = $("#main");
  main.innerHTML = pageHead("LEAVE", "연차/휴가 관리",
    canViewAll() ? "전 직원의 연차 할당·사용·잔여 현황입니다." : "내 연차 현황입니다.",
    isAdmin() ? `<button class="btn btn-primary btn-sm" id="lv-use">+ 사용 기록 추가</button>
                 <button class="btn btn-ghost btn-sm" id="lv-alloc">할당 일수 설정</button>` : "") +
    `<div id="lv-body">불러오는 중...</div>`;

  const mySnap = await db.collection(COL.leaves).doc(me.id).get();
  const mine = mySnap.exists ? mySnap.data() : { allocated: 0, records: [] };
  const myUsed = (mine.records || []).reduce((s, r) => s + Number(r.days || 0), 0);

  let allHtml = "";
  if (canViewAll()) {
    const [empSnap, lvSnap] = await Promise.all([
      db.collection(COL.employees).where("status", "==", "재직").get(),
      db.collection(COL.leaves).get()
    ]);
    const lvMap = {};
    lvSnap.docs.forEach((d) => (lvMap[d.id] = d.data()));
    const emps = empSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) =>
      DEPTS.indexOf(a.dept) - DEPTS.indexOf(b.dept) || a.name.localeCompare(b.name, "ko"));
    allHtml = `<div class="card"><div class="card-title">전 직원 연차 현황</div><div class="table-wrap">
      <table class="data"><thead><tr>
        <th>이름</th><th>부서</th><th class="num">할당</th><th class="num">사용</th><th class="num">잔여</th><th>사용률</th>
      </tr></thead><tbody>
      ${emps.map((e) => {
        const lv = lvMap[e.id] || { allocated: 0, records: [] };
        const used = (lv.records || []).reduce((s, r) => s + Number(r.days || 0), 0);
        const remain = (Number(lv.allocated) || 0) - used;
        const pct = lv.allocated ? Math.min(100, (used / lv.allocated) * 100) : 0;
        return `<tr>
          <td><b>${esc(e.name)}</b></td><td>${esc(e.dept)}</td>
          <td class="num">${lv.allocated || 0}일</td><td class="num">${used}일</td>
          <td class="num"><b>${remain}일</b></td>
          <td><div class="bar ${remain < 0 ? "over" : ""}"><i style="width:${pct}%"></i></div></td>
        </tr>`;
      }).join("")}</tbody></table></div></div>`;
  }

  $("#lv-body").innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="s-label">할당 연차</div><div class="s-value">${mine.allocated || 0}일</div></div>
      <div class="stat"><div class="s-label">사용</div><div class="s-value">${myUsed}일</div></div>
      <div class="stat accent"><div class="s-label">잔여</div><div class="s-value">${(Number(mine.allocated) || 0) - myUsed}일</div></div>
    </div>
    <div class="card"><div class="card-title">내 사용 내역</div>
      ${(mine.records || []).length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>날짜</th><th>유형</th><th class="num">일수</th><th>메모</th></tr></thead>
        <tbody>${mine.records.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((r) =>
          `<tr><td>${esc(r.date)}</td><td>${esc(r.type)}</td><td class="num">${r.days}</td><td>${esc(r.note || "")}</td></tr>`).join("")}
        </tbody></table></div>`
        : `<div class="empty">사용 내역이 없습니다.</div>`}
    </div>
    ${allHtml}`;

  if (isAdmin()) {
    $("#lv-use").onclick = openLeaveUseModal;
    $("#lv-alloc").onclick = openLeaveAllocModal;
  }
}

async function loadActiveEmployees() {
  const snap = await db.collection(COL.employees).where("status", "==", "재직").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

async function openLeaveUseModal() {
  const emps = await loadActiveEmployees();
  openModal(`
    <h3>연차 사용 기록 추가</h3>
    <form id="lvu-form">
      <label class="field"><span class="field-label">직원</span>
        <select id="lu-emp" required>${emps.map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.dept)})</option>`).join("")}</select></label>
      <div class="grid-2">
        <label class="field"><span class="field-label">날짜</span><input id="lu-date" type="date" required value="${new Date().toISOString().slice(0, 10)}" /></label>
        <label class="field"><span class="field-label">일수 (0.5 단위)</span><input id="lu-days" type="number" step="0.5" min="0.5" required value="1" /></label>
      </div>
      <label class="field"><span class="field-label">유형</span>
        <select id="lu-type">${LEAVE_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></label>
      <label class="field"><span class="field-label">메모 (선택)</span><input id="lu-note" /></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="lu-cancel">취소</button>
        <button type="submit" class="btn btn-primary">기록 추가</button>
      </div>
    </form>`);
  $("#lu-cancel").onclick = closeModal;
  $("#lvu-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const empId = $("#lu-emp").value;
    const emp = emps.find((e) => e.id === empId);
    const rec = {
      date: $("#lu-date").value,
      days: Number($("#lu-days").value),
      type: $("#lu-type").value,
      note: $("#lu-note").value.trim()
    };
    const ref = db.collection(COL.leaves).doc(empId);
    const snap = await ref.get();
    const cur = snap.exists ? snap.data() : { allocated: 0, records: [] };
    cur.records = cur.records || [];
    cur.records.push(rec);
    await ref.set(cur);
    await audit("연차 사용 기록", `${emp.name} ${rec.date} ${rec.days}일 (${rec.type})`);
    closeModal();
    renderLeave();
  };
}

async function openLeaveAllocModal() {
  const emps = await loadActiveEmployees();
  const lvSnap = await db.collection(COL.leaves).get();
  const lvMap = {};
  lvSnap.docs.forEach((d) => (lvMap[d.id] = d.data()));
  openModal(`
    <h3>할당 연차 설정</h3>
    <p class="modal-desc">직원별 연간 할당 연차 일수를 설정합니다.</p>
    <form id="lva-form">
      <label class="field"><span class="field-label">직원</span>
        <select id="la-emp" required>${emps.map((e) =>
          `<option value="${e.id}">${esc(e.name)} (${esc(e.dept)}) — 현재 ${lvMap[e.id]?.allocated || 0}일</option>`).join("")}</select></label>
      <label class="field"><span class="field-label">할당 일수</span><input id="la-days" type="number" step="0.5" min="0" required /></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="la-cancel">취소</button>
        <button type="submit" class="btn btn-primary">저장</button>
      </div>
    </form>`);
  $("#la-cancel").onclick = closeModal;
  $("#lva-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const empId = $("#la-emp").value;
    const emp = emps.find((e) => e.id === empId);
    const days = Number($("#la-days").value);
    const ref = db.collection(COL.leaves).doc(empId);
    const snap = await ref.get();
    const cur = snap.exists ? snap.data() : { records: [] };
    await ref.set({ ...cur, allocated: days });
    await audit("연차 할당 설정", `${emp.name} → ${days}일`);
    closeModal();
    renderLeave();
  };
}

/* ───────── 설정 ───────── */
async function renderSettings() {
  const main = $("#main");
  const snap = await db.collection(COL.settings).doc(me.id).get();
  const s = snap.exists ? snap.data() : { emailNotif: false };

  main.innerHTML = pageHead("SETTINGS", "설정", "알람 설정을 관리합니다.") + `
    <div class="card">
      <div class="card-title">알람 설정</div>
      <div class="toggle-row">
        <div class="toggle-info">
          <b>이메일 알람 수신</b>
          <p>급여·연차·공지 등 각종 업데이트 내용을 이메일로 받습니다.${me.email ? ` (수신 주소: ${esc(me.email)})` : " — 이메일이 등록되어 있지 않습니다. 경영지원본부에 등록을 요청하세요."}</p>
        </div>
        <label class="switch">
          <input type="checkbox" id="set-email" ${s.emailNotif ? "checked" : ""} />
          <span class="knob"></span>
        </label>
      </div>
    </div>`;

  $("#set-email").onchange = async (ev) => {
    await db.collection(COL.settings).doc(me.id).set({ emailNotif: ev.target.checked }, { merge: true });
    toast(ev.target.checked ? "이메일 알람을 켰습니다." : "이메일 알람을 껐습니다.");
  };
}

/* ───────── 직원 관리 (admin) ───────── */
async function renderEmployees() {
  if (!isAdmin()) return navigate("home");
  const main = $("#main");
  main.innerHTML = pageHead("ADMIN", "직원 관리",
    "직원 등록·수정, 부서 배정, 권한(역할) 조정, 비밀번호 초기화를 할 수 있습니다.",
    `<button class="btn btn-primary btn-sm" id="emp-add">+ 직원 등록</button>`) + `<div id="emp-body">불러오는 중...</div>`;
  $("#emp-add").onclick = () => openEmployeeModal(null);

  const snap = await db.collection(COL.employees).get();
  const emps = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) =>
    DEPTS.indexOf(a.dept) - DEPTS.indexOf(b.dept) || a.name.localeCompare(b.name, "ko"));

  $("#emp-body").innerHTML = `<div class="card"><div class="table-wrap">
    ${emps.length ? `<table class="data"><thead><tr>
      <th>이름</th><th>부서</th><th>직급</th><th>이메일</th><th>입사일</th><th>고용 구분</th><th>역할</th><th>비밀번호</th><th>상태</th><th></th>
    </tr></thead><tbody>
    ${emps.map((e) => `<tr>
      <td><b>${esc(e.name)}</b></td><td>${esc(e.dept)}</td><td>${esc(e.position || "-")}</td>
      <td>${esc(e.email || "-")}</td><td>${esc(e.joinDate || "-")}</td><td>${esc(e.empType || "-")}</td>
      <td><span class="badge ${e.role}">${roleLabel(e.role)}</span></td>
      <td>${e.passwordHash ? '<span class="badge ok">설정됨</span>' : '<span class="badge warn">미설정</span>'}</td>
      <td>${e.status === "재직" ? '<span class="badge ok">재직</span>' : '<span class="badge off">퇴사</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-empedit="${e.id}">수정</button>
        ${e.passwordHash ? `<button class="btn btn-danger btn-sm" data-pwreset="${e.id}">비번 초기화</button>` : ""}
      </td>
    </tr>`).join("")}</tbody></table>` : `<div class="empty">등록된 직원이 없습니다.</div>`}
  </div></div>`;

  $("#emp-body").querySelectorAll("[data-empedit]").forEach((b) => {
    b.onclick = () => openEmployeeModal(emps.find((e) => e.id === b.dataset.empedit));
  });
  $("#emp-body").querySelectorAll("[data-pwreset]").forEach((b) => {
    b.onclick = async () => {
      const e = emps.find((x) => x.id === b.dataset.pwreset);
      if (!confirm(`${e.name}의 비밀번호를 초기화할까요?\n해당 직원은 다음 로그인 때 비밀번호를 새로 설정합니다.`)) return;
      await db.collection(COL.employees).doc(e.id).update({
        salt: firebase.firestore.FieldValue.delete(),
        passwordHash: firebase.firestore.FieldValue.delete(),
        passwordSetAt: firebase.firestore.FieldValue.delete()
      });
      await audit("비밀번호 초기화", e.name);
      toast(`${e.name}의 비밀번호를 초기화했습니다.`);
      renderEmployees();
    };
  });
}

function openEmployeeModal(emp) {
  openModal(`
    <h3>${emp ? "직원 정보 수정" : "직원 등록"}</h3>
    <p class="modal-desc">부서를 선택하면 역할이 자동 제안됩니다. (경영지원본부 → 총괄 관리자)</p>
    <form id="emp-form">
      <div class="grid-2">
        <label class="field"><span class="field-label">이름</span><input id="ef-name" required value="${esc(emp?.name || "")}" /></label>
        <label class="field"><span class="field-label">부서</span>
          <select id="ef-dept">${DEPTS.map((d) => `<option ${emp?.dept === d ? "selected" : ""}>${d}</option>`).join("")}</select></label>
        <label class="field"><span class="field-label">직급</span><input id="ef-pos" value="${esc(emp?.position || "")}" /></label>
        <label class="field"><span class="field-label">입사일</span><input id="ef-join" type="date" value="${esc(emp?.joinDate || "")}" /></label>
      </div>
      <label class="field"><span class="field-label">이메일</span><input id="ef-email" type="email" value="${esc(emp?.email || "")}" /></label>
      <div class="grid-2">
        <label class="field"><span class="field-label">고용 구분</span>
          <select id="ef-type">${EMP_TYPES.map((t) => `<option ${emp?.empType === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="field"><span class="field-label">역할 (권한)</span>
          <select id="ef-role">
            <option value="member" ${emp?.role === "member" ? "selected" : ""}>일반</option>
            <option value="executive" ${emp?.role === "executive" ? "selected" : ""}>임원 열람</option>
            <option value="admin" ${emp?.role === "admin" ? "selected" : ""}>총괄 관리자</option>
          </select></label>
      </div>
      <label class="field"><span class="field-label">재직 상태</span>
        <select id="ef-status">
          <option ${(!emp || emp.status === "재직") ? "selected" : ""}>재직</option>
          <option ${emp?.status === "퇴사" ? "selected" : ""}>퇴사</option>
        </select></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="ef-cancel">취소</button>
        <button type="submit" class="btn btn-primary">저장</button>
      </div>
    </form>`);
  $("#ef-cancel").onclick = closeModal;
  $("#ef-dept").onchange = () => { $("#ef-role").value = roleForDept($("#ef-dept").value); };
  if (!emp) $("#ef-role").value = roleForDept($("#ef-dept").value);

  $("#emp-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = {
      name: $("#ef-name").value.trim(),
      dept: $("#ef-dept").value,
      position: $("#ef-pos").value.trim(),
      joinDate: $("#ef-join").value,
      email: $("#ef-email").value.trim(),
      empType: $("#ef-type").value,
      role: $("#ef-role").value,
      status: $("#ef-status").value
    };
    if (emp) {
      const roleChanged = emp.role !== data.role;
      await db.collection(COL.employees).doc(emp.id).update(data);
      await audit("직원 수정", `${data.name} (${data.dept}${roleChanged ? `, 역할 ${roleLabel(emp.role)} → ${roleLabel(data.role)}` : ""})`);
      if (emp.id === me.id) { me = { ...me, ...data }; renderSidebar(); }
    } else {
      await db.collection(COL.employees).add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await audit("직원 등록", `${data.name} (${data.dept}, ${roleLabel(data.role)})`);
    }
    closeModal();
    renderEmployees();
  };
}

/* ───────── 권한 모니터링 (admin) ───────── */
async function renderMonitor() {
  if (!isAdmin()) return navigate("home");
  const main = $("#main");
  main.innerHTML = pageHead("ADMIN", "권한 모니터링",
    "직원별 권한 부여 현황과 시스템 활동 로그를 총괄 확인합니다.") + `<div id="mon-body">불러오는 중...</div>`;

  const [empSnap, logSnap] = await Promise.all([
    db.collection(COL.employees).get(),
    db.collection(COL.auditLogs).orderBy("ts", "desc").limit(150).get()
  ]);
  const emps = empSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) =>
    DEPTS.indexOf(a.dept) - DEPTS.indexOf(b.dept) || a.name.localeCompare(b.name, "ko"));
  const logs = logSnap.docs.map((d) => d.data());
  const actions = [...new Set(logs.map((l) => l.action))];

  const admins = emps.filter((e) => e.role === "admin" && e.status === "재직").length;
  const noPw = emps.filter((e) => !e.passwordHash && e.status === "재직").length;

  $("#mon-body").innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="s-label">재직 직원</div><div class="s-value">${emps.filter((e) => e.status === "재직").length}명</div></div>
      <div class="stat accent"><div class="s-label">총괄 관리자</div><div class="s-value">${admins}명</div></div>
      <div class="stat"><div class="s-label">비밀번호 미설정</div><div class="s-value">${noPw}명</div></div>
    </div>
    <div class="card"><div class="card-title">권한 부여 현황</div><div class="table-wrap">
      <table class="data"><thead><tr>
        <th>이름</th><th>부서</th><th>역할</th><th>비밀번호</th><th>최근 로그인</th><th>상태</th>
      </tr></thead><tbody>
      ${emps.map((e) => `<tr>
        <td><b>${esc(e.name)}</b></td><td>${esc(e.dept)}</td>
        <td><span class="badge ${e.role}">${roleLabel(e.role)}</span></td>
        <td>${e.passwordHash ? '<span class="badge ok">설정됨</span>' : '<span class="badge warn">미설정</span>'}</td>
        <td>${fmtTs(e.lastLoginAt)}</td>
        <td>${e.status === "재직" ? '<span class="badge ok">재직</span>' : '<span class="badge off">퇴사</span>'}</td>
      </tr>`).join("")}</tbody></table>
    </div></div>
    <div class="card">
      <div class="card-title">활동 로그 <select id="log-filter" style="font-size:.8rem;padding:5px 8px;border:1.5px solid var(--line);border-radius:8px">
        <option value="">전체</option>${actions.map((a) => `<option>${esc(a)}</option>`).join("")}
      </select></div>
      <div id="log-list"></div>
    </div>`;

  const renderLogs = (filter) => {
    const list = logs.filter((l) => !filter || l.action === filter);
    $("#log-list").innerHTML = list.length ? list.map((l) => `
      <div class="log-item">
        <span class="l-ts">${fmtTs(l.ts)}</span>
        <span class="l-actor">${esc(l.actorName)}</span>
        <span class="badge">${esc(l.action)}</span>
        <span>${esc(l.detail || "")}</span>
      </div>`).join("") : `<div class="empty">기록이 없습니다.</div>`;
  };
  renderLogs("");
  $("#log-filter").onchange = (ev) => renderLogs(ev.target.value);
}

/* ───────── 시작 ───────── */
$("#modal-backdrop").addEventListener("click", (ev) => {
  if (ev.target === $("#modal-backdrop")) closeModal();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeModal();
});
boot();
