let sdkPromise = null;

function loadKakaoMapSdk(appKey) {
  if (window.kakao?.maps) {
    return Promise.resolve(window.kakao.maps);
  }
  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=${encodeURIComponent(appKey)}`;
    script.onload = () => {
      if (!window.kakao?.maps) {
        reject(new Error("Kakao Maps SDK loaded without the maps namespace."));
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao.maps));
    };
    script.onerror = () => reject(new Error("Could not load the Kakao Maps SDK."));
    document.head.append(script);
  });
  return sdkPromise;
}

function isCoordinate(value) {
  return Number.isFinite(Number(value?.lat)) && Number.isFinite(Number(value?.lng));
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
    element.textContent = "Kakao Maps JavaScript key is not configured. Address coordinates are saved, but the interactive map cannot be shown yet.";
    element.dataset.mapStatus = "missing-key";
    return;
  }

  const coordinates = [home, stop, work].filter(isCoordinate);
  if (!coordinates.length) {
    element.textContent = "Select an address or a stop with coordinates to display the commute map.";
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
      [home, "Home"],
      [stop, "Boarding stop"],
      [work, "Work"],
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
      element.textContent = error instanceof Error ? error.message : "Could not render the Kakao commute map.";
      element.dataset.mapStatus = "error";
    }
  }
}
