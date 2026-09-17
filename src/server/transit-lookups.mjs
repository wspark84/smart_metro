import { fetchTagoCities, getBusApiConfig, searchLiveStations, searchLiveStationRoutes } from "./bus-providers.mjs";
import { getPlaceApiConfig, searchAddressPlaces } from "./place-providers.mjs";

export const TRANSIT_LOOKUP_PATHS = new Set(["/api/bus/stations","/api/bus/station-routes","/api/bus/cities","/api/places/search","/api/bus/config","/api/places/config"]);
export async function transitLookup(url) {
  const input = Object.fromEntries(url.searchParams);
  switch(url.pathname) {
    case "/api/bus/config": return getBusApiConfig();
    case "/api/places/config": return getPlaceApiConfig(process.env);
    case "/api/bus/stations": return {...await searchLiveStations(input),source:"live",fetchedAt:new Date().toISOString()};
    case "/api/bus/station-routes": return {...await searchLiveStationRoutes(input),source:"live",fetchedAt:new Date().toISOString()};
    case "/api/places/search": return {query:input.query || "",results:await searchAddressPlaces(input.query || "",process.env),fetchedAt:new Date().toISOString()};
    case "/api/bus/cities": {
      if (input.provider !== "tago" || !["stops","arrivals"].includes(input.service || "stops")) throw new Error("지원하지 않는 도시 목록 조회입니다.");
      return {provider:"tago",cities:await fetchTagoCities({serviceKey:process.env.TAGO_SERVICE_KEY,service:input.service || "stops"})};
    }
    default: throw new Error("지원하지 않는 검색입니다.");
  }
}
