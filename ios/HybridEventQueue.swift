//
//  HybridEventQueue.swift
//  Velo
//
//  Created by opfic on 2026/10/20.
//

import NitroModules

// 네이티브 제한 큐를 통해 이벤트를 JS로 전달하는 스트림
// 큐와 신호 상태는 C++ 공유 연결부 EventQueueCore가 소유
final class HybridEventQueue: HybridEventQueueSpec {
  private let core = margelo.nitro.velo.EventQueueCore()

  func setSignalListener(listener: (() -> Void)?) throws {
    guard let listener else {
      core.clearSignalListener()
      return
    }
    margelo.nitro.velo.setSignalListener(
      core,
      SwiftClosure(wrappingClosure: listener)
    )
  }

  func pull(maxCount: Double) throws -> PullResult {
    guard margelo.nitro.velo.EventQueueCore.validMaxCount(maxCount) else {
      throw RuntimeError.error(withMessage: "maxCount must be an integer greater than or equal to 1")
    }
    return core.pull(maxCount)
  }

  func push(data: ArrayBuffer) throws {
    core.push(data.getArrayBuffer())
  }

  func dispose() {
    core.dispose()
  }
}
