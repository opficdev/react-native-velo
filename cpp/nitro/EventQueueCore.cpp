#include "EventQueueCore.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <mutex>
#include <utility>
#include <vector>

#include "BoundedQueue.hpp"

namespace margelo::nitro::velo {

namespace {

using BoundedQueue = ::velo::core::BoundedQueue;
using FullPolicy = ::velo::core::FullPolicy;

// 큐 생성 값의 고정 상수
// 스트림 생성 시 설정은 래퍼 이슈의 범위
constexpr size_t defaultMaxCount = 1024;
constexpr size_t defaultMaxBytes = 16 * 1024 * 1024;

// JS 숫자가 정수로 정확히 표현되는 최댓값
constexpr double maxSafeCount = 9007199254740991.0;

}  // namespace

class EventQueueCore::State {
 public:
  State() : queue_(defaultMaxCount, defaultMaxBytes, FullPolicy::dropOldest) {}

  void push(const std::shared_ptr<ArrayBuffer>& data) {
    if (disposed_) {
      return;
    }
    if (queue_.push(data)) {
      signal();
    }
  }

  PullResult pull(double maxCount) {
    auto batch =
        queue_.pull(static_cast<size_t>(std::min(maxCount, maxSafeCount)));
    // 남은 항목에 대한 신호 재전송
    if (batch.hasMore) {
      signal();
    }
    return PullResult(std::move(batch.items),
                      static_cast<double>(batch.dropped));
  }

  void setSignalListener(std::function<void()> listener) {
    std::function<void()> previous;
    bool shouldSignal = false;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      previous = std::exchange(listener_, std::move(listener));
      // 이전 콜백으로 가던 신호와 등록 전에 쌓인 신호의 새 콜백 전달
      shouldSignal = static_cast<bool>(listener_) && queue_.signalPending();
    }
    // 이전 콜백의 잠금 밖 해제
    previous = nullptr;
    if (shouldSignal) {
      signal();
    }
  }

  void dispose() {
    disposed_ = true;
    setSignalListener(nullptr);
  }

 private:
  // 모든 신호가 지나는 유일한 경로
  void signal() {
    std::function<void()> listener;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      listener = listener_;
    }
    // 콜백 호출의 잠금 밖 실행
    if (listener) {
      listener();
    }
  }

  BoundedQueue queue_;
  std::mutex mutex_;
  std::function<void()> listener_;
  std::atomic<bool> disposed_{false};
};

EventQueueCore::EventQueueCore() : state_(std::make_shared<State>()) {}

bool EventQueueCore::validMaxCount(double maxCount) {
  return std::isfinite(maxCount) && 1 <= maxCount &&
         std::trunc(maxCount) == maxCount;
}

void EventQueueCore::push(const std::shared_ptr<ArrayBuffer>& data) const {
  state_->push(data);
}

PullResult EventQueueCore::pull(double maxCount) const {
  return state_->pull(maxCount);
}

void EventQueueCore::setSignalListener(std::function<void()> listener) const {
  state_->setSignalListener(std::move(listener));
}

void EventQueueCore::clearSignalListener() const {
  state_->setSignalListener(nullptr);
}

void EventQueueCore::dispose() const { state_->dispose(); }

}  // namespace margelo::nitro::velo
