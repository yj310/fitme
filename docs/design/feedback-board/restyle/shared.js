// 피드백 게시판 스타일 시안 — sample data, plus the screens drawn with the SAME structure and flow as
// web/src/components/board (FeedbackButton, admin/feedback page). Each theme file only adds CSS.
// Posts 1–9 are the real feedback already on the board (authors renamed); 10–12 show open states.

const STATUS = {
  new: { label: "접수", icon: "circle-dashed" },
  doing: { label: "해결 중", icon: "circle-dot" },
  done: { label: "해결됨", icon: "circle-check" },
  hold: { label: "보류", icon: "circle-pause" },
};
const STATUS_ORDER = ["new", "doing", "done", "hold"];
const KIND = {
  bug: { label: "버그", ask: "안 돼요", icon: "bug" },
  idea: { label: "개선 제안", ask: "이러면 좋겠어요", icon: "lightbulb" },
  etc: { label: "기타", ask: "그 밖에", icon: "message-square" },
};

const IMG = { style: "img/capture-style.jpg", onboarding: "img/capture-onboarding.jpg" };

const POSTS = [
  { id: 12, kind: "bug", status: "new", author: "지민", at: "11.19 10:42", page: "온보딩 · 키와 치수", device: "iPhone · Safari",
    title: "키보드가 올라오면 다음 버튼이 가려져요",
    body: "키를 입력할 때 키보드가 올라오면 다음 버튼이 안 보여요. 키보드를 내려야 누를 수 있어요.",
    images: [IMG.onboarding], log: [] },
  { id: 11, kind: "idea", status: "doing", author: "서연", at: "11.18 21:05", page: "저장한 코디", device: "Windows · Chrome",
    title: "저장한 코디를 날짜별로 보고 싶어요",
    body: "언제 무엇을 입었는지 달력처럼 볼 수 있으면 좋겠어요.",
    images: [], log: [
      { by: "admin", at: "11.19 09:10", body: "좋은 생각이에요. 달력 보기를 만들고 있어요." },
      { by: "admin", at: "11.19 09:10", status: "doing" },
    ] },
  { id: 10, kind: "bug", status: "new", author: "도윤", at: "11.18 18:31", page: "옷장 · 옷 등록", device: "Android · Chrome",
    title: "흰 셔츠가 베이지로 태그돼요",
    body: "베이지색 벽 앞에서 찍었더니 셔츠 색이 베이지로 나왔어요.",
    images: [], log: [] },
  { id: 9, kind: "idea", status: "done", author: "하준", at: "11.14 15:34", page: "온보딩", device: null,
    title: "취향 화면과 추구미 화면이 왜 나뉘어 있는지 헷갈려요",
    body: "선호 핏 등을 고르고 다음을 누르면 추구미를 고르는 화면이 나오고, 고르고 나면 앞과 다른 추구미 화면이 또 나와요. 두 화면이 무엇이 다른지 모르겠어요.",
    images: [], log: [
      { by: "admin", at: "11.14 15:50", body: "취향과 추구미를 '추구미' 하나로 합쳤어요. 온보딩에서 고른 내용이 대표 추구미가 되고, 내 프로필에서 추구미를 더 만들 수 있어요." },
      { by: "admin", at: "11.14 15:50", status: "done" },
    ] },
  { id: 8, kind: "bug", status: "done", author: "하준", at: "11.14 15:25", page: "온보딩 · 추구미", device: null,
    title: "'다른 추구미 고르기'를 누르면 2~3초 뒤 원래 화면으로 돌아가요",
    body: "추구미를 고르는 화면이 나왔다가 금방 원래 화면으로 돌아가서 다시 고를 수가 없어요.",
    images: [IMG.onboarding], log: [
      { by: "admin", at: "11.14 15:28", body: "저장된 추구미를 다시 불러오는 동작이 고르는 화면을 덮어쓰던 문제였어요. 이제 그대로 남아요." },
      { by: "admin", at: "11.14 15:28", status: "done" },
    ] },
  { id: 7, kind: "idea", status: "done", author: "FITME 팀", at: "11.14 13:13", page: "온보딩 · 추구미", device: null,
    title: "추구미 카드도 무엇을 뜻하는지 모르겠어요",
    body: "추구미를 고르는 카드가 아직 도형 아이콘이라 어떤 스타일인지 알기 어려워요.",
    images: [IMG.style], log: [
      { by: "admin", at: "11.14 13:14", body: "추구미 카드에 성별에 맞는 룩북 사진을 넣었어요." },
      { by: "admin", at: "11.14 13:14", status: "done" },
    ] },
  { id: 6, kind: "idea", status: "done", author: "FITME 팀", at: "11.14 12:22", page: "온보딩", device: null,
    title: "성별과 신체 정보를 먼저 물어보면 좋겠어요",
    body: "성별과 키를 첫 단계에서 받고, 그에 맞는 사진을 보여 주면 좋겠어요.",
    images: [], log: [{ by: "admin", at: "11.14 12:44", body: "첫 단계에서 성별과 키를 받도록 바꿨어요." }, { by: "admin", at: "11.14 12:44", status: "done" }] },
  { id: 5, kind: "idea", status: "done", author: "FITME 팀", at: "11.14 12:08", page: "온보딩", device: null,
    title: "선택지 그림이 도형 같아서 어떤 느낌인지 모르겠어요",
    body: "파워포인트 도형으로 만든 것 같아서 실제 옷 느낌이 나지 않아요.",
    images: [], log: [{ by: "admin", at: "11.14 12:16", body: "도형 그림을 룩북 사진으로 바꿨어요." }, { by: "admin", at: "11.14 12:16", status: "done" }] },
  { id: 4, kind: "idea", status: "done", author: "지민", at: "11.14 11:49", page: "온보딩", device: null,
    title: "첫 화면에서 한꺼번에 너무 많이 물어봐요",
    body: "한 페이지에 하나씩 단계별로 물어보면 좋겠어요. 버튼도 너무 작아요.",
    images: [], log: [{ by: "admin", at: "11.14 12:02", body: "한 페이지에 하나씩 묻도록 나누고, 선택지를 큰 사진 카드로 바꿨어요." }, { by: "admin", at: "11.14 12:02", status: "done" }] },
  { id: 3, kind: "bug", status: "done", author: "서연", at: "11.14 11:37", page: "로그인", device: "Windows · Chrome",
    title: "카카오 로그인을 하면 '로그인 정보를 확인하지 못했어요'가 떠요",
    body: "다른 사람은 되는데 저는 이 화면에서 더 나아가지 못해요.",
    images: [], log: [{ by: "admin", at: "11.14 11:46", body: "이메일 제공에 동의하지 않으면 가입이 거절되던 문제였어요. 이메일 없이도 가입되게 바꿨어요." }, { by: "admin", at: "11.14 11:46", status: "done" }] },
  { id: 2, kind: "bug", status: "done", author: "FITME 팀", at: "11.14 11:32", page: "로그인", device: "Mac · Chrome",
    title: "로그인하면 '로그인하는 중이에요'에서 넘어가지 않아요",
    body: "화면이 계속 돌기만 하고 다음 화면으로 넘어가지 않아요.",
    images: [], log: [{ by: "admin", at: "11.14 11:34", body: "서버 허용 주소를 고쳤어요. 연결이 안 되면 이유와 다시 시도 버튼이 보여요." }, { by: "admin", at: "11.14 11:34", status: "done" }] },
  { id: 1, kind: "bug", status: "done", author: "FITME 팀", at: "11.07 13:30", page: "대화", device: null,
    title: "'바지 안 입어요'라고 해도 데님·조거가 계속 추천돼요",
    body: "데님을 빼 달라고 하니 이번엔 조거가 나왔어요. '바지'라는 말을 못 알아듣는 것 같아요.",
    images: [], log: [{ by: "admin", at: "11.07 13:44", body: "'바지 빼 줘'라고 하면 바지 종류가 한 번에 빠지게 고쳤어요." }, { by: "admin", at: "11.07 13:44", status: "done" }] },
];

/** The signed-in tester's own posts in the user widget. */
const MINE = [POSTS[1], POSTS[4], POSTS[0]].map((p, i) => ({ ...p, author: "나", unread: i === 0 }));

const QUICK = ["확인했어요. 고쳐 볼게요!", "고쳤어요. 새로고침한 뒤 다시 확인해 주세요.", "재현이 안 돼요. 어떤 순서로 하셨는지 알려 주실래요?"];

