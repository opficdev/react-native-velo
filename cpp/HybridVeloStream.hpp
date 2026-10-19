#pragma once

#include "HybridVeloStreamSpec.hpp"

namespace margelo::nitro::velo {

// 네이티브 제한 큐를 통해 이벤트를 JS로 전달하는 스트림이다.
// 기능은 2단계에서 채운다.
class HybridVeloStream : public HybridVeloStreamSpec {
 public:
  HybridVeloStream() : HybridObject(TAG), HybridVeloStreamSpec() {}
};

}  // namespace margelo::nitro::velo
