# ghost-license-server

插件商店付费授权的 Cloudflare Worker 微后端。职责二：接 Lemon Squeezy 的 webhook、为一次性付款签发固定期限授权并存进 KV；对外暴露 `/api/verify`，供 Ghost 客户端用买的许可证密钥激活付费插件。纯 JavaScript、零依赖、无框架。

```
Ghost 客户端 ── POST /api/verify {key, plugin} ──▶ Worker ── KV: lic:<key>
Lemon Squeezy ── webhook (order_created) ──▶  Worker ──▶ KV: lic:<key>
商店(静态) ── "购买"=<a> ──▶ LS 结账页 ──邮件──▶ 买家手里的 license key
```

## Lemon Squeezy 开通（做完才能端到端联调）

1. 注册并**激活店铺**（LS 要求先完成店铺激活/结算设置）。
2. 每个付费插件在 LS 后台建一个 **Product**（商品）。
3. 每个 Product 建 **3 个 Variant**（档位），交付方式选 **License keys**（这样 LS 会把 key 邮件给买家，并出现在 webhook 里）。变体命名用约定 `GHOST:<plugin-id>:month|year|perpetual`（这样 `VARIANT_MAP` 为空也能解析）；价格与 `catalog.json` 的 `pricing.tiers` 对应。
4. 把每个 variant 的 **hosted checkout URL**（`https://store.lemonsqueezy.com/checkout/buy/<id>`）填进对应插件 `catalog.json` 的 `pricing.tiers[].checkoutUrl`。
5. **开启 Webhooks**，指向 `https://<worker-subdomain>.workers.dev/api/webhook`，至少订阅 `order_created`（建议再加 `refunded`）。记下页面上给的 **Signing secret**。
6. 记下你的数字 **Store ID**（店铺 URL 里能看到）。

## 配置与环境变量

| 变量 | 类型 | 说明 |
|---|---|---|
| `STORE_ID` | wrangler vars | 数字店铺 ID，`wrangler.jsonc` 里 `vars.STORE_ID` |
| `LICENSES` | KV 绑定 | 授权记录，`wrangler.jsonc` 的 `kv_namespaces` |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | secret | webhook Signing secret，`wrangler secret put` |
| `VARIANT_MAP` | secret | 可选 JSON：`{"<variant_id 或 name>":{"plugin":"com.example.paid","tier":"month"}}`，为空时靠 `GHOST:` 命名约定兜底 |
| `ALLOWED_ORIGIN` | secret | 可选，CORS 允许的客户端 origin |

本地开发把 secret 填进 `.dev.vars`（复制自 `.dev.vars.example`）；生产用 `wrangler secret put`。**秘密绝不提交。**

## 部署

```bash
cd license-server
npm i -g wrangler        # 或项目内 devDependency
wrangler kv namespace create LICENSES   # 建 KV，把返回的 id 填进 wrangler.jsonc
wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET
wrangler secret put VARIANT_MAP        # 可选，可跳过
wrangler secret put ALLOWED_ORIGIN     # 可选
wrangler deploy
```

## 客户端要用到的契约（Ghost 客户端侧实现）

**激活**：客户端设置页让用户输入收到的 license key，然后 `POST /api/verify`：

```jsonc
// 请求
{ "key": "<license key>", "plugin": "com.example.paid", "device": "<可选机器标识>" }
// 成功
{ "valid": true, "plugin": "com.example.paid", "tier": "month", "expiresAt": 1717200000000 }
// 失败（HTTP 200，看 reason）：not_found | expired | wrong_plugin | rate_limited(429) | bad_key(400)
{ "valid": false, "reason": "expired", "plugin": "...", "tier": "month" }
```

- `expiresAt` 是 epoch 毫秒，**`null` 表示永久买断**。
- 客户端把验证结果记在本机，之后在下发的 `state` 消息里带上 `entitlements`（见商店侧 README / store.js 契约）：`entitlements:[{ id, licensed:true, tier, expiresAt }]`，商店据此显示「已授权」并停售。
- 安全：license key 是买家的激活凭证，只在「客户端 ↔ Worker」之间传输，绝不经由静态商店页、绝不进 `catalog.json` 或 postMessage。

## 现状与限制

代码骨架已完成并（用 mock KV + 真实 HTTP 请求）通过单测：webhook 验签、order_created 落库、verify 的 valid / not_found / expired。**端到端（真实结账 → LS webhook → 客户端激活）需要等 LS 账号开通并部署后才能联调。**
