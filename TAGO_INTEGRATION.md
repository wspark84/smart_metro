# TAGO 버스도착정보 및 정류소정보 연결

2026-09-15, 제공받은 버스도착정보 및 버스정류소정보 v1.0 활용가이드 기준으로 반영. 대표님이 두 API의 동일 인증키 및 승인 완료를 확인함.

## 반영한 API 계약

| 용도 | TAGO operation | 필수값 |
| --- | --- | --- |
| 정류장 전체 도착정보 | `getSttnAcctoArvlPrearngeInfoList` | serviceKey, cityCode, nodeId |
| 특정 노선 도착정보 | `getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList` | 위 값 + routeId |
| 지원 도시코드 조회 | `getCtyCodeList` | serviceKey |
| 정류장 이름·번호 검색 | `getSttnNoList` | serviceKey, cityCode, nodeNm 또는 nodeNo |
| 정류장 경유노선 | `getSttnThrghRouteList` | serviceKey, cityCode, nodeid |

- 서비스 주소: `https://apis.data.go.kr/1613000/ArvlInfoInqireService/`.
- 인증키는 서버의 `TAGO_SERVICE_KEY`에서 읽고, `_type=json`으로 요청한다.
- `routeId`가 저장되어 있으면 특정 노선 API를 우선 사용한다. 노선번호만 저장된 기존 설정은 전체 도착정보에서 선택하며, 동일 번호의 서로 다른 노선이 있으면 선택을 요구한다.
- `arrtime`은 초 단위다. 내부 `arrivalsMin`은 `arrtime / 60`으로 소수점을 보존한다. 예: 816초 → 13.6분. 화면 표시와 달리 지각 계산에서는 반올림하지 않는다.
- 두 개 이후의 도착편도 보존하여 마지막 정시 도착편을 계산한다. `totalCount`, `pageNo`, `numOfRows`를 확인하고 여러 페이지를 읽는다.
- 페이지 수는 최대 10, 전체 조회 시간은 최대 15초다. 초과하거나 페이지 정보가 어긋나면 일부 결과로 단정하지 않고 오류를 반환한다. 조회 도중 전체 개수가 바뀌어도 다시 조회하도록 처리한다.
- HTTP 200이어도 `header.resultCode`를 검사한다. JSON 요청에 XML로 반환되는 공공데이터포털 게이트웨이 오류도 처리한다. 인증키/승인/요청한도/만료/IP 오류를 구분하며 인증키를 오류 메시지에 넣지 않는다.
- 운행정보가 없거나 도착시간이 잘못된 경우 임의로 0분 도착편을 만들지 않는다.
- 정류소 서비스 주소: `https://apis.data.go.kr/1613000/BusSttnInfoInqireService/`. 두 서비스는 같은 `TAGO_SERVICE_KEY`를 사용하며 추가 환경변수는 필요 없다.
- 도시코드 서버 조회 경로: 로그인 후 `GET /api/bus/cities?provider=tago&service=stops`. 응답은 `cities: [{ cityCode, cityName }]`. 도시목록은 서버에서 24시간 캐시한다. 웹과 모바일의 도시 선택 메뉴에 연결했다. 도착정보의 도시목록은 기존 `service=arrivals`를 사용한다.
- 정류장 검색: `GET /api/bus/stations?provider=tago&cityCode=...&keyword=...`. 숫자만 입력하면 `nodeNo`, 나머지는 `nodeNm`으로 검색한다.
- 경유노선 검색: `GET /api/bus/station-routes?provider=tago&cityCode=...&nodeId=...`. 서버에서 제공기관 요청값을 소문자 `nodeid`로 변환한다. 도착정보 요청은 대문자 I가 있는 `nodeId`를 사용한다.
- 도시·정류장 변경 시 이전 노선 선택을 지우고, 지연된 이전 검색 결과가 새 결과를 덮어쓰지 않도록 처리했다. 정류장 좌표는 지도·목적지 경로 연결용이며 집→정류장 이동시간을 지각 계산에 추가하지 않는다.
- 기점·종점은 노선 정보다. 이것만으로 현재 진행 방향을 확정하지 않는다. 동명 정류장은 고유번호별로 구분해 표시한다.
- 가이드의 좌표 기반 반경 500m 정류장 검색은 이번 이름 검색·경유노선 연결 범위에 포함하지 않았다.

## 실제 운영 연결에 필요한 작업

1. 공공데이터포털에서 **국토교통부_(TAGO)_버스도착정보** 활용 상태가 승인되었는지 확인한다.
2. Vercel의 smart-metro 프로젝트 → Settings → Environment Variables에서 `TAGO_SERVICE_KEY`를 추가한다. 값은 **일반 인증키(Decoding)**. `Production`에 적용하고 비밀값으로 저장한다. `VITE_`나 `NEXT_PUBLIC_` 접두사는 붙이지 않는다. 채팅이나 GitHub에 키를 게시하지 않는다.
3. 코드 변경과 환경변수가 반영되도록 운영 버전을 다시 배포한다. 이 문서 작성 시점의 코드 수정은 배포 완료를 의미하지 않는다.
4. 도시코드 API로 실제 지원 지역을 확인한다. 수원 코드나 지원 여부를 지역명만 보고 추정하지 않는다.
5. 앱의 도시 선택 → 정류장 이름 검색 → 경유노선 선택을 이용해 `nodeId`와 `routeId`를 자동 입력한다. 경기버스 정류장 번호나 안내판 번호를 TAGO nodeId와 같은 값으로 가정하지 않는다.
6. `수원 / 더샵광교레이크시티.광교호반베르디움 / 1번`의 정확한 정류장·방향·노선이 맞는지 실제 응답으로 대조한다. 실제 값은 확인 전까지 저장하지 않는다.
7. 도착정보와 별개로, 선택한 정류장부터 목적지까지의 이동시간과 목적지 도착 시각이 있어야 지각 여부를 판단할 수 있다. 집→정류장 이동시간은 계산에서 제외한다.

## 검증 범위

`tests/tago-contract.test.mjs`는 문서 예제와 모의 응답으로 초 단위 처리, 특정 노선 선택, 페이지 처리, 도시코드, JSON/XML 오류, 비밀값 보호를 검사한다. 테스트 통과는 운영 인증키의 승인, 수원 데이터 제공, 실제 운행 도착시간 정확성을 보증하지 않는다. 이 항목들은 운영 키 설정 후 별도로 확인해야 한다.
