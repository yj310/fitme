// Sample data and helpers shared by the feedback board mockups. Nothing here talks to a server.

const STATUS = {
  new: { label: "접수", cls: "st-new" },
  doing: { label: "해결 중", cls: "st-doing" },
  done: { label: "해결됨", cls: "st-done" },
  hold: { label: "보류", cls: "st-hold" },
};
const TYPE = {
  bug: { label: "버그", cls: "type-bug", icon: "🐞" },
  idea: { label: "개선 제안", cls: "type-idea", icon: "💡" },
  etc: { label: "기타", cls: "type-etc", icon: "💬" },
};

const POSTS = [
  { id: 12, type: "bug", status: "new", title: "모바일에서 하단 '다음' 버튼이 키보드에 가려져요", body: "키 입력할 때 키보드가 올라오면 다음 버튼이 안 보여서 키보드를 내려야 해요. 아이폰 사파리예요.", author: "지민", date: "11.18", page: "온보딩 · 키와 치수", shots: ["form", "phone"], votes: 3, comments: 0, device: "iPhone · Safari" },
  { id: 11, type: "bug", status: "new", title: "운동화가 가끔 '샌들'로 태그돼요", body: "흰 운동화 사진 두 장 올렸는데 하나는 샌들로 나왔어요.", author: "하준", date: "11.17", page: "옷장 · 옷 등록", shots: ["closet"], votes: 1, comments: 1, device: "Chrome · Mac" },
  { id: 10, type: "idea", status: "new", title: "저장한 코디를 날짜별로 보고 싶어요", body: "언제 입었는지 달력처럼 보면 좋겠어요.", author: "서연", date: "11.17", page: "저장한 코디", shots: [], votes: 5, comments: 2, device: "Chrome · Windows" },
  { id: 9, type: "bug", status: "doing", title: "옷 사진 올릴 때 배경 색까지 옷 색으로 잡혀요", body: "베이지 벽 앞에서 찍은 흰 셔츠가 베이지로 태그됐어요.", author: "도윤", date: "11.16", page: "옷장 · 옷 등록", shots: ["closet", "tag"], votes: 4, comments: 3, device: "Galaxy · Chrome", reply: "배경을 빼고 옷만 보도록 태깅 프롬프트를 고치고 있어요." },
  { id: 8, type: "idea", status: "doing", title: "코디 추천 3개가 너무 비슷해요", body: "1, 2번이 바지만 다르고 거의 같아요.", author: "지민", date: "11.15", page: "대화", shots: ["chat"], votes: 6, comments: 2, device: "Chrome · Mac", reply: "겹치는 옷이 많으면 점수를 깎는 규칙을 넣는 중이에요." },
  { id: 7, type: "bug", status: "done", title: "'다른 추구미 고르기' 누르면 2~3초 뒤 원래 화면으로 돌아가요", body: "다시 고를 수가 없어요.", author: "서연", date: "11.14", page: "온보딩 · 추구미", shots: ["form"], votes: 2, comments: 1, device: "Chrome · Windows", reply: "11.14에 고쳤어요. 이제 고르는 화면이 그대로 있어요.", doneAt: "11.14" },
  { id: 6, type: "idea", status: "done", title: "취향이랑 추구미가 왜 나뉘어 있는지 모르겠어요", body: "비슷한 걸 두 번 묻는 느낌이에요.", author: "하준", date: "11.13", page: "온보딩", shots: ["form", "style"], votes: 7, comments: 4, device: "Chrome · Mac", reply: "추구미 하나로 합쳤어요. 온보딩이 3단계로 줄었어요.", doneAt: "11.15" },
  { id: 5, type: "bug", status: "done", title: "카카오 로그인 후 흰 화면에서 멈춰요", body: "새로고침하면 들어가져요.", author: "도윤", date: "11.12", page: "로그인", shots: ["phone"], votes: 3, comments: 1, device: "iPhone · Safari", reply: "로그인 시간 오차를 허용하도록 고쳤어요.", doneAt: "11.14" },
  { id: 4, type: "etc", status: "hold", title: "다크 모드에서 옷 사진 배경이 너무 밝아요", body: "", author: "지민", date: "11.10", page: "옷장", shots: ["closet"], votes: 1, comments: 0, device: "Chrome · Mac", reply: "사진 배경 제거가 들어가면 같이 볼게요." },
];

/** A fake app screenshot (SVG) so the mockups have images without real files. */
function shotSVG(kind) {
  const c = { form: "#2c4a8c", phone: "#2f7a52", closet: "#a5620f", tag: "#b3261e", chat: "#6a4c9c", style: "#2c4a8c" }[kind] || "#5b6273";
  const tiles = kind === "closet" || kind === "style"
    ? [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${8 + (i % 3) * 28}" y="${24 + Math.floor(i / 3) * 32}" width="24" height="28" rx="3" fill="${c}" opacity="${0.18 + (i % 3) * 0.12}"/>`).join("")
    : kind === "chat"
      ? `<rect x="40" y="24" width="52" height="12" rx="6" fill="${c}" opacity=".85"/><rect x="8" y="42" width="60" height="22" rx="6" fill="#dcdfe6"/><rect x="8" y="70" width="26" height="22" rx="3" fill="${c}" opacity=".3"/><rect x="38" y="70" width="26" height="22" rx="3" fill="${c}" opacity=".45"/><rect x="68" y="70" width="26" height="22" rx="3" fill="${c}" opacity=".6"/>`
      : `<rect x="8" y="24" width="84" height="8" rx="3" fill="#a9afbd"/><rect x="8" y="38" width="40" height="34" rx="4" fill="${c}" opacity=".25"/><rect x="52" y="38" width="40" height="34" rx="4" fill="${c}" opacity=".45"/><rect x="8" y="78" width="84" height="8" rx="3" fill="#dcdfe6"/>`;
  const extra = kind === "tag" ? `<circle cx="70" cy="56" r="16" fill="none" stroke="#b3261e" stroke-width="3"/>` : kind === "phone" ? `<rect x="8" y="90" width="84" height="10" rx="3" fill="${c}"/>` : "";
  return `<svg viewBox="0 0 100 104" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="스크린샷"><rect width="100" height="104" fill="#f7f8fa"/><rect width="100" height="16" fill="#ffffff"/><rect x="6" y="5" width="22" height="6" rx="2" fill="#1a1e28"/>${tiles}${extra}</svg>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const statusChip = (s) => `<span class="st ${STATUS[s].cls}">${STATUS[s].label}</span>`;
const typeChip = (t) => `<span class="chip ${TYPE[t].cls}">${TYPE[t].icon} ${TYPE[t].label}</span>`;
const thumbsHTML = (shots, size) =>
  shots.map((k) => `<span class="thumb"${size ? ` style="width:${size}px;height:${size}px"` : ""}>${shotSVG(k)}</span>`).join("");

/** Image picker: click, drag & drop, or paste (Ctrl/⌘+V) anywhere in `scope`. Calls onChange(urls). */
function imagePicker({ drop, input, list, scope = document, max = 5 }) {
  const files = [];
  const render = () => {
    list.innerHTML = files.map((f, i) => `<span class="thumb"><img src="${f}" alt=""><button class="x" data-i="${i}" aria-label="사진 빼기">✕</button></span>`).join("");
  };
  const add = (fl) => {
    for (const f of fl) {
      if (!f.type.startsWith("image/") || files.length >= max) continue;
      files.push(URL.createObjectURL(f));
    }
    render();
  };
  list.addEventListener("click", (e) => {
    const b = e.target.closest(".x");
    if (b) { files.splice(+b.dataset.i, 1); render(); }
  });
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => { add(input.files); input.value = ""; });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); add(e.dataTransfer.files); });
  scope.addEventListener("paste", (e) => {
    const imgs = [...(e.clipboardData?.files || [])];
    if (imgs.length) { e.preventDefault(); add(imgs); toast("붙여 넣은 사진을 추가했어요"); }
  });
  return { files, clear: () => { files.length = 0; render(); } };
}

/** 사용자 화면 / 관리자 화면 switch in the mockup bar. */
function modeSwitch(onChange) {
  document.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === b));
      document.body.classList.toggle("admin", b.dataset.mode === "admin");
      onChange?.(b.dataset.mode);
    }),
  );
}

function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.append(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 1600);
}

function sidebar(active = "피드백") {
  const items = ["대화", "옷장", "오늘의 코디", "저장한 코디", "내 프로필", "피드백", "설정"];
  return `<nav class="side"><div class="logo">FITME</div>${items
    .map((n) => `<a href="#" class="${n === active ? "on" : ""}">${n}${n === "피드백" ? '<span class="new">NEW</span>' : ""}</a>`)
    .join("")}</nav>`;
}
