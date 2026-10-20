#pragma once

#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>

#include "EventQueueCore.hpp"
#include "HybridEventQueueSpec.hpp"

namespace margelo::nitro::velo {

// 네이티브 제한 큐를 통해 이벤트를 JS로 전달하는 스트림
// 큐와 신호 상태는 공유 연결부 EventQueueCore가 소유
class HybridEventQueue : public HybridEventQueueSpec {
 public:
  HybridEventQueue() : HybridObject(TAG), HybridEventQueueSpec() {}

  void setSignalListener(
      const std::optional<std::function<void()>>& listener) override {
    if (listener.has_value()) {
      core_.setSignalListener(*listener);
    } else {
      core_.clearSignalListener();
    }
  }

  PullResult pull(double maxCount) override {
    if (!EventQueueCore::validMaxCount(maxCount)) {
      throw std::invalid_argument(
          "maxCount must be an integer greater than or equal to 1");
    }
    return core_.pull(maxCount);
  }

  void push(const std::shared_ptr<ArrayBuffer>& data) override {
    core_.push(data);
  }

  void dispose() override { core_.dispose(); }

 private:
  EventQueueCore core_;
};

}  // namespace margelo::nitro::velo
