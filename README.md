# 작은따옴표 ERP — 실행 가이드

전체 설계는 `ERP_구축계획서.md` 참고.

구성: **Vercel(호스팅) + Firebase(DB·인증)**. 코드는 정적 SPA라 터미널 없이 웹 콘솔만으로 운영 가능.

## 1. Firebase 준비 (최초 1회, 콘솔에서)
프로젝트: `singlemarkserp` (https://console.firebase.google.com)

1. **프로젝트 설정 > 일반 > 내 앱**에서 웹 앱(`</>`) 등록 → 발급된 firebaseConfig 값을 `public/js/firebase-config.js`에 입력
2. **빌드 > Authentication > 로그인 방법**에서 `익명` 활성화
3. **빌드 > Firestore Database** 생성 (위치: asia-northeast3 서울, 프로덕션 모드)
4. **Firestore > 규칙** 탭에 저장소의 `firestore.rules` 내용을 붙여넣고 게시
5. **Authentication > 설정 > 승인된 도메인**에 Vercel 배포 도메인(예: `xxx.vercel.app`) 추가

## 2. 배포 (Vercel)
1. https://vercel.com → **Add New… > Project** → GitHub에서 `singlemarks-hash/ERP` Import
2. Framework Preset: **Other** (그 외 설정은 `vercel.json`이 자동 적용 — Output: `public`)
3. **Deploy** 클릭 → 이후 `main` 브랜치에 push 할 때마다 자동 재배포

(참고) Firebase Hosting으로도 배포 가능: `firebase deploy` — `firebase.json` 유지되어 있음.

로컬 미리보기: `npx serve public`
(파일을 직접 열지 말고 반드시 http 서버로 열 것 — 브라우저 보안 정책 때문)

## 3. 최초 사용 순서
1. 배포된 주소 접속 → **[시스템 초기 설정]** → 경영지원본부 관리자 등록
2. 관리자 로그인 → **[직원 관리]**에서 급여대장 기준 전 직원 등록 (부서 선택 시 권한 자동 제안)
3. **[홈]**에서 공용 바로가기 버튼(사내 툴 URL) 등록
4. 직원들에게 주소 안내 → 각자 부서/이름 선택 후 첫 로그인 때 비밀번호 설정

## 주의
- 주민등록번호는 절대 입력하지 않는다 (시스템도 입력란을 제공하지 않음).
- 이 저장소는 공개(public) 저장소이므로 급여 숫자·직원 명단을 코드나 파일로 커밋하지 말 것.
  급여·연차 데이터는 배포 후 앱 화면에서 입력하면 Firestore(DB)에만 저장된다.
- `firebase-config.js`의 config 값은 비밀이 아니므로 커밋해도 안전하다.
