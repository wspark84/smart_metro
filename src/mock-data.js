export const STOP_LIBRARY = [
  {
    id: "GWANGHWAMUN",
    name: "광화문역",
    subtitle: "서울 종로구 세종대로",
    stopCode: "1002-11",
    lat: 37.5717,
    lng: 126.9769,
    lines: [
      {
        id: "1002",
        number: "1002",
        label: "광역버스",
        destination: "강남",
        rideMin: 43,
        arrivalsMin: [5, 22],
        headwayMin: 17,
      },
      {
        id: "701",
        number: "701",
        label: "간선버스",
        destination: "서울역",
        rideMin: 34,
        arrivalsMin: [9, 18],
        headwayMin: 12,
      },
      {
        id: "7212",
        number: "7212",
        label: "지선버스",
        destination: "대방역",
        rideMin: 39,
        arrivalsMin: [14, 28],
        headwayMin: 14,
      },
    ],
  },
  {
    id: "CITY_HALL",
    name: "시청역",
    subtitle: "서울 중구 세종대로",
    stopCode: "7010-22",
    lat: 37.5658,
    lng: 126.9779,
    lines: [
      {
        id: "500",
        number: "500",
        label: "간선버스",
        destination: "신당동",
        rideMin: 41,
        arrivalsMin: [6, 19],
        headwayMin: 13,
      },
      {
        id: "103",
        number: "103",
        label: "간선버스",
        destination: "월계동",
        rideMin: 47,
        arrivalsMin: [10, 25],
        headwayMin: 15,
      },
    ],
  },
];

export const SOUND_PRESETS = [
  {
    id: "mechanical",
    name: "Mechanical Siren",
    detail: "기계식 경고음이 짧고 강하게 반복됩니다.",
    loopCount: 4,
    loopGap: 0.08,
    pattern: [
      { offset: 0, duration: 0.08, frequency: 980, gain: 0.28, type: "square" },
      { offset: 0.1, duration: 0.08, frequency: 740, gain: 0.3, type: "square" },
      { offset: 0.2, duration: 0.08, frequency: 980, gain: 0.28, type: "square" },
      { offset: 0.3, duration: 0.08, frequency: 740, gain: 0.3, type: "square" },
    ],
  },
  {
    id: "energetic",
    name: "Energetic Melody",
    detail: "밝고 빠르게 울리는 일반 알림음입니다.",
    loopCount: 1,
    loopGap: 0,
    pattern: [
      { offset: 0, duration: 0.12, frequency: 740, gain: 0.18, type: "sine" },
      { offset: 0.18, duration: 0.12, frequency: 880, gain: 0.2, type: "sine" },
      { offset: 0.36, duration: 0.16, frequency: 988, gain: 0.22, type: "sine" },
    ],
  },
  {
    id: "calm",
    name: "Calm Chime",
    detail: "부드럽게 울리는 차임 소리입니다.",
    loopCount: 1,
    loopGap: 0,
    pattern: [
      { offset: 0, duration: 0.16, frequency: 523, gain: 0.12, type: "sine" },
      { offset: 0.3, duration: 0.2, frequency: 659, gain: 0.12, type: "sine" },
    ],
  },
  {
    id: "strong",
    name: "Strong Alarm",
    detail: "낮은 톤으로 강하게 울리는 일반 경고음입니다.",
    loopCount: 2,
    loopGap: 0.12,
    pattern: [
      { offset: 0, duration: 0.12, frequency: 392, gain: 0.24, type: "square" },
      { offset: 0.16, duration: 0.12, frequency: 392, gain: 0.24, type: "square" },
      { offset: 0.32, duration: 0.12, frequency: 311, gain: 0.26, type: "square" },
      { offset: 0.48, duration: 0.12, frequency: 311, gain: 0.26, type: "square" },
    ],
  },
];

export const TTS_VOICES = [
  { id: "ko-female", label: "한국어 여성", preferredGender: "female" },
  { id: "ko-male", label: "한국어 남성", preferredGender: "male" },
];

export const REPEAT_PRESETS = [
  { id: "WEEKDAYS", label: "평일만", description: "월요일부터 금요일까지 출근 알림" },
  { id: "DAILY", label: "매일", description: "주말 포함 매일 반복" },
  { id: "WEEKENDS", label: "주말만", description: "토요일과 일요일만 알림" },
  { id: "CUSTOM", label: "커스텀", description: "원하는 요일만 직접 선택" },
];

export const DAY_OPTIONS = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
  { value: 0, label: "일" },
];
