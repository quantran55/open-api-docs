// Harvest real responses from the HayInsights Open API into examples/<operationId>.json.
// These feed the trimmed `example:` blocks embedded in the spec's path files.
//
// Usage:
//   HAYINSIGHTS_API_KEY=apk_xxx node scripts/harvest.mjs
//   HAYINSIGHTS_BASE_URL=https://stg-api.hayinsights.com (default) node scripts/harvest.mjs
//
// The API key is read from the environment only — never hard-code or commit it.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = process.env.HAYINSIGHTS_BASE_URL ?? 'https://stg-api.hayinsights.com';
const KEY = process.env.HAYINSIGHTS_API_KEY;

if (!KEY) {
  console.error('Missing HAYINSIGHTS_API_KEY env var.');
  process.exit(1);
}

// [operationId, request path under the host] — sample path/query values chosen
// to return representative data. Keep in sync with the 40-endpoint inventory.
const ENDPOINTS = [
  // Commodities
  ['commoditiesList', '/openapi/v1/commodities'],
  ['commoditiesFeatured', '/openapi/v1/commodities/featured'],
  ['commoditiesMovers', '/openapi/v1/commodities/movers'],
  ['commoditiesGoldDxy', '/openapi/v1/commodities/gold-dxy'],
  ['commoditiesHistory', '/openapi/v1/commodities/gold/history'],
  // Crypto
  ['cryptoOverview', '/openapi/v1/crypto'],
  ['cryptoBubbleMap', '/openapi/v1/crypto/bubble-map'],
  ['cryptoOnchain', '/openapi/v1/crypto/onchain'],
  ['cryptoDerivatives', '/openapi/v1/crypto/derivatives'],
  ['cryptoDominance', '/openapi/v1/crypto/dominance'],
  // ETF
  ['etfList', '/openapi/v1/etf'],
  ['etfTopPerformance', '/openapi/v1/etf/top-performance'],
  ['etfTopNetflow', '/openapi/v1/etf/top-netflow'],
  ['etfHeatmap', '/openapi/v1/etf/heatmap'],
  ['etfCompareFundComposition', '/openapi/v1/etf/compare/fund-composition?codes=VESAF,VEOF'],
  ['etfCompareNavGrowth', '/openapi/v1/etf/compare/nav-growth?code1=1305&code2=1306'],
  ['etfNavGrowth', '/openapi/v1/etf/nav-growth/VNDAF'],
  ['etfInfo', '/openapi/v1/etf/1306/info'],
  ['etfHoldings', '/openapi/v1/etf/1306/holdings'],
  ['etfPricesHistory', '/openapi/v1/etf/1306/prices-history'],
  ['etfDetail', '/openapi/v1/etf/1306/detail'],
  ['etfComposition', '/openapi/v1/etf/VESAF/composition'],
  // FX
  ['fxSummary', '/openapi/v1/fx/summary'],
  ['fxTable', '/openapi/v1/fx/table'],
  ['fxCorrelation', '/openapi/v1/fx/correlation'],
  ['fxEmStress', '/openapi/v1/fx/em-stress'],
  // Macro
  ['macroGdpGrowthRate', '/openapi/v1/macro/gdp-growth-rate'],
  ['macroMarketRecap', '/openapi/v1/macro/market-recap'],
  ['macroEconomicData', '/openapi/v1/macro/economic-data?type=gdp'],
  ['macroExchangeRate', '/openapi/v1/macro/exchange-rate?currency1=USD&currency2=JPY'],
  ['macroPopulation', '/openapi/v1/macro/population'],
  ['macroCentralGovernmentDebt', '/openapi/v1/macro/monetary-policy/central-government-debt'],
  ['macroRatesYields', '/openapi/v1/macro/monetary-policy/rates-yields'],
  // Real Estate
  ['realEstateCountrySummary', '/openapi/v1/real-estate/vn'],
  ['realEstateGeoJson', '/openapi/v1/real-estate/vn/geojson'],
  ['realEstateStats', '/openapi/v1/real-estate/vn/stats'],
  ['realEstateWards', '/openapi/v1/real-estate/vn/wards'],
  ['realEstateWardDetail', '/openapi/v1/real-estate/vn/wards/1'],
  ['realEstateLandPrices', '/openapi/v1/real-estate/vn/land-prices'],
  ['realEstateProvinces', '/openapi/v1/real-estate/vn/provinces'],
];

const OUT = 'examples';
await mkdir(OUT, { recursive: true });

let ok = 0;
let bad = 0;
for (const [id, path] of ENDPOINTS) {
  try {
    const res = await fetch(BASE + path, { headers: { 'X-API-Key': KEY } });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    await writeFile(join(OUT, `${id}.json`), JSON.stringify(body, null, 2));
    const size = Buffer.byteLength(text);
    console.log(`${String(res.status).padEnd(3)}  ${id.padEnd(28)}  ${size}b  ${path}`);
    if (res.ok) ok++;
    else bad++;
  } catch (e) {
    console.error(`ERR  ${id.padEnd(28)}  ${path}  ${e.message}`);
    bad++;
  }
}
console.log(`\nDone: ${ok} ok, ${bad} non-2xx/err, ${ENDPOINTS.length} total → ${OUT}/`);
