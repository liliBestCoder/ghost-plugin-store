# Ghost Proxifier 插件商店静态站点

这是 [Ghost Proxifier](https://ghostproxifier.com) 插件商店的公开静态站点仓库，部署为 `https://store.ghostproxifier.com/`。它由主仓库（私有）的 `examples/store-static/` 同步而来，是插件中心商店页（`ghost-store/1`）的**参考实现**——没有框架、没有图片、没有账号、没有购买。

`v1/` 是当前部署到 `https://store.ghostproxifier.com/v1/` 的全部内容。文中提到的 `docs/plugin-sdk/spec-store-bridge.md`、`src/modules/ui/web/store-bridge.js`、`.agents/AGENTS.md`、`src/tests/frontend/` 下的测试文件均指**主仓库（私有）**里的路径，本仓库不包含它们。

| 文件 | 内容 |
|---|---|
| `v1/index.html` | 骨架。CSP 在 `<meta>` 里：`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'`。没有内联脚本、没有内联样式 |
| `v1/store.js` | 唯一的脚本，暴露 `window.ghostStorePage` |
| `v1/store.css` | 样式，只用系统字体 |
| `v1/catalog.json` | 展示用目录：`{v:1, plugins:[{id, version?, minAppVersion?, name:{en, zh?}, description?, homepage?}]}`。**只用于显示**——装什么、装哪个版本永远由 Ghost 自己验过签的注册表决定，与这份文件无关 |

## 商店页不在信任链里，所以它只说一句话

- 它发出的每条消息都是 `{ch:"ghost-store/1", v:1, type}` 加**至多**一个 `id`（`openLink` 是 `url`，`resize` 是 `height`）。**永远不带版本号**、包地址、哈希或公钥（规范 §1，见主仓库 `docs/plugin-sdk/spec-store-bridge.md`）。`catalog.json` 里的 `version` 只用来画「可升级」按钮。
- 出站只有一处：`window.parent.postMessage(msg, SHELL_ORIGIN)`，`SHELL_ORIGIN` 是固定的 `http://127.0.0.1:23551`，**绝不用 `'*'`**。
- 入站镜像壳侧（Ghost 主程序，即主仓库 `src/modules/ui/web/store-bridge.js`）的三道校验：`event.origin === SHELL_ORIGIN`、`event.source === window.parent`、信封是 `ghost-store/1` v1；再判类型与字段。不过的只计数（`dropped()`），**不回话**。
- 外来的字符串（目录、壳发来的状态）一律 `textContent`，去掉控制字符与双向控制字符。
- 一个插件同一时刻只有一个在途操作；壳对它丢弃的消息不回话，所以 5 秒内没等到 `accepted` 就把按钮还给用户。
- `result.error` 只认三个粗粒度值（`network_failed` / `verify_failed` / `user_cancelled`），各有一句固定文案，其余一律通用文案；`user_cancelled` 不显示错误。
- 不发 `activate` / `requestMachineId`：许可尚未落地。

## 托管要求（部署时必须满足）

1. **独立子域** `store.ghostproxifier.com`，不能放在 `ghostproxifier.com/store/`：侧栏广告在 `ghostproxifier.com`，同一个 origin 会让壳的第一道校验失效。
2. **HTTPS**。
3. 响应头：
   - `Content-Security-Policy: frame-ancestors http://127.0.0.1:23551`（`<meta>` 里的 CSP 设不了 `frame-ancestors`，必须是响应头；这里补的是 `frame-ancestors` 一条，不放宽 `<meta>` 已有的 `default-src`/`script-src`/`style-src`/`img-src`/`connect-src`）
   - `Referrer-Policy: no-referrer`
   - `X-Content-Type-Options: nosniff`
4. **不设 cookie、不接第三方脚本、不做任何上报**（零知识原则）。页面唯一的网络请求是同源的 `catalog.json`。
5. `catalog.json` 与注册表同步：注册表下架或吊销的插件，目录里也要撤掉（撤不撤不影响安全——壳会拒——但会让用户看到一个点了就失败的按钮）。

**GitHub Pages 设不了自定义响应头，因此本仓库不启用 Pages。** 部署走 Cloudflare Pages 或 Netlify，两者都认根目录下的 `_headers` 文件（格式相同）：

```
/v1/*
  Content-Security-Policy: frame-ancestors http://127.0.0.1:23551
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
```

## 测试

商店页与商店桥的测试套件（`ghost_fe_store_page_test` / `ghost_fe_store_contract_test`，`src/tests/frontend/suite_store_page.js` / `suite_store_contract.js`）位于主仓库，不随本站点仓库发布。

## 同步

本仓库的 `v1/` 内容应与主仓库 `examples/store-static/v1/` 保持字节一致；改动请先提交到主仓库，再原样同步过来。
