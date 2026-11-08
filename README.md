# Order Tracking Application

面向澳大利亚订单履约场景的全栈订单管理系统，涵盖订单、SKU 商品、AUD/GST 金额、Shipment、运费报价和物流追踪。


## Contents

- [项目概览](#overview)
- [Quick Start / 快速启动](#quick-start)
- [功能范围与实现状态](#features-and-status)
- [技术栈与项目结构](#technology-and-structure)
- [输入数据、数据结构与 SKU 匹配](#input-data-and-sku-matching)
- [商品图片说明](#product-image-note)
- [金额计算规则](#money-and-gst)
- [Shipment 运费设计](#shipment-fee-design)
- [物流追踪与承运商接口](#tracking-and-carrier-integrations)
- [实现难点与设计取舍](#engineering-decisions)
- [环境变量配置](#configuration)
- [API 概览](#api-reference)
- [测试与构建](#testing)
- [日志与故障排查](#logging-and-troubleshooting)
- [安全说明与当前限制](#security-and-limitations)
- [许可证](#license)

<a id="overview"></a>
## 项目概览

系统将订单作为履约和金额汇总的边界。每笔订单包含客户收货信息、SKU 订单行和零个或多个 Shipment；订单总额由订单行金额及 Shipment 运费组成。核心订单和商品功能在没有承运商凭据时仍可本地运行。

订单页面支持桌面、平板和窄屏布局。用户可以维护商品与承运商、管理订单状态和 Shipment、查看报价及追踪事件，并通过 Request ID 将浏览器请求与后端日志关联起来。

<a id="quick-start"></a>
## Quick Start / 快速启动

### 环境要求

- Python 3.10 或更高版本
- Node.js 18 或更高版本及 npm
- 承运商凭据不是启动核心 OMS 功能的前提；真实 Australia Post 请求需要有效的服务端账号和凭据

### 1. 启动后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8003
```

### 2. 启动前端

在另一个终端中运行：

```bash
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5176
```

### 3. 打开应用

- Web 应用：<http://127.0.0.1:5176/>
- API 健康检查：<http://127.0.0.1:8003/api/health>
- FastAPI / OpenAPI 文档：<http://127.0.0.1:8003/docs>

首次启动会创建数据库表，并将 `data/products.json` 和 `data/orders.json` 中尚未存在的记录导入 SQLite。默认数据库为 `data/oms.db`。种子导入是幂等的，不会用 JSON 样例覆盖已有数据库记录。

若只运行核心 OMS 页面，不需要创建 `.env`。配置承运商 API 前，可将仓库根目录的 `.env.example` 复制为 `.env`，并只在服务端填写获授权的账号和凭据。

<a id="features-and-status"></a>
## 功能范围与实现状态

| 功能 | 当前状态 | 说明 |
| --- | --- | --- |
| 订单管理 | 已实现 | 搜索、筛选、创建、编辑草稿和状态流转 |
| SKU 商品目录 | 已实现 | 搜索、添加、编辑；被历史订单引用的商品不能删除 |
| Shipment 管理 | 已实现，部分拆分未支持 | 分配订单行、保存运单号、记录报价费用和追踪结果；一条订单行目前只能完整分配给一个 Shipment，不能将数量拆到多个 Shipment |
| Shipment 运费报价 | 已实现，需有效账号 | 查询适用服务；只有用户选择并应用报价后才保存费用 |
| Australia Post Tracking | 已实现，受测试账号权限限制 | 返回状态、整票事件和 Article 事件；异常状态明确显示 |
| StarTrack | 通过现有适配器处理 | 当前与 Australia Post 使用相同的 `AUSTRALIA_POST` 适配器，不是独立的 StarTrack API 集成 |
| TNT 报价与 Tracking | **未集成** | 使用文档账号信息，接口调用返回401未认证，目前应用返回 `NOT_IMPLEMENTED` |
| 运单创建、面单和取件 | 未实现 | 保存 Shipment 与 Tracking Number 不会在承运商系统创建真实托运单 |
| 用户登录与权限 | 未实现 | 当前是本地/受控环境的演示应用，没有用户认证和角色授权 |

订单状态按 `Draft → Confirmed → In Transit → Completed` 前进；进入 `In Transit` 前至少需要一个 Tracking Number。草稿订单至少有一个订单行，但订单行可暂不分配 Shipment；一条订单行及其全部数量最多关联一个 Shipment。比如数量为 5 的一行不能拆成 2 件放入 Shipment A、另 3 件放入 Shipment B。`Completed` 订单只读。

`scripts/tnt_smoke.py` 是独立的诊断脚本，不属于 OMS 的 TNT 集成。

<a id="technology-and-structure"></a>
## 技术栈与项目结构

| 区域 | 技术与版本范围 |
| --- | --- |
| 前端 | React 18、TypeScript 7、Vite 6、MUI 9、React Router 6 |
| 后端 | Python 3.10+、FastAPI 0.115+、Pydantic 2.7+、SQLAlchemy 2、HTTPX 0.27+、Uvicorn 0.30+ |
| 数据库 | SQLite（默认）；通过 SQLAlchemy 访问 |
| 自动化检查 | pytest 8、Playwright 1.65+、TypeScript 编译检查 |

依赖范围以 `backend/requirements.txt`、`backend/requirements-dev.txt` 和 `frontend/package.json` 为准。

```text
backend/
  app/
    routes/                 FastAPI API 路由
    models.py               请求与响应 schema、输入校验
    database.py             SQLAlchemy 模型、SQLite 初始化与种子导入
    db_service.py           订单、商品、Shipment 和金额业务逻辑
    shipping_service.py     Australia Post 报价与账号服务
    tracking_service.py     Australia Post / StarTrack 追踪适配器
    request_logging.py      Request ID、脱敏参数摘要和异常调用帧
    logging_service.py      JSON 日志格式化和敏感信息遮盖
  tests/                    后端 API 与服务测试
frontend/
  src/
    app/                    路由、全局主题与应用布局
    features/               按订单、商品、承运商、运费和追踪划分的页面与组件
    shared/                 API 客户端、类型、金额格式化和公共组件
  e2e/                      Playwright 端到端测试
scripts/
  tnt_smoke.py              独立的 TNT 请求探测工具
data/
  orders.json               合成订单种子数据
  products.json             SKU 商品目录种子数据
  source/                   整理商品目录时保留的来源快照
```

前端使用按路由懒加载；业务页面位于 `features/`，通用请求、格式化和布局代码位于 `shared/`。Vite 在本地开发时将 `/api` 请求代理到 FastAPI。

<a id="input-data-and-sku-matching"></a>
## 输入数据、数据结构与 SKU 匹配

### 数据来源

- `data/orders.json` 提供演示订单。订单包含订单编号、日期、状态、公司、客户、配送地址、订单行和 Shipment。
- `data/products.json` 提供商品目录，包含 SKU、名称、描述、含 GST 的 RRP，以及可选重量和尺寸。
- `data/source/sku-query-result.json` 是整理商品数据时保存的本地来源快照；应用运行时不调用该查询页面，也不把它当作在线 API。
- 应用启动后，SQLite 是运行时数据源。新增订单和商品保存到数据库，不写回种子 JSON。

订单行的关键结构如下；示例 SKU 仅用于说明字段，不绑定评测订单：

```json
{
  "sku": "SKU-EXAMPLE",
  "quantity": 2,
  "tracking_group": null,
  "rrp_incl_gst": "19.99",
  "gst_rate_percent": "10.00"
}
```

### SKU 匹配与无效输入

- 创建订单时，后端按订单行的 `sku` 查询商品目录，并从商品记录补充名称、描述和产品重量；算法不依赖固定订单号或固定 SKU。
- 订单中的 SKU 必须在商品目录中存在。API 遇到未知 SKU 会拒绝保存并返回校验错误（HTTP 422），不会创建临时商品或静默使用错误价格。
- API 的订单行数量必须是严格的正整数；缺失、零、负数、小数或字符串数量会被 schema 校验拒绝（HTTP 422）。订单至少需要一条订单行。
- 初始化时，商品目录和订单种子会先复用 `ProductCatalog`、`OrderDataset` 等 Pydantic 模型校验，再写入数据库。数量必须是正整数；收货地址、邮箱、商品字段和 Shipment 分组也会执行对应约束。
- 种子订单的 SKU 必须存在于种子目录或当前商品表中。未知 SKU 或非法数据会在商品/订单写入前被拒绝，避免校验失败后留下部分导入结果。
- 商品 SKU 在创建商品时会去除首尾空格并转为大写；订单行应使用目录中的 SKU。编辑商品不会改写已保存订单行中的价格快照。

样例订单和商品仅作为数据输入，不是写在业务逻辑中的评测答案。替换 JSON 数据时，只要满足 schema 和业务约束，列表、SKU 查找及金额计算都按收到的数据处理。

<a id="product-image-note"></a>
## 商品图片说明

订单行目前共用 `frontend/src/assets/m1.png` 作为示意商品图片。图片用于界面展示，不是按 SKU 匹配的商品实拍图，也不代表订单中的真实商品、包装或标签；商品识别和金额计算都不依赖图片。

<a id="money-and-gst"></a>
## 金额计算规则

### 当前代码行为

- 货币为 AUD，数据库以整数分保存金额；金额换算使用 `Decimal`，按 `ROUND_HALF_UP` 舍入到两位小数，避免二进制浮点误差。
- RRP 是含 GST 价格。订单行的含税总额为 `RRP × Quantity`。
- 每行未税小计从含税行总额反算：先按该行税率计算含税金额中的 GST 并舍入，再以 `Line Gross − Line GST` 得到未税小计。展示的未税单价单独舍入，仅供阅读，不再用于乘数量计算。
- 同一税率组的未税小计先汇总，再按 `ROUND_HALF_UP(Group Subtotal Ex GST × Tax Rate, 2)` 计算 GST。全部为 10% 时，这等于评测公式 `ROUND_HALF_UP(Order Subtotal Ex GST × 10%, 2)`；混合税率时按各税率组分别计算后相加。
- 订单总额为 `Subtotal Ex GST + GST + Shipment Fees`。Shipment 费用单独保存和计入总额。
- 新订单行默认使用商品目录 RRP 和 10% GST；编辑订单时可以按行覆盖价格和税率，后续目录变更不会改写已保存订单行快照。

前端编辑预览、后端保存和数据库启动时的历史订单汇总都使用订单级舍入规则。订单行未税小计仍从各行含税 RRP 反算，因此在一分钱边界上，订单 GST 加未税小计可能与各行含税 RRP 合计差一分钱；这是采用评测汇总口径带来的舍入差异。

常规示例：含税 RRP 为 A$19.99、数量 100、GST 10%。含税行总额是 A$1,999.00，未税小计为 A$1,817.27；订单级 GST 为 A$1,817.27 × 10% = A$181.73。展示未税单价 A$18.17 不参与小计计算。

舍入边界示例：含税 RRP 为 A$49.99、数量 1、GST 10%。该行未税小计为 A$45.45；按评测公式，订单 GST 为 A$4.55，未税小计加 GST 为 A$50.00，比行含税 RRP 多 A$0.01。订单总额使用订单级 GST 作为权威汇总值。

评测公式适用于全部按 10% 计税的订单。若订单行税率不同，不能把整笔未税小计统一乘 10%；本项目按各税率分组计算，`gst_rate` 汇总字段会显示 `Mixed rates`。

<a id="shipment-fee-design"></a>
## Shipment 运费设计

### 计算方式与保存方式

- 应用使用 Australia Post 报价 API 返回实际可用服务和价格，不以本地固定费率公式生成报价。
- 报价依据包括服务端选定的账号档案、起运地址、目的地地址，以及包裹毛重和外包装长、宽、高。Shipping Planner 从已选择订单行汇总商品净重，包裹毛重不能低于商品净重；尺寸和包装重量由用户确认。
- 当前 Shipping Planner UI 每个 Shipment 输入一个包裹。一个订单可以有多个 Shipment；每个 Shipment 的已应用报价单独保存，订单级运费等于所有 Shipment 已保存费用之和。
- 当前关联模型按整条订单行分配：同一订单行的数量不能拆到多个 Shipment，也不能在同一订单行上分别保存多个包裹的部分履约数量。若实际业务需要分批发货，应先把订单行建模为可分配数量的履约单位，再允许按剩余数量拆分 Shipment；目前该能力尚未实现。
- 报价请求成功不等于保存费用。只有用户选定报价并应用后，系统才写入 Shipment 运费、服务产品 ID、账号展示快照、报价来源和时间。
- 不存在可用报价、报价失败、用户尚未应用报价或承运商未接入时，不生成虚构金额；Shipment 保持未报价，费用为 A$0.00，订单其余流程仍可继续。已有种子 Shipment 的历史费用保留，不会被追踪查询覆盖。

### 设计思考与业务假设

运费会随承运商账号、服务资格、起讫地址和包裹重量、尺寸变化；同一商品从不同地区或使用不同服务寄出，费用也可能不同。因此本项目优先使用承运商返回的报价，而不采用一个固定的“每公斤价格”冒充实际报价。SKU 重量用于估算包裹内商品净重；由于商品目录不包含实际包装材料及打包方式，包裹毛重和外包装尺寸由操作人员按本次包裹填写并确认。

本项目将 Shipment 视为单独询价和保存费用的单位：`订单运费 = 所有已应用 Shipment 报价之和`，`订单总额 = 未税小计 + GST + 订单运费`。这样每票费用都能对应到承运商、服务产品及包裹输入，也避免把多票费用平均摊回商品行。只有用户选中并应用有效报价后，该票费用才进入订单汇总。

如果没有可用的承运商 API，另一种可解释的估算思路是先比较实重和体积重，再按计费重与费率计算：

```text
体积重（kg） = 长（cm） × 宽（cm） × 高（cm） ÷ 承运商体积系数
计费重（kg） = max（包裹毛重，体积重）
估算运费 = 基础费 + 计费重 × 每公斤费率 + 适用的偏远地区附加费
```

体积系数、费率、重量进位规则和偏远地区范围都必须来自具体承运商的费率表或合同，不能使用一个假设值冒充通用市场价格。该公式仅记录为备选设计思路；当前项目没有用它生成运费，实际费用来自已应用的承运商 API 报价；无报价时仍按前述规则显示 A$0.00。

如果承运商没有返回报价、账号无权查询、请求失败或该承运商尚未接入，系统保留 A$0.00 并允许继续处理订单；这表示“当前没有可用报价”，不代表承运商承诺免费。TNT 属于评测加分项，当前未接入，因此其报价费用为 A$0.00。Australia Post 的可用报价则仍取决于已授权账号和 testbed 状态。

### 地址默认值

- 起运地址默认值为 Ryde, NSW 2112，可在报价表单中修改。该值是应用默认输入，不代表每个承运商账号的合同揽收地址都支持它。
- 订单内 Shipping Planner 会从当前订单的收货街道、地址第二行、Suburb、State、Postcode 和 Country 初始化目的地，并将 Australia 转成报价接口使用的 `AU`。用户仍可在询价前修改地址。
- 已保存 Shipment 中已有的目的地会作为该 Shipment 的地址快照保留；没有保存目的地的新 Shipment 或旧 Shipment 会从当前订单收货地址带入。独立 Shipping Rates 测试页没有订单上下文，仍使用示例 Sydney 地址。

<a id="tracking-and-carrier-integrations"></a>
## 物流追踪与承运商接口

### Australia Post 与 StarTrack

- 当前 Tracking 由后端代理 Australia Post testbed 请求，前端不保存承运商 API 密钥或密码。
- 订单界面中的 Australia Post 和 StarTrack 都映射到 `integration_type = AUSTRALIA_POST`，由同一套 API 适配器处理。当前项目没有单独的 StarTrack API endpoint、凭据路由或适配器。
- 追踪账号可通过 `AUSTRALIA_POST_TRACKING_ACCOUNT_NUMBER` 配置；未设置时回退到旧共享账号，再回退到报价账号。账号授权和 testbed 数据会影响实际结果。
- 追踪结果会标准化为整票状态、Article 状态和事件时间线；短期缓存降低重复请求。`not_queried`、`not_found`、`unavailable` 和 `not_implemented` 会明确区分，不会伪造实时事件。

### 异常行为

认证被拒、超时、网络/TLS 错误、HTTP 错误、无效 JSON 或不符合预期的响应会转成可显示的错误状态和错误码。无法查询时，页面保留错误类别，用户可以重试；缺少运单号时不会发出追踪请求。上游没有返回事件时，页面显示空状态，不补造物流进度。

### TNT

TNT Tracking 与 Pricing 在 OMS API 和页面中均为 `NOT_IMPLEMENTED`。系统不会用 Australia Post 冒充 TNT 查询，也不会显示伪造的 TNT 价格或追踪事件。`scripts/tnt_smoke.py` 是独立探测工具，只有在本地服务端环境变量中配置相应 TNT 测试凭据并显式运行时才会请求 TNT；脚本测试结果不等于应用集成成功。

截至当前版本，项目尚无经过验证成功的真实 TNT UAT 调用，因此不能将 RTT 报价或 ExpressConnect Tracking/Pricing 描述为已打通。`backend/tests/test_tnt_smoke.py` 使用模拟 HTTP 响应验证请求构造、响应解析和错误分类，不会访问 TNT；真实账号的接口授权和 UAT 联调仍需单独确认。

<a id="engineering-decisions"></a>
## 实现难点与设计取舍

| 难点 / 风险 | 当前处理方式 | 采用原因与边界 |
| --- | --- | --- |
| 金额精度及 GST 舍入 | 使用 `Decimal`、整数分和 HALF_UP；同税率订单在订单小计上舍入 | 满足评测的订单级 GST 公式；混合税率时按税率分组，并接受分币边界下汇总金额可能与含税行金额相差一分 |
| 订单行与多个 Shipment 的关系 | 订单行通过关联表完整分配给一个 Shipment；不支持按数量拆分一行 | 让订单总额、包裹内容和追踪号维持一致；当前 Planner 以一个 Shipment 一个包裹为输入，部分履约需要扩展数量分配模型 |
| 外部 API 失败或响应不一致 | 后端适配器归一化状态、事件及错误，前端显示 unavailable 等状态 | 外部服务故障不应让订单详情无法使用，也不应展示推测出来的物流数据 |
| 账号凭据和日志可追踪性 | 凭据留在服务端；使用 Request ID、结构化日志和敏感字段遮盖 | 便于把前端、API 和承运商请求关联起来，同时降低日志中的个人资料和凭据暴露 |
| 目的地与订单收货地址 | 订单内 Planner 从收货地址初始化，保留已保存 Shipment 的目的地快照 | 避免新 Shipment 默认报到示例邮编，同时允许用户按实际包裹情况修正地址 |


<a id="configuration"></a>
## 环境变量配置

将 `.env.example` 复制为项目根目录 `.env`，仅在服务端填写获授权的值。`.env` 已加入 Git 忽略规则。

```bash
cp .env.example .env
```

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | 数据库连接；留空时使用 `data/oms.db` |
| `AUSTRALIA_POST_API_KEY` | Australia Post API 用户名 / Key |
| `AUSTRALIA_POST_API_PASSWORD` | Australia Post API 密码 |
| `AUSTRALIA_POST_PRICING_ACCOUNT_NUMBER` | 默认报价账号号码 |
| `AUSTRALIA_POST_PRICING_ACCOUNT_LABEL` | 默认报价账号的界面名称 |
| `AUSTRALIA_POST_ACCOUNT_PROFILES_JSON` | 多个报价账号档案配置，档案引用账号与凭据变量名 |
| `AUSTRALIA_POST_ACCOUNT_SAME_DAY` | Same Day Services 报价账号（可选） |
| `AUSTRALIA_POST_ACCOUNT_ST_PREMIUM_EXPRESS` | ST Premium / ST Express 报价账号（可选） |
| `AUSTRALIA_POST_ACCOUNT_ON_DEMAND` | On Demand 报价账号（可选） |
| `AUSTRALIA_POST_TRACKING_ACCOUNT_NUMBER` | 独立 Tracking 账号（可选） |
| `AUSTRALIA_POST_ACCOUNT_NUMBER` | 旧版共享账号回退配置 |
| `AUSTRALIA_POST_BASE_URL` | API 根地址；留空时使用代码配置的 testbed 默认值 |
| `TNT_RTT_*`、`TNT_EXPRESSCONNECT_*` | 仅供独立 TNT 探测脚本使用，不启用应用 TNT 集成 |

`AUSTRALIA_POST_ACCOUNT_PROFILES_JSON` 中的 `id` 是前端选择器使用的稳定 ID；`account_number_env`、`api_key_env`、`api_password_env` 和 `base_url_env` 指向服务端变量名，不应直接写凭据。详细示例和可选字段见 `.env.example`。浏览器只接收档案 ID、名称、环境和掩码账号。

<a id="api-reference"></a>
## API 概览

本地完整 schema 与交互式请求示例见 <http://127.0.0.1:8003/docs>。

| 资源 | 主要路由 |
| --- | --- |
| Products | `GET/POST /api/products`、`GET/PATCH/DELETE /api/products/{sku}` |
| Orders | `GET/POST /api/orders`、`GET/PATCH /api/orders/{order_id}`、`PATCH /api/orders/{order_id}/status` |
| Shipments | `POST /api/orders/{order_id}/shipments`、`PATCH/DELETE /api/shipments/{shipment_id}` |
| Carriers | `GET/POST /api/carriers`、`GET/PATCH/DELETE /api/carriers/{carrier_id}` |
| Shipping | `GET /api/shipping/accounts`、`GET /api/shipping/accounts/{profile_id}/products`、`POST /api/shipping/rates`、`POST /api/shipping/shipments/{shipment_id}/apply-rate`、`POST /api/shipping/orders/{order_no}/quotes/preview`、`POST /api/shipping/orders/{order_no}/shipments/save`、`POST /api/shipping/orders/{order_no}/quotes/apply` |
| Tracking | `POST /api/orders/tracking`、`GET /api/orders/{order_id}/tracking?refresh=false` |

旧路径 `GET /api/shipping/account-products` 暂时保留兼容本地调用；新页面使用带账号档案 ID 的路径。字段约束以 `backend/app/models.py` 和 OpenAPI schema 为准。

<a id="testing"></a>
## 测试与构建

后端测试：

```bash
cd backend
pip install -r requirements-dev.txt
pytest -q
```

前端类型检查、生产构建和端到端测试：

```bash
cd frontend
npx tsc --noEmit
npm run build
npx playwright install chromium  # 首次运行时安装浏览器
npm run test:e2e
```

Playwright 使用固定 API fixtures，不会请求真实承运商服务。承运商真实请求需要服务端有效凭据，并受账号权限、testbed 数据和上游可用性影响。

<a id="logging-and-troubleshooting"></a>
## 日志与故障排查

- 后端以 JSON Lines 写入终端和 `backend/logs/api-calls.log`；单文件上限 5 MiB，保留 3 份轮转文件。
- 前端请求生命周期事件写入浏览器 Console。`X-Request-ID` 在请求响应中往返，用于关联浏览器、FastAPI 和承运商调用日志。
- 后端未处理异常及前端 API / 网络错误会记录有限的调用位置，便于从 Request ID 和堆栈帧定位代码路径。
- 参数摘要先做脱敏，再限制为 16 KiB；超限时记录省略原因。日志不保存原始请求头、完整请求/响应正文或异常消息。
- 客户联系人、地址、认证凭据和完整 Tracking / Article ID 会被遮盖；标识最多保留末四位。日志仍可能包含订单号、SKU、金额和包裹尺寸等业务诊断信息，应限制文件访问并设置适当保留期。

日志用于运行排查，不是审计系统。排查问题时，先在浏览器 Console 记录 Request ID，再在后端终端或日志文件中搜索同一 ID；不要复制或分享包含个人资料的原始日志。

<a id="security-and-limitations"></a>
## 安全说明与当前限制

- 目前没有用户登录、身份认证或角色权限。请只在本机或受控网络中运行，不要直接公开到互联网。
- API 凭据只放在服务端环境变量或部署平台密钥管理中；`.env.example` 是变量名和配置结构示例，不包含真实账号、API Key 或密码。
- 订单样例使用合成数据。
- 默认使用 SQLite，当前初始化和旧 schema 兼容逻辑不是完整的数据库迁移、备份或灾备方案。
- 报价缓存保存在单个后端进程内并会过期；重启或多实例部署不会共享尚未应用的报价缓存。Account Products 结果也使用进程内短期缓存。
- Australia Post 使用 testbed；服务资格和价格取决于账号授权、地址、包裹数据和上游状态。报价不是承运合同承诺价。
- 应用不会自动在承运商平台创建运单、购买面单或安排取件。
- 发布环境需另行配置 HTTPS、网络策略、密钥管理、数据库迁移和备份，并限制 OpenAPI 文档的访问范围。
