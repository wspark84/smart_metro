import { fetchTagoCities, getBusApiConfig, searchLiveStations, searchLiveStationRoutes } from "./bus-providers.mjs";
import { getPlaceApiConfig, searchAddressPlaces } from "./place-providers.mjs";
import { searchTagoNearbyStations } from "./tago-api.mjs";
import { fetchUnifiedBusCities, searchUnifiedBusStations } from "./unified-bus.mjs";

export const TRANSIT_LOOKUP_PATHS = new Set(["/api/bus/stations","/api/bus/nearby-stations","/api/bus/station-routes","/api/bus/cities","/api/places/search","/api/bus/config","/api/places/config"]);
export async function transitLookup(url) {
  const input = Object.fromEntries(url.searchParams);
  switch(url.pathname) {
    case "/api/bus/config": return getBusApiConfig();
    case "/api/places/config": return getPlaceApiConfig(process.env);
    case "/api/bus/stations": return {...await (input.provider === "auto" ? searchUnifiedBusStations(input) : searchLiveStations(input)),source:"live",fetchedAt:new Date().toISOString()};
    case "/api/bus/nearby-stations": {
      if (input.provider !== "tago") throw new Error("지도 주변 정류장 검색은 전국 버스에서 지원합니다.");
      return { provider: "tago", stations: await searchTagoNearbyStations({ serviceKey: process.env.TAGO_SERVICE_KEY, lat: input.lat, lng: input.lng }),
        radiusMeters: 500, source: "live", fetchedAt: new Date().toISOString() };
    }
    case "/api/bus/station-routes": return {...await searchLiveStationRoutes(input),source:"live",fetchedAt:new Date().toISOString()};
    case "/api/places/search": return {query:input.query || "",results:await searchAddressPlaces(input.query || "",process.env),fetchedAt:new Date().toISOString()};
    case "/api/bus/cities": {
      if (input.provider === "auto") return fetchUnifiedBusCities();
      if (input.provider !== "tago" || !["stops","arrivals"].includes(input.service || "stops")) throw new Error("지원하지 않는 도시 목록 조회입니다.");
      return {provider:"tago",cities:await fetchTagoCities({serviceKey:process.env.TAGO_SERVICE_KEY,service:input.service || "stops"})};
    }
    default: throw new Error("지원하지 않는 검색입니다.");
  }
}
