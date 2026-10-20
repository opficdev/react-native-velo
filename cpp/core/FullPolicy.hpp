#pragma once

namespace velo::core {

// 큐가 가득 찼을 때 적용하는 처리 방식
enum class FullPolicy {
  // 가장 오래된 항목부터 버리고 새 항목을 보관하는 정책
  dropOldest,
  // 새 항목을 버리는 정책
  dropNewest,
  // 최신 항목 하나만 보관하는 정책
  // 건수 제한 미적용
  latest,
  // 가득 차면 멈춤 상태로 바꾸고 들어온 항목은 버리는 정책
  pauseProducer,
};

}  // namespace velo::core
