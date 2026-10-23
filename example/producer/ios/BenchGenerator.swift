//
//  BenchGenerator.swift
//  ExampleProducer
//
//  Created by opfic on 2026/10/20.
//

import Foundation
import NitroModules

// 단조 시계(ns)
func benchNowNs() -> UInt64 {
  clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
}

// 측정 구간에서 발행한 이벤트의 통계
struct BenchWindow {
  let emitted: Int
  let late: Int
  let costs: [UInt32]
}

// 콜백 경로의 처리 대기 한도
struct BenchCallbackLimit {
  let maxEvents: Int
  let maxBytes: Int
}

// 일정한 속도로 버퍼를 만들어 sink에 넘기는 생성기
// 전용 스레드 실행
// 먼 예정 시각은 sleep 대기 뒤 마지막 200µs 이상 스핀 대기
final class BenchGenerator {
  private let payload: BenchPayload
  private let perSecond: Int
  private let durationNs: UInt64
  private let done = DispatchSemaphore(value: 0)
  // 아래 값의 쓰기 스레드는 생성기 스레드
  // 아래 값의 읽기 시점은 stop 이후
  private var sink: ((BenchBuffer) -> Void)?
  private var starts = [UInt64]()
  private var costs = [UInt32]()
  private var lates = [Bool]()
  private var emitted = 0
  // 발행한 이벤트 바이트의 누적 합
  // 인덱스 n은 앞 n건의 합
  private var cumulativeBytes = [0]
  private let limit: BenchCallbackLimit?
  // 아래 값은 cancelLock 안에서만 접근
  private var cancelled = false
  private let cancelLock = NSLock()
  private var finishedFlag = false
  // JS가 알린 받은 이벤트 수
  private var acked = 0
  private var limitReachedFlag = false

  init(
    payload: BenchPayload,
    perSecond: Int,
    durationMs: Int,
    limit: BenchCallbackLimit? = nil,
    sink: @escaping (BenchBuffer) -> Void
  ) {
    self.payload = payload
    self.perSecond = perSecond
    self.durationNs = UInt64(durationMs) * 1_000_000
    self.limit = limit
    self.sink = sink
    let capacity = perSecond * (durationMs / 1000 + 2)
    starts.reserveCapacity(capacity)
    costs.reserveCapacity(capacity)
    lates.reserveCapacity(capacity)
    cumulativeBytes.reserveCapacity(capacity + 1)
  }

  var isFinished: Bool {
    cancelLock.lock()
    defer { cancelLock.unlock() }
    return finishedFlag
  }

  // 처리 대기 한도로 발행을 멈췄는지 여부
  var limitReached: Bool {
    cancelLock.lock()
    defer { cancelLock.unlock() }
    return limitReachedFlag
  }

  // JS가 받은 이벤트 수 갱신
  func ack(count: Int) {
    cancelLock.lock()
    acked = count
    cancelLock.unlock()
  }

  func start() {
    let thread = Thread { [self] in
      run()
    }
    thread.qualityOfService = .userInteractive
    thread.start()
  }

  // 생성기 중단과 스레드 종료 대기
  // 종료 뒤 sink 참조 해제
  func stop() {
    cancelLock.lock()
    cancelled = true
    cancelLock.unlock()
    done.wait()
    done.signal()
    sink = nil
  }

  // [fromNs, toNs) 구간에 발행한 이벤트의 통계
  func stats(
    fromNs: UInt64,
    toNs: UInt64
  ) -> BenchWindow {
    var windowCosts = [UInt32]()
    var late = 0
    for index in 0..<starts.count where fromNs <= starts[index] && starts[index] < toNs {
      windowCosts.append(costs[index])
      if lates[index] {
        late += 1
      }
    }
    return BenchWindow(
      emitted: emitted,
      late: late,
      costs: windowCosts
    )
  }

  private func isCancelled() -> Bool {
    cancelLock.lock()
    defer { cancelLock.unlock() }
    return cancelled
  }

  // 발행 수가 JS가 받은 수보다 한도 넘게 앞섰는지 여부
  private func overLimit() -> Bool {
    guard let limit else {
      return false
    }
    cancelLock.lock()
    let received = min(acked, emitted)
    cancelLock.unlock()
    return limit.maxEvents < emitted - received
      || limit.maxBytes < cumulativeBytes[emitted] - cumulativeBytes[received]
  }

  private func run() {
    let interval = UInt64(1_000_000_000 / perSecond)
    let begin = benchNowNs()
    var index = UInt64(0)
    while !isCancelled() {
      let scheduled = begin + index * interval
      if durationNs <= scheduled - begin {
        break
      }
      while true {
        let now = benchNowNs()
        if scheduled <= now {
          break
        }
        let remaining = scheduled - now
        if 300_000 < remaining {
          usleep(UInt32((remaining - 200_000) / 1000))
        }
      }
      let tEmit = benchNowNs()
      let buffer = makeBenchBuffer(
        payload: payload,
        tEmit: Double(tEmit),
        index: index
      )
      sink?(buffer)
      let after = benchNowNs()
      starts.append(tEmit)
      costs.append(UInt32(truncatingIfNeeded: after - tEmit))
      lates.append(1_000_000 <= tEmit - scheduled)
      cumulativeBytes.append(cumulativeBytes[emitted] + payload.size(at: index))
      emitted += 1
      index += 1
      if overLimit() {
        cancelLock.lock()
        limitReachedFlag = true
        cancelLock.unlock()
        break
      }
    }
    cancelLock.lock()
    finishedFlag = true
    cancelLock.unlock()
    done.signal()
  }
}
