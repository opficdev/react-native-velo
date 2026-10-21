import { Platform } from 'react-native';

// 소비자와 분포 조합마다 경로 B가 밀리지 않고 따라가는 최대 발행 속도(초당)
// 플랫폼마다 보정 결과를 옮겨 적는 표
const rates: Record<string, Record<string, number>> = {
  ios: {
    'parse-sensor': 20000,
    'parse-audio': 20000,
    'parse-socket': 20000,
    'setState-sensor': 20000,
    'setState-socket': 20000,
    'fixedCost-8-sensor': 9494,
    'fixedCost-16-sensor': 9494,
  },
  android: {
    'parse-sensor': 3000,
    'parse-audio': 6962,
    'parse-socket': 4219,
    'setState-sensor': 3000,
    'setState-socket': 5805,
    'fixedCost-8-sensor': 3000,
    'fixedCost-16-sensor': 3000,
  },
};

export function calibratedRate(id: string) {
  const rate = rates[Platform.OS]?.[id];
  if (rate === undefined) {
    throw new Error(`보정 값 없음 ${Platform.OS} ${id}`);
  }
  return rate;
}
