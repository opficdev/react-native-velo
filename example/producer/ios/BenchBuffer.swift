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

// 크기 표와 JSON 템플릿을 따르는 소유 버퍼
// 앞 16바이트에 발행 시각과 순번을 담는 구조
func makeBenchBuffer(
  payload: BenchPayload,
  tEmit: Double,
  index: UInt64
) -> BenchBuffer {
  let size = payload.size(at: index)
  let buffer = BenchBuffer.allocate(size: size)
  let base = UnsafeMutableRawPointer(buffer.data)
  base.storeBytes(of: tEmit, as: Double.self)
  base.storeBytes(of: Double(index), toByteOffset: 8, as: Double.self)
  let body = base + 16
  let length = size - 16
  if payload.template.isEmpty {
    memset(body, 0x5A, length)
    return buffer
  }
  let cut = payload.cut(at: index)
  payload.template.withUnsafeBytes { source in
    body.copyMemory(from: source.baseAddress!, byteCount: cut)
  }
  body.storeBytes(of: 0x5D, toByteOffset: cut, as: UInt8.self)
  memset(body + cut + 1, 0x20, length - cut - 1)
  return buffer
}

// Double 배열을 담은 소유 버퍼
func makeDoubleBuffer(_ values: [Double]) -> BenchBuffer {
  let buffer = BenchBuffer.allocate(size: values.count * 8)
  if !values.isEmpty {
    values.withUnsafeBytes { source in
      UnsafeMutableRawPointer(buffer.data).copyMemory(from: source.baseAddress!, byteCount: source.count)
    }
  }
  return buffer
}
