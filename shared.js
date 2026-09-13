/* ============================================================
 * shared.js — 쿼터다이어리 공통 (업로드·발표·보관함·관리자 4개 화면이 같이 씀)
 *
 * 하는 일
 *  - Supabase 연결을 한 번만 만든다 (예전엔 화면마다 따로 만들었음)
 *  - "지금 열린 분기"와 특정 분기 정보를 quarters 테이블에서 읽는다
 *  - 멤버 명단을 members 테이블에서 읽는다
 *  - 화면 상단 이동 바(업로드·발표·보관함·관리자)를 그린다
 *  - 모임 일정을 구글 캘린더 링크·표시 문구로 바꿔준다
 *
 * 쓰는 법: 각 HTML 의 <head> 에서  <script src="shared.js"></script>  한 줄.
 * 그러면 window.QD 로 아래 함수들을 쓸 수 있다.
 * ============================================================ */
window.QD = (function () {
  const SUPABASE_URL = "https://bziqpggivloolhtjkbih.supabase.co";
  // publishable 키 — 브라우저에 노출돼도 되는 키. 쓰기 권한은 Supabase 쪽 규칙(RLS)이 막는다.
  const SUPABASE_ANON_KEY = "sb_publishable_Mb6cJdVNvQLiFwIVqMWD6Q_EGHmQ4pR";
  const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

  const PAGES = [
    { key: "upload",  href: "index.html",   label: "업로드" },
    { key: "wall",    href: "wall.html",    label: "발표" },
    { key: "archive", href: "archive.html", label: "보관함" },
    { key: "admin",   href: "admin.html",   label: "관리자" },
  ];

  /* ---------- Supabase 연결 (한 번만) ---------- */
  let clientPromise = null;
  function sb() {
    if (clientPromise) return clientPromise;
    clientPromise = new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) {
        return resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
      }
      const s = document.createElement("script");
      s.src = SUPABASE_CDN;
      s.onload = () => resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
      s.onerror = () => reject(new Error("supabase-js 불러오기 실패"));
      document.head.appendChild(s);
    });
    return clientPromise;
  }

  /* ---------- 분기 ---------- */
  // 주소의 ?y=2026&q=2 를 읽는다. 없으면 null.
  function quarterFromUrl() {
    const p = new URLSearchParams(location.search);
    const y = parseInt(p.get("y"), 10), q = parseInt(p.get("q"), 10);
    return (y && q) ? { year: y, quarter: q } : null;
  }

  async function currentQuarter() {
    const c = await sb();
    const { data, error } = await c.from("quarters").select("*").eq("is_current", true).maybeSingle();
    if (error) throw error;
    return data; // 없으면 null
  }

  async function getQuarter(year, quarter) {
    const c = await sb();
    const { data, error } = await c.from("quarters").select("*")
      .eq("year", year).eq("quarter", quarter).maybeSingle();
    if (error) throw error;
    return data;
  }

  // 주소에 분기가 있으면 그 분기, 없으면 지금 열린 분기.
  async function resolveQuarter() {
    const u = quarterFromUrl();
    return u ? getQuarter(u.year, u.quarter) : currentQuarter();
  }

  // 전체 분기 목록 (최신 먼저). 테스트 분기(quarter=9)는 제외.
  async function listQuarters() {
    const c = await sb();
    const { data, error } = await c.from("quarters").select("*")
      .neq("quarter", 9)
      .order("year", { ascending: false }).order("quarter", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  /* ---------- 멤버 ---------- */
  async function listMembers(opts) {
    const activeOnly = !opts || opts.activeOnly !== false;
    const c = await sb();
    let q = c.from("members").select("*").order("sort").order("name");
    if (activeOnly) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  /* ---------- 일정 문구·링크 ---------- */
  // "20:00:00" → "20:00"
  function hhmm(t) { return (t || "").slice(0, 5); }

  // 2026-07-05 → "2026. 7. 5 (일)"
  function dateLabel(q) {
    if (!q || !q.meeting_date) return "";
    const [y, m, d] = q.meeting_date.split("-").map(Number);
    const dow = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, d).getDay()];
    return `${y}. ${m}. ${d} (${dow})`;
  }

  // "오후 8:00 · 온라인(Zoom)"
  function timeLabel(q) {
    if (!q || !q.start_time) return "";
    const [h, m] = hhmm(q.start_time).split(":").map(Number);
    const ap = h < 12 ? "오전" : "오후";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${ap} ${h12}:${String(m).padStart(2, "0")}` + (q.zoom_url ? " · 온라인(Zoom)" : "");
  }

  // 구글 캘린더 "일정 저장" 링크. 줌 링크·회의 ID·암호를 일정 설명에 담는다.
  function calendarLink(q) {
    if (!q || !q.meeting_date || !q.start_time || !q.end_time) return "";
    const d = q.meeting_date.replace(/-/g, "");
    const s = d + "T" + hhmm(q.start_time).replace(":", "") + "00";
    const e = d + "T" + hhmm(q.end_time).replace(":", "") + "00";
    const details = [
      `기획자의 독서 · ${q.label} 쿼터다이어리 회고 모임`, "",
      q.zoom_url ? "Zoom 참가: " + q.zoom_url : "",
      q.zoom_id ? "회의 ID: " + q.zoom_id : "",
      q.zoom_pw ? "암호: " + q.zoom_pw : "",
    ].filter(Boolean).join("\n");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: `[기획자의 독서] ${q.label} 쿼터다이어리`,
      details, location: q.zoom_url || "Zoom",
      dates: s + "/" + e, ctz: "Asia/Seoul",
    });
    return "https://calendar.google.com/calendar/render?" + params.toString();
  }

  /* ---------- 상단 이동 바 ---------- */
  // nav("wall")  → 일반 바.  nav("wall", {compact:true}) → 발표 화면용 작은 버튼(펼치면 링크).
  // "관리자" 링크는 로그인돼 있을 때만 보인다 (관리자 화면 자체에서는 항상).
  function nav(activeKey, opts) {
    const compact = !!(opts && opts.compact);
    injectNavStyle();

    const bar = document.createElement("nav");
    bar.className = "qd-nav" + (compact ? " qd-nav--compact" : "");
    bar.setAttribute("aria-label", "화면 이동");

    const brand = document.createElement("a");
    brand.className = "qd-nav__brand";
    brand.href = "index.html";
    brand.textContent = "Quarter Diary";

    const links = document.createElement("div");
    links.className = "qd-nav__links";
    PAGES.forEach(p => {
      if (p.key === "admin" && activeKey !== "admin") return; // 로그인 확인 뒤에 붙임
      const a = document.createElement("a");
      a.href = p.href; a.textContent = p.label;
      if (p.key === activeKey) { a.className = "is-active"; a.setAttribute("aria-current", "page"); }
      links.appendChild(a);
    });

    if (compact) {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "qd-nav__toggle";
      btn.setAttribute("aria-label", "메뉴"); btn.textContent = "≡";
      btn.onclick = () => bar.classList.toggle("is-open");
      bar.append(btn, links);
    } else {
      bar.append(brand, links);
    }
    document.body.prepend(bar);

    // 로그인돼 있으면 "관리자" 링크 추가
    if (activeKey !== "admin") {
      sb().then(c => c.auth.getSession()).then(({ data }) => {
        if (!data || !data.session) return;
        const a = document.createElement("a");
        a.href = "admin.html"; a.textContent = "관리자";
        links.appendChild(a);
      }).catch(() => {});
    }
    return bar;
  }

  function injectNavStyle() {
    if (document.getElementById("qd-nav-style")) return;
    const st = document.createElement("style");
    st.id = "qd-nav-style";
    st.textContent = `
.qd-nav{position:fixed;top:0;left:0;right:0;z-index:9000;
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:calc(10px + env(safe-area-inset-top)) 18px 10px;
  background:rgba(12,14,16,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  border-bottom:1px solid #2a2e31;font-family:'NanumSquareNeo','Helvetica Neue',-apple-system,'Apple SD Gothic Neo',sans-serif;}
.qd-nav__brand{font-size:10.5px;font-weight:800;letter-spacing:.4em;text-transform:uppercase;
  color:#a49c90;text-decoration:none;white-space:nowrap;}
.qd-nav__links{display:flex;gap:4px;}
.qd-nav__links a{font-size:12.5px;font-weight:700;color:#9a938a;text-decoration:none;
  padding:6px 10px;border-radius:3px;letter-spacing:.02em;}
.qd-nav__links a:hover{color:#ece8e0;background:rgba(255,255,255,.04);}
.qd-nav__links a.is-active{color:#8fc9bc;box-shadow:inset 0 -2px 0 #8fc9bc;border-radius:0;}
/* 발표 화면용: 왼쪽 위 작은 버튼, 누르면 링크 펼침 */
.qd-nav--compact{left:12px;right:auto;top:12px;padding:0;background:none;border:0;backdrop-filter:none;
  -webkit-backdrop-filter:none;display:block;}
.qd-nav__toggle{width:34px;height:34px;border-radius:50%;border:1px solid rgba(143,201,188,.35);
  background:rgba(12,14,16,.6);color:#8fc9bc;font-size:18px;line-height:1;cursor:pointer;opacity:.55;}
.qd-nav__toggle:hover{opacity:1;}
.qd-nav--compact .qd-nav__links{display:none;flex-direction:column;gap:2px;margin-top:8px;
  background:rgba(12,14,16,.92);border:1px solid #2a2e31;border-radius:6px;padding:6px;}
.qd-nav--compact.is-open .qd-nav__links{display:flex;}
`;
    document.head.appendChild(st);
  }

  return {
    sb, PAGES,
    quarterFromUrl, currentQuarter, getQuarter, resolveQuarter, listQuarters,
    listMembers,
    dateLabel, timeLabel, calendarLink,
    nav,
  };
})();
