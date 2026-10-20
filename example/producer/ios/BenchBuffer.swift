//
//  BenchBuffer.swift
//  ExampleProducer
//
//  Created by opfic on 2026/10/20.
//

import Foundation
import NitroModules

// 측정용 이벤트 버퍼의 타입 별칭
// EventStream을 import한 파일에서는 ArrayBuffer와 NitroModules.ArrayBuffer 표기가 컴파일러 버전마다 오류를 내 이 파일에 분리
typealias BenchBuffer = ArrayBuffer

// 앞 16바이트에 발행 시각과 순번을 담고 나머지를 채운 소유 버퍼
// 채우지 않은 페이지가 메모리에 잡히지 않는 문제로 인한 전체 채우기
func makeBenchBuffer(
  size: Int,
  tEmit: Double,
  seq: Double
) -> BenchBuffer {
  let buffer = BenchBuffer.allocate(size: size)
  let base = UnsafeMutableRawPointer(buffer.data)
  base.storeBytes(of: tEmit, as: Double.self)
  base.storeBytes(of: seq, toByteOffset: 8, as: Double.self)
  memset(base + 16, 0x5A, size - 16)
  return buffer
}
