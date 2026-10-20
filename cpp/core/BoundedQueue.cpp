#include "BoundedQueue.hpp"

#include <algorithm>
#include <stdexcept>
#include <utility>

namespace velo::core {

using margelo::nitro::ArrayBuffer;

BoundedQueue::BoundedQueue(size_t maxCount, size_t maxBytes, FullPolicy policy)
    : maxCount_(maxCount), maxBytes_(maxBytes), policy_(policy) {
  if (maxCount == 0 || maxBytes == 0) {
    throw std::invalid_argument("maxCount and maxBytes must be greater than 0");
  }
}

bool BoundedQueue::push(Buffer buffer) {
  if (buffer == nullptr) {
    return false;
  }
  // 원본이 사라질 수 있는 빌려온 버퍼의 잠금 전 호출 스레드 복사
  if (!buffer->isOwner()) {
    if (buffer->data() == nullptr) {
      return false;
    }
    buffer = ArrayBuffer::copy(buffer);
  }
  const size_t size = buffer->size();

  // 잠금을 푼 뒤 해제할 밀려난 버퍼의 잠금 범위 밖 보관
  // 해제 함수의 잠금 안 실행 방지
  std::vector<Buffer> evicted;
  bool shouldSignal = false;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (maxBytes_ < size) {
      // 어느 정책으로도 보관할 수 없는 크기
      // 기존 항목 유지
      ++dropped_;
    } else {
      switch (policy_) {
        case FullPolicy::dropOldest:
          while (!entries_.empty() && !fits(size)) {
            evictFront(evicted);
          }
          entries_.push_back({std::move(buffer), size});
          bytes_ += size;
          break;
        case FullPolicy::dropNewest:
          if (fits(size)) {
            entries_.push_back({std::move(buffer), size});
            bytes_ += size;
          } else {
            ++dropped_;
          }
          break;
        case FullPolicy::latest:
          if (!entries_.empty()) {
            evictFront(evicted);
          }
          entries_.push_back({std::move(buffer), size});
          bytes_ += size;
          break;
        case FullPolicy::pauseProducer:
          if (fits(size)) {
            entries_.push_back({std::move(buffer), size});
            bytes_ += size;
            if (entries_.size() == maxCount_ || bytes_ == maxBytes_) {
              paused_ = true;
            }
          } else {
            ++dropped_;
            paused_ = true;
          }
          break;
      }
    }
    // 보관 또는 버림으로 JS가 가져갈 항목이 생긴 상태
    shouldSignal = !signalPending_;
    signalPending_ = true;
  }
  return shouldSignal;
}

Batch BoundedQueue::pull(size_t maxCount) {
  Batch batch;
  std::lock_guard<std::mutex> lock(mutex_);
  const size_t count = std::min(maxCount, entries_.size());
  batch.items.reserve(count);
  for (size_t index = 0; index < count; ++index) {
    Entry& front = entries_.front();
    bytes_ -= front.size;
    batch.items.push_back(std::move(front.buffer));
    entries_.pop_front();
  }
  batch.dropped = std::exchange(dropped_, 0);
  batch.hasMore = !entries_.empty();
  // 남은 항목이 있을 때 호출자의 신호 재전송
  // 비었을 때 다음 push의 신호 전송
  signalPending_ = batch.hasMore;
  if (entries_.empty()) {
    paused_ = false;
  }
  return batch;
}

bool BoundedQueue::paused() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return paused_;
}

bool BoundedQueue::fits(size_t size) const {
  // 뺄셈 비교를 통한 bytes_ + size 넘침 방지
  return entries_.size() < maxCount_ && size <= maxBytes_ - bytes_;
}

void BoundedQueue::evictFront(std::vector<Buffer>& evicted) {
  Entry& front = entries_.front();
  bytes_ -= front.size;
  evicted.push_back(std::move(front.buffer));
  entries_.pop_front();
  ++dropped_;
}

}  // namespace velo::core
