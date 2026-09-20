/* ============================================================
 * shared.js — 쿼터다이어리 공통 (업로드·발표·보관함·관리자 4개 화면이 같이 씀)
 *
 * 하는 일
 *  - Supabase 연결을 한 번만 만든다 (예전엔 화면마다 따로 만들었음)
 *  - "지금 열린 분기"와 특정 분기 정보를 quarters 테이블에서 읽는다
 *  - 멤버 명단을 members 테이블에서 읽는다
 *  - 화면 상단 이동 바(업로드·발표·보관함·관리자)를 그린다
 *  - 모임 일정을 구글 캘린더 링크·표시 문구로 바꿔준다
 *  - 유튜브 곡이 다른 사이트 플레이어에서 재생되는지 미리 확인한다
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

  /* ---------- 유튜브 ---------- */
  // 공유 링크·주소창 링크·영상 ID 어느 것이든 11자리 영상 ID로
  function parseVid(link) {
    if (!link) return null;
    link = String(link).trim();
    if (/^[\w-]{11}$/.test(link)) return link;
    const m = link.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  function watchUrl(vid) { return "https://www.youtube.com/watch?v=" + vid; }

  let ytApi = null;
  function loadYT() {
    if (ytApi) return ytApi;
    ytApi = new Promise(resolve => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      // 발표 화면처럼 자기 onYouTubeIframeAPIReady 를 가진 페이지와 충돌하지 않게 이어 붙인다
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === "function") prev();
        resolve(window.YT);
      };
      const t = document.createElement("script");
      t.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(t);
    });
    return ytApi;
  }

  // 이 곡이 우리 사이트(퍼간 플레이어)에서 재생되는지 확인한다.
  // 유튜브는 성인 인증·퍼가기 금지 영상을 다른 사이트에서 재생하지 않고 오류 150/101 을 준다.
  // 결과: 'ok' | 'blocked'(성인 인증·퍼가기 금지) | 'missing'(비공개·삭제) | 'invalid'(잘못된 ID) | 'unknown'
  const playCache = {};
  function checkPlayable(vid) {
    if (!vid) return Promise.resolve("invalid");
    if (playCache[vid]) return playCache[vid];
    playCache[vid] = loadYT().then(YT => new Promise(resolve => {
      const host = document.createElement("div");
      host.id = "qdyt_" + vid + "_" + Math.random().toString(36).slice(2, 7);
      host.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;";
      document.body.appendChild(host);
      let player = null, done = false;
      const finish = result => {
        if (done) return; done = true; clearTimeout(limit);
        try { player && player.destroy(); } catch (_) {}
        const el = document.getElementById(host.id); if (el) el.remove();
        resolve(result);
      };
      // 오류 없이 이만큼 지나면 재생 가능한 것으로 본다 (막힌 곡은 1~2초 안에 오류가 온다)
      const limit = setTimeout(() => finish("ok"), 7000);
      player = new YT.Player(host.id, {
        height: "1", width: "1", videoId: vid,
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, controls: 0 },
        events: {
          onReady: () => setTimeout(() => finish("ok"), 3500),
          onStateChange: e => { if (e.data === 1) finish("ok"); },
          onError: e => finish(e.data === 2 ? "invalid" : e.data === 100 ? "missing"
                              : (e.data === 101 || e.data === 150) ? "blocked" : "unknown"),
        },
      });
    }));
    return playCache[vid];
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
      btn.setAttribute("aria-label", "메뉴");   // 아이콘(선 세 줄)은 CSS 로 그린다
      btn.onclick = () => bar.classList.toggle("is-open");
      bar.append(btn, links);
      document.body.prepend(bar);
    } else {
      bar.append(links);
      document.body.prepend(bar);
      // 고정 바가 페이지 첫 줄을 가리지 않도록 그 높이만큼 본문을 내린다.
      // (본문이 flex 레이아웃이라 자리를 차지하는 요소를 끼워 넣을 수 없다)
      const cur = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
      document.body.style.paddingTop = (cur + bar.offsetHeight) + "px";
    }

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
  display:flex;align-items:center;justify-content:flex-end;gap:16px;
  padding:calc(10px + env(safe-area-inset-top)) 18px 10px;
  background:rgba(12,14,16,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  border-bottom:1px solid #2a2e31;font-family:'NanumSquareNeo','Helvetica Neue',-apple-system,'Apple SD Gothic Neo',sans-serif;}
.qd-nav__links{display:flex;gap:4px;}
.qd-nav__links a{font-size:12.5px;font-weight:700;color:#9a938a;text-decoration:none;
  padding:6px 10px;border-radius:3px;letter-spacing:.02em;}
.qd-nav__links a:hover{color:#ece8e0;background:rgba(255,255,255,.04);}
.qd-nav__links a.is-active{color:#8fc9bc;box-shadow:inset 0 -2px 0 #8fc9bc;border-radius:0;}
/* 발표 화면용: 왼쪽 위 작은 버튼, 누르면 링크 펼침 */
.qd-nav--compact{left:12px;right:auto;top:12px;padding:0;background:none;border:0;backdrop-filter:none;
  -webkit-backdrop-filter:none;display:block;}
/* 메뉴 버튼: 동그라미 없이 선 세 줄만. 누르는 영역은 34px 그대로. 밝은 사진 위에서도 보이게 옅은 그림자 */
.qd-nav__toggle{position:relative;width:34px;height:34px;padding:0;border:0;background:none;cursor:pointer;opacity:.6;
  filter:drop-shadow(0 1px 2px rgba(0,0,0,.65));}
.qd-nav__toggle::before{content:"";position:absolute;left:10px;right:10px;top:50%;height:1.6px;margin-top:-.8px;border-radius:1px;
  background:#8fc9bc;box-shadow:0 -5px 0 #8fc9bc,0 5px 0 #8fc9bc;}   /* 예전 ≡ 글자와 비슷한 크기(폭 14px) */
.qd-nav__toggle:hover{opacity:1;}
.qd-nav__toggle:focus-visible{outline:2px solid #8fc9bc;outline-offset:2px;border-radius:6px;}
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
    parseVid, watchUrl, checkPlayable,
    dateLabel, timeLabel, calendarLink,
    nav,
  };
})();
