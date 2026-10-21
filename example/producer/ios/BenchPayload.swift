//
//  BenchPayload.swift
//  ExampleProducer
//
//  Created by opfic on 2026/10/21.
//

import Foundation

// 이벤트 크기 표와 JSON 템플릿
// 순번을 표 길이로 나눈 나머지 위치의 크기 사용
struct BenchPayload {
  // 비어 있으면 고정 크기 사용
  let sizes: [Int]
  let fixedSize: Int
  // 비어 있으면 0x5A 채우기
  let template: [UInt8]
  // 표 위치별로 템플릿에서 복사할 길이
  // 고정 크기는 원소 하나
  let cuts: [Int]

  static func fixed(size: Int) -> BenchPayload {
    BenchPayload(
      sizes: [],
      fixedSize: size,
      template: [],
      cuts: []
    )
  }

  // 16바이트 뒤를 레코드 배열 JSON으로 채우는 페이로드
  // 크기마다 레코드 경계까지만 복사하고 `]` 뒤를 공백으로 채워 유효한 JSON 유지
  static func json(
    sizes: [Int],
    fixedSize: Int
  ) -> BenchPayload {
    let longest = (sizes.max() ?? fixedSize) - 16
    var template = Array("[".utf8)
    // 레코드 k건까지의 템플릿 길이
    var ends = [1]
    var id = 0
    while ends[ends.count - 1] < longest {
      if 0 < id {
        template.append(0x2C)
      }
      let record = "{\"id\":\(id),\"name\":\"event-\(id)\",\"values\":[\(id % 7),\(id % 11),\(id % 13),\(id % 17),\(id % 19),\(id % 23)]}"
      template.append(contentsOf: record.utf8)
      ends.append(template.count)
      id += 1
    }
    let cuts = (sizes.isEmpty ? [fixedSize] : sizes).map { size -> Int in
      // ends[k] + 1 <= size - 16 을 만족하는 가장 큰 k 탐색
      var low = 0
      var high = ends.count - 1
      while low < high {
        let mid = (low + high + 1) / 2
        if ends[mid] + 1 <= size - 16 {
          low = mid
        } else {
          high = mid - 1
        }
      }
      return ends[low]
    }
    return BenchPayload(
      sizes: sizes,
      fixedSize: fixedSize,
      template: template,
      cuts: cuts
    )
  }

  func size(at index: UInt64) -> Int {
    sizes.isEmpty ? fixedSize : sizes[Int(index % UInt64(sizes.count))]
  }

  func cut(at index: UInt64) -> Int {
    cuts[sizes.isEmpty ? 0 : Int(index % UInt64(sizes.count))]
  }
}
