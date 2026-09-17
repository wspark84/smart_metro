import { isValidLocation } from "../logic/commute.js";
let sdkPromise = null;

function loadKakaoMapSdk(appKey) {
  if (window.kakao?.maps?.Map) {
    return Promise.resolve(window.kakao.maps);
  }
  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("지도 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.")), 15000);
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=${encodeURIComponent(appKey)}`;
    script.onload = () => {
      if (!window.kakao?.maps) {
        window.clearTimeout(timer);
        reject(new Error("카카오 지도 연결을 완료하지 못했습니다. 지도 키와 등록 도메인을 확인해 주세요."));
        return;
      }
      window.kakao.maps.load(() => { window.clearTimeout(timer); resolve(window.kakao.maps); });
    };
    script.onerror = () => { window.clearTimeout(timer); reject(new Error("지도를 불러오지 못했습니다. 지도 키와 등록 도메인을 확인해 주세요.")); };
    document.head.append(script);
  });
  sdkPromise = sdkPromise.catch(error => { sdkPromise = null; throw error; });
  return sdkPromise;
}

export async function mountKakaoBoardingMap(element, {appKey, candidates, selectedId, onSelect}) {
  if (!element?.isConnected) return;
  const points = candidates.map((item,index) => ({...item,index,lat:item.posY ?? item.lat,lng:item.posX ?? item.lng})).filter(isCoordinate);
  if (!appKey || !points.length) {
    element.textContent = !appKey ? "지도 연결 키가 없습니다. 카카오 지도 설정을 확인해 주세요." : "공식 좌표가 없어 위치를 확인할 수 없습니다. 다른 검색 결과를 선택해 주세요.";
    element.dataset.mapStatus = "unavailable";
    return;
  }
  element.dataset.mapStatus = "loading";
  try {
    const maps = await loadKakaoMapSdk(appKey);
    if (!element.isConnected) return;
    element.textContent = "";
    const selected = points.find(item => String(item.stationId) === String(selectedId));
    const center = selected || points[0];
    const map = new maps.Map(element,{center:new maps.LatLng(Number(center.lat),Number(center.lng)),level:selected ? 3 : 5});
    const bounds = new maps.LatLngBounds();
    for (const item of points) {
      const position = new maps.LatLng(Number(item.lat),Number(item.lng));
      const marker = new maps.Marker({position,map,title:`${item.index+1}. ${item.displayName || item.stationName} ${item.stationNumber || item.arsId || ""}`});
      maps.event.addListener(marker,"click",()=>onSelect(String(item.stationId)));
      const label = document.createElement("button");
      label.type = "button";
      label.className = `boarding-map-label ${String(item.stationId) === String(selectedId) ? "selected" : ""}`;
      label.textContent = `${item.index+1}. ${item.stationName}`;
      label.addEventListener("click",()=>onSelect(String(item.stationId)));
      new maps.CustomOverlay({position,content:label,map,yAnchor:2.2});
      bounds.extend(position);
    }
    if (!selected && points.length > 1) map.setBounds(bounds);
    element.dataset.mapStatus = "ready";
  } catch {
    if (element.isConnected) {
      element.textContent = "지도를 불러오지 못했습니다. 인터넷 연결과 카카오 지도 도메인 설정을 확인하고 다시 검색해 주세요.";
      element.dataset.mapStatus = "error";
    }
  }
}

function isCoordinate(value) {
  return isValidLocation(value);
}

function buildMarker(maps, map, coordinate, title) {
  const position = new maps.LatLng(Number(coordinate.lat), Number(coordinate.lng));
  const marker = new maps.Marker({ position, title });
  marker.setMap(map);
  return position;
}

export async function mountKakaoCommuteMap(element, { appKey, home, stop, work }) {
  if (!element || !element.isConnected) {
    return;
  }
  if (!appKey) {
    element.textContent = "카카오 지도 키가 설정되지 않았습니다. 주소 좌표는 저장되지만 지도는 아직 표시할 수 없습니다.";
    element.dataset.mapStatus = "missing-key";
    return;
  }

  const coordinates = [home, stop, work].filter(isCoordinate);
  if (!coordinates.length) {
    element.textContent = "지도를 표시하려면 좌표가 있는 주소나 탑승 지점을 선택해 주세요.";
    element.dataset.mapStatus = "missing-coordinates";
    return;
  }

  try {
    const maps = await loadKakaoMapSdk(appKey);
    if (!element.isConnected) {
      return;
    }
    element.textContent = "";
    const map = new maps.Map(element, {
      center: new maps.LatLng(Number(coordinates[0].lat), Number(coordinates[0].lng)),
      level: 6,
    });
    const bounds = new maps.LatLngBounds();
    [
      [home, "집"],
      [stop, "탑승 정류장·역"],
      [work, "목적지"],
    ].forEach(([coordinate, title]) => {
      if (!isCoordinate(coordinate)) return;
      bounds.extend(buildMarker(maps, map, coordinate, title));
    });
    if (coordinates.length > 1) {
      map.setBounds(bounds);
    }
    element.dataset.mapStatus = "ready";
  } catch (error) {
    if (element.isConnected) {
      element.textContent = error instanceof Error ? error.message : "카카오 지도를 표시하지 못했습니다.";
      element.dataset.mapStatus = "error";
    }
  }
}
