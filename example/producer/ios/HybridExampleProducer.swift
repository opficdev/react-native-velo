//
//  HybridExampleProducer.swift
//  ExampleProducer
//
//  Created by opfic on 2026/10/20.
//

import EventStream
import Foundation
import NitroModules

// 받은 스트림에 100ms마다 8바이트 카운터를 넣는 예제 생산자
final class HybridExampleProducer: HybridExampleProducerSpec {
  // stream과 timer는 queue에서만 접근
  private let queue = DispatchQueue(label: "ExampleProducer")
  private var stream: (any HybridEventQueueSpec)?
  private var timer: DispatchSourceTimer?

  func start(stream: (any HybridEventQueueSpec)) throws {
    queue.sync {
      timer?.cancel()
      self.stream = stream
      var count = UInt64(0)
      let source = DispatchSource.makeTimerSource(queue: queue)
      source.schedule(deadline: .now(), repeating: .milliseconds(100))
      source.setEventHandler { [weak self] in
        guard let stream = self?.stream else {
          return
        }
        count += 1
        // 이 파일에 버퍼 타입 이름이 없으면 push가 보이지 않아 타입 명시
        let buffer: CounterBuffer = makeCounterBuffer(count)
        // dispose된 큐의 push는 오류 없이 무시되므로 결과 확인 생략
        try? stream.push(data: buffer)
      }
      timer = source
      source.resume()
    }
  }

  func stop() throws {
    queue.sync {
      timer?.cancel()
      timer = nil
      stream = nil
    }
  }
}
