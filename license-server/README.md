# ghost-license-server

插件商店付费授权的 Cloudflare Worker 微后端。职责二：接支付平台（面包多 mbd.pub / Lemon Squeezy）的 webhook、为一次性付款签发固定期限授权并存进 KV；对外暴露 `/api/verify`，供 Ghost 客户端用购买后获得的许可证密钥激活付费插件。纯 JavaScript、零依赖、无框架。

```
Ghost 客户端 ── POST /api/verify {key, plugin} ──▶ Worker ── KV: lic:<key>
面包多 (mbd.pub) ── webhook (charge_succeeded) ──▶ Worker ──▶ KV: lic:<key>
商店(静态) ── "购买"=<a> ──▶ 面包多结账页 ──获得Key──▶ 买家在客户端启用
```

## 面包多（mbd.pub）开通与对接

1. 在面包多发布付费作品（如《茄盒 Snagbox》，ID: `1130783`），配置多版本定价（月度 19.9 / 季度 59.9 / 年度 179.9）。
2. 在 `catalog.json` 的 `pricing.tiers[].checkoutUrl` 填入对应的购买页面地址（如 `https://mbd.pub/o/bread/mbd-1130783`）。
3. **开启 Webhook 回调**：
   - 在面包多后台进入「开发者设置 / API / Webhook」；
   - 将回调 URL 设置为：`https://<worker-subdomain>.workers.dev/api/webhook`；
   - 买家使用微信支付或支付宝成功后，面包多向 Worker 发送 `charge_succeeded` 事件；
   - Worker 自动根据金额与周期计算过期时间，签发并在 KV 中存入正版 License Key（同时以订单号作为 alias 索引，买家直接输入订单号或 Key 均可成功激活）。

## 配置与环境变量

| 变量 | 类型 | 说明 |
|---|---|---|
| `DEFAULT_PLUGIN_ID` | wrangler vars | 默认插件 ID，例如 `com.ghostproxifier.snagbox` |
| `STORE_ID` | wrangler vars | 可选，数字店铺 ID（若兼顾 LS） |
| `LICENSES` | KV 绑定 | 授权记录，`wrangler.jsonc` 的 `kv_namespaces` |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | secret | 可选，LS webhook Signing secret |
| `VARIANT_MAP` | secret | 可选 JSON 映射 |
| `ALLOWED_ORIGIN` | secret | 可选，CORS 允许的客户端 origin |

本地开发把 secret 填进 `.dev.vars`（复制自 `.dev.vars.example`）；生产用 `wrangler secret put`。**秘密绝不提交。**

## 部署

```bash
cd license-server
npm i -g wrangler        # 或项目内 devDependency
wrangler kv namespace create LICENSES   # 建 KV，把返回的 id 填进 wrangler.jsonc
wrangler deploy
```

## 客户端要用到的契约（Ghost 客户端侧实现）

**激活**：客户端设置页让用户输入收到的 license key 或订单号，然后 `POST /api/verify`：

```jsonc
// 请求
{ "key": "<license key>", "plugin": "com.ghostproxifier.snagbox", "device": "<可选机器标识>" }
// 成功
{ "valid": true, "plugin": "com.ghostproxifier.snagbox", "tier": "month", "expiresAt": 1717200000000 }
// 失败（HTTP 200，看 reason）：not_found | expired | wrong_plugin | rate_limited(429) | bad_key(400)
{ "valid": false, "reason": "expired", "plugin": "...", "tier": "month" }
```

- `expiresAt` 是到期时间的 epoch 毫秒时间戳。
- 客户端把验证结果记在本机，之后在下发的 `state` 消息里带上 `entitlements`：`entitlements:[{ id, licensed:true, tier, expiresAt }]`，商店据此显示「已授权」并停售。
- 安全：license key 是买家的激活凭证，只在「客户端 ↔ Worker」之间传输，绝不经由静态商店页、绝不进 `catalog.json` 或 postMessage。
