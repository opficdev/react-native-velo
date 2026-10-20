#pragma once

#include "HybridEventQueueSpec.hpp"

namespace margelo::nitro::velo {

// 네이티브 제한 큐를 통해 이벤트를 JS로 전달하는 스트림
// 기능 구현은 2단계 예정
class HybridEventQueue : public HybridEventQueueSpec {
 public:
  HybridEventQueue() : HybridObject(TAG), HybridEventQueueSpec() {}
};

}  // namespace margelo::nitro::velo
