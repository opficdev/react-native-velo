#pragma once

#include <NitroModules/ArrayBuffer.hpp>
#include <cstddef>
#include <deque>
#include <memory>
#include <mutex>
#include <vector>

#include "Batch.hpp"
#include "FullPolicy.hpp"

namespace eventstream::core {

// 건수와 바이트로 크기를 제한하는 큐
// 항목 보관, 정책 적용, 건수 누적, 신호 판단의 단일 잠금 처리
// 임의 스레드의 생산자 push 전제
// 한 스레드의 소비자 pull 전제
class BoundedQueue {
 public:
  // maxCount나 maxBytes가 0일 때 std::invalid_argument 발생
  BoundedQueue(size_t maxCount, size_t maxBytes, FullPolicy policy);

  BoundedQueue(const BoundedQueue&) = delete;
  BoundedQueue& operator=(const BoundedQueue&) = delete;

  // 항목을 넣고 신호 필요 여부를 돌려주는 호출
  // 소유한 버퍼는 복사 없이 보관
  // 빌려온 버퍼는 호출 스레드에서 복사해 보관
  // nullptr 버퍼와 data()가 nullptr인 버퍼는 보관과 dropped 집계 제외
  [[nodiscard]] bool push(std::shared_ptr<margelo::nitro::ArrayBuffer> buffer);

  // 앞에서부터 최대 maxCount건을 꺼내는 호출
  // 직전 pull 이후 버린 건수 포함
  [[nodiscard]] Batch pull(size_t maxCount);

  // pauseProducer 정책에서 생산자를 멈춰야 하는 상태 여부
  [[nodiscard]] bool paused() const;

  // 보낸 신호를 JS가 아직 pull로 받지 않은 상태 여부
  [[nodiscard]] bool signalPending() const;

 private:
  using Buffer = std::shared_ptr<margelo::nitro::ArrayBuffer>;

  struct Entry {
    Buffer buffer;
    size_t size;
  };

  bool fits(size_t size) const;
  void evictFront(std::vector<Buffer>& evicted);

  const size_t maxCount_;
  const size_t maxBytes_;
  const FullPolicy policy_;

  mutable std::mutex mutex_;
  std::deque<Entry> entries_;
  size_t bytes_ = 0;
  size_t dropped_ = 0;
  bool signalPending_ = false;
  bool paused_ = false;
};

}  // namespace eventstream::core
