//
//  FrameMonitor.swift
//  ExampleProducer
//
//  Created by opfic on 2026/10/21.
//

import Foundation
import QuartzCore
import UIKit

// 메인 스레드의 화면 갱신 시각을 기록하는 모니터
final class FrameMonitor: NSObject {
  // 120Hz 기준 1시간 분량
  private static let capacity = 120 * 3600
  // 아래 값은 lock 안에서만 접근
  private let lock = NSLock()
  private var times = [Double]()
  private var worst = 0
  private var overflow = false
  private var firstSkewMs = 0.0
  private var generation = 0
  // 아래 값은 메인 스레드에서만 접근
  private var link: CADisplayLink?

  struct Record {
    let times: [Double]
    let thermalWorst: String
    let overflow: Bool
    let firstSkewMs: Double
  }

  // 이전 기록 폐기와 메인 스레드 표시 링크 등록
  func start() {
    lock.lock()
    generation += 1
    let current = generation
    times.removeAll(keepingCapacity: true)
    times.reserveCapacity(120 * 120)
    worst = 0
    overflow = false
    firstSkewMs = 0
    lock.unlock()
    // 메인 스레드가 JS 스레드를 기다릴 수 있어 main.sync 대신 비동기 등록
    DispatchQueue.main.async { [self] in
      link?.invalidate()
      link = nil
      lock.lock()
      let stale = generation != current
      lock.unlock()
      if stale {
        return
      }
      let next = CADisplayLink(target: self, selector: #selector(tick(_:)))
      let rate = Float(UIScreen.main.maximumFramesPerSecond)
      next.preferredFrameRateRange = CAFrameRateRange(
        minimum: rate,
        maximum: rate,
        preferred: rate
      )
      next.add(to: .main, forMode: .common)
      link = next
    }
  }

  func stop() {
    lock.lock()
    generation += 1
    lock.unlock()
    DispatchQueue.main.async { [self] in
      link?.invalidate()
      link = nil
    }
  }

  func read() -> Record {
    lock.lock()
    defer { lock.unlock() }
    let names = ["nominal", "fair", "serious", "critical"]
    return Record(
      times: times,
      thermalWorst: names[min(worst, names.count - 1)],
      overflow: overflow,
      firstSkewMs: firstSkewMs
    )
  }

  @objc private func tick(_ link: CADisplayLink) {
    let stamp = link.timestamp * 1e9
    let state = ProcessInfo.processInfo.thermalState.rawValue
    lock.lock()
    defer { lock.unlock() }
    if times.isEmpty {
      firstSkewMs = (Double(benchNowNs()) - stamp) / 1e6
    }
    if times.count < Self.capacity {
      times.append(stamp)
    } else {
      overflow = true
    }
    worst = max(worst, state)
  }
}
