//
//  CounterBuffer.swift
//  ExampleProducer
//
//  Created by opfic on 2026/10/20.
//

import NitroModules

// 카운터 값을 담은 버퍼의 타입 별칭
// EventStream을 import한 파일에서는 ArrayBuffer와 NitroModules.ArrayBuffer 표기가 컴파일러 버전마다 오류를 내 이 파일에 분리
typealias CounterBuffer = ArrayBuffer

// 카운터 값을 담은 8바이트 소유 버퍼
func makeCounterBuffer(_ count: UInt64) -> CounterBuffer {
  let buffer = CounterBuffer.allocate(size: 8)
  UnsafeMutableRawPointer(buffer.data).storeBytes(of: count, as: UInt64.self)
  return buffer
}
