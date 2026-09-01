// Firebase 프로젝트 설정 (singlemarkserp)
// Firebase 콘솔 > 프로젝트 설정 > 일반 > 내 앱 > SDK 설정 및 구성 의 값.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCR4mxIXC9TuyENMJxWbgMv1s2gT_7KRT8",
  authDomain: "singlemarkserp.firebaseapp.com",
  projectId: "singlemarkserp",
  storageBucket: "singlemarkserp.firebasestorage.app",
  messagingSenderId: "495549640167",
  appId: "1:495549640167:web:aeefaf7368eba847f9a142"
};

// 컬렉션 경로 상수 — 추후 멀티테넌트(SaaS) 전환 시 이곳만 companies/{id}/... 로 바꾸면 된다.
const COL = {
  employees: "employees",
  systems: "systems", // 사내 시스템 버튼 (계정별 권한 부여)
  personalButtons: "personalButtons",
  todos: "todos",   // 직원별 업무 할 일
  memos: "memos",   // 직원별 개인 메모장
  payroll: "payroll", // payroll/{YYYY-MM}/rows/{id}
  leaves: "leaves",
  leaveRequests: "leaveRequests",
  settings: "settings",
  notices: "notices",   // 공지사항 (전체/부서/개별 게시)
  schedules: "schedules", // 전사 일정 (휴무/행사/기타)
  shifts: "shifts",           // 근무 일정 (근무 캘린더)
  attendance: "attendance",   // 출퇴근 기록 (문서 id: empId_YYYY-MM-DD)
  workNotices: "workNotices", // [레거시] 근무 변경 알림 — 근무변경 결재로 대체. 기존 문서 표시용
  attRequests: "attRequests", // 근태 결재 (추가근무·근무변경 신청 → 결재자 승인)
  okrs: "okrs"                // OKR 트리 (parentId=null 이면 회사 최상위 O)
};
