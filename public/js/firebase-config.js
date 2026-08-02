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
  homeButtons: "homeButtons",
  personalButtons: "personalButtons",
  payroll: "payroll", // payroll/{YYYY-MM}/rows/{id}
  leaves: "leaves",
  settings: "settings",
  auditLogs: "auditLogs"
};
