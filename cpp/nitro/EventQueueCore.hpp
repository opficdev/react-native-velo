#pragma once

#include <NitroModules/ArrayBuffer.hpp>
#include <functional>
#include <memory>

#include "PullResult.hpp"

namespace margelo::nitro::velo {

// 큐와 신호 상태를 묶어 iOS와 Android 구현이 함께 쓰는 연결부
// 복사한 핸들끼리 같은 상태 공유
// 임의 스레드의 생산자 push 전제
// 한 스레드의 소비자 pull 전제
// 정상 입력에서 예외를 던지지 않는 호출
// Swift가 C++ 예외를 잡을 수 없는 제약
class EventQueueCore {
 public:
  EventQueueCore();

  // pull의 maxCount가 1 이상 정수인지 나타내는 값
  [[nodiscard]] static bool validMaxCount(double maxCount);

  // 항목을 넣고 신호가 필요하면 보내는 호출
  // dispose 뒤 호출 무시
  void push(const std::shared_ptr<ArrayBuffer>& data) const;

  // 앞에서부터 최대 maxCount건을 꺼내는 호출
  // 남은 항목이 있으면 신호 재전송
  // validMaxCount가 참인 값만 허용
  [[nodiscard]] PullResult pull(double maxCount) const;

  // 신호 콜백 등록
  // 이미 보낸 신호가 대기 중이면 새 콜백에 신호 1회 전송
  void setSignalListener(std::function<void()> listener) const;

  // 신호 콜백 해제
  void clearSignalListener() const;

  // 이후 push 무시와 콜백 해제
  void dispose() const;

 private:
  class State;
  std::shared_ptr<State> state_;
};

}  // namespace margelo::nitro::velo
