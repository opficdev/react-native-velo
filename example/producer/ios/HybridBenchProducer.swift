//
//  HybridBenchProducer.swift
//  ExampleProducer
//
//  Created by opfic on 2026/10/20.
//

import EventStream
import Foundation
import NitroModules

// 일정한 속도로 이벤트를 만들어 큐 경로나 콜백 경로로 보내는 측정용 생산자
final class HybridBenchProducer: HybridBenchProducerSpec {
  // 아래 값은 lock 안에서만 접근
  private let lock = NSLock()
  private var size = 1024
  private var perSecond = 1000
  private var durationMs = 10_000
  private var generator: BenchGenerator?

  func configure(
    size: Double,
    perSecond: Double,
    durationMs: Double
  ) throws {
    lock.lock()
    defer { lock.unlock() }
    self.size = Int(size)
    self.perSecond = Int(perSecond)
    self.durationMs = Int(durationMs)
  }

  func start(stream: (any HybridEventQueueSpec)) throws {
    lock.lock()
    defer { lock.unlock() }
    generator?.stop()
    // 이 파일에 버퍼 타입 이름이 없으면 push가 보이지 않아 타입 명시
    let next = BenchGenerator(
      size: size,
      perSecond: perSecond,
      durationMs: durationMs
    ) { (buffer: BenchBuffer) in
      // dispose된 큐의 push는 오류 없이 무시되므로 결과 확인 생략
      try? stream.push(data: buffer)
    }
    generator = next
    next.start()
  }

  func stop() throws {
    lock.lock()
    defer { lock.unlock() }
    generator?.stop()
  }

  func startCallback(onEvent: @escaping (_ data: BenchBuffer) -> Void) throws {
    lock.lock()
    defer { lock.unlock() }
    generator?.stop()
    let next = BenchGenerator(
      size: size,
      perSecond: perSecond,
      durationMs: durationMs,
      sink: onEvent
    )
    generator = next
    next.start()
  }

  func stopCallback() throws {
    lock.lock()
    defer { lock.unlock() }
    generator?.stop()
  }

  func finished() throws -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return generator?.isFinished ?? true
  }

  func readStats(
    fromNs: Double,
    toNs: Double
  ) throws -> BenchStats {
    lock.lock()
    defer { lock.unlock() }
    guard let result = generator?.stats(fromNs: UInt64(fromNs), toNs: UInt64(toNs)) else {
      return BenchStats(
        emitted: 0,
        windowEmitted: 0,
        windowLate: 0,
        costP50Ns: 0,
        costP99Ns: 0,
        costMaxNs: 0
      )
    }
    let sorted = result.costs.sorted()
    let last = sorted.count - 1
    return BenchStats(
      emitted: Double(result.emitted),
      windowEmitted: Double(result.costs.count),
      windowLate: Double(result.late),
      costP50Ns: sorted.isEmpty ? 0 : Double(sorted[last / 2]),
      costP99Ns: sorted.isEmpty ? 0 : Double(sorted[Int(Double(last) * 0.99)]),
      costMaxNs: sorted.isEmpty ? 0 : Double(sorted[last])
    )
  }

  func burst(
    stream: (any HybridEventQueueSpec),
    size: Double,
    count: Double
  ) throws {
    for index in 0..<Int(count) {
      let buffer: BenchBuffer = makeBenchBuffer(
        size: Int(size),
        tEmit: Double(benchNowNs()),
        seq: Double(index)
      )
      try stream.push(data: buffer)
    }
  }

  func pushCost(
    stream: (any HybridEventQueueSpec),
    size: Double,
    count: Double
  ) throws -> Double {
    var buffers = [BenchBuffer]()
    for index in 0..<Int(count) {
      buffers.append(
        makeBenchBuffer(
          size: Int(size),
          tEmit: Double(benchNowNs()),
          seq: Double(index)
        )
      )
    }
    var costs = [UInt64]()
    for buffer in buffers {
      let begin = benchNowNs()
      try stream.push(data: buffer)
      costs.append(benchNowNs() - begin)
    }
    costs.sort()
    return Double(costs[costs.count / 2])
  }

  func nowNs() throws -> Double {
    Double(benchNowNs())
  }

  func memoryBytes() throws -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let status = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { raw in
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), raw, &count)
      }
    }
    return status == KERN_SUCCESS ? Double(info.phys_footprint) : 0
  }

  func appendResult(line: String) throws {
    let directory = try FileManager.default.url(
      for: .documentDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let url = directory.appendingPathComponent("bench-results.jsonl")
    let data = Data((line + "\n").utf8)
    if let handle = try? FileHandle(forWritingTo: url) {
      defer { try? handle.close() }
      try handle.seekToEnd()
      try handle.write(contentsOf: data)
    } else {
      try data.write(to: url)
    }
  }
}
