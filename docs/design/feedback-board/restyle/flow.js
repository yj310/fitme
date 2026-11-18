// The feedback board drawn with the same structure and flow as the real app today:
//  - 피드백 버튼: a tab on the right edge (mid-height) → panel with 남기기 / 내 피드백
//    남기기: kind (3) → text → "where + capture" note → pictures → 보내기 (then switches to 내 피드백)
//    내 피드백: cards with status progress; open one to see replies and 덧붙이기
//  - 피드백 관리: list (search, 5 status tabs, rows) | detail (chips, title, status 1–4, meta, body,
//    pictures, timeline, reply with quick replies + pictures). J/K and 1–4 work.
// Only class names are emitted here; every theme file styles them its own way.

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const icon = (name, cls = "") => `<i data-lucide="${name}" class="ic ${cls}"></i>`;
const day = (at) => at.split(" ")[0];
const full = (at) => { const [md, hm] = at.split(" "); const [m, d] = md.split("."); return `2026. ${+m}. ${+d}. ${hm}`; };
const TABS = [["all", "전체"], ...STATUS_ORDER.map((s) => [s, STATUS[s].label])];

const S = { view: "admin", tab: "new", sel: null, q: "", pinned: null, open: true, wtab: "write", kind: "bug", capture: true, openId: 11 };

const schip = (s) => `<span class="schip st-${s}">${icon(STATUS[s].icon, "s-ic")}<span class="sdot"></span>${STATUS[s].label}</span>`;
const kchip = (k) => `<span class="kchip">${icon(KIND[k].icon)}${KIND[k].label}</span>`;

function images(list, size) {
  if (!list.length) return "";
  return `<ul class="imgs imgs-${size}">${list.map((s) => `<li><img src="${s}" alt="첨부 사진" /></li>`).join("")}</ul>`;
}

function timeline(p, authorName) {
  if (!p.log.length) return "";
  return `<ol class="tl">${p.log.map((c) => c.status
    ? `<li class="tl-item tl-status"><span class="tl-mark"></span><span class="tl-who"><b>FITME</b> · ${c.at.split(" ")[0]}</span><span class="tl-ev">상태를 ${schip(c.status)}(으)로 바꿨어요.</span></li>`
    : `<li class="tl-item ${c.by === "admin" ? "tl-admin" : "tl-user"}"><span class="tl-mark"></span><span class="tl-who"><b>${c.by === "admin" ? "FITME" : esc(authorName)}</b> · ${c.at.split(" ")[0]}</span><div class="tl-body">${esc(c.body)}</div></li>`).join("")}</ol>`;
}

function attach(n, compact = true) {
  return `<div class="attach ${compact ? "compact" : ""}">
    <button type="button" class="drop">${icon("image-plus")}<span class="drop-main">사진 넣기</span><span class="drop-hint">끌어다 놓기 · 클릭 · ⌘/Ctrl+V</span><span class="drop-n">${n}/5</span></button>
    ${n && S.capture ? `<ul class="thumbs"><li class="thumb"><img src="${IMG.onboarding}" alt="" /><span class="thumb-label">지금 화면</span><button type="button" class="thumb-x" data-uncap aria-label="사진 빼기">${icon("x")}</button></li></ul>` : ""}
  </div>`;
}

/* ───────────── 피드백 관리 ───────────── */
function visible() {
  return POSTS.filter((p) => (S.tab === "all" || p.status === S.tab || p.id === S.pinned)
    && (!S.q || `${p.body} ${p.author} ${p.page} #${p.id}`.includes(S.q)));
}

function admin() {
  const vis = visible();
  const cur = vis.find((p) => p.id === S.sel) ?? vis[0];
  const cnt = (k) => POSTS.filter((p) => k === "all" || p.status === k).length;
  return `<div class="adm">
    <section class="list">
      <div class="lhead">
        <div class="ltitle"><h1>피드백 관리</h1><button class="btn-sub">새로고침</button></div>
        <label class="search">${icon("search")}<input id="q" placeholder="내용 · 남긴 사람 · 화면 · #번호 검색" value="${esc(S.q)}" /></label>
        <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" class="tab ${S.tab === k ? "on" : ""}" data-tab="${k}">${l}<span class="cnt">${cnt(k)}</span></button>`).join("")}</div>
      </div>
      <ul class="rows">${vis.map((p) => {
        const r = p.log.filter((c) => !c.status).length;
        return `<li><button class="row ${cur && cur.id === p.id ? "on" : ""}" data-sel="${p.id}">
          <span class="rdot st-${p.status}">${icon(STATUS[p.status].icon, "s-ic")}<span class="sdot"></span></span>
          <span class="rmain"><span class="rtitle">${esc(p.title)}</span><span class="rsub">${icon(KIND[p.kind].icon)}${KIND[p.kind].label} · ${esc(p.author)} · ${esc(p.page)}</span></span>
          <span class="rside"><span class="rdate">${day(p.at)}</span><span class="rcounts">${p.images.length ? `<span>${icon("image")}${p.images.length}</span>` : ""}${r ? `<span>${icon("message-circle")}${r}</span>` : ""}</span></span>
        </button></li>`; }).join("")}
        ${vis.length ? "" : `<li class="empty">이 상태의 피드백이 없어요.</li>`}</ul>
    </section>
    <section class="detail">${cur ? detail(cur) : `<p class="empty">왼쪽에서 피드백을 골라 주세요.</p>`}</section>
  </div>`;
}

function detail(p) {
  return `<div class="dwrap">
    <div class="dhead">
      <div><div class="chips">${kchip(p.kind)}${schip(p.status)}<span class="pid">#${p.id}</span></div><h2>${esc(p.title)}</h2></div>
      <div class="keys"><span><kbd>J</kbd>/<kbd>K</kbd> 이동</span><span><kbd>1</kbd>–<kbd>4</kbd> 상태</span></div>
    </div>
    <div class="sbtns" role="group" aria-label="상태 바꾸기">${STATUS_ORDER.map((s, i) => `<button class="sbtn st-${s} ${p.status === s ? "on" : ""}" aria-pressed="${p.status === s}" data-set="${s}"><span class="sk">${i + 1}</span>${icon(STATUS[s].icon, "s-ic")}${STATUS[s].label}</button>`).join("")}</div>
    <dl class="meta"><dt>남긴 사람</dt><dd>${esc(p.author)} <span class="muted">· ${full(p.at)}</span></dd><dt>화면</dt><dd>${esc(p.page)}</dd><dt>기기</dt><dd>${esc(p.device ?? "—")}</dd></dl>
    <p class="pbody">${esc(p.body)}</p>
    ${images(p.images, "lg")}
    ${timeline(p, p.author)}
    <div class="reply">
      <textarea placeholder="답변 남기기 — 남긴 사람의 피드백 버튼에 새 소식으로 표시돼요"></textarea>
      <div class="quick">${QUICK.map((t) => `<button type="button" class="qbtn" data-q="${esc(t)}">${esc(t.split(/[.!]/)[0])}</button>`).join("")}</div>
      ${attach(0)}
      <div class="ractions"><button class="btn-primary">답변 보내기</button></div>
    </div>
  </div>`;
}

/* ───────────── 피드백 버튼 ───────────── */
function fakeApp() {
  return `<div class="fake-app" aria-hidden="true">
    <aside class="fs"><div class="logo">FITME</div>
      <span>대화</span><span>옷장</span><span>오늘의 코디</span><span>저장한 코디</span><span class="on">내 프로필</span><span>설정</span></aside>
    <main class="fm"><h2>내 프로필</h2>
      <div class="ph" style="height:180px"></div>
      <div class="looks"><div class="ph"></div><div class="ph"></div><div class="ph"></div></div></main></div>`;
}

function write() {
  return `<div class="write">
    <div class="kinds" role="radiogroup" aria-label="종류">${Object.entries(KIND).map(([k, v]) => `<button role="radio" aria-checked="${S.kind === k}" class="kind ${S.kind === k ? "on" : ""}" data-kind="${k}"><span class="kind-ic">${icon(v.icon)}</span>${v.ask}</button>`).join("")}</div>
    <textarea class="wtext" placeholder="${S.kind === "bug" ? "무엇을 했을 때 어떻게 됐나요? 짧게 적어도 돼요" : S.kind === "idea" ? "어떻게 되면 좋을까요?" : "자유롭게 적어 주세요"}"></textarea>
    <p class="wnote">${icon("info")}<span><b>내 프로필</b> 화면에서 남겨요. 기기 정보와 지금 화면 캡처가 함께 가요. 캡처가 싫으면 사진에서 빼 주세요.</span></p>
    ${attach(S.capture ? 1 : 0)}
    <button class="btn-primary wide">보내기</button>
  </div>`;
}

function steps(s) {
  if (s === "hold") return `<p class="steps-hold">지금은 보류 중이에요. 관리자 답변을 확인해 주세요.</p>`;
  const i = ["new", "doing", "done"].indexOf(s);
  const lab = (n, l) => `<span class="step ${i === n ? "cur" : ""} ${i > n ? "past" : ""}">${l}</span>`;
  const bar = (on) => `<span class="sbar ${on ? "on" : ""}"></span>`;
  return `<div class="steps st-${s}">${lab(0, "접수")}${bar(i >= 1)}${lab(1, "해결 중")}${bar(i >= 2)}${lab(2, "해결됨")}</div>`;
}

function mine() {
  return `<ul class="mine">${MINE.map((p) => `<li class="mcard ${p.unread ? "unread" : ""} ${S.openId === p.id ? "open" : ""}">
      <button class="mhead" data-open="${p.id}"><span class="mtitle">${p.unread ? `<span class="newdot" aria-label="새 소식"></span>` : ""}${esc(p.title)}</span>${schip(p.status)}</button>
      ${steps(p.status)}
      ${S.openId === p.id ? `<div class="mdetail">
          ${p.body ? `<p class="mbody">${esc(p.body)}</p>` : ""}
          ${images(p.images, "sm")}
          <p class="mmeta">${day(p.at)} · ${esc(p.page)} · #${p.id}</p>
          ${timeline(p, "나")}
          <div class="madd"><textarea placeholder="덧붙일 내용이나 사진 (예: 다시 해 보니 또 그래요)"></textarea>${attach(0)}<button class="btn-subtle">덧붙이기</button></div>
        </div>` : `<p class="mmeta">${day(p.at)} · ${esc(p.page)}</p>`}
    </li>`).join("")}</ul>`;
}

function user() {
  const unread = MINE.some((p) => p.unread);
  return `${fakeApp()}
    <button class="edge" data-fab aria-expanded="${S.open}">${icon("message-square-text")}<span class="edge-label">피드백</span>${unread ? `<span class="edge-badge">1</span>` : ""}</button>
    ${S.open ? `<div class="panel" role="dialog" aria-label="피드백">
      <div class="ptabs"><button class="ptab ${S.wtab === "write" ? "on" : ""}" data-wtab="write">남기기</button><button class="ptab ${S.wtab === "mine" ? "on" : ""}" data-wtab="mine">내 피드백${unread ? `<span class="pdot"></span>` : ""}</button><button class="pclose" data-close aria-label="닫기">${icon("x")}</button></div>
      <div class="pbodywrap">${S.wtab === "write" ? write() : mine()}</div>
    </div>` : ""}`;
}

/* ───────────── wiring ───────────── */
const root = () => document.getElementById("root");
function render() {
  root().className = `stage view-${S.view}`;
  root().innerHTML = S.view === "user" ? user() : admin();
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.75 } });
}

function mount(current, title) {
  const files = [["1-mono.html", "1 모노"], ["2-soft.html", "2 소프트"], ["3-fitme.html", "3 FITME 톤"]];
  const bar = document.createElement("div");
  bar.className = "mock-bar";
  bar.innerHTML = `<a href="index.html"><b>피드백 게시판 스타일 시안</b></a>
    ${files.map(([f, l]) => `<a href="${f}" data-file class="${f === current ? "on" : ""}">${l}</a>`).join("")}
    <span class="sp"></span><span class="hint">흐름은 지금과 같아요 · 모양만 달라요</span>
    <div class="seg" role="group" aria-label="보기"><button data-v="admin">피드백 관리 (관리자)</button><button data-v="user">피드백 버튼 (사용자)</button></div>`;
  document.body.prepend(bar);
  const set = (v) => {
    S.view = v;
    history.replaceState(null, "", "#" + v);
    bar.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    bar.querySelectorAll("a[data-file]").forEach((a) => (a.href = a.getAttribute("href").split("#")[0] + "#" + v));
    render();
  };
  bar.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => set(b.dataset.v)));

  const el = root();
  el.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.tab) { S.tab = d.tab; S.pinned = null; }
    else if (d.sel) S.sel = +d.sel;
    else if (d.set) { const p = (POSTS.find((x) => x.id === S.sel) ?? visible()[0]); if (p.status !== d.set) { p.status = d.set; p.log.push({ by: "admin", at: "11.19 11:00", status: d.set }); S.sel = p.id; S.pinned = p.id; } }
    else if (d.q) { el.querySelector(".reply textarea").value = d.q; return; }
    else if (d.kind) S.kind = d.kind;
    else if ("uncap" in d) S.capture = false;
    else if (d.wtab) { S.wtab = d.wtab; if (d.wtab === "mine") MINE.forEach((p) => (p.unread = false)); }
    else if (d.open) S.openId = S.openId === +d.open ? null : +d.open;
    else if ("close" in d) S.open = false;
    else if ("fab" in d) S.open = !S.open;
    else return;
    render();
  });
  el.addEventListener("input", (e) => {
    if (e.target.id !== "q") return;
    S.q = e.target.value; render();
    const q = document.getElementById("q"); q.focus(); q.setSelectionRange(S.q.length, S.q.length);
  });
  document.addEventListener("keydown", (e) => {
    if (S.view !== "admin" || /INPUT|TEXTAREA/.test(e.target.tagName) || e.metaKey || e.ctrlKey) return;
    const vis = visible(); const cur = vis.find((p) => p.id === S.sel) ?? vis[0]; const i = vis.indexOf(cur);
    if (e.key === "j" && vis[i + 1]) S.sel = vis[i + 1].id;
    else if (e.key === "k" && vis[i - 1]) S.sel = vis[i - 1].id;
    else if (cur && /^[1-4]$/.test(e.key)) { const s = STATUS_ORDER[+e.key - 1]; if (cur.status !== s) { cur.status = s; cur.log.push({ by: "admin", at: "11.19 11:00", status: s }); S.sel = cur.id; S.pinned = cur.id; } }
    else return;
    render();
  });
  set(location.hash === "#user" ? "user" : "admin");
}
