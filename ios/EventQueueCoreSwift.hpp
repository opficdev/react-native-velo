#pragma once

#include <NitroModules/SwiftClosure.hpp>

#include "EventQueueCore.hpp"

namespace margelo::nitro::velo {

// Swift 클로저를 신호 콜백으로 등록하는 호출
// std::function을 직접 받을 수 없는 Swift용 진입점
inline void setSignalListener(const EventQueueCore& core, const SwiftClosure& listener) {
  core.setSignalListener(listener.getFunction());
}

}  // namespace margelo::nitro::velo
