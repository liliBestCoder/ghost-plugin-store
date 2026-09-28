// store.js -- a minimal store page speaking ghost-store/1
// (docs/plugin-sdk/spec-store-bridge.md). The reference implementation of the
// STORE side: the shell side is src/modules/ui/web/store-bridge.js.
//
// What a store page may say is one sentence: "this id". So:
//   * every message this page builds is {ch, v, type} plus AT MOST an id, a
//     url (openLink) or a height (resize) -- never a version, a URL of a
//     package, a hash or a key (spec §1). The catalog below carries a version
//     for DISPLAY; no message ever does.
//   * ONE outbound path: post(), which is postMessage(msg, SHELL_ORIGIN) to
//     window.parent -- never the wildcard target origin.
//   * Inbound: the shell's three checks mirrored -- event.origin is the shell,
//     event.source is window.parent, the envelope is ghost-store/1 v1 -- then
//     the type and its fields. A message that fails is counted (dropped()) and
//     never answered.
//   * Every string that came from outside (the catalog, the shell) reaches the
//     DOM through textContent only. No innerHTML, no framework, nothing
//     fetched but catalog.json from this page's own origin.
//
// Classic script, one global: window.ghostStorePage.
(function () {
    "use strict";

    var SHELL_ORIGIN = "http://127.0.0.1:23551";
    var CHANNEL = "ghost-store/1";
    var RESIZE_MIN = 200;
    var MAX_ID = 64, MAX_NAME = 64, MAX_DESC = 240, MAX_INSTALLED = 256;
    var RUN_STATES = ["stopped", "running", "crashed"];
    var PHASES = ["resolving", "downloading", "verifying", "extracting", "committing"];
    var STATE_CHANGING = ["install", "upgrade", "uninstall", "enable", "disable"];

    var TEXT = {
        en: {
            title: "Plugins", install: "Install", upgrade: "Upgrade", uninstall: "Uninstall", enable: "Enable",
            disable: "Disable", open: "Open", homepage: "Homepage", installed: "Installed {v}",
            state_running: "running", state_stopped: "stopped", state_crashed: "crashed", state_disabled: "disabled",
            needs_app: "Needs Ghost Proxifier {v} or later", busy: "Waiting for Ghost Proxifier…",
            phase_resolving: "Checking the catalog…", phase_downloading: "Downloading…",
            phase_verifying: "Verifying…", phase_extracting: "Unpacking…", phase_committing: "Finishing…",
            err_network: "Could not reach the download. Check the network and try again.",
            err_verify: "Ghost Proxifier refused this: it did not pass its checks.",
            err_generic: "Something went wrong.", empty: "The catalog is empty.",
            offline: "The catalog could not be loaded."
        },
        zh: {
            title: "插件商店", install: "安装", upgrade: "升级", uninstall: "卸载", enable: "启用",
            disable: "停用", open: "打开", homepage: "主页", installed: "已安装 {v}",
            state_running: "运行中", state_stopped: "已停止", state_crashed: "已崩溃", state_disabled: "已停用",
            needs_app: "需要 Ghost Proxifier {v} 或更高版本", busy: "等待 Ghost Proxifier…",
            phase_resolving: "正在核对目录…", phase_downloading: "正在下载…",
            phase_verifying: "正在校验…", phase_extracting: "正在解包…", phase_committing: "正在完成…",
            err_network: "无法下载，请检查网络后重试。",
            err_verify: "Ghost Proxifier 拒绝了这次操作：没有通过它的校验。",
            err_generic: "出了点问题。", empty: "目录是空的。",
            offline: "无法加载插件目录。"
        }
    };

    var cfg = { acceptTimeoutMs: 5000 };
    var dropped = { bad_origin: 0, bad_source: 0, bad_envelope: 0, unknown_type: 0, bad_payload: 0, unknown_op: 0 };
    var sentLog = [];
    var postOverride = null;
    var entries = [];                  // the validated catalog
    var shell = null;                  // the last state the shell sent, validated
    var params = readParams();
    var pending = {};                  // id -> {type, opId|null, timer}
    var ops = {};                      // opId -> id
    var notices = {};                  // id -> {text, error}
    var lastHeight = -1;
    var wired = false;

    // ---- small pure helpers ------------------------------------------------------

    // policy_plugin_id.h IsPluginId, as store-bridge.js mirrors it.
    function isPluginId(s) {
        if (typeof s !== "string" || s.length === 0 || s.length > MAX_ID) return false;
        var segs = s.split(".");
        if (segs.length < 3) return false;
        for (var i = 0; i < segs.length; i++) {
            var g = segs[i];
            if (!/^[a-z0-9-]+$/.test(g)) return false;
            if (g.charAt(0) === "-" || g.charAt(g.length - 1) === "-") return false;
        }
        return !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(segs[0]);
    }
    function isVersion(s) {
        return typeof s === "string" && /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(s);
    }
    function compareVersion(a, b) {
        var x = a.split("."), y = b.split(".");
        for (var i = 0; i < 3; i++) {
            var d = Number(x[i]) - Number(y[i]);
            if (d !== 0) return d < 0 ? -1 : 1;
        }
        return 0;
    }
    function isOpId(s) { return typeof s === "string" && /^[A-Za-z0-9-]{1,64}$/.test(s); }
    function isHttpsUrl(s) {
        if (typeof s !== "string" || s.length > 2048 || !/^https:\/\/[^\s"'<>\\`]+$/.test(s)) return false;
        try { return new URL(s).protocol === "https:"; } catch (e) { return false; }
    }
    // Control characters and bidi overrides out, then capped in code points.
    function clean(s, max) {
        if (typeof s !== "string") return "";
        var t = s.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "").trim();
        return Array.from(t).slice(0, max).join("");
    }
    function copy(o) { return JSON.parse(JSON.stringify(o)); }

    function readParams() {
        var q;
        try { q = new URLSearchParams(window.location.search); } catch (e) { q = new URLSearchParams(""); }
        return {
            app: isVersion(q.get("app")) ? q.get("app") : "",
            lang: q.get("lang") === "zh" ? "zh" : "en",
            mode: q.get("mode") === "light" ? "light" : "dark"
        };
    }

    function lang() { return shell ? shell.lang : params.lang; }
    function t(key, vars) {
        var s = (TEXT[lang()] || TEXT.en)[key] || TEXT.en[key] || key;
        Object.keys(vars || {}).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
        return s;
    }

    // ---- the messages (pure) ---------------------------------------------------------

    function env(type, extra) { return Object.assign({ ch: CHANNEL, v: 1, type: type }, extra || {}); }
    function withId(type) { return function (id) { return isPluginId(id) ? env(type, { id: id }) : null; }; }

    var build = {
        ready: function () { return env("ready"); },
        install: withId("install"),
        upgrade: withId("upgrade"),
        uninstall: withId("uninstall"),
        enable: withId("enable"),
        disable: withId("disable"),
        open: withId("open"),
        openLink: function (url) { return isHttpsUrl(url) ? env("openLink", { url: url }) : null; },
        resize: function (h) {
            return typeof h === "number" && isFinite(h) ? env("resize", { height: Math.max(RESIZE_MIN, Math.round(h)) }) : null;
        }
    };

    // ---- the ONE outbound path -------------------------------------------------------

    function post(msg) {
        if (!msg) return false;
        sentLog.push(copy(msg));
        if (postOverride) { postOverride(msg, SHELL_ORIGIN); return true; }
        try { window.parent.postMessage(msg, SHELL_ORIGIN); } catch (e) { return false; }
        return true;
    }

    // ---- inbound ------------------------------------------------------------------------

    function drop(reason) { dropped[reason] = (dropped[reason] || 0) + 1; }

    function handleMessage(event) {
        if (!event || event.origin !== SHELL_ORIGIN) return drop("bad_origin");
        if (event.source !== window.parent) return drop("bad_source");
        var m = event.data;
        if (!m || typeof m !== "object" || m.ch !== CHANNEL || m.v !== 1) return drop("bad_envelope");
        switch (m.type) {
        case "state": return onState(m);
        case "accepted": return onAccepted(m);
        case "progress": return onProgress(m);
        case "result": return onResult(m);
        default: return drop("unknown_type");   // machineId too: licences are PR ①'s
        }
    }

    // {appVersion, lang, theme, installed:[{id, version, enabled, state}]} --
    // exactly the fields spec §6 lists. Anything else the shell adds is not read.
    function onState(m) {
        if (typeof m.appVersion !== "string" || (m.appVersion !== "" && !isVersion(m.appVersion))) return drop("bad_payload");
        if (m.lang !== "zh" && m.lang !== "en") return drop("bad_payload");
        if (m.theme !== "dark" && m.theme !== "light") return drop("bad_payload");
        if (!Array.isArray(m.installed) || m.installed.length > MAX_INSTALLED) return drop("bad_payload");
        var installed = [];
        for (var i = 0; i < m.installed.length; i++) {
            var r = m.installed[i];
            if (!r || typeof r !== "object" || !isPluginId(r.id) || typeof r.version !== "string" || r.version.length > 32 ||
                typeof r.enabled !== "boolean" || RUN_STATES.indexOf(r.state) < 0) return drop("bad_payload");
            installed.push({ id: r.id, version: r.version, enabled: r.enabled, state: r.state });
        }
        shell = { appVersion: m.appVersion, lang: m.lang, theme: m.theme, installed: installed };
        applyDocument();
        render();
    }

    function onAccepted(m) {
        if (!isPluginId(m.id) || !isOpId(m.opId)) return drop("bad_payload");
        var p = pending[m.id];
        if (!p || p.opId !== null) return drop("unknown_op");
        p.opId = m.opId;
        if (p.timer) { clearTimeout(p.timer); p.timer = null; }
        ops[m.opId] = m.id;
    }

    function onProgress(m) {
        if (!isOpId(m.opId) || PHASES.indexOf(m.phase) < 0 || typeof m.pct !== "number" || !isFinite(m.pct)) {
            return drop("bad_payload");
        }
        var id = ops[m.opId];
        if (!id) return drop("unknown_op");
        var text = t("phase_" + m.phase);
        if (m.phase === "downloading" && m.pct >= 0 && m.pct <= 100) text += " " + Math.round(m.pct) + "%";
        notices[id] = { text: text, error: false };
        render();
    }

    function onResult(m) {
        if (!isOpId(m.opId) || typeof m.ok !== "boolean") return drop("bad_payload");
        if (!m.ok && typeof m.error !== "string") return drop("bad_payload");
        var id = ops[m.opId];
        if (!id) return drop("unknown_op");     // not ours: nothing is released for it
        delete ops[m.opId];
        release(id);
        if (m.ok || m.error === "user_cancelled") delete notices[id];
        else notices[id] = { text: m.error === "network_failed" ? t("err_network")
                                    : m.error === "verify_failed" ? t("err_verify") : t("err_generic"), error: true };
        render();
    }

    function release(id) {
        var p = pending[id];
        if (p && p.timer) clearTimeout(p.timer);
        delete pending[id];
    }

    // ---- actions -------------------------------------------------------------------------

    // One state change per plugin at a time. The shell answers a message it
    // takes with `accepted` at once; one it drops (no user gesture, focus not in
    // the store) it does not answer at all -- so an operation that is not
    // accepted within acceptTimeoutMs is let go, and the buttons come back.
    function act(type, id) {
        if (STATE_CHANGING.indexOf(type) >= 0) {
            if (pending[id]) return false;
            var msg = build[type](id);
            if (!msg) return false;
            pending[id] = { type: type, opId: null, timer: null };
            pending[id].timer = setTimeout(function () {
                if (pending[id] && pending[id].opId === null) { release(id); render(); }
            }, cfg.acceptTimeoutMs);
            delete notices[id];
            post(msg);
            render();
            return true;
        }
        if (type === "open") return post(build.open(id));
        return false;
    }

    // ---- the catalog ------------------------------------------------------------------------

    // {v:1, plugins:[{id, version?, minAppVersion?, name:{en, zh?}, description?:{en, zh?}, homepage?}]}.
    // A bad entry is skipped, not the whole catalog; a repeated id keeps the first.
    function loadCatalog(doc) {
        var out = [], seen = {};
        var list = doc && typeof doc === "object" && doc.v === 1 && Array.isArray(doc.plugins) ? doc.plugins : [];
        list.forEach(function (e) {
            if (!e || typeof e !== "object" || !isPluginId(e.id) || seen[e.id]) return;
            if (!e.name || typeof e.name !== "object" || !clean(e.name.en, MAX_NAME)) return;
            seen[e.id] = true;
            var d = e.description && typeof e.description === "object" ? e.description : {};
            out.push({
                id: e.id,
                version: isVersion(e.version) ? e.version : "",
                minAppVersion: isVersion(e.minAppVersion) ? e.minAppVersion : "",
                name: { en: clean(e.name.en, MAX_NAME), zh: clean(e.name.zh, MAX_NAME) },
                description: { en: clean(d.en, MAX_DESC), zh: clean(d.zh, MAX_DESC) },
                homepage: isHttpsUrl(e.homepage) ? e.homepage : ""
            });
        });
        entries = out;
        render();
        return out.length;
    }

    // What the buttons are for one entry: a pure function of the entry, the
    // installed record the shell reported (or none) and the app version.
    function actionsFor(entry, rec, appVersion) {
        if (!rec) {
            if (entry.minAppVersion && appVersion && compareVersion(appVersion, entry.minAppVersion) < 0) return [];
            return ["install"];
        }
        var a = [];
        if (entry.version && isVersion(rec.version) && compareVersion(rec.version, entry.version) < 0) a.push("upgrade");
        return a.concat(rec.enabled ? ["open", "disable", "uninstall"] : ["enable", "uninstall"]);
    }

    function state() {
        return shell ? copy(shell) : { appVersion: params.app, lang: params.lang, theme: params.mode, installed: [] };
    }

    // ---- rendering (textContent only) ---------------------------------------------------------

    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function applyDocument() {
        var s = state();
        document.documentElement.lang = s.lang === "zh" ? "zh-CN" : "en";
        document.documentElement.setAttribute("data-mode", s.theme);
        var title = $("gsTitle");
        if (title) title.textContent = t("title");
    }

    function renderEntry(e, s) {
        var rec = null;
        s.installed.forEach(function (r) { if (r.id === e.id) rec = r; });
        var li = el("li", "gs-card");
        li.setAttribute("data-plugin-id", e.id);
        var head = el("div", "gs-card-head");
        head.appendChild(el("h2", "gs-name", (s.lang === "zh" && e.name.zh) || e.name.en));
        if (e.version) head.appendChild(el("span", "gs-version", "v" + e.version));
        li.appendChild(head);
        var desc = (s.lang === "zh" && e.description.zh) || e.description.en;
        if (desc) li.appendChild(el("p", "gs-desc", desc));
        var status = rec ? t("installed", { v: rec.version }) + " · " +
                           (rec.enabled ? t("state_" + rec.state) : t("state_disabled")) : "";
        var acts = actionsFor(e, rec, s.appVersion);
        if (!rec && acts.length === 0) status = t("needs_app", { v: e.minAppVersion });
        if (status) li.appendChild(el("p", "gs-status", status));
        var busy = !!pending[e.id];
        var n = busy ? { text: t("busy"), error: false } : notices[e.id];
        if (busy && notices[e.id]) n = notices[e.id];
        if (n) li.appendChild(el("p", "gs-card-notice" + (n.error ? " is-error" : ""), n.text));
        var box = el("div", "gs-actions");
        acts.forEach(function (a, i) {
            var b = el("button", "gs-btn" + (i === 0 ? " is-primary" : ""), t(a));
            b.type = "button";
            b.setAttribute("data-action", a);
            b.setAttribute("data-plugin-id", e.id);
            b.disabled = busy;
            box.appendChild(b);
        });
        li.appendChild(box);
        if (e.homepage) {
            var link = el("a", "gs-link", t("homepage"));
            link.href = e.homepage;
            link.rel = "noopener noreferrer";
            link.setAttribute("data-link", "homepage");
            li.appendChild(link);
        }
        return li;
    }

    function render() {
        var list = $("gsCatalog");
        if (!list) return;                        // loaded into a page without the markup (a test)
        var s = state();
        while (list.firstChild) list.removeChild(list.firstChild);
        entries.forEach(function (e) { list.appendChild(renderEntry(e, s)); });
        var empty = $("gsEmpty");
        if (empty) { empty.hidden = entries.length > 0; empty.textContent = t("empty"); }
        reportHeight();
    }

    // The shell sizes the frame; tell it only when the height changed.
    function reportHeight() {
        var h = Math.ceil(document.documentElement.scrollHeight);
        if (!isFinite(h)) return;
        h = Math.max(RESIZE_MIN, h);
        if (h === lastHeight) return;
        lastHeight = h;
        post(build.resize(h));
    }

    function onClick(ev) {
        var target = ev.target;
        var link = target && target.closest ? target.closest("a[data-link]") : null;
        if (link) {
            ev.preventDefault();                  // the frame has no allow-popups: the shell opens it
            post(build.openLink(link.href));
            return;
        }
        var btn = target && target.closest ? target.closest("button[data-action]") : null;
        if (btn && !btn.disabled) act(btn.getAttribute("data-action"), btn.getAttribute("data-plugin-id"));
    }

    function showNotice(key) {
        var n = $("gsNotice");
        if (!n) return;
        n.textContent = t(key);
        n.hidden = false;
    }

    function boot() {
        if (wired) return;
        wired = true;
        window.addEventListener("message", handleMessage);
        applyDocument();
        var list = $("gsCatalog");
        if (list) list.addEventListener("click", onClick);
        post(build.ready());
        if (!list) return;                        // no page to fill
        fetch("catalog.json", { credentials: "omit", cache: "no-store" })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (doc) { if (!doc) showNotice("offline"); else loadCatalog(doc); })
            .catch(function () { showNotice("offline"); });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();

    window.ghostStorePage = {
        SHELL_ORIGIN: SHELL_ORIGIN,
        CHANNEL: CHANNEL,
        build: build,
        handleMessage: handleMessage,
        post: post,
        act: act,
        actionsFor: actionsFor,
        loadCatalog: loadCatalog,
        catalog: function () { return copy(entries); },
        state: state,
        pending: function () { return Object.keys(pending); },
        sent: function () { return copy(sentLog); },
        dropped: function () { return Object.assign({}, dropped); },
        configure: function (o) {
            if (o && typeof o.acceptTimeoutMs === "number" && o.acceptTimeoutMs >= 0) cfg.acceptTimeoutMs = o.acceptTimeoutMs;
        },
        _setPostForTest: function (fn) { postOverride = typeof fn === "function" ? fn : null; }
    };
})();
