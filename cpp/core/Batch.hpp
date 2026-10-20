#pragma once

#include <NitroModules/ArrayBuffer.hpp>
#include <cstddef>
#include <memory>
#include <vector>

namespace eventstream::core {

// pull이 돌려주는 묶음
struct Batch {
  // 큐에서 꺼낸 항목
  // 보관한 버퍼의 복사 없는 전달
  std::vector<std::shared_ptr<margelo::nitro::ArrayBuffer>> items;
  // 직전 pull 이후 버린 건수
  size_t dropped = 0;
  // pull 뒤에도 큐에 항목이 남았는지 나타내는 값
  // 신호를 다시 보낼지 정하는 데 사용
  bool hasMore = false;
};

}  // namespace eventstream::core
