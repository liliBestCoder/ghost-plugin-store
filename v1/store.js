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
//     DOM through textContent only. Artwork is restricted to local icon files;
//     catalog.json and icons are fetched from this page's own origin.
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
    var TIER_IDS = ["month", "year", "perpetual"];

    var TEXT = {
        en: {
            standalone: "Open this store in Ghost Proxifier to install plugins.",
            title: "Plugins", install: "Install", upgrade: "Upgrade", uninstall: "Uninstall", enable: "Enable",
            disable: "Disable", open: "Open", homepage: "Homepage", installed: "Installed {v}",
            state_running: "running", state_stopped: "stopped", state_crashed: "crashed", state_disabled: "disabled",
            needs_app: "Needs Ghost Proxifier {v} or later", busy: "Waiting for Ghost Proxifier…",
            phase_resolving: "Checking the catalog…", phase_downloading: "Downloading…",
            phase_verifying: "Verifying…", phase_extracting: "Unpacking…", phase_committing: "Finishing…",
            err_network: "Could not reach the download. Check the network and try again.",
            err_verify: "Ghost Proxifier refused this: it did not pass its checks.",
            err_generic: "Something went wrong.", empty: "The catalog is empty.",
            offline: "The catalog could not be loaded.",
            buy: "Buy", renew: "Renew", licensed: "Licensed", expired: "License expired",
            tier_month: "1 month", tier_year: "12 months", tier_perpetual: "Perpetual",
            buy_starting: "Buy · {price}",
            checkout_note: "You'll pay on the Lemon Squeezy checkout; after buying, open Ghost Proxifier and enter the license key emailed to you.",
            unknown_license: "License status unknown. Buy or activate in Ghost Proxifier.",
            plan_tiers_title: "Pricing tiers",
            plan_free_title: "License",
            plan_free_tag: "Free & Open",
            plan_free_desc: "Open source · No purchase required",
            plan_licensed_desc: "Commercial license active",
            tier_month_name: "1 mo",
            tier_year_name: "12 mo",
            tier_perpetual_name: "Lifetime",
            filter_all: "All",
            filter_free: "Free",
            filter_paid: "Paid",
            search_placeholder: "Search plugins...",
            btn_activate: "Activate",
            dlg_activate_title: "Activate License",
            dlg_activate_label: "Enter license key:",
            dlg_activate_placeholder: "Paste base64url license key here...",
            dlg_activate_submit: "Activate Now",
            dlg_activate_cancel: "Cancel",
            activate_empty_key: "Please enter a valid license key.",
            activate_submitting: "Verifying…",
            activate_success: "License activated successfully!",
            activate_failed: "Activation rejected by Ghost Proxifier.",
            empty_search: "No matching plugins found."
        },
        zh: {
            standalone: "请在 Ghost Proxifier 内打开商店以安装插件。",
            title: "插件商店", install: "安装", upgrade: "升级", uninstall: "卸载", enable: "启用",
            disable: "停用", open: "打开", homepage: "主页", installed: "已安装 {v}",
            state_running: "运行中", state_stopped: "已停止", state_crashed: "已崩溃", state_disabled: "已停用",
            needs_app: "需要 Ghost Proxifier {v} 或更高版本", busy: "等待 Ghost Proxifier…",
            phase_resolving: "正在核对目录…", phase_downloading: "正在下载…",
            phase_verifying: "正在校验…", phase_extracting: "正在解包…", phase_committing: "正在完成…",
            err_network: "无法下载，请检查网络后重试。",
            err_verify: "Ghost Proxifier 拒绝了这次操作：没有通过它的校验。",
            err_generic: "出了点问题。", empty: "目录是空的。",
            offline: "无法加载插件目录。",
            buy: "购买", renew: "续费", licensed: "已授权", expired: "许可已过期",
            tier_month: "1 个月", tier_year: "12 个月", tier_perpetual: "永久买断",
            buy_starting: "购买 · {price}",
            checkout_note: "付款将在 Lemon Squeezy 结账页完成；购买后请打开 Ghost Proxifier，输入邮件中的许可密钥进行激活。",
            unknown_license: "许可状态未知——请在 Ghost Proxifier 中购买或激活。",
            plan_tiers_title: "授权方案",
            plan_free_title: "使用许可",
            plan_free_tag: "开源免费",
            plan_free_desc: "无需购买 · 永久免费即装即用",
            plan_licensed_desc: "商业授权已生效",
            tier_month_name: "1 个月",
            tier_year_name: "12 个月",
            tier_perpetual_name: "永久",
            filter_all: "全部",
            filter_free: "开源免费",
            filter_paid: "商业授权",
            search_placeholder: "搜索插件...",
            btn_activate: "输入许可",
            dlg_activate_title: "激活插件许可",
            dlg_activate_label: "输入许可证密钥：",
            dlg_activate_placeholder: "在此粘贴 base64url 格式的许可密钥...",
            dlg_activate_submit: "立即激活",
            dlg_activate_cancel: "取消",
            activate_empty_key: "请输入有效的许可密钥。",
            activate_submitting: "正在验证…",
            activate_success: "许可激活成功！",
            activate_failed: "客户端拒绝了此许可（验签失败或机器不匹配）。",
            empty_search: "未找到匹配的插件。"
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
    var entitlements = {};             // id -> {licensed, tier, expiresAt} reported by the shell (optional)
    var currentFilter = "all";         // "all" | "free" | "paid"
    var searchQuery = "";
    var pendingActivation = null;      // { pluginId, opId, at }
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
    function isIconPath(s) {
        return typeof s === "string" && s.length <= 160 &&
            /^icons\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|webp)$/.test(s);
    }
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

    function parsePricing(p) {
        if (!p || typeof p !== "object") return null;
        var currency = typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency) ? p.currency : "CNY";
        if (!Array.isArray(p.tiers) || p.tiers.length < 1 || p.tiers.length > TIER_IDS.length) return null;
        var seen = {}, tiers = [];
        p.tiers.forEach(function (t) {
            if (!t || typeof t !== "object") return;
            var id = TIER_IDS.indexOf(t.id) >= 0 ? t.id : "";
            if (!id || seen[id]) return;
            var amount = typeof t.amount === "number" && isFinite(t.amount) && t.amount > 0 && t.amount <= 1e9 ? t.amount : 0;
            var price = clean(t.price, 32);
            var checkoutUrl = isHttpsUrl(t.checkoutUrl) ? t.checkoutUrl : "";
            if (!price || !checkoutUrl) return;   // a tier without a shown price or a jump target is useless
            seen[id] = true;
            tiers.push({ id: id, amount: amount, price: price, checkoutUrl: checkoutUrl });
        });
        if (tiers.length === 0) return null;
        return { currency: currency, tiers: tiers };
    }

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
        default: return drop("unknown_type");
        }
    }

    function onState(m) {
        entitlements = {};
        if (m.entitlements !== undefined) {
            if (!Array.isArray(m.entitlements)) return drop("bad_payload");
            m.entitlements.forEach(function (x) {
                if (!x || typeof x !== "object" || !isPluginId(x.id) || entitlements[x.id]) return;
                var e = {};
                if (typeof x.licensed === "boolean") e.licensed = x.licensed;
                if (TIER_IDS.indexOf(x.tier) >= 0) e.tier = x.tier;
                if (typeof x.expiresAt === "number" || x.expiresAt === null) e.expiresAt = x.expiresAt;
                entitlements[x.id] = e;
            });
        }
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
        if (!isOpId(m.opId)) return drop("bad_payload");
        if (m.id !== undefined) {
            if (!isPluginId(m.id)) return drop("bad_payload");
            var p = pending[m.id];
            if (!p || p.opId !== null) return drop("unknown_op");
            p.opId = m.opId;
            if (p.timer) { clearTimeout(p.timer); p.timer = null; }
            ops[m.opId] = m.id;
        } else if (pendingActivation) {
            pendingActivation.opId = m.opId;
        } else {
            return drop("unknown_op");
        }
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
        if (m.id !== undefined) {
            var id = ops[m.opId];
            if (!id) return drop("unknown_op");
            delete ops[m.opId];
            release(id);
            if (m.ok || m.error === "user_cancelled") delete notices[id];
            else notices[id] = { text: m.error === "network_failed" ? t("err_network")
                                        : m.error === "verify_failed" ? t("err_verify") : t("err_generic"), error: true };
            render();
        } else if (pendingActivation && (!pendingActivation.opId || pendingActivation.opId === m.opId)) {
            var isOk = m.ok;
            var errCode = m.error;
            if (isOk) {
                closeActivateModal();
                showNotice("activate_success");
            } else {
                var err = $("gsModalError");
                if (err) {
                    err.textContent = errCode === "user_cancelled" ? t("err_generic") : t("activate_failed");
                    err.hidden = false;
                }
                var sub = $("gsModalSubmit");
                if (sub) { sub.disabled = false; sub.textContent = t("dlg_activate_submit"); }
                var inp = $("gsLicenseInput");
                if (inp) inp.disabled = false;
            }
            pendingActivation = null;
        } else {
            return drop("unknown_op");
        }
    }

    function release(id) {
        var p = pending[id];
        if (p && p.timer) clearTimeout(p.timer);
        delete pending[id];
    }

    // ---- actions -------------------------------------------------------------------------

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

    function loadCatalog(doc) {
        var out = [], seen = {};
        var list = doc && typeof doc === "object" && doc.v === 1 && Array.isArray(doc.plugins) ? doc.plugins : [];
        list.forEach(function (e) {
            if (!e || typeof e !== "object" || !isPluginId(e.id) || seen[e.id]) return;
            if (!e.name || typeof e.name !== "object" || !clean(e.name.en, MAX_NAME)) return;
            seen[e.id] = true;
            var d = e.description && typeof e.description === "object" ? e.description : {};
            var paid = e.paid === true;
            var pricing = paid ? parsePricing(e.pricing) : null;
            if (paid && !pricing) return;
            out.push({
                id: e.id,
                version: isVersion(e.version) ? e.version : "",
                minAppVersion: isVersion(e.minAppVersion) ? e.minAppVersion : "",
                name: { en: clean(e.name.en, MAX_NAME), zh: clean(e.name.zh, MAX_NAME) },
                description: { en: clean(d.en, MAX_DESC), zh: clean(d.zh, MAX_DESC) },
                icon: isIconPath(e.icon) ? e.icon : "",
                homepage: isHttpsUrl(e.homepage) ? e.homepage : "",
                paid: paid,
                pricing: pricing
            });
        });
        entries = out;
        render();
        return out.length;
    }

    function actionsFor(entry, rec, appVersion) {
        if (!rec) {
            if (entry.minAppVersion && appVersion && compareVersion(appVersion, entry.minAppVersion) < 0) return [];
            return ["install"];
        }
        var a = [];
        if (entry.version && isVersion(rec.version) && compareVersion(rec.version, entry.version) < 0) a.push("upgrade");
        return a.concat(rec.enabled ? ["open", "disable", "uninstall"] : ["enable", "uninstall"]);
    }

    // ---- paid licensing -------------------------------------------------

    function isPaid(entry) { return !!(entry && entry.paid); }
    function entitlementOf(id) { return entitlements[id] || null; }
    function startingTier(entry) {
        if (!entry || !entry.pricing || !entry.pricing.tiers || entry.pricing.tiers.length === 0) return null;
        var best = entry.pricing.tiers[0];
        entry.pricing.tiers.forEach(function (t) { if (t.amount < best.amount) best = t; });
        return best;
    }
    function licenseStatus(entry, ent) {
        if (!isPaid(entry)) return "free";
        if (!ent || ent.licensed !== true) return "unowned";
        if (typeof ent.expiresAt === "number" && ent.expiresAt > 0 && Date.now() > ent.expiresAt) return "expired";
        return "valid";
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
        var notice = $("gsNotice");
        if (notice && notice.getAttribute("data-notice")) {
            notice.textContent = t(notice.getAttribute("data-notice"));
        }
        var fAll = $("filterAll");
        if (fAll) fAll.textContent = t("filter_all");
        var fFree = $("filterFree");
        if (fFree) fFree.textContent = t("filter_free");
        var fPaid = $("filterPaid");
        if (fPaid) fPaid.textContent = t("filter_paid");
        var searchInput = $("gsSearch");
        if (searchInput) searchInput.setAttribute("placeholder", t("search_placeholder"));

        var mTitle = $("gsModalTitle");
        if (mTitle) mTitle.textContent = t("dlg_activate_title");
        var mLabel = $("gsModalLabel");
        if (mLabel) mLabel.textContent = t("dlg_activate_label");
        var licInput = $("gsLicenseInput");
        if (licInput) licInput.setAttribute("placeholder", t("dlg_activate_placeholder"));
        var mCancel = $("gsModalCancel");
        if (mCancel) mCancel.textContent = t("dlg_activate_cancel");
        var mSubmit = $("gsModalSubmit");
        if (mSubmit && !mSubmit.disabled) mSubmit.textContent = t("dlg_activate_submit");
    }

    function filteredEntries() {
        var q = searchQuery.toLowerCase().trim();
        var s = state();
        return entries.filter(function (e) {
            if (currentFilter === "free" && e.paid) return false;
            if (currentFilter === "paid" && !e.paid) return false;
            if (q) {
                var name = ((s.lang === "zh" && e.name.zh) || e.name.en || "").toLowerCase();
                var desc = ((s.lang === "zh" && e.description.zh) || e.description.en || "").toLowerCase();
                var id = (e.id || "").toLowerCase();
                if (name.indexOf(q) < 0 && desc.indexOf(q) < 0 && id.indexOf(q) < 0) return false;
            }
            return true;
        });
    }

    function renderEntry(e, s) {
        var rec = null;
        s.installed.forEach(function (r) { if (r.id === e.id) rec = r; });
        var li = el("li", "gs-card");
        li.setAttribute("data-plugin-id", e.id);
        var head = el("div", "gs-card-head");
        var icon = el("img", "gs-icon");
        icon.alt = "";
        icon.width = 36;
        icon.height = 36;
        icon.decoding = "async";
        icon.addEventListener("error", function () {
            icon.src = "icons/plugin-default.svg";
        }, { once: true });
        icon.src = e.icon || "icons/plugin-default.svg";
        head.appendChild(icon);
        if (e.version) head.appendChild(el("span", "gs-version", "v" + e.version));
        li.appendChild(head);
        li.appendChild(el("h2", "gs-name", (s.lang === "zh" && e.name.zh) || e.name.en));
        var desc = (s.lang === "zh" && e.description.zh) || e.description.en;
        if (desc) {
            var description = el("p", "gs-desc", desc);
            description.title = desc;
            li.appendChild(description);
        }
        var ent = entitlements[e.id] || null;
        var lv = licenseStatus(e, ent);
        var locked = e.paid && lv !== "valid";
        var status = rec ? t("installed", { v: rec.version }) + " · " +
                           (rec.enabled ? t("state_" + rec.state) : t("state_disabled")) : "";
        var acts = !locked ? actionsFor(e, rec, s.appVersion) : [];
        if (!rec && acts.length === 0 && !locked) status = t("needs_app", { v: e.minAppVersion });
        var badge = "";
        if (e.paid) {
            if (lv === "valid") badge = t("licensed");
            else if (lv === "expired") badge = t("expired");
        }
        if (badge) status = status ? status + " · " + badge : badge;
        if (status) li.appendChild(el("p", lv === "expired" ? "gs-status is-expired" : "gs-status", status));
        var busy = !!pending[e.id];
        var n = busy ? { text: t("busy"), error: false } : notices[e.id];
        if (busy && notices[e.id]) n = notices[e.id];
        if (n) li.appendChild(el("p", "gs-card-notice" + (n.error ? " is-error" : ""), n.text));

        // Uniform Plan/Pricing slot for all cards (keeps every card equal height)
        var plan = el("div", "gs-plan" + (locked ? " is-paid" : " is-free"));
        var planHead = el("div", "gs-plan-head");
        if (locked && e.pricing && e.pricing.tiers) {
            var cheap = startingTier(e);
            planHead.appendChild(el("span", "gs-plan-title", t("plan_tiers_title")));
            if (cheap) planHead.appendChild(el("span", "gs-plan-hint", t("buy_starting", { price: cheap.price })));
            plan.appendChild(planHead);
            var tiers = el("div", "gs-plan-tiers");
            e.pricing.tiers.forEach(function (tier) {
                var a = el("a", "gs-buy-tier", "");
                a.href = tier.checkoutUrl;
                a.rel = "noopener noreferrer";
                a.target = "_blank";
                a.setAttribute("data-link", "buy");
                a.setAttribute("data-plugin-id", e.id);
                a.title = t("tier_" + tier.id) + " · " + tier.price + "\n" + t("checkout_note");
                var tName = el("span", "gs-tier-name", t("tier_" + tier.id + "_name") || t("tier_" + tier.id));
                var tPrice = el("span", "gs-tier-price", tier.price);
                a.appendChild(tName);
                a.appendChild(tPrice);
                tiers.appendChild(a);
            });
            plan.appendChild(tiers);
        } else {
            planHead.appendChild(el("span", "gs-plan-title", t("plan_free_title")));
            planHead.appendChild(el("span", "gs-plan-badge", t(e.paid ? "licensed" : "plan_free_tag")));
            plan.appendChild(planHead);
            var freeInfo = el("div", "gs-plan-free-info");
            var freeIcon = el("span", "gs-plan-icon", "✓");
            var freeText = el("span", "gs-plan-text", t(e.paid ? "plan_licensed_desc" : "plan_free_desc"));
            freeInfo.appendChild(freeIcon);
            freeInfo.appendChild(freeText);
            plan.appendChild(freeInfo);
        }
        li.appendChild(plan);

        var box = el("div", "gs-actions");
        if (locked) {
            var startP = startingTier(e);
            var buyLabel = lv === "expired" ? t("renew")
                         : (startP ? t("buy_starting", { price: startP.price }) : t("buy"));
            var buy = el("a", "gs-btn is-primary gs-buy", buyLabel);
            buy.href = (startP && startP.checkoutUrl) || "#";
            buy.rel = "noopener noreferrer";
            buy.target = "_blank";
            buy.setAttribute("data-link", "buy");
            buy.setAttribute("data-plugin-id", e.id);
            box.appendChild(buy);

            var actBtn = el("button", "gs-btn gs-btn-activate", t("btn_activate"));
            actBtn.type = "button";
            actBtn.setAttribute("data-action", "activate");
            actBtn.setAttribute("data-plugin-id", e.id);
            box.appendChild(actBtn);
        } else {
            acts.forEach(function (a, i) {
                var b = el("button", "gs-btn" + (i === 0 ? " is-primary" : ""), t(a));
                b.type = "button";
                b.setAttribute("data-action", a);
                b.setAttribute("data-plugin-id", e.id);
                b.disabled = busy;
                box.appendChild(b);
            });
        }
        var footer = el("div", "gs-card-footer");
        footer.appendChild(box);
        if (e.homepage) {
            var link = el("a", "gs-link", t("homepage"));
            link.href = e.homepage;
            link.rel = "noopener noreferrer";
            link.target = "_blank";
            link.setAttribute("data-link", "homepage");
            footer.appendChild(link);
        }
        li.appendChild(footer);
        return li;
    }

    function render() {
        var list = $("gsCatalog");
        if (!list) return;
        var s = state();
        while (list.firstChild) list.removeChild(list.firstChild);
        var visible = filteredEntries();
        visible.forEach(function (e) { list.appendChild(renderEntry(e, s)); });
        var count = $("gsCount");
        if (count) {
            count.textContent = visible.length === entries.length
                ? String(entries.length).padStart(2, "0")
                : visible.length + " / " + entries.length;
        }
        var empty = $("gsEmpty");
        if (empty) {
            empty.hidden = visible.length > 0;
            empty.textContent = entries.length === 0 ? t("empty") : t("empty_search");
        }
        reportHeight();
    }

    function reportHeight() {
        var h = Math.ceil(document.documentElement.scrollHeight);
        if (!isFinite(h)) return;
        h = Math.max(RESIZE_MIN, h);
        if (h === lastHeight) return;
        lastHeight = h;
        post(build.resize(h));
    }

    function openActivateModal(pluginId) {
        var modal = $("gsActivateModal");
        if (!modal) return;
        var s = state();
        var e = null;
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].id === pluginId) { e = entries[i]; break; }
        }
        var pluginName = e ? ((s.lang === "zh" && e.name.zh) || e.name.en) : pluginId;
        var target = $("gsModalTargetPlugin");
        if (target) target.textContent = pluginName;
        var input = $("gsLicenseInput");
        if (input) { input.value = ""; input.disabled = false; }
        var err = $("gsModalError");
        if (err) { err.hidden = true; err.textContent = ""; }
        var submitBtn = $("gsModalSubmit");
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = t("dlg_activate_submit");
        }
        modal.setAttribute("data-plugin-id", pluginId);
        modal.hidden = false;
        if (input) setTimeout(function () { input.focus(); }, 50);
    }

    function closeActivateModal() {
        var modal = $("gsActivateModal");
        if (modal) modal.hidden = true;
        pendingActivation = null;
    }

    function submitActivation() {
        var modal = $("gsActivateModal");
        var input = $("gsLicenseInput");
        var err = $("gsModalError");
        var submitBtn = $("gsModalSubmit");
        if (!modal || !input) return;
        var key = (input.value || "").trim();
        if (!key || key.length < 10 || key.length > 16384) {
            if (err) { err.textContent = t("activate_empty_key"); err.hidden = false; }
            return;
        }
        if (err) err.hidden = true;
        var pluginId = modal.getAttribute("data-plugin-id") || "";
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = t("activate_submitting");
        }
        input.disabled = true;
        pendingActivation = { pluginId: pluginId, opId: null, at: Date.now() };
        post(env("activate", { license: key }));
    }

    function onClick(ev) {
        var target = ev.target;
        var link = target && target.closest ? target.closest("a[data-link]") : null;
        if (link) {
            if (window.parent === window) return;
            ev.preventDefault();
            post(build.openLink(link.href));
            return;
        }
        var btn = target && target.closest ? target.closest("button[data-action]") : null;
        if (btn && !btn.disabled) {
            var action = btn.getAttribute("data-action");
            var pluginId = btn.getAttribute("data-plugin-id");
            if (action === "activate") {
                openActivateModal(pluginId);
                return;
            }
            if (window.parent === window && !shell) { showNotice("standalone"); return; }
            act(action, pluginId);
        }
    }

    function showNotice(key) {
        var n = $("gsNotice");
        if (!n) return;
        n.textContent = t(key);
        n.setAttribute("data-notice", key);
        n.hidden = false;
    }

    function onFilterClick(ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest(".gs-filter-btn") : null;
        if (!btn) return;
        var f = btn.getAttribute("data-filter");
        if (f !== "all" && f !== "free" && f !== "paid") return;
        currentFilter = f;
        var btns = $("gsFilters") ? $("gsFilters").querySelectorAll(".gs-filter-btn") : [];
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle("is-active", btns[i].getAttribute("data-filter") === f);
        }
        render();
    }

    function onSearchInput(ev) {
        searchQuery = ev.target.value || "";
        var clearBtn = $("gsSearchClear");
        if (clearBtn) clearBtn.hidden = !searchQuery;
        render();
    }

    function onSearchClear() {
        var searchInput = $("gsSearch");
        if (searchInput) searchInput.value = "";
        searchQuery = "";
        var clearBtn = $("gsSearchClear");
        if (clearBtn) clearBtn.hidden = true;
        render();
        if (searchInput) searchInput.focus();
    }

    function boot() {
        if (wired) return;
        wired = true;
        window.addEventListener("message", handleMessage);
        window.addEventListener("resize", reportHeight);
        applyDocument();
        var list = $("gsCatalog");
        if (list) list.addEventListener("click", onClick);

        var filters = $("gsFilters");
        if (filters) filters.addEventListener("click", onFilterClick);
        var searchInput = $("gsSearch");
        if (searchInput) searchInput.addEventListener("input", onSearchInput);
        var searchClear = $("gsSearchClear");
        if (searchClear) searchClear.addEventListener("click", onSearchClear);

        var modalClose = $("gsModalClose");
        if (modalClose) modalClose.addEventListener("click", closeActivateModal);
        var modalCancel = $("gsModalCancel");
        if (modalCancel) modalCancel.addEventListener("click", closeActivateModal);
        var modalSubmit = $("gsModalSubmit");
        if (modalSubmit) modalSubmit.addEventListener("click", submitActivation);
        var modalBackdrop = $("gsActivateModal");
        if (modalBackdrop) {
            modalBackdrop.addEventListener("click", function (e) {
                if (e.target === modalBackdrop) closeActivateModal();
            });
        }
        window.addEventListener("keydown", function (e) {
            if (e.key === "Escape") closeActivateModal();
        });

        post(build.ready());
        if (!list) return;
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
        licenseStatus: licenseStatus,
        isPaid: isPaid,
        startingTier: startingTier,
        entitlementOf: entitlementOf,
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
