/* 작은따옴표 ERP — 메인 애플리케이션 */
"use strict";

const DEPTS = ["대표", "경영지원본부", "오프라인사업부", "온라인사업부"];
const EMP_TYPES = ["정직원(4대보험)", "3.3% 사업소득"];
const GRADES = ["L0 (파트타이머)", "L1", "L2", "L3", "L4", "L5 (대표)"];
const PAY_CATS = ["4대보험", "3.3%"];
const LEAVE_TYPES = ["연차", "반차", "병가", "경조", "기타"];
const SESSION_KEY = "quote_erp_session_v1";

/* ── 결재 체계 ──────────────────────────────────────────────────────
   결재자·가산 제외자는 직원 문서의 필드로 관리하고, 결재 라우팅은 직원 ID로 한다.
   (이름은 동명이인·개명·퇴사에 취약해 표시용으로만 쓴다)

   결재자 배정은 특정 인물이 아니라 '권한'으로 자동 결정한다.
     일반 직원  → 매니저 + 특수관리자 중 선택
     매니저     → 특수관리자 중 선택
     그 이상(특수·임원·총괄) → 최종 결재자(approverTier 3) 중 선택
   (총괄 관리자·임원열람은 일반·매니저의 결재자로 뜨지 않는다)
   최종 결재자 본인처럼 상위 결재자가 자기 자신뿐이면 셀프 승인을 허용한다.

   결재 등급(approverTier)은 이제 최종 결재자(3) 지정에만 쓰인다. 1·2는 과거 설정값. */
const APPROVER_TIERS = [
  { v: 0, label: "해당 없음 (일반·매니저 결재는 권한으로 자동 배정)" },
  { v: 1, label: "(구 설정) 1차 결재자 — 현재는 권한으로 자동 배정" },
  { v: 2, label: "(구 설정) 2차 결재자 — 현재는 권한으로 자동 배정" },
  { v: 3, label: "최종 결재자 (특수·임원·총괄의 결재를 받음)" }
];
/* 기존 계정 이행용 기본값 — approverTier / otExempt가 아직 지정되지 않은 계정만 이름으로 판단한다.
   [직원 관리]에서 한 번 저장하면 이후로는 직원 문서의 값이 쓰인다. */
const LEGACY_TIER_BY_NAME = { "권민호": 1, "안은비": 2, "장서영": 3 };
const LEGACY_OT_EXEMPT_NAMES = ["권민호"];
function approverTierOf(emp) {
  if (typeof emp?.approverTier === "number") return emp.approverTier;
  return LEGACY_TIER_BY_NAME[emp?.name] || 0;
}
/* 조기출근·연장 가산 제외 대상 (직책상 해당되지 않는 직원) */
function isOtExemptEmp(emp) {
  if (typeof emp?.otExempt === "boolean") return emp.otExempt;
  return LEGACY_OT_EXEMPT_NAMES.includes(emp?.name);
}
/* 신청자 권한에 따른 결재자 후보 (직원 목록 필요) — 권한 기준 자동 배정 */
function approverCandidates(emps, applicant = me) {
  const pick = applicant.role === "member" ? (e) => e.role === "manager" || e.role === "special"
    : applicant.role === "manager" ? (e) => e.role === "special"
    : (e) => approverTierOf(e) === 3;
  const list = emps.filter((e) => pick(e) && e.id !== applicant.id);
  if (list.length) return list;
  // 상위 결재자가 본인뿐인 경우(대표 등) — 본인이 직접 등록·승인한다
  const self = emps.find((e) => e.id === applicant.id);
  return self ? [self] : [];
}
const approverOptionHtml = (emps) => approverCandidates(emps)
  .map((e) => `<option value="${e.id}">${esc(e.name)}${e.id === me.id ? " (본인 승인)" : ""}</option>`).join("");
/* 결재 문서가 나에게 온 것인지 — ID 우선, 과거 이름만 저장된 문서는 이름으로 대조 */
function isMyApproval(r) {
  return r.approverId ? r.approverId === me.id : r.approver === me.name;
}
const ATT_REQ_LABEL = { overtime: "추가근무", change: "근무변경" };

/* 일정 종류별 색상 (휴가=빨강, 행사=그린, 기타=오렌지, 휴무=자주) */
const SC_KINDS = { "휴가": "red", "행사": "green", "기타": "orange", "휴무": "purple", "결재대기": "gray" };

let db = null;
let me = null; // { id, ...employee fields }
let currentView = "home";
let payrollYM = null; // "YYYY-MM"

/* ───────── 유틸 ───────── */
const $ = (sel) => document.querySelector(sel);

/* 한국 시간(KST, UTC+9) 기준 날짜 유틸
   toISOString()은 UTC 기준이라 기기 시간대와 무관하게 새벽 시간대에 전날로 표시되는 문제가 있어,
   UTC 타임스탬프에 +9시간을 더한 뒤 getUTC 계열로 읽어 KST 벽시계 값을 얻는다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function kstNow() { return new Date(Date.now() + KST_OFFSET_MS); }
function todayKST() { return kstNow().toISOString().slice(0, 10); }
function ymNowKST() { return kstNow().toISOString().slice(0, 7); }
/* "YYYY-MM-DD" 문자열의 월/일/요일 (시간대 무관) */
function dateParts(ds) {
  const d = new Date(ds + "T00:00:00Z");
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay() };
}
function dateLabelKo(ds) {
  const p = dateParts(ds);
  return `${p.m}월 ${p.d}일 (${"일월화수목금토"[p.dow]})`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function linkify(text) {
  // 이스케이프 후 URL만 링크로 변환
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener" class="memo-link">$1</a>');
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
// 이 이메일로 등록된 직원은 로그인 시 자동으로 총괄 관리자 권한을 가진다.
const ADMIN_EMAILS = ["wlstntrtr@gmail.com"];

function isAdmin() { return me && me.role === "admin"; }
function canViewAll() { return me && (me.role === "admin" || me.role === "executive"); }
function roleForDept(dept) {
  // 관리자 권한은 자동 부여하지 않는다 — [직원 관리]에서 지정된 사람에게만 수동 부여.
  if (dept === "대표") return "executive";
  return "member";
}
function roleLabel(role) {
  return { admin: "총괄 관리자", special: "특수관리자", manager: "매니저", executive: "임원 열람", member: "일반" }[role] || role;
}
function isSpecial() { return me && me.role === "special"; }
function isManager() { return me && me.role === "manager"; }
// 특수관리자: 사내 시스템·급여관리·직원 관리 조회/수정 가능
function canManageOps() { return isAdmin() || isSpecial(); }

/* 권한 서열 — 숫자가 클수록 상위 권한.
   근무 일정에만 존재하는 단기알바 등 역할이 없는 인원은 일반과 동일하게 본다. */
const ROLE_RANK = { admin: 40, special: 30, executive: 20, manager: 10, member: 0 };
function roleRank(role) { return ROLE_RANK[role] ?? 0; }
/* 매니저는 자신과 같거나 낮은 권한(매니저·일반)의 근태 기록만 편집할 수 있다. */
function canEditAttOf(role) {
  if (isAdmin() || isSpecial()) return true;
  if (isManager()) return roleRank(role) <= roleRank("manager");
  return false;
}

/* ───────── 초기화 ───────── */
async function boot() {
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();
  // 일부 네트워크(프록시·통신사·iOS 사파리)에서 스트리밍 채널이 반쯤 죽어
  // 읽기만 무한 대기하는 문제 완화 — 감지 시 롱폴링으로 자동 전환한다.
  try { db.settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (e) { /* 무시 */ }
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
    await loginSuccess(emp2);
  };
}

async function loginSuccess(emp) {
  me = { id: emp.id, ...emp };
  // 지정 관리자 이메일은 로그인 시 자동으로 총괄 관리자 권한 부여
  if (emp.email && ADMIN_EMAILS.includes(emp.email.toLowerCase()) && emp.role !== "admin") {
    await db.collection(COL.employees).doc(emp.id).update({ role: "admin" });
    me.role = "admin";
  }
  localStorage.setItem(SESSION_KEY, emp.id);
  await db.collection(COL.employees).doc(emp.id).update({
    lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  $("#login-password").value = "";
  enterApp();
}

function openBootstrapModal() {
  openModal(`
    <h3>시스템 초기 설정</h3>
    <p class="modal-desc">경영지원본부 최초 관리자를 등록합니다. 이 계정은 자동으로 총괄 관리자 권한을 가지며, 이후 [직원 관리]에서 전 직원을 등록할 수 있습니다.</p>
    <form id="bs-form">
      <label class="field"><span class="field-label">이름</span><input id="bs-name" required /></label>
      <label class="field"><span class="field-label">직책 (선택)</span><input id="bs-pos" placeholder="예: 본부장" /></label>
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
      joinDate: todayKST(),
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
    await loginSuccess(me);
  };
}

/* ───────── 앱 셸 ───────── */
function enterApp() {
  $("#login-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  renderSidebar();
  // 새로고침·주소 직접 입력 시 해시에 담긴 화면으로 복원한다 (없으면 홈)
  const start = parseHash();
  navigate(start.view, start.sub, true);
  // 브라우저 뒤로/앞으로 가기 대응 — 이미 그 화면이면 다시 그리지 않는다
  window.onhashchange = () => {
    const { view, sub } = parseHash();
    if (view === currentView && (!sub || sub === subTabOf(view))) return;
    navigate(view, sub, true);
  };
  // 탭을 1분 이상 벗어났다 돌아오면 화면을 새로 그린다 — 절전·백그라운드로
  // 죽은 연결을 새 요청으로 되살리고, 그 사이 바뀐 데이터도 반영한다.
  // (모달이 열려 있으면 입력 중일 수 있으므로 건드리지 않는다)
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (!me || Date.now() - hiddenAt < 60000) return;
    if (!$("#modal-backdrop").classList.contains("hidden")) return;
    navigate(currentView, null, true);
  });

  $("#logout-btn").onclick = async () => {
    localStorage.removeItem(SESSION_KEY);
    me = null;
    location.reload();
  };
  $("#sidebar-toggle").onclick = () => {
    const open = $("#sidebar").classList.toggle("open");
    $("#sidebar-backdrop").classList.toggle("show", open);
  };
  $("#sidebar-backdrop").onclick = closeSidebar;
  $("#sidebar-close").onclick = closeSidebar;
}

function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebar-backdrop").classList.remove("show");
}

/* 라인 아이콘 (stroke 기반 인라인 SVG) */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>',
  payroll: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M3 9h2M19 15h2"/></svg>',
  leave: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/></svg>',
  okr: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z"/></svg>',
  employees: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M16.5 15.2c2.5.3 4.3 1.8 5 4.3"/></svg>',
  monitor: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v5c0 4.6 3.2 8.4 7.5 10 4.3-1.6 7.5-5.4 7.5-10V6L12 3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  ledger: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9.5 15 2 2 3.5-3.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>'
};

function renderSidebar() {
  $("#user-card").innerHTML = `
    <div class="profile-top">
      <div>
        <div class="p-name">${esc(me.name)} 님</div>
        <div class="p-badges">
          <span class="badge dept">${esc(me.dept)}</span>
          <span class="badge ${me.role}">${roleLabel(me.role)}</span>
        </div>
      </div>
    </div>
    <ul class="p-meta">
      ${me.grade ? `<li><b>직급</b> ${esc(me.grade)}</li>` : ""}
      ${me.position ? `<li><b>직책</b> ${esc(me.position)}</li>` : ""}
      ${me.joinDate ? `<li><b>입사일</b> ${esc(me.joinDate)} <em class="tenure">${tenureYM(me.joinDate)} 근무</em></li>` : ""}
      ${me.email ? `<li><b>이메일</b> ${esc(me.email)}</li>` : ""}
      ${me.phone ? `<li><b>연락처</b> ${esc(me.phone)}</li>` : ""}
      <li><b>구분</b> ${empTypeShort(me.empType)}</li>
    </ul>
    <button class="btn btn-ghost btn-sm p-info-btn" id="my-info-btn">내 정보 보기</button>`;
  $("#my-info-btn").onclick = openMyInfoModal;

  const items = [
    { id: "home", ico: "home", label: "홈" },
    { id: "attend", ico: "clock", label: "근태기록" },
    { id: "schedule", ico: "calendar", label: "일정" },
    { id: "payhistory", ico: "payroll", label: "급여" },
    { id: "leave", ico: "leave", label: "휴가" },
    { id: "okr", ico: "okr", label: "OKR" },
    { id: "settings", ico: "settings", label: "설정" }
  ];
  let html = items.map((i) =>
    `<button class="nav-item" data-view="${i.id}">${ICONS[i.ico]}${i.label}</button>`).join("");
  const adminItems = [];
  if (canManageOps()) adminItems.push({ id: "systems", ico: "grid", label: "사내 시스템" });
  if (canManageOps()) adminItems.push({ id: "paymanage", ico: "ledger", label: "급여관리" });
  if (isAdmin() || isSpecial() || isManager()) adminItems.push({ id: "attendadmin", ico: "clock", label: "근태관리" });
  if (isAdmin() || isSpecial() || isManager() || me.role === "executive") adminItems.push({ id: "leaveadmin", ico: "leave", label: "연차관리" });
  if (canManageOps()) adminItems.push({ id: "employees", ico: "employees", label: "직원 관리" });
  if (isAdmin()) adminItems.push({ id: "monitor", ico: "monitor", label: "권한 모니터링" });
  if (adminItems.length) {
    html += `<div class="nav-label">관리자 메뉴</div>` +
      adminItems.map((i) => `<button class="nav-item" data-view="${i.id}">${ICONS[i.ico]}${i.label}</button>`).join("");
  }
  const nav = $("#nav");
  nav.innerHTML = html;
  nav.querySelectorAll(".nav-item").forEach((b) => {
    b.onclick = () => { navigate(b.dataset.view); closeSidebar(); };
  });
  updateLeaveAlarm();
  updateAttApprovalAlarm();
}

/* 나를 결재자로 지정한 대기 건 수만큼 해당 관리자 메뉴에 빨간 점 표시 */
function setNavDot(view, count, label) {
  const btn = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (!btn) return;
  let dot = btn.querySelector(".nav-dot");
  if (count > 0) {
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "nav-dot";
      btn.appendChild(dot);
    }
    dot.title = `${label} ${count}건`;
  } else if (dot) {
    dot.remove();
  }
}

/* 휴가 결재 대기 알람 — 연차관리 탭 */
async function updateLeaveAlarm() {
  if (!me) return;
  try {
    const snap = await db.collection(COL.leaveRequests).where("status", "==", "대기").get();
    setNavDot("leaveadmin", snap.docs.filter((d) => isMyApproval(d.data())).length, "내 결재 대기");
  } catch (e) { /* 무시 */ }
}

/* 근태 결재(추가근무·근무변경) 대기 알람 — 근태관리 탭 */
async function updateAttApprovalAlarm() {
  if (!me) return;
  try {
    const snap = await db.collection(COL.attRequests).where("status", "==", "대기").get();
    setNavDot("attendadmin", snap.docs.filter((d) => isMyApproval(d.data())).length, "내 결재 대기");
  } catch (e) { /* 무시 */ }
}

function openMyInfoModal() {
  const row = (k, v) => v ? `<tr><th>${k}</th><td>${esc(v)}</td></tr>` : "";
  openModal(`
    <h3>내 정보</h3>
    <p class="modal-desc">정보 수정이 필요하면 경영지원본부에 요청하세요.</p>
    <div class="table-wrap"><table class="data info-table">
      <tbody>
        ${row("이름", me.name)}
        ${row("부서", me.dept)}
        ${row("직급", me.grade)}
        ${row("직책", me.position)}
        ${row("권한", roleLabel(me.role))}
        ${me.joinDate ? `<tr><th>입사일</th><td>${esc(me.joinDate)} <em class="tenure">${tenureYM(me.joinDate)} 근무</em></td></tr>` : ""}
        ${row("이메일", me.email)}
        ${row("연락처", me.phone)}
        ${row("고용 구분", empTypeShort(me.empType))}
        ${row("재직 상태", me.status)}
      </tbody>
    </table></div>
    <div class="modal-actions"><button class="btn btn-ghost btn-sm" id="mi-close">닫기</button></div>`);
  $("#mi-close").onclick = closeModal;
}

/* ── 화면 라우팅 ────────────────────────────────────────────────────
   보고 있는 화면을 URL 해시에 남겨, 새로고침해도 그 화면이 그대로 유지된다.
   근태기록처럼 하위 탭이 있는 화면은 "#attend/calendar" 형태로 함께 담는다. */
const VIEW_RENDER = {
  home: () => renderHome(),
  schedule: () => renderSchedule(),
  attend: () => renderAttend(),
  attendadmin: () => renderAttendAdmin(),
  payhistory: () => renderPayHistory(),
  paymanage: () => renderPayroll(),
  leave: () => renderLeave(),
  leaveadmin: () => renderLeaveAdmin(),
  okr: () => renderOkr(),
  settings: () => renderSettings(),
  systems: () => renderSystems(),
  employees: () => renderEmployees(),
  monitor: () => renderMonitor()
};
const ATT_TABS = ["record", "calendar", "history"];
const OKR_TABS = ["mine", "dept", "status"];
/* 하위 탭이 있는 화면의 현재 탭 값 (없으면 null) */
function subTabOf(view) {
  if (view === "attend") return attTab;
  if (view === "okr") return okrTab;
  return null;
}
const viewHash = () => currentView + (subTabOf(currentView) ? `/${subTabOf(currentView)}` : "");
/* 해시 → { view, sub } (알 수 없는 값은 기본 화면으로) */
function parseHash() {
  let raw = location.hash.replace(/^#/, "");
  try { raw = decodeURIComponent(raw); } catch (e) { raw = ""; }   // 깨진 해시(%)로 앱이 멈추지 않게
  const [v, sub] = raw.split("/");
  const view = VIEW_RENDER[v] ? v : "home";
  const valid = view === "attend" ? ATT_TABS : view === "okr" ? OKR_TABS : [];
  return { view, sub: valid.includes(sub) ? sub : null };
}
/* replace=true 면 히스토리에 새 기록을 남기지 않는다 (권한 없어 되돌릴 때 등) */
function navigate(view, sub, replace) {
  currentView = view;
  if (view === "attend" && sub) attTab = sub;
  if (view === "okr" && sub) okrTab = sub;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  const h = "#" + viewHash();
  if (location.hash !== h) {
    if (replace) history.replaceState(null, "", h);
    else location.hash = h;   // 뒤로가기로 이전 화면에 돌아갈 수 있도록 기록을 남긴다
  }
  const render = VIEW_RENDER[view];
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

/* ───────── 홈 (대시보드) ───────── */
// 버튼 테두리 색상 팔레트 (10색) — 관리자가 지정한 색이 전 직원 홈에 동일하게 적용된다.
const BTN_COLORS = [
  { key: "blue", hex: "#3182f6", label: "블루" },
  { key: "navy", hex: "#1b3a8a", label: "네이비" },
  { key: "teal", hex: "#0aa5a8", label: "청록" },
  { key: "green", hex: "#1fa45b", label: "그린" },
  { key: "lime", hex: "#7cb305", label: "라임" },
  { key: "amber", hex: "#d8930d", label: "앰버" },
  { key: "orange", hex: "#f76707", label: "오렌지" },
  { key: "red", hex: "#f04452", label: "레드" },
  { key: "pink", hex: "#e64980", label: "핑크" },
  { key: "purple", hex: "#7048e8", label: "퍼플" }
];
const DEFAULT_BTN_COLOR = "#d9dee3";
let homeEditMode = false;
let homeShowAll = false; // 모바일: 바로가기 4개 초과 펼침 여부

function colorPickerHtml(selected) {
  return `<div class="color-picker" id="color-picker">
    ${BTN_COLORS.map((c) => `
      <label class="swatch" title="${c.label}">
        <input type="radio" name="btn-color" value="${c.hex}" ${selected === c.hex ? "checked" : ""} />
        <span style="background:${c.hex}"></span>
      </label>`).join("")}
  </div>`;
}
function pickedColor() {
  const r = document.querySelector('input[name="btn-color"]:checked');
  return r ? r.value : "";
}

function fmtPeriod(start, end) {
  const sh = (d) => (d || "").slice(2);
  if (!start) return "-";
  return end && end !== start ? `${sh(start)} ~ ${sh(end)}` : sh(start);
}

/* 연차 갱신일이 도래했으면 자동 리셋하고 이전 주기를 history에 보존한다 */
async function maybeResetLeave(empId, lv) {
  if (!lv || !lv.grantDate) return lv;
  const today = todayKST();
  let changed = false;
  while (nextGrantDate(lv.grantDate) <= today) {
    const cycleEnd = nextGrantDate(lv.grantDate);
    const used = (lv.records || []).reduce((s, r) => s + (Number(r.days) || 0), 0);
    const allocated = Number(lv.allocated) || 0;
    lv.history = [...(lv.history || []), {
      start: lv.grantDate,
      end: cycleEnd,
      allocated,
      used,
      remaining: allocated - used,
      records: lv.records || []
    }];
    lv.records = [];
    lv.grantDate = cycleEnd;
    changed = true;
  }
  if (changed) {
    await db.collection(COL.leaves).doc(empId).set(lv);
  }
  return lv;
}

function nextGrantDate(d) {
  // 연차 발생일 + 1년 = 다음 갱신 예정일
  const [y, m, dd] = d.split("-");
  return `${Number(y) + 1}-${m}-${dd}`;
}

/* ── 공지사항 ── */
function canPostNotice() { return me && me.role !== "member"; }
function noticeTargetsMe(n) {
  if (n.scope === "all") return true;
  if (n.scope === "dept") return (n.depts || []).includes(me.dept);
  if (n.scope === "personal") return (n.targetIds || []).includes(me.id);
  return false;
}
function noticeScopeLabel(n) {
  if (n.scope === "all") return "전체 공지";
  if (n.scope === "dept") return `부서 공지 · ${(n.depts || []).join(", ")}`;
  return "개별 공지";
}
async function renderHomeNotices() {
  const area = document.getElementById("home-notices");
  if (!area) return;
  const snap = await db.collection(COL.notices).get();
  const notices = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter(noticeTargetsMe)
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

  // 확인함을 누른 공지는 홈에서 사라지고 [지난 공지 보기]로만 다시 볼 수 있다.
  const fresh = notices.filter((n) => !(n.ackIds || []).includes(me.id));
  const past = notices.filter((n) => (n.ackIds || []).includes(me.id));

  area.innerHTML = fresh.map((n) => `
    <div class="notice-card open" data-nid="${n.id}">
      <div class="nt-head">
        <span class="nt-ico">📢</span>
        <span class="nt-badge">공지</span>
        <b class="nt-title">${esc(n.title)}</b>
        <span class="nt-scope">${noticeScopeLabel(n)}</span>
      </div>
      <div class="nt-body">${linkify(n.body || "")}</div>
      <div class="nt-foot">
        <span class="nt-meta">${esc(n.authorName || "")} · ${fmtTs(n.createdAt)}</span>
        <button class="btn btn-primary btn-sm" data-nt-ack="${n.id}">확인함</button>
      </div>
    </div>`).join("") +
    (past.length ? `<div class="nt-past-row"><button type="button" class="nt-past-btn" id="nt-past">지난 공지 보기 (${past.length})</button></div>` : "");

  area.querySelectorAll("[data-nt-ack]").forEach((b) => {
    b.onclick = async () => {
      await db.collection(COL.notices).doc(b.dataset.ntAck).update({
        ackIds: firebase.firestore.FieldValue.arrayUnion(me.id)
      });
      renderHomeNotices();
    };
  });
  const pastBtn = $("#nt-past");
  if (pastBtn) pastBtn.onclick = () => openPastNoticesModal(past);
}

/* 지난 공지 보기 — 내가 확인함을 누른 공지 목록.
   공지 문서 자체에서 매번 다시 읽으므로, 게시자가 공지를 철회(삭제)하면 여기서도 자동으로 사라진다. */
function openPastNoticesModal(past) {
  openModal(`
    <h3>지난 공지</h3>
    <p class="modal-desc">확인함을 누른 공지 ${past.length}건입니다. 제목을 누르면 내용이 펼쳐집니다.</p>
    <div class="nt-past-list">
      ${past.map((n) => `
        <details class="nt-past-item">
          <summary class="nt-past-sum">
            <span class="nt-badge">공지</span>
            <b class="nt-title">${esc(n.title)}</b>
            <span class="nt-past-date">${fmtTs(n.createdAt)}</span>
            <span class="nt-past-arrow">⌄</span>
          </summary>
          <div class="nt-body">${linkify(n.body || "")}</div>
          <div class="nt-meta">${esc(n.authorName || "")} · ${noticeScopeLabel(n)}</div>
        </details>`).join("")}
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" id="ntp-close">닫기</button></div>`);
  $("#ntp-close").onclick = closeModal;
}

function recentMonths(n) {
  const list = [];
  const now = kstNow();
  let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  for (let i = 0; i < n; i++) {
    list.push(`${y}-${String(m).padStart(2, "0")}`);
    if (--m < 1) { m = 12; y--; }
  }
  return list;
}

async function renderHome() {
  const main = $("#main");
  const tp = dateParts(todayKST());
  const dateStr = `${tp.y}년 ${tp.m}월 ${tp.d}일 (${"일월화수목금토"[tp.dow]})`;

  main.innerHTML = `
    <div class="home-greet">
      <div>
        <div class="g-title">안녕하세요, <em>${esc(me.name)}</em> 님</div>
        <p class="g-sub">${esc(me.dept)} · 오늘도 좋은 하루 보내세요.</p>
      </div>
      <span class="g-date">${dateStr}</span>
    </div>
    <div class="card" id="shortcut-card">
      <div class="card-title">
        <div>바로가기</div>
        <span style="display:flex;gap:6px">
          ${canManageOps() ? `<button class="btn btn-ghost btn-sm" data-goto="systems">시스템 관리</button>` : ""}
          ${homeEditMode ? `
            <button class="btn btn-ghost btn-sm" id="my-add">+ 새 등록</button>
            <button class="btn btn-ghost btn-sm" id="sys-archive">보관함</button>
            <button class="btn btn-primary btn-sm" id="home-edit">완료</button>`
          : `<button class="btn btn-ghost btn-sm" id="home-edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M17 3a2.8 2.8 0 0 1 4 4L8 20l-5 1 1-5L17 3Z"/></svg> 편집</button>`}
        </span>
      </div>
      <div id="shortcut-body"><div class="empty">불러오는 중...</div></div>
    </div>
    <div id="home-notices"></div>
    <div class="widget-grid">
      <div class="card">
        <div class="card-title">
          <div>업무 할 일 <span class="todo-count" id="todo-count"></span><div class="ct-desc">오늘 처리할 일을 적어두세요. 체크하면 목록에서 사라집니다.</div></div>
        </div>
        <form id="todo-form" class="todo-add">
          <input id="todo-input" placeholder="할 일을 입력하고 Enter" maxlength="200" autocomplete="off" />
          <button type="submit" class="btn btn-primary btn-sm" id="todo-add-btn" disabled>추가</button>
        </form>
        <div id="todo-list"><div class="empty" style="padding:20px">불러오는 중...</div></div>
      </div>
      <div class="card">
        <div class="card-title">
          <div>개인 메모장<div class="ct-desc">나만 보는 메모입니다.</div></div>
          <span style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" id="memo-full">전체보기</button>
            <button class="btn btn-ghost btn-sm" id="memo-btn">수정</button>
          </span>
        </div>
        <div id="memo-holder" class="memo-holder"><div class="empty" style="padding:20px">불러오는 중...</div></div>
      </div>
    </div>
    <div class="widget-grid">
      <div class="card">
        <div class="card-title">
          <div>급여이력<div class="ct-desc">내 최근 급여 현황입니다.</div></div>
          <button class="btn btn-ghost btn-sm" data-goto="payhistory">전체 이력 →</button>
        </div>
        <div id="home-pay"></div>
      </div>
      <div class="card">
        <div class="card-title">
          <div>연차/휴가<div class="ct-desc">나의 연차 사용 현황입니다.</div></div>
          <button class="btn btn-ghost btn-sm" data-goto="leave">사용 내역 →</button>
        </div>
        <div id="home-leave"></div>
      </div>
    </div>`;

  main.querySelectorAll("[data-goto]").forEach((b) => { b.onclick = () => navigate(b.dataset.goto); });

  /* ── 모든 위젯 데이터 병렬 로드 (섹션별 순차 대기 제거) ── */
  const pSys = db.collection(COL.systems).get();
  const pPB = db.collection(COL.personalButtons).doc(me.id).get();
  const pPay = Promise.all(recentMonths(6).map((ym) =>
    db.collection(COL.payroll).doc(ym).collection("rows").get().then((s) => ({
      ym, rows: s.docs.map((d) => d.data())
    }))));
  const pLv = db.collection(COL.leaves).doc(me.id).get();
  const pTodo = db.collection(COL.todos).doc(me.id).get();
  const pMemo = db.collection(COL.memos).doc(me.id).get();
  renderHomeNotices();

  /* ── 바로가기: 편집 모드 + 정렬 + 보관함 ── */
  const [sysSnap, myBtnSnap] = await Promise.all([pSys, pPB]);
  const mySystems = sysSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => canManageOps() || s.allowAll || (s.grantIds || []).includes(me.id))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const pbData = myBtnSnap.exists ? myBtnSnap.data() : {};
  const myBtns = pbData.items || [];
  let hiddenSys = pbData.hiddenSystems || [];
  let tileOrder = pbData.tileOrder || [];
  // 개인 버튼 고유 id 보정 (정렬 키로 사용)
  let idFixed = false;
  myBtns.forEach((b) => {
    if (!b.id) { b.id = "p" + Math.random().toString(36).slice(2, 10); idFixed = true; }
  });
  const savePB = () => db.collection(COL.personalButtons).doc(me.id)
    .set({ items: myBtns, hiddenSystems: hiddenSys, tileOrder }, { merge: true });
  if (idFixed) savePB();

  const visibleSystems = mySystems.filter((sy) => !hiddenSys.includes(sy.id));
  const visibleMy = myBtns.map((b, i) => ({ b, i })).filter((x) => !x.b.hidden);

  // 통합 타일 목록 + 사용자 지정 순서 적용
  let entries = [
    ...visibleSystems.map((sy) => ({ key: "s:" + sy.id, data: sy, sysId: sy.id })),
    ...visibleMy.map(({ b, i }) => ({ key: "m:" + b.id, data: b, myIdx: i }))
  ];
  entries.sort((a, b) => {
    const ia = tileOrder.indexOf(a.key), ib = tileOrder.indexOf(b.key);
    return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
  });

  // 첫 줄까지만 표시, 나머지는 [더 보기]로 펼침 (tile-grid 열 수와 동일하게 유지)
  const isMobile = window.matchMedia("(max-width: 860px)").matches;
  const rowLimit = isMobile ? 4 : window.matchMedia("(max-width: 1180px)").matches ? 4 : 6;
  const shown = homeShowAll ? entries : entries.slice(0, rowLimit);
  const hiddenCount = entries.length - shown.length;

  const tile = (e, pos) => {
    const b = e.data;
    let editHtml = "";
    if (homeEditMode) {
      const move = `${pos > 0 ? `<button data-mv="${e.key}" data-dir="-1" title="앞으로">‹</button>` : ""}
        ${pos < shown.length - 1 || hiddenCount ? `<button data-mv="${e.key}" data-dir="1" title="뒤로">›</button>` : ""}`;
      editHtml = e.sysId
        ? `<span class="t-edit">${move}<button data-syshide="${e.sysId}">보관</button></span>`
        : `<span class="t-edit">${move}<button data-myedit="${e.myIdx}">수정</button><button data-myhide="${e.myIdx}">보관</button></span>`;
    }
    return `
    <a class="tile" href="${esc(b.url)}" target="_blank" rel="noopener" style="border-color:${esc(b.color || DEFAULT_BTN_COLOR)}">
      ${editHtml}
      <span class="t-label">${esc(b.label)}</span>
      <span class="t-desc">${esc(b.desc || "")}</span>
    </a>`;
  };

  $("#shortcut-body").innerHTML = entries.length ? `
    <div class="tile-grid">${shown.map((e, pos) => tile(e, pos)).join("")}</div>
    ${entries.length > rowLimit ? `<button class="btn btn-ghost btn-sm more-btn" id="tile-more">
      ${homeShowAll ? "접기 ⌃" : `더 보기 (${hiddenCount}개) ⌄`}</button>` : ""}`
    : (mySystems.length || myBtns.length)
      ? `<div class="empty">모든 버튼이 보관함에 있습니다. [편집] → [보관함]에서 다시 꺼낼 수 있어요.</div>`
      : `<div class="empty">표시할 버튼이 없습니다.${isAdmin() ? " [사내 시스템]에서 버튼을 등록하고 권한을 부여하세요." : " [편집] → [+ 새 등록]으로 나만의 버튼을 추가하거나, 필요한 시스템은 경영지원본부에 요청하세요."}</div>`;

  const moreBtn = $("#tile-more");
  if (moreBtn) moreBtn.onclick = () => { homeShowAll = !homeShowAll; renderHome(); };

  $("#home-edit").onclick = () => { homeEditMode = !homeEditMode; renderHome(); };

  // 순서 변경 (‹ ›)
  main.querySelectorAll("[data-mv]").forEach((b) => {
    b.onclick = async (e) => {
      e.preventDefault();
      const keys = entries.map((x) => x.key);
      const from = keys.indexOf(b.dataset.mv);
      const to = from + Number(b.dataset.dir);
      if (to < 0 || to >= keys.length) return;
      [keys[from], keys[to]] = [keys[to], keys[from]];
      tileOrder = keys;
      await savePB();
      renderHome();
    };
  });

  // 길게 누르면 편집 모드 (모바일 위젯 방식)
  if (!homeEditMode) {
    let lpTimer = null, lpFired = false;
    main.querySelectorAll(".tile").forEach((t) => {
      t.addEventListener("pointerdown", () => {
        lpFired = false;
        lpTimer = setTimeout(() => {
          lpFired = true;
          homeEditMode = true;
          toast("편집 모드 — 순서 변경·보관이 가능합니다.");
          renderHome();
        }, 600);
      });
      ["pointerup", "pointerleave", "pointercancel", "pointermove"].forEach((ev) =>
        t.addEventListener(ev, (e2) => {
          if (ev === "pointermove" && lpTimer) return; // 미세 이동 허용
          clearTimeout(lpTimer);
        }));
      t.addEventListener("click", (e2) => { if (lpFired) { e2.preventDefault(); lpFired = false; } });
      t.addEventListener("contextmenu", (e2) => { if (lpFired) e2.preventDefault(); });
    });
  }

  main.querySelectorAll("[data-syshide]").forEach((b) => {
    b.onclick = async (e) => {
      e.preventDefault();
      hiddenSys.push(b.dataset.syshide);
      await savePB();
      renderHome();
    };
  });
  main.querySelectorAll("[data-myhide]").forEach((b) => {
    b.onclick = async (e) => {
      e.preventDefault();
      myBtns[Number(b.dataset.myhide)].hidden = true;
      await savePB();
      renderHome();
    };
  });
  main.querySelectorAll("[data-myedit]").forEach((b) => {
    b.onclick = (e) => { e.preventDefault(); openMyButtonModal(myBtns, Number(b.dataset.myedit)); };
  });

  const myAdd = $("#my-add");
  if (myAdd) myAdd.onclick = () => openMyButtonModal(myBtns, null);

  const archiveBtn = $("#sys-archive");
  if (archiveBtn) archiveBtn.onclick = () => {
    const renderArchive = () => {
      const hiddenSystems = mySystems.filter((sy) => hiddenSys.includes(sy.id));
      const hiddenMy = myBtns.map((b, i) => ({ b, i })).filter((x) => x.b.hidden);
      openModal(`
        <h3>보관함</h3>
        <p class="modal-desc">보관된 버튼입니다. [등록]하면 바로가기에 복구됩니다. 직접 만든 버튼만 삭제할 수 있어요.</p>
        ${(hiddenSystems.length || hiddenMy.length) ? `<div class="archive-list">
          ${hiddenSystems.map((sy) => `<div class="archive-row">
            <i class="dot" style="background:${esc(sy.color || DEFAULT_BTN_COLOR)}"></i>
            <span class="ar-label">${esc(sy.label)}</span>
            <span class="badge">사내 시스템</span>
            <button class="btn btn-primary btn-sm" data-arsys="${sy.id}">등록</button>
          </div>`).join("")}
          ${hiddenMy.map(({ b, i }) => `<div class="archive-row">
            <i class="dot" style="background:${esc(b.color || DEFAULT_BTN_COLOR)}"></i>
            <span class="ar-label">${esc(b.label)}</span>
            <span class="badge dept">내 바로가기</span>
            <button class="btn btn-primary btn-sm" data-army="${i}">등록</button>
            <button class="btn btn-danger btn-sm" data-ardel="${i}">삭제</button>
          </div>`).join("")}
        </div>` : `<div class="empty">보관된 버튼이 없습니다.</div>`}
        <div class="modal-actions"><button class="btn btn-primary" id="ar-close">닫기</button></div>`);
      $("#ar-close").onclick = () => { closeModal(); renderHome(); };
      $("#modal").querySelectorAll("[data-arsys]").forEach((bt) => {
        bt.onclick = async () => {
          hiddenSys = hiddenSys.filter((id) => id !== bt.dataset.arsys);
          await savePB();
          renderArchive();
        };
      });
      $("#modal").querySelectorAll("[data-army]").forEach((bt) => {
        bt.onclick = async () => {
          delete myBtns[Number(bt.dataset.army)].hidden;
          await savePB();
          renderArchive();
        };
      });
      $("#modal").querySelectorAll("[data-ardel]").forEach((bt) => {
        bt.onclick = async () => {
          const i = Number(bt.dataset.ardel);
          if (!confirm(`"${myBtns[i].label}" 버튼을 정말로 삭제할까요?\n삭제하면 복구할 수 없습니다.`)) return;
          myBtns.splice(i, 1);
          await savePB();
          renderArchive();
        };
      });
    };
    renderArchive();
  };

  /* ── 급여 위젯: 최근 6개월 ── */
  const monthRows = await pPay;
  const payLines = monthRows.flatMap(({ ym, rows }) =>
    rows.filter((r) => r.empId === me.id || r.name === me.name)
      .map((r) => ({ ym, rec: normalizePayRow(r) })))
    .sort((a, b) => b.ym.localeCompare(a.ym) || (b.rec.payDate || "").localeCompare(a.rec.payDate || ""))
    .slice(0, 5);

  $("#home-pay").innerHTML = payLines.length ? `
    <div class="table-wrap home-pay-scroll"><table class="data pay-table">
      <thead><tr><th>월</th><th>지급일</th><th class="num">총 지급</th><th class="num">총 공제</th><th class="num">실수령</th></tr></thead>
      <tbody>${payLines.map((l) => `<tr>
        <td><b>${l.ym}</b></td>
        <td>${esc(l.rec.payDate || "-")}</td>
        <td class="num c-green">${fmt(l.rec.payTotal)}</td>
        <td class="num c-red">${fmt(l.rec.deductTotal)}</td>
        <td class="num"><b class="c-green">${fmt(l.rec.net)}</b></td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="mini-note">월별 상세 명세는 [급여] 탭에서 확인하세요.</div>`
    : `<div class="empty">최근 6개월 급여 내역이 없습니다.${isAdmin() ? " [급여관리]에서 입력을 시작하세요." : ""}</div>`;

  /* ── 연차 위젯 ── */
  const lvSnap = await pLv;
  const lv = lvSnap.exists ? lvSnap.data() : { allocated: 0, records: [] };
  const recs = lv.records || [];
  const used = recs.reduce((s, r) => s + (Number(r.days) || 0), 0);
  const remain = (Number(lv.allocated) || 0) - used;
  const pct = lv.allocated ? Math.min(100, Math.round((used / lv.allocated) * 100)) : 0;
  const byType = LEAVE_TYPES.map((t, i) => {
    const days = recs.filter((r) => r.type === t).reduce((s, r) => s + (Number(r.days) || 0), 0);
    return { t, days, tone: ["", "gold", "ok", "plum", ""][i % 5] };
  });
  const maxType = Math.max(1, ...byType.map((b) => b.days));

  $("#home-leave").innerHTML = `
    <div class="leave-chips">
      <div class="leave-chip"><div class="c-label">총 연차</div><div class="c-value">${lv.allocated || 0}일</div></div>
      <div class="leave-chip"><div class="c-label">사용</div><div class="c-value">${used}일</div></div>
      <div class="leave-chip remain"><div class="c-label">남은 연차</div><div class="c-value">${remain}일</div></div>
    </div>
    <div class="usage-line"><span>사용률</span><div class="bar ${remain < 0 ? "over" : ""}"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>
    ${lv.grantDate ? `<div class="mini-note" style="margin:0 0 14px">연차 발생일 ${esc(lv.grantDate)} · 다음 갱신 예정 ${esc(nextGrantDate(lv.grantDate))}</div>` : ""}
    <div class="type-bars">
      ${byType.map((b) => `<div class="type-bar">
        <span>${b.t}</span>
        <div class="bar ${b.tone}"><i style="width:${Math.round((b.days / maxType) * 100)}%"></i></div>
        <span class="tb-num">${b.days}일</span>
      </div>`).join("")}
    </div>`;

  /* ── 업무 할 일 (투두) ── */
  const todoRef = db.collection(COL.todos).doc(me.id);
  const todoSnap = await pTodo;
  let todoItems = todoSnap.exists ? (todoSnap.data().items || []) : [];
  const saveTodos = () => todoRef.set({ items: todoItems });

  const renderTodos = () => {
    const cnt = $("#todo-count");
    if (cnt) cnt.textContent = todoItems.length ? todoItems.length : "0";
    $("#todo-list").innerHTML = todoItems.length ? todoItems.map((t, i) => `
      <div class="todo-row" data-i="${i}">
        <label class="todo-check"><input type="checkbox" data-done="${i}" /><span></span></label>
        <span class="todo-text" data-text="${i}">${esc(t.text)}</span>
        <span class="todo-acts">
          <button data-tedit="${i}" title="수정">수정</button>
          <button data-tdel="${i}" title="삭제">삭제</button>
        </span>
      </div>`).join("")
      : `<div class="empty" style="padding:20px">할 일이 없습니다. 위에 입력해 추가하세요.</div>`;

    $("#todo-list").querySelectorAll("[data-done]").forEach((c) => {
      c.onchange = async () => {
        const row = c.closest(".todo-row");
        row.classList.add("done");
        setTimeout(async () => {
          todoItems.splice(Number(c.dataset.done), 1);
          await saveTodos();
          renderTodos();
        }, 350);
      };
    });
    $("#todo-list").querySelectorAll("[data-tdel]").forEach((b) => {
      b.onclick = async () => {
        todoItems.splice(Number(b.dataset.tdel), 1);
        await saveTodos();
        renderTodos();
      };
    });
    $("#todo-list").querySelectorAll("[data-tedit]").forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.tedit);
        const span = $("#todo-list").querySelector(`[data-text="${i}"]`);
        const input = document.createElement("input");
        input.className = "todo-edit";
        input.value = todoItems[i].text;
        input.maxLength = 200;
        span.replaceWith(input);
        input.focus();
        const commit = async () => {
          const v = input.value.trim();
          if (v) { todoItems[i].text = v; await saveTodos(); }
          renderTodos();
        };
        input.onkeydown = (ev) => { if (ev.key === "Enter") commit(); if (ev.key === "Escape") renderTodos(); };
        input.onblur = commit;
      };
    });
  };
  renderTodos();

  $("#todo-input").oninput = () => {
    $("#todo-add-btn").disabled = !$("#todo-input").value.trim();
  };
  $("#todo-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const v = $("#todo-input").value.trim();
    if (!v) return;
    todoItems.push({ text: v });
    $("#todo-input").value = "";
    $("#todo-add-btn").disabled = true;
    await saveTodos();
    renderTodos();
  };

  /* ── 개인 메모장 (보기: URL 자동 링크 / 수정: textarea) ── */
  const memoRef = db.collection(COL.memos).doc(me.id);
  const memoSnap = await pMemo;
  const memoBtn = $("#memo-btn");
  let memoText = memoSnap.exists ? (memoSnap.data().text || "") : "";
  let memoEditing = false;

  const renderMemo = () => {
    const holder = $("#memo-holder");
    if (memoEditing) {
      holder.innerHTML = `<textarea id="memo-area" class="memo-area editing"></textarea>`;
      const ta = $("#memo-area");
      ta.value = memoText;
      ta.focus();
    } else {
      holder.innerHTML = `<div class="memo-area memo-render">${memoText.trim() ? linkify(memoText) : '<span class="memo-empty">[수정]을 눌러 메모를 작성하세요. URL을 입력하면 자동으로 링크가 됩니다.</span>'}</div>`;
    }
  };
  renderMemo();

  $("#memo-full").onclick = () => {
    openModal(`
      <h3>개인 메모장</h3>
      <div class="memo-view">${memoText.trim() ? linkify(memoText) : "작성된 메모가 없습니다."}</div>
      <div class="modal-actions"><button class="btn btn-primary" id="mv-close">닫기</button></div>`);
    $("#mv-close").onclick = closeModal;
  };
  memoBtn.onclick = async () => {
    if (!memoEditing) {
      memoEditing = true;
      renderMemo();
      memoBtn.textContent = "저장";
      memoBtn.classList.remove("btn-ghost");
      memoBtn.classList.add("btn-primary");
    } else {
      memoText = $("#memo-area").value;
      await memoRef.set({ text: memoText });
      memoEditing = false;
      renderMemo();
      memoBtn.textContent = "수정";
      memoBtn.classList.remove("btn-primary");
      memoBtn.classList.add("btn-ghost");
      toast("메모를 저장했습니다.");
    }
  };
}

/* ───────── 사내 시스템 (관리자: 버튼 등록 + 계정별 권한 부여) ───────── */
async function renderSystems() {
  if (!canManageOps()) return navigate("home", null, true);
  const main = $("#main");
  main.innerHTML = pageHead("SYSTEMS", "사내 시스템",
    "회사에서 사용하는 사이트 버튼을 등록하고, 계정별로 사용 권한을 부여합니다. 권한이 부여된 직원의 홈에 버튼이 자동으로 나타납니다.",
    `<button class="btn btn-primary btn-sm" id="sys-add">+ 시스템 추가</button>`) +
    `<div id="sys-body"><div class="empty">불러오는 중...</div></div>`;
  $("#sys-add").onclick = () => openSystemModal(null);

  const [sysSnap, empSnap] = await Promise.all([
    db.collection(COL.systems).get(),
    db.collection(COL.employees).where("status", "==", "재직").get()
  ]);
  const systems = sysSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const emps = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const activeCount = emps.length;

  $("#sys-body").innerHTML = systems.length ? `<div class="card"><div class="table-wrap">
    <table class="data"><thead><tr>
      <th>시스템</th><th>URL</th><th>설명</th><th>사용 권한</th><th></th>
    </tr></thead><tbody>
    ${systems.map((s) => {
      const n = s.allowAll ? activeCount : (s.grantIds || []).filter((id) => emps.some((e) => e.id === id)).length;
      return `<tr>
        <td><i class="dot" style="background:${esc(s.color || DEFAULT_BTN_COLOR)}"></i><b>${esc(s.label)}</b></td>
        <td class="url-cell"><a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.url)}">${esc(s.url)}</a></td>
        <td>${esc(s.desc || "-")}</td>
        <td>${s.allowAll ? '<span class="badge ok">전체 공개</span>' : `<span class="badge ${n ? "admin" : "off"}">${n}명</span>`}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-primary btn-sm" data-grant="${s.id}">권한 관리</button>
          <button class="btn btn-ghost btn-sm" data-sysedit="${s.id}">수정</button>
          <button class="btn btn-danger btn-sm" data-sysdel="${s.id}">삭제</button>
        </td>
      </tr>`;
    }).join("")}</tbody></table>
  </div></div>`
    : `<div class="empty">등록된 사내 시스템이 없습니다. [+ 시스템 추가]로 회사에서 쓰는 사이트를 등록하세요.</div>`;

  $("#sys-body").querySelectorAll("[data-sysedit]").forEach((b) => {
    b.onclick = () => openSystemModal(systems.find((s) => s.id === b.dataset.sysedit));
  });
  $("#sys-body").querySelectorAll("[data-grant]").forEach((b) => {
    b.onclick = () => openGrantModal(systems.find((s) => s.id === b.dataset.grant), emps);
  });
  $("#sys-body").querySelectorAll("[data-sysdel]").forEach((b) => {
    b.onclick = async () => {
      const s = systems.find((x) => x.id === b.dataset.sysdel);
      if (!confirm(`사내 시스템 "${s.label}"을(를) 삭제할까요?\n권한을 받은 직원들의 홈에서도 사라집니다.`)) return;
      await db.collection(COL.systems).doc(s.id).delete();
      renderSystems();
    };
  });
}

function openSystemModal(sys) {
  openModal(`
    <h3>${sys ? "사내 시스템 수정" : "사내 시스템 추가"}</h3>
    <p class="modal-desc">등록 후 [권한 관리]에서 사용할 직원을 지정하세요.</p>
    <form id="sys-form">
      <label class="field"><span class="field-label">시스템 이름</span><input id="sf-label" required value="${esc(sys?.label || "")}" /></label>
      <label class="field"><span class="field-label">URL</span><input id="sf-url" type="url" required placeholder="https://..." value="${esc(sys?.url || "")}" /></label>
      <label class="field"><span class="field-label">설명 (선택)</span><input id="sf-desc" value="${esc(sys?.desc || "")}" /></label>
      <div class="field"><span class="field-label">버튼 테두리 색상 — 모든 직원 홈에 동일하게 표시됩니다</span>
        ${colorPickerHtml(sys?.color || BTN_COLORS[0].hex)}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="sf-cancel">취소</button>
        <button type="submit" class="btn btn-primary">저장</button>
      </div>
    </form>`);
  $("#sf-cancel").onclick = closeModal;
  $("#sys-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = {
      label: $("#sf-label").value.trim(),
      url: $("#sf-url").value.trim(),
      desc: $("#sf-desc").value.trim(),
      color: pickedColor() || BTN_COLORS[0].hex
    };
    if (sys) {
      await db.collection(COL.systems).doc(sys.id).update(data);
    } else {
      await db.collection(COL.systems).add({ ...data, allowAll: false, grantIds: [], order: Date.now() % 100000 });
    }
    closeModal();
    renderSystems();
  };
}

function openGrantModal(sys, emps) {
  const grantIds = new Set(sys.grantIds || []);
  const byDept = DEPTS.map((d) => ({
    dept: d,
    list: emps.filter((e) => e.dept === d).sort((a, b) => a.name.localeCompare(b.name, "ko"))
  })).filter((g) => g.list.length);

  openModal(`
    <h3>권한 관리 — ${esc(sys.label)}</h3>
    <p class="modal-desc">체크된 직원의 홈에 이 버튼이 자동으로 나타납니다. (총괄 관리자는 항상 모든 버튼이 보입니다)</p>
    <label class="grant-all">
      <input type="checkbox" id="gr-all" ${sys.allowAll ? "checked" : ""} />
      <span><b>전체 공개</b> — 모든 재직 직원에게 표시</span>
    </label>
    <div id="gr-list" class="grant-list ${sys.allowAll ? "disabled" : ""}">
      ${byDept.map((g) => `
        <div class="grant-dept">${g.dept}</div>
        ${g.list.map((e) => `
          <label class="grant-row">
            <input type="checkbox" data-gid="${e.id}" ${grantIds.has(e.id) ? "checked" : ""} ${sys.allowAll ? "disabled" : ""} />
            <span>${esc(e.name)}</span><em>${esc(e.position || "")}</em>
          </label>`).join("")}`).join("")}
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="gr-cancel">취소</button>
      <button type="button" class="btn btn-primary" id="gr-save">권한 저장</button>
    </div>`);

  $("#gr-cancel").onclick = closeModal;
  $("#gr-all").onchange = (ev) => {
    const on = ev.target.checked;
    $("#gr-list").classList.toggle("disabled", on);
    $("#gr-list").querySelectorAll("input").forEach((i) => (i.disabled = on));
  };
  $("#gr-save").onclick = async () => {
    const allowAll = $("#gr-all").checked;
    const ids = allowAll ? [] : [...$("#gr-list").querySelectorAll("input:checked")].map((i) => i.dataset.gid);
    await db.collection(COL.systems).doc(sys.id).update({ allowAll, grantIds: ids });
    const names = emps.filter((e) => ids.includes(e.id)).map((e) => e.name).join(", ");
    toast("권한을 저장했습니다. 해당 직원의 홈에 반영됩니다.");
    closeModal();
    renderSystems();
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
      <div class="field"><span class="field-label">버튼 테두리 색상</span>
        ${colorPickerHtml(btn?.color || BTN_COLORS[0].hex)}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="mb-cancel">취소</button>
        <button type="submit" class="btn btn-primary">저장</button>
      </div>
    </form>`);
  $("#mb-cancel").onclick = closeModal;
  $("#mybtn-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = { label: $("#mb-label").value.trim(), url: $("#mb-url").value.trim(), desc: $("#mb-desc").value.trim(), color: pickedColor() || BTN_COLORS[0].hex };
    if (btn) items[idx] = data; else items.push(data);
    await db.collection(COL.personalButtons).doc(me.id).set({ items }, { merge: true });
    closeModal();
    renderHome();
  };
}

/* ───────── 급여 데이터 공통 ─────────
   레코드 구조: { empId, name, category, payDate, payments:[{label,amount}], deductions:[{label,amount}], note }
   과거(고정 필드) 데이터도 normalizePayRow 로 동일 구조로 변환해 표시한다. */

const PAY_TEMPLATE = [["기본급", 2300000], ["식대", 200000], ["성과금", 0], ["상여금", 0], ["추가수당", 0]];
const DEDUCT_TEMPLATE_4 = [["국민연금", 109250], ["건강보험", 82680], ["장기요양보험", 10860], ["고용보험", 20700], ["소득세", 41630], ["지방세", 4160]];
const DEDUCT_TEMPLATE_33 = [["소득세", 0], ["지방세", 0]];

function empTypeShort(t) {
  if (!t) return "-";
  if (t.includes("3.3")) return "3.3%";
  if (t.includes("보험")) return "4대보험";
  return t;
}
function tenureYM(joinDate) {
  if (!joinDate) return "";
  const st = dateParts(joinDate), now = dateParts(todayKST());
  let months = (now.y - st.y) * 12 + (now.m - st.m);
  if (now.d < st.d) months--;
  if (months < 0) return "";
  const y = Math.floor(months / 12), m = months % 12;
  return y ? (m ? `${y}년 ${m}개월` : `${y}년`) : `${m}개월`;
}
function workDaysLabel(joinDate) {
  if (!joinDate) return "";
  const days = Math.round((new Date(todayKST() + "T00:00:00Z") - new Date(joinDate + "T00:00:00Z")) / 86400000) + 1;
  return days > 0 ? ` (총 ${fmt(days)}일 근무)` : "";
}

function gradeN(e) { return e.grade ? Number(String(e.grade).replace(/[^0-9]/g, "")) : -1; }
function sortByGrade(emps) {
  return emps.slice().sort((a, b) =>
    gradeN(b) - gradeN(a) ||
    DEPTS.indexOf(a.dept) - DEPTS.indexOf(b.dept) ||
    (a.joinDate || "9999").localeCompare(b.joinDate || "9999") ||
    a.name.localeCompare(b.name, "ko"));
}

function catForEmp(emp) {
  const t = (emp?.empType || "");
  if (t.includes("3.3")) return "3.3%";
  return "4대보험";
}

function normalizePayRow(r) {
  let payments = r.payments, deductions = r.deductions;
  if (!payments) {
    // 구버전 고정 필드 → 항목 리스트 변환
    payments = [];
    const legacyPay = [["기본급", r.gross], ["직책수당", r.allowance], ["식대", r.meal], ["성과금", r.bonus], ["추가수당", r.extra]];
    legacyPay.forEach(([label, v]) => { if (Number(v)) payments.push({ label, amount: Number(v) }); });
    deductions = [];
    const legacyDeduct = [["국민연금", r.pension], ["건강보험", r.health], ["장기요양보험", r.longcare], ["고용보험", r.employment], ["소득세", r.incomeTax], ["지방세", r.localTax], ["기타 공제", r.otherDeduct]];
    legacyDeduct.forEach(([label, v]) => { if (Number(v)) deductions.push({ label, amount: Number(v) }); });
    if (!deductions.length && Number(r.net)) {
      const payT = payments.reduce((s, p) => s + p.amount, 0);
      if (payT - Number(r.net) > 0) deductions.push({ label: "공제 합계", amount: payT - Number(r.net) });
    }
  }
  payments = (payments || []).map((p) => ({ label: p.label, amount: Number(p.amount) || 0 }));
  deductions = (deductions || []).map((p) => ({ label: p.label, amount: Number(p.amount) || 0 }));
  const payTotal = payments.reduce((s, p) => s + p.amount, 0);
  const deductTotal = deductions.reduce((s, p) => s + p.amount, 0);
  return {
    id: r.id, empId: r.empId || null, name: r.name || "", category: r.category === "사대보험" ? "4대보험" : (r.category || ""),
    payDate: r.payDate || "", note: r.note || "",
    payments, deductions, payTotal, deductTotal, net: payTotal - deductTotal
  };
}

async function loadPayRecordsForYear(year, filterFn) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const snaps = await Promise.all(months.map((ym) =>
    db.collection(COL.payroll).doc(ym).collection("rows").get().then((s) => ({ ym, docs: s.docs }))));
  const records = [];
  snaps.forEach(({ ym, docs }) => {
    docs.forEach((d) => {
      const raw = { id: d.id, ...d.data() };
      if (filterFn && !filterFn(raw)) return;
      records.push({ ym, ...normalizePayRow(raw) });
    });
  });
  records.sort((a, b) => b.ym.localeCompare(a.ym) || (b.payDate || "").localeCompare(a.payDate || ""));
  return records;
}


/* 급여 항목 호버 팝업 */
function payPopHtml(r, kind) {
  const items = kind === "pay" ? r.payments : r.deductions;
  const cls = kind === "pay" ? "c-green" : "c-red";
  const title = kind === "pay" ? "지급 상세 내역" : "공제 상세 내역";
  const amountLabel = kind === "pay" ? "지급액" : "공제액";
  const total = kind === "pay" ? r.payTotal : r.deductTotal;
  return `<div class="hp-title"><span>${title}</span><span>${amountLabel}</span></div>
    ${items.length ? items.map((p) => `<div class="hp-line"><span>${esc(p.label)}</span><b class="${cls}">${fmt(p.amount)}원</b></div>`).join("")
      : '<div class="hp-line"><span>등록된 항목 없음</span></div>'}
    <div class="hp-line hp-total"><span>${kind === "pay" ? "지급액 계" : "공제액 계"}</span><b class="${cls}">${fmt(total)}원</b></div>`;
}
function attachPayHover(container, records) {
  let pop = document.getElementById("paypop");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "paypop";
    pop.className = "pay-pop";
    document.body.appendChild(pop);
  }
  container.querySelectorAll("[data-hv]").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      const r = records.find((x) => x.id === el.dataset.hv && x.ym === el.dataset.ym);
      if (!r) return;
      pop.innerHTML = payPopHtml(r, el.dataset.kind);
      pop.classList.add("show");
      const rect = el.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, rect.left + rect.width / 2 - pop.offsetWidth / 2)) + "px";
      const top = rect.top - pop.offsetHeight - 10;
      pop.style.top = (top > 8 ? top : rect.bottom + 10) + "px";
    });
    el.addEventListener("mouseleave", () => pop.classList.remove("show"));
  });
}

/* ───────── 급여이력 (본인 급여 조회) ───────── */
let phOpenIds = new Set();

async function renderPayHistory() {
  const main = $("#main");
  main.innerHTML = pageHead("MY PAY", "급여", "내 급여 지급 내역입니다.") +
    `<div id="ph-body"><div class="empty">불러오는 중...</div></div>`;

  const thisYear = kstNow().getUTCFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2];

  const renderYear = async (year) => {
    $("#ph-table").innerHTML = `<div class="empty">불러오는 중...</div>`;
    const records = await loadPayRecordsForYear(year, (r) => r.empId === me.id || r.name === me.name);
    const sumNet = records.reduce((s, r) => s + r.net, 0);
    const sumPay = records.reduce((s, r) => s + r.payTotal, 0);
    const sumDeduct = records.reduce((s, r) => s + r.deductTotal, 0);

    $("#ph-table").innerHTML = records.length ? `
      <div class="pb-stats">
        <div><span>실수령 합계</span><b class="c-green">${fmt(sumNet)}원</b></div>
        <div><span>총 지급</span><b>${fmt(sumPay)}원</b></div>
        <div><span>총 공제</span><b class="c-red">${fmt(sumDeduct)}원</b></div>
      </div>
      <div class="table-wrap"><table class="data pay-table">
        <thead><tr><th>월</th><th>지급일</th><th class="num">총 지급</th><th class="num">총 공제</th><th class="num">실수령</th><th>메모</th><th></th></tr></thead>
        <tbody>${records.map((r) => `<tr class="ph-click ${phOpenIds.has(r.id) ? "ph-row-open" : ""}" data-rowtoggle="${r.id}">
          <td><b>${r.ym}</b></td>
          <td>${esc(r.payDate || "-")}</td>
          <td class="num"><span class="hov c-green" data-hv="${r.id}" data-ym="${r.ym}" data-kind="pay">${fmt(r.payTotal)}원</span></td>
          <td class="num"><span class="hov c-red" data-hv="${r.id}" data-ym="${r.ym}" data-kind="deduct">${fmt(r.deductTotal)}원</span></td>
          <td class="num"><b class="c-green">${fmt(r.net)}원</b></td>
          <td class="memo">${esc(r.note || "—")}</td>
          <td><button class="btn btn-ghost btn-sm ${phOpenIds.has(r.id) ? "on" : ""}" data-ph-toggle="${r.id}">상세보기 ${phOpenIds.has(r.id) ? "⌃" : "›"}</button></td>
        </tr>${phOpenIds.has(r.id) ? `<tr class="ph-detail-tr"><td colspan="7">${renderPayDetailPanel(r)}</td></tr>` : ""}`).join("")}</tbody>
      </table></div>`
      : `<div class="empty">${year}년 급여 내역이 없습니다.</div>`;

    const togglePh = (id) => {
      if (phOpenIds.has(id)) phOpenIds.delete(id); else phOpenIds.add(id);
      renderYear(year);
    };
    $("#ph-table").querySelectorAll("[data-ph-toggle]").forEach((b) => {
      b.onclick = (ev) => { ev.stopPropagation(); togglePh(b.dataset.phToggle); };
    });
    $("#ph-table").querySelectorAll("[data-rowtoggle]").forEach((tr) => {
      tr.onclick = (ev) => {
        if (ev.target.closest("button") || ev.target.closest(".hov") || ev.target.closest("a")) return;
        togglePh(tr.dataset.rowtoggle);
      };
    });
    attachPayHover($("#ph-table"), records);
    const dl = $("#ph-download");
    if (dl) dl.onclick = () => downloadPayCsv(year, records);
  };

  $("#ph-body").innerHTML = `
    <div class="card">
      <div class="card-title">
        <div>급여 이력 조회<div class="ct-desc">급여 내역을 확인하세요. 정기 급여일은 매월 10일 · 15일입니다.</div></div>
        <span style="display:flex;gap:8px">
          <select id="ph-year">${years.map((y) => `<option value="${y}">${y}년</option>`).join("")}</select>
          <button class="btn btn-ghost btn-sm" id="ph-download"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg> 엑셀 다운로드</button>
        </span>
      </div>
      <div id="ph-table"></div>
      <div class="mini-note">급여 명세서 원본은 경영지원본부에 요청하세요.</div>
    </div>`;

  $("#ph-year").onchange = (ev) => { phOpenIds.clear(); renderYear(Number(ev.target.value)); };
  renderYear(thisYear);
}

function renderPayDetailPanel(r) {
  const line = (p, cls) => `<div class="ps-line"><span>${esc(p.label)}</span><b class="${cls}">${fmt(p.amount)}원</b></div>`;
  return `
    <div class="ph-detail ph-anim">
      <div class="ph-detail-head">${r.ym} 급여 내역 ${r.payDate ? `<span class="ph-date">지급일 ${esc(r.payDate)}</span>` : ""}
        <button class="btn btn-ghost btn-sm" data-ph-toggle="${r.id}">상세 내역 닫기 ⌃</button></div>
      <div class="ph-detail-grid">
        <div class="ph-col pb-pay"><div class="ph-col-title c-green">지급 내역</div>
          ${r.payments.map((p) => line(p, "c-green")).join("") || '<div class="ps-line"><span>등록된 항목 없음</span></div>'}
          <div class="ps-line strong"><span>지급액 계</span><b class="c-green">${fmt(r.payTotal)}원</b></div></div>
        <div class="ph-col pb-deduct"><div class="ph-col-title c-red">공제 내역</div>
          ${r.deductions.map((p) => line(p, "c-red")).join("") || '<div class="ps-line"><span>등록된 항목 없음</span></div>'}
          <div class="ps-line strong"><span>공제액 계</span><b class="c-red">${fmt(r.deductTotal)}원</b></div></div>
        <div class="ph-col ph-col-net">
          <div class="ph-col-title">이번 달 실수령</div>
          <div class="ph-net-amt">${fmt(r.net)}<span>원</span></div>
          <ul class="p-meta" style="margin-top:14px">
            ${r.payDate ? `<li><b>지급일</b> ${esc(r.payDate)}</li>` : ""}
            ${r.note ? `<li><b>메모</b> ${esc(r.note)}</li>` : ""}
          </ul>
        </div>
      </div>
    </div>`;
}

function downloadPayCsv(year, records) {
  const header = ["월", "지급일", "총 지급", "총 공제", "실수령", "메모"];
  const rows = records.map((r) => [r.ym, r.payDate || "", r.payTotal, r.deductTotal, r.net, r.note || ""]);
  const csv = "﻿" + [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${me.name}_${year}년_급여이력.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ───────── 급여관리 (경영지원본부 전용) — 직원별 급여장부 ───────── */
let pmEmpId = null;      // 선택된 직원 id, "" = 전체 직원 종합, null = 미정(첫 직원)
let pmEditId = null;     // 수정 중인 레코드 { ym, id }
let pmEditYm = null;
let pmYear = null;
let pmMonth = 0;         // 0 = 전체 월
let pmDept = "";         // "" = 전체 소속
let pmEmps = [];

function ymNow() { return ymNowKST(); }

async function renderPayroll() {
  if (!canManageOps()) return navigate("payhistory", null, true);
  if (!pmYear) pmYear = kstNow().getUTCFullYear();
  const main = $("#main");
  main.innerHTML = pageHead("ADMIN", "급여관리",
    "직원을 선택해 월별 급여를 기록하거나, 전체 직원 기록을 종합 조회합니다. 정기 급여일은 매월 10일 · 15일입니다.") +
    `<div id="pm-body"><div class="empty">불러오는 중...</div></div>`;

  const empSnap = await db.collection(COL.employees).where("status", "==", "재직").get();
  const emps = sortByGrade(empSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  pmEmps = emps;
  if (!emps.length) {
    $("#pm-body").innerHTML = `<div class="empty">재직 직원이 없습니다. [직원 관리]에서 먼저 직원을 등록하세요.</div>`;
    return;
  }
  if (pmEmpId && !emps.some((e) => e.id === pmEmpId)) pmEmpId = "";
  if (pmEmpId === null) pmEmpId = ""; // 최초 진입: 전체 직원 종합 조회
  const emp = pmEmpId ? emps.find((e) => e.id === pmEmpId) : null;

  $("#pm-body").innerHTML = `
    <div class="card" style="padding:16px 20px">
      <div class="pm-emp-bar">
        <label class="field" style="margin:0;min-width:230px"><span class="field-label">직원 선택</span>
          <select id="pm-emp">
            <option value="" ${!pmEmpId ? "selected" : ""}>전체 직원 (종합 조회)</option>
            ${emps.map((e) =>
              `<option value="${e.id}" ${e.id === pmEmpId ? "selected" : ""}>${esc(e.name)} (${esc(e.dept)}${e.grade ? " · " + esc(e.grade) : ""})</option>`).join("")}
          </select></label>
        <div class="pm-emp-info">
          ${emp ? `
            <span class="badge dept">${esc(emp.dept)}</span>
            <span class="badge">${catForEmp(emp)}</span>
            ${emp.grade ? `<span class="badge">${esc(emp.grade)}</span>` : ""}
            ${emp.position ? `<span class="badge">${esc(emp.position)}</span>` : ""}`
            : `<span class="badge admin">전체 직원 종합</span>`}
        </div>
        ${emp ? `<div class="pm-copy">
          <span class="pm-copy-item"><span id="pm-copytitle">${esc(emp.name)} ${kstNow().getUTCMonth() + 1}월 급여명세서_작은따옴표</span>
            <button type="button" class="copy-btn" data-copy="pm-copytitle" title="복사">copy</button></span>
          ${emp.email ? `<span class="pm-copy-item">email : <span id="pm-copymail">${esc(emp.email)}</span>
            <button type="button" class="copy-btn" data-copy="pm-copymail" title="복사">copy</button></span>` : ""}
        </div>` : ""}
      </div>
    </div>
    ${emp ? `
    <div class="pm-grid">
      <div class="card" id="pm-form-card"></div>
      <div class="card" id="pm-history-card"></div>
    </div>` : `
    <div class="card" id="pm-history-card"></div>`}`;

  $("#pm-emp").onchange = (ev) => {
    pmEmpId = ev.target.value; // "" = 전체
    pmEditId = null;
    pmEditYm = null;
    renderPayroll();
  };
  $("#pm-body").querySelectorAll(".copy-btn").forEach((b) => {
    b.onclick = async () => {
      const text = document.getElementById(b.dataset.copy).textContent.trim();
      try {
        await navigator.clipboard.writeText(text);
        toast(`복사했습니다: ${text}`);
      } catch (e) {
        toast("복사에 실패했습니다. 브라우저 권한을 확인하세요.");
      }
    };
  });

  if (emp) {
    // 수정 대기 상태면 해당 레코드를 불러와 폼에 채운다
    if (pmEditId && pmEditYm) {
      const snap = await db.collection(COL.payroll).doc(pmEditYm).collection("rows").doc(pmEditId).get();
      if (snap.exists) {
        renderPayForm(emp, catForEmp(emp), { ym: pmEditYm, ...normalizePayRow({ id: snap.id, ...snap.data() }) });
      } else {
        pmEditId = null; pmEditYm = null;
        renderPayForm(emp, catForEmp(emp), null);
      }
    } else {
      renderPayForm(emp, catForEmp(emp), null);
    }
  }
  renderPayHistoryAdmin(emp);
}

function payItemRowHtml(kind, label, amount) {
  return `<div class="pi-row" data-kind="${kind}">
    <input class="pi-label" value="${esc(label)}" placeholder="항목명" />
    <input class="pi-amount" type="text" inputmode="numeric" value="${fmt(Number(amount) || 0)}" />
    <button type="button" class="pi-del" title="항목 제거">×</button>
  </div>`;
}
function parseAmount(v) { return Number(String(v).replace(/[^0-9]/g, "")) || 0; }

/* ── 한글 캘린더 팝업 ── */
const CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

function closeCalPops() {
  document.querySelectorAll(".cal-pop").forEach((e) => e.remove());
}
function calPopBase(anchor) {
  closeCalPops();
  const pop = document.createElement("div");
  pop.className = "cal-pop";
  document.body.appendChild(pop);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + "px";
    pop.style.top = (r.bottom + 6 + pop.offsetHeight > window.innerHeight && r.top - pop.offsetHeight - 6 > 8
      ? r.top - pop.offsetHeight - 6 : r.bottom + 6) + "px";
  };
  const close = (ev) => {
    if (!pop.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
      pop.remove();
      document.removeEventListener("mousedown", close);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", close), 0);
  return { pop, place };
}

// 급여월 선택: 연도 이동 + 12개월 그리드
function openMonthPicker(anchor, ym, onPick) {
  const { pop, place } = calPopBase(anchor);
  let year = Number((ym || ymNow()).slice(0, 4));
  const selYm = ym || "";
  const render = () => {
    const years = [];
    for (let y = year - 3; y <= year + 3; y++) years.push(y);
    pop.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1">&lsaquo;</button>
        <select class="cal-ysel">${years.map((y) => `<option value="${y}" ${y === year ? "selected" : ""}>${y}년</option>`).join("")}</select>
        <button type="button" class="cal-nav" data-nav="1">&rsaquo;</button>
      </div>
      <div class="cal-mgrid">
        ${Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const v = `${year}-${String(m).padStart(2, "0")}`;
          return `<button type="button" class="cal-m ${v === selYm ? "on" : ""}" data-m="${v}">${m}월</button>`;
        }).join("")}
      </div>
      <div class="cal-foot">
        <button type="button" class="cal-link" data-act="clear">지우기</button>
        <button type="button" class="cal-link primary" data-act="now">이번 달</button>
      </div>`;
    pop.querySelectorAll(".cal-nav").forEach((b) => { b.onclick = () => { year += Number(b.dataset.nav); render(); }; });
    pop.querySelector(".cal-ysel").onchange = (ev) => { year = Number(ev.target.value); render(); };
    pop.querySelectorAll(".cal-m").forEach((b) => {
      b.onclick = () => { onPick(b.dataset.m); pop.remove(); };
    });
    pop.querySelector('[data-act="clear"]').onclick = () => { onPick(""); pop.remove(); };
    pop.querySelector('[data-act="now"]').onclick = () => { onPick(ymNow()); pop.remove(); };
    place();
  };
  render();
}

/* 공용 날짜 필드: 네이티브 date 입력 대신 한글 달력 버튼 (iOS 폭 깨짐·영문 표기 회피) */
const calField = (id, value) => `<button type="button" class="cal-input" id="${id}" data-val="${esc(value || "")}">
  <span id="${id}-label">${value ? esc(value) : '<span class="cal-ph">날짜 선택</span>'}</span>${CAL_ICON}</button>`;
function bindCalField(id, onChange, getOpts) {
  const btn = $("#" + id);
  btn.onclick = () => openDatePicker(btn, btn.dataset.val || "", (v) => {
    btn.dataset.val = v || "";
    $(`#${id}-label`).innerHTML = v ? esc(v) : '<span class="cal-ph">날짜 선택</span>';
    if (onChange) onChange(v || "");
  }, getOpts ? getOpts() : null);
}
const calVal = (id) => $("#" + id).dataset.val || "";
const calSet = (id, v) => {
  $("#" + id).dataset.val = v || "";
  $(`#${id}-label`).innerHTML = v ? esc(v) : '<span class="cal-ph">날짜 선택</span>';
};

// 지급일 선택: 연/월 셀렉트 + 일 그리드
function openDatePicker(anchor, dateStr, onPick, opts) {
  const { pop, place } = calPopBase(anchor);
  const min = (opts && opts.min) || "";
  const max = (opts && opts.max) || "";
  const inRange = (v) => (!min || v >= min) && (!max || v <= max);
  const clamp = (v) => (min && v < min ? min : (max && v > max ? max : v));
  const base = clamp(dateStr || todayKST());
  let year = Number(base.slice(0, 4));
  let month = Number(base.slice(5, 7));
  const sel = dateStr || "";
  const render = () => {
    const years = [];
    for (let y = year - 70; y <= year + 5; y++) years.push(y);
    const first = new Date(year, month - 1, 1);
    const startDow = first.getDay();
    const daysIn = new Date(year, month, 0).getDate();
    const prevDays = new Date(year, month - 1, 0).getDate();
    const cells = [];
    for (let i = startDow - 1; i >= 0; i--) cells.push({ d: prevDays - i, out: true });
    for (let d = 1; d <= daysIn; d++) cells.push({ d, out: false });
    while (cells.length % 7 !== 0) cells.push({ d: cells.length - startDow - daysIn + 1, out: true });
    pop.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1">&lsaquo;</button>
        <select class="cal-ysel">${years.map((y) => `<option value="${y}" ${y === year ? "selected" : ""}>${y}년</option>`).join("")}</select>
        <select class="cal-msel">${Array.from({ length: 12 }, (_, i) => i + 1).map((m) =>
          `<option value="${m}" ${m === month ? "selected" : ""}>${m}월</option>`).join("")}</select>
        <button type="button" class="cal-nav" data-nav="1">&rsaquo;</button>
      </div>
      <div class="cal-dow">${["일", "월", "화", "수", "목", "금", "토"].map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="cal-dgrid">
        ${cells.map((c) => {
          const v = c.out ? "" : `${year}-${String(month).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;
          const ok = v && inRange(v);
          // 범위 밖(상위 마감일 이후 등)은 'blocked' 로 흐리게 + 취소선 — 선택 불가가 한눈에 보이도록
          return `<button type="button" class="cal-d ${c.out ? "out" : ""} ${v && !ok ? "blocked" : ""} ${v && v === sel ? "on" : ""}" ${ok ? `data-d="${v}"` : "disabled"} ${v && !ok ? 'title="선택할 수 없는 날짜입니다"' : ""}>${c.d}</button>`;
        }).join("")}
      </div>
      <div class="cal-foot">
        <button type="button" class="cal-link" data-act="clear">지우기</button>
        <button type="button" class="cal-link primary" data-act="today" ${inRange(todayKST()) ? "" : "disabled"}>오늘</button>
      </div>`;
    const shift = (n) => { month += n; if (month < 1) { month = 12; year--; } if (month > 12) { month = 1; year++; } render(); };
    pop.querySelectorAll(".cal-nav").forEach((b) => { b.onclick = () => shift(Number(b.dataset.nav)); });
    pop.querySelector(".cal-ysel").onchange = (ev) => { year = Number(ev.target.value); render(); };
    pop.querySelector(".cal-msel").onchange = (ev) => { month = Number(ev.target.value); render(); };
    pop.querySelectorAll(".cal-d[data-d]").forEach((b) => {
      b.onclick = () => { onPick(b.dataset.d); pop.remove(); };
    });
    pop.querySelector('[data-act="clear"]').onclick = () => { onPick(""); pop.remove(); };
    pop.querySelector('[data-act="today"]').onclick = () => { if (inRange(todayKST())) { onPick(todayKST()); pop.remove(); } };
    place();
  };
  render();
}

function renderPayForm(emp, cat, record) {
  const isEdit = !!record;
  const payItems = isEdit ? record.payments.map((p) => [p.label, p.amount])
    : PAY_TEMPLATE.map(([l, a]) => [l, a]);
  const deductItems = isEdit ? record.deductions.map((p) => [p.label, p.amount])
    : (cat === "3.3%" ? DEDUCT_TEMPLATE_33 : DEDUCT_TEMPLATE_4).map(([l, a]) => [l, a]);

  let selYm = isEdit ? pmEditYm : ymNow();
  let selDate = record?.payDate || "";

  $("#pm-form-card").innerHTML = `
    <div class="card-title">
      <div><span class="pb-eyebrow">${isEdit ? "기록 수정 중" : "새 기록"}</span>월별 기록</div>
      <span style="display:flex;gap:6px">
        ${isEdit ? `<button class="btn btn-ghost btn-sm" id="pm-cancel-edit">새 기록</button>` : ""}
        <button class="btn btn-primary btn-sm" id="pm-save"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg> 저장</button>
      </span>
    </div>
    <label class="field"><span class="field-label">급여월</span>
      <button type="button" class="cal-input" id="pm-ym-btn"><span id="pm-ym-label"></span>${CAL_ICON}</button></label>
    <label class="field"><span class="field-label">지급일</span>
      <div class="pm-date-row">
        <button type="button" class="cal-input" id="pm-d-btn"><span id="pm-d-label"></span>${CAL_ICON}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-payday="10">10일</button>
        <button type="button" class="btn btn-ghost btn-sm" data-payday="15">15일</button>
      </div></label>

    <div class="pb-section pb-pay-head"><span>지급 내역</span><button type="button" class="btn btn-ghost btn-sm" id="pm-add-pay">+ 항목 추가</button></div>
    <div id="pm-pay-items">${payItems.map(([l, a]) => payItemRowHtml("pay", l, a)).join("")}</div>
    <div class="pb-total pb-total-pay"><span>총 지급</span><b id="pm-pay-total"></b></div>

    <div class="pb-section pb-deduct-head"><span>공제 내역</span><button type="button" class="btn btn-ghost btn-sm" id="pm-add-deduct">+ 항목 추가</button></div>
    <div id="pm-deduct-items">${deductItems.map(([l, a]) => payItemRowHtml("deduct", l, a)).join("")}</div>
    <div class="pb-total pb-total-deduct"><span>총 공제</span><b id="pm-deduct-total"></b></div>

    <div class="pb-net"><span>이번 달 실수령</span><b id="pm-net"></b></div>
    <label class="field" style="margin-top:14px"><span class="field-label">메모</span><textarea id="pm-note" class="pm-note" rows="3" placeholder="예: 식대 포함, 연말정산 반영">${esc(record?.note || "")}</textarea></label>`;

  const syncDates = () => {
    $("#pm-ym-label").textContent = selYm ? `${selYm.slice(0, 4)}년 ${Number(selYm.slice(5, 7))}월` : "급여월 선택";
    $("#pm-d-label").textContent = selDate ? selDate.replace(/-/g, "/") : "미지정";
    const ct = document.getElementById("pm-copytitle");
    if (ct && selYm) ct.textContent = `${emp.name} ${Number(selYm.slice(5, 7))}월 급여명세서_작은따옴표`;
  };
  syncDates();

  $("#pm-ym-btn").onclick = () => openMonthPicker($("#pm-ym-btn"), selYm, (v) => { selYm = v; syncDates(); });
  $("#pm-d-btn").onclick = () => openDatePicker($("#pm-d-btn"), selDate || (selYm ? `${selYm}-10` : ""), (v) => { selDate = v; syncDates(); });
  $("#pm-form-card").querySelectorAll("[data-payday]").forEach((b) => {
    b.onclick = () => {
      const base = selYm || ymNow();
      selDate = `${base}-${String(b.dataset.payday).padStart(2, "0")}`;
      syncDates();
    };
  });

  const recalc = () => {
    const sumOf = (sel) => [...$("#pm-form-card").querySelectorAll(`${sel} .pi-amount`)]
      .reduce((s, i) => s + parseAmount(i.value), 0);
    const p = sumOf("#pm-pay-items"), d = sumOf("#pm-deduct-items");
    $("#pm-pay-total").textContent = fmt(p) + "원";
    $("#pm-deduct-total").textContent = fmt(d) + "원";
    $("#pm-net").textContent = fmt(p - d) + "원";
  };
  const wireRow = (row) => {
    const amt = row.querySelector(".pi-amount");
    amt.oninput = () => {
      const n = parseAmount(amt.value);
      amt.value = n ? fmt(n) : (amt.value.trim() === "" ? "" : "0");
      recalc();
    };
    amt.onblur = () => { amt.value = fmt(parseAmount(amt.value)); };
    row.querySelector(".pi-del").onclick = () => { row.remove(); recalc(); };
  };
  $("#pm-form-card").querySelectorAll(".pi-row").forEach(wireRow);
  recalc();

  const addItem = (containerSel, kind) => {
    const div = document.createElement("div");
    div.innerHTML = payItemRowHtml(kind, "", 0);
    const row = div.firstElementChild;
    $(containerSel).appendChild(row);
    wireRow(row);
    row.querySelector(".pi-label").focus();
  };
  $("#pm-add-pay").onclick = () => addItem("#pm-pay-items", "pay");
  $("#pm-add-deduct").onclick = () => addItem("#pm-deduct-items", "deduct");

  if (isEdit) $("#pm-cancel-edit").onclick = () => { pmEditId = null; pmEditYm = null; renderPayForm(emp, cat, null); };

  $("#pm-save").onclick = async () => {
    if (!selYm) { toast("급여월을 선택하세요."); return; }
    const ym = selYm;
    const collect = (sel) => [...$("#pm-form-card").querySelectorAll(`${sel} .pi-row`)]
      .map((row) => ({ label: row.querySelector(".pi-label").value.trim(), amount: parseAmount(row.querySelector(".pi-amount").value) }))
      .filter((p) => p.label);
    const data = {
      empId: emp.id,
      name: emp.name,
      category: cat,
      payDate: selDate,
      payments: collect("#pm-pay-items"),
      deductions: collect("#pm-deduct-items"),
      note: $("#pm-note").value.trim()
    };
    if (!data.payments.length) { toast("지급 내역을 1개 이상 입력하세요."); return; }
    const col = (m) => db.collection(COL.payroll).doc(m).collection("rows");
    if (pmEditId) {
      if (ym === pmEditYm) {
        await col(ym).doc(pmEditId).update(data);
      } else {
        await col(pmEditYm).doc(pmEditId).delete();
        await col(ym).add(data);
      }
      toast("급여 기록을 수정했습니다.");
    } else {
      await col(ym).add(data);
      toast("급여 기록을 저장했습니다.");
    }
    pmEditId = null;
    pmEditYm = null;
    renderPayForm(emp, cat, null);
    renderPayHistoryAdmin(emp);
  };
}

async function renderPayHistoryAdmin(emp) {
  const card = $("#pm-history-card");
  const isAll = !emp;
  card.innerHTML = `
    <div class="card-title">
      <div><span class="pb-eyebrow">기록 조회</span>기록 목록${isAll ? " — 전체 직원" : ""}</div>
      <span style="display:flex;gap:8px">
        <select id="pm-year">${[0, 1, 2].map((i) => {
          const y = kstNow().getUTCFullYear() - i;
          return `<option value="${y}" ${y === pmYear ? "selected" : ""}>${y}년</option>`;
        }).join("")}</select>
        <select id="pm-month">
          <option value="0" ${!pmMonth ? "selected" : ""}>전체 월</option>
          ${Array.from({ length: 12 }, (_, i) => i + 1).map((m) =>
            `<option value="${m}" ${m === pmMonth ? "selected" : ""}>${m}월</option>`).join("")}
        </select>
        ${isAll ? `<select id="pm-dept">
          <option value="" ${!pmDept ? "selected" : ""}>전체 소속</option>
          ${DEPTS.map((d) => `<option value="${d}" ${d === pmDept ? "selected" : ""}>${d}</option>`).join("")}
        </select>` : ""}
      </span>
    </div>
    <div id="pm-history"><div class="empty">불러오는 중...</div></div>`;
  $("#pm-year").onchange = (ev) => { pmYear = Number(ev.target.value); renderPayHistoryAdmin(emp); };
  $("#pm-month").onchange = (ev) => { pmMonth = Number(ev.target.value); renderPayHistoryAdmin(emp); };
  const deptSel = $("#pm-dept");
  if (deptSel) deptSel.onchange = (ev) => { pmDept = ev.target.value; renderPayHistoryAdmin(emp); };

  const deptOf = (r) => (pmEmps.find((e) => e.id === r.empId) || {}).dept || "-";
  let records = await loadPayRecordsForYear(pmYear,
    emp ? ((r) => r.empId === emp.id || r.name === emp.name) : null);
  if (pmMonth) records = records.filter((r) => Number(r.ym.slice(5, 7)) === pmMonth);
  if (isAll && pmDept) records = records.filter((r) => deptOf(r) === pmDept);

  const sumNet = records.reduce((s, r) => s + r.net, 0);
  const sumPay = records.reduce((s, r) => s + r.payTotal, 0);
  const sumDeduct = records.reduce((s, r) => s + r.deductTotal, 0);
  const scope = `${pmYear}년${pmMonth ? " " + pmMonth + "월" : ""}${isAll && pmDept ? " · " + pmDept : ""}`;

  $("#pm-history").innerHTML = records.length ? `
    <div class="pb-stats">
      <div><span>실수령 합계</span><b class="c-green">${fmt(sumNet)}원</b></div>
      <div><span>총 지급</span><b>${fmt(sumPay)}원</b></div>
      <div><span>총 공제</span><b class="c-red">${fmt(sumDeduct)}원</b></div>
    </div>
    <div class="table-wrap"><table class="data pay-table">
      <thead><tr>${isAll ? "<th>소속</th><th>직원</th>" : ""}<th>월</th><th>지급일</th><th class="num">총 지급</th><th class="num">총 공제</th><th class="num">실수령</th><th>메모</th><th></th></tr></thead>
      <tbody>${records.map((r) => `<tr>
        ${isAll ? `<td>${esc(deptOf(r))}</td><td><b>${esc(r.name)}</b></td>` : ""}
        <td><b>${r.ym}</b></td>
        <td>${esc(r.payDate || "-")}</td>
        <td class="num"><span class="hov c-green" data-hv="${r.id}" data-ym="${r.ym}" data-kind="pay">${fmt(r.payTotal)}원</span></td>
        <td class="num"><span class="hov c-red" data-hv="${r.id}" data-ym="${r.ym}" data-kind="deduct">${fmt(r.deductTotal)}원</span></td>
        <td class="num"><b class="c-green">${fmt(r.net)}원</b></td>
        <td class="memo">${esc(r.note || "—")}</td>
        <td><button class="row-menu-btn" data-pm-menu="${r.id}" data-ym="${r.ym}" title="메뉴">&#8943;</button></td>
      </tr>`).join("")}</tbody>
    </table></div>`
    : `<div class="empty">${scope} 기록이 없습니다.${emp ? " 왼쪽에서 첫 기록을 저장하세요." : ""}</div>`;

  attachPayHover($("#pm-history"), records);
  $("#pm-history").querySelectorAll("[data-pm-menu]").forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const r = records.find((x) => x.id === b.dataset.pmMenu && x.ym === b.dataset.ym);
      const recEmp = emp || pmEmps.find((e) => e.id === r.empId) ||
        { name: r.name, dept: "-", grade: "", position: "", joinDate: "" };
      openRowMenu(b, [
        {
          label: "명세서 출력",
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
          onClick: () => printPayslip(recEmp, r)
        },
        {
          label: "수정",
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 0 1 4 4L8 20l-5 1 1-5L17 3Z"/></svg>',
          onClick: () => {
            pmEditId = r.id;
            pmEditYm = r.ym;
            if (!emp && r.empId) pmEmpId = r.empId; // 전체 보기에서 수정 → 해당 직원으로 전환
            renderPayroll();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        },
        {
          label: "삭제",
          cls: "danger",
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/><path d="M10 11v6M14 11v6"/></svg>',
          onClick: async () => {
            if (!confirm(`${r.name}님의 ${r.ym} (지급일 ${r.payDate || "-"}) 기록을 삭제할까요?`)) return;
            await db.collection(COL.payroll).doc(r.ym).collection("rows").doc(r.id).delete();
            if (pmEditId === r.id) { pmEditId = null; pmEditYm = null; }
            renderPayHistoryAdmin(emp);
          }
        }
      ]);
    };
  });
}

/* ── 행 드롭다운 메뉴 (⋯) ── */
function openRowMenu(anchor, items) {
  let menu = document.getElementById("rowmenu");
  if (menu) menu.remove();
  menu = document.createElement("div");
  menu.id = "rowmenu";
  menu.className = "row-menu";
  menu.innerHTML = items.map((it, i) =>
    `<button class="rm-item ${it.cls || ""}" data-rm="${i}">${it.icon}${it.label}</button>`).join("");
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.right - menu.offsetWidth));
  const top = rect.bottom + 6 + menu.offsetHeight > window.innerHeight
    ? rect.top - menu.offsetHeight - 6 : rect.bottom + 6;
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menu.querySelectorAll("[data-rm]").forEach((b) => {
    b.onclick = () => { menu.remove(); items[Number(b.dataset.rm)].onClick(); };
  });
  const close = (ev) => {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("click", close); }
  };
  setTimeout(() => document.addEventListener("click", close), 0);
}

/* ── 급여 지급명세서 출력 (법정 양식 · A4) ── */
function printPayslip(emp, r) {
  const [y, m] = r.ym.split("-").map(Number);
  const payDate = r.payDate ? r.payDate.slice(2).replace(/-/g, ". ") + "." : "—";
  const rowsN = Math.max(r.payments.length, r.deductions.length, 1);
  const bodyRows = Array.from({ length: rowsN }, (_, i) => {
    const p = r.payments[i], d = r.deductions[i];
    return `<tr>
      <td>${p ? esc(p.label) : ""}</td><td class="num">${p ? fmt(p.amount) + "원" : ""}</td>
      <td>${d ? esc(d.label) : ""}</td><td class="num">${d ? fmt(d.amount) + "원" : ""}</td>
    </tr>`;
  }).join("");
  const birth = emp.birthDate ? emp.birthDate.replace(/-/g, ".") : "—";

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8" />
<title>${y}년 ${m}월 급여 지급명세서 - ${esc(emp.name)}</title>
<style>
  @page { size: A4; margin: 15mm 13mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  /* 배경색은 브라우저가 기본적으로 인쇄하지 않는다. 이 설정이 있어야 화면에서 본
     회색 머리행·실수령액 강조가 인쇄물에도 그대로 나온다. */
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif; color: #26282c; font-size: 12px; line-height: 1.5; background: #eceef0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 210mm; max-width: 100%; margin: 0 auto; background: #fff; padding: 15mm 13mm; min-height: 297mm; }
  @media print { body { background: #fff; } .sheet { width: auto; min-height: auto; padding: 0; } .noprint { display: none; } }
  h1 { text-align: center; font-size: 20px; font-weight: 800; margin: 0 0 14px; letter-spacing: -0.02em; }
  .head-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
  .head-row b { font-size: 13px; }
  /* A4 한 장에 담기도록 행 높이·표 간격을 최소로 잡는다 (표가 페이지를 넘어 쪼개지지 않게 고정) */
  table { width: 100%; border-collapse: collapse; margin-bottom: 13px; table-layout: fixed; page-break-inside: avoid; break-inside: avoid; }
  th, td { border: 1px solid #26282c; padding: 5px 10px; font-size: 12px; word-break: break-all; }
  th { background: #f1f2f4; font-weight: 700; text-align: center; }
  td.label { background: #f1f2f4; font-weight: 700; text-align: center; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .center { text-align: center; }
  .sec-title { text-align: center; font-size: 13px; font-weight: 800; margin: 0 0 6px; }
  .total td { font-weight: 800; background: #f1f2f4; }
  .net td { font-weight: 800; background: #dfe5f5; font-size: 13px; }
  .footer { text-align: center; color: #6b7684; margin-top: 16px; font-size: 12px; }
  .noprint { text-align: center; padding: 14px 0; }
  .noprint button { padding: 10px 22px; font-size: 14px; border-radius: 8px; border: none; background: #3182f6; color: #fff; cursor: pointer; }
</style></head><body>
<div class="noprint"><button onclick="window.print()">인쇄 / PDF 저장</button></div>
<div class="sheet">
  <h1>${y}년 ${m}월 급여 지급명세서</h1>
  <div class="head-row"><b>작은따옴표</b><span>지급일: ${payDate}</span></div>
  <table>
    <colgroup><col style="width:18%"/><col style="width:32%"/><col style="width:18%"/><col style="width:32%"/></colgroup>
    <tr><td class="label">성명</td><td>${esc(emp.name)}</td><td class="label">생년월일</td><td>${birth}</td></tr>
    <tr><td class="label">부서</td><td>${esc(emp.dept)}</td><td class="label">직위(직급)</td><td>${esc(emp.grade || emp.position || "—")}</td></tr>
    <tr><td class="label">입사일</td><td>${esc(emp.joinDate || "—")}</td><td class="label">퇴사일</td><td>—</td></tr>
  </table>

  <div class="sec-title">세부 내역</div>
  <table>
    <colgroup><col style="width:25%"/><col style="width:25%"/><col style="width:25%"/><col style="width:25%"/></colgroup>
    <tr><th colspan="2">지 급</th><th colspan="2">공 제</th></tr>
    <tr><th>임금 항목</th><th>지급 금액</th><th>공제 항목</th><th>공제 금액</th></tr>
    ${bodyRows}
    <tr class="total"><td class="center">지급액 계</td><td class="num">${fmt(r.payTotal)}원</td><td class="center">공제액 계</td><td class="num">${fmt(r.deductTotal)}원</td></tr>
    <tr class="net"><td colspan="2" class="center">실수령액(원)</td><td colspan="2" class="num">${fmt(r.net)}원</td></tr>
  </table>

  <table>
    <colgroup><col style="width:25%"/><col style="width:25%"/><col style="width:25%"/><col style="width:25%"/></colgroup>
    <tr><th>기본근로시간수</th><th>야간근로시간수</th><th>휴일근로시간수</th><th>연장근로시간수</th></tr>
    <tr><td class="center">—</td><td class="center">—</td><td class="center">—</td><td class="center">—</td></tr>
  </table>

  <div class="sec-title">계산 방법</div>
  <table>
    <colgroup><col style="width:16%"/><col style="width:34%"/><col style="width:16%"/><col style="width:34%"/></colgroup>
    <tr><th>구분</th><th>산출식 또는 산출방법</th><th>구분</th><th>산출식 또는 산출방법</th></tr>
    <tr><td class="center">기본급</td><td>기본근로시간수 x 통상시급(주휴수당 포함)</td><td></td><td></td></tr>
    <tr><td class="center">야간근로수당</td><td>야간근로시간수 x 통상시급 x 0.5</td><td></td><td></td></tr>
    <tr><td class="center">연장근로수당</td><td>연장근로시간수 x 통상시급 x 1.5</td><td></td><td></td></tr>
    <tr><td class="center">휴일근로수당</td><td>휴일근로시간수 x 통상시급 x 1.5</td><td></td><td></td></tr>
  </table>

  <div class="footer">귀하의 노고에 감사드립니다.</div>
</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</` + `script>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) { toast("팝업이 차단되었습니다. 이 사이트의 팝업을 허용해주세요."); return; }
  win.document.write(html);
  win.document.close();
}

/* ───────── 연차/휴가 ───────── */
const LV_ICONS = {
  total: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  used: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><path d="m15.5 10 2 2 4-4"/></svg>',
  remain: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  pending: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>'
};
const LV_TYPE_TONES = { "연차": ["dot-blue", ""], "반차": ["dot-amber", "gold"], "병가": ["dot-red", "over"], "경조": ["dot-purple", "plum"], "기타": ["dot-green", "ok"] };

async function renderLeave() {
  const main = $("#main");
  main.innerHTML = pageHead("LEAVE", "휴가",
    "나의 연차 보유·사용 현황을 확인하고, 휴가를 신청할 수 있습니다.") +
    `<div id="lv-body"><div class="empty">불러오는 중...</div></div>`;

  const [mySnap, myReqSnap, emps] = await Promise.all([
    db.collection(COL.leaves).doc(me.id).get(),
    db.collection(COL.leaveRequests).where("empId", "==", me.id).get(),
    loadActiveEmployees()
  ]);
  let mine = mySnap.exists ? mySnap.data() : { allocated: 0, records: [] };
  mine = await maybeResetLeave(me.id, mine);
  const records = mine.records || [];
  const myReqs = myReqSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const used = records.reduce((s, r) => s + Number(r.days || 0), 0);
  const allocated = Number(mine.allocated) || 0;
  const remain = allocated - used;
  const pending = myReqs.filter((r) => r.status === "대기").length;
  const pct = allocated ? Math.min(100, Math.round((used / allocated) * 100)) : 0;

  const byType = LEAVE_TYPES.map((t) => ({
    t,
    days: records.filter((r) => r.type === t).reduce((s, r) => s + Number(r.days || 0), 0)
  }));
  const maxType = Math.max(1, ...byType.map((b) => b.days));

  const history = [
    ...records.map((r) => ({ ...r, status: "승인" })),
    ...myReqs.filter((r) => r.status !== "승인").map((r) => ({ id: r.id, empId: r.empId, date: r.date, endDate: r.endDate, type: r.type, days: r.days, status: r.status }))
  ].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);
  const statusBadge = (s) => s === "승인" ? '<span class="badge ok">승인</span>'
    : s === "대기" ? '<span class="badge warn">대기</span>' : '<span class="badge rej">반려</span>';

  const statCard = (ico, tone, label, value) => `
    <div class="lv-stat">
      <span class="lv-ico ${tone}">${ico}</span>
      <div><div class="s-label">${label}</div><div class="s-value">${value}</div></div>
    </div>`;

  $("#lv-body").innerHTML = `
    <div class="card">
      <div class="card-title"><div>나의 연차 현황<div class="ct-desc">총 연차 보유 및 사용 현황을 확인하세요.</div></div></div>
      <div class="lv-stats">
        ${statCard(LV_ICONS.total, "t-blue", "총 연차 일수", `${allocated}일`)}
        ${statCard(LV_ICONS.used, "t-green", "사용한 연차", `${used}일`)}
        ${statCard(LV_ICONS.remain, "t-purple", "남은 연차", `${remain}일`)}
        ${statCard(LV_ICONS.pending, "t-amber", "대기 중 신청", `${pending}건`)}
      </div>
      <div class="usage-line" style="margin:16px 0 0"><span>연차 사용률</span>
        <div class="bar ${remain < 0 ? "over" : ""}"><i style="width:${pct}%"></i></div>
        <b>${pct}%</b><span>(${used}일 / ${allocated}일)</span>
      </div>
      <div class="mini-note">${mine.grantDate
        ? `연차 발생일 ${esc(mine.grantDate)} · 다음 갱신 예정 ${esc(nextGrantDate(mine.grantDate))}`
        : "연차 발생일이 아직 설정되지 않았습니다. 경영지원본부에 문의하세요."}</div>
    </div>

    <div class="card">
      <div class="card-title"><div>휴가 신청<div class="ct-desc">신청하면 경영지원본부 승인 후 사용 내역에 반영됩니다.</div></div></div>
      <form id="lv-req-form" class="lv-req">
        <label class="field"><span class="field-label">휴가 유형</span>
          <select id="lr-type">${LEAVE_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></label>
        <label class="field"><span class="field-label">결재자</span>
          <select id="lr-approver">${approverOptionHtml(emps)}</select></label>
        <div class="field"><span class="field-label">시작일</span>
          <button type="button" class="cal-input" id="lr-start-btn"><span id="lr-start-label"></span>${CAL_ICON}</button></div>
        <div class="field"><span class="field-label">종료일</span>
          <button type="button" class="cal-input" id="lr-end-btn"><span id="lr-end-label"></span>${CAL_ICON}</button></div>
        <label class="field"><span class="field-label">일수 (0.5 단위)</span>
          <input id="lr-days" type="number" step="0.5" min="0.5" required value="1" /></label>
        <button type="submit" class="btn btn-primary" id="lr-submit">신청하기</button>
      </form>
    </div>

    <div class="widget-grid">
      <div class="card">
        <div class="card-title"><div>연차 유형별 사용 현황</div></div>
        <div class="type-bars">
          ${byType.map(({ t, days }) => `<div class="type-bar">
            <span><i class="dot ${LV_TYPE_TONES[t][0]}"></i>${t}</span>
            <div class="bar ${LV_TYPE_TONES[t][1]}"><i style="width:${Math.round((days / maxType) * 100)}%"></i></div>
            <span class="tb-num">${days}일</span>
          </div>`).join("")}
        </div>
        <div class="mini-note">할당 연차는 회사 정책에 따라 경영지원본부가 설정합니다.</div>
      </div>
      <div class="card">
        <div class="card-title"><div>연차 사용 내역 요약</div></div>
        ${history.length ? `<div class="table-wrap"><table class="data pay-table">
          <thead><tr><th>기간</th><th>유형</th><th class="num">일수</th><th>상태</th><th></th></tr></thead>
          <tbody>${history.map((r) => `<tr>
            <td>${fmtPeriod(r.date, r.endDate)}</td><td>${esc(r.type)}</td>
            <td class="num">${r.days}일</td><td>${statusBadge(r.status)}</td>
            <td class="num">${r.id ? reqCancelBtn(r) : ""}</td>
          </tr>`).join("")}</tbody></table></div>`
          : `<div class="empty">아직 사용 내역이 없습니다.</div>`}
      </div>
    </div>

    ${(mine.history || []).length ? `
    <div class="card">
      <div class="card-title"><div>지난 연차 기록<div class="ct-desc">갱신일이 지나 리셋된 이전 주기의 기록입니다.</div></div></div>
      <div class="table-wrap"><table class="data pay-table">
        <thead><tr><th>주기</th><th class="num">할당</th><th class="num">사용</th><th class="num">잔여(소멸)</th></tr></thead>
        <tbody>${mine.history.slice().reverse().map((h) => `<tr>
          <td>${fmtPeriod(h.start, h.end)}</td>
          <td class="num">${h.allocated}일</td>
          <td class="num">${h.used}일</td>
          <td class="num"><b class="${h.remaining > 0 ? "c-red" : ""}">${h.remaining}일</b></td>
        </tr>`).join("")}</tbody></table></div>
    </div>` : ""}
`;

  // 시작·종료일: 한글 달력 피커 (iOS 네이티브 date 입력의 폭 깨짐·영문 표기 회피)
  const todayStr = todayKST();
  let lrStart = todayStr, lrEnd = todayStr;
  const lrSync = () => {
    $("#lr-start-label").textContent = lrStart;
    $("#lr-end-label").textContent = lrEnd;
  };
  const lrAutoDays = () => {
    // 반차는 항상 0.5일 (종료일=시작일 고정)
    if ($("#lr-type").value === "반차") { $("#lr-days").value = 0.5; return; }
    if (!lrStart || !lrEnd || lrEnd < lrStart) return;
    $("#lr-days").value = Math.round((new Date(lrEnd + "T00:00:00Z") - new Date(lrStart + "T00:00:00Z")) / 86400000) + 1;
  };
  // 유형 변경 시: 반차면 0.5일 고정 + 종료일 잠금
  const lrSyncType = () => {
    const half = $("#lr-type").value === "반차";
    const endBtn = $("#lr-end-btn");
    const daysInput = $("#lr-days");
    endBtn.disabled = half;
    daysInput.readOnly = half;
    daysInput.classList.toggle("locked", half);
    if (half) { lrEnd = lrStart; lrSync(); }
    lrAutoDays();
  };
  $("#lr-type").onchange = lrSyncType;
  lrSync();
  lrSyncType();
  $("#lr-start-btn").onclick = () => openDatePicker($("#lr-start-btn"), lrStart, (v) => {
    if (!v) return;
    lrStart = v;
    if (lrEnd < lrStart || $("#lr-type").value === "반차") lrEnd = lrStart;
    lrSync(); lrAutoDays();
  });
  $("#lr-end-btn").onclick = () => openDatePicker($("#lr-end-btn"), lrEnd, (v) => {
    if (!v || $("#lr-type").value === "반차") return;
    lrEnd = v;
    if (lrEnd < lrStart) { toast("종료일이 시작일보다 빠릅니다."); lrEnd = lrStart; }
    lrSync(); lrAutoDays();
  });

  bindReqCancel($("#lv-body"), COL.leaveRequests, renderLeave);
  $("#lv-req-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const lrType = $("#lr-type").value;
    const isHalf = lrType === "반차";
    const start = lrStart, end = isHalf ? lrStart : lrEnd;
    if (end < start) { toast("종료일이 시작일보다 빠릅니다."); return; }
    const sb = $("#lr-submit");
    if (sb.disabled) return;
    const lrAppr = $("#lr-approver");
    if (!lrAppr.value) { toast("결재자를 선택하세요."); return; }
    sb.disabled = true;
    const data = {
      empId: me.id,
      name: me.name,
      dept: me.dept || "",
      date: start,
      endDate: end,
      days: isHalf ? 0.5 : Number($("#lr-days").value),
      type: lrType,
      approverId: lrAppr.value,                                    // 결재 라우팅은 직원 ID 기준
      approver: lrAppr.options[lrAppr.selectedIndex].text.replace(" (본인 승인)", ""),
      status: "대기",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
      await db.collection(COL.leaveRequests).add(data);
    } catch (e) {
      sb.disabled = false;   // 실패해도 버튼이 죽은 채 남지 않게
      toast("신청에 실패했습니다. 잠시 후 다시 시도하세요.");
      return;
    }
    toast(lrAppr.value === me.id
      ? "휴가를 등록했습니다. [연차관리]에서 본인이 승인하면 사용 내역에 반영됩니다."
      : "휴가를 신청했습니다. 승인되면 사용 내역에 반영됩니다.");
    updateLeaveAlarm();
    renderLeave();
  };
}

/* ───────── 일정 (전사 캘린더: 휴무/행사/기타 + 승인된 휴가 자동 표시) ───────── */
let scYm = null;   // 표시 중인 달 "YYYY-MM"
let scSel = null;  // 선택한 날짜 "YYYY-MM-DD"

async function renderSchedule() {
  const main = $("#main");
  const todayStr = todayKST();
  if (!scYm) scYm = todayStr.slice(0, 7);
  if (!scSel) scSel = todayStr;

  main.innerHTML = pageHead("SCHEDULE", "일정",
    "전사 공유 캘린더입니다. 휴무·행사를 등록하면 모두에게 표시되고, 승인된 휴가는 자동으로 표시됩니다.",
    `<button class="btn btn-primary btn-sm" id="sc-add">+ 일정 등록</button>`) +
    `<div id="sc-body"><div class="empty">불러오는 중...</div></div>`;
  await renderScheduleCalInto($("#sc-body"), renderSchedule, { showToday: true });
}

/* 일정 캘린더 본체 — 일정 탭과 연차관리 탭이 함께 쓴다.
   box 안에 그리고, 달 이동·날짜 선택·삭제 후에는 rerender() 로 화면을 다시 그린다.
   opts.pending: 결재 대기 중인 휴가 신청 목록 — 회색 '결재대기' 칩으로 함께 표시 (승인 판단용) */
async function renderScheduleCalInto(box, rerender, opts) {
  opts = opts || {};
  const todayStr = todayKST();
  if (!scYm) scYm = todayStr.slice(0, 7);
  if (!scSel) scSel = todayStr;
  const [scSnap, lvSnap, empSnap] = await Promise.all([
    db.collection(COL.schedules).get(),
    db.collection(COL.leaves).get(),
    db.collection(COL.employees).where("status", "==", "재직").get()
  ]);
  if (!box || !box.isConnected) return;   // 그 사이 다른 화면으로 이동함
  const empName = {};
  empSnap.docs.forEach((d) => { empName[d.id] = d.data().name; });

  const events = {}; // "YYYY-MM-DD" -> [{kind,label,docId,canDel}]
  const push = (date, ev) => { (events[date] = events[date] || []).push(ev); };

  // 승인된 휴가 (leaves.records) → 빨간색 "휴가" (총괄 관리자는 취소 가능)
  lvSnap.docs.forEach((d) => {
    const nm = empName[d.id];
    if (!nm) return;
    (d.data().records || []).forEach((r) => {
      if (!r.date) return;
      const lvKey = `${d.id}|${r.date}|${r.endDate || ""}|${r.type || ""}|${r.days || 0}`;
      const cur = new Date(r.date + "T00:00:00Z");
      const stop = new Date((r.endDate || r.date) + "T00:00:00Z");
      let guard = 0;
      while (cur <= stop && guard++ < 62) {
        push(cur.toISOString().slice(0, 10), { kind: "휴가", label: nm, lvKey, canDel: isAdmin() });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    });
  });

  // 등록 일정 (휴무=자주, 행사=그린, 기타=오렌지)
  const scDocs = scSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  scDocs.forEach((s) => {
    (s.dates || []).forEach((dt) => {
      push(dt, {
        kind: s.type,
        label: s.type === "휴무" ? (s.name || s.authorName || "?") : (s.title || "-"),
        docId: s.id,
        canDel: isAdmin() || s.authorId === me.id
      });
    });
  });

  // 결재 대기 중인 휴가 신청 (연차관리 탭) — 겹치는 일정을 보며 승인 여부를 판단할 수 있게
  (opts.pending || []).forEach((r) => {
    if (!r.date) return;
    const cur = new Date(r.date + "T00:00:00Z");
    const stop = new Date((r.endDate || r.date) + "T00:00:00Z");
    let guard = 0;
    while (cur <= stop && guard++ < 62) {
      push(cur.toISOString().slice(0, 10), { kind: "결재대기", label: `${r.name || "?"} ${r.type || ""}`.trim(), pend: true });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  });

  const kindOrder = [...(opts.pending ? ["결재대기"] : []), "행사", "휴가", "휴무", "기타"];
  const sortEvents = (list) => list.slice().sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind));
  const dot = (kind) => `<i class="sc-dot ${SC_KINDS[kind] || "orange"}"></i>`;

  // ── 오늘 요약 ──
  const todayLabel = dateLabelKo(todayStr);
  const todayEvents = sortEvents(events[todayStr] || []);
  const grouped = {};
  todayEvents.forEach((e) => { (grouped[e.kind] = grouped[e.kind] || []).push(e.label); });
  const summaryHtml = kindOrder.filter((k) => grouped[k]).map((k) =>
    `<div class="sc-sum-line">${dot(k)}<b>${k}</b><span>${grouped[k].map(esc).join(", ")}</span></div>`).join("");

  // ── 달력 ──
  const [yy, mm] = scYm.split("-").map(Number);
  const first = new Date(yy, mm - 1, 1);
  const startDow = first.getDay();
  const daysIn = new Date(yy, mm, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const cellHtml = (d, idx) => {
    if (!d) return `<div class="sc-cell blank"></div>`;
    const dateStr = `${yy}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const list = sortEvents(events[dateStr] || []);
    const dow = idx % 7;
    const chips = list.slice(0, 3).map((e) =>
      `<span class="sc-chip">${dot(e.kind)}<b>${esc(e.label)}</b></span>`).join("");
    const more = list.length > 3 ? `<span class="sc-more">+${list.length - 3}</span>` : "";
    const pend = list.some((e) => e.pend);
    return `<button type="button" class="sc-cell ${dateStr < todayStr ? "past" : ""} ${dateStr === todayStr ? "today" : ""} ${dateStr === scSel ? "sel" : ""} ${pend ? "pend" : ""}" data-scd="${dateStr}">
      <span class="d ${dow === 0 ? "sun" : dow === 6 ? "sat" : ""}">${d}</span>
      <span class="sc-chips">${chips}${more}</span>
    </button>`;
  };

  // ── 선택한 날 상세 ──
  const selLabel = dateLabelKo(scSel);
  const selEvents = sortEvents(events[scSel] || []);
  const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/><path d="M10 11v6M14 11v6"/></svg>';
  const dayHtml = selEvents.length ? selEvents.map((e) => `
    <div class="sc-day-row">
      ${dot(e.kind)}<b class="sc-day-kind">${e.kind}</b>
      <span class="sc-day-label">${esc(e.label)}</span>
      ${e.canDel && e.docId ? `<button class="icon-btn" data-scdel="${e.docId}" title="삭제">${TRASH_ICON}</button>` : ""}
      ${e.canDel && e.lvKey ? `<button class="icon-btn" data-lvdel="${esc(e.lvKey)}" title="휴가 취소">${TRASH_ICON}</button>` : ""}
    </div>`).join("")
    : `<div class="empty" style="padding:14px">등록된 일정이 없습니다.</div>`;

  box.innerHTML = `
    ${opts.showToday ? `<div class="card sc-today-card">
      <div class="sc-sum-title">오늘 · ${todayLabel}</div>
      ${summaryHtml || `<div class="sc-sum-line"><span class="sc-sum-none">오늘 등록된 일정이 없습니다.</span></div>`}
    </div>` : ""}
    <div class="card">
      ${opts.title ? `<div class="card-title"><div>${opts.title}</div></div>` : ""}
      <div class="sc-cal-head">
        <button type="button" class="cal-nav" id="sc-prev">&lsaquo;</button>
        <b class="sc-cal-title">${yy}년 ${mm}월</b>
        <button type="button" class="cal-nav" id="sc-next">&rsaquo;</button>
        <button type="button" class="btn btn-ghost btn-sm" id="sc-now">오늘</button>
      </div>
      <div class="sc-dow">${["일", "월", "화", "수", "목", "금", "토"].map((d, i) =>
        `<span class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</span>`).join("")}</div>
      <div class="sc-grid">${cells.map((d, i) => cellHtml(d, i)).join("")}</div>
      <div class="sc-legend">
        ${kindOrder.map((k) => `<span class="sc-legend-item">${dot(k)}${k}</span>`).join("")}
      </div>
    </div>
    <div class="card">
      <div class="card-title"><div>${selLabel} 일정</div></div>
      <div id="sc-day-list">${dayHtml}</div>
    </div>`;

  const addBtn = $("#sc-add");
  if (addBtn) addBtn.onclick = () => openScheduleModal();
  const shiftMonth = (n) => {
    let y = yy, m = mm + n;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    scYm = `${y}-${String(m).padStart(2, "0")}`;
    rerender();
  };
  box.querySelector("#sc-prev").onclick = () => shiftMonth(-1);
  box.querySelector("#sc-next").onclick = () => shiftMonth(1);
  box.querySelector("#sc-now").onclick = () => { scYm = todayStr.slice(0, 7); scSel = todayStr; rerender(); };
  box.querySelectorAll("[data-scd]").forEach((b) => {
    b.onclick = () => { scSel = b.dataset.scd; rerender(); };
  });
  box.querySelectorAll("[data-scdel]").forEach((b) => {
    b.onclick = async () => {
      const s = scDocs.find((x) => x.id === b.dataset.scdel);
      if (!s) return;
      const label = s.type === "휴무" ? `${s.name || s.authorName} 휴무` : `${s.type} "${s.title}"`;
      if (!confirm(`${scSel}의 ${label} 일정을 정말로 삭제할까요?`)) return;
      const rest = (s.dates || []).filter((d) => d !== scSel);
      if (rest.length) await db.collection(COL.schedules).doc(s.id).update({ dates: rest });
      else await db.collection(COL.schedules).doc(s.id).delete();
      toast("일정을 삭제했습니다.");
      rerender();
    };
  });
  // 총괄 관리자: 승인된 휴가 취소 (기록 삭제 → 잔여 연차 자동 복구)
  box.querySelectorAll("[data-lvdel]").forEach((b) => {
    b.onclick = async () => {
      if (!isAdmin()) return;
      const [empId, date, endDate, type, days] = b.dataset.lvdel.split("|");
      const nm = empName[empId] || "?";
      if (!confirm(`${nm}님의 ${fmtPeriod(date, endDate || date)} ${type} ${days}일 휴가를 취소할까요?\n취소하면 사용 내역에서 삭제되고 잔여 연차가 복구됩니다.`)) return;
      const ref = db.collection(COL.leaves).doc(empId);
      const snap = await ref.get();
      if (!snap.exists) { toast("연차 기록을 찾을 수 없습니다."); return; }
      const cur = snap.data();
      const recs = cur.records || [];
      const idx = recs.findIndex((r) =>
        r.date === date && (r.endDate || "") === endDate && (r.type || "") === type && String(r.days || 0) === days);
      if (idx === -1) { toast("해당 휴가 기록을 찾을 수 없습니다. 새로고침 후 다시 시도하세요."); return; }
      recs.splice(idx, 1);
      await ref.set({ ...cur, records: recs });
      toast(`${nm}님의 휴가를 취소했습니다. 잔여 연차가 복구되었습니다.`);
      rerender();
    };
  });
}

/* 일정 등록 모달: 종류 선택 → 날짜 다중 선택 → 등록 */
function openScheduleModal() {
  let type = "휴무";
  let [my, mmn] = (scYm || ymNowKST()).split("-").map(Number);
  const selDates = new Set();

  const bodyHtml = () => {
    const first = new Date(my, mmn - 1, 1);
    const startDow = first.getDay();
    const daysIn = new Date(my, mmn, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysIn; d++) cells.push(d);
    return `
      <div class="sc-type-pick">
        ${["휴무", "행사", "기타"].map((t) => `
          <button type="button" class="sc-type ${type === t ? "on" : ""}" data-sct="${t}">
            <i class="sc-dot ${SC_KINDS[t]}"></i>${t}</button>`).join("")}
      </div>
      <div id="sc-title-wrap" class="${type === "휴무" ? "hidden" : ""}">
        <label class="field"><span class="field-label">${type === "행사" ? "행사명" : "내용"}</span>
          <input id="sc-title" placeholder="${type === "행사" ? "예: 인플루언서 모임 행사" : "예: 사무실 공사"}" maxlength="60" /></label>
      </div>
      <p class="modal-desc" style="margin-bottom:8px">${type === "휴무"
        ? "본인 휴무인 날짜를 모두 선택하세요. 등록하면 전 직원에게 표시됩니다."
        : "해당 일정의 날짜를 모두 선택하세요."}</p>
      <div class="sc-cal-head sm">
        <button type="button" class="cal-nav" data-scnav="-1">&lsaquo;</button>
        <b class="sc-cal-title">${my}년 ${mmn}월</b>
        <button type="button" class="cal-nav" data-scnav="1">&rsaquo;</button>
      </div>
      <div class="sc-dow sm">${["일", "월", "화", "수", "목", "금", "토"].map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="scm-grid">
        ${cells.map((d) => {
          if (!d) return `<span class="scm-d blank"></span>`;
          const ds = `${my}-${String(mmn).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          return `<button type="button" class="scm-d ${selDates.has(ds) ? "on " + SC_KINDS[type] : ""}" data-scmd="${ds}">${d}</button>`;
        }).join("")}
      </div>
      <div class="sc-sel-note">선택한 날짜 <b id="sc-selcount">${selDates.size}</b>일${selDates.size ? ` — ${[...selDates].sort().map((d) => d.slice(5).replace("-", "/")).join(", ")}` : ""}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="sc-cancel">취소</button>
        <button type="button" class="btn btn-primary" id="sc-save">등록</button>
      </div>`;
  };

  const wire = () => {
    $("#modal").querySelectorAll("[data-sct]").forEach((b) => {
      b.onclick = () => { type = b.dataset.sct; rerender(); };
    });
    $("#modal").querySelectorAll("[data-scnav]").forEach((b) => {
      b.onclick = () => {
        mmn += Number(b.dataset.scnav);
        if (mmn < 1) { mmn = 12; my--; }
        if (mmn > 12) { mmn = 1; my++; }
        rerender();
      };
    });
    $("#modal").querySelectorAll("[data-scmd]").forEach((b) => {
      b.onclick = () => {
        const ds = b.dataset.scmd;
        if (selDates.has(ds)) selDates.delete(ds); else selDates.add(ds);
        rerender();
      };
    });
    $("#sc-cancel").onclick = closeModal;
    $("#sc-save").onclick = async () => {
      if (!selDates.size) { toast("날짜를 1일 이상 선택하세요."); return; }
      const title = type === "휴무" ? "" : ($("#sc-title").value || "").trim();
      if (type !== "휴무" && !title) { toast(`${type === "행사" ? "행사명을" : "내용을"} 입력하세요.`); return; }
      await db.collection(COL.schedules).add({
        type,
        dates: [...selDates].sort(),
        ...(type === "휴무" ? { empId: me.id, name: me.name } : { title }),
        authorId: me.id,
        authorName: me.name,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal();
      toast("일정을 등록했습니다.");
      renderSchedule();
    };
  };

  let titleDraft = "";
  const rerender = () => {
    const t = $("#sc-title");
    if (t) titleDraft = t.value;
    $("#sc-modal-body").innerHTML = bodyHtml();
    const t2 = $("#sc-title");
    if (t2) t2.value = titleDraft;
    wire();
  };

  openModal(`<h3>일정 등록</h3><div id="sc-modal-body">${bodyHtml()}</div>`);
  wire();
}

/* ───────── 근태관리 (출퇴근 기록 · 근무 캘린더 · 근무 이력) ───────── */
const WORK_AREAS = ["카페", "홀&바", "주방"];
/* 단기알바: 직원 명단(employees)에 등록하지 않고 근무 일정에만 표시하는 외부 인원 */
const TEMP_EMP_VALUE = "__temp__";
const tempEmpId = (name) => "temp:" + String(name || "").trim();
const TEMP_BADGE = '<span class="temp-badge">단기</span>';
let attTab = "record";   // record | calendar | history
let atCalYm = null;
let atHistYm = null;
let admAttYm = null;
let attRecDate = null;   // 근태기록 탭에서 출퇴근을 기록/수정할 날짜 (기본: 오늘)

function canEditShifts() { return isAdmin() || isSpecial(); }
// 근태기록 > 근무 캘린더의 스케줄 추가·수정·삭제는 전 직원에게 열려 있다.
function canEditShiftCal() { return !!me; }
function minOf(t) { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); }
function hm(mins) { return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`; }
function shiftOvernight(s) { return minOf(s.end) <= minOf(s.start); }
function shiftSpanMin(s) { let d = minOf(s.end) - minOf(s.start); if (d <= 0) d += 1440; return d; }
function shiftHours(s) { return Math.max(0, shiftSpanMin(s) / 60 - (s.breakIncluded ? 1 : 0)); }
function shiftEndLabel(s) { return shiftOvernight(s) ? "익일 " + s.end : s.end; }
function fmtH(h) { return String(Math.round(h * 100) / 100); }
const REST_ICON = '<span class="rest-ico" title="휴게시간 포함 (1시간 차감)">*</span>';
const REST_BADGE = '<span class="rest-badge" title="휴게시간 포함 (1시간 차감)">휴게포함</span>';
/* 24시간 "HH:MM" → 한국어 오전/오후 표기 (00:00은 자정=오전 12시) */
function kAmPmLabel(t) {
  const [h, m] = String(t || "0:0").split(":").map(Number);
  const ap = h < 12 ? "오전" : "오후";
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return m ? `${ap} ${h12}시 ${m}분` : `${ap} ${h12}시`;
}
/* 근무 표기: "09:00 ~ 16:00 (6h)" (+휴게 표시) */
function shiftRangeHtml(s) {
  return `${esc(s.start)} ~ ${esc(shiftEndLabel(s))} (${fmtH(shiftHours(s))}h)${s.breakIncluded ? " " + REST_ICON : ""}`;
}
/* 캘린더 셀용 축약 표기: "10:00-17:00 (7h)" / 익일 근무는 "익일" 표시 */
function shiftCompact(s) {
  return `${esc(s.start)}-${shiftOvernight(s) ? "익일 " : ""}${esc(s.end)} (${fmtH(shiftHours(s))}h)${s.breakIncluded ? "*" : ""}`;
}
function hmNowKST() { const d = kstNow(); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; }
function prevDateStr(ds) { const d = new Date(ds + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
function tsSec(t) { return t?.seconds ?? (t instanceof Date ? t.getTime() / 1000 : 0); }
const SHIFT_COLOR_N = 14;
/* 직원별 색상: 해시 대신 명단 순서로 고유 배정 → 14명까지는 겹침 없음 */
let shiftColorMap = {};
function assignShiftColors(ids) {
  shiftColorMap = {};
  [...new Set(ids)].filter((id) => !String(id || "").startsWith("temp:")).sort()
    .forEach((id, i) => { shiftColorMap[id] = "shc" + (i % SHIFT_COLOR_N); });
}
function shiftColor(id) {
  // 단기알바는 색상 배정에서 제외하고 항상 무채색 고정
  if (String(id || "").startsWith("temp:")) return "shc-temp";
  if (shiftColorMap[id]) return shiftColorMap[id];
  let h = 0;
  for (const c of String(id || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return "shc" + (h % SHIFT_COLOR_N);
}
function nextDateStr(ds) { const d = new Date(ds + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
/* 시·분 옵션 (출퇴근 기록은 1분 단위로 정확히 입력) */
const hourOpts = (v) => Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) =>
  `<option ${h === v ? "selected" : ""}>${h}</option>`).join("");
const minOpts = (v) => Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map((m) =>
  `<option ${m === v ? "selected" : ""}>${m}</option>`).join("");
/* 시간 셀렉트 (시 0-23 · 분 1분 단위) — 기본값은 현재 시각(KST) */
function timeSelHtml(prefix, val) {
  const [vh, vm] = (val || hmNowKST()).split(":");
  return `<div class="io-time">
    <select id="${prefix}-h">${hourOpts(vh)}</select>
    <b>:</b>
    <select id="${prefix}-m">${minOpts(vm)}</select>
  </div>`;
}
const timeSelVal = (prefix) => `${$(`#${prefix}-h`).value}:${$(`#${prefix}-m`).value}`;

/* 휴게 1시간 차감 여부: 출퇴근 기록에 직접 지정한 값이 있으면 그것을 우선하고,
   없으면 해당일 근무 일정의 '휴게시간 포함' 설정을 따른다. */
function breakApplied(att, shift) {
  if (att && typeof att.breakIncluded === "boolean") return att.breakIncluded;
  return !!shift?.breakIncluded;
}
/* 실근무 시간(h): 출퇴근 기록 + 휴게 차감 여부 — 10분 블록 단위로 환산
   출근 날짜(date)와 퇴근 날짜(outDate)를 엄격히 비교: 퇴근 날짜가 다음날일 때만 +24h.
   같은 날인데 퇴근이 출근보다 빠르면 잘못된 기록으로 보고 0을 반환한다.
   예정 근무(shift)가 있으면 실제 출/퇴근이 예정 시각의 ±10분(유예) 이내일 때
   예정 시각으로 스냅한다 — 유예 내 오차가 블록 환산으로 부풀려지는 것을 방지. */
/* 실근무 '분' — 블록 환산 전의 실제 근무 길이 (휴게 차감 반영) */
function workedNetMin(att, shift) {
  if (!att?.inAt || !att?.outAt) return null;
  let inMin = minOf(att.inAt);
  let outAbs = minOf(att.outAt) + ((att.outDate || att.date) > att.date ? 1440 : 0);
  if (shift) {
    const schedStart = minOf(shift.start);
    const schedEnd = minOf(shift.end) + (shiftOvernight(shift) ? 1440 : 0);
    if (Math.abs(inMin - schedStart) <= ATT_GRACE_MIN) inMin = schedStart;
    if (Math.abs(outAbs - schedEnd) <= ATT_GRACE_MIN) outAbs = schedEnd;
  }
  const span = outAbs - inMin;
  if (span < 0) return 0;
  return Math.max(0, span - (breakApplied(att, shift) ? 60 : 0));
}
function workedHours(att, shift) {
  const m = workedNetMin(att, shift);
  return m === null ? null : blockHours(m);
}
/* 출퇴근 정책: 예정 시간 전후 10분까지는 정상 처리(무시). */
const ATT_GRACE_MIN = 10;
const OT_TABLE = [0.17, 0.34, 0.5, 0.67, 0.84];
/* 회사 표준 시간 단위: 모든 근무시간은 10분 블록으로 환산
   1~10분 0.17h · 11~20분 0.34h · 21~30분 0.5h · 31~40분 0.67h · 41~50분 0.84h · 51~60분 1h */
function blockHours(mins) {
  if (mins <= 0) return 0;
  const blocks = Math.ceil(mins / 10);
  const whole = Math.floor(blocks / 6), rem = blocks % 6;
  // 소수 둘째 자리로 맞춰 부동소수점 오차(1 + 0.84 = 1.8399…)가 합계에 누적되지 않게 한다
  return Math.round((whole + (rem ? OT_TABLE[rem - 1] : 0)) * 100) / 100;
}
/* 추가근무(조기출근·연장) 인정: 10분은 '유예 기준선'일 뿐 차감하지 않는다.
   10분 이하는 0, 10분을 넘기면 전체 시간을 10분 블록으로 인정
   (30분 → 0.5h · 60분 → 1h · 90분 → 1.5h) */
function otHours(mins) {
  return mins <= ATT_GRACE_MIN ? 0 : blockHours(mins);
}
/* 야간근무(22:00~06:00) 가산: 시간대 안에서는 1분 초과부터 10분 블록 인정.
   결재 없이 자동으로 붙는 유일한 항목이라 두 가지를 반드시 걷어낸다.
     1) 휴게시간 — 쉬는 시간까지 야간 근무로 쳐주면 안 된다.
     2) 아직 결재 승인되지 않은 초과분 — 그 시간이 근무로 인정될지도 정해지지
        않았는데 야간수당만 먼저 확정해줄 수 없다 (연장 칩과 같은 기준을 따른다).
   그래서 실제 시계 시간이 아니라 '인정된 구간(effIn~effOut, 휴게 차감)'만 넘긴다. */
const NIGHT_START_MIN = 22 * 60, NIGHT_END_MIN = 30 * 60; // 당일 22:00(1320) ~ 익일 06:00(1800), 자정 기준 분
const NIGHT_MIN_WORK_MIN = 60;
function nightHours(effIn, effOut, breakMin) {
  if (effOut <= effIn) return 0;
  const overlap = (lo, hi) => Math.max(0, Math.min(effOut, hi) - Math.max(effIn, lo));
  const mins = Math.max(0, overlap(0, 360) + overlap(NIGHT_START_MIN, NIGHT_END_MIN) - breakMin);
  if (effOut - effIn - breakMin < NIGHT_MIN_WORK_MIN) return 0;
  return blockHours(mins);
}
/* 조기출근·연장근무 가산 제외 여부 — 출퇴근 기록에 저장된 값을 우선한다.
   (기록 시점의 직원 설정을 스냅샷으로 남겨 나중에 설정이 바뀌어도 과거 기록이 흔들리지 않는다)
   — 지각·조기퇴근·야간근무 표기는 제외 대상이어도 그대로 유지된다. */
function isOtExempt(att) {
  if (att && typeof att.otExempt === "boolean") return att.otExempt;
  return LEGACY_OT_EXEMPT_NAMES.includes(String(att?.name || "").trim());
}

/* 특이사항 (지각/조기출근/조기퇴근/연장/야간근무)
   조기출근·연장은 '감지'와 '가산'을 분리한다 — 결재로 승인된 분(otApprovedMin)만 가산(h)에 반영.
   결재는 본인이 [근무 이력]에서 태그를 눌러 직접 올린다 (자동 요청 없음).
     미신청  조기출근 30분 · 결재 요청   (무채색, 클릭 가능)
     대기중  조기출근 30분 (결재 대기)   (무채색)
     승인됨  조기출근 30분 (가산 0.5h)   (색상)
   h 값은 급여 가산 대상 시간이며, 실근무 시간에 이미 포함된 시간을 다시 더하는 값이 아니다.
   reqOf(kind) → 해당 날짜·종류로 올라간 결재 상태("대기"/"승인"/"반려") 또는 undefined */
function attNotes(att, shift, reqOf) {
  const notes = [];
  if (!att || !att.inAt) return notes;
  const exempt = isOtExempt(att);
  // 승인된 추가근무 분을 조기출근 → 연장 순으로 배분
  let left = Number(att.otApprovedMin || 0);
  const take = (mins) => { const t = Math.min(left, mins); left -= t; return t; };
  /* 조기출근·연장 칩 — 승인 전에는 가산 0 + 무채색. okMin에 승인된 분을 담아 돌려준다. */
  const otNote = (k, kind, mins) => {
    const okMin = take(mins);
    const h = otHours(okMin);
    const st = reqOf ? reqOf(kind) : null;
    if (h) return { k, kind, mins, okMin, h, approved: true, label: `${kind} ${mins}분 (가산 ${fmtH(h)}h)` };
    if (st === "대기") return { k, kind, mins, okMin: 0, h: 0, label: `${kind} ${mins}분 (결재 대기)` };
    if (st === "반려") return { k, kind, mins, okMin: 0, h: 0, label: `${kind} ${mins}분 (반려)` };
    return { k, kind, mins, okMin: 0, h: 0, canReq: true, label: `${kind} ${mins}분` };
  };
  // 야간 가산은 '인정된 근무 구간'에만 붙는다 — 예정 근무 + 승인된 조기출근·연장까지만.
  let effIn = minOf(att.inAt);
  let effOut = att.outAt ? minOf(att.outAt) + ((att.outDate || att.date) > att.date ? 1440 : 0) : effIn;
  if (shift) {
    const schedStart = minOf(shift.start);
    const schedEnd = minOf(shift.end) + (shiftOvernight(shift) ? 1440 : 0);
    const dIn = effIn - schedStart;
    if (dIn > ATT_GRACE_MIN) notes.push({ k: "late", approved: true, label: `지각 ${dIn}분` });
    else if (-dIn > ATT_GRACE_MIN && !exempt) {
      const n = otNote("earlyin", "조기출근", -dIn);
      notes.push(n);
      effIn = schedStart - n.okMin;      // 승인된 조기출근만 인정 구간에 포함
    } else if (dIn <= 0) effIn = schedStart;  // 유예 이내 조기 출근은 예정 시각으로 스냅
    if (att.outAt) {
      const dOut = effOut - schedEnd;
      if (-dOut > ATT_GRACE_MIN) notes.push({ k: "earlyout", approved: true, label: `조기퇴근 ${-dOut}분` });
      else if (dOut > ATT_GRACE_MIN && !exempt) {
        const n = otNote("over", "연장", dOut);
        notes.push(n);
        effOut = schedEnd + n.okMin;     // 승인된 연장만 인정 구간에 포함
      } else if (dOut >= 0) effOut = schedEnd;  // 유예 이내 초과 퇴근은 예정 시각으로 스냅
    }
  }
  // 예정 근무 외 시간대에 승인된 추가근무(직접 신청 건 등)
  if (left > 0) {
    const h = otHours(left);
    if (h > 0) notes.push({ k: "over", h, approved: true, label: `추가근무 ${left}분 (가산 ${fmtH(h)}h)` });
  }
  if (att.outAt) {
    const nh = nightHours(effIn, effOut, breakApplied(att, shift) ? 60 : 0);
    if (nh > 0) notes.push({ k: "night", h: nh, approved: true, label: `야간근무 ${fmtH(nh)}h` });
  }
  return notes;
}
/* 특이사항 칩 — 승인되지 않은 추가근무는 무채색으로 흐리게 표시한다.
   date를 넘기면 미신청 건이 결재 요청 버튼이 된다 (본인 근무 이력에서만 사용). */
const noteChips = (notes, date) => notes.map((n) => {
  const cls = `att-note ${n.approved ? n.k : "pending"}`;
  if (n.canReq) {
    return date
      ? `<button type="button" class="${cls} req" data-otreq="${date}|${n.kind}|${n.mins}">${n.label} · 결재 요청</button>`
      : `<span class="${cls}">${n.label} (미신청)</span>`;
  }
  return `<span class="${cls}">${n.label}</span>`;
}).join("");

async function renderAttend() {
  const main = $("#main");
  main.innerHTML = pageHead("ATTEND", "근태기록", "출퇴근을 기록하고 근무 일정·이력을 확인합니다.") + `
    <div class="subtabs">
      ${[["record", "근태기록"], ["calendar", "근무 캘린더"], ["history", "근무 이력"]].map(([k, l]) =>
        `<button class="subtab ${attTab === k ? "on" : ""}" data-atab="${k}">${l}</button>`).join("")}
    </div>
    <div id="att-body"><div class="empty">불러오는 중...</div></div>`;
  main.querySelectorAll("[data-atab]").forEach((b) => {
    // 하위 탭도 해시에 남겨 새로고침 시 같은 탭으로 돌아오게 한다
    b.onclick = () => navigate("attend", b.dataset.atab);
  });
  if (attTab === "record") await renderAttRecord();
  else if (attTab === "calendar") await renderAttCalendar();
  else await renderAttHistory();
}

/* ── 근태기록: 부서 알림 + 내 출퇴근 + 오늘 근무 현황 ── */
async function renderAttRecord() {
  const body = $("#att-body");
  const today = todayKST();
  const yesterday = prevDateStr(today);
  if (!attRecDate) attRecDate = today;
  const recDate = attRecDate;
  const isTodayMode = recDate === today;

  const [shiftSnap, attSnap, emps, recSnap, reqSnap] = await Promise.all([
    db.collection(COL.shifts).where("date", "in", [yesterday, today]).get(),
    db.collection(COL.attendance).where("date", "in", [yesterday, today]).get(),
    loadActiveEmployees(),
    db.collection(COL.attendance).doc(`${me.id}_${recDate}`).get(),
    db.collection(COL.attRequests).where("empId", "==", me.id).get()
  ]);
  // 내가 올린 근태 결재 신청 (최신 10건)
  const myReqs = reqSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.empId === me.id)
    .sort((a, b) => tsSec(b.createdAt) - tsSec(a.createdAt)).slice(0, 10);
  const shifts = shiftSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.date === today || s.date === yesterday);
  const atts = attSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.date === today || a.date === yesterday);
  // 실시간 미퇴근 이월(어제 출근 후 미퇴근)은 오늘 기록 모드에서만 우선 처리 대상
  const myOpen = atts.find((a) => a.empId === me.id && a.inAt && !a.outAt) || null;
  // recDate에 대한 내 기록 (없으면 새로 만들 빈 문서로 취급)
  const myRec = { id: `${me.id}_${recDate}`, ...(recSnap.exists ? recSnap.data() : {}) };

  // 오늘 현황 행 (파트별 그룹 — 기록 날짜 선택과 무관하게 항상 오늘 기준)
  const rowHtml = (r) => `<tr class="${r.badge ? "att-carry" : ""}">
    <td>${r.temp ? TEMP_BADGE : ""}<b>${esc(r.name)}</b>${r.badge ? ` <span class="badge warn">${esc(r.badge)}</span>` : ""}</td>
    <td class="att-mono">${esc(r.plan)}</td>
    <td class="att-mono ${r.inAt ? "c-green" : "c-red"}">${r.inAt ? esc(r.inAt) : "-"}</td>
    <td class="att-mono c-red">${r.outAt ? esc(r.outAt) : "-"}</td>
  </tr>`;
  const groupRow = (label) => `<tr class="att-area-row"><td colspan="4">${esc(label)}</td></tr>`;
  let statusBody = "";
  // 전일 미퇴근 이월 건 최상단
  const carryRows = atts.filter((a) => a.date === yesterday && a.inAt && !a.outAt).map((a) => {
    const s = shifts.find((x) => x.date === yesterday && x.empId === a.empId);
    return rowHtml({ name: a.name, badge: yesterday, plan: s ? `${s.start}-${shiftEndLabel(s)}` : "-", inAt: a.inAt, outAt: a.outAt });
  }).join("");
  if (carryRows) statusBody += groupRow("전일 미퇴근") + carryRows;
  const todayShifts = shifts.filter((s) => s.date === today);
  WORK_AREAS.forEach((area) => {
    const g = todayShifts.filter((s) => s.area === area).sort((a, b) => minOf(a.start) - minOf(b.start));
    if (!g.length) return;
    statusBody += groupRow(area) + g.map((s) => {
      const a = atts.find((x) => x.empId === s.empId && x.date === today);
      return rowHtml({ name: s.name, temp: s.isTemp, badge: null, plan: `${s.start}-${shiftEndLabel(s)}`, inAt: a?.inAt, outAt: a?.outAt });
    }).join("");
  });
  const etcRows = atts.filter((a) => a.date === today && !todayShifts.some((s) => s.empId === a.empId))
    .map((a) => rowHtml({ name: a.name, badge: null, plan: "-", inAt: a.inAt, outAt: a.outAt })).join("");
  if (etcRows) statusBody += groupRow("일정 외 출근") + etcRows;

  const inDone = !!myRec.inAt;
  const outDone = !!myRec.outAt;
  const IN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/></svg>';
  const OUT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>';
  // 기록 단계: 출근 전 → 출근만 입력 / 출근 후 → 퇴근만 입력 / 둘 다 → 완료
  const stage = !inDone ? "in" : !outDone ? "out" : "done";
  // 선택한 날짜가 아닌 다른 날에 미퇴근 기록이 남아 있으면 안내 (그 날짜로 바꿔 퇴근하도록)
  const openElsewhere = myOpen && myOpen.date !== recDate ? myOpen : null;

  /* 내 기록 상태 요약 */
  const myShiftToday = shifts.find((s) => s.date === recDate && s.empId === me.id);
  const recWorked = workedHours(myRec, myShiftToday);
  const statusCard = `
    <div class="my-rec">
      <div class="my-rec-head">
        <div>
          <div class="mr-name">${esc(me.name)}</div>
          <div class="mr-plan">${myShiftToday ? `${myShiftToday.start}-${shiftEndLabel(myShiftToday)}` : "등록된 근무 일정 없음"}</div>
        </div>
      </div>
      <div class="my-rec-body">
        <div class="mr-cell">
          <span class="mr-label">출근</span>
          ${myRec.inAt ? `<b class="c-green">${esc(myRec.inAt)}</b> <em>(${esc(recDate)})</em>` : `<b class="mr-none">미기록</b>`}
        </div>
        <div class="mr-cell">
          <span class="mr-label">퇴근</span>
          ${myRec.outAt ? `<b class="c-red">${esc(myRec.outAt)}</b> <em>(${esc(myRec.outDate || recDate)})</em>` : `<b class="mr-none">미기록</b>`}
        </div>
        ${recWorked != null ? `<div class="mr-cell"><span class="mr-label">총 근무</span><b>${fmtH(recWorked)}시간</b></div>` : ""}
      </div>
    </div>`;
  const alertMsg = openElsewhere
    ? `<b>${esc(openElsewhere.date)}</b> 출근(${esc(openElsewhere.inAt)}) 기록이 아직 미완료입니다.
       아래 기록 날짜를 <b>${esc(openElsewhere.date)}</b>로 바꿔 퇴근을 먼저 기록해 주세요.
       <button type="button" class="btn btn-ghost btn-sm alert-act" id="rec-goto-open">${esc(openElsewhere.date)}로 이동</button>`
    : stage === "done"
      ? `<b>${esc(recDate)}</b> 출퇴근이 모두 기록되었습니다. 수정이 필요하면 담당자에게 요청하세요.`
      : "";

  /* 단계별 입력 패널 (해당 단계의 시간 입력 + 버튼만 노출) */
  const ioPanel = stage === "done" ? "" : `
    <div class="att-io ${stage} single">
      <div class="io-title">${stage === "in" ? "출근 시간" : "퇴근 시간"}</div>
      ${stage === "in" ? timeSelHtml("ai", null) : timeSelHtml("ao", null)}
      <button class="btn io-btn ${stage}" id="${stage === "in" ? "att-in" : "att-out"}">
        ${stage === "in" ? IN_ICON : OUT_ICON}${isTodayMode ? (stage === "in" ? "출근하기" : "퇴근하기") : `${recDate} ${stage === "in" ? "출근하기" : "퇴근하기"}`}</button>
    </div>`;

  body.innerHTML = `
    <div class="card">
      <div class="card-title"><div>출퇴근 기록<div class="ct-desc">${esc(me.name)}님의 출퇴근을 기록합니다. 날짜를 확인하고 시간을 조정한 후 버튼을 누르세요.</div></div></div>
      ${statusCard}
      ${alertMsg ? `<div class="att-alert">${alertMsg}</div>` : ""}
      <div class="rec-date-row">
        <span class="field-label">기록 날짜</span>
        <button type="button" class="cal-input" id="rec-date-btn"><span id="rec-date-btn-label">${dateLabelKo(recDate)}</span>${CAL_ICON}</button>
        ${!isTodayMode ? `<button type="button" class="btn btn-ghost btn-sm" id="rec-date-today">오늘로</button>` : ""}
      </div>
      ${!isTodayMode ? `<div class="mini-note">과거 날짜를 기록·수정 중입니다. 날짜를 놓쳐 미입력된 경우 여기서 직접 기록하세요.</div>` : ""}
      ${ioPanel}
    </div>
    <div class="card">
      <div class="card-title"><div>오늘 근무 현황<div class="ct-desc">오늘 근무 예정자와 출퇴근 기록입니다. 근무 영역별로 표시됩니다.</div></div></div>
      ${statusBody ? `<div class="table-wrap"><table class="data att-table">
        <thead><tr><th>근무자명</th><th>예정</th><th>출근</th><th>퇴근</th></tr></thead>
        <tbody>${statusBody}</tbody>
      </table></div>` : `<div class="empty">오늘 근무 예정자가 없습니다. [근무 캘린더]에서 일정을 등록하세요.</div>`}
    </div>
    ${attReqSectionHtml(myReqs, emps)}`;

  $("#rec-date-btn").onclick = () => openDatePicker($("#rec-date-btn"), recDate, (v) => {
    if (!v) return;
    if (v > today) { toast("미래 날짜에는 출퇴근을 기록할 수 없습니다."); return; }
    attRecDate = v;
    renderAttend();
  });
  const todayBtn = $("#rec-date-today");
  if (todayBtn) todayBtn.onclick = () => { attRecDate = today; renderAttend(); };
  const gotoOpen = $("#rec-goto-open");
  if (gotoOpen) gotoOpen.onclick = () => { attRecDate = openElsewhere.date; renderAttend(); };

  bindAttReqSection();
  bindReqCancel($("#att-body"), COL.attRequests, renderAttend);

  const inBtn = $("#att-in");
  if (inBtn) inBtn.onclick = () => {
    if (inBtn.disabled) return;
    const t = timeSelVal("ai");
    // 미래 시각 출근 차단 (오늘 기록 기준, 한국시간)
    if (isTodayMode && t > hmNowKST()) {
      toast(`미래 시각(${t})으로는 출근을 기록할 수 없습니다. 현재 ${hmNowKST()}`);
      return;
    }
    // 실수로 눌렀을 때를 대비해 확인 모달을 거쳐 [등록]까지 눌러야 기록된다
    openInConfirmModal({
      time: t,
      workDate: recDate,
      shift: shifts.find((s) => s.date === recDate && s.empId === me.id),
      onConfirm: async () => {
        const shiftOfDay = shifts.find((s) => s.date === recDate && s.empId === me.id);
        await db.collection(COL.attendance).doc(myRec.id).set({
          empId: me.id, name: me.name, dept: me.dept || "", date: recDate, inAt: t,
          // 기록 시점의 가산 제외 설정을 함께 남긴다 (나중에 설정이 바뀌어도 과거 기록 유지)
          otExempt: isOtExemptEmp(me)
        }, { merge: true });
        closeModal();
        toast(`${recDate} 출근 ${t} 기록 완료`);
        renderAttend();
      }
    });
  };

  const outBtn = $("#att-out");
  if (outBtn) outBtn.onclick = () => {
    if (outBtn.disabled) return;
    const t = timeSelVal("ao");
    // 퇴근은 선택한 기록 날짜의 출근 건을 마감한다 (자정을 넘겼으면 다음날로 저장)
    const workDate = recDate;
    const crossMidnight = t < myRec.inAt;
    const outDateEff = crossMidnight ? nextDateStr(workDate) : workDate;
    // 미래 시각 퇴근 차단 (퇴근이 실제로 찍히는 날짜가 오늘인 경우, 한국시간)
    if (outDateEff > today) {
      toast(`아직 오지 않은 시각입니다. 자정을 넘긴 퇴근은 날짜가 지난 뒤에 기록할 수 있습니다.`);
      return;
    }
    if (outDateEff === today && t > hmNowKST()) {
      toast(`미래 시각(${t})으로는 퇴근을 기록할 수 없습니다. 현재 ${hmNowKST()}`);
      return;
    }
    const shiftOfDay = shifts.find((s) => s.date === workDate && s.empId === me.id);
    openOutConfirmModal({
      time: t,
      workDate,
      outDateEff,
      inAt: myRec.inAt,
      shift: shiftOfDay,
      breakIncl: breakApplied(myRec, shiftOfDay),
      onConfirm: async () => {
        await db.collection(COL.attendance).doc(myRec.id)
          .set({ outAt: t, outDate: outDateEff }, { merge: true });
        closeModal();
        toast(`${workDate} 퇴근 ${t} 기록 완료`);
        renderAttend();
      }
    });
  };
}

/* 근무 이력의 조기출근·연장 태그를 눌러 그 건만 결재에 올린다.
   결재자를 고르는 확인 모달을 거치며, 승인된 분(otApprovedMin)만 급여 가산 대상이 된다. */
function openOtRequestModal({ date, kind, mins, shift, emps, onDone }) {
  const approvers = approverCandidates(emps);
  if (!approvers.length) { toast("지정 가능한 결재자가 없습니다."); return; }
  const range = kind === "조기출근"
    ? `${shift ? esc(shift.start) : "?"} 이전 ${mins}분`
    : `${shift ? esc(shiftEndLabel(shift)) : "?"} 이후 ${mins}분`;
  openModal(`
    <h3>${kind} 결재 요청</h3>
    <p class="modal-desc">${esc(dateLabelKo(date))}의 ${kind} <b>${mins}분</b>을 결재에 올립니다.</p>
    <div class="ioc-worked" style="margin-bottom:14px">
      <div class="iocw-row"><span>예정 근무</span><b>${schedLabel(shift)}</b></div>
      <div class="iocw-row"><span>${kind} 구간</span><b>${range}</b></div>
      <div class="iocw-row total"><span>인정 예정</span><b>${fmtH(blockHours(mins))}h</b></div>
    </div>
    <label class="field"><span class="field-label">결재자</span>
      <select id="otr-appr">${approverOptionHtml(emps)}</select></label>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="otr-cancel">취소</button>
      <button type="button" class="btn btn-primary" id="otr-ok">결재 요청</button>
    </div>`);
  $("#otr-cancel").onclick = closeModal;
  $("#otr-ok").onclick = async () => {
    const btn = $("#otr-ok");
    if (btn.disabled) return;
    btn.disabled = true;
    // 같은 날·같은 종류로 이미 올라간 건이 있으면 중복 생성하지 않는다
    const dup = await db.collection(COL.attRequests)
      .where("empId", "==", me.id).where("date", "==", date).get();
    if (dup.docs.some((d) => {
      const r = d.data();
      return r.empId === me.id && r.date === date
        && r.type === "overtime" && r.otKind === kind && r.status !== "반려";
    })) { toast("이미 결재에 올라간 건입니다."); closeModal(); onDone(); return; }
    const sel = $("#otr-appr");
    await db.collection(COL.attRequests).add({
      type: "overtime", otKind: kind,
      empId: me.id, name: me.name, dept: me.dept || "",
      approverId: sel.value,
      approver: sel.options[sel.selectedIndex].text.replace(" (본인 승인)", ""),
      status: "대기", date,
      start: kind === "조기출근" ? "" : (shift?.end || ""),
      end: kind === "조기출근" ? (shift?.start || "") : "",
      mins, hours: blockHours(mins),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    closeModal();
    toast(`${date} ${kind} ${mins}분을 ${sel.options[sel.selectedIndex].text.replace(" (본인 승인)", "")}님에게 결재 요청했습니다.`);
    onDone();
  };
}

/* ── 근태 결재 (추가근무 · 근무변경) ────────────────────────────────
   직원이 결재자를 지정해 신청하면 결재자의 [근태관리] 최상단 '내 결재 대기'에 뜬다.
   근무변경은 승인 시 신청자 부서 전체 공지로 자동 게시된다. */
const ATT_REQ_STATUS_BADGE = { "대기": "warn", "승인": "ok", "반려": "rej" };

/* 내가 올린 결재가 아직 '대기'면 신청자가 직접 취소할 수 있다 (실수로 눌렀을 때).
   취소는 신청 문서를 삭제해 결재자 화면에서도 사라지게 한다. */
function reqCancelBtn(r) {
  return r.status === "대기" && r.empId === me.id
    ? `<button type="button" class="btn btn-ghost btn-sm req-cancel" data-req-cancel="${r.id}">취소</button>` : "";
}
function bindReqCancel(scope, col, rerender) {
  if (!scope) return;
  scope.querySelectorAll("[data-req-cancel]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("이 결재 신청을 취소할까요? 결재자 목록에서도 사라집니다.")) return;
      try {
        const ref = db.collection(col).doc(b.dataset.reqCancel);
        const snap = await ref.get();
        if (!snap.exists) { toast("이미 처리되었거나 삭제된 신청입니다."); rerender(); return; }
        const r = snap.data();
        if (r.empId !== me.id) return toast("본인이 올린 신청만 취소할 수 있습니다.");
        if (r.status !== "대기") { toast(`이미 ${r.status} 처리되어 취소할 수 없습니다.`); rerender(); return; }
        await ref.delete();
        toast("결재 신청을 취소했습니다.");
        updateLeaveAlarm();
        updateAttApprovalAlarm();
        rerender();
      } catch (e) {
        toast("취소에 실패했습니다. 잠시 후 다시 시도하세요.");
      }
    };
  });
}

function attReqSectionHtml(myReqs, emps) {
  const approvers = approverCandidates(emps);
  return `
    <div class="card" id="atreq-card">
      <div class="card-title"><div>근태 결재 신청
        <div class="ct-desc">추가근무·근무변경은 결재자 승인 후 반영됩니다.</div></div></div>
      ${approvers.length ? `
      <div class="atreq-form">
        <div class="atreq-tabs">
          <button type="button" class="atreq-tab" data-atrtype="overtime">추가근무</button>
          <button type="button" class="atreq-tab" data-atrtype="change">근무변경</button>
        </div>
        <div class="atr-pick" id="atr-pick">신청할 항목을 선택하세요.</div>

        <div id="atr-body" class="hidden">
          <label class="field"><span class="field-label">결재자</span>
            <select id="atr-approver">${approverOptionHtml(emps)}</select></label>

          <div id="atr-overtime" class="hidden">
            <div class="field"><span class="field-label">추가근무 날짜</span>
              <button type="button" class="cal-input" id="atr-date"><span id="atr-date-label">${dateLabelKo(todayKST())}</span>${CAL_ICON}</button></div>
            <div class="grid-2">
              <div class="field"><span class="field-label">시작</span>
                <div class="io-time"><select id="atr-sh">${hourOpts("18")}</select><b>:</b><select id="atr-sm">${minOpts("00")}</select></div></div>
              <div class="field"><span class="field-label">종료 <em class="sf-hint">(시작보다 빠르면 익일)</em></span>
                <div class="io-time"><select id="atr-eh">${hourOpts("20")}</select><b>:</b><select id="atr-em">${minOpts("00")}</select></div></div>
            </div>
            <div class="atr-preview" id="atr-preview"></div>
          </div>

          <div id="atr-change" class="hidden">
            <label class="field"><span class="field-label">근무 변경 내용</span>
              <textarea id="atr-text" class="wn-input" rows="4" maxlength="500" placeholder="예시:
8월 17일 18:00~22:00 근무자 변동 (기존: 홍길동, 변경: 김아무개)
8월 18일 김아무개 근무시간 변경 (기존: 16:00~22:00, 변경: 18:00~24:00)"></textarea></label>
            <div class="mini-note">승인되면 ${esc(me.dept)} 전원에게 공지로 자동 게시됩니다.</div>
          </div>

          <button type="button" class="btn btn-primary btn-block" id="atr-submit" style="margin-top:12px">결재 요청</button>
        </div>
      </div>`
      : `<div class="empty">지정 가능한 결재자가 없습니다.</div>`}

      ${myReqs.length ? `<div class="table-wrap" style="margin-top:16px"><table class="data att-table">
        <thead><tr><th>구분</th><th>내용</th><th>결재자</th><th>신청일</th><th>상태</th><th></th></tr></thead>
        <tbody>${myReqs.map((r) => `<tr>
          <td><b>${ATT_REQ_LABEL[r.type] || "-"}</b></td>
          <td class="atr-sum">${esc(attReqSummary(r))}</td>
          <td>${esc(r.approver || "-")}</td>
          <td>${fmtTs(r.createdAt)}</td>
          <td><span class="badge ${ATT_REQ_STATUS_BADGE[r.status] || ""}">${esc(r.status || "대기")}</span></td>
          <td class="num">${reqCancelBtn(r)}</td>
        </tr>`).join("")}</tbody>
      </table></div>` : ""}
    </div>`;
}

/* 신청 내용 한 줄 요약 (목록용) */
function attReqSummary(r) {
  if (r.type === "overtime") {
    return `${r.date} ${r.start}~${r.nextDay ? "익일 " : ""}${r.end} (총 ${fmtH(r.hours || 0)}시간)`;
  }
  return (r.text || "").replace(/\s+/g, " ").slice(0, 60);
}

/* 근태 결재 신청 폼 이벤트 바인딩 (renderAttRecord에서 호출) */
function bindAttReqSection() {
  const card = $("#atreq-card");
  if (!card || !$("#atr-submit")) return;
  let type = null;   // 항목을 고르기 전에는 입력 폼을 숨긴다
  let selDate = todayKST();

  const otMins = () => {
    let d = minOf(`${$("#atr-eh").value}:${$("#atr-em").value}`) - minOf(`${$("#atr-sh").value}:${$("#atr-sm").value}`);
    if (d <= 0) d += 1440;   // 자정을 넘긴 추가근무
    return d;
  };
  const updatePreview = () => {
    const pv = $("#atr-preview");
    if (!pv) return;
    const start = `${$("#atr-sh").value}:${$("#atr-sm").value}`;
    const end = `${$("#atr-eh").value}:${$("#atr-em").value}`;
    const mins = otMins();
    pv.innerHTML = `${esc(start)} ~ ${minOf(end) <= minOf(start) ? "익일 " : ""}${esc(end)}
      → 총 <b>${fmtH(blockHours(mins))}시간</b> 추가 근무`;
  };
  ["atr-sh", "atr-sm", "atr-eh", "atr-em"].forEach((id) => { $("#" + id).onchange = updatePreview; });
  updatePreview();

  card.querySelectorAll("[data-atrtype]").forEach((b) => {
    b.onclick = () => {
      type = b.dataset.atrtype;
      card.querySelectorAll("[data-atrtype]").forEach((x) => x.classList.toggle("on", x === b));
      $("#atr-pick").classList.add("hidden");
      $("#atr-body").classList.remove("hidden");
      $("#atr-overtime").classList.toggle("hidden", type !== "overtime");
      $("#atr-change").classList.toggle("hidden", type !== "change");
    };
  });

  $("#atr-date").onclick = () => openDatePicker($("#atr-date"), selDate, (v) => {
    if (!v) return;
    selDate = v;
    $("#atr-date-label").textContent = dateLabelKo(v);
  });

  $("#atr-submit").onclick = async () => {
    const btn = $("#atr-submit");
    if (btn.disabled) return;
    if (!type) { toast("추가근무 또는 근무변경을 먼저 선택하세요."); return; }
    const sel = $("#atr-approver");
    const base = {
      type, empId: me.id, name: me.name, dept: me.dept || "",
      approverId: sel.value,                                   // 결재 라우팅은 직원 ID 기준
      approver: sel.options[sel.selectedIndex].text.replace(" (본인 승인)", ""),
      status: "대기",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    let data;
    if (type === "overtime") {
      const start = `${$("#atr-sh").value}:${$("#atr-sm").value}`;
      const end = `${$("#atr-eh").value}:${$("#atr-em").value}`;
      if (start === end) { toast("시작과 종료 시간이 같습니다."); return; }
      const mins = otMins();
      data = { ...base, date: selDate, start, end, nextDay: minOf(end) <= minOf(start), mins, hours: blockHours(mins) };
    } else {
      const text = $("#atr-text").value.trim();
      if (!text) { toast("근무 변경 내용을 입력하세요."); return; }
      data = { ...base, text };
    }
    btn.disabled = true;
    await db.collection(COL.attRequests).add(data);
    toast(`${base.approver}님에게 ${ATT_REQ_LABEL[type]} 결재를 요청했습니다.`);
    renderAttend();
  };
}

/* 분 → 사람이 읽는 근무 길이: 60분 미만은 분만, 그 이상은 "n시간 n분" (0 이하는 0분) */
function durLabelKo(mins) {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}
/* 예정 시각 대비 편차(분) — 양수면 예정보다 늦음, 음수면 빠름 */
function inDevMin(inAt, shift) { return shift ? minOf(inAt) - minOf(shift.start) : 0; }
function outDevMin(outAt, outDate, workDate, shift) {
  if (!shift) return 0;
  const outM = minOf(outAt) + (outDate > workDate ? 1440 : 0);
  const endM = minOf(shift.end) + (shiftOvernight(shift) ? 1440 : 0);
  return outM - endM;
}
/* 확인 모달용 편차 태그 — 특이사항 칩과 같은 규칙(10분 유예 · 가산 제외자)을 쓰되 라벨은 짧게 */
function inDevChip(inAt, shift) {
  const d = inDevMin(inAt, shift);
  if (!shift) return "";
  if (d > ATT_GRACE_MIN) return `<span class="att-note late">지각 ${d}분</span>`;
  if (-d > ATT_GRACE_MIN && !isOtExemptEmp(me)) return `<span class="att-note earlyin">조기출근 ${-d}분</span>`;
  return "";
}
function outDevChip(outAt, outDate, workDate, shift) {
  const d = outDevMin(outAt, outDate, workDate, shift);
  if (!shift) return "";
  if (-d > ATT_GRACE_MIN) return `<span class="att-note earlyout">조기퇴근 ${-d}분</span>`;
  if (d > ATT_GRACE_MIN && !isOtExemptEmp(me)) return `<span class="att-note over">연장 ${d}분</span>`;
  return "";
}
const schedLabel = (shift) => shift
  ? `${esc(shift.start)} ~ ${esc(shiftEndLabel(shift))}`
  : `<span class="ioc-none">미등록</span>`;

/* 출근 확인 모달: 시각·날짜·예정 근무를 보여주고 [등록]을 눌러야 기록 (오클릭 방지) */
function openInConfirmModal({ time, workDate, shift, onConfirm }) {
  const p = dateParts(workDate);
  openModal(`
    <div class="ioc">
      <div class="ioc-icon in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
      <h3>출근 시간 확인</h3>
      <p class="ioc-sub">${esc(me.name)}님의 출근 시간</p>
      <div class="ioc-time">${esc(time)}</div>
      <div class="ioc-ampm in">(${kAmPmLabel(time)})</div>
      <div class="ioc-date">${p.y}년 ${p.m}월 ${p.d}일 (${"일월화수목금토"[p.dow]}) 근무</div>
      <div class="ioc-worked">
        <div class="iocw-row"><span>예정 근무</span><b>${schedLabel(shift)}</b></div>
        <div class="iocw-row total"><span>출근 시간</span>
          <b>${inDevChip(time, shift)}${esc(time)}</b></div>
      </div>
      <p class="ioc-q">위 시간으로 출근을 등록할까요?</p>
      <div class="ioc-actions">
        <button type="button" class="btn btn-ghost" id="ioc-cancel">취소</button>
        <button type="button" class="btn ioc-confirm in" id="ioc-ok">등록</button>
      </div>
    </div>`);
  $("#ioc-cancel").onclick = closeModal;
  $("#ioc-ok").onclick = () => {
    const b = $("#ioc-ok");
    if (b.disabled) return;
    b.disabled = true;
    onConfirm();
  };
}

/* 퇴근 확인 모달: 시각·날짜·총 근무시간을 크게 보여주고 확정 (오입력 방지) */
function openOutConfirmModal({ time, workDate, outDateEff, inAt, shift, breakIncl, onConfirm }) {
  const p = dateParts(workDate);
  // 총 근무는 실제 출퇴근 시각을 대조한 길이 (n시간 n분) — 휴게 포함이면 1시간 차감
  const spanMin = (minOf(time) + (outDateEff > workDate ? 1440 : 0)) - minOf(inAt);
  const netMin = Math.max(0, spanMin - (breakIncl ? 60 : 0));
  // 근태 기록에는 회사 표준 단위(10분 블록)로 환산돼 저장되므로 그 값도 함께 안내한다
  const recH = workedHours({ date: workDate, inAt, outAt: time, outDate: outDateEff, breakIncluded: breakIncl }, shift);
  const recNote = fmtH(recH ?? 0) !== fmtH(netMin / 60)
    ? `<div class="ioc-note">근태 기록에는 10분 단위로 환산해 <b>${fmtH(recH ?? 0)}h</b>로 반영됩니다.</div>` : "";
  openModal(`
    <div class="ioc">
      <div class="ioc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg></div>
      <h3>퇴근 시간 확인</h3>
      <p class="ioc-sub">${esc(me.name)}님의 퇴근 시간</p>
      <div class="ioc-time">${esc(time)}</div>
      <div class="ioc-ampm">(${kAmPmLabel(time)})</div>
      <div class="ioc-date">${p.y}년 ${p.m}월 ${p.d}일 (${"일월화수목금토"[p.dow]}) 근무${outDateEff !== workDate ? " · 익일 퇴근" : ""}</div>
      <div class="ioc-worked">
        <div class="iocw-row"><span>예정 근무</span><b>${schedLabel(shift)}</b></div>
        <div class="iocw-row"><span>출근 시간</span><b>${esc(inAt)}</b></div>
        <div class="iocw-row"><span>퇴근 시간</span>
          <b>${outDevChip(time, outDateEff, workDate, shift)}${outDateEff !== workDate ? "익일 " : ""}${esc(time)}</b></div>
        <div class="iocw-row total"><span>총 근무</span>
          <b>${breakIncl ? REST_BADGE : ""}${durLabelKo(netMin)}</b></div>
      </div>
      ${recNote}
      <p class="ioc-q">위 시간이 맞습니까?</p>
      <div class="ioc-actions">
        <button type="button" class="btn btn-ghost" id="ioc-cancel">취소</button>
        <button type="button" class="btn ioc-confirm" id="ioc-ok">퇴근 확인</button>
      </div>
    </div>`);
  $("#ioc-cancel").onclick = closeModal;
  $("#ioc-ok").onclick = () => {
    const b = $("#ioc-ok");
    if (b.disabled) return;
    b.disabled = true;
    onConfirm();
  };
}

/* ── 근무 캘린더 ── */
async function renderAttCalendar() {
  const body = $("#att-body");
  const today = todayKST();
  if (!atCalYm) atCalYm = ymNowKST();
  const [yy, mm] = atCalYm.split("-").map(Number);
  const [shiftSnap, emps] = await Promise.all([
    db.collection(COL.shifts).where("date", ">=", `${atCalYm}-01`).where("date", "<=", `${atCalYm}-31`).get(),
    loadActiveEmployees()
  ]);
  const shifts = shiftSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => (s.date || "").startsWith(atCalYm));
  const byDate = {};
  shifts.forEach((s) => { (byDate[s.date] = byDate[s.date] || []).push(s); });
  // 이번 달 근무자 + 재직 직원 전체에 겹치지 않는 색상 배정
  assignShiftColors([...shifts.map((s) => s.empId), ...emps.map((e) => e.id)]);

  const first = new Date(Date.UTC(yy, mm - 1, 1));
  const startDow = first.getUTCDay();
  const daysIn = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const cellHtml = (d, idx) => {
    if (!d) return `<div class="sc-cell blank"></div>`;
    const ds = `${yy}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = idx % 7;
    const list = byDate[ds] || [];
    const groups = WORK_AREAS.map((area) => {
      const g = list.filter((s) => s.area === area).sort((a, b) => minOf(a.start) - minOf(b.start));
      if (!g.length) return "";
      return `<span class="wa-label">${area}</span>` + g.map((s) =>
        `<span class="shift-ent ${shiftColor(s.empId)}"><b>${s.isTemp ? TEMP_BADGE : ""}${esc(s.name)}</b><i class="full">${shiftCompact(s)}</i><i class="st-only">${esc(s.start)}</i></span>`).join("");
    }).join("");
    return `<button type="button" class="sc-cell at-cell ${ds < today ? "past" : ""} ${ds === today ? "today" : ""}" data-atd="${ds}">
      <span class="d ${dow === 0 ? "sun" : dow === 6 ? "sat" : ""}">${d}</span>
      <span class="at-ents">${groups}</span>
    </button>`;
  };

  const monthEmps = [...new Map(shifts.map((s) => [s.empId, s.name])).entries()];
  body.innerHTML = `
    <div class="card">
      <div class="sc-cal-head">
        <button type="button" class="cal-nav" id="at-prev">&lsaquo;</button>
        <b class="sc-cal-title">${yy}년 ${mm}월</b>
        <button type="button" class="cal-nav" id="at-next">&rsaquo;</button>
        <button type="button" class="btn btn-ghost btn-sm" id="at-now">오늘</button>
      </div>
      <div class="at-cal-scroll">
        <div class="at-cal-inner">
          <div class="sc-dow">${["일", "월", "화", "수", "목", "금", "토"].map((d, i) =>
            `<span class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</span>`).join("")}</div>
          <div class="sc-grid at">${cells.map((d, i) => cellHtml(d, i)).join("")}</div>
        </div>
      </div>
      <div class="at-legend">
        ${monthEmps.map(([id, nm]) => `<span class="at-legend-item ${shiftColor(id)}">${String(id).startsWith("temp:") ? TEMP_BADGE : ""}${esc(nm)}</span>`).join("")}
        <span class="at-legend-note">${REST_ICON} 휴게 1시간 차감 · 날짜를 누르면 상세${canEditShiftCal() ? "·등록" : ""} 화면이 열립니다</span>
      </div>
    </div>`;

  const shiftMonth = (n) => {
    let y = yy, m = mm + n;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    atCalYm = `${y}-${String(m).padStart(2, "0")}`;
    renderAttend();
  };
  $("#at-prev").onclick = () => shiftMonth(-1);
  $("#at-next").onclick = () => shiftMonth(1);
  $("#at-now").onclick = () => { atCalYm = ymNowKST(); renderAttend(); };
  body.querySelectorAll("[data-atd]").forEach((b) => {
    b.onclick = () => openShiftDayModal(b.dataset.atd, emps);
  });
}

/* 근무 일정 일별 모달: 목록 + (관리자) 추가/수정/삭제 */
function openShiftDayModal(ds, emps) {
  const canEdit = canEditShiftCal();
  let showForm = false;
  let editing = null; // 수정 중인 shift

  const formHtml = () => {
    const s = editing || {};
    const [sh, sm] = (s.start || "09:00").split(":");
    const [eh, em] = (s.end || "18:00").split(":");
    const hOpts = hourOpts;
    // 근무 '예정' 일정은 5분 단위 (실제 출퇴근 기록만 1분 단위로 입력)
    const mOpts = (v) => Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0")).map((m) =>
      `<option ${m === v ? "selected" : ""}>${m}</option>`).join("");
    return `
    <div class="shift-form">
      <div class="sf-head"><b>${editing ? "일정 수정" : "새 스케줄"}</b><button type="button" class="icon-btn" id="sf-close">✕</button></div>
      <div class="grid-2">
        <label class="field"><span class="field-label">직원</span>
          <select id="sf-emp">${emps.map((e) =>
            `<option value="${e.id}" ${(editing ? s.empId === e.id : e.id === me.id) ? "selected" : ""}>${esc(e.name)} (${esc(e.dept)})</option>`).join("")}
            <option value="${TEMP_EMP_VALUE}" ${s.isTemp ? "selected" : ""}>+ 단기알바 (외부 인원)</option></select></label>
        <label class="field"><span class="field-label">근무 영역</span>
          <select id="sf-area">${WORK_AREAS.map((a) => `<option ${s.area === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
      </div>
      <div class="field ${s.isTemp ? "" : "hidden"}" id="sf-temp-wrap">
        <span class="field-label">단기알바 이름 <em class="sf-hint">(근무 일정에만 표시 · 직원 명단에는 추가되지 않습니다)</em></span>
        <input id="sf-tempname" value="${s.isTemp ? esc(s.name) : ""}" placeholder="예: 홍길동" maxlength="20" />
      </div>
      <div class="grid-2">
        <div class="field"><span class="field-label">시작</span>
          <div class="io-time"><select id="sf-sh">${hOpts(sh)}</select><b>:</b><select id="sf-sm">${mOpts(sm)}</select></div></div>
        <div class="field"><span class="field-label">종료 <em class="sf-hint">(시작보다 빠르면 익일)</em></span>
          <div class="io-time"><select id="sf-eh">${hOpts(eh)}</select><b>:</b><select id="sf-em">${mOpts(em)}</select></div></div>
      </div>
      <label class="sf-check"><input type="checkbox" id="sf-break" ${s.breakIncluded ? "checked" : ""} /> 휴게시간 포함 (총 근무시간에서 1시간 차감)</label>
      ${!editing ? `<label class="sf-check"><input type="checkbox" id="sf-repeat" /> 매주 반복 (이번 달의 같은 요일에 모두 등록)</label>` : ""}
      <div class="sf-preview" id="sf-preview"></div>
      <button type="button" class="btn btn-primary btn-block" id="sf-save" style="margin-top:12px">저장</button>
    </div>`;
  };

  /* 24시간 입력값을 오전/오후 문장으로 읽어주는 실시간 미리보기 */
  const updatePreview = () => {
    const pv = $("#sf-preview");
    if (!pv) return;
    const start = `${$("#sf-sh").value}:${$("#sf-sm").value}`;
    const end = `${$("#sf-eh").value}:${$("#sf-em").value}`;
    const brk = $("#sf-break").checked;
    const tmp = { start, end, breakIncluded: brk };
    if (start === end) { pv.textContent = ""; return; }
    const overnight = minOf(end) <= minOf(start);
    pv.innerHTML = `${kAmPmLabel(start)} ~ ${overnight ? "익일 " : ""}${kAmPmLabel(end)} (${fmtH(shiftHours(tmp))}시간)${brk ? " · 휴게시간 포함" : ""}`;
  };

  const renderM = async () => {
    const snap = await db.collection(COL.shifts).where("date", "==", ds).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.date === ds)
      .sort((a, b) => WORK_AREAS.indexOf(a.area) - WORK_AREAS.indexOf(b.area) || minOf(a.start) - minOf(b.start));
    openModal(`
      <div class="sf-top"><h3>${dateLabelKo(ds)} 근무</h3>
        ${canEdit && !showForm ? `<button class="btn btn-primary btn-sm" id="sh-addbtn">+ 추가</button>` : ""}</div>
      ${showForm ? formHtml() : ""}
      <div class="shift-list">
        ${list.length ? list.map((s) => `
          <div class="shift-row ${shiftColor(s.empId)}">
            <div class="sr-main"><b>${s.isTemp ? TEMP_BADGE : ""}${esc(s.name)}</b> <span class="sr-area">(${esc(s.area)})</span>
              <div class="sr-time">${shiftRangeHtml(s)}</div></div>
            ${canEdit ? `<button class="sr-act" data-shedit="${s.id}">수정</button>
              <button class="sr-act danger" data-shdel="${s.id}">삭제</button>` : ""}
          </div>`).join("") : `<div class="empty" style="padding:14px">등록된 근무가 없습니다.</div>`}
      </div>
      <div class="modal-actions"><button class="btn btn-ghost btn-sm" id="sh-close">닫기</button></div>`);

    $("#sh-close").onclick = () => { closeModal(); renderAttend(); };
    const addBtn = $("#sh-addbtn");
    if (addBtn) addBtn.onclick = () => { showForm = true; editing = null; renderM(); };
    const sfClose = $("#sf-close");
    if (sfClose) sfClose.onclick = () => { showForm = false; editing = null; renderM(); };
    if (showForm) {
      ["sf-sh", "sf-sm", "sf-eh", "sf-em"].forEach((id) => { $("#" + id).onchange = updatePreview; });
      $("#sf-break").onchange = updatePreview;
      updatePreview();
      // 단기알바 선택 시 이름 입력칸 표시
      const empSel = $("#sf-emp");
      const syncTemp = () => {
        $("#sf-temp-wrap").classList.toggle("hidden", empSel.value !== TEMP_EMP_VALUE);
        if (empSel.value === TEMP_EMP_VALUE) $("#sf-tempname").focus();
      };
      empSel.onchange = syncTemp;
    }

    $("#modal").querySelectorAll("[data-shedit]").forEach((b) => {
      b.onclick = () => { editing = list.find((x) => x.id === b.dataset.shedit); showForm = true; renderM(); };
    });
    $("#modal").querySelectorAll("[data-shdel]").forEach((b) => {
      b.onclick = async () => {
        const s = list.find((x) => x.id === b.dataset.shdel);
        if (!confirm(`${s.name}님의 ${ds} ${s.start}~${shiftEndLabel(s)} 근무를 삭제할까요?`)) return;
        await db.collection(COL.shifts).doc(s.id).delete();
        renderM();
      };
    });

    const save = $("#sf-save");
    if (save) save.onclick = async () => {
      if (save.disabled) return;
      save.disabled = true;
      const selVal = $("#sf-emp").value;
      const isTemp = selVal === TEMP_EMP_VALUE;
      let who;
      if (isTemp) {
        const nm = ($("#sf-tempname").value || "").trim();
        if (!nm) { toast("단기알바 이름을 입력하세요."); save.disabled = false; return; }
        who = { id: tempEmpId(nm), name: nm };
      } else {
        const emp = emps.find((e) => e.id === selVal);
        if (!emp) { toast("직원을 선택하세요."); save.disabled = false; return; }
        who = { id: emp.id, name: emp.name };
      }
      const start = `${$("#sf-sh").value}:${$("#sf-sm").value}`;
      const end = `${$("#sf-eh").value}:${$("#sf-em").value}`;
      if (start === end) { toast("시작과 종료 시간이 같습니다."); save.disabled = false; return; }
      const data = {
        empId: who.id, name: who.name, isTemp, area: $("#sf-area").value,
        start, end, breakIncluded: $("#sf-break").checked,
        updatedBy: me.id
      };
      if (editing) {
        await db.collection(COL.shifts).doc(editing.id).set({ ...data, date: editing.date }, { merge: true });
      } else {
        const dates = [ds];
        if ($("#sf-repeat")?.checked) {
          const d = new Date(ds + "T00:00:00Z");
          for (;;) {
            d.setUTCDate(d.getUTCDate() + 7);
            const nd = d.toISOString().slice(0, 10);
            if (!nd.startsWith(ds.slice(0, 7))) break;
            dates.push(nd);
          }
        }
        for (const dt of dates) {
          await db.collection(COL.shifts).add({ ...data, date: dt, createdBy: me.id, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        if (dates.length > 1) toast(`${dates.length}일(매주 반복)에 등록했습니다.`);
      }
      showForm = false;
      editing = null;
      renderM();
    };
  };
  renderM();
}

/* ── 근무 이력 (본인) ── */
async function renderAttHistory() {
  const body = $("#att-body");
  if (!atHistYm) atHistYm = ymNowKST();
  const [yy, mm] = atHistYm.split("-").map(Number);
  const [shiftSnap, attSnap, reqSnap, emps] = await Promise.all([
    db.collection(COL.shifts).where("date", ">=", `${atHistYm}-01`).where("date", "<=", `${atHistYm}-31`).get(),
    db.collection(COL.attendance).where("date", ">=", `${atHistYm}-01`).where("date", "<=", `${atHistYm}-31`).get(),
    db.collection(COL.attRequests).where("empId", "==", me.id).get(),
    loadActiveEmployees()
  ]);
  // 날짜·종류별 결재 상태 (반려 건은 다시 요청할 수 있도록 덮어쓰지 않는다)
  const reqSt = {};
  reqSnap.docs.map((d) => d.data())
    .filter((r) => r.empId === me.id && r.type === "overtime" && r.otKind)
    .forEach((r) => {
      const key = `${r.date}|${r.otKind}`;
      if (reqSt[key] !== "승인" && (r.status === "승인" || reqSt[key] !== "대기")) reqSt[key] = r.status;
    });
  const reqOfDate = (d) => (kind) => reqSt[`${d}|${kind}`];
  const myShifts = shiftSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => s.empId === me.id && (s.date || "").startsWith(atHistYm));
  const myAtts = attSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.empId === me.id && (a.date || "").startsWith(atHistYm));
  const shiftBy = {}; myShifts.forEach((s) => { shiftBy[s.date] = s; });
  const attBy = {}; myAtts.forEach((a) => { attBy[a.date] = a; });
  const allDates = [...new Set([...myShifts.map((s) => s.date), ...myAtts.map((a) => a.date)])].sort().reverse();

  const schedDays = new Set(myShifts.map((s) => s.date)).size;
  const schedH = myShifts.reduce((s, x) => s + shiftHours(x), 0);
  const workedDays = myAtts.filter((a) => a.inAt).length;
  const workedH = allDates.reduce((sum, d) => sum + (workedHours(attBy[d], shiftBy[d]) || 0), 0);
  // 요약에는 승인·확정된 항목만 집계한다 (미승인 추가근무는 상세 행에만 무채색으로 노출)
  const agg = { late: { n: 0, h: 0 }, earlyin: { n: 0, h: 0 }, earlyout: { n: 0, h: 0 }, over: { n: 0, h: 0 }, night: { n: 0, h: 0 } };
  allDates.forEach((d) => attNotes(attBy[d], shiftBy[d], reqOfDate(d))
    .filter((n) => n.approved)
    .forEach((n) => { agg[n.k].n++; agg[n.k].h += n.h || 0; }));
  // 0값 항목은 표기하지 않음 · 시간이 있는 항목은 "Xh (n회)" 형식
  const chipLabel = (a, label) => a.h ? `${label} ${fmtH(a.h)}h (${a.n}회)` : `${label} ${a.n}회`;
  const summaryChips = [
    ["late", "지각"], ["earlyin", "조기출근"], ["earlyout", "조기퇴근"], ["over", "연장"], ["night", "야간근무"]
  ].filter(([k]) => agg[k].n > 0)
    .map(([k, label]) => `<span class="att-note ${k}">${chipLabel(agg[k], label)}</span>`)
    .join("");

  body.innerHTML = `
    <div class="card">
      <div class="card-title"><div>${esc(me.name)}님의 근무 이력입니다.</div></div>
      <div class="sc-cal-head">
        <button type="button" class="cal-nav" id="ah-prev">&lsaquo;</button>
        <b class="sc-cal-title">${yy}년 ${mm}월</b>
        <button type="button" class="cal-nav" id="ah-next">&rsaquo;</button>
        <button type="button" class="btn btn-ghost btn-sm" id="ah-now">이번 달</button>
      </div>
      <div class="pb-stats s4">
        <div><span>근무 예정일</span><b>${schedDays}일</b></div>
        <div><span>예정 근무시간</span><b>${fmtH(schedH)}h</b></div>
        <div><span>실 근무일</span><b class="c-green">${workedDays}일</b></div>
        <div><span>실 근무시간</span><b class="c-green">${fmtH(workedH)}h</b></div>
      </div>
      ${summaryChips ? `<div class="att-notecnt">${summaryChips}</div>` : ""}
      <div class="mini-note">출퇴근 등록 시 예정 시간 전후 10분까지 정상으로 처리됩니다.</div>
      ${allDates.length ? `<div class="table-wrap"><table class="data att-table">
        <thead><tr><th>날짜</th><th>예정</th><th>출근</th><th>퇴근</th><th class="num">예정(h)</th><th class="num">실근무(h)</th><th>비고</th></tr></thead>
        <tbody>${allDates.map((d) => {
          const s = shiftBy[d], a = attBy[d];
          const wh = workedHours(a, s);
          return `<tr>
            <td class="att-mono"><b>${d.slice(5)}</b> <span class="att-dow">(${"일월화수목금토"[dateParts(d).dow]})</span></td>
            <td class="att-mono">${s ? `${s.start}-${shiftEndLabel(s)}` : "-"}</td>
            <td class="att-mono ${a?.inAt ? "c-green" : ""}">${a?.inAt || "-"}</td>
            <td class="att-mono ${a?.outAt ? "c-red" : ""}">${a?.outAt || "-"}</td>
            <td class="num">${s ? fmtH(shiftHours(s)) : "-"}</td>
            <td class="num">${wh != null && breakApplied(a, s) ? REST_BADGE : ""}<b>${wh != null ? fmtH(wh) : "-"}</b></td>
            <td>${noteChips(attNotes(a, s, reqOfDate(d)), d) || "-"}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
      <div class="mini-note">조기출근·연장 태그를 누르면 그 건만 결재에 올릴 수 있습니다.
        승인된 건만 위 요약과 급여 가산에 반영됩니다.</div>` : `<div class="empty">${mm}월 근무 기록이 없습니다.</div>`}
    </div>`;

  // 태그 클릭 → 그 날짜·종류만 결재 요청
  body.querySelectorAll("[data-otreq]").forEach((b) => {
    b.onclick = () => {
      const [date, kind, mins] = b.dataset.otreq.split("|");
      openOtRequestModal({
        date, kind, mins: Number(mins), shift: shiftBy[date], emps,
        onDone: () => renderAttend()
      });
    };
  });

  const shiftMonth = (n) => {
    let y = yy, m = mm + n;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    atHistYm = `${y}-${String(m).padStart(2, "0")}`;
    renderAttend();
  };
  $("#ah-prev").onclick = () => shiftMonth(-1);
  $("#ah-next").onclick = () => shiftMonth(1);
  $("#ah-now").onclick = () => { atHistYm = ymNowKST(); renderAttend(); };
}

/* ── 근태관리 (관리자: 전 직원 이력 + 메모) ── */
let admOpenIds = new Set();
let admAttEmp = ""; // "" = 전체 직원
async function renderAttendAdmin() {
  if (!canEditShifts() && !isManager()) return navigate("home", null, true);
  const main = $("#main");
  if (!admAttYm) admAttYm = ymNowKST();
  const [yy, mm] = admAttYm.split("-").map(Number);
  main.innerHTML = pageHead("ADMIN", "근태관리", "전 직원의 출퇴근·근무 이력을 한눈에 확인하고 기록별 메모를 남깁니다.") +
    `<div id="adm-body"><div class="empty">불러오는 중...</div></div>`;

  const [shiftSnap, attSnap, emps, arSnap] = await Promise.all([
    db.collection(COL.shifts).where("date", ">=", `${admAttYm}-01`).where("date", "<=", `${admAttYm}-31`).get(),
    db.collection(COL.attendance).where("date", ">=", `${admAttYm}-01`).where("date", "<=", `${admAttYm}-31`).get(),
    loadActiveEmployees(),
    db.collection(COL.attRequests).get()
  ]);
  const allReqs = arSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // 나를 결재자로 지정한 대기 건 (월 필터와 무관하게 항상 표시)
  const myApprovals = allReqs
    .filter((r) => r.status === "대기" && isMyApproval(r))
    .sort((a, b) => tsSec(a.createdAt) - tsSec(b.createdAt));
  // 직원·날짜·종류별 결재 상태 (칩을 승인/대기/미신청으로 구분하기 위함)
  const reqSt = {};
  allReqs.filter((r) => r.type === "overtime" && r.otKind).forEach((r) => {
    const key = `${r.empId}|${r.date}|${r.otKind}`;
    if (reqSt[key] !== "승인" && (r.status === "승인" || reqSt[key] !== "대기")) reqSt[key] = r.status;
  });
  const reqOfFor = (empId, date) => (kind) => reqSt[`${empId}|${date}|${kind}`];
  const shifts = shiftSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => (s.date || "").startsWith(admAttYm));
  const atts = attSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => (a.date || "").startsWith(admAttYm));

  // 직원 목록: 재직 직원 + (이번 달 근무 기록이 있는 외부 인원)
  const people = new Map();
  emps.forEach((e) => people.set(e.id, { id: e.id, name: e.name, dept: e.dept, role: e.role }));
  [...shifts, ...atts].forEach((x) => {
    // 단기알바 등 직원 명단에 없는 인원은 일반 권한과 동일하게 취급한다.
    if (x.empId && !people.has(x.empId)) people.set(x.empId, { id: x.empId, name: x.name, dept: x.dept || "-", role: "member" });
  });

  // 직원 필터 (전체 포함) — 출퇴근을 입력한 기록만 표시
  const enteredAtts = atts.filter((a) => a.inAt);
  const filtered = [...people.values()].filter((p) => (!admAttEmp || p.id === admAttEmp));

  const rowsHtml = filtered.map((p) => {
    const pShifts = shifts.filter((s) => s.empId === p.id);
    const pAtts = enteredAtts.filter((a) => a.empId === p.id);
    if (!pAtts.length) return ""; // 출퇴근 입력 기록이 있는 직원만 노출
    const shiftBy = {}; pShifts.forEach((s) => { shiftBy[s.date] = s; });
    const attBy = {}; pAtts.forEach((a) => { attBy[a.date] = a; });
    const dates = pAtts.map((a) => a.date).sort().reverse();
    const schedH = pShifts.reduce((s, x) => s + shiftHours(x), 0);
    const workedH = dates.reduce((sum, d) => sum + (workedHours(attBy[d], shiftBy[d]) || 0), 0);
    // 제목행 요약에는 승인·확정된 항목만 집계 (미승인 추가근무는 상세 행에만 무채색으로 노출)
    const agg = { late: { n: 0, h: 0 }, earlyin: { n: 0, h: 0 }, earlyout: { n: 0, h: 0 }, over: { n: 0, h: 0 }, night: { n: 0, h: 0 } };
    dates.forEach((d) => attNotes(attBy[d], shiftBy[d], reqOfFor(p.id, d))
      .filter((n) => n.approved)
      .forEach((n) => { agg[n.k].n++; agg[n.k].h += n.h || 0; }));
    const noteSummary = [["late", "지각"], ["earlyin", "조기출근"], ["earlyout", "조기퇴근"], ["over", "연장"], ["night", "야간"]]
      .filter(([k]) => agg[k].n > 0)
      .map(([k, label]) => `<span class="att-note ${k}">${agg[k].h ? `${label} ${fmtH(agg[k].h)}h (${agg[k].n}회)` : `${label} ${agg[k].n}회`}</span>`)
      .join("");
    const open = admAttEmp === p.id || admOpenIds.has(p.id);
    // 매니저는 자신과 같거나 낮은 권한(매니저·일반)의 기록만 편집할 수 있다.
    const readOnly = !canEditAttOf(p.role);
    const detail = `
      <table class="data att-table adm-detail">
        <thead><tr><th>날짜</th><th>예정</th><th>출근</th><th>퇴근</th><th class="num">실근무(h)</th><th>비고</th><th>메모</th>${readOnly ? "" : "<th></th>"}</tr></thead>
        <tbody>${dates.map((d) => {
          const s = shiftBy[d], a = attBy[d];
          const wh = workedHours(a, s);
          return `<tr>
            <td class="att-mono"><b>${d.slice(5)}</b></td>
            <td class="att-mono">${s ? `${s.start}-${shiftEndLabel(s)}` : "-"}</td>
            <td class="att-mono c-green">${a.inAt}</td>
            <td class="att-mono ${a.outAt ? "c-red" : ""}">${a.outAt || "-"}</td>
            <td class="num">${wh != null && breakApplied(a, s) ? REST_BADGE : ""}<b>${wh != null ? fmtH(wh) : "-"}</b></td>
            <td>${noteChips(attNotes(a, s, reqOfFor(p.id, d))) || "-"}</td>
            <td class="adm-memo-td"><input class="adm-memo" data-memo="${p.id}|${d}" value="${esc(a.memo || "")}" placeholder="메모 입력 후 Enter" maxlength="100" ${readOnly ? "readonly" : ""} /></td>
            ${readOnly ? "" : `<td class="adm-acts">
              <button class="icon-btn" data-attedit="${p.id}|${d}" title="출퇴근 수정"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 0 1 4 4L8 20l-5 1 1-5L17 3Z"/></svg></button>
              <button class="icon-btn" data-attdel="${p.id}|${d}" title="기록 삭제"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/><path d="M10 11v6M14 11v6"/></svg></button>
            </td>`}
          </tr>`;
        }).join("")}</tbody>
      </table>`;
    return `<tr class="ph-click" data-admtoggle="${p.id}">
        <td><b>${esc(p.name)}</b></td><td>${esc(p.dept)}</td>
        <td class="num">${new Set(pShifts.map((s) => s.date)).size}일 / <b class="c-green">${pAtts.length}일</b></td>
        <td class="num">${fmtH(schedH)}h / <b class="c-green">${fmtH(workedH)}h</b></td>
        <td>${noteSummary || "-"}</td>
      </tr>
      <tr class="ph-detail-tr ${open ? "" : "hidden"}" data-admdetail="${p.id}"><td colspan="5"><div class="ph-detail ph-anim">${detail}</div></td></tr>`;
  }).join("");

  // 필터 드롭다운 목록: 이번 달 출퇴근 입력이 있는 직원 + 재직 직원
  const empOptions = [...people.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .map((p) => `<option value="${p.id}" ${admAttEmp === p.id ? "selected" : ""}>${esc(p.name)} (${esc(p.dept)})</option>`).join("");
  // 선택한 직원을 대신해 출퇴근을 직접 입력할 수 있는지 (매니저는 매니저·일반 권한까지만)
  const canAddForSel = !!admAttEmp && canEditAttOf(people.get(admAttEmp)?.role);

  $("#adm-body").innerHTML = `
    <div class="card">
      <div class="card-title"><div>내 결재 대기 <span class="badge warn">${myApprovals.length}건</span>
        <div class="ct-desc">나를 결재자로 지정한 추가근무·근무변경 신청만 표시됩니다.</div></div></div>
      ${myApprovals.length ? `<div class="table-wrap"><table class="data pay-table">
        <thead><tr><th>구분</th><th>신청자</th><th>내용</th><th>신청일시</th><th></th></tr></thead>
        <tbody>${myApprovals.map((r) => `<tr>
          <td><span class="badge ${r.type === "overtime" ? "admin" : "manager"}">${ATT_REQ_LABEL[r.type] || "-"}</span></td>
          <td><b>${esc(r.name)}</b><span class="atr-dept">${esc(r.dept || "-")}</span></td>
          <td class="atr-sum">${esc(attReqSummary(r))}</td>
          <td>${fmtTs(r.createdAt)}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-primary btn-sm" data-arok="${r.id}">승인</button>
            <button class="btn btn-danger btn-sm" data-arno="${r.id}">반려</button></td>
        </tr>`).join("")}</tbody></table></div>`
        : `<div class="empty">나에게 올라온 결재 대기 건이 없습니다.</div>`}
    </div>
    <div class="card">
      <div class="sc-cal-head">
        <button type="button" class="cal-nav" id="adm-prev">&lsaquo;</button>
        <b class="sc-cal-title">${yy}년 ${mm}월</b>
        <button type="button" class="cal-nav" id="adm-next">&rsaquo;</button>
        <button type="button" class="btn btn-ghost btn-sm" id="adm-now">이번 달</button>
      </div>
      <div class="adm-filter">
        <select id="adm-emp">
          <option value="" ${!admAttEmp ? "selected" : ""}>전체 직원</option>
          ${empOptions}
        </select>
        ${canAddForSel
          ? `<button type="button" class="btn btn-primary btn-sm" id="adm-add">+ 출퇴근 입력</button>`
          : ""}
        <span class="adm-filter-note">${canAddForSel
          ? "직원을 대신해 출퇴근을 직접 기록할 수 있습니다."
          : "출퇴근을 입력한 기록만 표시됩니다."}</span>
      </div>
      ${rowsHtml.trim() ? `<div class="table-wrap"><table class="data att-table">
        <thead><tr><th>이름</th><th>소속</th><th class="num">근무일 (예정/완료)</th><th class="num">근무시간 (예정/완료)</th><th>특이사항</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
      <div class="mini-note">직원을 클릭하면 일별 이력이 펼쳐집니다. 메모는 입력 후 Enter로 저장됩니다.</div>`
      : `<div class="empty">${mm}월${admAttEmp ? " 해당 직원의" : ""} 출퇴근 입력 기록이 없습니다.${canAddForSel ? " [+ 출퇴근 입력]으로 직접 기록할 수 있습니다." : ""}</div>`}
    </div>`;

  // 근태 결재 승인 / 반려
  $("#adm-body").querySelectorAll("[data-arok]").forEach((b) => {
    b.onclick = async () => {
      if (b.disabled) return;
      b.disabled = true;
      const r = myApprovals.find((x) => x.id === b.dataset.arok);
      const cur = await db.collection(COL.attRequests).doc(r.id).get();
      if (!cur.exists || cur.data().status !== "대기") { toast("이미 처리된 신청입니다."); renderAttendAdmin(); return; }
      await db.collection(COL.attRequests).doc(r.id).update({
        status: "승인", decidedBy: me.name, decidedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      // 근무변경은 승인 즉시 신청자 부서 전체에 공지로 자동 게시된다.
      if (r.type === "change") {
        await db.collection(COL.notices).add({
          title: `근무 변경 안내 (${r.name})`,
          body: r.text || "",
          scope: "dept", depts: [r.dept], targetIds: [],
          authorId: me.id, authorName: me.name,
          ackIds: [me.id],   // 결재자 본인은 이미 확인한 것으로 처리
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        toast(`승인 완료 — ${r.dept} 전원에게 공지로 게시했습니다.`);
      } else {
        // 추가근무는 승인 즉시 신청자의 해당 날짜 근무 이력에 반영한다 (승인분만 급여 가산 대상)
        await db.collection(COL.attendance).doc(`${r.empId}_${r.date}`).set({
          empId: r.empId, name: r.name, dept: r.dept || "", date: r.date,
          otApprovedMin: firebase.firestore.FieldValue.increment(Number(r.mins) || 0)
        }, { merge: true });
        toast(`${r.name}님의 추가근무 ${r.mins}분(가산 ${fmtH(r.hours || 0)}h)을 승인해 근무 이력에 반영했습니다.`);
      }
      updateAttApprovalAlarm();
      renderAttendAdmin();
    };
  });
  $("#adm-body").querySelectorAll("[data-arno]").forEach((b) => {
    b.onclick = async () => {
      const r = myApprovals.find((x) => x.id === b.dataset.arno);
      if (!confirm(`${r.name}님의 ${ATT_REQ_LABEL[r.type]} 신청을 반려할까요?\n\n${attReqSummary(r)}`)) return;
      await db.collection(COL.attRequests).doc(r.id).update({
        status: "반려", decidedBy: me.name, decidedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast("반려했습니다.");
      updateAttApprovalAlarm();
      renderAttendAdmin();
    };
  });

  $("#adm-emp").onchange = (ev) => { admAttEmp = ev.target.value; renderAttendAdmin(); };
  const addBtn = $("#adm-add");
  if (addBtn) addBtn.onclick = () => {
    const p = people.get(admAttEmp);
    if (p) openAttEditModal(p, null, null, (d) => shifts.find((s) => s.date === d && s.empId === p.id));
  };

  const shiftMonth = (n) => {
    let y = yy, m = mm + n;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    admAttYm = `${y}-${String(m).padStart(2, "0")}`;
    renderAttendAdmin();
  };
  $("#adm-prev").onclick = () => shiftMonth(-1);
  $("#adm-next").onclick = () => shiftMonth(1);
  $("#adm-now").onclick = () => { admAttYm = ymNowKST(); renderAttendAdmin(); };
  $("#adm-body").querySelectorAll("[data-admtoggle]").forEach((row) => {
    row.onclick = (ev) => {
      if (ev.target.closest("input")) return;
      const id = row.dataset.admtoggle;
      const detail = $("#adm-body").querySelector(`[data-admdetail="${id}"]`);
      if (!detail) return;
      detail.classList.toggle("hidden");
      if (detail.classList.contains("hidden")) admOpenIds.delete(id); else admOpenIds.add(id);
    };
  });
  $("#adm-body").querySelectorAll("[data-memo]").forEach((inp) => {
    const saveMemo = async () => {
      const [empId, date] = inp.dataset.memo.split("|");
      const p = people.get(empId);
      await db.collection(COL.attendance).doc(`${empId}_${date}`)
        .set({ empId, name: p?.name || "", date, memo: inp.value.trim() }, { merge: true });
      toast("메모를 저장했습니다.");
    };
    inp.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); inp.blur(); } };
    inp.onchange = saveMemo;
  });
  // 출퇴근 기록 수정/삭제
  $("#adm-body").querySelectorAll("[data-attedit]").forEach((b) => {
    b.onclick = () => {
      const [empId, date] = b.dataset.attedit.split("|");
      const att = atts.find((a) => a.empId === empId && a.date === date);
      const p = people.get(empId);
      if (att && p) openAttEditModal(p, date, att, (d) => shifts.find((s) => s.date === d && s.empId === empId));
    };
  });
  $("#adm-body").querySelectorAll("[data-attdel]").forEach((b) => {
    b.onclick = async () => {
      const [empId, date] = b.dataset.attdel.split("|");
      const p = people.get(empId);
      if (!confirm(`${p?.name || "?"}님의 ${date} 출퇴근 기록을 정말로 삭제할까요?\n삭제하면 복구할 수 없습니다.`)) return;
      await db.collection(COL.attendance).doc(`${empId}_${date}`).delete();
      toast("출퇴근 기록을 삭제했습니다.");
      renderAttendAdmin();
    };
  });
}

/* 관리자 출퇴근 입력/수정 모달
   att === null 이면 신규 입력 모드 (날짜를 직접 고를 수 있음)
   shiftOf(date) 로 해당일 근무 일정을 조회해 휴게 차감 기본값을 맞춘다 */
function openAttEditModal(emp, date, att, shiftOf = () => null) {
  const isNew = !att;
  const rec = att || {};
  let selDate = date || todayKST();
  const brkDefault = breakApplied(rec, shiftOf(selDate));
  const hOpts = hourOpts, mOpts = minOpts;   // 출퇴근 기록은 1분 단위
  const [ih, im] = (rec.inAt || "09:00").split(":");
  const [oh, om] = (rec.outAt || "18:00").split(":");
  openModal(`
    <h3>${esc(emp.name)} 출퇴근 ${isNew ? "입력" : "수정"}</h3>
    ${isNew
      ? `<p class="modal-desc">관리자가 대신 기록합니다. 날짜와 시간을 확인한 후 저장하세요.</p>
         <div class="field"><span class="field-label">기록 날짜</span>
           <button type="button" class="cal-input" id="ae-date"><span id="ae-date-label">${dateLabelKo(selDate)}</span>${CAL_ICON}</button></div>`
      : `<p class="modal-desc">${esc(date)} 기록을 수정합니다.</p>`}
    <div class="grid-2">
      <div class="field"><span class="field-label">출근 시간</span>
        <div class="io-time"><select id="ae-ih">${hOpts(ih)}</select><b>:</b><select id="ae-im">${mOpts(im)}</select></div></div>
      <div class="field"><span class="field-label">퇴근 시간</span>
        <div class="io-time"><select id="ae-oh">${hOpts(oh)}</select><b>:</b><select id="ae-om">${mOpts(om)}</select></div></div>
    </div>
    <label class="sf-check"><input type="checkbox" id="ae-nd" ${rec.outDate && rec.outDate > rec.date ? "checked" : ""} /> 익일 퇴근 (자정을 넘겨 퇴근)</label>
    <label class="sf-check"><input type="checkbox" id="ae-brk" ${brkDefault ? "checked" : ""} /> 휴게시간 포함 (실근무에서 1시간 차감)</label>
    <div class="ae-preview" id="ae-preview"></div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="ae-cancel">취소</button>
      <button type="button" class="btn btn-primary" id="ae-save">저장</button>
    </div>`);
  $("#ae-cancel").onclick = closeModal;

  /* 저장 전 실근무 시간 미리보기 (휴게 차감이 눈에 보이도록) */
  const updatePreview = () => {
    const pv = $("#ae-preview");
    if (!pv) return;
    const inAt = `${$("#ae-ih").value}:${$("#ae-im").value}`;
    const outAt = `${$("#ae-oh").value}:${$("#ae-om").value}`;
    const brk = $("#ae-brk").checked;
    const outDate = $("#ae-nd").checked ? nextDateStr(selDate) : selDate;
    const wh = workedHours({ date: selDate, inAt, outAt, outDate, breakIncluded: brk }, shiftOf(selDate));
    pv.innerHTML = `${esc(inAt)} ~ ${$("#ae-nd").checked ? "익일 " : ""}${esc(outAt)}${brk ? " · 휴게 1시간 차감" : ""}
      → 실근무 <b>${fmtH(wh ?? 0)}시간</b>`;
  };
  ["ae-ih", "ae-im", "ae-oh", "ae-om", "ae-nd", "ae-brk"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.onchange = updatePreview;
  });
  updatePreview();

  const dateBtn = $("#ae-date");
  if (dateBtn) dateBtn.onclick = () => openDatePicker(dateBtn, selDate, (v) => {
    if (!v) return;
    if (v > todayKST()) { toast("미래 날짜에는 기록할 수 없습니다."); return; }
    selDate = v;
    $("#ae-date-label").textContent = dateLabelKo(v);
    // 선택한 날짜의 근무 일정에 맞춰 휴게 차감 기본값 갱신
    $("#ae-brk").checked = !!shiftOf(v)?.breakIncluded;
    updatePreview();
  });
  $("#ae-save").onclick = async () => {
    const save = $("#ae-save");
    if (save.disabled) return;
    const inAt = `${$("#ae-ih").value}:${$("#ae-im").value}`;
    const nextDay = $("#ae-nd").checked;
    const outAt = `${$("#ae-oh").value}:${$("#ae-om").value}`;
    // 같은 날짜인데 퇴근이 출근보다 빠르면 익일 퇴근으로 체크해야 함
    if (!nextDay && outAt < inAt) {
      toast(`퇴근(${outAt})이 출근(${inAt})보다 빠릅니다. 자정을 넘겼다면 [익일 퇴근]을 체크하세요.`);
      return;
    }
    if (isNew) {
      const exist = await db.collection(COL.attendance).doc(`${emp.id}_${selDate}`).get();
      if (exist.exists && !confirm(`${emp.name}님의 ${selDate} 기록이 이미 있습니다. 덮어쓸까요?`)) return;
    }
    save.disabled = true;
    // 관리자가 대신 입력할 때는 항상 출근·퇴근을 함께 확정 저장한다.
    // 휴게 차감 여부도 기록에 직접 저장 (일정 설정과 무관하게 이 기록에 확정 적용)
    const data = {
      empId: emp.id, name: emp.name, dept: emp.dept || "", date: selDate,
      inAt, outAt, outDate: nextDay ? nextDateStr(selDate) : selDate,
      breakIncluded: $("#ae-brk").checked
    };
    await db.collection(COL.attendance).doc(`${emp.id}_${selDate}`).set(data, { merge: true });
    closeModal();
    toast(`${emp.name}님의 ${selDate} 출퇴근을 ${isNew ? "입력" : "수정"}했습니다.`);
    admAttEmp = emp.id;
    renderAttendAdmin();
  };
}

/* ───────── 연차관리 (관리자 메뉴) ───────── */
async function renderLeaveAdmin() {
  if (!isAdmin() && !isSpecial() && !isManager() && me.role !== "executive") return navigate("leave", null, true);
  const main = $("#main");
  main.innerHTML = pageHead("ADMIN", "연차관리",
    "휴가 신청 승인과 전 직원 연차 현황을 관리합니다.",
    isAdmin() ? `<button class="btn btn-primary btn-sm" id="lv-use">+ 사용 기록 추가</button>
                 <button class="btn btn-ghost btn-sm" id="lv-alloc">할당 일수 설정</button>` : "") +
    `<div id="lva-body"><div class="empty">불러오는 중...</div></div>`;

  const [empSnap, lvSnap, reqSnap] = await Promise.all([
    db.collection(COL.employees).where("status", "==", "재직").get(),
    db.collection(COL.leaves).get(),
    db.collection(COL.leaveRequests).where("status", "==", "대기").get()
  ]);
  const lvMap = {};
  lvSnap.docs.forEach((d) => (lvMap[d.id] = d.data()));
  const emps = empSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) =>
    DEPTS.indexOf(a.dept) - DEPTS.indexOf(b.dept) || a.name.localeCompare(b.name, "ko"));
  // 갱신일이 도래한 직원의 연차를 자동 리셋 (이전 주기는 history 보존)
  for (const e of emps) {
    if (lvMap[e.id]) lvMap[e.id] = await maybeResetLeave(e.id, lvMap[e.id]);
  }
  // 결재는 신청자가 지정한 결재자에게만 올라간다 — 본인 앞으로 온 건만 노출.
  const reqs = reqSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => isMyApproval(r))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const pastCycles = emps.flatMap((e) => ((lvMap[e.id] || {}).history || [])
    .map((h) => ({ name: e.name, dept: e.dept, ...h })))
    .sort((a, b) => (b.end || "").localeCompare(a.end || ""));

  $("#lva-body").innerHTML = `
    <div class="card">
      <div class="card-title"><div>내 결재 대기 <span class="badge warn">${reqs.length}건</span>
        <div class="ct-desc">나를 결재자로 지정한 신청만 표시됩니다.</div></div></div>
      ${reqs.length ? `<div class="table-wrap"><table class="data pay-table">
        <thead><tr><th>직원</th><th>신청일시</th><th>기간</th><th>유형</th><th>결재자</th><th class="num">일수</th><th></th></tr></thead>
        <tbody>${reqs.map((r) => `<tr>
          <td><b>${esc(r.name)}</b></td><td>${fmtTs(r.createdAt)}</td><td>${fmtPeriod(r.date, r.endDate)}</td><td>${esc(r.type)}</td>
          <td>${esc(r.approver || "-")}</td>
          <td class="num">${r.days}일</td>
          <td style="white-space:nowrap">
            <button class="btn btn-primary btn-sm" data-approve="${r.id}">승인</button>
            <button class="btn btn-danger btn-sm" data-reject="${r.id}">반려</button></td>
        </tr>`).join("")}</tbody></table></div>`
        : `<div class="empty">나에게 올라온 대기 중인 신청이 없습니다.</div>`}
    </div>
    <div id="lva-cal"><div class="card"><div class="empty">일정 캘린더 불러오는 중...</div></div></div>
    <div class="card">
      <div class="card-title"><div>전 직원 연차 현황<div class="ct-desc">직원을 클릭하면 등록된 연차 사용 이력이 펼쳐집니다.</div></div></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>이름</th><th>부서</th><th>연차 발생일</th><th class="num">할당</th><th class="num">사용</th><th class="num">잔여</th><th>사용률</th></tr></thead>
        <tbody>${emps.map((e) => {
          const lv = lvMap[e.id] || { allocated: 0, records: [] };
          const recs = (lv.records || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          const u = recs.reduce((s, r) => s + Number(r.days || 0), 0);
          const rm = (Number(lv.allocated) || 0) - u;
          const p = lv.allocated ? Math.min(100, (u / lv.allocated) * 100) : 0;
          const detail = recs.length ? `
            <table class="data lva-rec-table">
              <thead><tr><th>기간</th><th>유형</th><th class="num">일수</th>${isAdmin() ? "<th></th>" : ""}</tr></thead>
              <tbody>${recs.map((r) => `<tr>
                <td>${fmtPeriod(r.date, r.endDate)}</td>
                <td>${esc(r.type || "-")}</td>
                <td class="num">${r.days}일</td>
                ${isAdmin() ? `<td class="num"><button class="icon-btn" title="기록 삭제 (연차 복구)"
                  data-lvarec="${e.id}|${esc(r.date)}|${esc(r.endDate || "")}|${esc(r.type || "")}|${r.days || 0}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/><path d="M10 11v6M14 11v6"/></svg></button></td>` : ""}
              </tr>`).join("")}</tbody>
            </table>`
            : `<div class="empty" style="padding:12px">등록된 연차 사용 기록이 없습니다.</div>`;
          return `<tr class="ph-click" data-lvatoggle="${e.id}">
            <td><b>${esc(e.name)}</b></td><td>${esc(e.dept)}</td>
            <td>${esc(lv.grantDate || "-")}</td>
            <td class="num">${lv.allocated || 0}일</td><td class="num">${u}일</td>
            <td class="num"><b>${rm}일</b></td>
            <td><div class="bar ${rm < 0 ? "over" : ""}"><i style="width:${p}%"></i></div></td>
          </tr>
          <tr class="ph-detail-tr hidden" data-lvadetail="${e.id}"><td colspan="7"><div class="ph-detail ph-anim">${detail}</div></td></tr>`;
        }).join("")}</tbody></table></div>
    </div>
    ${pastCycles.length ? `
    <div class="card">
      <div class="card-title"><div>지난 연차 주기 기록<div class="ct-desc">갱신일이 지나 자동 리셋된 이전 주기의 잔여(소멸) 내역입니다.</div></div></div>
      <div class="table-wrap"><table class="data pay-table">
        <thead><tr><th>직원</th><th>부서</th><th>주기</th><th class="num">할당</th><th class="num">사용</th><th class="num">잔여(소멸)</th></tr></thead>
        <tbody>${pastCycles.map((h) => `<tr>
          <td><b>${esc(h.name)}</b></td><td>${esc(h.dept)}</td>
          <td>${fmtPeriod(h.start, h.end)}</td>
          <td class="num">${h.allocated}일</td>
          <td class="num">${h.used}일</td>
          <td class="num"><b class="${h.remaining > 0 ? "c-red" : ""}">${h.remaining}일</b></td>
        </tr>`).join("")}</tbody></table></div>
    </div>` : ""}`;

  // 직원 행 클릭 → 연차 사용 이력 토글
  $("#lva-body").querySelectorAll("[data-lvatoggle]").forEach((row) => {
    row.onclick = (ev) => {
      if (ev.target.closest("button")) return;
      const detail = $("#lva-body").querySelector(`[data-lvadetail="${row.dataset.lvatoggle}"]`);
      if (detail) detail.classList.toggle("hidden");
    };
  });
  // 총괄 관리자: 이력에서 개별 기록 삭제 (잔여 연차 복구)
  $("#lva-body").querySelectorAll("[data-lvarec]").forEach((b) => {
    b.onclick = async () => {
      if (!isAdmin() || b.disabled) return;
      b.disabled = true;
      const [empId, date, endDate, type, days] = b.dataset.lvarec.split("|");
      const emp = emps.find((e) => e.id === empId);
      if (!confirm(`${emp ? emp.name : "?"}님의 ${fmtPeriod(date, endDate || date)} ${type} ${days}일 기록을 삭제할까요?\n삭제하면 잔여 연차가 복구됩니다.`)) { b.disabled = false; return; }
      const ref = db.collection(COL.leaves).doc(empId);
      const snap = await ref.get();
      if (!snap.exists) { toast("연차 기록을 찾을 수 없습니다."); return; }
      const cur = snap.data();
      const recs = cur.records || [];
      const idx = recs.findIndex((r) =>
        r.date === date && (r.endDate || "") === endDate && (r.type || "") === type && String(r.days || 0) === days);
      if (idx === -1) { toast("해당 기록을 찾을 수 없습니다. 새로고침 후 다시 시도하세요."); return; }
      recs.splice(idx, 1);
      await ref.set({ ...cur, records: recs });
      toast("기록을 삭제했습니다. 잔여 연차가 복구되었습니다.");
      renderLeaveAdmin();
    };
  });

  if (isAdmin()) {
    $("#lv-use").onclick = openLeaveUseModal;
    $("#lv-alloc").onclick = openLeaveAllocModal;
  }

  // 결재 승인/반려 — 나를 결재자로 지정한 신청만 목록에 있으므로 권한 추가 확인 불필요
  {
    // 승인 전에 겹치는 휴가·행사·휴무를 보고 판단할 수 있도록 일정 캘린더를 함께 띄운다 (대기 신청은 회색 칩)
  renderScheduleCalInto($("#lva-cal"), renderLeaveAdmin, {
    showToday: false, pending: reqs,
    title: "일정 캘린더<div class=\"ct-desc\">승인 전에 같은 날 휴가·행사·휴무가 겹치는지 확인하세요. 회색은 결재 대기 중인 신청입니다.</div>"
  }).catch(() => { const c = $("#lva-cal"); if (c) c.innerHTML = ""; });
  $("#lva-body").querySelectorAll("[data-approve]").forEach((b) => {
      b.onclick = async () => {
        if (b.disabled) return;
        b.disabled = true; // 더블클릭으로 기록이 두 번 저장되는 것 방지
        const r = reqs.find((x) => x.id === b.dataset.approve);
        // 이미 다른 관리자가 처리한 신청이면 중단
        const reqSnap = await db.collection(COL.leaveRequests).doc(r.id).get();
        if (!reqSnap.exists || reqSnap.data().status !== "대기") {
          toast("이미 처리된 신청입니다.");
          renderLeaveAdmin();
          return;
        }
        const ref = db.collection(COL.leaves).doc(r.empId);
        const snap = await ref.get();
        const cur = snap.exists ? snap.data() : { allocated: 0, records: [] };
        cur.records = cur.records || [];
        // 같은 신청(reqId)이 이미 기록돼 있으면 다시 추가하지 않음
        if (!cur.records.some((x) => x.reqId === r.id)) {
          cur.records.push({ date: r.date, endDate: r.endDate || r.date, days: Number(r.days), type: r.type, reqId: r.id });
          await ref.set(cur);
        }
        await db.collection(COL.leaveRequests).doc(r.id).update({ status: "승인" });
        toast(`${r.name}님의 휴가를 승인했습니다.`);
        updateLeaveAlarm();
        renderLeaveAdmin();
      };
    });
    $("#lva-body").querySelectorAll("[data-reject]").forEach((b) => {
      b.onclick = async () => {
        const r = reqs.find((x) => x.id === b.dataset.reject);
        if (!confirm(`${r.name}님의 ${fmtPeriod(r.date, r.endDate)} ${r.type} 신청을 반려할까요?`)) return;
        await db.collection(COL.leaveRequests).doc(r.id).update({ status: "반려" });
        updateLeaveAlarm();
        renderLeaveAdmin();
      };
    });
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
        <select id="lu-emp" required>
          <option value="" disabled selected>직원 선택</option>
          ${emps.map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.dept)})</option>`).join("")}</select></label>
      <div class="grid-2">
        <div class="field"><span class="field-label">시작일</span>${calField("lu-date", todayKST())}</div>
        <div class="field"><span class="field-label">종료일</span>${calField("lu-end", todayKST())}</div>
        <label class="field"><span class="field-label">일수 (0.5 단위)</span><input id="lu-days" type="number" step="0.5" min="0.5" required value="1" /></label>
        <label class="field"><span class="field-label">유형</span>
          <select id="lu-type">${LEAVE_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="lu-cancel">취소</button>
        <button type="submit" class="btn btn-primary">기록 추가</button>
      </div>
    </form>`);
  $("#lu-cancel").onclick = closeModal;
  bindCalField("lu-date", (v) => {
    // 반차는 종료일을 시작일에 고정, 그 외에는 종료일이 시작일보다 빠르지 않게 맞춘다
    if (v && (isHalfUse() || calVal("lu-end") < v)) calSet("lu-end", v);
    luAutoDays();
  });
  bindCalField("lu-end", luAutoDays);

  // 유형이 '반차'면 일수를 0.5로 고정하고 종료일·일수 입력을 잠근다
  function isHalfUse() { return $("#lu-type").value === "반차"; }
  function luAutoDays() {
    if (isHalfUse()) { $("#lu-days").value = 0.5; return; }
    const s = calVal("lu-date"), e = calVal("lu-end") || s;
    if (!s || !e || e < s) return;
    $("#lu-days").value = Math.round((new Date(e + "T00:00:00Z") - new Date(s + "T00:00:00Z")) / 86400000) + 1;
  }
  function luSyncType() {
    const half = isHalfUse();
    const daysInput = $("#lu-days");
    $("#lu-end").disabled = half;
    daysInput.readOnly = half;
    daysInput.classList.toggle("locked", half);
    if (half) calSet("lu-end", calVal("lu-date"));
    luAutoDays();
  }
  $("#lu-type").onchange = luSyncType;
  luSyncType();

  $("#lvu-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const sb = ev.target.querySelector('[type="submit"]');
    if (sb.disabled) return;
    sb.disabled = true;
    const empId = $("#lu-emp").value;
    const emp = emps.find((e) => e.id === empId);
    const half = isHalfUse();
    const start = calVal("lu-date");
    const rec = {
      date: start,
      endDate: half ? start : (calVal("lu-end") || start),
      days: half ? 0.5 : Number($("#lu-days").value),
      type: $("#lu-type").value
    };
    const ref = db.collection(COL.leaves).doc(empId);
    const snap = await ref.get();
    const cur = snap.exists ? snap.data() : { allocated: 0, records: [] };
    cur.records = cur.records || [];
    cur.records.push(rec);
    await ref.set(cur);
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
        <select id="la-emp" required>
          <option value="" disabled selected>직원 선택</option>
          ${emps.map((e) =>
          `<option value="${e.id}">${esc(e.name)} (${esc(e.dept)}) — 현재 ${lvMap[e.id]?.allocated || 0}일</option>`).join("")}</select></label>
      <label class="field"><span class="field-label">할당 일수</span><input id="la-days" type="number" step="0.5" min="0" required /></label>
      <div class="field"><span class="field-label">연차 발생일 (매년 이 날짜에 갱신)</span>${calField("la-grant", "")}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="la-cancel">취소</button>
        <button type="submit" class="btn btn-primary">저장</button>
      </div>
    </form>`);
  $("#la-cancel").onclick = closeModal;
  bindCalField("la-grant");
  const fillGrant = () => { calSet("la-grant", lvMap[$("#la-emp").value]?.grantDate || ""); };
  $("#la-emp").onchange = fillGrant;
  fillGrant();
  $("#lva-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const empId = $("#la-emp").value;
    const emp = emps.find((e) => e.id === empId);
    const days = Number($("#la-days").value);
    const grantDate = calVal("la-grant");
    const ref = db.collection(COL.leaves).doc(empId);
    const snap = await ref.get();
    const cur = snap.exists ? snap.data() : { records: [] };
    await ref.set({ ...cur, allocated: days, ...(grantDate ? { grantDate } : {}) });
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

  /* ── 공지사항 관리 (임원 이상) ── */
  if (canPostNotice()) {
    main.innerHTML += `
      <div class="card">
        <div class="card-title">
          <div>공지사항<div class="ct-desc">등록한 공지는 대상 임직원의 홈 화면에 표시됩니다.</div></div>
          <button class="btn btn-primary btn-sm" id="nt-new">📢 공지사항 등록하기</button>
        </div>
        <div id="nt-list"><div class="empty">불러오는 중...</div></div>
      </div>`;
    $("#nt-new").onclick = () => openNoticeModal(null);
    renderMyNotices();
  }
}

async function renderMyNotices() {
  const list = document.getElementById("nt-list");
  if (!list) return;
  const [snap, empSnap] = await Promise.all([
    db.collection(COL.notices).get(),
    db.collection(COL.employees).get()
  ]);
  const empBy = {};
  empSnap.docs.forEach((d) => { empBy[d.id] = d.data(); });
  const notices = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((n) => isAdmin() || n.authorId === me.id)
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

  list.innerHTML = notices.length ? `<div class="table-wrap"><table class="data pay-table">
    <thead><tr><th>제목</th><th>게시 범위</th><th>게시자</th><th>게시일</th><th class="num">확인</th><th></th></tr></thead>
    <tbody>${notices.map((n) => `<tr>
      <td><b>${esc(n.title)}</b></td>
      <td>${noticeScopeLabel(n)}</td>
      <td>${esc(n.authorName || "-")}</td>
      <td>${fmtTs(n.createdAt)}</td>
      <td class="num">${(n.ackIds || []).length
        ? `<button type="button" class="nt-ack-count" data-ntacks="${n.id}" title="확인한 사람 보기">${(n.ackIds || []).length}명</button>`
        : "0명"}</td>
      <td style="white-space:nowrap">
        <button class="icon-btn" data-ntedit="${n.id}" title="수정"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 0 1 4 4L8 20l-5 1 1-5L17 3Z"/></svg></button>
        <button class="icon-btn danger" data-ntdel="${n.id}" title="철회(삭제)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/><path d="M10 11v6M14 11v6"/></svg></button>
      </td>
    </tr>`).join("")}</tbody></table></div>`
    : `<div class="empty">등록한 공지가 없습니다. [공지사항 등록하기]로 첫 공지를 게시하세요.</div>`;

  // 확인 인원 수 클릭 → 확인한 사람 이름 목록
  list.querySelectorAll("[data-ntacks]").forEach((b) => {
    b.onclick = () => {
      const n = notices.find((x) => x.id === b.dataset.ntacks);
      const names = (n.ackIds || []).map((id) => {
        const e = empBy[id];
        return e ? `${e.name} (${e.dept || "-"})` : "(퇴사/삭제된 계정)";
      });
      openModal(`
        <h3>"${esc(n.title)}" 확인 현황</h3>
        <p class="modal-desc">확인함을 누른 사람 ${names.length}명입니다.</p>
        <ul class="nt-ack-list">${names.map((nm) => `<li>${esc(nm)}</li>`).join("")}</ul>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" id="nta-close">닫기</button></div>`);
      $("#nta-close").onclick = closeModal;
    };
  });
  list.querySelectorAll("[data-ntedit]").forEach((b) => {
    b.onclick = () => {
      const n = notices.find((x) => x.id === b.dataset.ntedit);
      openNoticeModal(n);
    };
  });
  list.querySelectorAll("[data-ntdel]").forEach((b) => {
    b.onclick = async () => {
      const n = notices.find((x) => x.id === b.dataset.ntdel);
      if (!confirm(`"${n.title}" 공지를 철회할까요?\n대상 임직원의 홈에서 즉시 사라집니다.`)) return;
      await db.collection(COL.notices).doc(n.id).delete();
      toast("공지를 철회했습니다.");
      renderMyNotices();
    };
  });
}

async function openNoticeModal(notice) {
  const empSnap = await db.collection(COL.employees).where("status", "==", "재직").get();
  const emps = sortByGrade(empSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  const scope = notice?.scope || "all";

  openModal(`
    <h3>${notice ? "공지 수정" : "공지사항 등록"}</h3>
    <p class="modal-desc">게시하면 대상 임직원의 홈 화면 바로가기 아래에 공지 카드가 표시됩니다.</p>
    <form id="nt-form">
      <label class="field"><span class="field-label">제목</span>
        <input id="nf-title" required maxlength="80" value="${esc(notice?.title || "")}" placeholder="예: 8월 전사 워크숍 안내" /></label>
      <label class="field"><span class="field-label">내용</span>
        <textarea id="nf-body" class="pm-note" rows="4" required placeholder="공지 내용을 입력하세요. URL은 자동으로 링크가 됩니다.">${esc(notice?.body || "")}</textarea></label>

      <div class="field"><span class="field-label">게시 범위 — 어디에 뿌릴지 먼저 선택하세요</span>
        <div class="nt-scope-pick">
          <label class="nt-radio"><input type="radio" name="nf-scope" value="all" ${scope === "all" ? "checked" : ""} /><span>전체 공지</span></label>
          <label class="nt-radio"><input type="radio" name="nf-scope" value="dept" ${scope === "dept" ? "checked" : ""} /><span>부서별 공지</span></label>
          <label class="nt-radio"><input type="radio" name="nf-scope" value="personal" ${scope === "personal" ? "checked" : ""} /><span>개별 공지</span></label>
        </div>
      </div>

      <div id="nf-dept-box" class="grant-list ${scope === "dept" ? "" : "hidden"}" style="max-height:150px">
        ${DEPTS.map((d) => `<label class="grant-row">
          <input type="checkbox" data-nfdept="${d}" ${(notice?.depts || []).includes(d) ? "checked" : ""} /><span>${d}</span></label>`).join("")}
      </div>
      <div id="nf-emp-box" class="grant-list ${scope === "personal" ? "" : "hidden"}" style="max-height:220px">
        ${DEPTS.map((d) => {
          const list = emps.filter((e) => e.dept === d);
          return list.length ? `<div class="grant-dept">${d}</div>` + list.map((e) => `
            <label class="grant-row"><input type="checkbox" data-nfemp="${e.id}" ${(notice?.targetIds || []).includes(e.id) ? "checked" : ""} />
            <span>${esc(e.name)}</span><em>${esc(e.position || "")}</em></label>`).join("") : "";
        }).join("")}
      </div>

      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="nf-cancel">취소</button>
        <button type="submit" class="btn btn-primary">${notice ? "수정 저장" : "게시"}</button>
      </div>
    </form>`);

  $("#nf-cancel").onclick = closeModal;
  document.querySelectorAll('input[name="nf-scope"]').forEach((r) => {
    r.onchange = () => {
      $("#nf-dept-box").classList.toggle("hidden", r.value !== "dept" || !r.checked);
      $("#nf-emp-box").classList.toggle("hidden", r.value !== "personal" || !r.checked);
      if (r.checked && r.value === "dept") { $("#nf-dept-box").classList.remove("hidden"); $("#nf-emp-box").classList.add("hidden"); }
      if (r.checked && r.value === "personal") { $("#nf-emp-box").classList.remove("hidden"); $("#nf-dept-box").classList.add("hidden"); }
      if (r.checked && r.value === "all") { $("#nf-dept-box").classList.add("hidden"); $("#nf-emp-box").classList.add("hidden"); }
    };
  });

  $("#nt-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const scopeSel = document.querySelector('input[name="nf-scope"]:checked').value;
    const depts = [...document.querySelectorAll("[data-nfdept]:checked")].map((c) => c.dataset.nfdept);
    const targetIds = [...document.querySelectorAll("[data-nfemp]:checked")].map((c) => c.dataset.nfemp);
    if (scopeSel === "dept" && !depts.length) { toast("공지할 부서를 선택하세요."); return; }
    if (scopeSel === "personal" && !targetIds.length) { toast("공지할 직원을 선택하세요."); return; }
    const data = {
      title: $("#nf-title").value.trim(),
      body: $("#nf-body").value.trim(),
      scope: scopeSel,
      depts: scopeSel === "dept" ? depts : [],
      targetIds: scopeSel === "personal" ? targetIds : []
    };
    if (notice) {
      await db.collection(COL.notices).doc(notice.id).update(data);
      toast("공지를 수정했습니다.");
    } else {
      await db.collection(COL.notices).add({
        ...data,
        authorId: me.id,
        authorName: me.name,
        ackIds: [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast("공지를 게시했습니다. 대상 임직원의 홈에 표시됩니다.");
    }
    closeModal();
    renderMyNotices();
  };
}

/* ───────── 직원 관리 (admin) ───────── */
async function renderEmployees() {
  if (!canManageOps()) return navigate("home", null, true);
  const main = $("#main");
  main.innerHTML = pageHead("ADMIN", "직원 관리",
    "직원 등록·수정, 부서 배정, 권한(역할) 조정, 비밀번호 초기화를 할 수 있습니다.",
    `<button class="btn btn-primary btn-sm" id="emp-add">+ 직원 등록</button>`) + `<div id="emp-body">불러오는 중...</div>`;
  $("#emp-add").onclick = () => openEmployeeModal(null);

  const snap = await db.collection(COL.employees).get();
  const emps = sortByGrade(snap.docs.map((d) => ({ id: d.id, ...d.data() })));

  /* ── 재직 현황 요약 ── */
  const active = emps.filter((e) => e.status === "재직");
  const retired = emps.filter((e) => e.status !== "재직");
  const typeCount = (kw) => active.filter((e) => (e.empType || "").includes(kw)).length;
  const maxDept = Math.max(1, ...DEPTS.map((d) => active.filter((e) => e.dept === d).length));
  const deptTones = ["plum", "", "gold", "ok"]; // 대표/경영지원/오프라인/온라인

  const statsHtml = `
    <div class="card">
      <div class="card-title"><div>재직 현황<div class="ct-desc">현재 재직 중인 팀 구성입니다.</div></div></div>
      <div class="lv-stats">
        <div class="lv-stat"><span class="lv-ico t-blue">${LV_ICONS.used}</span>
          <div><div class="s-label">재직 인원</div><div class="s-value">${active.length}명</div></div></div>
        <div class="lv-stat"><span class="lv-ico t-green">${ICONS.employees ? `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>` : ""}</span>
          <div><div class="s-label">4대보험 / 3.3%</div><div class="s-value">${typeCount("4대보험") + typeCount("사대보험")} / ${typeCount("3.3")}</div></div></div>
        <div class="lv-stat"><span class="lv-ico t-amber">${LV_ICONS.pending}</span>
          <div><div class="s-label">비밀번호 미설정</div><div class="s-value">${active.filter((e) => !e.passwordHash).length}명</div></div></div>
        <div class="lv-stat"><span class="lv-ico t-purple">${LV_ICONS.remain}</span>
          <div><div class="s-label">퇴사자</div><div class="s-value">${retired.length}명</div></div></div>
      </div>
      <div class="type-bars" style="margin-top:16px">
        ${DEPTS.map((d, i) => {
          const list = active.filter((e) => e.dept === d);
          return `<div class="type-bar dept-bar">
            <span>${d}</span>
            <div class="bar ${deptTones[i]}"><i style="width:${Math.round((list.length / maxDept) * 100)}%"></i></div>
            <span class="tb-num">${list.length}명${list.length ? ` · ${list.map((e) => esc(e.name)).join(", ")}` : ""}</span>
          </div>`;
        }).join("")}
      </div>
    </div>`;

  $("#emp-body").innerHTML = statsHtml + `<div class="card"><div class="table-wrap">
    ${emps.length ? `<table class="data pay-table"><thead><tr>
      <th>이름</th><th>부서</th><th>직급</th><th>직책</th><th>이메일</th><th>입사일</th><th>고용 구분</th><th>역할</th><th>비밀번호</th><th>상태</th><th></th>
    </tr></thead><tbody>
    ${emps.map((e) => `<tr>
      <td>${e.hrUrl
        ? `<a class="emp-link" href="${esc(e.hrUrl)}" target="_blank" rel="noopener" title="인사정보 열기"><b>${esc(e.name)}</b><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg></a>`
        : `<b>${esc(e.name)}</b>`}</td><td>${esc(e.dept)}</td><td>${esc(e.grade || "-")}</td><td>${esc(e.position || "-")}</td>
      <td>${esc(e.email || "-")}</td>
      <td>${e.joinDate ? `${esc(e.joinDate)} <em class="tenure">${tenureYM(e.joinDate)} 근무</em><span class="tenure-days">${workDaysLabel(e.joinDate).replace(/[()]/g, "")}</span>` : "-"}</td>
      <td>${empTypeShort(e.empType)}</td>
      <td><span class="badge ${e.role}">${roleLabel(e.role)}</span></td>
      <td>${e.passwordHash ? '<span class="badge ok">설정됨</span>' : '<span class="badge warn">미설정</span>'}</td>
      <td>${e.status === "재직" ? '<span class="badge ok">재직</span>' : '<span class="badge off">퇴사</span>'}</td>
      <td style="white-space:nowrap">
        <button class="icon-btn" data-empedit="${e.id}" title="수정"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 0 1 4 4L8 20l-5 1 1-5L17 3Z"/></svg></button>
        ${e.passwordHash ? `<button class="icon-btn" data-pwreset="${e.id}" title="비밀번호 초기화"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4.5"/><path d="m11 12 9-9m-4 4 3 3"/></svg></button>` : ""}
        ${e.id !== me.id ? `<button class="icon-btn danger" data-empdel="${e.id}" title="삭제"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/><path d="M10 11v6M14 11v6"/></svg></button>` : ""}
      </td>
    </tr>`).join("")}</tbody></table>` : `<div class="empty">등록된 직원이 없습니다.</div>`}
  </div></div>`;

  $("#emp-body").querySelectorAll("[data-empedit]").forEach((b) => {
    b.onclick = () => openEmployeeModal(emps.find((e) => e.id === b.dataset.empedit));
  });
  $("#emp-body").querySelectorAll("[data-empdel]").forEach((b) => {
    b.onclick = async () => {
      const e = emps.find((x) => x.id === b.dataset.empdel);
      if (!confirm(`${e.name}님을 직원 목록에서 완전히 삭제할까요?\n\n연차·메모·할 일·개인 버튼 등 개인 데이터가 함께 삭제되며 되돌릴 수 없습니다.\n(급여 기록은 회계 이력으로 보존됩니다)\n\n퇴사 처리만 하려면 [수정]에서 재직 상태를 '퇴사'로 변경하세요.`)) return;
      if (!confirm(`정말로 삭제할까요?\n"${e.name}" 계정은 복구할 수 없습니다.`)) return;
      // 개인 데이터 정리
      const dels = [COL.personalButtons, COL.todos, COL.memos, COL.leaves, COL.settings]
        .map((c) => db.collection(c).doc(e.id).delete().catch(() => {}));
      await Promise.all(dels);
      // 휴가 신청 삭제
      const reqSnap = await db.collection(COL.leaveRequests).where("empId", "==", e.id).get();
      await Promise.all(reqSnap.docs.map((d) => d.ref.delete().catch(() => {})));
      // 사내 시스템 버튼 권한 회수
      const sysSnap = await db.collection(COL.systems).get();
      await Promise.all(sysSnap.docs
        .filter((d) => ((d.data().grantIds) || []).includes(e.id))
        .map((d) => d.ref.update({ grantIds: firebase.firestore.FieldValue.arrayRemove(e.id) }).catch(() => {})));
      // 직원 문서 삭제
      await db.collection(COL.employees).doc(e.id).delete();
      toast(`${e.name}님을 삭제했습니다.`);
      renderEmployees();
    };
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
      toast(`${e.name}의 비밀번호를 초기화했습니다.`);
      renderEmployees();
    };
  });
}

function openEmployeeModal(emp) {
  openModal(`
    <h3>${emp ? "직원 정보 수정" : "직원 등록"}</h3>
    <p class="modal-desc">관리자 권한(총괄 관리자)은 지정된 담당자에게만 부여하세요. 관리자 메뉴는 총괄 관리자에게만 표시됩니다.</p>
    <form id="emp-form">
      <div class="grid-2">
        <label class="field"><span class="field-label">이름</span><input id="ef-name" required value="${esc(emp?.name || "")}" /></label>
        <label class="field"><span class="field-label">부서</span>
          <select id="ef-dept">${DEPTS.map((d) => `<option ${emp?.dept === d ? "selected" : ""}>${d}</option>`).join("")}</select></label>
        <label class="field"><span class="field-label">직급 (L0~L5)</span>
          <select id="ef-grade"><option value="">미지정</option>${GRADES.map((g) => `<option value="${g.split(" ")[0]}" ${emp?.grade === g.split(" ")[0] ? "selected" : ""}>${g}</option>`).join("")}</select></label>
        <label class="field"><span class="field-label">직책 (예: 본부장, 부장)</span><input id="ef-pos" value="${esc(emp?.position || "")}" /></label>
        <div class="field"><span class="field-label">입사일</span>${calField("ef-join", emp?.joinDate || "")}</div>
        <div class="field"><span class="field-label">생년월일 (명세서용)</span>${calField("ef-birth", emp?.birthDate || "")}</div>
      </div>
      <div class="grid-2">
        <label class="field"><span class="field-label">이메일</span><input id="ef-email" type="email" value="${esc(emp?.email || "")}" /></label>
      <label class="field"><span class="field-label">인사정보 URL</span>
        <input id="ef-hrurl" type="url" placeholder="https://docs.google.com/spreadsheets/..." value="${esc(emp?.hrUrl || "")}" /></label>
        <label class="field"><span class="field-label">연락처</span><input id="ef-phone" type="tel" placeholder="010-0000-0000" value="${esc(emp?.phone || "")}" /></label>
      </div>
      <div class="grid-2">
        <label class="field"><span class="field-label">고용 구분</span>
          <select id="ef-type">${EMP_TYPES.map((t) => `<option ${emp?.empType === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="field"><span class="field-label">역할 (권한)</span>
          <select id="ef-role">
            <option value="member" ${emp?.role === "member" ? "selected" : ""}>일반</option>
            <option value="manager" ${emp?.role === "manager" ? "selected" : ""}>매니저 (근태관리·연차 조회)</option>
            <option value="executive" ${emp?.role === "executive" ? "selected" : ""}>임원 열람</option>
            <option value="special" ${emp?.role === "special" ? "selected" : ""}>특수관리자 (권한 모니터링 외 전체)</option>
            <option value="admin" ${emp?.role === "admin" ? "selected" : ""}>총괄 관리자</option>
          </select></label>
      </div>
      <div class="grid-2">
        <label class="field"><span class="field-label">재직 상태</span>
          <select id="ef-status">
            <option ${(!emp || emp.status === "재직") ? "selected" : ""}>재직</option>
            <option ${emp?.status === "퇴사" ? "selected" : ""}>퇴사</option>
          </select></label>
        <label class="field"><span class="field-label">결재 등급 <em class="sf-hint">(휴가·근태 결재)</em></span>
          <select id="ef-tier">${APPROVER_TIERS.map((t) =>
            `<option value="${t.v}" ${approverTierOf(emp) === t.v ? "selected" : ""}>${t.label}</option>`).join("")}</select></label>
      </div>
      <label class="sf-check"><input type="checkbox" id="ef-otx" ${isOtExemptEmp(emp) ? "checked" : ""} />
        조기출근·연장 가산 제외 (직책상 추가근무 수당 대상이 아닌 경우)</label>
      ${emp ? `<div class="mini-note">내부 직원 ID: <b>${esc(emp.id)}</b> — 결재·근태 기록은 이 ID로 연결됩니다.</div>` : ""}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="ef-cancel">취소</button>
        <button type="submit" class="btn btn-primary">저장</button>
      </div>
    </form>`);
  $("#ef-cancel").onclick = closeModal;
  bindCalField("ef-join");
  bindCalField("ef-birth");
  $("#ef-dept").onchange = () => { $("#ef-role").value = roleForDept($("#ef-dept").value); };
  if (!emp) $("#ef-role").value = roleForDept($("#ef-dept").value);

  $("#emp-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const data = {
      name: $("#ef-name").value.trim(),
      dept: $("#ef-dept").value,
      grade: $("#ef-grade").value,
      position: $("#ef-pos").value.trim(),
      joinDate: calVal("ef-join"),
      birthDate: calVal("ef-birth"),
      email: $("#ef-email").value.trim(),
      hrUrl: $("#ef-hrurl").value.trim(),
      phone: $("#ef-phone").value.trim(),
      empType: $("#ef-type").value,
      role: $("#ef-role").value,
      status: $("#ef-status").value,
      approverTier: Number($("#ef-tier").value),
      otExempt: $("#ef-otx").checked
    };
    if (emp) {
      const roleChanged = emp.role !== data.role;
      await db.collection(COL.employees).doc(emp.id).update(data);
      if (emp.id === me.id) { me = { ...me, ...data }; renderSidebar(); }
    } else {
      await db.collection(COL.employees).add({
        ...data,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    closeModal();
    renderEmployees();
  };
}

/* ───────── 권한 모니터링 (admin) ───────── */
async function renderMonitor() {
  if (!isAdmin()) return navigate("home", null, true);
  const main = $("#main");
  main.innerHTML = pageHead("ADMIN", "권한 모니터링",
    "직원별 권한 부여 현황을 총괄 확인합니다.") + `<div id="mon-body">불러오는 중...</div>`;

  const [empSnap, sysSnap] = await Promise.all([
    db.collection(COL.employees).get(),
    db.collection(COL.systems).get()
  ]);
  const emps = empSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) =>
    DEPTS.indexOf(a.dept) - DEPTS.indexOf(b.dept) || a.name.localeCompare(b.name, "ko"));
  const systems = sysSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const admins = emps.filter((e) => e.role === "admin" && e.status === "재직").length;
  const noPw = emps.filter((e) => !e.passwordHash && e.status === "재직").length;

  $("#mon-body").innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="s-label">재직 직원</div><div class="s-value">${emps.filter((e) => e.status === "재직").length}명</div></div>
      <div class="stat accent"><div class="s-label">총괄 관리자</div><div class="s-value">${admins}명</div></div>
      <div class="stat"><div class="s-label">비밀번호 미설정</div><div class="s-value">${noPw}명</div></div>
    </div>
    <div class="card">
      <div class="card-title"><div>직원별 버튼 권한 설정<div class="ct-desc">직원을 검색해 사용할 사내 시스템 버튼을 지정하세요. 지정된 버튼은 그 직원이 로그인하면 홈 바로가기에 자동으로 나타납니다.</div></div></div>
      <label class="field"><input id="mn-search" placeholder="직원 이름 검색" autocomplete="off" /></label>
      <div id="mn-results" class="mn-results"></div>
      <div id="mn-grant"></div>
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
`;


  /* ── 직원별 버튼 권한 설정 ── */
  const active = emps.filter((e) => e.status === "재직");
  const showResults = (q) => {
    const list = q ? active.filter((e) => e.name.includes(q)) : [];
    $("#mn-results").innerHTML = list.length
      ? list.map((e) => `<button class="mn-emp" data-pick="${e.id}"><b>${esc(e.name)}</b><span>${esc(e.dept)}${e.position ? " · " + esc(e.position) : ""}</span></button>`).join("")
      : (q ? `<div class="empty" style="padding:16px">"${esc(q)}" 이름의 재직 직원이 없습니다.</div>` : "");
    $("#mn-results").querySelectorAll("[data-pick]").forEach((b) => {
      b.onclick = () => showGrantEditor(active.find((e) => e.id === b.dataset.pick));
    });
  };
  const showGrantEditor = (emp) => {
    $("#mn-results").innerHTML = "";
    $("#mn-search").value = emp.name;
    if (!systems.length) {
      $("#mn-grant").innerHTML = `<div class="empty">등록된 사내 시스템이 없습니다. [사내 시스템]에서 먼저 버튼을 등록하세요.</div>`;
      return;
    }
    $("#mn-grant").innerHTML = `
      <div class="mn-grant-head"><b>${esc(emp.name)}</b> <span class="badge dept">${esc(emp.dept)}</span> 님이 사용할 버튼</div>
      <div class="grant-list">
        ${systems.map((s) => `
          <label class="grant-row">
            <input type="checkbox" data-sid="${s.id}" ${s.allowAll ? "checked disabled" : (s.grantIds || []).includes(emp.id) ? "checked" : ""} />
            <i class="dot" style="background:${esc(s.color || DEFAULT_BTN_COLOR)}"></i>
            <span>${esc(s.label)}</span>
            ${s.allowAll ? '<em>전체 공개</em>' : `<em>${esc(s.desc || "")}</em>`}
          </label>`).join("")}
      </div>
      <div class="modal-actions" style="justify-content:flex-start">
        <button class="btn btn-primary" id="mn-save">권한 저장</button>
      </div>`;
    $("#mn-save").onclick = async () => {
      const changes = [];
      $("#mn-grant").querySelectorAll("input[data-sid]:not(:disabled)").forEach((i) => {
        const s = systems.find((x) => x.id === i.dataset.sid);
        const had = (s.grantIds || []).includes(emp.id);
        if (i.checked && !had) changes.push({ s, op: "arrayUnion", on: true });
        if (!i.checked && had) changes.push({ s, op: "arrayRemove", on: false });
      });
      for (const c of changes) {
        await db.collection(COL.systems).doc(c.s.id).update({
          grantIds: firebase.firestore.FieldValue[c.op](emp.id)
        });
        c.s.grantIds = c.on ? [...(c.s.grantIds || []), emp.id] : (c.s.grantIds || []).filter((x) => x !== emp.id);
      }
      if (changes.length) {
        toast(`${emp.name}님의 버튼 권한을 저장했습니다. 홈에 자동 반영됩니다.`);
      } else {
        toast("변경된 내용이 없습니다.");
      }
    };
  };
  $("#mn-search").oninput = (ev) => { $("#mn-grant").innerHTML = ""; showResults(ev.target.value.trim()); };
}

/* ───────── OKR ──────────────────────────────────────────────────────
   회사 최상위 O(전사 목표) 아래로 부서 → 팀 → 개인 OKR이 한 그루 트리로
   이어진다. OKR 노드는 정량 수치가 없는 '목표'이고, 실제 정량 KR은 각 노드
   아래에 투두 리스트처럼 붙는다 (krs 배열: 제목·목표 수치·단위·현재값·마감일).
   - 진행률: 하위 OKR 진행률과 자기 KR 진행률을 모두 모아 평균 (각 100% 상한)
     KR 본인 표시만 100% 초과 허용. 100% 미만은 내림 표시(목표 미달이 100%로
     보이지 않게).
   - 체크인은 KR 단위로만. 값이 바뀌지 않으면 저장 불가.
   - 고아 금지: 상위 OKR 연결 필수 (회사 O만 예외). 상위 후보는 회사 O + 담당자
     부서의 OKR만.
   - 마감일은 상위 OKR 마감일 이내로만.
   - 사이클: 총괄 관리자가 만들고 하나를 '활성화'. 전 직원은 활성 사이클만 본다.
   - 생성 후 수정 불가(하위 정합성 보호) — KR 추가/체크인/삭제만 가능.
   - (과거 데이터 호환) 노드 자체에 target 이 있고 하위·KR이 없으면 그 수치로 계산 */
let okrTab = "mine";          // mine | dept | status
let okrActiveCycleId = null;  // 활성 사이클 (새 OKR이 담기는 곳)
let okrReadonly = false;      // 활성 사이클이 없으면 true (조회만)
const okrOpenState = new Map(); // 접기/펼치기 상태 (키 → true/false, 없으면 화면 기본값)
const OKR_UNITS = ["%", "개", "건", "원", "명"];
const OKR_LEVEL_LABELS = ["회사", "부서", "팀", "개인"];
const OKR_DEPT_COLORS = {
  "경영지원본부": "#f76707",
  "오프라인사업부": "#1fa45b",
  "대표": "#191f28",
  "브랜딩디렉터": "#7048e8",
  "온라인사업부": "#3182f6"
};
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

/* 회사 최상위 O는 총괄 관리자와 대표(임원열람)만 만들고 지울 수 있다 */
function canEditCompanyOkr() { return isAdmin() || (me && me.role === "executive"); }
/* 일반 OKR: 담당자 본인 또는 관리자(총괄·특수). 회사 O는 위 규칙 적용 */
function canEditOkr(o) {
  if (!o.parentId) return canEditCompanyOkr();
  return (me && o.ownerId === me.id) || canManageOps();
}
/* KR 하나의 진행률 (raw=true 면 100% 초과분 포함) */
function krPct(k, raw) {
  const t = Number(k.target);
  if (!(t > 0)) return 0;
  const p = Math.max(0, ((Number(k.current) || 0) / t) * 100);
  return raw ? p : Math.min(100, p);
}

function buildOkrIndex(okrs) {
  const byId = {};
  const kids = {};
  okrs.forEach((o) => { byId[o.id] = o; });
  okrs.forEach((o) => {
    const p = o.parentId && byId[o.parentId] ? o.parentId : null;
    if (p) (kids[p] = kids[p] || []).push(o);
  });
  Object.values(kids).forEach((arr) => arr.sort((a, b) => (a.deadline || "").localeCompare(b.deadline || "") || (a.title || "").localeCompare(b.title || "")));
  const roots = okrs.filter((o) => !o.parentId)
    .sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));
  // 상위가 사라진(다른 사이클·삭제) OKR — 회사 O로 잘못 보이지 않게 따로 모은다
  const orphans = okrs.filter((o) => o.parentId && !byId[o.parentId])
    .sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));

  const depthCache = {};
  function depthOf(id) {
    if (id in depthCache) return depthCache[id];
    let d = 0, cur = byId[id];
    const seen = new Set([id]);
    while (cur && cur.parentId && byId[cur.parentId] && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      cur = byId[cur.parentId];
      d++;
    }
    depthCache[id] = d;
    return d;
  }
  const isOrphan = (id) => { const o = byId[id]; return !!(o && o.parentId && !byId[o.parentId]); };
  const levelLabel = (id) => isOrphan(id) ? "미연결" : OKR_LEVEL_LABELS[Math.min(depthOf(id), OKR_LEVEL_LABELS.length - 1)];

  /* 롤업 진행률 — 하위 OKR + 자기 KR 평균, 항상 100% 상한 */
  const progCache = {};
  function progressOf(id, seen) {
    if (id in progCache) return progCache[id];
    seen = seen || new Set();
    if (seen.has(id)) return 0;   // 순환 방어
    seen.add(id);
    const o = byId[id];
    if (!o) return 0;
    const parts = [
      ...(kids[id] || []).map((k) => progressOf(k.id, seen)),
      ...(o.krs || []).map((k) => krPct(k))
    ];
    let p;
    if (parts.length) p = parts.reduce((s, v) => s + v, 0) / parts.length;
    else if (Number(o.target) > 0) p = Math.min(100, Math.max(0, ((Number(o.current) || 0) / Number(o.target)) * 100));
    else p = 0;
    progCache[id] = p;
    return p;
  }
  /* 표시용 — 과거 방식(노드 자체 수치)의 말단은 초과분도 그대로 */
  function displayPctOf(id) {
    const o = byId[id];
    if (!o) return 0;
    if ((kids[id] || []).length || (o.krs || []).length) return progressOf(id);
    return Number(o.target) > 0 ? Math.max(0, ((Number(o.current) || 0) / Number(o.target)) * 100) : 0;
  }
  function descendantIds(id, set) {
    set = set || new Set();
    (kids[id] || []).forEach((k) => {
      if (!set.has(k.id)) { set.add(k.id); descendantIds(k.id, set); }
    });
    return set;
  }
  return { byId, roots, orphans, isOrphan, childrenOf: (id) => kids[id] || [], depthOf, levelLabel, progressOf, displayPctOf, descendantIds };
}

function okrDday(deadline) {
  if (!deadline) return null;
  const ms = new Date(deadline + "T00:00:00+09:00") - new Date(todayKST() + "T00:00:00+09:00");
  return Math.round(ms / 86400000);
}
function okrDdayChip(deadline, prog) {
  const d = okrDday(deadline);
  if (d === null) return "";
  if (prog >= 100) return `<span class="badge ok">달성</span>`;
  if (d < 0) return `<span class="badge warn">지연 D+${-d}</span>`;
  if (d <= 7) return `<span class="badge warn">D-${d}</span>`;
  return `<span class="badge off">D-${d}</span>`;
}
/* 진행률 표시값 — 100% 미만은 내림 (1,999/2,000 = 99.95% 가 100% 로 보이지 않게) */
function okrPctDisplay(p) {
  return p >= 100 ? Math.round(p) : Math.floor(p);
}
/* 체크인 피드 시간 — 오늘이면 오전/오후 h:mm, 아니면 M.D */
function okrFeedTime(iso) {
  if (!iso) return "";
  const kst = new Date(new Date(iso).getTime() + 9 * 3600e3);
  const dateStr = kst.toISOString().slice(0, 10);
  if (dateStr === todayKST()) {
    let h = kst.getUTCHours();
    const ampm = h < 12 ? "오전" : "오후";
    h = h % 12 || 12;
    return `${ampm} ${String(h).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
  }
  return `${kst.getUTCMonth() + 1}.${kst.getUTCDate()}`;
}
/* 부서 식별 띠 색 — 회사 O는 블랙(대표 컬러) */
function okrStripeColor(o) {
  return OKR_DEPT_COLORS[o.parentId ? o.dept : "대표"] || "#d9dee3";
}

async function loadOkrData() {
  const [okrSnap, cycleSnap, empSnap] = await Promise.all([
    db.collection(COL.okrs).get(),
    db.collection(COL.okrCycles).get(),
    db.collection(COL.employees).where("status", "==", "재직").get()
  ]);
  return {
    okrs: okrSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    cycles: cycleSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    emps: empSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  };
}

async function renderOkr() {
  const main = $("#main");
  main.innerHTML = pageHead("OKR", "OKR", "회사 목표(O)부터 부서·개인 KR까지 하나의 트리로 연결해 관리합니다.") + `
    <div class="okr-intro">
      <div><b>Objective (O)</b> = 우리가 무엇을 달성할 것인가? <span class="oi-arrow">→</span> 방향·목표</div>
      <div><b>Key Results (KR)</b> = 달성했다는 것을 어떤 숫자로 증명할 것인가? <span class="oi-arrow">→</span> 측정 가능한 정량 성과</div>
    </div>
    <div id="okr-feed"></div>
    <div class="subtabs">
      ${[["mine", "내 OKR"], ["dept", "부서 OKR"], ["status", "진행현황"]].map(([k, l]) =>
        `<button class="subtab ${okrTab === k ? "on" : ""}" data-otab="${k}">${l}</button>`).join("")}
    </div>
    <div id="okr-cycle-bar"></div>
    <div id="okr-body"><div class="empty">불러오는 중...</div></div>`;
  main.querySelectorAll("[data-otab]").forEach((b) => {
    b.onclick = () => navigate("okr", b.dataset.otab);
  });

  const { okrs: allOkrs, cycles, emps } = await loadOkrData();
  cycles.sort((a, b) => {
    const ta = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
    const tb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
    return tb - ta;
  });
  const active = cycles.find((c) => c.active) || null;
  okrActiveCycleId = active ? active.id : null;
  // 총괄이 활성화한 사이클만 모두에게 보인다 (사이클이 하나도 없으면 과거 데이터 그대로)
  okrReadonly = cycles.length > 0 && !active;
  const okrs = cycles.length ? allOkrs.filter((o) => active && o.cycleId === active.id) : allOkrs;

  const bar = $("#okr-cycle-bar");
  const cycleName = active ? `<b class="ocb-name">${esc(active.name)}</b>`
    : `<span class="ocb-none">${cycles.length ? "활성화된 사이클이 없습니다 — 사이클 관리에서 활성화하세요." : "아직 사이클이 없습니다 — 첫 사이클을 만들어 시작하세요."}</span>`;
  if (isAdmin()) {
    bar.innerHTML = `<div class="okr-cycle-bar">
      <span class="ocb-label">사이클</span>${cycleName}
      <button class="btn btn-ghost btn-sm" id="okr-cycle-manage">사이클 관리</button>
    </div>`;
    $("#okr-cycle-manage").onclick = () => openOkrCycleModal(cycles, allOkrs);
  } else if (cycles.length) {
    bar.innerHTML = `<div class="okr-cycle-bar"><span class="ocb-label">사이클</span>${cycleName}</div>`;
  } else {
    bar.innerHTML = "";
  }

  // 최근 KR 업데이트 피드 — 이 사이클의 체크인 중 최신 3건
  const feed = okrs
    .flatMap((o) => (o.checkins || []).map((c) => ({ ...c, label: c.krTitle || o.title })))
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""))
    .slice(0, 3);
  $("#okr-feed").innerHTML = feed.length ? `
    <div class="okr-feed">
      <div class="okr-feed-title">📢 최근 KR 업데이트</div>
      ${feed.map((c) => `
        <div class="okr-feed-row">
          <span class="off-dot"></span>
          <span class="off-text"><b>${esc(c.empName)}</b>님이 [${esc(c.label)}] KR을
            ${Number(c.pct) >= 100 ? "완료했습니다! 🎉" : `체크인했습니다 (${okrPctDisplay(Number(c.pct) || 0)}%)`}</span>
          <span class="off-time">${okrFeedTime(c.at)}</span>
        </div>`).join("")}
    </div>` : "";

  const idx = buildOkrIndex(okrs);
  if (okrTab === "mine") renderOkrMine(okrs, emps, idx);
  else if (okrTab === "dept") renderOkrDept(okrs, emps, idx);
  else renderOkrStatus(okrs, emps, idx);
}

/* 트리 한 줄 — 부서 컬러 띠 + 위계 연결선 + 레벨 배지 + 진행바
   opts.flat: 부모 행 없이 단독 표시(들여쓰기·연결선 생략)
   opts.actions(o): 오른쪽 버튼 묶음 html, opts.extra: 접기/펼치기 등 추가 버튼 */
function okrRowHtml(o, idx, opts) {
  opts = opts || {};
  const depth = idx.depthOf(o.id);
  const rolled = idx.progressOf(o.id);
  const pct = okrPctDisplay(idx.displayPctOf(o.id));
  const over = pct > 100;
  const mine = me && o.ownerId === me.id;
  const kidCount = idx.childrenOf(o.id).length;
  const krCount = (o.krs || []).length;
  const layoutDepth = opts.flat ? 0 : Math.min(depth, 6);
  const parts = [];
  if (kidCount) parts.push(`하위 OKR ${kidCount}개`);
  if (krCount) parts.push(`KR ${krCount}개`);
  const goal = parts.length ? `${parts.join(" · ")} 평균`
    : (Number(o.target) > 0 ? `${fmt(o.current || 0)} / ${fmt(o.target)}${esc(o.unit || "")}` : "KR 없음");
  const actions = (opts.actions ? opts.actions(o) : "") + (opts.extra || "");
  return `
    <div class="okr-row ${mine ? "okr-mine" : ""} ${layoutDepth ? "okr-child" : ""}" data-okr="${o.id}"
         style="--okr-depth:${layoutDepth};--okr-stripe:${okrStripeColor(o)}">
      <div class="okr-row-main">
        <div class="okr-title-line">
          <span class="badge okr-lv d${Math.min(depth, 3)}">${idx.levelLabel(o.id)}</span>
          <b class="okr-title">${esc(o.title)}</b>
          ${okrDdayChip(o.deadline, rolled)}
        </div>
        <div class="okr-meta">
          ${o.parentId ? `<span>${mine && opts.meTag ? `<span class="badge me-tag">나</span>` : ""}${esc(o.ownerName || "-")}${o.dept ? ` · ${esc(o.dept)}` : ""}</span><span>${goal}</span>` : ""}
          <span>~ ${esc(o.deadline || "-")}</span>
        </div>
      </div>
      <div class="okr-prog">
        <div class="bar ${over ? "over" : ""}"><i style="width:${Math.min(100, pct)}%"></i></div>
        <span class="okr-pct ${over ? "over" : ""}">${pct}%</span>
      </div>
      <div class="okr-actions">${actions}</div>
    </div>`;
}

/* 노드 아래 KR 리스트 (투두처럼) — editable 이면 체크인·삭제·추가 폼
   KR은 하위 OKR이 없는 '최하위 OKR'에만 붙는다. 개수가 늘 수 있어 토글로 접는다. */
function okrKrListHtml(o, idx, opts) {
  opts = opts || {};
  const krs = o.krs || [];
  const isLeaf = !idx.childrenOf(o.id).length;
  // 기존 KR의 체크인·삭제는 권한만 있으면 항상 가능. 새 KR 추가만 '최하위 OKR'(회사 O 제외)로 제한
  const editable = !!opts.editable && !okrReadonly && canEditOkr(o);
  const canAdd = editable && isLeaf && !!o.parentId;
  if (!krs.length && !canAdd) return "";
  const depth = opts.flat ? 0 : Math.min(idx.depthOf(o.id), 6);
  const color = okrStripeColor(o);
  const key = `krs:${okrTab}:${o.id}`;   // 탭마다 따로 기억 (진행현황에서 접은 게 내 OKR에 번지지 않게)
  const open = okrOpenState.has(key) ? okrOpenState.get(key) : !opts.krCollapsed;
  return `
    <div class="okr-krs" style="--okr-depth:${depth}" data-krs="${o.id}">
      ${krs.length ? `<div class="okr-sec-head" data-toggle="${key}" title="${open ? "접기" : "펼치기"}">
         <span class="tg-tri">${open ? "\u25bc" : "\u25b6"}</span> KR (${krs.length})</div>` : ""}
      <div class="okr-kr-group">
      <div class="okr-kr-body" data-children="${key}" ${krs.length && !open ? "hidden" : ""}>
      ${krs.map((k) => {
        const raw = krPct(k, true);
        const p = okrPctDisplay(raw);
        const over = p > 100;
        return `
        <div class="okr-kr" data-kr="${k.id}">
          <span class="kr-dot" style="background:${color}"></span>
          <span class="kr-title">${esc(k.title)}${k.deadline ? ` <em class="kr-due">~${esc(k.deadline.slice(5))}</em>` : ""}</span>
          <span class="kr-num">${fmt(k.current || 0)} / ${fmt(k.target)} ${esc(k.unit || "")}</span>
          <div class="okr-prog"><div class="bar ${over ? "over" : ""}"><i style="width:${Math.min(100, p)}%"></i></div><span class="okr-pct ${over ? "over" : ""}">${p}%</span></div>
          <div class="okr-actions">
            ${editable ? `<button class="btn btn-sm btn-okr-prog" data-kr-check="${o.id}|${k.id}">체크인</button>
                          <button class="btn-icon danger" title="KR 삭제" data-kr-del="${o.id}|${k.id}">${ICON_TRASH}</button>` : ""}
          </div>
        </div>`;
      }).join("")}
      </div>
      ${canAdd ? `
        <button type="button" class="kr-add-btn" data-kr-add="${o.id}">+ KR 추가</button>
        <form class="kr-add-form" id="kr-form-${o.id}" hidden>
          <input class="kr-f-title" required maxlength="60" placeholder="KR 제목 입력 (예: 팀 소개페이지 작성)" />
          <div class="kr-f-row">
            <input class="kr-f-target" type="number" min="1" step="any" required placeholder="목표 수치" />
            <select class="kr-f-unit">${OKR_UNITS.map((u) => `<option>${u}</option>`).join("")}</select>
          </div>
          <div class="kr-f-due">마감일 (선택)${calField(`kr-dl-${o.id}`, "")}</div>
          <div class="kr-f-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-kr-cancel="${o.id}">취소</button>
            <button type="submit" class="btn btn-primary btn-sm">추가</button>
          </div>
        </form>` : ""}
      </div>
    </div>`;
}

/* 트리 전체 — 노드 + (KR 리스트) + 하위 노드. collapsible 이면 부서 아래는 접어 둔다 */
function okrTreeHtml(idx, visibleIds, opts) {
  opts = opts || {};
  const render = (o) => {
    if (visibleIds && !visibleIds.has(o.id)) return "";
    const kids = idx.childrenOf(o.id).filter((k) => !visibleIds || visibleIds.has(k.id));
    const depth = idx.depthOf(o.id);
    // 진행현황(collapsible)은 부서 아래부터 접어 두고, 사용자가 누른 상태는 기억한다
    const nodeKey = `${okrTab}:${o.id}`;
    const open = okrOpenState.has(nodeKey) ? okrOpenState.get(nodeKey) : !(opts.collapsible && depth >= 1);
    const childLevel = OKR_LEVEL_LABELS[Math.min(depth + 1, OKR_LEVEL_LABELS.length - 1)];
    return `<div class="okr-node">
      ${okrRowHtml(o, idx, opts)}
      ${okrKrListHtml(o, idx, opts)}
      ${kids.length ? `
        <div class="okr-sec-head" style="--okr-depth:${Math.min(depth + 1, 6)}" data-toggle="${nodeKey}" title="${open ? "접기" : "펼치기"}">
          <span class="tg-tri">${open ? "\u25bc" : "\u25b6"}</span> 연결된 ${childLevel} OKR (${kids.length})</div>
        <div class="okr-children" data-children="${nodeKey}" ${open ? "" : "hidden"}>
          ${kids.map(render).join("")}
        </div>` : ""}
    </div>`;
  };
  const html = idx.roots.map(render).join("");
  return html.trim() ? `<div class="okr-tree">${html}</div>` : "";
}

/* 줄에 붙는 버튼 — 생성 후 수정은 불가. 체크인은 KR에서만 하므로 여기엔 삭제만 둔다 */
function okrActionBtns(o, idx) {
  if (okrReadonly || !canEditOkr(o)) return "";
  return `<button class="btn-icon danger" title="삭제" data-okr-del="${o.id}">${ICON_TRASH}</button>`;
}

function bindOkrActions(scope, okrs, emps, idx) {
  scope.querySelectorAll("[data-okr-del]").forEach((b) => {
    b.onclick = () => deleteOkr(idx.byId[b.dataset.okrDel], idx);
  });
  scope.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.toggle;
      const box = scope.querySelector(`[data-children="${id}"]`);
      if (!box) return;
      const open = box.hidden;
      box.hidden = !open;
      const tri = b.querySelector(".tg-tri");
      if (tri) tri.textContent = open ? "\u25bc" : "\u25b6";
      b.title = open ? "접기" : "펼치기";
      okrOpenState.set(id, open);
    };
  });
  // KR 체크인 / 삭제 / 추가
  scope.querySelectorAll("[data-kr-check]").forEach((b) => {
    b.onclick = () => {
      const [oid, kid] = b.dataset.krCheck.split("|");
      const o = idx.byId[oid];
      const k = (o.krs || []).find((x) => x.id === kid);
      if (o && k) openOkrCheckinModal(o, k);
    };
  });
  scope.querySelectorAll("[data-kr-del]").forEach((b) => {
    b.onclick = () => {
      const [oid, kid] = b.dataset.krDel.split("|");
      deleteKr(idx.byId[oid], kid);
    };
  });
  scope.querySelectorAll("[data-kr-add]").forEach((b) => {
    b.onclick = () => {
      const f = scope.querySelector(`#kr-form-${b.dataset.krAdd}`);
      if (!f) return;
      f.hidden = false;
      b.hidden = true;
      f.querySelector(".kr-f-title").focus();
    };
  });
  scope.querySelectorAll("[data-kr-cancel]").forEach((b) => {
    b.onclick = () => {
      const f = scope.querySelector(`#kr-form-${b.dataset.krCancel}`);
      const add = scope.querySelector(`[data-kr-add="${b.dataset.krCancel}"]`);
      if (f) { f.hidden = true; f.reset(); calSet(`kr-dl-${b.dataset.krCancel}`, ""); }
      if (add) add.hidden = false;
    };
  });
  scope.querySelectorAll(".kr-add-form").forEach((f) => {
    const oid = f.id.replace("kr-form-", "");
    const node = idx.byId[oid];
    bindCalField(`kr-dl-${oid}`, null, () => ({ max: node && node.deadline ? node.deadline : "" }));
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      if (f.dataset.busy) return;   // 더블클릭으로 KR이 두 번 들어가지 않게
      f.dataset.busy = "1";
      await addKr(node, {
        title: f.querySelector(".kr-f-title").value.trim(),
        target: Number(f.querySelector(".kr-f-target").value),
        unit: f.querySelector(".kr-f-unit").value,
        deadline: calVal(`kr-dl-${oid}`) || null
      });
      delete f.dataset.busy;
    };
  });
}

/* ── 내 OKR ── */
function renderOkrMine(okrs, emps, idx) {
  const body = $("#okr-body");
  const mine = okrs.filter((o) => o.ownerId === me.id)
    .sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));
  const opts = { actions: (o) => okrActionBtns(o, idx), editable: true, flat: true };
  body.innerHTML = `
    <div class="card">
      <div class="card-title">내 OKR
        <span class="ct-desc">내가 담당하는 목표입니다. 아래에 정량 KR을 추가하고 체크인하면 진행률이 자동 계산됩니다.</span>
        ${okrReadonly || !(idx.roots.length || canEditCompanyOkr()) ? "" : `<button class="btn btn-primary btn-sm" id="okr-add" style="margin-left:auto">OKR 추가</button>`}
      </div>
      ${mine.length
        ? `<div class="okr-tree">${mine.map((o) => {
            const parent = o.parentId ? idx.byId[o.parentId] : null;
            return `<div class="okr-item">
              ${parent ? `<div class="okr-parent-line">↳ 상위: <b>[${idx.levelLabel(parent.id)}] ${esc(parent.title)}</b></div>` : ""}
              ${okrRowHtml(o, idx, opts)}
              ${okrKrListHtml(o, idx, opts)}
            </div>`;
          }).join("")}</div>`
        : `<div class="empty">아직 내 OKR이 없습니다.${okrReadonly ? "" : (idx.roots.length || canEditCompanyOkr()) ? " [OKR 추가]로 상위 OKR에 연결된 목표를 만들어 보세요." : " 회사 OKR이 아직 없습니다 — 총괄 관리자에게 문의하세요."}</div>`}
    </div>`;
  const addBtn = $("#okr-add");
  if (addBtn) addBtn.onclick = () => openOkrModal(okrs, emps, idx);
  bindOkrActions(body, okrs, emps, idx);
}

/* ── 부서 OKR — 부서 노드 + 문맥용 상위 노드를 트리로 ── */
function renderOkrDept(okrs, emps, idx) {
  const body = $("#okr-body");
  const depts = [...new Set(okrs.map((o) => o.dept).filter(Boolean))].sort();
  if (!renderOkrDept._dept || !depts.includes(renderOkrDept._dept)) {
    renderOkrDept._dept = depts.includes(me.dept) ? me.dept : (depts[0] || "");
  }
  const dept = renderOkrDept._dept;
  const visible = new Set();
  okrs.filter((o) => o.dept === dept || !o.parentId).forEach((o) => {
    let cur = o;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      visible.add(cur.id);
      cur = cur.parentId ? idx.byId[cur.parentId] : null;
    }
  });
  const opts = { actions: (o) => okrActionBtns(o, idx), editable: true, meTag: true };  // 내 항목엔 '나' 태그
  body.innerHTML = `
    <div class="card">
      <div class="card-title">부서 OKR
        <span class="ct-desc">부서 목표와 그 상위 연결을 트리로 봅니다.</span>
        ${depts.length ? `<select id="okr-dept-sel" class="okr-dept-sel" style="margin-left:auto">
          ${depts.map((d) => `<option value="${esc(d)}" ${d === dept ? "selected" : ""}>${esc(d)}</option>`).join("")}
        </select>` : ""}
      </div>
      ${okrTreeHtml(idx, visible, opts) || `<div class="empty">이 부서의 OKR이 아직 없습니다.</div>`}
    </div>`;
  const sel = $("#okr-dept-sel");
  if (sel) sel.onchange = (ev) => { renderOkrDept._dept = ev.target.value; renderOkrDept(okrs, emps, idx); };
  bindOkrActions(body, okrs, emps, idx);
}

/* ── 진행현황 — 전사 위계 트리 + 요약 (전 직원 공개, 부서 아래는 접어서) ── */
function renderOkrStatus(okrs, emps, idx) {
  const body = $("#okr-body");
  const companyProg = idx.roots.length
    ? okrPctDisplay(idx.roots.reduce((s, r) => s + idx.progressOf(r.id), 0) / idx.roots.length) : 0;
  const soon = okrs.filter((o) => {
    const d = okrDday(o.deadline);
    return d !== null && d >= 0 && d <= 7 && idx.progressOf(o.id) < 100;
  }).length;
  const late = okrs.filter((o) => {
    const d = okrDday(o.deadline);
    return d !== null && d < 0 && idx.progressOf(o.id) < 100;
  }).length;
  const legendDepts = [...new Set(okrs.map((o) => o.parentId ? o.dept : "대표").filter(Boolean))]
    .filter((d) => OKR_DEPT_COLORS[d]);
  // 전체 OKR = O(목표) 개수. KR은 세지 않는다. 미진행 = 1%도 진행되지 않은 것
  const done = okrs.filter((o) => idx.progressOf(o.id) >= 100).length;
  const idle = okrs.filter((o) => idx.progressOf(o.id) < 1).length;
  const active = okrs.length - done - idle;
  body.innerHTML = `
    <div class="okr-stats">
      <div class="card okr-stat"><div class="os-num">${companyProg}%</div><div class="os-label">회사 목표 진행률</div></div>
      <div class="card okr-stat"><div class="os-num">${okrs.length}</div><div class="os-label">전체 OKR (O 기준)</div>
        <div class="os-sub"><span class="ok">완료 ${done}</span><i></i><span>진행중 ${active}</span><i></i><span class="${idle ? "idle" : ""}">미진행 ${idle}</span></div></div>
      <div class="card okr-stat"><div class="os-num ${soon ? "warn" : ""}">${soon}</div><div class="os-label">마감 임박 (7일 이내)</div></div>
      <div class="card okr-stat"><div class="os-num ${late ? "warn" : ""}">${late}</div><div class="os-label">지연</div></div>
    </div>
    <div class="card">
      <div class="card-title">전사 진행현황
        <span class="ct-desc">부서 아래 세부 OKR·KR은 ▸ 버튼으로 펼쳐 봅니다.</span>
        ${canEditCompanyOkr() && !idx.roots.length && !okrReadonly ? `<button class="btn btn-primary btn-sm" id="okr-add-root" style="margin-left:auto">회사 OKR 만들기</button>` : ""}
      </div>
      ${legendDepts.length ? `<div class="okr-legend">${legendDepts.map((d) =>
        `<span class="okr-legend-item"><i style="background:${OKR_DEPT_COLORS[d]}"></i>${esc(d)}</span>`).join("")}</div>` : ""}
      ${okrTreeHtml(idx, null, { collapsible: true, krCollapsed: true, meTag: true }) || `<div class="empty">등록된 OKR이 없습니다.${canEditCompanyOkr() ? " 회사 최상위 O부터 만들어 주세요." : ""}</div>`}
      ${idx.orphans.length ? `
        <div class="okr-orphans">
          <div class="okr-sec-head static">⚠ 상위 OKR이 없는 항목 (${idx.orphans.length}) — 상위가 삭제됐거나 다른 사이클에 있습니다</div>
          <div class="okr-tree">${idx.orphans.map((o) => okrRowHtml(o, idx, { flat: true, meTag: true })).join("")}</div>
        </div>` : ""}
    </div>`;
  const rootBtn = $("#okr-add-root");
  if (rootBtn) rootBtn.onclick = () => openOkrModal(okrs, emps, idx);
  bindOkrActions(body, okrs, emps, idx);
}

/* ── OKR 추가 모달 (생성 후에는 수정 불가) ── */
function openOkrModal(okrs, emps, idx) {
  const allowRoot = canEditCompanyOkr();
  const canPickOwner = canManageOps();
  /* 상위 후보: 회사 O + 담당자 부서의 OKR만 (다른 부서 트리에 붙는 일을 막는다) */
  // 회사 O가 하나뿐이면 기본 선택 — 그 바로 아래에 만들면 담당자 부서의 '부서 OKR'이 된다
  const preselect = idx.roots.length === 1 ? idx.roots[0].id : null;
  const parentOptionsHtml = (dept) => {
    const out = [];
    const walk = (o) => {
      if (!o.parentId || o.dept === dept) {
        out.push(`<option value="${o.id}" ${o.id === preselect ? "selected" : ""}>[${idx.levelLabel(o.id)}] ${esc(o.title)}</option>`);
      }
      idx.childrenOf(o.id).forEach(walk);
    };
    idx.roots.forEach(walk);
    return `<option value="" disabled ${preselect ? "" : "selected"}>상위 OKR을 선택하세요</option>`
      + (allowRoot ? `<option value="__root">(없음) — 회사 최상위 O 로 만들기</option>` : "")
      + out.join("");
  };
  const ownerSel = canPickOwner
    ? `<select id="of-owner">${emps.map((e) =>
        `<option value="${e.id}" ${me.id === e.id ? "selected" : ""}>${esc(e.name)} (${esc(e.dept || "-")})</option>`).join("")}</select>`
    : `<input value="${esc(me.name)}" disabled />`;

  openModal(`
    <h3>OKR 추가</h3>
    <p class="modal-desc">OKR은 목표(제목·담당자·마감일)만 정하고, 정량 수치는 만든 뒤 아래에 KR로 추가합니다. 한번 만든 OKR은 수정할 수 없습니다.</p>
    <form id="okr-form">
      <label class="field"><span class="field-label">OKR 제목</span>
        <input id="of-title" required maxlength="80" placeholder="예: 소개페이지 제작" /></label>
      <div id="of-owner-wrap"><label class="field"><span class="field-label">담당자</span>${ownerSel}</label></div>
      <label class="field"><span class="field-label">상위 OKR 연결${allowRoot ? " (비우면 회사 최상위 O)" : ""}</span>
        <select id="of-parent" required>${parentOptionsHtml(me.dept || "")}</select>
        <span class="field-hint" id="of-level-hint"></span></label>
      <label class="field"><span class="field-label">목표 마감일 <b style="color:var(--red,#f04452)">*</b></span>
        ${calField("of-deadline", "")}</label>
      <p class="modal-desc" id="of-hint"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="of-cancel">취소</button>
        <button type="submit" class="btn btn-primary btn-sm">OKR 추가</button>
      </div>
    </form>`);

  const parentSel = $("#of-parent");
  const ownerDept = () => {
    const sel = $("#of-owner");
    if (!sel) return me.dept || "";
    const e = emps.find((x) => x.id === sel.value);
    return e ? (e.dept || "") : "";
  };
  const sync = () => {
    const isRoot = parentSel.value === "__root";
    $("#of-owner-wrap").style.display = isRoot ? "none" : "";   // 회사 O는 담당자 없이 전사 목표
    const p = parentSel.value && !isRoot ? idx.byId[parentSel.value] : null;
    const dept = ownerDept() || "(부서 없음)";
    const lv = p ? OKR_LEVEL_LABELS[Math.min(idx.depthOf(p.id) + 1, OKR_LEVEL_LABELS.length - 1)] : "";
    $("#of-level-hint").textContent = isRoot ? "회사 최상위 O로 등록됩니다."
      : p ? (!p.parentId
          ? `회사 OKR 바로 아래 → ${dept}의 부서 OKR로 자동 등록됩니다.`
          : `[${idx.levelLabel(p.id)}] 아래 ${lv} OKR로 등록됩니다. (부서: ${dept})`)
      : "회사 O와 담당자 부서의 OKR만 연결할 수 있습니다.";
    $("#of-hint").textContent = p && p.deadline
      ? `상위 OKR 마감일(${p.deadline}) 이내로만 설정할 수 있습니다.`
      : (isRoot ? "회사 최상위 O는 담당자 없이 전사 목표로 만듭니다." : "");
    ofMax = p && p.deadline ? p.deadline : "";
    if (ofMax && calVal("of-deadline") > ofMax) calSet("of-deadline", "");   // 상위가 바뀌어 범위를 벗어나면 비운다
  };
  let ofMax = "";
  bindCalField("of-deadline", null, () => ({ max: ofMax }));
  parentSel.onchange = sync;
  const ownerEl = $("#of-owner");
  if (ownerEl) ownerEl.onchange = () => {
    const prev = parentSel.value;
    parentSel.innerHTML = parentOptionsHtml(ownerDept());
    if (prev && [...parentSel.options].some((op) => op.value === prev)) parentSel.value = prev;   // 여전히 유효하면 유지
    sync();
  };
  sync();
  $("#of-cancel").onclick = closeModal;

  $("#okr-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const title = $("#of-title").value.trim();
    const isRoot = parentSel.value === "__root";
    const parentId = isRoot ? null : (parentSel.value || null);
    const deadline = calVal("of-deadline");
    if (!title) return toast("제목을 입력하세요.");
    if (!isRoot && !parentId) return toast("상위 OKR을 선택하세요.");
    if (isRoot && !canEditCompanyOkr()) return toast("회사 O는 총괄 관리자·대표만 만들 수 있습니다.");
    if (!deadline) return toast("목표 마감일을 입력하세요.");
    const parent = parentId ? idx.byId[parentId] : null;
    if (parentId && !parent) return toast("상위 OKR을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.");
    if (parent && parent.deadline && deadline > parent.deadline) {
      return toast(`마감일은 상위 OKR 마감일(${parent.deadline}) 이내여야 합니다.`);
    }
    let ownerId = null, ownerName = "", dept = "";
    if (parentId) {
      ownerId = me.id; ownerName = me.name || ""; dept = me.dept || "";
      const sel = $("#of-owner");
      if (canManageOps() && sel) {
        const e = emps.find((x) => x.id === sel.value);
        if (e) { ownerId = e.id; ownerName = e.name || ""; dept = e.dept || ""; }
      }
      if (parent.parentId && parent.dept !== dept) return toast("담당자 부서의 OKR에만 연결할 수 있습니다.");
    }
    try {
      await db.collection(COL.okrs).add({
        title, parentId, ownerId, ownerName, dept, deadline,
        krs: [], checkins: [],
        cycleId: okrActiveCycleId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal();
      toast("OKR을 추가했습니다. 아래에 정량 KR을 추가해 보세요.");
      renderOkr();
    } catch (e) {
      toast("저장에 실패했습니다. 잠시 후 다시 시도하세요.");
    }
  };
}

/* ── KR 추가 / 삭제 ── */
async function addKr(o, kr) {
  if (!o || okrReadonly || !canEditOkr(o)) return;
  if (!o.parentId) return toast("회사 최상위 O에는 KR을 붙일 수 없습니다.");
  if (!kr.title) return toast("KR 제목을 입력하세요.");
  if (!(kr.target > 0)) return toast("목표 수치를 입력하세요.");
  if (!OKR_UNITS.includes(kr.unit)) return toast("단위를 선택하세요.");
  if (kr.deadline && o.deadline && kr.deadline > o.deadline) return toast(`KR 마감일은 OKR 마감일(${o.deadline}) 이내여야 합니다.`);
  const entry = {
    id: `kr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: kr.title, target: kr.target, unit: kr.unit, current: 0,
    deadline: kr.deadline || null, createdAt: new Date().toISOString()
  };
  try {
    await mutateOkr(o.id, (cur) => ({ krs: [...(cur.krs || []), entry] }));
    toast("KR을 추가했습니다.");
    renderOkr();
  } catch (e) {
    toast("저장에 실패했습니다. 잠시 후 다시 시도하세요.");
  }
}
async function deleteKr(o, krId) {
  if (!o || okrReadonly || !canEditOkr(o)) return;
  const k = (o.krs || []).find((x) => x.id === krId);
  if (!k) return;
  if (!confirm(`'${k.title}' KR을 삭제할까요?`)) return;
  try {
    await mutateOkr(o.id, (cur) => ({ krs: (cur.krs || []).filter((x) => x.id !== krId) }));
    toast("KR을 삭제했습니다.");
    renderOkr();
  } catch (e) {
    toast("삭제에 실패했습니다. 잠시 후 다시 시도하세요.");
  }
}

/* ── 체크인 — KR(또는 과거 방식 정량 노드)에 새 값 + 메모, 최근 기록 ── */
function openOkrCheckinModal(okr, kr) {
  const tgt = kr || okr;
  const pctOf = (v) => Number(tgt.target) > 0 ? (Number(v) || 0) / Number(tgt.target) * 100 : 0;
  const history = [...(okr.checkins || [])]
    .filter((c) => kr ? c.krId === kr.id : !c.krId)
    .sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 5);
  const curVal = Number(tgt.current) || 0;
  openModal(`
    <h3>체크인</h3>
    <div class="checkin-goal">
      <b>${esc(tgt.title)}</b>
      ${kr ? `<div class="cg-parent">↳ ${esc(okr.title)}</div>` : ""}
      <div>현재: ${fmt(curVal)} / 목표: ${fmt(tgt.target)} ${esc(tgt.unit || "")} (${okrPctDisplay(pctOf(curVal))}%)</div>
    </div>
    <form id="okr-prog-form">
      <label class="field"><span class="field-label">새 값 (${esc(tgt.unit || "")})</span>
        <input id="op-cur" type="number" min="0" step="any" required value="${esc(curVal)}" /></label>
      <label class="field"><span class="field-label">메모 (선택)</span>
        <textarea id="op-memo" rows="3" maxlength="200" placeholder="진행 상황을 기록하세요..."></textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="op-cancel">취소</button>
        <button type="submit" class="btn btn-primary btn-sm">체크인 저장</button>
      </div>
    </form>
    ${history.length ? `
      <div class="checkin-history">
        <div class="ch-title">최근 체크인 기록</div>
        ${history.map((c) => `
          <div class="ch-row">
            <div class="ch-main">
              <b>${fmt(c.value)} ${esc(tgt.unit || "")} (${okrPctDisplay(Number(c.pct) || 0)}%)</b>
              ${c.memo ? `<div class="ch-memo">${esc(c.memo)}</div>` : ""}
            </div>
            <span class="ch-when">${esc(c.empName || "")} · ${okrFeedTime(c.at)}</span>
          </div>`).join("")}
      </div>` : ""}`);
  $("#op-cancel").onclick = closeModal;
  $("#okr-prog-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const cur = Number($("#op-cur").value);
    if (!(cur >= 0)) return toast("0 이상의 수치를 입력하세요.");
    if (cur === curVal) return toast("수치가 변경되지 않았습니다. 새 값을 입력하세요.");
    const memo = $("#op-memo").value.trim();
    const entry = {
      empId: me.id, empName: me.name,
      value: cur, pct: Math.round(pctOf(cur) * 10) / 10,
      memo, at: new Date().toISOString()
    };
    if (kr) { entry.krId = kr.id; entry.krTitle = kr.title; }
    try {
      await mutateOkr(okr.id, (latest) => {
        const patch = { checkins: [...(latest.checkins || []).slice(-29), entry] };   // 최근 30건 보관
        if (kr) {
          if (!(latest.krs || []).some((x) => x.id === kr.id)) throw new Error("kr-gone");
          patch.krs = (latest.krs || []).map((x) => x.id === kr.id ? { ...x, current: cur } : x);
        } else {
          patch.current = cur;
        }
        return patch;
      });
      closeModal();
      toast("체크인을 저장했습니다.");
      renderOkr();
    } catch (e) {
      toast("저장에 실패했습니다. 잠시 후 다시 시도하세요.");
    }
  };
}

/* OKR 문서를 최신 상태로 다시 읽어 고치는 트랜잭션 — krs/checkins 배열을 통째로 쓰므로
   렌더 시점의 낡은 사본으로 남의 변경을 덮어쓰지 않도록 한다 */
async function mutateOkr(id, fn) {
  const ref = db.collection(COL.okrs).doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("not-found");
    const patch = fn({ id: snap.id, ...snap.data() });
    if (patch) tx.update(ref, { ...patch, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  });
}

async function deleteOkr(okr, idx) {
  if (!okr || okrReadonly || !canEditOkr(okr)) return;
  if (idx.childrenOf(okr.id).length) {
    return toast("하위 OKR이 연결되어 있어 삭제할 수 없습니다. 하위 OKR을 먼저 정리하세요.");
  }
  const n = (okr.krs || []).length;
  if (!confirm(`'${okr.title}' OKR을 삭제할까요?${n ? ` (연결된 KR ${n}개도 함께 삭제됩니다)` : ""}`)) return;
  try {
    await db.collection(COL.okrs).doc(okr.id).delete();
    toast("OKR을 삭제했습니다.");
    renderOkr();
  } catch (e) {
    toast("삭제에 실패했습니다. 잠시 후 다시 시도하세요.");
  }
}

/* ── 사이클 관리 (총괄 관리자) — 만들기 / 활성화 / 삭제 ── */
function openOkrCycleModal(cycles, allOkrs) {
  if (!isAdmin()) return;
  const countOf = (cid) => allOkrs.filter((o) => (o.cycleId || null) === cid).length;
  openModal(`
    <h3>사이클 관리</h3>
    <p class="modal-desc">분기·연도 단위로 사이클을 만들어 운영하세요. '활성' 사이클 하나만 전 직원에게 보이고, 나머지는 보관됩니다.</p>
    <div class="cycle-list">
      ${cycles.length ? cycles.map((c) => `
        <div class="cycle-row">
          <b>${esc(c.name)}</b>
          <span class="cy-meta">OKR ${countOf(c.id)}개</span>
          ${c.active
            ? `<span class="badge ok">활성</span>`
            : `<button class="btn btn-ghost btn-sm" data-cy-act="${c.id}">활성화</button>`}
          <button class="btn-icon danger" title="삭제" data-cy-del="${c.id}">${ICON_TRASH}</button>
        </div>`).join("")
        : `<div class="empty">아직 사이클이 없습니다. 첫 사이클을 만들면 자동으로 활성화되고 기존 OKR이 담깁니다.</div>`}
    </div>
    <form id="cycle-form" class="cycle-new">
      <input id="cy-name" required maxlength="30" placeholder="예: 2026 4Q" />
      <button type="submit" class="btn btn-primary btn-sm">사이클 만들기</button>
    </form>
    <div class="modal-actions"><button type="button" class="btn btn-ghost btn-sm" id="cy-close">닫기</button></div>`);
  $("#cy-close").onclick = closeModal;

  $("#cycle-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const name = $("#cy-name").value.trim();
    if (!name) return toast("사이클 이름을 입력하세요.");
    if (cycles.some((c) => c.name === name)) return toast("같은 이름의 사이클이 이미 있습니다.");
    try {
      const ref = await db.collection(COL.okrCycles).add({
        name,
        active: cycles.length === 0,   // 첫 사이클은 바로 활성화
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (cycles.length === 0) {
        const orphans = allOkrs.filter((o) => !o.cycleId);
        await Promise.all(orphans.map((o) => db.collection(COL.okrs).doc(o.id).update({ cycleId: ref.id })));
      }
      closeModal();
      toast(`'${name}' 사이클을 만들었습니다.${cycles.length === 0 ? " (활성화됨)" : " 활성화하려면 사이클 관리에서 [활성화]를 누르세요."}`);
      renderOkr();
    } catch (e) {
      toast("사이클 생성에 실패했습니다. 잠시 후 다시 시도하세요.");
    }
  };

  document.querySelectorAll("[data-cy-act]").forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.cyAct;
      const c = cycles.find((x) => x.id === id);
      if (!confirm(`'${c ? c.name : ""}' 사이클을 활성화할까요? 전 직원 화면이 이 사이클로 바뀝니다.`)) return;
      try {
        await Promise.all(cycles.map((x) => db.collection(COL.okrCycles).doc(x.id).update({ active: x.id === id })));
        // 사이클 없이 만들어져 어디에도 안 보이던 OKR이 있으면 이 사이클로 편입
        const lost = allOkrs.filter((o) => !o.cycleId);
        await Promise.all(lost.map((o) => db.collection(COL.okrs).doc(o.id).update({ cycleId: id })));
        closeModal();
        toast("활성 사이클을 변경했습니다. 전 직원 화면에 바로 적용됩니다.");
        renderOkr();
      } catch (e) {
        toast("변경에 실패했습니다. 잠시 후 다시 시도하세요.");
      }
    };
  });

  document.querySelectorAll("[data-cy-del]").forEach((b) => {
    b.onclick = async () => {
      const c = cycles.find((x) => x.id === b.dataset.cyDel);
      if (!c) return;
      if (c.active) return toast("활성 사이클은 삭제할 수 없습니다. 다른 사이클을 먼저 활성화하세요.");
      const n = countOf(c.id);
      const msg = n
        ? `'${c.name}' 사이클과 그 안의 OKR ${n}개가 모두 삭제됩니다. 계속할까요?`
        : `'${c.name}' 사이클을 삭제할까요?`;
      if (!confirm(msg)) return;
      try {
        const targets = allOkrs.filter((o) => o.cycleId === c.id);
        await Promise.all(targets.map((o) => db.collection(COL.okrs).doc(o.id).delete()));
        await db.collection(COL.okrCycles).doc(c.id).delete();
        closeModal();
        toast("사이클을 삭제했습니다.");
        renderOkr();
      } catch (e) {
        toast("삭제에 실패했습니다. 잠시 후 다시 시도하세요.");
      }
    };
  });
}

/* ───────── 시작 ───────── */
$("#modal-backdrop").addEventListener("click", (ev) => {
  if (ev.target === $("#modal-backdrop")) closeModal();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeModal();
});

/* ── 화면 로딩 가드 ──────────────────────────────────────────────────
   Firestore 스트리밍 연결이 반쯤 죽으면 저장은 되는데 재조회만 무한 대기해
   "불러오는 중..."에서 화면이 멈춘다. 모든 화면 렌더 함수를 감싸,
   5초 안에 안 끝나면 조용히 1회 재시도하고(새 요청이 죽은 연결을 깨운다),
   그래도 안 되면 [다시 시도] 버튼을 보여준다. */
const VIEW_LOAD_TIMEOUT_MS = 5000;
let renderSeq = 0;
function guardRender(name, fn) {
  return async function (...args) {
    const seq = ++renderSeq;
    for (let attempt = 1; ; attempt++) {
      try {
        await Promise.race([
          fn.apply(this, args),
          new Promise((_, rej) => setTimeout(() => rej(new Error("화면 로딩 시간 초과")), VIEW_LOAD_TIMEOUT_MS))
        ]);
        return;
      } catch (e) {
        if (seq !== renderSeq) return;   // 그 사이 다른 화면으로 이동함 — 조용히 종료
        if (attempt === 1) continue;     // 1회 자동 재시도
        const main = $("#main");
        if (main) main.innerHTML = `
          <div class="empty" style="padding:60px 20px">
            연결이 불안정해 화면을 불러오지 못했습니다.<br />
            <button type="button" class="btn btn-primary btn-sm" id="view-retry" style="margin-top:14px">다시 시도</button>
          </div>`;
        const rb = $("#view-retry");
        if (rb) rb.onclick = () => window[name](...args);
        return;
      }
    }
  };
}
["renderHome", "renderSchedule", "renderAttend", "renderAttendAdmin", "renderPayHistory",
 "renderPayroll", "renderLeave", "renderLeaveAdmin", "renderSettings", "renderSystems",
 "renderEmployees", "renderMonitor", "renderOkr"].forEach((name) => {
  if (typeof window[name] === "function") window[name] = guardRender(name, window[name]);
});

boot();
