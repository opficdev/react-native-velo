# react-native-velo

> 네이티브 이벤트가 몰릴 때 JS가 감당할 수 있는 만큼만 가져가게 하는 React Native 라이브러리
>
> 네이티브 producer가 넣은 이벤트를 C++ `BoundedQueue`에 모아 JS가 처리할 수 있는 만큼 묶어서 가져가는 구조

[![CI](https://github.com/opficdev/react-native-velo/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/opficdev/react-native-velo/actions/workflows/ci.yml)

## 프로젝트 개요

이벤트는 네이티브 producer의 `push`에서 시작해 `BoundedQueue`와 Nitro 하이브리드 객체를 거쳐 JS subscriber의 `onBatch`로 전달

| 영역 | 담당 | 위치 |
|---|---|---|
| 네이티브 producer | 받은 스트림에 직접 `push` | 사용하는 앱의 모듈 (예제: `example/producer/`) |
| C++ 공통 코어 | `BoundedQueue`의 건수와 바이트 제한, 신호 대기 판정 | `cpp/core/` |
| 연결 클래스 | 고정값(1024건, 16 MiB, `dropOldest`), 신호 경로, `Batch`를 `PullResult`로 변환 | `cpp/nitro/EventQueueCore` |
| Nitro 하이브리드 객체 | `EventQueue`를 Swift와 Kotlin으로 구현하고 둘 다 `EventQueueCore`를 호출 | `ios/`, `android/` |
| JS subscriber | `createEventStream`, `subscribe`의 `pull` 건수 결정과 양보, `connect` | `src/` |

```mermaid
flowchart LR
  subgraph Native["네이티브"]
    P["producer (Swift, Kotlin)"]
  end
  subgraph Core["C++ 공통 코어 (cpp/core)"]
    Q["BoundedQueue<br/>1024건, 16 MiB, dropOldest"]
  end
  subgraph Nitro["Nitro 연결부"]
    H["EventQueue<br/>하이브리드 객체"]
    E["EventQueueCore<br/>(cpp/nitro) 신호 경로"]
  end
  subgraph JS["JS"]
    S["subscribe<br/>pull 건수 결정과 양보"]
    C["onBatch"]
  end
  P -- "push" --> H
  H --> E
  E --> Q
  E -. "신호" .-> S
  S -- "pull" --> H
  S -- "PullResult" --> C
```

## 주요 기능

- 신호 한 번에 `pull` 한 번으로 JS가 처리할 수 있는 만큼만 가져가고 적체가 이어지면 `setTimeout(fn, 0)`으로 양보
- 건수와 바이트 상한(1024건, 16 MiB)을 둔 큐
  - 가득 차면 오래된 이벤트부터 폐기하고 폐기 건수는 `PullResult.dropped`로 전달

## 설치

- [Releases](https://github.com/opficdev/react-native-velo/releases)에서 설치할 버전을 골라 `<버전>`에 입력

```bash
npm install https://github.com/opficdev/react-native-velo/releases/download/<버전>/react-native-velo-<버전>.tgz react-native-nitro-modules@^0.37.1
```

- `react-native-nitro-modules`는 peer dependency라 함께 설치
- `peerDependencies` 범위
	- `react`: `*`
	- `react-native`: `^0.88.0`
	- `react-native-nitro-modules`: `^0.37.1`

## 사용 흐름

첫 사용은 producer 선언, 네이티브 `push`, JS 연결의 세 단계

- iOS는 설치 뒤 `ios/` 폴더에서 `pod install` 실행
- producer 모듈을 직접 만드는 경우 모듈이 라이브러리에 의존하도록 설정 필요

### 1. producer 선언

`EventQueue`를 받는 `start`와 `stop`을 가진 Nitro 모듈 선언

```ts
// example/producer/src/specs/example-producer.nitro.ts
import type { HybridObject } from 'react-native-nitro-modules';
import type { EventQueue } from 'react-native-velo/src/specs/event-queue.nitro';

export interface ExampleProducer extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
  // 스트림을 받아 생산 시작
  start(stream: EventQueue): void;
  // 생산 중단과 스트림 참조 해제
  stop(): void;
}
```

### 2. 네이티브 `push`

받은 스트림에 `push`

```swift
// example/producer/ios/HybridExampleProducer.swift
import EventStream
import Foundation
import NitroModules

final class HybridExampleProducer: HybridExampleProducerSpec {
  func start(stream: (any HybridEventQueueSpec)) throws {
    var count = UInt64(0)
    // ... 100ms마다 실행되는 타이머의 이벤트 핸들러 안
    count += 1
    // 이 파일에 버퍼 타입 이름이 없으면 push가 보이지 않아 타입 명시
    let buffer: CounterBuffer = makeCounterBuffer(count)
    // dispose된 큐의 push는 오류 없이 무시되므로 결과 확인 생략
    try? stream.push(data: buffer)
    // ...
  }
}
```

- Android producer는 Kotlin으로 같은 `start`와 `stop`을 구현하며 예제는 [`HybridExampleProducer.kt`](example/producer/android/src/main/java/com/margelo/nitro/exampleproducer/HybridExampleProducer.kt) 참고
- 주의: Swift에서 `EventStream`을 가져오는 파일은 `ArrayBuffer` 직접 사용 불가, `example/producer/ios/CounterBuffer.swift`의 별칭 사용
- 주의: 컴파일러 버전마다 거부하는 표기가 달라 이 별칭 사용, 원인은 확인 못함

### 3. JS 연결

`createEventStream`으로 만든 스트림에 subscriber와 producer 연결

```ts
// example/bench/runner.ts 발췌
const stream = createEventStream();
const unsubscribe = stream.subscribe(onBatch);
const disconnect = stream.connect(producer);
// 종료 시점에 unsubscribe()와 disconnect() 호출
```

- `onBatch`는 `PullResult`(`items`, `dropped`)를 받는 함수, `producer`는 1단계에서 선언한 모듈의 하이브리드 객체
- `subscribe`와 `connect`는 해제 함수를 반환, 호출 순서 제한 없음
- producer 모듈이 라이브러리에 의존하도록 설정 필요
	- iOS는 podspec에 `s.dependency 'EventStream'` 필요
	- Android는 `find_package(react-native-velo REQUIRED CONFIG)`와 `react-native-velo::EventStream` 링크와 Gradle의 `project(":react-native-velo")` 의존 필요
- 전체 흐름은 [`example/`](example)과 [`example/producer/`](example/producer)에서 확인 가능

## 핵심 성과

네이티브 producer가 보내는 이벤트를 JS가 따라가지 못하거나 JS 스레드가 오래 막힐 때를, 라이브러리를 쓰지 않은 Nitro 콜백 경로(B)와 이 라이브러리의 큐 경로(Q)로 비교한 결과

- 두 경로를 같은 앱 실행 안에서 번갈아 측정, 표의 값은 3회 중앙값이며 각 칸은 B / Q 순서
- `*`는 B와 Q의 3회 범위가 겹쳐 차이로 보지 않는 값
- 센서: 가속도계와 자이로스코프의 샘플 하나(128B), 200/s는 Android가 권한 없이 허용하는 상한
- 오디오 청크: 48kHz 32비트 스테레오 PCM을 20ms 단위로 자른 조각(7,680B), 50/s
- 서버 메시지: 채팅, 알림, 시세처럼 서버가 실시간으로 보내는 JSON 메시지(크기가 64B에서 수십 KB까지 섞여 평균 약 1.5KB), 5,000/s는 메시지가 한꺼번에 몰리는 경우
- 카메라: 카메라 영상 한 장(720p YUV420은 1,382,400B), 30/s는 30fps
- 핸들러: 가져온 이벤트를 처리하는 앱 코드
- Batch: 큐에서 한 번에 가져온 이벤트 묶음
- 양보: 처리 시간 한도에 닿으면 다른 JS 작업이 실행되도록 스레드를 비우는 동작
- 핸들러 오버: 핸들러가 이벤트 하나를 처리하는 시간을 발행 간격으로 나눈 값, 1을 넘으면 처리가 이벤트를 따라가지 못함
- JS 막힘: 핸들러와 무관한 작업이 JS 스레드를 막는 시간
- 루프 지연: 10ms 간격 JS 타이머가 예정보다 늦게 실행된 시간으로, JS 타이머 밀림의 지표
- 이벤트 지연: 이벤트 발행 시각부터 핸들러에서 처리가 시작되는 시각까지의 시간

### 1. 핸들러가 이벤트를 따라가지 못할 때 JS 타이머 밀림 감소

> **문제**: 핸들러가 이벤트 하나를 발행 간격보다 오래 처리하면 Nitro 콜백 경로에서 JS 스레드가 계속 점유되어 JS 타이머가 수 초에서 십수 초 지연
>
> **해결**: JS는 처리 시간 한도 안에서만 Batch를 가져가고 한도에 닿으면 양보
>
> **성과**: 핸들러 오버 1.2에서 루프 지연 상위 1% 감소
>
> - iOS: 11,996~12,100ms에서 14~110ms로
> - Android: 1,096~3,675ms에서 57~246ms로

| 이벤트 | 플랫폼 | 루프 지연 상위 1% (ms) B / Q | 이벤트 지연 상위 1% (ms) B / Q | 처리량 (건/초) B / Q | Q 폐기 (%) |
|---|---|---|---|---|---|
| 센서 128B, 200/s | iOS | 12,004 / 14 | 1,997 / 6,076 | 166 / 124 | 0 |
| 센서 128B, 200/s | Android | 2,090 / 113 | 2,337 / 5,882 | 164 / 127 | 0 |
| 서버 메시지 평균 약 1.5KB, 5,000/s | iOS | 12,100 / 23 | 2,093 / 307 | 4,128 / 3,032 | 37 |
| 서버 메시지 평균 약 1.5KB, 5,000/s | Android | 3,675 / 57 | 4,600 / 391 | 3,065 / 2,452 | 50 |
| 카메라 720p 1,382,400B, 30/s | iOS | 12,047 / 30 | 1,994 / 441 | 25 / 25* | 13 |
| 카메라 720p 1,382,400B, 30/s | Android | 1,096 / 115 | 1,114 / 563 | 9.2 / 19 | 32 |

- Q의 이점은 JS 타이머를 살리는 것이고 이벤트 지연과 처리량은 조합에 따라 갈림
	- 빈도가 높거나 이벤트가 큰 조합은 Q가 일부를 폐기하고 이벤트 지연도 감소
	- 센서 200/s와 오디오 청크처럼 빈도가 낮은 조합은 쌓인 양이 큐 상한에 못 미쳐 폐기 없이 이벤트 지연이 늘고 처리량이 저하
- 주의: 낮은 빈도에서 Q의 이벤트 지연이 길어지는 원인은 양보한 시간만큼 핸들러가 덜 도는 것으로 추정하며 확인 못함

### 2. JS가 오래 막혀도 이벤트 지연과 메모리를 큐 한도 안으로 제한

> **문제**: JS 스레드가 막힌 동안 쌓인 이벤트를 Nitro 콜백 경로는 막힘이 풀린 뒤 모두 처리해야 해서 지연과 메모리가 막힌 시간만큼 증가
>
> **해결**: `BoundedQueue`에 건수와 바이트 상한(1024건, 16 MiB)을 두고 가득 차면 오래된 이벤트부터 폐기하며 폐기 건수를 `PullResult.dropped`로 전달
>
> **성과**: 5초 막힘에서 이벤트 지연 중앙값 감소
>
> - 서버 메시지 5,000/s: iOS 3,121ms에서 0.03ms로, Android 3,135ms에서 0.71ms로
> - 카메라 720p 30/s: iOS 4,174ms에서 0.49ms로, Android 4,207ms에서 25ms로
> - iOS 메모리 증가: 서버 메시지 5,000/s는 32MB에서 0MB로, 카메라 720p는 46MB에서 0MB로

| 이벤트 | 플랫폼 | 이벤트 지연 중앙값 (ms) B / Q | 메모리 증가 (MB) B / Q | Q 폐기 (%) | B 한도 도달 |
|---|---|---|---|---|---|
| 센서 128B, 200/s | iOS | 1,971 / 1,973* | 0.48 / 1.1* | 0 | 0/3 |
| 센서 128B, 200/s | Android | 1,992 / 1,993* | 1.2 / 1.0* | 0 | 0/3 |
| 서버 메시지 평균 약 1.5KB, 5,000/s | iOS | 3,121 / 0.03 | 32 / 0.00 | 56 | 3/3 |
| 서버 메시지 평균 약 1.5KB, 5,000/s | Android | 3,135 / 0.71 | 1.6 / 8.1* | 56 | 3/3 |
| 카메라 720p 1,382,400B, 30/s | iOS | 4,174 / 0.49 | 46 / 0.00 | 52 | 3/3 |
| 카메라 720p 1,382,400B, 30/s | Android | 4,207 / 25 | 30 / 31* | 50 | 3/3 |

- 막힌 동안 쌓이는 양이 큐 상한을 넘는 조합(초당 1,000건 이상의 센서와 서버 메시지, 카메라)에서만 차이, 센서 200/s처럼 상한 아래의 조합은 B와 동일
- 표에 없는 센서 1,000/s와 서버 메시지 1,000/s, 카메라 VGA(460,800B)도 같은 경향이며 이벤트 지연 중앙값이 iOS는 2,575ms 이하에서 0.10~75ms로, Android는 2,548ms 이하에서 16~67ms로 감소
- 대가로 이벤트의 38~56%를 폐기, 폐기 건수는 `PullResult.dropped`로 확인
- B 한도 도달: 측정 도구가 B의 처리 대기 한도(2만 건 또는 64MB)에 닿아 발행을 멈춘 실행 수, 한도가 없는 앱에서는 처리 대기가 계속 증가
- 메모리는 iOS에서만 차이, Android는 3회 범위가 겹침
- 700ms 막힘은 서버 메시지 5,000/s와 카메라 720p에서만 차이
	- 서버 메시지 5,000/s의 이벤트 지연 상위 1%는 iOS 675ms에서 184ms로, Android 686ms에서 194ms로 감소
	- 카메라 720p의 이벤트 지연 상위 1%는 iOS 680ms에서 376ms로, Android 684ms에서 379ms로 감소
- 50ms 막힘은 Android 오디오 청크 50/s의 이벤트 지연 상위 1%만 217ms에서 86ms로 감소
- 주의: 측정 도구의 한도가 없던 Android 실행에서 B가 카메라 720p와 5초 막힘 조합에서 `OutOfMemoryError`로 앱 종료, 한 번의 기록

### 효과가 없거나 오히려 나쁜 조건

- 처리가 이벤트를 따라가는 조건(핸들러 오버 0.5와 0.9, 50ms 막힘)은 B와 비슷
	- iOS는 처리량이 같고 이벤트 지연 중앙값 차이가 0.06ms 이내
	- Android는 일부 조합에서 Q가 B보다 악화
		- 핸들러 오버 0.9의 센서 200/s는 처리량이 200건/초에서 154건/초로, 이벤트 지연 상위 1%가 149ms에서 3,192ms로 악화
		- 핸들러 오버 0.5의 서버 메시지 5,000/s는 Q가 6.7%를 폐기하고 B는 폐기 없이 처리
	- 주의: Android에서 처리가 따라가는 조건의 Q 악화 원인은 확인 못함
- Batch마다 고정 비용(8ms)이 드는 핸들러는 Q가 JS 타이머를 막음(iOS만 측정)
	- 센서 200/s와 1,000/s, 서버 메시지 1,000/s에서 루프 지연 상위 1%가 B 약 8ms, Q 약 10,000ms
	- 주의: B는 단건 전달이라 Batch 고정 비용을 내지 않아 두 경로의 조건이 같지 않음
	- 주의: 원인은 확인 못함. 양보 규칙 때문이라면 라이브러리 쪽 문제

### 측정 조건

| 항목 | 내용 |
|---|---|
| 기기 | iOS는 iPhone 18 Pro 시뮬레이터(iOS 27.0), Android는 `velo_example` 에뮬레이터(Android 16) |
| 빌드 | Release |
| 이벤트 | 센서(가속도·자이로 샘플) 128B 100/s·200/s·1,000/s, 오디오 청크(48kHz 32비트 스테레오 PCM) 20ms 7,680B 50/s와 100ms 38,400B 10/s, 서버 메시지(JSON, 크기 혼합) 평균 약 1.5KB 100/s·1,000/s·5,000/s, 카메라(YUV420 영상 한 장) VGA 460,800B와 720p 1,382,400B 30/s |
| 핸들러 오버 | 0.5, 0.9, 1.2, JS 막힘 없음 |
| JS 막힘 | 50ms, 700ms, 5초를 2초 간격으로, 가벼운 핸들러 |
| 구간 | 워밍업 2초, 측정 8초, 조합당 3회, 회차마다 B와 Q의 순서를 섞음 |
| 규모 | 이벤트 10종 × (핸들러 오버 3단계 + JS 막힘 3단계) = 60조합, 플랫폼당 360회 |

### 측정의 한계

- 주의: 시뮬레이터와 에뮬레이터에서만 측정해 실제 앱의 JS 부하와 UI 프레임 영향은 확인 못함
- 주의: 센서 128B, 오디오 청크 길이, 서버 메시지의 크기 분포는 근거 자료 없이 정한 가정
- 주의: 핸들러 오버 0.5, 0.9, 1.2와 JS 막힘 50ms, 700ms, 5초는 부하 시험 관행과 Android 기준을 빌린 값이며 실제 앱이 이런 오버로드를 얼마나 자주 겪는지는 측정 안 함
- 주의: B와 Q를 같은 프로세스에서 연속 실행해 메모리 비교는 대략적인 값
- 주의: `subscribe`의 내부 상수는 장치에서 정하지 않음

## 기술 스택

| 구분 | 내용 |
|---|---|
| 언어 | TypeScript 6.0.3, Swift, Kotlin, C++ |
| 런타임 의존 | `react`(`*`), `react-native`(`^0.88.0`), `react-native-nitro-modules`(`^0.37.1`) (`peerDependencies`) |
| 확인된 빌드 환경 | React Native 0.88.0, React 19.3.0, `react-native-nitro-modules` 0.37.1 |
| 코드 생성 | `nitrogen` 0.37.1 |
| 빌드 | `react-native-builder-bob` 0.40.18 |
| 정적 검사 | ESLint 10.13.0, Prettier 3.9.10, SwiftLint 0.65.1, ktlint 1.8.0, clang-format 23.1.3 |
| 자동화 | GitHub Actions, `mise`(Node 24.22.0, Java temurin 21, Ruby 4.0.7), `npm`, `Makefile` |

- `react-native`와 `react-native-nitro-modules`의 범위는 배포물에 들어간 `nitrogen` 0.37.1의 생성 코드와 빌드를 확인한 React Native 0.88.0에 맞춘 값
- iOS는 `min_ios_version_supported`를 따르며 React Native 0.88.0에서는 15.1
- Android는 라이브러리 기본값(`EventStream_minSdkVersion`)이 23이고 예제 앱의 `minSdkVersion`이 24
- 주의: visionOS 1.0은 podspec에 선언만 있고 visionOS와 Android SDK 23 빌드는 CI에서 미확인
- 네이티브 producer는 iOS에서 Swift, Android에서 Kotlin으로 구현
- 배포물에 Nitro 생성 코드(`nitrogen/`)와 빌드 결과(`lib/`) 포함, 사용 앱의 코드 생성 실행 불필요

## 한계

- 큐 크기(1024건, 16 MiB)와 가득 찼을 때의 정책은 측정으로 정하지 않은 고정값, 설정 API 없음
- 큐가 가득 차면 오래된 이벤트부터 버려 손실이 허용되지 않는 데이터에는 부적합
	- 버린 건수만 `PullResult.dropped`로 확인 가능하고 버린 이벤트는 복구 불가
	- 가득 찼을 때 producer에 `push` 중단을 알리는 방법 없음
- 스트림당 producer 하나와 subscriber 하나만 지원
- npm 레지스트리에 올라가 있지 않아 `npm install react-native-velo`로 설치 불가
- `^0.1.0` 같은 버전 범위로 자동 업데이트 불가, 버전마다 URL 변경
- JS가 이벤트를 따라가는 조건에서는 B와 차이가 거의 없고 일부 조합은 오히려 이벤트 지연이 늘어남, [효과가 없거나 오히려 나쁜 조건](#효과가-없거나-오히려-나쁜-조건) 참고
- 측정 조건의 한계는 [측정의 한계](#측정의-한계) 참고

## 라이선스

MIT
