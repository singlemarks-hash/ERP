// Firebase 프로젝트 설정
// Firebase 콘솔 > 프로젝트 설정 > 일반 > 내 앱 > SDK 설정 및 구성 에서 발급받은 값으로 교체하세요.
// (기존 payroll-3719e 프로젝트를 그대로 쓰려면 해당 프로젝트의 config를 넣으면 됩니다.)
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
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
