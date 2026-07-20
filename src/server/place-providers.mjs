import { fetchWithTimeout } from "./upstream-fetch.mjs";

const KAKAO_LOCAL_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";
const KAKAO_LOCAL_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";

const DEMO_ADDRESS_LIBRARY = [
  {
    id: "demo-home-sejong",
    label: "서울 종로구 세종대로 175",
    roadAddress: "서울 종로구 세종대로 175",
    jibunAddress: "서울 종로구 세종로 1-68",
    placeName: "광화문광장",
    provider: "demo",
    lat: 37.5725,
    lng: 126.9769,
  },
  {
    id: "demo-work-pangyo",
    label: "경기 성남시 분당구 판교역로 166",
    roadAddress: "경기 성남시 분당구 판교역로 166",
    jibunAddress: "경기 성남시 분당구 백현동 535",
    placeName: "카카오 판교아지트",
    provider: "demo",
    lat: 37.3951,
    lng: 127.1107,
  },
  {
    id: "demo-cityhall",
    label: "서울 중구 세종대로 110",
    roadAddress: "서울 중구 세종대로 110",
    jibunAddress: "서울 중구 태평로1가 31",
    placeName: "서울시청",
    provider: "demo",
    lat: 37.5663,
    lng: 126.9779,
  },
  {
    id: "demo-gangnam",
    label: "서울 강남구 테헤란로 212",
    roadAddress: "서울 강남구 테헤란로 212",
    jibunAddress: "서울 강남구 역삼동 735-11",
    placeName: "강남역 인근",
    provider: "demo",
    lat: 37.4987,
    lng: 127.0317,
  },
];

function normalizeAddressResult(item, provider = "kakao") {
  const lat = Number(item?.lat ?? item?.y);
  const lng = Number(item?.lng ?? item?.x);
  return {
    id: String(item?.id || `${provider}-${item?.roadAddress || item?.address_name || item?.place_name || ""}`).trim(),
    label: String(
      item?.label ||
        item?.roadAddress ||
        item?.road_address?.address_name ||
        item?.address_name ||
        item?.address?.address_name ||
        item?.place_name ||
        "",
    ).trim(),
    roadAddress: String(item?.roadAddress || item?.road_address?.address_name || "").trim(),
    jibunAddress: String(item?.jibunAddress || item?.address?.address_name || item?.address_name || "").trim(),
    placeName: String(item?.placeName || item?.place_name || item?.road_address?.building_name || "").trim(),
    provider,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

function dedupeAddressResults(results) {
  const seen = new Set();
  return results.filter((item) => {
    const key = `${item.label}|${item.lat}|${item.lng}`;
    if (!item.label || item.lat === null || item.lng === null || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function getPlaceApiConfig(env = {}) {
  const kakaoApiKey = String(env.KAKAO_LOCAL_REST_API_KEY || "").trim();
  const kakaoJavascriptKey = String(env.KAKAO_JAVASCRIPT_KEY || "").trim();
  return {
    providers: {
      kakao: {
        id: "kakao",
        label: "Kakao Local REST API",
        configured: Boolean(kakaoApiKey),
        reason: kakaoApiKey
          ? "Kakao Local REST API key is configured."
          : "Set KAKAO_LOCAL_REST_API_KEY to search real addresses through Kakao Local.",
      },
      demo: {
        id: "demo",
        label: "Demo address library",
        configured: true,
        reason: "Built-in sample addresses are always available as a fallback.",
      },
    },
    maps: {
      kakao: {
        configured: Boolean(kakaoJavascriptKey),
        javascriptKey: kakaoJavascriptKey,
        reason: kakaoJavascriptKey
          ? "Kakao Maps JavaScript key is configured."
          : "Set KAKAO_JAVASCRIPT_KEY and register this web domain in Kakao Developers to render the interactive map.",
      },
    },
  };
}

export async function searchAddressPlaces(query, env = {}, fetchImpl = fetch) {
  const keyword = String(query || "").trim();
  if (!keyword) {
    throw new Error("A search query is required.");
  }

  const kakaoApiKey = String(env.KAKAO_LOCAL_REST_API_KEY || "").trim();
  if (!kakaoApiKey) {
    return searchDemoAddressPlaces(keyword);
  }

  const headers = { Authorization: `KakaoAK ${kakaoApiKey}` };
  const [addressResponse, keywordResponse] = await Promise.all([
    fetchWithTimeout(
      `${KAKAO_LOCAL_ADDRESS_URL}?query=${encodeURIComponent(keyword)}`,
      { headers },
      { fetchImpl },
    ),
    fetchWithTimeout(
      `${KAKAO_LOCAL_KEYWORD_URL}?query=${encodeURIComponent(keyword)}&size=8`,
      { headers },
      { fetchImpl },
    ),
  ]);

  const addressPayload = await addressResponse.json();
  const keywordPayload = await keywordResponse.json();

  if (!addressResponse.ok) {
    throw new Error(addressPayload.msg || addressPayload.errorType || "Kakao address search failed.");
  }

  if (!keywordResponse.ok) {
    throw new Error(keywordPayload.msg || keywordPayload.errorType || "Kakao keyword search failed.");
  }

  const addressResults = Array.isArray(addressPayload.documents)
    ? addressPayload.documents.map((item) => normalizeAddressResult(item, "kakao"))
    : [];
  const keywordResults = Array.isArray(keywordPayload.documents)
    ? keywordPayload.documents.map((item) => normalizeAddressResult(item, "kakao"))
    : [];

  return dedupeAddressResults([...addressResults, ...keywordResults]).slice(0, 8);
}

export function searchDemoAddressPlaces(query) {
  const keyword = String(query || "").trim().toLowerCase();
  return DEMO_ADDRESS_LIBRARY.filter((item) => {
    if (!keyword) {
      return true;
    }

    return `${item.label} ${item.roadAddress} ${item.jibunAddress} ${item.placeName}`.toLowerCase().includes(keyword);
  }).slice(0, 8);
}
