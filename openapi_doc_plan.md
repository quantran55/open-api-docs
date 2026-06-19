# Kế hoạch xây dựng bộ OpenAPI Doc cho HayInsights Open API

> **Mục tiêu**: Tạo bộ đặc tả + tài liệu OpenAPI cho sản phẩm **HayInsights Open API**
> (`/openapi/v1/*`, xác thực bằng API key), **dùng y hệt techstack & kiến trúc** của
> repo tham chiếu `/Users/macbookpro/IdeaProjects/api-swagger` (Finhay Securities Open API).
>
> **Repo đích**: chính thư mục hiện tại `/Users/macbookpro/IdeaProjects/hayinsight-openapi`
> (đang trống, mới có file Postman collection — sẽ `git init` và dựng từ đầu).
>
> **Nguồn dữ liệu đầu vào**:
> - `HayInsights-openapi.postman_collection.json` — danh sách 40 endpoint + params + weight + feature.
> - Source code thật ở `IdeaProjects/hayinsights/apps/api/src/openapi/*` (đã đọc & nắm kiến trúc).
> - API staging thật: `https://stg-api.hayinsights.com` (đã gọi xác nhận envelope & headers).

---

## 0. Tóm tắt nhanh (TL;DR)

- **Techstack giống hệt `api-swagger`**: OpenAPI **3.1** (YAML modular, nối bằng `$ref`) →
  **Redocly CLI** (lint + bundle + preview) → **Mintlify** (trang docs) → **Node 22** + **npm**.
- **40 endpoint** thuộc 6 domain: Commodities (5), Crypto (5), ETF (12), FX (4), Macro (7), Real Estate (7).
- **Khác biệt cốt lõi so với Finhay**: HayInsights chỉ có **1 tier xác thực = API key** (header
  `X-API-Key`) — **không** HMAC, **không** nonce/timestamp/signature/2FA. Bù lại có thêm tầng
  **feature-gating + weighted rate-limit theo plan** cần được encode & document.
- **Response envelope khác**: `{ success, statusCode, data, meta }` (Finhay là `{ error_code, message, result }`).
- Đầu ra: `dist/openapi.{yaml,json}` (cho codegen) + trang Mintlify (`/docs`) — gate bằng
  `redocly lint` 0 error.

---

## 1. Techstack đích (mirror `api-swagger`)

| Hạng mục | Công nghệ | Ghi chú |
|---|---|---|
| Spec format | **OpenAPI 3.1.0**, YAML modular | 1 root `openapi.yaml` + nhiều file `$ref` |
| Tooling | **`@redocly/cli`** (`^1.25.0`) | `lint` / `bundle` / `preview` |
| Docs site | **Mintlify** (theme `mint`) | `docs/docs.json` + các trang `.mdx` |
| Runtime | **Node 22** (`.nvmrc`) + **npm** | `package-lock.json` |
| Ngôn ngữ file | YAML (spec) + MDX/Markdown (docs) | Không có code app |
| VCS/CI | Git + GitHub Actions | CI chạy `redocly lint` làm gatekeeper |

**Không thêm** framework/deps nào ngoài bộ trên — giữ đúng tinh thần "spec + docs" của repo tham chiếu.

---

## 2. Khác biệt cốt lõi so với `api-swagger` (đọc kỹ trước khi copy)

Đây **không** phải copy mù — phải điều chỉnh 6 điểm sau cho khớp thực tế HayInsights:

| # | api-swagger (Finhay) | hayinsight-openapi (HayInsights) |
|---|---|---|
| 1. Xác thực | 2 tier: API key + HMAC-SHA256 (timestamp/nonce/signature/bodyhash) + 2FA | **1 tier duy nhất**: API key qua header **`X-API-Key`** |
| 2. Security scheme | 6 scheme + extension `x-finhay-signing` | **1 scheme** `HayInsightsApiKey`; **bỏ** toàn bộ phần signing |
| 3. Envelope success | `{ error_code, message, result }` | `{ success, statusCode, data, meta }` |
| 4. Envelope error | `{ error_code, message }` | `{ success:false, statusCode, error:{ code, message }, meta }` |
| 5. Khái niệm mới | (không có) | **Plan / Feature-gating / Weighted rate-limit** — cần page docs + extension riêng |
| 6. Headers | `X-RateLimit-Reset` | `X-RateLimit-Limit/Remaining/Reset/Weight-Used` (+ `Retry-After` khi 429) |

**Bỏ hẳn** khỏi bản HayInsights: `x-finhay-signing`, các securityScheme HMAC, page `bootstrap-flow`,
mục "Signing middleware", "2FA session", "Order-level error codes".

**Thêm mới**: page `plans-and-features` (hoặc gộp vào `rate-limits`), extension
`x-hayinsights-quota` (root) + `x-feature-code` / `x-api-weight` (per-operation).

---

## 3. Contract đã xác nhận từ staging (nguồn sự thật cho schema)

> Đã gọi thật `https://stg-api.hayinsights.com` để chốt các shape dưới đây.

### 3.1 Success envelope
```json
{
  "success": true,
  "statusCode": 200,
  "data": { /* object */ } ,        // hoặc [ ... ] với endpoint dạng list
  "meta": { "timestamp": "2026-06-19T08:31:59.478Z" }
}
```
- `data` là **object** (vd `crypto/dominance`, `fx/summary`) hoặc **array** (vd `commodities`, `macro/economic-data`).
- `meta.timestamp` (ISO 8601) — luôn có ở response 200; một số endpoint có thêm field trong `meta`.

### 3.2 Error envelope
```json
{
  "success": false,
  "statusCode": 401,
  "error": { "code": "API_KEY_REQUIRED", "message": "API key required for OpenAPI access" },
  "meta": { "timestamp": "2026-06-19T08:34:07.973Z" }
}
```
- `error.message` có thể là **string** hoặc **mảng string** (lỗi validation 400 trả nhiều message).
- `error.code` cụ thể với lỗi auth/quota (`API_KEY_REQUIRED`, `API_KEY_INVALID`, `RATE_LIMIT_EXCEEDED`…);
  với 400/404 hiện trả `code: "INTERNAL_ERROR"` còn ngữ nghĩa thật nằm ở `statusCode` + `meta.error`
  (`"Bad Request"` / `"Not Found"`). → `ErrorBody.code` để kiểu string mở (không enum cứng).

### 3.3 Mã lỗi & HTTP status (đã verify)
| HTTP | `error.code` | Khi nào |
|---|---|---|
| 400 | `INTERNAL_ERROR` (+ `meta.error: "Bad Request"`) | Thiếu/sai query param bắt buộc (vd `economic-data` thiếu `type`) |
| 401 | `API_KEY_REQUIRED` | Không gửi `X-API-Key` |
| 401 | `API_KEY_INVALID` | Key sai / không tồn tại |
| 401 | `API_KEY_DISABLED` / `API_KEY_EXPIRED` | Key bị revoke / hết hạn (theo source) |
| 403 | `FEATURE_NOT_IN_PLAN` | Plan không có feature của domain (theo source) |
| 403 | `API_KEY_SCOPE_DENIED` | Scope key không cho phép feature (hiện dormant, theo source) |
| 404 | `INTERNAL_ERROR` (+ `meta.error: "Not Found"`) | Tài nguyên không tồn tại (vd commodity slug sai) |
| 429 | `RATE_LIMIT_EXCEEDED` | Vượt quota/phút của plan (theo source) |
| 500 | `INTERNAL_ERROR` | Lỗi server |

### 3.4 Rate-limit headers (đã verify trên mọi response)
```
X-RateLimit-Limit: 1000          # quota weight/phút của plan
X-RateLimit-Remaining: 997
X-RateLimit-Reset: 1781857979    # epoch giây — thời điểm window reset
X-RateLimit-Weight-Used: 3       # weight endpoint vừa gọi đã tiêu
Retry-After: <giây>              # chỉ xuất hiện khi 429
```

---

## 4. Cấu trúc thư mục đích (mirror y hệt `api-swagger`)

```
hayinsight-openapi/
├── package.json                 # scripts: lint / bundle / preview / docs:bundle / docs:dev
├── redocly.yaml                 # extends recommended + rule strict (gatekeeper)
├── .nvmrc                       # 22
├── .gitignore                   # node_modules/ dist/ .DS_Store .env examples/raw/
├── README.md  README.en.md      # quick start + cấu trúc + auth + license
├── openapi/
│   ├── openapi.yaml             # ROOT: info, servers, security, tags, x-tagGroups, x-hayinsights-quota, paths $ref, components $ref
│   ├── paths/
│   │   ├── commodities/         # 5 file
│   │   ├── crypto/              # 5 file
│   │   ├── etf/                 # 12 file
│   │   ├── fx/                  # 4 file
│   │   ├── macro/               # 7 file
│   │   └── real-estate/         # 7 file
│   └── components/
│       ├── securitySchemes/
│       │   └── HayInsightsApiKey.yaml      # apiKey · header · X-API-Key
│       ├── parameters/                     # path/query tái sử dụng (Country, EtfCode, CommodityId, WardId, Lang, các Period…)
│       ├── headers/                        # XRateLimitLimit / Remaining / Reset / WeightUsed / RetryAfter
│       ├── responses/                      # BadRequest / Unauthorized / Forbidden / NotFound / RateLimited / InternalError
│       └── schemas/
│           ├── common/                     # EnvelopeBase, ErrorBody, ErrorDetail, Meta
│           │   └── enums/                  # CommodityCategory, SortOrder, EconomicDataType, EtfPeriod, …
│           ├── commodities/                # CommodityPrice, CommodityMover, CommodityHistoryPoint, GoldDxy…
│           ├── crypto/                     # CryptoOverview, DominanceCoin, BubbleMapItem, OnchainMetrics, Derivatives…
│           ├── etf/                        # Etf, EtfDetail, EtfHolding, NavGrowthPoint, FundComposition…
│           ├── fx/                         # FxSummary, FxPair, FxCorrelation, EmStress…
│           ├── macro/                      # GdpGrowth, EconomicDataPoint, ExchangeRatePoint, Population, GovDebt, RatesYields…
│           ├── realestate/                 # CountrySummary, ReStats, Ward, WardDetail, LandPrice, Province, GeoJson…
│           └── responses/                  # 40 wrapper: <OperationId>Response (allOf EnvelopeBase + data có kiểu)
├── docs/                        # Mintlify
│   ├── docs.json                # theme mint, navigation (Guides + API Reference), brand
│   ├── openapi.yaml             # bundle output cho Mintlify (sinh bằng docs:bundle)
│   ├── introduction.mdx  quickstart.mdx  authentication.mdx
│   ├── rate-limits.mdx  plans-and-features.mdx  errors.mdx  changelog.mdx
│   ├── logo.svg  favicon.png
├── scripts/
│   └── harvest.mjs              # gọi 40 endpoint staging → lưu examples/<operationId>.json
├── examples/                    # response thật (nguồn cho field `example:` trong spec)
└── dist/                        # bundle output (gitignored): openapi.yaml + openapi.json
```

---

## 5. Inventory 40 endpoint (bản đồ endpoint → file → operationId → feature/weight)

> Quy ước **operationId**: `<domain><Thing>` camelCase (bắt buộc cho codegen — rule `operation-operationId`).
> Path trong spec giữ **full** `/openapi/v1/...` (server = host gốc), khớp Postman & thực tế.

### 5.1 Commodities — tag `Commodities` · feature `commodities_data` · weight **3**
| Method + Path | operationId | Params | Path file |
|---|---|---|---|
| GET /openapi/v1/commodities | `commoditiesList` | q: `category`(energy\|metals\|agriculture\|macro), `search`, `sort`(name\|price\|change_1d\|mtd\|ytd), `order`(asc\|desc=desc) | `commodities/commodities.yaml` |
| GET /openapi/v1/commodities/featured | `commoditiesFeatured` | — | `commodities/commodities_featured.yaml` |
| GET /openapi/v1/commodities/movers | `commoditiesMovers` | q: `period`(mtd), `limit`(1..10=3) | `commodities/commodities_movers.yaml` |
| GET /openapi/v1/commodities/gold-dxy | `commoditiesGoldDxy` | q: `period`(1m\|3m\|ytd=3m) | `commodities/commodities_gold-dxy.yaml` |
| GET /openapi/v1/commodities/{id}/history | `commoditiesHistory` | path: `id`(slug); q: `period`(7d\|1m\|3m\|ytd\|1y=3m), `interval`(daily\|weekly=daily) | `commodities/commodities_{id}_history.yaml` |

### 5.2 Crypto — tag `Crypto` · feature `crypto_data` · weight **3**
| Method + Path | operationId | Params | Path file |
|---|---|---|---|
| GET /openapi/v1/crypto | `cryptoOverview` | — | `crypto/crypto.yaml` |
| GET /openapi/v1/crypto/bubble-map | `cryptoBubbleMap` | q: `timeframe`(1h\|1d\|1w=1d), `limit`(1..200=100) | `crypto/crypto_bubble-map.yaml` |
| GET /openapi/v1/crypto/onchain | `cryptoOnchain` | — | `crypto/crypto_onchain.yaml` |
| GET /openapi/v1/crypto/derivatives | `cryptoDerivatives` | — | `crypto/crypto_derivatives.yaml` |
| GET /openapi/v1/crypto/dominance | `cryptoDominance` | — | `crypto/crypto_dominance.yaml` |

### 5.3 ETF — tag `ETF` · feature `etf_data` · weight **8**
| Method + Path | operationId | Params | Path file |
|---|---|---|---|
| GET /openapi/v1/etf | `etfList` | — | `etf/etf.yaml` |
| GET /openapi/v1/etf/top-performance | `etfTopPerformance` | q: `period`(1M\|6M\|1Y=1M) | `etf/etf_top-performance.yaml` |
| GET /openapi/v1/etf/top-netflow | `etfTopNetflow` | q: `type`(positive\|negative=positive) | `etf/etf_top-netflow.yaml` |
| GET /openapi/v1/etf/heatmap | `etfHeatmap` | — | `etf/etf_heatmap.yaml` |
| GET /openapi/v1/etf/compare/fund-composition | `etfCompareFundComposition` | q: `codes`**(bắt buộc, 2..5 csv)** | `etf/etf_compare_fund-composition.yaml` |
| GET /openapi/v1/etf/compare/nav-growth | `etfCompareNavGrowth` | q: `code1`**(bắt buộc)**, `code2`**(bắt buộc)** | `etf/etf_compare_nav-growth.yaml` |
| GET /openapi/v1/etf/nav-growth/{code} | `etfNavGrowth` | path: `code` | `etf/etf_nav-growth_{code}.yaml` |
| GET /openapi/v1/etf/{code}/info | `etfInfo` | path: `code` | `etf/etf_{code}_info.yaml` |
| GET /openapi/v1/etf/{code}/holdings | `etfHoldings` | path: `code` | `etf/etf_{code}_holdings.yaml` |
| GET /openapi/v1/etf/{code}/prices-history | `etfPricesHistory` | path: `code` | `etf/etf_{code}_prices-history.yaml` |
| GET /openapi/v1/etf/{code}/detail | `etfDetail` | path: `code` | `etf/etf_{code}_detail.yaml` |
| GET /openapi/v1/etf/{code}/composition | `etfComposition` | path: `code` (mã quỹ VN) | `etf/etf_{code}_composition.yaml` |

> ⚠️ **Thứ tự khai báo** trong `openapi.yaml`: route tĩnh/cụ thể (`compare/*`, `nav-growth/{code}`)
> phải đứng **trước** `{code}/*` để Redocly không cảnh báo `no-ambiguous-paths`.

### 5.4 FX — tag `FX` · feature `fx_data`
| Method + Path | operationId | Weight | Params | Path file |
|---|---|---|---|---|
| GET /openapi/v1/fx/summary | `fxSummary` | 3 | — | `fx/fx_summary.yaml` |
| GET /openapi/v1/fx/table | `fxTable` | 3 | q: `pairs`(csv, optional) | `fx/fx_table.yaml` |
| GET /openapi/v1/fx/correlation | `fxCorrelation` | **6** | q: `assets`(csv, optional) | `fx/fx_correlation.yaml` |
| GET /openapi/v1/fx/em-stress | `fxEmStress` | **6** | — | `fx/fx_em-stress.yaml` |

### 5.5 Macro — tag `Macro` · feature `macro_data` · weight **2**
| Method + Path | operationId | Params | Path file |
|---|---|---|---|
| GET /openapi/v1/macro/gdp-growth-rate | `macroGdpGrowthRate` | q: `country`(=JP) | `macro/macro_gdp-growth-rate.yaml` |
| GET /openapi/v1/macro/market-recap | `macroMarketRecap` | — | `macro/macro_market-recap.yaml` |
| GET /openapi/v1/macro/economic-data | `macroEconomicData` | q: `type`**(bắt buộc: gdp\|cpi\|pce\|import-export)**, `country`, `period`(1Y\|3Y\|10Y) | `macro/macro_economic-data.yaml` |
| GET /openapi/v1/macro/exchange-rate | `macroExchangeRate` | q: `currency1`**(bắt buộc)**, `currency2`**(bắt buộc)**, `period`(1Y\|3Y\|5Y\|10Y), `before`(date) | `macro/macro_exchange-rate.yaml` |
| GET /openapi/v1/macro/population | `macroPopulation` | q: `country`(=JP), `period`(1Y\|3Y\|10Y) | `macro/macro_population.yaml` |
| GET /openapi/v1/macro/monetary-policy/central-government-debt | `macroCentralGovernmentDebt` | q: `country`(=US), `period`(5Y\|10Y\|20Y) | `macro/macro_monetary-policy_central-government-debt.yaml` |
| GET /openapi/v1/macro/monetary-policy/rates-yields | `macroRatesYields` | q: `country`(=JP), `period`(1Y\|3Y\|10Y) | `macro/macro_monetary-policy_rates-yields.yaml` |

### 5.6 Real Estate — tag `Real Estate` · feature `realestate_data` · weight **2**
| Method + Path | operationId | Params | Path file |
|---|---|---|---|
| GET /openapi/v1/real-estate/{country}/geojson | `realEstateGeoJson` | path: `country` | `real-estate/real-estate_{country}_geojson.yaml` |
| GET /openapi/v1/real-estate/{country}/stats | `realEstateStats` | path: `country` | `real-estate/real-estate_{country}_stats.yaml` |
| GET /openapi/v1/real-estate/{country}/wards | `realEstateWards` | path: `country`; q: `lang`(=vi) | `real-estate/real-estate_{country}_wards.yaml` |
| GET /openapi/v1/real-estate/{country}/wards/{wardId} | `realEstateWardDetail` | path: `country`, `wardId`(int) | `real-estate/real-estate_{country}_wards_{wardId}.yaml` |
| GET /openapi/v1/real-estate/{country}/land-prices | `realEstateLandPrices` | path: `country`; q: `type`(residential\|commercial\|production), `area`(I\|II\|III\|IV), `ward_id`, `q`, `limit` | `real-estate/real-estate_{country}_land-prices.yaml` |
| GET /openapi/v1/real-estate/{country}/provinces | `realEstateProvinces` | path: `country`; q: `lang`(=vi) | `real-estate/real-estate_{country}_provinces.yaml` |
| GET /openapi/v1/real-estate/{country} | `realEstateCountrySummary` | path: `country` | `real-estate/real-estate_{country}.yaml` |

> ⚠️ `{country}` (1 segment) khai báo **cuối cùng** để không "nuốt" các route `{country}/...`.

---

## 6. Kế hoạch component schema

### 6.1 `common/` — nền tảng envelope
- **`EnvelopeBase.yaml`** — `success`(bool), `statusCode`(int), `meta`(`$ref Meta`). Base cho mọi wrapper.
- **`Meta.yaml`** — `timestamp`(date-time) + cho phép thêm field (`additionalProperties: true`).
- **`ErrorDetail.yaml`** — `code`(string), `message`(`oneOf: [string, string[]]`).
- **`ErrorBody.yaml`** — `success`(const false), `statusCode`(int), `error`(`$ref ErrorDetail`), `meta`(`$ref Meta`).

### 6.2 `common/enums/` — enum tái sử dụng (rút từ Postman)
`SortOrder`(asc/desc), `CommodityCategory`, `CommoditySort`, `CommodityHistoryPeriod`, `CommodityHistoryInterval`,
`GoldDxyPeriod`, `CryptoTimeframe`, `EtfPeriod`, `EtfNetflowType`, `EconomicDataType`, `MacroPeriod`(1Y/3Y/10Y),
`ExchangeRatePeriod`(1Y/3Y/5Y/10Y), `GovDebtPeriod`(5Y/10Y/20Y), `LandPriceType`, `LandPriceArea`, `Lang`.

### 6.3 Schema dữ liệu theo domain
Mỗi domain 1 thư mục, mỗi object dữ liệu 1 file (tách item khỏi wrapper, giống cách `api-swagger`
tách `StockRealtime` khỏi `StockRealtimeResponse`). **Field & kiểu lấy từ response thật đã harvest**
(Phase 1) — không bịa. Ví dụ field đã thấy: `commodities` → `id,name,category,unit,lastClose,currency,
change1dPct,changeMtdPct,changeYtdPct,ma50,trend,trendline[],updatedAt`; `crypto/dominance` →
`totalMarketCap, coins[].{symbol,name,dominancePercentage,marketCap}`; `fx/summary` →
`dxy/usdJpy.{value,changePct,asOf,source}, emStress.{level,score,panicCount,warningCount}`;
`macro/economic-data` → `country,quarter,gdp,gdpUnit,growthRate,realGdp,realGrowthRate,dateFrom,dateTo`.

### 6.4 `responses/` — 40 wrapper (1 / operation)
Convention `allOf` (kế thừa base + chèn `data` có kiểu):
```yaml
# components/schemas/responses/CryptoDominanceResponse.yaml
allOf:
  - $ref: "../common/EnvelopeBase.yaml"
  - type: object
    required: [data]
    properties:
      data:
        $ref: "../crypto/CryptoDominance.yaml"
```
Endpoint dạng list → `data` là `type: array, items: $ref ...`.

### 6.5 `securitySchemes/HayInsightsApiKey.yaml`
```yaml
type: apiKey
in: header
name: X-API-Key
description: |
  API key của bạn (tiền tố `apk_`). Tạo & quản lý trong Dashboard (Account → API keys).
  Gửi kèm header `X-API-Key` trên **mọi** request tới `/openapi/v1/*`. Quyền truy cập từng
  nhóm dữ liệu và hạn mức (quota) phụ thuộc gói (plan) gắn với key.
```

### 6.6 `responses/` lỗi tái sử dụng + `headers/`
- `BadRequest`(400), `Unauthorized`(401), `Forbidden`(403), `NotFound`(404), `RateLimited`(429), `InternalError`(500)
  — mỗi cái `content` `$ref ErrorBody` + `example` thật (mục 3.3). `RateLimited` + `Unauthorized`/mọi 2xx
  đính kèm các header rate-limit.
- `headers/`: `XRateLimitLimit`, `XRateLimitRemaining`, `XRateLimitReset`, `XRateLimitWeightUsed`, `RetryAfter`.

Mỗi operation khai báo tối thiểu: `200` (wrapper riêng) + `400` + `401` + `403` + `429` + `500`
(thỏa rule `operation-4xx-response`). Endpoint có path param thêm `404`.

---

## 7. Root `openapi.yaml` — các khối chính

```yaml
openapi: 3.1.0
info:
  title: HayInsights Open API
  version: 0.1.0
  description: |   # giới thiệu sản phẩm + mô hình API key + plan/quota (đa dòng)
servers:
  - url: https://api.hayinsights.com         # Production
  - url: https://stg-api.hayinsights.com     # Staging
security:
  - HayInsightsApiKey: []                     # mọi route yêu cầu API key
tags: [Commodities, Crypto, ETF, FX, Macro, Real Estate]   # + description từng tag
x-tagGroups:
  - name: Market Data
    tags: [Commodities, Crypto, ETF, FX, Macro, Real Estate]
# Extension machine-readable cho codegen/tooling hiểu mô hình quota (đối ứng x-finhay-signing):
x-hayinsights-quota:
  model: weighted-sliding-window
  window: 1m
  unit: weight
  headers: { limit: X-RateLimit-Limit, remaining: X-RateLimit-Remaining, reset: X-RateLimit-Reset, weightUsed: X-RateLimit-Weight-Used }
  exceededError: { status: 429, code: RATE_LIMIT_EXCEEDED, retryAfterHeader: Retry-After }
  weights: { default: 1, byTag: { Macro: 2, "Real Estate": 2, Commodities: 3, Crypto: 3, FX: "3–6", ETF: 8 } }
paths:   # 40 $ref, đúng thứ tự tránh ambiguous
components:
  securitySchemes: { HayInsightsApiKey: { $ref: ... } }
```
Mỗi operation gắn thêm extension: `x-feature-code: <domain>_data` và `x-api-weight: <n>` (để doc & codegen
biết feature/weight). Optional `x-codeSamples` (curl/TS/Python) — Phase 5.

---

## 8. Trang tài liệu Mintlify (`docs/`)

`docs.json` (mirror cấu trúc 2-tab của reference, bỏ phần bootstrap/HMAC):
- **Tab "Guides"**: nhóm *Bắt đầu* (`introduction`, `quickstart`) · *Xác thực* (`authentication`) ·
  *Hạn mức & Gói* (`rate-limits`, `plans-and-features`) · *Tham khảo* (`errors`) · *Lịch sử* (`changelog`).
- **Tab "API Reference"**: `"openapi": "openapi.yaml"`, groups theo 6 domain, list từng
  `GET /openapi/v1/...` (đúng như reference list `GET /market/...`).
- Brand: `theme mint`, logo/favicon HayInsights, `colors.primary` theo brand (cần chốt — mục 11).

Nội dung từng trang `.mdx` (tái dùng component Mintlify `<Steps> <CodeGroup> <Card> <Accordion> <Warning>`):
| Trang | Nội dung |
|---|---|
| `introduction.mdx` | HayInsights là gì, base URL, mô hình API-key + plan, danh mục 6 nhóm dữ liệu |
| `quickstart.mdx` | Lấy key → gọi request đầu tiên (`curl -H "X-API-Key: $KEY" .../crypto/dominance`) → đọc envelope `{success,data,meta}` — bản đơn giản hơn Finhay (không HMAC) |
| `authentication.mdx` | Chỉ 1 mục: header `X-API-Key`; cách tạo/rotate/revoke key; rule "OpenAPI chỉ nhận API key" |
| `rate-limits.mdx` | Weighted quota/phút, bảng weight theo endpoint, 4 header `X-RateLimit-*`, xử lý 429 + `Retry-After` |
| `plans-and-features.mdx` | Bảng feature-code ↔ domain, plan nào mở feature/quota nào, lỗi `FEATURE_NOT_IN_PLAN` |
| `errors.mdx` | Bảng HTTP status + `error.code`, shape `{success:false,error,meta}`, chiến lược retry (429/5xx có, 4xx không) |
| `changelog.mdx` | Lịch sử version (khởi đầu `0.1.0`) |

---

## 9. Tooling, scripts, gatekeeper

**`package.json`** (copy từ reference, đổi tên):
```json
{
  "name": "hayinsights-openapi",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "lint": "redocly lint openapi/openapi.yaml",
    "bundle": "mkdir -p dist && redocly bundle openapi/openapi.yaml -o dist/openapi.yaml && redocly bundle openapi/openapi.yaml -o dist/openapi.json",
    "preview": "redocly preview-docs openapi/openapi.yaml",
    "docs:bundle": "redocly bundle openapi/openapi.yaml -o docs/openapi.yaml",
    "docs:dev": "cd docs && mintlify dev",
    "harvest": "node scripts/harvest.mjs"
  },
  "devDependencies": { "@redocly/cli": "^1.25.0" }
}
```

**`redocly.yaml`** — y hệt reference: `extends: [recommended]`, đăng ký `apis.hayinsights@v0.1.0`,
bật mức `error` cho: `operation-operationId`, `operation-tag-defined`, `no-unused-components`,
`no-ambiguous-paths`, `operation-4xx-response`; `info-license: off`. → `npm run lint` là **gatekeeper**.

**CI** (`.github/workflows/`): chạy `npm ci && npm run lint && npm run bundle` mỗi PR (fail nếu lint ≠ 0 error).

**`scripts/harvest.mjs`** — đọc `HayInsights-openapi.postman_collection.json`, với mỗi request thay
`{{baseUrl}}`→staging, `{{apiKey}}`→`process.env.HAYINSIGHTS_API_KEY`, set giá trị mẫu cho path/query
bắt buộc, gọi GET, lưu `examples/<operationId>.json`. Output này là nguồn cho field `example:` trong spec.

---

## 10. Lộ trình thực thi theo phase (kèm checkpoint)

> Nguyên tắc: **lint xanh sau mỗi domain**, không dồn cuối. Mỗi phase có sản phẩm + checkpoint rõ ràng.

| Phase | Sản phẩm | Checkpoint / DoD |
|---|---|---|
| **0. Scaffold** | `git init`; `package.json`, `redocly.yaml`, `.nvmrc`, `.gitignore`; `openapi.yaml` shell (info/servers/security/tags); `HayInsightsApiKey`; `common/` (EnvelopeBase/ErrorBody/Meta/ErrorDetail); `responses/` + `headers/` lỗi dùng chung | `npm install` ok; `npm run lint` xanh (spec rỗng hợp lệ) |
| **1. Harvest** | `scripts/harvest.mjs`; chạy lấy **40** response thật vào `examples/` | Có đủ 40 file JSON; rà field nhạy cảm (không có) |
| **2. Author theo domain** | Lần lượt Commodities → Crypto → ETF → FX → Macro → Real Estate: path files + data schemas + enums + 40 wrapper response + `example` thật | Sau mỗi domain: `npm run lint` = 0 error; spot-check 1–2 endpoint khớp response thật |
| **3. Wire root** | Ghép 40 `$ref` vào `paths` (đúng thứ tự), tags + x-tagGroups + `x-hayinsights-quota`, `x-feature-code`/`x-api-weight` mỗi op | `npm run lint` 0 error; `npm run bundle` ra `dist/openapi.{yaml,json}` hợp lệ 3.1 |
| **4. Docs site** | `docs.json`, 7 trang `.mdx`, logo/favicon/màu; `npm run docs:bundle` | `npm run docs:dev` render đủ Guides + API Reference 40 endpoint |
| **5. Polish** | `x-codeSamples` (curl/TS/Python), `changelog`, `README(.en)`, CI workflow | Preview Redoc + Mintlify đẹp; CI xanh |
| **6. Review & handoff** | Rà soát 40 endpoint (param/enum/example/security/weight), checklist nghiệm thu | Toàn bộ DoD mục 12 đạt |

Ước lượng: Phase 0–1 nhanh; Phase 2 chiếm phần lớn công sức (40 endpoint × {path+schema+wrapper+example}),
nên chia nhỏ theo domain và có thể chạy song song nhiều domain.

---

## 11. Quyết định

### ✅ Đã chốt (2026-06-19)
1. **Ngôn ngữ tài liệu** → **English-primary**: toàn bộ `description`/`summary` trong spec và các trang
   `.mdx` viết tiếng Anh; giữ thêm `README.vi.md` (tùy chọn) cho người dùng VN.
2. **Examples** → **Harvest thật rồi tỉa gọn**: `scripts/harvest.mjs` gọi 40 endpoint staging lấy response
   thật, cắt bớt mảng dài (vd `trendline`, list quý) còn 2–3 phần tử đại diện.
3. **Phạm vi spec** → **Docs-first + codegen-ready**: schema chặt (kiểu/enum/`required`/`format` đầy đủ),
   đủ để vừa render docs vừa làm nguồn sinh SDK sau này.

### ⏳ Còn cần xác nhận / bổ sung (không chặn Phase 0–2)
4. **Repo đích**: xác nhận dựng ngay trong `hayinsight-openapi` này + `git init` + tạo remote GitHub.
5. **Server trong spec**: đề xuất để **cả prod + staging** (staging đánh dấu rõ) — chờ OK.
6. **Dữ liệu từ team** (cho trang `plans-and-features`): ma trận **plan → quota/phút** và **plan → feature**
   đầy đủ (đã thấy `X-RateLimit-Limit=1000` của key staging; cần bảng FREE/PRO/TEAM/BUSINESS/ENTERPRISE).
7. **Brand**: logo SVG + favicon + `colors.primary` của HayInsights (reference Finhay dùng `#00B14F`).

---

## 12. Definition of Done (nghiệm thu)

- [ ] `npm run lint` → **0 error** (mọi rule strict pass).
- [ ] `npm run bundle` → `dist/openapi.yaml` + `dist/openapi.json` hợp lệ OpenAPI **3.1**.
- [ ] Đủ **40 endpoint**, mỗi endpoint: `operationId` duy nhất · đúng `tag` · ≥1 response 4xx ·
      `example` lấy từ response thật · `x-feature-code` + `x-api-weight` đúng · params/enums đúng Postman ·
      security = `HayInsightsApiKey`.
- [ ] Envelope `{success,statusCode,data,meta}` + `ErrorBody` khớp staging (mục 3).
- [ ] `npm run docs:dev` render đủ Guides + API Reference (6 nhóm, 40 endpoint, "Try it" gắn `X-API-Key`).
- [ ] **Không commit secret**: API key chỉ qua env `HAYINSIGHTS_API_KEY`; `.env`/key staging nằm trong `.gitignore`.
- [ ] README mô tả quick start + cấu trúc + auth + license.

---

## 13. Lưu ý bảo mật

- **API key staging đã được cấp riêng cho việc harvest — KHÔNG ghi vào bất kỳ file nào trong repo.**
  Chỉ truyền qua biến môi trường `HAYINSIGHTS_API_KEY` khi chạy `scripts/harvest.mjs`.
- Thêm `.env`, `examples/raw/` (nếu chứa dữ liệu nhạy cảm) vào `.gitignore`.
- Trong docs/spec chỉ dùng key minh hoạ dạng `apk_xxx` (placeholder), không dùng key thật.
```
